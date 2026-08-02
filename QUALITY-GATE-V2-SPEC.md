# 12brain-quality-gate-v2 — SPEC (design, sem implementação)
**Data:** 2026-06-19 · **Status:** SPEC aprovada para desenho · **Âncora:** Quarry/AISOC (v7.3.1) · **Autor:** Quality Gate team
**Restrição-mãe:** o **V1 não muda** (contratos congelados: score/pesos/schema/policy/action `@v1`). V2 é **aditivo e separado** — novo action `12brain-quality-gate-v2`, novo schema `quality-score-v2.json`. Nenhum projeto simples é afetado.

---

## 0. Princípios de design
1. **V1 intocado.** Apps simples (Toolsber, Zells) continuam no `@v1`. Zero regressão.
2. **Compatibilidade conceitual.** Mesma escala 0–100, mesmas bandas de decisão (`≥85 pass` · `70–84 pass_with_warnings` · `<70 block`), mesmo conceito de *hard-block* que ignora o score.
3. **Profile-aware.** O gate detecta o perfil do projeto e seleciona o conjunto de pilares (ver §6). Um backend agentic não é penalizado por não ter UX; um frontend não é cobrado por pilar Agentic.
4. **Reúso, não reescrita.** V2 herda o **aggregator/score/VERIFICATION engine do V1** e usa os **controles já existentes no Quarry** como *ground truth* das regras agentic (não inventa padrão novo).
5. **Polyglot por adapters.** Cada linguagem é um *adapter* que emite o **mesmo shape de stage JSON**; o aggregator combina. Adicionar linguagem = adicionar adapter, sem mexer no core.
6. **Dev-only ≠ produção.** Lição da triagem Quarry: severidade de CVE é **reponderada por alcance de runtime** (uma crítica dev-only/docs não hard-blocka). Ver §5.

---

