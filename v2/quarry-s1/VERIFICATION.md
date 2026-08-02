# Quality Gate V2 — VERIFICATION
Repo: Josepassinato/Security · Commit: 933f5e67 · Profile: **agentic-platform** · Gate: v2.0.0-s1 · 2026-06-19T23:50:42.805Z

## Resultado: PASSED_WITH_WARNINGS   Score: 72/100   (read-only, NÃO bloqueia deploy)

| Pilar | Score | Peso |
|-------|-------|------|
| Engineering   | 100 | w=0.15 |
| Tests         | 100 | w=0.2 |
| Security      |   0 | w=0.25 |
| Agentic       |  87 | w=0.25 |
| Observability | 100 | w=0.15 |

## 🔴 Hard-blockers: nenhum

## 🟡 Warnings
- [SEC] 14 CVE high
- [SEC] 2 critical dev-only (não bloqueia)
- [AGENTIC] tool_misuse: WARN — 1 uso(s) de eval/exec dinâmico (revisar se input não-confiável alcança). SSRF guard presente.
- [SCORE-BAND] score 72 em faixa de ressalva (70–84)

## Agentic (S1: 3 vetores)
- **prompt_injection**: PASS — {"sanitizerFiles":9,"wrappingHits":20,"rawConcatHits":0}
- **tool_misuse**: WARN — {"hardHits":0,"softEvalExec":1,"ssrfGuardFiles":4}
- **runaway_loop**: PASS — {"boundSignals":17,"whileTrueLoops":2}
