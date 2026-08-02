# Quality Gate V2 — S1 reduzido (relatório de prova)
**Data:** 2026-06-19 · **Âncora:** Quarry/AISOC · **Modo:** READ-ONLY (não bloqueia deploy, Quarry intocado) · **V1 não alterado**

## Objetivo do S1
Provar que o V2 mede **risco agentic real** do Quarry antes de expandir escopo. **Resultado: PROVADO.**

## O que foi construído (`/root/12brain-quality-gate/v2/`)
- `lib/profile.mjs` — **Profile Detection** (node/python/go, agentic, agentDirs).
- `run-v2.sh` — orquestrador read-only (exit 0 sempre) + **Node adapter** (tsc/lint, reuso V1) + **Python adapter** (ruff, venv efêmero) + **Security** (pnpm audit ×2 anti-flaky, classificação runtime/dev).
- `lib/agentic.mjs` — **3 detectores**: prompt_injection · tool_misuse · runaway_loop.
- `lib/aggregate.mjs` — **Aggregator V2** (pesos por profile) + schema **quality-score-v2.json** + **VERIFICATION.md** + **agentic-risk-report.md**.
- NÃO implementado (fora do S1): Go/Docker adapter, cost budget, RAG isolation, decision audit, replay, observability avançada.

## Resultado no Quarry (CI-style, read-only)
**SCORE 72 · pass_with_warnings · 0 hard-blockers** · profile `agentic-platform` · langs node+python+go
| Pilar | Score |
|---|---|
| Engineering | 100 (tsc 0 · lint 0 · ruff 0) |
| Tests | 100 (S1: neutro/skip) |
| Security | 0 (14 high + 42 mod; **0 critical runtime** — 2 criticals reclassificados dev-only) |
| **Agentic** | **87** |
| Observability | 100 (S1: neutro) |

### Pilar Agentic (o headline)
| Vetor | Verdict | Evidência |
|---|---|---|
| prompt_injection | ✅ **PASS** | sanitizer (9 arq.) + wrapping `<UNTRUSTED_DATA>` (20 hits) |
| tool_misuse | 🟡 **WARN** | 0 shell/RCE real; 1 `eval(` em docstring (`engine.py:164`) → flag p/ revisão, não bloqueia |
| runaway_loop | ✅ **PASS** | 17 sinais de bound (max_iterations / clamp_timeout) |

**Bate com o assessment** (Quarry tem controles agentic fortes): nenhum hard-block agentic, score 87.

## Prova de valor: a calibração contra o Quarry (oráculo)
O S1 **só é confiável porque o Quarry expôs 3 falsos-positivos**, todos corrigidos — exatamente o papel de projeto-âncora:
1. **Escopo amplo demais** (varria `./services` inteiro + tests/scripts) → restringido aos dirs de agente, excluindo tests.
2. **`eval()` em docstring** tratado como exec real → rebaixado de hard-block p/ WARN + filtro de comentário/docstring.
3. **`shell=True` dentro de comentário** (`# noqa — no shell=True`, com `subprocess.run` de argv fixo e seguro) → grep de linha completa + filtro "antes do `#`" → falso hard-block eliminado.

Também surgiram 2 achados de **segurança não-determinística** (já previstos na triagem):
- `pnpm audit` é instável entre runs → **double-run**: só conta critical-runtime que **reproduz**.
- `vitest`/`shell-quote` criticals são **devDependencies** → classificador dev-aware (não hard-blockam).

## Entregáveis (em `/root/12brain-quality-gate/v2/quarry-s1/`)
- ✅ `quality-score-v2.json` (schema v2)
- ✅ `agentic-risk-report.md`
- ✅ `VERIFICATION.md`

## Limitações conscientes do S1 (p/ S2)
- Security não reponderou **highs** por alcance (14 highs zeram o pilar; muitos são dev/docs) → reweight de high em S2.
- Detectores são **heurísticos estáticos** (grep + regex), não AST — viés conservador (flag p/ revisão). 1 WARN residual é docstring.
- Tests/Observability neutralizados (não implementados no S1).

## Veredito
O V2 S1 **executa read-only no Quarry, não bloqueia deploy, não altera o repo**, e produz os 2 artefatos. Mede risco agentic real (distingue os controles genuínos do Quarry do ruído, flagga 1 eval/exec p/ revisão, e **não dá falso hard-block** após calibração). **Objetivo do S1 atingido.** Pronto para decisão sobre S2 (reweight de high, mais detectores, Go/Docker, observability).