## 1. Arquitetura
```
detect-profile → [adapters polyglot em paralelo] → normalize (stage JSONs) → aggregate-v2 → outputs
                  ├─ node-adapter      (build/lint/tsc/vitest/pnpm-audit)
                  ├─ python-adapter    (ruff/mypy/pytest/pip-audit/bandit)
                  ├─ go-adapter        (go vet/test/govulncheck)
                  ├─ docker-adapter    (hadolint/compose-lint/trivy-image)
                  ├─ sast-adapter      (semgrep multi-lang + CodeQL se já houver)
                  ├─ agentic-adapter   (9 checks — §4)
                  └─ observability-adapter (§5b)
```
- **detect-profile:** varre o repo (package.json/pyproject/go.mod/docker-compose/langgraph|langchain imports) → classifica em `simple-frontend` | `polyglot-service` | `agentic-platform`. Define quais adapters/pilares rodam.
- **Monorepo-aware:** resolve workspaces (pnpm/turbo, services/*) — incorpora o input `working-directory`/`project_dir` (o v1.1 pendente do Toolsber) já de origem.
- **Adapters em paralelo**, cada um emite `<stage>.json` no shape V1 (`{score, details, ...}`). Aggregator-v2 combina + aplica pesos do profile.

---

## 2. Polyglot adapters (escopo obrigatório)
| Adapter | Build | Lint | Typecheck | Test | Vuln deps |
|---|---|---|---|---|---|
| **Node/TS** | `pnpm build`/`next build` | eslint | `tsc --noEmit` | vitest/jest | `pnpm/npm audit` |
| **Python/FastAPI** | import-smoke / `python -m build` | `ruff check` + `ruff format --check` | `mypy` | `pytest` (+coverage) | `pip-audit` |
| **Go** | `go build ./...` | `go vet` + gofmt | (compilador) | `go test ./...` | `govulncheck` |
| **Docker/Compose** | `docker build` (opcional, pesado) | `hadolint` Dockerfile · `docker compose config` lint | — | `compose-smoke` (healthchecks sobem) | `trivy image` (opcional) |

- Cada adapter é **best-effort + auditável**: se a toolchain não existe, emite `skipped` explícito (não quebra o gate), igual à filosofia V1.
- Quarry já tem **ruff/mypy/pytest** configurados → o python-adapter mapeia direto.

---

## 3. Security (scanners) — matriz
| Scanner | Alvo | Mapeamento de severidade | Hard-block? |
|---|---|---|---|
| `pnpm/npm audit` | deps JS | critical/high/moderate | critical **em runtime** |
| `pip-audit` | deps Python | idem (PyPI advisories) | critical **em runtime** |
| `govulncheck` | deps + *call-graph* Go | só reporta se o código **chama** o trecho vulnerável | critical alcançável |
| `bandit` | código Python (SAST) | HIGH/MEDIUM/LOW | HIGH confiança+sev em runtime |
| `semgrep --config auto` | multi-lang (SAST) | ERROR→high, WARNING→medium | nunca sozinho (igual V1) |
| `CodeQL` | se o repo já tem workflow | importa resultados (SARIF) | critical alcançável |

- **Reponderação por alcance (novidade V2):** cada finding é taggeado `runtime` | `dev` | `docs/test`. Severidade efetiva = nominal **× alcance**. Uma `critical` 100% `dev/docs` (ex.: shell-quote no Quarry) vira **warning**, não hard-block. `govulncheck` já faz isso nativamente (call-graph).
- **CodeQL:** V2 **não** re-roda; **consome** o SARIF do workflow existente (Quarry já tem `codeql.yml`).

---

## 4. Pilar Agentic Quality (o coração do V2)
Cada vetor é medido por **detector estático** (config + regras semgrep customizadas) calibrado contra os padrões reais do Quarry. Resultado por vetor: `PASS` / `WARN` / `FAIL` + evidência (file:line).

| # | Vetor | Sinal medido (heurística) | Referência Quarry (ground truth) | Falha = |
|---|---|---|---|---|
| 1 | **Prompt injection** | Input não-confiável passa por sanitizer/wrapping antes do prompt? Detecta concatenação crua de dados externos em prompt (semgrep) | `prompt_sanitizer.py` (8 camadas + `<UNTRUSTED_DATA>`) | **hard-block** se input externo → prompt **sem** nenhuma defesa |
| 2 | **Context/RAG leakage** | Queries de retrieval/vetor filtram por `tenant_id`? Coleções namespaced por tenant? | RLS + filtro query-layer (vetor global = WARN) | WARN (isolamento só query) · FAIL se zero filtro |
| 3 | **Tool misuse** | Surface de tools tem `shell/exec/eval/os.system`? Há allowlist? SSRF guard em tools HTTP? | tools só HTTP/RAG/regex · `ssrf_guard.py` | **hard-block** se tool de shell/exec exposta a input de agente |
| 4 | **Permission escalation** | Ações de alto impacto exigem approval/guardrail/RBAC antes de executar? | `guardrails.py` 3-tier (auto/review/escalation) + steps `approval` | FAIL se ação destrutiva autônoma sem gate |
| 5 | **Runaway loop** | Grafo do agente tem `max_iterations`/`recursion_limit`/timeout? `while/for` em volta de LLM sem cota? | `max_iterations=10` + `bounds.py` clamp `[1,900]s` | **hard-block** se loop de agente **sem** bound |
| 6 | **Token/cost budget** | Existe cap **pré-execução** (não só telemetria pós-hoc)? | cost_telemetry (pós-hoc) → Quarry recebe **WARN** aqui | WARN se só pós-hoc · FAIL se zero tracking |
| 7 | **Model fallback safety** | Cadeia de fallback não cai silenciosamente em endpoint não-autenticado/inseguro? Respeita airgap? | `llm_resolver.py` (BYOK→env→default, airgap bloqueia api.openai) | FAIL se fallback p/ endpoint inseguro sem flag |
| 8 | **RAG isolation** | Coleções de vetor segregadas por tenant/escopo? | Qdrant global + filtro (WARN) | WARN/FAIL conforme isolamento |
| 9 | **Agent decision audit** | Runs/decisões/invocações de tool persistidos em audit log + tracing spans? | OTEL + `aisoc_run_costs` + audit hash-chain (tool-trace incompleto = WARN) | WARN se decisões não auditadas · FAIL se nenhum trace |

- **Pilar Agentic score** = média ponderada dos 9 (PASS=100, WARN=60, FAIL=0; vetores 1/3/5 têm peso 2×).
- **Hard-blockers agentic** (ignoram score): vetor 1 sem defesa · vetor 3 shell/exec exposto · vetor 5 loop sem bound.
- Detectores entregam o **agentic-risk-report.md** (§7).

---

## 5b. Pilar Observability
| Check | Sinal | Quarry |
|---|---|---|
| Logs estruturados | structlog/pino JSON, sem secrets | ✅ structlog + `safe_log_value` |
| Tracing | OpenTelemetry spans em chamadas LLM/tool | ✅ api+agents (realtime falta = WARN) |
| Sentry/error-tracking | DSN configurado / handler | detectar |
| Decision logs | decisões de agente logadas | parcial = WARN |
| Run replayability | run_id + input/estado persistido p/ replay | `aisoc_run_costs`/ledger ✅ |
- Score = % de checks PASS. Gaps viram warnings, não bloqueiam.

---

## 6. Scoring V2 (pesos, blockers, schema)
### Pilares por profile (renormalizados p/ somar 1.0)
| Pilar | `simple-frontend` (=V1) | `polyglot-service` | `agentic-platform` |
|---|---|---|---|
| Engineering | 0.20 | 0.20 | 0.15 |
| Tests | 0.25 | 0.25 | 0.20 |
| Security | 0.30 | 0.30 | 0.25 |
| **Agentic** | — | — | **0.25** |
| **Observability** | — | 0.15 | 0.15 |
| UX | 0.15 | — | — |
| Performance | 0.10 | 0.10 | — |
- `simple-frontend` = **idêntico ao V1** (compatibilidade total; um app simples pontua igual nos dois gates).
- `agentic-platform` (Quarry): Security+Agentic = **50%** do peso (onde mora o risco).

### Bandas de decisão (iguais ao V1)
`score ≥ 85` → **pass** · `70–84` → **pass_with_warnings** (+issue) · `< 70` → **block**.

### Hard-blockers V2 (qualquer um → block, ignora score)
- `build_fail` (qualquer adapter)
- `security_critical_runtime` (CVE critical **alcançável em runtime**; dev/docs-only **não** bloqueia — lição Quarry)
- `agentic_critical` (vetor 1 sem defesa · vetor 3 shell/exec exposto · vetor 5 loop sem bound)
- `e2e_red`

### Warnings (viram issue, não bloqueiam)
lint errors · CVE high/moderate · dev-only criticals · vetores agentic em WARN · gaps de observability · score 70–84.

### Schema `quality-score-v2.json` (proposto)
```jsonc
{
  "schemaVersion": 2,
  "profile": "agentic-platform",
  "score": 0, "decision": "pass|pass_with_warnings|block",
  "pillars": {
    "engineering": {"score":0,"weight":0.15,"details":{}},
    "tests":       {"score":0,"weight":0.20,"details":{}},
    "security":    {"score":0,"weight":0.25,"details":{"critical_runtime":0,"critical_devonly":0,"high":0}},
    "agentic":     {"score":0,"weight":0.25,"vectors":{
        "prompt_injection":"pass","context_leakage":"warn","tool_misuse":"pass",
        "permission_escalation":"pass","runaway_loop":"pass","cost_budget":"warn",
        "model_fallback":"pass","rag_isolation":"warn","decision_audit":"warn"}},
    "observability":{"score":0,"weight":0.15,"details":{}}
  },
  "adapters": [{"lang":"python","build":true,"tests":"183/183","vuln":{}}, {"lang":"node"}, {"lang":"go"}],
  "blockers": [], "warnings": [],
  "agenticFindings": [{"vector":"context_leakage","severity":"warn","file":"...","line":0,"evidence":"..."}],
  "repo":"", "sha":"", "pr":0, "gateVersion":"2.0.0", "generatedAt":""
}
```
- **Superset do schema V1** (campos V1 preservados; novos são aditivos) → ferramentas que leem V1 continuam funcionando.

---

## 7. Outputs
1. **`VERIFICATION.md`** — estende o do V1: tabela de pilares + **bloco Agentic** (9 vetores PASS/WARN/FAIL) + bloco por-adapter (Node/Py/Go).
2. **`quality-score-v2.json`** — §6.
3. **`agentic-risk-report.md`** — relatório dedicado: por vetor → finding, file:line, severidade, exploitabilidade, recomendação. (Formato igual aos `D4-CLERK-REPORT`/`QUARRY-CVE-TRIAGE` que já produzimos.)

---

## 8. Rollout
### Como aplicar primeiro no Quarry
1. Adicionar workflow **read-only** no CI próprio do Quarry (`profile: agentic-platform`), **sem branch protection**.
2. Rodar em PR → capturar baseline (esperado: alto técnico + agentic ~78, refletindo o assessment).
3. **Calibrar** pesos/thresholds para que Quarry pontue condizente com a maturidade real (Quarry é o *oráculo* de calibração).
4. Os 3 hard-blockers agentic devem dar **verde** no Quarry (ele já tem sanitizer, allowlist sem exec, loop bound) — se algum der vermelho, é bug do detector, não do Quarry.

### Como manter V1 para apps simples
- V1 (`@v1`) **permanece o default** para `simple-frontend`. Toolsber/Zells **não migram**. Nenhuma alteração.
- V2 detecta profile; se `simple-frontend`, o resultado é **numericamente igual ao V1** (mesmos 5 pilares/pesos).

### Quando usar V2 (matriz de decisão)
| Gatilho no projeto | Gate |
|---|---|
| Só frontend / SaaS CRUD node | **V1** |
| Tem LLM/agentes/RAG | **V2** (`agentic-platform`) |
| Polyglot / múltiplos serviços / filas | **V2** (`polyglot-service`) |
| Monorepo com backend não-node | **V2** |

### Esforço estimado & plano MVP (2–4 semanas)
| Semana | Entrega |
|---|---|
| **1** | detect-profile + **node-adapter** + **python-adapter** + scanners (pip-audit/bandit/semgrep) + **aggregator-v2** (fork do V1) + `quality-score-v2.json`. Reúso máximo do V1. |
| **2** | **Pilar Agentic v0** — 9 detectores estáticos (regras semgrep + config-detectors), calibrados contra Quarry. `agentic-risk-report.md`. |
| **3** | **Pilar Observability** + **go-adapter** (govulncheck/vet) + docker/compose checks. Wire no CI do Quarry (read-only). |
| **4** | Calibração final contra Quarry (tunar pesos/thresholds) · `VERIFICATION.md` v2 · matriz de profile · docs de rollout. Buffer. |
- **MVP = profiles node+python+agentic** (cobre o Quarry e qualquer app agentic). Go/Docker entram no fim ou em v2.1.
- **Reúso (Regra 11):** aggregator/score/report = fork do `12brain-quality-gate`; regras agentic derivadas de `services/agents/app/{investigator/prompt_sanitizer,playbook/bounds,policy/guardrails,core/cost_telemetry}.py` do Quarry. **Não construir do zero.**

---

## 9. Restrições respeitadas
- ❌ Não implementei código (spec-only). ❌ Não alterei Quarry. ❌ Não corrigi CVEs. ❌ Não criei PR. ❌ Não toquei no V1. ❌ Não ativei branch protection.
- V1 e seus contratos congelados permanecem **bit-a-bit** inalterados; V2 é um artefato novo e separado.

## 10. Veredito
O V2 **estende** o Quality Gate para sistemas agentic/polyglot sem quebrar o V1: mesmos princípios de score/decisão, **+2 pilares (Agentic, Observability)**, adapters por linguagem, reponderação de CVE por alcance de runtime, e schema superset. **Quarry é o projeto-âncora e o oráculo de calibração.** MVP factível em **2–4 semanas** com reúso pesado do V1 e dos padrões já existentes no Quarry.
