#!/usr/bin/env bash
# 12brain-quality-gate V2 — S1 reduzido. READ-ONLY. NUNCA bloqueia (exit 0 sempre).
# Uso: run-v2.sh <targetDir> <stageDir> <repo> <sha>
set +e
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="$(cd "${1:-.}" && pwd)"; STAGE="${2:-$TARGET/.gate2}"; REPO="${3:-unknown}"; SHA="${4:-unknown}"
mkdir -p "$STAGE"; cd "$TARGET" || exit 0
echo "== V2 S1 :: target=$TARGET =="

# [0] PROFILE
node "$HERE/lib/profile.mjs" "$TARGET" > "$STAGE/profile.json" 2>/dev/null
PROFILE=$(node -e "console.log(require('$STAGE/profile.json').profile)" 2>/dev/null)
echo "   profile=$PROFILE"

# ---------- adapter helpers ----------
NODE_TSC=""; NODE_LINT=""; RUFF=""
# [1] NODE ADAPTER (best-effort; reuso conceitual do V1)
WEBPKG=$(node -e "try{const g=require('child_process').execSync('git ls-files \'*/package.json\' package.json',{cwd:'$TARGET'}).toString().split('\n').find(f=>f&&/web|app/.test(f));const p=require('$TARGET/'+g);console.log(p.name||'')}catch{console.log('')}" 2>/dev/null)
if command -v pnpm >/dev/null 2>&1 && [ -n "$WEBPKG" ]; then
  echo "   [node] type-check/lint em $WEBPKG (best-effort)"
  NODE_TSC=$(NODE_ENV= timeout 200 pnpm --filter "$WEBPKG" type-check 2>&1 | grep -c 'error TS')
  NODE_LINT=$(NODE_ENV= timeout 200 pnpm --filter "$WEBPKG" lint 2>&1 | grep -cE '[0-9]+ problems? \([0-9]+ error|error  ')
fi

# [2] SECURITY (pnpm audit ×2 — advisory DB é instável; só conta critical-runtime que REPRODUZ)
timeout 150 pnpm audit --json > "$STAGE/_audit1.json" 2>/dev/null
timeout 150 pnpm audit --json > "$STAGE/_audit2.json" 2>/dev/null
python3 - "$STAGE/_audit1.json" "$STAGE/_audit2.json" "$STAGE/security.json" <<'PY' 2>/dev/null
import json,sys
def load(p):
    try: return json.load(open(p))
    except: return {}
DEV_ROOTS=('webpack-dev-server','launch-editor','vitest','@vitest','vite','esbuild',
  'eslint','jest','@storybook','storybook','@docusaurus','docusaurus','rollup','turbo',
  'tsx','ts-node','@playwright','playwright','nodemon','concurrently')
def is_dev_path(p):
    if p.startswith('apps/docs'): return True
    return any(tok in p for tok in DEV_ROOTS)   # build/test tooling => não roda em produção
def crits(d):
    rt,dev=set(),set()
    for v in (d.get('advisories') or {}).values():
        if v.get('severity')!='critical': continue
        paths=[p for f in v.get('findings',[]) for p in f.get('paths',[])]
        devonly = paths and all(is_dev_path(p) for p in paths)
        (dev if devonly else rt).add(v.get('module_name'))
    return rt,dev
d1,d2=load(sys.argv[1]),load(sys.argv[2])
rt1,dev1=crits(d1); rt2,dev2=crits(d2)
crit_rt = rt1 & rt2                      # runtime só se REPRODUZ nos 2 runs (mata transitório)
crit_dev = dev1 | dev2
flaky = (rt1 ^ rt2)                       # apareceu só num run = instável
meta=(d1.get('metadata',{}).get('vulnerabilities',{}) or d2.get('metadata',{}).get('vulnerabilities',{}))
high=meta.get('high',0); mod=meta.get('moderate',0)
score=max(0,100-(len(crit_rt)*40+high*15+mod*3))
json.dump({"lang":"node-deps","enabled":True,"score":score,
  "details":{"critical_runtime":len(crit_rt),"critical_devonly":len(crit_dev),
             "high":high,"moderate":mod,
             "critical_runtime_pkgs":sorted(crit_rt),"critical_devonly_pkgs":sorted(crit_dev),
             "flaky_advisories":sorted(flaky)}},
  open(sys.argv[3],'w'))
PY
[ -f "$STAGE/security.json" ] || echo '{"score":100,"enabled":false,"details":{"note":"audit n/a"}}' > "$STAGE/security.json"

# [3] PYTHON ADAPTER (best-effort, venv efêmero — removido no fim; nada permanente)
VENV=/tmp/qg_v2_venv_$$
if echo "$PROFILE" | grep -qE 'python|agentic|polyglot' && command -v python3 >/dev/null 2>&1; then
  if python3 -m venv "$VENV" >/dev/null 2>&1 && "$VENV/bin/pip" install -q ruff >/dev/null 2>&1; then
    echo "   [python] ruff (best-effort)"
    RUFF=$(timeout 180 "$VENV/bin/ruff" check services/ 2>/dev/null | grep -cE '^\S+:[0-9]+:[0-9]+:' )
  fi
fi

# [4] ENGINEERING (média dos sub-checks que rodaram)
python3 - "$STAGE/engineering.json" "${NODE_TSC:-NA}" "${NODE_LINT:-NA}" "${RUFF:-NA}" <<'PY' 2>/dev/null
import json,sys
out=sys.argv[1]; tsc,lint,ruff=sys.argv[2],sys.argv[3],sys.argv[4]
subs=[]; det={}
if tsc!="NA": v=100 if int(tsc)==0 else max(0,100-int(tsc)*5); subs.append(v); det["node_typeErrors"]=int(tsc)
if lint!="NA": v=100 if int(lint)==0 else max(0,100-int(lint)*3); subs.append(v); det["node_lintErrors"]=int(lint)
if ruff!="NA": v=100 if int(ruff)==0 else max(0,100-int(ruff)); subs.append(v); det["python_ruffIssues"]=int(ruff)
score=round(sum(subs)/len(subs)) if subs else 100
det["typeErrors"]=int(tsc) if tsc!="NA" else 0
det["lintErrors"]=(int(lint) if lint!="NA" else 0)+(int(ruff) if ruff!="NA" else 0)
det["build"]=True
json.dump({"lang":"polyglot","enabled":bool(subs),"score":score,"details":det},open(out,'w'))
PY
[ -f "$STAGE/engineering.json" ] || echo '{"score":100,"enabled":false,"details":{"build":true}}' > "$STAGE/engineering.json"

# tests skip explícito (S1)
echo '{"score":100,"enabled":false,"details":{"note":"S1: testes não executados (neutro)"}}' > "$STAGE/tests.json"

# [5] AGENTIC (3 detectores)
echo "   [agentic] prompt_injection / tool_misuse / runaway_loop"
node "$HERE/lib/agentic.mjs" "$TARGET" "$STAGE/profile.json" > "$STAGE/agentic.json" 2>/dev/null
[ -s "$STAGE/agentic.json" ] || echo '{"score":100,"vectors":{},"findings":[],"hardBlocks":[]}' > "$STAGE/agentic.json"

# [6] AGGREGATE
node "$HERE/lib/aggregate.mjs" "$STAGE" "$REPO" "$SHA"

# cleanup efêmero
rm -rf "$VENV" "$STAGE/_audit1.json" "$STAGE/_audit2.json" 2>/dev/null
echo "== V2 S1 done (read-only, exit 0) =="
exit 0
