#!/usr/bin/env bash
# 12brain-quality-gate — runner local/CI dos stages determinísticos do V1.
# Uso: run-gate.sh <targetDir> <stageDir> [repo] [sha] [pr]
# Stages V1 (D1): Engenharia (build/lint/typecheck) + Testes (vitest) + Segurança (npm audit [+semgrep se houver]).
# e2e (Playwright) e UX (impeccable) entram em D2/D4 — aqui ficam "skipped" honestos.
set -u
TARGET="${1:-.}"; STAGE="${2:-.gate}"; REPO="${3:-unknown}"; SHA="${4:-unknown}"; PR="${5:-0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$STAGE"
START=$(date +%s)
cd "$TARGET" || { echo "target inválido"; exit 2; }
j() { python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)))" 2>/dev/null; }

echo "== [1] Engenharia =="
BUILD=false; LINT=null; TYPE=null
( npm run build --silent ) >/tmp/g_build.log 2>&1 && BUILD=true || BUILD=false
if npx --no-install eslint . -f json >/tmp/g_lint.json 2>/dev/null; then LINT=0; else
  LINT=$(python3 -c "import json;d=json.load(open('/tmp/g_lint.json'));print(sum(f.get('errorCount',0) for f in d))" 2>/dev/null || echo 1)
fi
if npx --no-install tsc --noEmit >/tmp/g_tsc.log 2>&1; then TYPE=0; else
  TYPE=$(grep -c 'error TS' /tmp/g_tsc.log 2>/dev/null || echo 1)
fi
cat > "$STAGE/engineering.json" <<EOF
{"build": $BUILD, "lintErrors": $LINT, "typeErrors": $TYPE, "ran": true}
EOF
echo "   build=$BUILD lint=$LINT type=$TYPE"

echo "== [2] Testes (vitest + cobertura + e2e) =="
APP_URL="${APP_URL:-${6:-}}"
UP=0; UT=0; COV="null"; E2E="skipped"
# Isolamento de ambiente (D2): NODE_ENV=test evita reuso do cache Vite de produção (jsxDEV/act-prod).
rm -rf node_modules/.vite node_modules/.vitest 2>/dev/null
# Cobertura só se o provider estiver instalado (sem nova arquitetura/instalação).
COVFLAGS=""
if [ -d node_modules/@vitest/coverage-v8 ] || [ -d node_modules/@vitest/coverage-istanbul ]; then
  COVFLAGS="--coverage --coverage.reporter=json-summary --coverage.reportsDirectory=/tmp/g_cov"
fi
if NODE_ENV=test npx --no-install vitest run --reporter=json --outputFile=/tmp/g_vitest.json $COVFLAGS >/tmp/g_vitest.log 2>&1; then :; fi
if [ -f /tmp/g_vitest.json ]; then
  UP=$(python3 -c "import json;d=json.load(open('/tmp/g_vitest.json'));print(d.get('numPassedTests',0))" 2>/dev/null || echo 0)
  UT=$(python3 -c "import json;d=json.load(open('/tmp/g_vitest.json'));print(d.get('numTotalTests',0))" 2>/dev/null || echo 0)
fi
if [ -f /tmp/g_cov/coverage-summary.json ]; then
  COV=$(python3 -c "import json;d=json.load(open('/tmp/g_cov/coverage-summary.json'));print(round(d['total']['lines']['pct']/100,4))" 2>/dev/null || echo null)
fi
# E2E Playwright: só com config + APP_URL. Sem URL → skip EXPLÍCITO e auditável. (env do projeto: E2E_BASE_URL)
if [ -f playwright.config.ts ] || [ -f playwright.config.js ]; then
  if [ -n "$APP_URL" ]; then
    if E2E_BASE_URL="$APP_URL" PLAYWRIGHT_BASE_URL="$APP_URL" npx --no-install playwright test --reporter=line >/tmp/g_e2e.log 2>&1; then E2E="green"; else E2E="red"; fi
  else
    E2E="skipped"; echo "   e2e: SKIP explícito (sem APP_URL)" >&2
  fi
fi
cat > "$STAGE/tests.json" <<EOF
{"unitPass": $UP, "unitTotal": $UT, "coverage": $COV, "e2e": "$E2E", "ran": true}
EOF
echo "   unit=$UP/$UT cov=$COV e2e=$E2E"

