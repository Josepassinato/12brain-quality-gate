# 12brain-quality-gate (V1)

Quality Gate corporativo da 12Brain. **Consolida** componentes existentes (template CI Zells,
skills Trail of Bits, impeccable) num único GitHub Action reutilizável. NÃO é arquitetura nova.

## Uso (GitHub Actions)
```yaml
- uses: 12brain/quality-gate@v1
  with: { project_type: node, app_url: "https://preview.exemplo.com" }
```

## Uso local
```bash
scripts/run-gate.sh <targetDir> .gate <repo> <sha> <pr>
# gera .gate/quality-score.json + .gate/VERIFICATION.md
```

## Contratos CONGELADOS (2026-06-18)
- Score: Eng20/Test25/Sec30/UX15/Perf10 · ≥85 pass · 70-84 ressalva · <70 block
- Schema `quality-score.json` schemaVersion=1 · template `VERIFICATION.md`
- Override: bloqueio duro (CRÍTICO seg/build/e2e) · break-glass só admin
- Recalibração: só no D8.

## Estágios V1
1. Engenharia: build + lint + typecheck
2. Testes: vitest (e2e Playwright = D2; coverage = D2)
3. Segurança: npm audit + semgrep ToB (D3)
4. UX: impeccable + RULES (D4)
