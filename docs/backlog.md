# Backlog — openGym (fonte única)

> Itens futuros, fora do escopo da Etapa 4 (spec `spec_fonte_unica_openGym.md` v3). Registrados para não perder contexto. Prioridade e aceite em alto nível.

## BACKLOG-01 — Guardar `unit` por exercício (kg/lb por exercício)

- **O que é:** hoje o perfil tem `S.unit = kg|lb` único para todos os exercícios (`store/useStore.js:DEF`). Permitir `unit` opcional por exercício, no mesmo espírito de `mode: reps/time/cardio` (`lib/history.js:modeOf`) e flags `bodyweight/side`.
  - Modelo alvo: `S.routines[].ex[].unit?: 'kg'|'lb'` (config da rotina) e `workouts[].entries[].sets[].wUnit?: 'kg'|'lb'` (override pontual por série, se necessário). Ausente = herda `S.unit`.
- **Por que:** 2 exercícios de perna hoje estão em `lb` enquanto o perfil é `kg`. Na Etapa 4 vamos normalizar pontualmente para `kg`, mas o correto a longo prazo é misturar unidades sem migração.
- **Quando:** futuro, após Etapa 4. Não entra na v3 (que normaliza para `kg`).
- **Aceite (alto nível):**
  - Logar `100 lb` em um exercício e `100 kg` em outro, no mesmo perfil `kg` → análise (`GET /api/coach/analysis`) mostra `45 kg` e `100 kg` corretos, e1RM e tonnage separados corretos.
  - Trocar `S.unit` de `kg` para `lb` não altera pesos já marcados com `unit` explícito; só afeta os sem override.
  - Sem `unit` explícito, comportamento idêntico a hoje (herda `S.unit`).
- **Notas técnicas (para dev futuro):**
  - `api/coach.js:buildAnalysis` passa a fazer `wKg = w * (unit==='lb'?0.45359237:1)` por série, não por perfil.
  - `frontend/src/lib/history.js:setLabel` e `frontend/src/views/Workout.jsx` exibem sufixo `kg/lb` por exercício quando diverge do perfil.
  - Migração: script único que escreve `ex.unit` para os 2 exercícios de perna já identificados, sem tocar nos demais.

---

## BACKLOG-02 — Micro: Gerar microciclo da semana via app (app como interface, Hermes como motor)

- **O que é:** trazer a interação da **Fase 2 + planejamento do micro** para dentro do app, mantendo o **Hermes como motor de IA** (mesma persona Low Volume, mesmo LLM `muse-spark-1.2-contributor` via `opencode-go`). O app coleta as respostas e chama o Hermes via HTTP; o Hermes gera o micro e devolve para o app exibir — sem Telegram.
- **Fluxo (tático, toda semana):**
  1. Gatilho no app: ao fechar o último treino da semana (ex: `Dom Legs2`) ou botão `Gerar micro da próxima semana` em `Stats → Your progress` / `Plan`.
  2. App abre **stepper nativo da Fase 2** (3-4 perguntas em PT-BR, com bloqueio até responder): `Por que reduziu carga em X?` `Dor?` `Sono/estresse?`
  3. App faz `POST https://hermes/api/micro` (ou `POST https://opengym.edsc.fun/api/hermes/micro` que proxyia para o Hermes) com `{type:"micro", meso_id, semana, analysis: GET /api/coach/analysis, answers_fase2}` + `gymsid` forjado.
  4. Hermes lê `mesociclo_ativo.json` (verdade), confere `semana N` (`fase`, `progressao_planejada`), compara **executado vs planejado** da semana anterior (análise dos micros anteriores para progressão/fadiga), aplica persona Low Volume e gera `reports/relatorio_semanaN.md` + atualiza `semanas[N].status/log_atualizacao` no `mesociclo_ativo.json`.
  5. App faz `GET /api/hermes/micro` (polling até `status: done`) e renderiza o micro ali mesmo, já gravando `routines` via `PUT /api/data` (sync já existente).
- **Por que:** hoje esse fluxo é 100% no Telegram (você pede análise, responde perguntas lá, recebe e-mail). Levar para o app remove o Telegram do caminho crítico, mas mantém o motor que já funciona.
- **Aceite (alto nível):**
  - Com `mesociclo_ativo.json` com 12 sessões e `analysis` com 299 sessões, pedir `Gerar micro semana 3` no app → em <30s aparece o micro da semana 3 (2-3 séries, 6-8 reps, hierarquia de falha) derivado da `semana 3` do meso + análise dos micros anteriores, sem precisar abrir Telegram.
  - Sem responder o stepper, o botão `Gerar` fica bloqueado (mesma regra `BLOQUEIO SE NÃO RESPONDER` da skill).
  - Se a API do Hermes estiver fora, o app mostra `Hermes indisponível — tente novamente` (sem cair para HD).