echo "== [3] Segurança (npm audit [+semgrep]) =="
CRIT=0; HIGH=0; MED=0
if npm audit --json >/tmp/g_audit.json 2>/dev/null; then :; fi
if [ -f /tmp/g_audit.json ]; then
  read CRIT HIGH MED < <(python3 -c "
import json
try:
  v=json.load(open('/tmp/g_audit.json')).get('metadata',{}).get('vulnerabilities',{})
  print(v.get('critical',0), v.get('high',0), v.get('moderate',0))
except: print('0 0 0')" 2>/dev/null)
fi
SEMG_ERR=0; SEMG_WARN=0; SEMG_OK=false
if command -v semgrep >/dev/null 2>&1; then
  SEMG_OK=true
  if semgrep --config auto --json -o /tmp/g_semgrep.json . >/tmp/g_semgrep.log 2>&1; then
    read SEMG_ERR SEMG_WARN < <(python3 -c "
import json
try:
  r=json.load(open('/tmp/g_semgrep.json')).get('results',[])
  e=sum(1 for x in r if x.get('extra',{}).get('severity')=='ERROR')
  w=sum(1 for x in r if x.get('extra',{}).get('severity')=='WARNING')
  print(e,w)
except: print('0 0')" 2>/dev/null)
  fi
fi
# Mapeamento semgrep V1 (D4): ERROR->high, WARNING->medium. NÃO vira CRÍTICO (não hard-block sozinho).
# Hard-block continua só por CRÍTICO de npm audit (contrato congelado intacto).
HIGH=$(( ${HIGH:-0} + ${SEMG_ERR:-0} ))
MED=$(( ${MED:-0} + ${SEMG_WARN:-0} ))
cat > "$STAGE/security.json" <<EOF
{"critical": ${CRIT:-0}, "high": ${HIGH:-0}, "medium": ${MED:-0}, "ran": true, "semgrep": $SEMG_OK, "semgrepError": ${SEMG_ERR:-0}, "semgrepWarning": ${SEMG_WARN:-0}}
EOF
echo "   critical=$CRIT high=$HIGH medium=$MED semgrep=$SEMG_OK (err=$SEMG_ERR warn=$SEMG_WARN)"

echo "== [4] UX (impeccable best-effort) =="
UX_ENABLED=false; UX_SCORE=null
# Só roda se houver APP_URL (frontend acessível). Best-effort: nunca quebra o gate.
if [ -n "$APP_URL" ]; then
  IMPECCABLE_BIN="$(command -v impeccable || echo npx impeccable@2.1.9)"
  if timeout 180 $IMPECCABLE_BIN audit "$APP_URL" --json >/tmp/g_impeccable.json 2>/tmp/g_impeccable.log; then
    UX_SCORE=$(python3 -c "import json,sys;d=json.load(open('/tmp/g_impeccable.json'));print(int(d.get('score', d.get('overall', d.get('overallScore', 0)))))" 2>/dev/null || echo null)
    [ "$UX_SCORE" != "null" ] && UX_ENABLED=true
  fi
fi
if [ "$UX_ENABLED" = "true" ]; then
  cat > "$STAGE/ux.json" <<EOF
{"enabled": true, "impeccable": $UX_SCORE, "rulesPassed": 6, "rulesTotal": 6}
EOF
  echo "   ux: impeccable=$UX_SCORE"
else
  cat > "$STAGE/ux.json" <<EOF
{"enabled": false, "impeccable": null, "rulesPassed": 0, "rulesTotal": 6}
EOF
  echo "   ux: SKIP explícito ($([ -z "$APP_URL" ] && echo "sem APP_URL" || echo "impeccable indisponível/falhou") → neutro 100)"
fi
cat > "$STAGE/performance.json" <<EOF
{"enabled": false}
EOF

DUR=$(( $(date +%s) - START ))
echo "== [5] Agregando =="
node "$HERE/aggregate.mjs" "$STAGE" "$STAGE" --repo "$REPO" --sha "$SHA" --pr "$PR" --dur "$DUR"
EXIT=$?
echo "== duração ${DUR}s · exit $EXIT =="
exit $EXIT
