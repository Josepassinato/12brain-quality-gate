#!/usr/bin/env node
/**
 * 12brain-quality-gate — AGREGADOR
 * Lê os JSONs parciais dos stages e produz:
 *   - quality-score.json  (schemaVersion 1 — CONGELADO no design review 2026-06-18)
 *   - VERIFICATION.md      (template CONGELADO)
 *
 * Pesos/limites CONGELADOS. Não alterar sem janela de recalibração (D8).
 * Uso: node aggregate.mjs <stageDir> <outDir> [--repo R] [--sha S] [--pr N] [--gate v1.0.0]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const GATE_VERSION = "1.0.0";
const WEIGHTS = { engineering: 0.20, tests: 0.25, security: 0.30, ux: 0.15, performance: 0.10 };
const THRESH = { pass: 85, warn: 70 };

const args = process.argv.slice(2);
const stageDir = args[0] || ".gate";
const outDir = args[1] || ".gate";
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };

const read = (f) => { const p = join(stageDir, f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);

// ── stage inputs (defaults seguros se um stage não rodou) ──
const eng = read("engineering.json") || { build: false, lintErrors: null, typeErrors: null, ran: false };
const tst = read("tests.json") || { unitPass: 0, unitTotal: 0, coverage: null, e2e: "skipped", ran: false };
const sec = read("security.json") || { critical: 0, high: 0, medium: 0, ran: false };
const ux = read("ux.json") || { enabled: false, impeccable: null, rulesPassed: 0, rulesTotal: 6 };
const perf = read("performance.json") || { enabled: false };

// ── pontuação por pilar (fórmula CONGELADA — Fase 3) ──
// Engenharia: build ok 40 + lint 0 erros 30 + typecheck limpo 30
let engScore = 0;
engScore += eng.build ? 40 : 0;
engScore += (eng.lintErrors === 0) ? 30 : 0;
engScore += (eng.typeErrors === 0) ? 30 : 0;

// Testes: pass-rate*40 + cobertura linear→80%=35 + e2e crítico verde 25
const passRate = tst.unitTotal > 0 ? tst.unitPass / tst.unitTotal : 1;
const covPts = tst.coverage == null ? 35 : clamp((tst.coverage / 0.80) * 35, 0, 35);
const e2ePts = tst.e2e === "green" ? 25 : tst.e2e === "red" ? 0 : 25; // skipped = neutro no V1
let tstScore = passRate * 40 + covPts + e2ePts;

// Segurança: 100 − [CRIT*40 + HIGH*15 + MED*3], piso 0
let secScore = clamp(100 - (sec.critical * 40 + sec.high * 15 + sec.medium * 3), 0, 100);

// UX: se sem frontend → 100; senão impeccable*0.70 + (rules/6)*30
let uxScore = !ux.enabled ? 100
  : clamp((ux.impeccable ?? 0) * 0.70 + ((ux.rulesPassed || 0) / (ux.rulesTotal || 6)) * 30, 0, 100);

// Performance: V1 desabilitado → 100 neutro
let perfScore = perf.enabled ? clamp(perf.score ?? 100) : 100;

const pillars = {
  engineering: { score: round(engScore), weight: WEIGHTS.engineering, details: { build: !!eng.build, lintErrors: eng.lintErrors, typeErrors: eng.typeErrors } },
  tests:       { score: round(tstScore), weight: WEIGHTS.tests, details: { unitPass: tst.unitPass, unitTotal: tst.unitTotal, coverage: tst.coverage, e2e: tst.e2e } },
  security:    { score: round(secScore), weight: WEIGHTS.security, details: { critical: sec.critical, high: sec.high, medium: sec.medium } },
  ux:          { score: round(uxScore), weight: WEIGHTS.ux, details: { impeccable: ux.impeccable, rulesPassed: ux.rulesPassed, rulesTotal: ux.rulesTotal, enabled: ux.enabled } },
  performance: { score: round(perfScore), weight: WEIGHTS.performance, details: { enabled: perf.enabled } },
};

const score = round(Object.values(pillars).reduce((s, p) => s + p.score * p.weight, 0));

// ── bloqueadores DUROS (ignoram o score) ──
const blockers = [];
if (!eng.build) blockers.push({ code: "BUILD-FAIL", pillar: "engineering", msg: "build quebrado", ref: "build" });
for (let i = 0; i < sec.critical; i++) blockers.push({ code: "SEC-CRIT", pillar: "security", msg: "vulnerabilidade CRÍTICA", ref: "semgrep/audit" });
if (tst.e2e === "red") blockers.push({ code: "E2E-RED", pillar: "tests", msg: "e2e crítico vermelho", ref: "playwright" });

const warnings = [];
if (tst.coverage != null && tst.coverage < 0.80) warnings.push({ code: "COV-LOW", pillar: "tests", msg: `cobertura ${(tst.coverage*100).toFixed(0)}% < 80%` });
if (eng.lintErrors > 0) warnings.push({ code: "LINT", pillar: "engineering", msg: `${eng.lintErrors} erro(s) de lint` });
if (sec.high > 0) warnings.push({ code: "SEC-HIGH", pillar: "security", msg: `${sec.high} vuln HIGH` });

// ── decisão (limites CONGELADOS + override duro) ──
let decision;
if (blockers.length > 0) decision = "block";
else if (score >= THRESH.pass) decision = "pass";
else if (score >= THRESH.warn) decision = "pass_with_warnings";
else decision = "block";
if (decision === "pass_with_warnings" && score < THRESH.pass) {
  warnings.push({ code: "SCORE-BAND", pillar: "overall", msg: `score ${score} em faixa de ressalva (70-84)` });
}

const out = {
  schemaVersion: 1,
  gateVersion: opt("gate", GATE_VERSION),
  repo: opt("repo", "unknown"),
  sha: opt("sha", "unknown"),
  pr: Number(opt("pr", "0")) || 0,
  timestamp: opt("ts", new Date().toISOString()),
  score,
  decision,
  pillars,
  blockers,
  warnings,
  durationSec: Number(opt("dur", "0")) || 0,
};

writeFileSync(join(outDir, "quality-score.json"), JSON.stringify(out, null, 2));

// ── VERIFICATION.md (template CONGELADO) ──
const statusLabel = decision === "pass" ? "PASSED" : decision === "pass_with_warnings" ? "PASSED_WITH_WARNINGS" : "BLOCKED";
const st = (p) => blockers.some(b => b.pillar === p) ? "BLOCK" : (p === "performance" && !perf.enabled) ? "n/a" : "ok";
const row = (label, p, findings) => `| ${label.padEnd(12)} | ${String(pillars[p].score).padStart(5)} | ${st(p).padEnd(6)} | ${findings} |`;
const md = `# Quality Gate — VERIFICATION
Repo: ${out.repo}  ·  Commit: ${out.sha}  ·  PR: #${out.pr}  ·  Quando: ${out.timestamp}  ·  Gate: v${out.gateVersion}

## Resultado: ${statusLabel}   Score: ${score}/100

| Pilar        | Score | Status | Achados-chave |
|--------------|-------|--------|---------------|
${row("Engenharia", "engineering", `build ${eng.build?"ok":"FALHOU"}, lint ${eng.lintErrors ?? "?"}, tsc ${eng.typeErrors ?? "?"}`)}
${row("Testes", "tests", `${tst.unitPass}/${tst.unitTotal} unit, cov ${tst.coverage==null?"n/a":(tst.coverage*100).toFixed(0)+"%"}, e2e ${tst.e2e}`)}
${row("Seguranca", "security", `crit ${sec.critical}, high ${sec.high}, med ${sec.medium}`)}
${row("UX visual", "ux", ux.enabled ? `impeccable ${ux.impeccable ?? "?"}, RULES ${ux.rulesPassed}/${ux.rulesTotal}` : "sem frontend / nao avaliado")}
${row("Performance", "performance", perf.enabled ? `score ${perfScore}` : "(Lighthouse fora do V1)")}

## 🔴 Bloqueadores (impedem merge)
${blockers.length ? blockers.map(b => `- [${b.code}] ${b.msg} (${b.ref})`).join("\n") : "- nenhum"}

## 🟡 Ressalvas (nao bloqueiam; viram issue)
${warnings.length ? warnings.map(w => `- [${w.code}] ${w.msg}`).join("\n") : "- nenhuma"}

Artefato bruto: quality-score.json (anexo do run)
`;
writeFileSync(join(outDir, "VERIFICATION.md"), md);

console.log(`[gate] score=${score} decision=${decision} blockers=${blockers.length} warnings=${warnings.length}`);
process.exit(decision === "block" ? 1 : 0);
