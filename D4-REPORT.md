# D4 — Relatório (completar e endurecer o Quality Gate V1)
**Data:** 2026-06-19 · **Piloto:** zells-academy-portal · **Runs CI:** D3 `27805593166` · D4 `27831673593`

## Critérios de sucesso do D4
| Critério | Status | Evidência |
|---|---|---|
| Semgrep rodando no CI | ✅ | rodou; achou 1 WARNING (`detect-non-literal-regexp`) → +1 medium (9→10) |
| E2E executando com preview URL real | ✅ | `E2E_BASE_URL=https://whitelabel.12brain.org` → **e2e=green** |
| Gate < 8 min p95 | ✅ | **3m37s** (D3 era 1m59s; +1m38s por semgrep+e2e+install) |
| Nenhuma mudança nos contratos congelados | ✅ | score/pesos/schema/branch-protection/override intactos |
| Relatório completo dos novos achados | ✅ | este + `D4-CLERK-REPORT.md` |

## Comparação pedida
**a) npm audit vs npm audit + Semgrep**
| | npm audit (D3) | npm audit + semgrep (D4) |
|---|---|---|
| critical | 4 | 4 |
| high | 16 | 16 |
| medium | 9 | **10** (+1 do semgrep WARNING) |
| Pilar Segurança | 0 | 0 (dominado pelos 4 CRÍTICOS) |
- **Conclusão:** semgrep **funciona**, mas em zells (app React/TS limpo) acha pouco. Não muda o veredito — o bloqueio segue pelos 4 CRÍTICOS de dependência. Mapeamento V1: semgrep ERROR→high, WARNING→medium (não vira CRÍTICO, não hard-block sozinho).

**b) E2E skipped vs executado**
| | D3 | D4 |
|---|---|---|
| e2e | skipped (sem APP_URL) | **green** (executado contra preview real) |
- Skip continua **explícito e auditável** quando `app_url` vazio (logado + e2e:"skipped").

**c) Impacto no tempo total**
- 1m59s → 3m37s. Quebra: +semgrep (~25s) +playwright install (~40s) +e2e (~30s). **Folga grande** até os 8min.

## Trail of Bits — o que é headless de verdade
- ✅ **semgrep** (`static-analysis/skills/semgrep`): é CLI headless → **integrado**.
- ❌ **differential-review / insecure-defaults / sharp-edges / supply-chain**: são **skills orquestradas pelo Claude Code** (precisam de um agente), **não são CLIs headless**. Integrá-las exigiria rodar Claude Code dentro do CI = **nova arquitetura** → **fora do escopo V1** (respeitando a ordem). Registradas como candidatas pós-V1.

## impeccable / UX — status honesto
- **NÃO rodou no CI** (UX ficou `enabled:false` → neutro 100, sem quebrar o gate).
- Motivo: `npx impeccable audit <url> --json` exige instalação própria + chromium e o formato de saída não foi confirmado headless. Como a ordem é "integrar **se já estiver operacional sem mudança arquitetural**" — **não estava** → mantido como **skip auditável** no V1.
- **Decisão:** deferir impeccable como follow-up (não expandir escopo). A degradação é segura e explícita.

## Estado dos contratos congelados (re-confirmado)
- Score idêntico local↔CI (64) · schema schemaVersion 1 · branch protection **não ativada** (sua decisão) · override intacto.

## Pendências / follow-up (pós-D4)
1. impeccable headless no CI (UX real) — follow-up técnico
2. ToB skills agênticas — só com runner Claude Code (fora do V1)
3. 4 CVEs (1 P0 @clerk, jspdf P0/P1, vitest/ui P2) — correção é decisão sua
4. 5 falhas de teste do Student page — triagem do time zells

## Veredito D4
**V1 endurecido e completo no essencial:** semgrep no CI ✅, E2E real ✅, <8min ✅, contratos intactos ✅. Único item da lista que ficou pendente = **impeccable** (condicional "se operacional" → não estava → skip auditável). Pronto para a decisão de **branch protection / rollout / piloto formal**.
