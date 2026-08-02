#!/usr/bin/env node
// V2 S1 — Aggregator. Combina stage JSONs + agentic.json → quality-score-v2.json + VERIFICATION.md + agentic-risk-report.md
// Uso: node aggregate.mjs <stageDir> <repo> <sha>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const stageDir = path.resolve(process.argv[2] || '.gate2');
const repo = process.argv[3] || 'unknown';
const sha = process.argv[4] || 'unknown';
const rd = (f) => { const p = path.join(stageDir, f); return existsSync(p) ? JSON.parse(readFileSync(p,'utf8')) : null; };

const profile = rd('profile.json') || { profile: 'agentic-platform', languages: [] };
const eng = rd('engineering.json') || { score: 100, details: { note: 'skip' }, enabled: false };
const tests = rd('tests.json') || { score: 100, details: { note: 'skip' }, enabled: false };
const sec = rd('security.json') || { score: 100, details: { note: 'skip' }, enabled: false };
const agentic = rd('agentic.json') || { score: 100, vectors: {}, findings: [], hardBlocks: [] };
const obs = { score: 100, enabled: false, details: { note: 'S1: observability não implementada (neutro)' } };

// pesos por profile (spec §6) — observability neutralizada em S1
const WEIGHTS = {
  'agentic-platform': { engineering:.15, tests:.20, security:.25, agentic:.25, observability:.15 },
  'polyglot-service': { engineering:.20, tests:.25, security:.30, agentic:.0,  observability:.15 },
  'simple-frontend':  { engineering:.20, tests:.25, security:.30, agentic:.0,  observability:.0, ux:.15, performance:.10 },
};
const W = WEIGHTS[profile.profile] || WEIGHTS['agentic-platform'];

const pillars = {
  engineering:   { score: eng.score, weight: W.engineering, details: eng.details },
  tests:         { score: tests.score, weight: W.tests, details: tests.details },
  security:      { score: sec.score, weight: W.security, details: sec.details },
  agentic:       { score: agentic.score, weight: W.agentic||0, vectors: Object.fromEntries(Object.entries(agentic.vectors||{}).map(([k,v])=>[k,v.verdict])) },
  observability: { score: obs.score, weight: W.observability||0, details: obs.details },
};

// score ponderado (só pilares com peso > 0)
let score = 0, wsum = 0;
for (const p of Object.values(pillars)) { if (p.weight > 0) { score += p.score * p.weight; wsum += p.weight; } }
score = wsum ? Math.round(score / wsum) : 0;

// hard-blockers
const blockers = [];
if (eng.details && eng.details.build === false) blockers.push('build_fail');
if (sec.details && (sec.details.critical_runtime > 0)) blockers.push('security_critical_runtime');
for (const hb of (agentic.hardBlocks || [])) blockers.push(hb);

// decisão (bandas V1)
let decision = score >= 85 ? 'pass' : (score >= 70 ? 'pass_with_warnings' : 'block');
if (blockers.length) decision = 'block';

// warnings
const warnings = [];
if (eng.details?.typeErrors) warnings.push(`[ENG] ${eng.details.typeErrors} erros de typecheck`);
if (eng.details?.lintErrors) warnings.push(`[ENG] ${eng.details.lintErrors} erros de lint`);
if (sec.details?.high) warnings.push(`[SEC] ${sec.details.high} CVE high`);
if (sec.details?.critical_devonly) warnings.push(`[SEC] ${sec.details.critical_devonly} critical dev-only (não bloqueia)`);
for (const f of (agentic.findings||[])) if (f.verdict === 'warn') warnings.push(`[AGENTIC] ${f.vector}: WARN — ${f.rationale}`);
if (decision === 'pass_with_warnings') warnings.push(`[SCORE-BAND] score ${score} em faixa de ressalva (70–84)`);

