#!/usr/bin/env node
// V2 S1 — Agentic detectors (read-only, static heuristics). 3 vetores:
//   1) prompt_injection  2) tool_misuse  3) runaway_loop
// Calibrado contra os padrões reais do Quarry (prompt_sanitizer / tools+ssrf_guard / bounds).
// Uso: node agentic.mjs <targetDir> <profileJsonPath> > agentic.json
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.argv[2] || '.');
const profile = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const dirs = (profile.agentDirs && profile.agentDirs.length ? profile.agentDirs : ['.']);
const scope = dirs.map(d => `'${d}'`).join(' ');

// grep helper → linhas "file:line:texto" (limitado), tolerante a no-match
const EXCL = "--include='*.py' --exclude-dir=tests --exclude='test_*.py' --exclude='*_test.py' --exclude=conftest.py";
const grep = (pattern, extra = EXCL) => {
  try {
    const out = execSync(`grep -rnoE ${extra} -e ${JSON.stringify(pattern)} ${scope} 2>/dev/null | head -60`,
      { cwd: target, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch { return []; }
};
// versão linha-completa (sem -o) → preserva contexto (ex.: comentários) p/ filtrar falsos-positivos
const grepL = (pattern, extra = EXCL) => {
  try {
    const out = execSync(`grep -rnE ${extra} -e ${JSON.stringify(pattern)} ${scope} 2>/dev/null | head -60`,
      { cwd: target, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch { return []; }
};
const grepFiles = (pattern, extra = EXCL) => {
  try {
    const out = execSync(`grep -rlE ${extra} -e ${JSON.stringify(pattern)} ${scope} 2>/dev/null | head -40`,
      { cwd: target, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch { return []; }
};
const ev = (lines, n = 4) => lines.slice(0, n).map(l => {
  const m = l.match(/^(.*?):(\d+):(.*)$/);
  return m ? { file: m[1], line: +m[2], snippet: m[3].trim().slice(0, 160) } : { raw: l.slice(0,160) };
});

const findings = [];
const vectors = {};

// ---------- 1) PROMPT INJECTION ----------
(() => {
  const sanitizerFiles = grepFiles('sanitiz|UNTRUSTED_DATA|ignore previous instructions|prompt_sanitizer');
  const wrapping = grep('UNTRUSTED_DATA|\\[REDACTED:INJECTION\\]');
  // construção de prompt com interpolação direta de dados externos sem sanitizer óbvio
  const rawConcat = grep('f"""?.*\\{(alert|event|input|user_|payload|raw|data)[^}]*\\}|system_prompt.*\\+');
  let verdict, hardBlock = false, rationale;
  if (sanitizerFiles.length && wrapping.length) {
    verdict = 'pass';
    rationale = `Sanitizer presente (${sanitizerFiles.length} arquivo(s)) + wrapping de input não-confiável (<UNTRUSTED_DATA>).`;
  } else if (sanitizerFiles.length) {
    verdict = 'warn';
    rationale = 'Sanitizer presente, mas wrapping/marcação de input não-confiável não confirmado.';
  } else {
    // hard-block só se há prompts COM input externo cru e ZERO defesa no repo
    verdict = rawConcat.length ? 'fail' : 'warn';
    hardBlock = rawConcat.length > 0;
    rationale = rawConcat.length
      ? 'Input externo concatenado em prompt sem nenhuma camada de sanitização detectada.'
      : 'Nenhum sanitizer detectado (sem evidência clara de input externo cru — inconclusivo).';
  }
  vectors.prompt_injection = { verdict, hardBlock,
    evidence: ev([...wrapping, ...sanitizerFiles.map(f=>f+':0:'+f)]),
    counts: { sanitizerFiles: sanitizerFiles.length, wrappingHits: wrapping.length, rawConcatHits: rawConcat.length } };
  findings.push({ vector: 'prompt_injection', verdict, hardBlock, severity: hardBlock?'critical':(verdict==='warn'?'medium':'info'), rationale });
})();

// ---------- 2) TOOL MISUSE ----------
(() => {
  // ignora linhas que são docstring/comentário/import-de-teste ou execução de SQL
  const noise = (l) => /:\s*#|"""|'''|:func:|sandboxed|no Python|\.execute\(|executor|execution|execute_|exec_module|import subprocess.*#|getoutput\s*#/i.test(l);
  // HARD: shell REAL (argv-list sem shell é seguro → não conta). Ignora match em comentário (após #).
  const codeOf = (l) => { const m = l.match(/^(.*?):(\d+):(.*)$/); return (m ? m[3] : l).split('#')[0]; };
  const HARD_RE = /os\.system\(|commands\.getoutput\(|pty\.spawn|shell\s*=\s*True|subprocess\.[A-Za-z]+\([^)]*shell\s*=\s*True/;
  const hard = grepL('os\\.system\\(|commands\\.getoutput\\(|pty\\.spawn|shell\\s*=\\s*True')
    .filter(l => !noise(l) && HARD_RE.test(codeOf(l)));
  // SOFT: eval/exec dinâmico (sinal fraco — vira WARN, não bloqueia; ignora docstring)
  const soft = grep('\\beval\\(|\\bexec\\(').filter(l => !noise(l) && !/literal_eval|ast\.|simpleeval|safe_eval|\.eval\(/.test(l));
  const ssrf = grepFiles('ssrf|block.*private|metadata.*169\\.254|SSRFError');
  let verdict, hardBlock = false, rationale;
  if (hard.length) {
    verdict = 'fail'; hardBlock = true;
    rationale = `Execução de shell/processo no surface de tools de agente (${hard.length}) — risco tool→RCE.`;
  } else if (soft.length) {
    verdict = 'warn';
    rationale = `${soft.length} uso(s) de eval/exec dinâmico (revisar se input não-confiável alcança).${ssrf.length?' SSRF guard presente.':''}`;
  } else {
    verdict = 'pass';
    rationale = `Sem shell/exec no surface de tools.${ssrf.length ? ' SSRF guard presente.' : ' (SSRF guard não detectado em tools HTTP — nota.)'}`;
  }
  vectors.tool_misuse = { verdict, hardBlock, evidence: ev(hard.length?hard:soft),
    counts: { hardHits: hard.length, softEvalExec: soft.length, ssrfGuardFiles: ssrf.length } };
  findings.push({ vector: 'tool_misuse', verdict, hardBlock, severity: hardBlock?'critical':(verdict==='warn'?'medium':'info'), rationale });
})();

// ---------- 3) RUNAWAY LOOP ----------
(() => {
  const bounds = grep('max_iterations|recursion_limit|MAX_ITER|max_steps|step_count|clamp_timeout|ABSOLUTE_MAX_TIMEOUT');
  const whileTrue = grep('while True|while 1:');
  const boundsFiles = grepFiles('max_iterations|recursion_limit|clamp_timeout');
  let verdict, hardBlock = false, rationale;
  if (bounds.length) {
    verdict = whileTrue.length > boundsFiles.length * 3 ? 'warn' : 'pass';
    rationale = `Bounds de loop/timeout presentes (${bounds.length} sinal(is): max_iterations/recursion_limit/timeout clamp).`;
  } else if (whileTrue.length) {
    verdict = 'fail'; hardBlock = true;
    rationale = `Loops (while True) em código de agente SEM nenhum bound (max_iterations/timeout) detectado — risco de runaway.`;
  } else {
    verdict = 'warn';
    rationale = 'Sem bounds explícitos e sem loops óbvios — inconclusivo; recomendar cap explícito.';
  }
  vectors.runaway_loop = { verdict, hardBlock, evidence: ev(bounds),
    counts: { boundSignals: bounds.length, whileTrueLoops: whileTrue.length } };
  findings.push({ vector: 'runaway_loop', verdict, hardBlock, severity: hardBlock?'critical':(verdict==='warn'?'medium':'info'), rationale });
})();

// ---------- score do pilar agentic (S1: 3 vetores, peso igual; todos são da classe 2x/hard-block) ----------
const map = { pass: 100, warn: 60, fail: 0 };
const scores = Object.values(vectors).map(v => map[v.verdict]);
const agenticScore = Math.round(scores.reduce((a,b)=>a+b,0) / scores.length);
const hardBlocks = findings.filter(f => f.hardBlock).map(f => `agentic_critical:${f.vector}`);

process.stdout.write(JSON.stringify({
  pillar: 'agentic', score: agenticScore, weightHint: 0.25,
  vectors, findings, hardBlocks,
  note: 'S1 reduzido: apenas prompt_injection, tool_misuse, runaway_loop (estáticos).'
}, null, 2));
