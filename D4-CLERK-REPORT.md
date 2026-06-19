# D4 — Relatório de Risco: @clerk/shared (CVE crítica)
**Data:** 2026-06-19 · **Projeto:** zells-academy-portal · **Ação:** classificar (NÃO corrigir nesta fase)

## Identificação
- **Pacote:** `@clerk/shared` · **Severidade (npm/GHSA):** critical · **CVSS:** 8.1
- **CWE:** 863 (Incorrect Authorization), 436 (Interpretation Conflict), 754 (Improper Check)
- **Advisory:** GHSA-vqx2-fgx2-5wq9
- **Vulnerabilidades:** (1) bypass de proteção de rota baseada em middleware; (2) bypass de autorização ao combinar checks de organização/billing/reverification
- **Range vulnerável:** 0.18.0–3.47.5 e linhas canary 4.x até 4.13.1-canary
- **Dependência:** **DIRETA** (Clerk é a camada de auth/identidade do produto)

## 1. Risco real
**ALTO.** É a camada que decide *quem entra e o que pode acessar*. Um bypass de autorização aqui significa que um usuário pode acessar rotas/recursos que deveriam estar protegidos (ex.: área de outra organização, recursos pagos sem billing, ações que exigem reverificação). Impacto direto em **confidencialidade e integridade** dos dados multi-tenant.

## 2. Explorabilidade
**MÉDIA-ALTA.**
- **A favor do atacante:** vetor é a lógica de auth do próprio framework (não precisa de cadeia complexa); afeta combinações comuns (org + billing + reverification) que apps multi-tenant usam.
- **Mitigadores atuais:** depende de o app **realmente combinar** esses checks da forma vulnerável; exige usuário autenticado (não é pré-auth/anônimo na maioria dos cenários); requer conhecer as rotas-alvo.
- **Veredito:** explorável por usuário autenticado mal-intencionado / conta comprometida — cenário realista em SaaS multi-tenant.

## 3. Urgência
**P0 — alta.** Por ser auth + multi-tenant + correção disponível, é o item de maior prioridade entre as 4 CVEs. Não é "world-exploitable anônimo" (o que seria P0-crítico-imediato), mas **deve ser corrigido na próxima janela de deploy**, antes de qualquer rollout ou ativação de branch protection que dependa de zells "verde".

## 4. Estratégia recomendada
1. **Atualizar** `@clerk/clerk-react` + `@clerk/shared` para a versão corrigida (≥ 4.13.x estável) — `fixAvailable=true`.
2. **Validar em staging**: Clerk teve mudanças de major (3.x→4.x) com possíveis breaking changes em middleware/SSR — testar login, proteção de rota, fluxo org/billing.
3. **Revisar o uso no código**: confirmar se o app combina `organization` + `billing`/`reverification` (se sim, risco efetivo confirmado; se não, risco residual menor — mas atualizar mesmo assim).
4. **Defesa em profundidade** (independente do patch): garantir checagem de autorização **no backend/RLS do Supabase**, não só no middleware do front — assim um bypass de front não expõe dados.
5. **Gate:** enquanto não corrigido, o 12brain-quality-gate **continua bloqueando** zells por CRÍTICO (comportamento correto e desejado).

## Resumo executivo
| Dimensão | Classificação |
|---|---|
| Risco real | **ALTO** (auth bypass, multi-tenant) |
| Explorabilidade | **MÉDIA-ALTA** (usuário autenticado) |
| Urgência | **P0** (corrigir na próxima janela) |
| Correção | Disponível (upgrade @clerk/*) |
| Estratégia | Patch + validar staging + RLS no backend como rede de segurança |
