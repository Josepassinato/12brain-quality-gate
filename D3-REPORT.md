# D3 — Relatório (Quality Gate → componente corporativo)
**Data:** 2026-06-19 · **Piloto:** zells-academy-portal

## Entregáveis D3 — status
| # | Entregável | Status | Evidência |
|---|---|---|---|
| 1 | Action publicada e utilizável | ✅ | github.com/Josepassinato/12brain-quality-gate · tag **v1** · público |
| 2 | Gate rodando em CI real | ✅ | PR #1 · run **27805593166** · GitHub Actions · bloqueou corretamente |
| 3 | E2E integrado | ✅ (stage no runner) | roda com `APP_URL`; sem URL → `skipped` honesto |
| 4 | Cobertura | ✅ (condicional) | ativa se provider instalado; zells não tem → `null` (sem nova arch) |
| 5 | Relatório das 4 CVEs | ✅ | `D3-CVE-REPORT.md` |

## Evidência do run em CI REAL (GitHub Actions)
```
build=true  lint=96  type=0
unit=117/123  cov=null  e2e=skipped
critical=4  high=16  medium=9  semgrep=ausente
[gate] score=64 decision=block blockers=4
## Resultado: BLOCKED   Score: 64/100
::error::Quality Gate bloqueou o merge   (exit 1 → PR bloqueado)
```
Artefatos gerados e baixáveis do run: `quality-score.json` + `VERIFICATION.md`.

## MÉTRICA-CHAVE: paridade Local ↔ CI (reprodutibilidade provada)
| | Local (pós-fix D2) | CI real |
|---|---|---|
| Score | 64 | **64** |
| Pilar Testes | 98 (117/123) | **98 (117/123)** |
| Engenharia | 70 (build ok, lint 96) | **70** |
| Segurança | 0 (4 crit) | **0 (4 crit)** |
| Decisão | block | **block** |
- **O fix de ambiente do D2 segurou no CI** — o pilar Testes deu 98 idêntico (não voltou a contaminar). Confiabilidade confirmada em ambiente real.
- Duração do gate no runner: **~2 min** (04:33→04:35) — bem abaixo da meta de 8 min p95.

## O que funcionou
- Action composite publicada e consumível via `uses: Josepassinato/12brain-quality-gate@v1`.
- Gate rodou ponta a ponta em runner limpo do GitHub e **bloqueou o PR** por motivo legítimo (4 CVEs críticas).
- **Local == CI** (score, pilares, decisão) → score é referência confiável.
- Schema/score/branch-protection/override **inalterados** (restrições respeitadas).

## O que ficou pendente / honesto
- **e2e=skipped**: integrado no runner, mas precisa de `APP_URL` (preview deploy) p/ executar de fato — config, não arquitetura. Fica pra ligar no piloto formal.
- **coverage=null**: zells não tem `@vitest/coverage-v8`; não instalei (evita nova dep/arch). Quando o projeto adicionar o provider, o gate já lê automático.
- **semgrep ausente** no runner do CI: segurança hoje = `npm audit`. Próximo: adicionar step que instala semgrep (skill ToB) no action.
- **5 falhas reais de teste** (Student page) → registradas como follow-up (D2), fora do escopo D3.
- **branch protection** ainda NÃO ativada (decisão sua; o PR ficou bloqueado pelo check, mas o merge não está formalmente travado até ligar a regra).

## Métricas D3
- Action: 1 repo público + tag v1.
- CI: 1 run real, conclusão=failure (block correto), ~2min, artefatos OK.
- Paridade local/CI: 100% (score idêntico).
- CVEs diagnosticadas: 4 (2 risco real prod, 2 dev-only) — sem corrigir (ordem).

## Conclusão
O Quality Gate deixou de ser protótipo: **é um GitHub Action corporativo publicado, reutilizável (`@v1`), validado em CI real, com resultado reprodutível local↔CI.** Pronto pra próxima etapa (semgrep no action + e2e com URL + ativar branch protection + piloto formal).