- **Notas técnicas:**
  - Novo endpoint no Hermes: `POST /api/hermes/micro` (no `gateway` ou `hermes_api.py` em `/home/pi/.hermes/workout/scripts/`) que recebe `gymsid` + `answers` e dispara o subagente treinador (mesmo que hoje, mas com `analysis` vindo de `GET /api/coach/analysis` em `http://localhost:8081` em vez de `opengym_reader.py` HD).
  - Frontend: novo `Plan.jsx` ou seção em `Stats` com stepper + polling.

---

## BACKLOG-03 — Meso: Criar novo mesociclo via app (app como interface, Hermes como motor)

- **O que é:** trazer a **criação do mesociclo** (estratégia de 4-8 semanas) para dentro do app, mantendo o **Hermes como motor**. O app coleta o desejo de evolução do usuário e pede ao Hermes para elaborar o novo meso; o Hermes arquiva o meso anterior e cria o novo.
- **Fluxo (estratégico, a cada 4-8 semanas):**
  1. Gatilho no app: botão `Criar novo mesociclo` em `Plan → Mesociclo` (ou automático quando o meso atual termina: 12 sessões cumpridas ou `performance < -10%` por 2 sessões → deload + arquiva).
  2. App abre **form de objetivo** (não é Fase 2): `Foco para os próximos meses?` (ex: `glúteos P1`, `ombro 3D sem carga axial`), `Duração?` (4/6/8 semanas / 12/16/20 sessões), `Dias disponíveis?` (Ter/Qua/Qui/Sáb/Dom).
  3. App faz `POST https://hermes/api/meso` com `{type:"meso", objetivo, duracao_sessoes, analysis: GET /api/coach/analysis, historico_meso: GET /api/hermes/meso/historico}`.
  4. Hermes arquiva `mesociclo_ativo.json` atual em `plans/historico/meso-2026-09-08.json`, cria novo `mesociclo_ativo.json` com `id: meso-2026-10-07`, `periodo`, `objetivo`, `regras_globais` (`reps 6-8`, `Low Volume`), `semanas[]` com `fase: calibração → progressão → deload` e `progressao_planejada: +2,5-5%` por exercício, e devolve para o app.
  5. App mostra `Seu novo mesociclo: 12 sessões, foco glúteo, 5x/semana` e já deixa o próximo `Gerar micro semana 1` liberado.
- **Por que:** hoje o meso é elaborado sob seus desejos de evolução para os próximos meses (ex: `foco glúteo` desde 09/08) via conversa no Telegram. Levar para o app torna o desejo explícito em form e desacopla do Telegram, mas mantém a lógica crítica `meso → micros` (todo micro lê o `meso_id` ativo; sem meso ativo, `POST /micro` falha).
- **Aceite (alto nível):**
  - Com meso atual `meso-2026-09-08` (12 sessões, foco ombro) e pedido `foco glúteo, 6 semanas` no app → novo `meso-2026-10-07` criado com `objetivo: foco glúteo`, `semanas: 12 sessões`, `foco` refletido nos `ex` escolhidos, e o micro seguinte (`semana 1`) já usa o novo meso (não o antigo).
  - Se tentar `Gerar micro` sem meso ativo, o app mostra `Crie um mesociclo primeiro` (regra `mesociclo_ativo.json` é leitura obrigatória).
- **Notas técnicas:**
  - Novo endpoint no Hermes: `POST /api/hermes/meso` (mesmo serviço do micro) que recebe `objetivo` + `analysis` e subagente treinador gera o meso (mesma persona, mas com prompt de estratégia, não tática).
  - Frontend: nova view `MesoForm.jsx` em `Plan` com os 3 campos + preview do meso atual.

---

## BACKLOG-04 — `exercise_catalog.json` dentro do repo

- **O que é:** mover `~/.hermes/skills/fitness/treino-coach/references/exercise_catalog.json` (1324 exercícios com `img/gif`) para `frontend/src/lib/exercises-catalog.json` ou `api/exercise_catalog.json`, versionado no repo.
- **Por que:** treinador precisa validar `id` com `img/gif` sem depender do Hermes/HD. Já espelhado em `/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json` para `GET /api/coach/analysis` (fonte única), mas ainda não versionado no repo.
- **Aceite:** `GET /api/coach/analysis` valida `id` sem ler `/home/pi/...`; build copia `img/gif` se necessário.

---

*Criado em 2026-09-09 a partir da Etapa 4 — fonte única. Dono: Emerson. Branch: `emerson-custom`.*
*Atualizado 2026-09-22: BACKLOG-02/03 desmembrados em Micro/Meso via app (app como interface, Hermes como motor) — cobertura do ponto crítico `meso → micros`.*