const result = {
  schemaVersion: 2, gateVersion: '2.0.0-s1', profile: profile.profile, languages: profile.languages,
  score, decision, pillars,
  adapters: [eng, tests, sec].filter(a => a.enabled !== false).map(a => ({ lang: a.lang, ...a.details })),
  agenticFindings: agentic.findings || [],
  blockers, warnings,
  repo, sha, pr: 0, generatedAt: new Date().toISOString(),
  enforced: false, note: 'S1 read-only: NÃO bloqueia deploy.'
};
writeFileSync(path.join(stageDir, 'quality-score-v2.json'), JSON.stringify(result, null, 2));

// ---------- VERIFICATION.md ----------
const vBadge = decision === 'pass' ? 'PASSED' : decision === 'pass_with_warnings' ? 'PASSED_WITH_WARNINGS' : 'BLOCKED';
const vrow = (n,p) => `| ${n.padEnd(13)} | ${String(p.score).padStart(3)} | ${p.weight?('w='+p.weight):'n/a'} |`;
const verification = `# Quality Gate V2 — VERIFICATION
Repo: ${repo} · Commit: ${sha} · Profile: **${profile.profile}** · Gate: v2.0.0-s1 · ${result.generatedAt}

## Resultado: ${vBadge}   Score: ${score}/100   (read-only, NÃO bloqueia deploy)

| Pilar | Score | Peso |
|-------|-------|------|
${vrow('Engineering', pillars.engineering)}
${vrow('Tests', pillars.tests)}
${vrow('Security', pillars.security)}
${vrow('Agentic', pillars.agentic)}
${vrow('Observability', pillars.observability)}

## 🔴 Hard-blockers: ${blockers.length ? blockers.join(', ') : 'nenhum'}

## 🟡 Warnings
${warnings.length ? warnings.map(w=>'- '+w).join('\n') : '- nenhum'}

## Agentic (S1: 3 vetores)
${Object.entries(agentic.vectors||{}).map(([k,v])=>`- **${k}**: ${v.verdict.toUpperCase()} — ${JSON.stringify(v.counts)}`).join('\n')}
`;
writeFileSync(path.join(stageDir, 'VERIFICATION.md'), verification);

// ---------- agentic-risk-report.md ----------
const sevEmoji = { critical:'🔴', high:'🟠', medium:'🟡', info:'🟢' };
const risk = `# Agentic Risk Report — ${repo}
**Profile:** ${profile.profile} · **Gate:** v2.0.0-s1 · **${result.generatedAt}** · **Modo:** read-only
**Agentes detectados:** ${profile.agentFileCount||0} arquivo(s) · dirs: ${(profile.agentDirs||[]).join(', ')||'—'}

## Resumo
- **Agentic pillar score:** ${agentic.score}/100
- **Hard-blocks agentic:** ${(agentic.hardBlocks||[]).length ? agentic.hardBlocks.join(', ') : 'nenhum'}

## Vetores (S1)
${(agentic.findings||[]).map(f => {
  const v = agentic.vectors[f.vector] || {};
  const evd = (v.evidence||[]).map(e => e.file ? `\`${e.file}:${e.line}\` ${e.snippet||''}` : (e.raw||'')).filter(Boolean).slice(0,4);
  return `### ${sevEmoji[f.severity]||''} ${f.vector} — **${f.verdict.toUpperCase()}**${f.hardBlock?' (HARD-BLOCK)':''}
- **Avaliação:** ${f.rationale}
- **Contadores:** ${JSON.stringify(v.counts||{})}
${evd.length ? '- **Evidência:**\n'+evd.map(e=>'  - '+e).join('\n') : '- _sem evidência direta_'}`;
}).join('\n\n')}

## Não avaliado nesta fase (S1)
Cost budget · RAG isolation · decision audit · context leakage · permission escalation · model fallback · observability avançada. (Ver QUALITY-GATE-V2-SPEC.md.)
`;
writeFileSync(path.join(stageDir, 'agentic-risk-report.md'), risk);

console.log(`[gate-v2] profile=${profile.profile} score=${score} decision=${decision} agentic=${agentic.score} blockers=${blockers.length} warnings=${warnings.length}`);
