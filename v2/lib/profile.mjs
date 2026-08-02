#!/usr/bin/env node
// V2 S1 — Profile Detection (read-only). Decide quais adapters/pilares rodam.
// Uso: node profile.mjs <targetDir> > profile.json
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.argv[2] || '.');
const sh = (cmd) => { try { return execSync(cmd, { cwd: target, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(); } catch { return ''; } };

// --- linguagens presentes ---
const languages = [];
if (sh(`git ls-files '*package.json' 2>/dev/null | head -1`) || existsSync(path.join(target,'package.json'))) languages.push('node');
if (sh(`git ls-files '*pyproject.toml' '*requirements*.txt' 2>/dev/null | head -1`)) languages.push('python');
if (sh(`git ls-files '*go.mod' 2>/dev/null | head -1`)) languages.push('go');
const hasCompose = !!sh(`git ls-files 'docker-compose*.yml' 'docker-compose*.yaml' 2>/dev/null | head -1`);

// --- detecção agentic: arquivos Python que usam frameworks de agente/LLM ---
const agentHits = sh(`grep -rlE 'langgraph|langchain|StateGraph|ChatOpenAI|ChatAnthropic|from openai|anthropic' --include='*.py' . 2>/dev/null | head -200`);
const agentFilesRaw = agentHits ? agentHits.split('\n').filter(Boolean) : [];
// excluir testes/scripts/benchmarks/customizations — não são o SURFACE de runtime do agente
const skip = /(\/tests?\/|(^|\/)test_|_test\.py$|\/benchmarks?\/|\/scripts?\/|\/customizations?\/|\/datasets?\/|conftest\.py$)/i;
const agentFiles = agentFilesRaw.filter(f => !skip.test('/' + f));
// colapsa para a raiz do agente (.../agents) quando existir; senão o dir do arquivo
const agentDirs = [...new Set(agentFiles.map(f => {
  const parts = f.split('/');
  const i = parts.findIndex(p => /^(agents?|investigator|orchestrat\w*)$/i.test(p));
  return i >= 0 ? parts.slice(0, i + 1).join('/') : parts.slice(0, -1).join('/');
}))].filter(Boolean).slice(0, 12);

const isAgentic = agentFiles.length > 0;
let profile;
if (isAgentic) profile = 'agentic-platform';
else if (languages.length > 1 || languages.some(l => l !== 'node')) profile = 'polyglot-service';
else profile = 'simple-frontend';

const out = { profile, languages, hasCompose, agentic: isAgentic, agentFileCount: agentFiles.length, agentDirs };
process.stdout.write(JSON.stringify(out, null, 2));
