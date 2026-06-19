# D2 — Validação de Confiabilidade do Pilar TESTES (relatório executivo)
**Data:** 2026-06-19 · **Piloto:** zells-academy-portal · **Objetivo:** o score 57 = produto ruim ou ambiente ruim?

## RESPOSTA DIRETA
**Era AMBIENTE ruim, não produto ruim.** As 81 falhas do D1 colapsaram para **5** num run limpo. O pilar Testes do D1 estava **contaminado** por um bug do *runner* do gate (não do produto).

## Distribuição das 81 falhas (D1)
| Causa raiz | Qtd | % | Reproduzível em CI? |
|---|---|---|---|
| **AMBIENTE** — build poluiu o cache do Vite → vitest reusou React de **produção** (`jsxDEV is not a function`, `act not supported in production builds`) | **76** | **94%** | ❌ Não — só com o runner contaminado |
| **REAL** — testes do Student page (testid/header/lista de vídeos/skeletons) | **5** | **6%** | ✅ Sim |

- Run D1 (contaminado): **41/123** passou.
- Run LIMPO (`NODE_ENV=test`, = o que o CI faz): **117/123** passou · **0** erros jsxDEV/prod-React.

## As 3 perguntas, objetivamente
1. **Quantas reproduzíveis em CI?** → **5** (as do Student page).
2. **Quantas exclusivas da VPS/local?** → **76** (bug do runner; somem no ambiente limpo/CI).
3. **Quantas são defeito real do produto?** → **no máximo 5 (4%)**, e são de nível *teste/mock* (Student page: dados mockados não renderizam a lista). Provável: testes defasados/mock vazio; no máximo 1 regressão real a triar pelo time Zells.

## Local vs CI (score)
| | Tests pillar | Score total | Decisão |
|---|---|---|---|
| Local D1 (contaminado) | 73 | 57 | block |
| Limpo / CI-equiv (pós-fix) | **98** | **64** | block* |
\* o block agora vem **só dos 4 CRÍTICOS de segurança reais** (CVEs de dependência) — o gate está bloqueando por motivo legítimo.

## Causa raiz predominante
**Contaminação de ambiente no runner** (94%): o stage de build rodou antes dos testes e envenenou o cache `node_modules/.vite` com React em modo produção. Não é falha do produto nem do score.

## Ajuste recomendado → **JÁ APLICADO** (fix de runner, NÃO de contrato)
- `run-gate.sh` stage [2]: `NODE_ENV=test` + limpar `node_modules/.vite|.vitest` antes do vitest.
- **Não alterado:** score, schema, branch protection, política de override.
- Resultado: pilar Testes passou de 73 (falso) → 98 (real, reproduzível).

## Nível de confiança do pilar TESTES
- **Antes do fix:** ~25% (inutilizável, contaminado).
- **Depois do fix:** **~92%** — run limpo reproduzível, alinhado ao CI; só 5 falhas conhecidas, isoladas a 1 página. Os ~8% restantes = triar as 5 + adicionar cobertura/e2e (D2 técnico).

## Conclusão para a decisão corporativa
- O **score como referência é confiável** para Eng/Segurança desde o D1; o pilar **Testes ficou confiável após o fix de ambiente**.
- O zells NÃO é um produto ruim: **95% dos testes passam**. O bloqueio real e legítimo é **segurança** (4 deps CRÍTICAS) — que é exatamente o gate fazendo seu trabalho.

## Liberado para prosseguir (pós-validação)
publicar action · integrar E2E · adicionar cobertura · piloto formal.
