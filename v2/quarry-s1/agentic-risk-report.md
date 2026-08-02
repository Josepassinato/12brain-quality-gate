# Agentic Risk Report — Josepassinato/Security
**Profile:** agentic-platform · **Gate:** v2.0.0-s1 · **2026-06-19T23:50:42.805Z** · **Modo:** read-only
**Agentes detectados:** 18 arquivo(s) · dirs: ./services/agents, ./services/api/app/core, ./services/api/app/api/v1/endpoints, ./services/api/app/models

## Resumo
- **Agentic pillar score:** 87/100
- **Hard-blocks agentic:** nenhum

## Vetores (S1)
### 🟢 prompt_injection — **PASS**
- **Avaliação:** Sanitizer presente (9 arquivo(s)) + wrapping de input não-confiável (<UNTRUSTED_DATA>).
- **Contadores:** {"sanitizerFiles":9,"wrappingHits":20,"rawConcatHits":0}
- **Evidência:**
  - `./services/agents/app/investigator/forensic_agent.py:67` UNTRUSTED_DATA
  - `./services/agents/app/investigator/recon_agent.py:66` UNTRUSTED_DATA
  - `./services/agents/app/investigator/report_writer_agent.py:58` UNTRUSTED_DATA
  - `./services/agents/app/investigator/prompt_sanitizer.py:21` UNTRUSTED_DATA

### 🟡 tool_misuse — **WARN**
- **Avaliação:** 1 uso(s) de eval/exec dinâmico (revisar se input não-confiável alcança). SSRF guard presente.
- **Contadores:** {"hardHits":0,"softEvalExec":1,"ssrfGuardFiles":4}
- **Evidência:**
  - `./services/agents/app/playbook/engine.py:164` eval(

### 🟢 runaway_loop — **PASS**
- **Avaliação:** Bounds de loop/timeout presentes (17 sinal(is): max_iterations/recursion_limit/timeout clamp).
- **Contadores:** {"boundSignals":17,"whileTrueLoops":2}
- **Evidência:**
  - `./services/agents/app/playbook/models.py:13` ABSOLUTE_MAX_TIMEOUT
  - `./services/agents/app/playbook/models.py:88` clamp_timeout
  - `./services/agents/app/playbook/models.py:93` ABSOLUTE_MAX_TIMEOUT
  - `./services/agents/app/playbook/bounds.py:23` clamp_timeout

## Não avaliado nesta fase (S1)
Cost budget · RAG isolation · decision audit · context leakage · permission escalation · model fallback · observability avançada. (Ver QUALITY-GATE-V2-SPEC.md.)
