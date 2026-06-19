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
# E2E Playwright: só se houver config + APP_URL (template e2e-composition). Senão skipped (honesto).
if [ -f playwright.config.ts ] || [ -f playwright.config.js ]; then
  if [ -n "$APP_URL" ]; then
    if PLAYWRIGHT_BASE_URL="$APP_URL" npx --no-install playwright test --reporter=line >/tmp/g_e2e.log 2>&1; then E2E="green"; else E2E="red"; fi
  else
    E2E="skipped"   # sem URL alvo (CI fornece via APP_URL)
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
SEMG=0
if command -v semgrep >/dev/null 2>&1; then
  if semgrep --config auto --json -o /tmp/g_semgrep.json . >/dev/null 2>&1; then
    SEMG=$(python3 -c "import json;d=json.load(open('/tmp/g_semgrep.json'));print(sum(1 for r in d.get('results',[]) if r.get('extra',{}).get('severity')=='ERROR'))" 2>/dev/null || echo 0)
  fi
fi
CRIT=$(( ${CRIT:-0} + ${SEMG:-0} ))
cat > "$STAGE/security.json" <<EOF
{"critical": ${CRIT:-0}, "high": ${HIGH:-0}, "medium": ${MED:-0}, "ran": true, "semgrep": $( command -v semgrep >/dev/null 2>&1 && echo true || echo false )}
EOF
echo "   critical=$CRIT high=$HIGH medium=$MED semgrep=$([ "$SEMG" != 0 ] && echo "$SEMG ERR" || command -v semgrep >/dev/null 2>&1 && echo "0" || echo "ausente")"

echo "== [4] UX (impeccable) — D4, skipped =="
cat > "$STAGE/ux.json" <<EOF
{"enabled": false, "impeccable": null, "rulesPassed": 0, "rulesTotal": 6}
EOF
cat > "$STAGE/performance.json" <<EOF
{"enabled": false}
EOF

DUR=$(( $(date +%s) - START ))
echo "== [5] Agregando =="
node "$HERE/aggregate.mjs" "$STAGE" "$STAGE" --repo "$REPO" --sha "$SHA" --pr "$PR" --dur "$DUR"
EXIT=$?
echo "== duração ${DUR}s · exit $EXIT =="
exit $EXIT
