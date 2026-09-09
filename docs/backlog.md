# Backlog — openGym (fonte única)

> Itens futuros, fora do escopo da Etapa 4 (spec `spec_fonte_unica_openGym.md` v1). Registrados para não perder contexto. Prioridade e aceite em alto nível.

## BACKLOG-01 — Guardar `unit` por exercício (kg/lb por exercício)

- **O que é:** hoje o perfil tem `S.unit = kg|lb` único para todos os exercícios (`store/useStore.js:DEF`). Permitir `unit` opcional por exercício, no mesmo espírito de `mode: reps/time/cardio` (`lib/history.js:modeOf`) e flags `bodyweight/side`.
  - Modelo alvo: `S.routines[].ex[].unit?: 'kg'|'lb'` (config da rotina) e `workouts[].entries[].sets[].wUnit?: 'kg'|'lb'` (override pontual por série, se necessário). Ausente = herda `S.unit`.
- **Por que:** 2 exercícios de perna hoje estão em `lb` enquanto o perfil é `kg`. Na Etapa 4 vamos normalizar pontualmente para `kg`, mas o correto a longo prazo é misturar unidades sem migração.
- **Quando:** futuro, após Etapa 4. Não entra na v1 (que normaliza para `kg`).
- **Aceite (alto nível):**
  - Logar `100 lb` em um exercício e `100 kg` em outro, no mesmo perfil `kg` → análise (`GET /api/coach/analysis`) mostra `45 kg` e `100 kg` corretos, e1RM e tonnage separados corretos.
  - Trocar `S.unit` de `kg` para `lb` não altera pesos já marcados com `unit` explícito; só afeta os sem override.
  - Sem `unit` explícito, comportamento idêntico a hoje (herda `S.unit`).
- **Notas técnicas (para dev futuro):**
  - `api/coach.js:buildAnalysis` passa a fazer `wKg = w * (unit==='lb'?0.45359237:1)` por série, não por perfil.
  - `frontend/src/lib/history.js:setLabel` e `frontend/src/views/Workout.jsx` exibem sufixo `kg/lb` por exercício quando diverge do perfil.
  - Migração: script único que escreve `ex.unit` para os 2 exercícios de perna já identificados, sem tocar nos demais.

---

## BACKLOG-02 — Treinador completo (persona Low Volume) dentro do openGym

- **O que é:** trazer as 4 fases do `treino-coach` (Analisar → Entender atualizações com perguntas Fase 2 → Refletir → Planejar) e `mesociclo_ativo.json` para dentro da API (`GET /api/coach/plan`), com persistência em `/data` (`state.coach` ou `coach-<uid>.json`).
- **Por que:** Etapa 4 só espelha análise; planejamento ainda depende do Hermes.
- **Aceite:** gerar microciclo Low Volume (2-3 séries, 5-8 reps, falha por hierarquia) sem Hermes ligado; bloqueio Fase 2 continua via Telegram como hoje.

---

## BACKLOG-03 — `exercise_catalog.json` dentro do repo

- **O que é:** mover `~/.hermes/skills/fitness/treino-coach/references/exercise_catalog.json` (1324 exercícios com `img/gif`) para `frontend/src/lib/exercises-catalog.json` ou `api/exercise_catalog.json`, versionado no repo.
- **Por que:** treinador precisa validar `id` com `img/gif` sem depender do Hermes/HD.
- **Aceite:** `GET /api/coach/analysis` valida `id` sem ler `/home/pi/...`; build copia `img/gif` se necessário.

---

*Criado em 2026-09-09 a partir da Etapa 4 — fonte única. Dono: Emerson. Branch: `emerson-custom`.*
*Nota 2026-09-09: BACKLOG-04 (Import Hevy) removido — já existe no openGym via UI/API.*
