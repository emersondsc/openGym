# Backlog — openGym (fonte única) — Completo para implementação

> Tudo que levantamos e decidimos até 2026-09-23, pronto para revisitar e implementar sem precisar re-descobrir. Cada backlog já traz objetivo, fluxo, contrato, arquivos e critérios no nível de código da spec v4.

## BACKLOG-01 — Guardar `unit` por exercício (kg/lb por exercício)

- **Status:** Futuro, fora da Etapa 4. Normalização pontual `lb→kg` já feita em `api/coach.js` (200 lbs → 90,7 kg para `0585/0599` via `LB_TO_KG`).
- **O que é:** `S.unit = kg|lb` único → `S.routines[].ex[].unit?: 'kg'|'lb'` e `workouts[].entries[].sets[].wUnit?: 'kg'|'lb'` (herda `S.unit` se ausente), como `mode: reps/time/cardio`.
- **Arquivos:** `api/coach.js:buildAnalysis` passa a `wKg = w * (unit==='lb'?0.45359237:1)` **por série**; `frontend/src/lib/history.js:setLabel` e `Workout.jsx` mostram sufixo `kg/lb` quando diverge; `~/.hermes/skills/fitness/treino-coach/references/config_unidades.json` + `api/exercise_catalog.json` como fonte.
- **Migração:** script único que escreve `ex.unit` para os 2 exercícios de perna já identificados (`0585 lever leg extension`, `0599 lever seated leg curl`), sem tocar nos demais.
- **Aceite:** `100 lb` em um exercício + `100 kg` em outro no mesmo perfil `kg` → `GET /api/coach/analysis` mostra `45 kg` e `100 kg` corretos, `e1rm`/`tonnage` separados; trocar `S.unit` não afeta os com `unit` explícito.
- **Refs:** `docs/specs/spec_fonte_unica_openGym.md` v3 + `api/coach.js` + `docs/backlog.md` v3

---

## BACKLOG-02 — Micro: Gerar microciclo da semana via app (app como interface, Hermes como motor) — PRONTO PARA IMPLEMENTAR

- **Status:** Spec v4 detalhada em `docs/specs/spec_micro_meso_via_app.md` (131 linhas, 2026-09-23) + `micro_meso_ux_preview.html` + `spec_micro_meso_via_app.html` em `C:\Users\emerson` na porta 8765. Decisões do usuário incorporadas: `S.dayPlan manda`, `Hermes gera tudo com datas`, `Hermes Pi 8091 atrás do web proxy`, `Idempotency-Key: hex(sha256(uid:meso_id:semana:canonical_hash(answers)))`, `jobs em disco`, `Hermes busca analysis fresco`, `IDs determinísticos`.

- **Objetivo:** trazer a **Fase 2 + planejamento do micro** para o app, mantendo o **Hermes como motor de IA** (mesma persona Low Volume, mesmo LLM `muse-spark-1.2-contributor` via `opencode-go`). O app coleta as respostas e chama o Hermes via HTTP; o Hermes gera o micro e devolve para o app exibir — sem Telegram. O resultado final são **5 novas rotinas `r_*_S(n)` sem apagar `S1..S(n-1)`** e `S.dayPlan` para as datas da próxima semana.

- **Fluxo completo (tático, toda semana, manual via botão):**
  1. **Gatilho no app:** botão manual `Gerar micro S2` em `Plan` (ou `Stats → Plan`), **não** nos cards existentes (`Activity`, `Your progress` permanecem sem nada novo, como pedido). Só habilita após stepper.
  2. **Stepper Fase 2 no app (bloqueante):** 4 perguntas PT-BR com `t()` keys `plan.fase2.motivo_placeholder`, `plan.fase2.dor_*`, `plan.fase2.sono_*`, `plan.fase2.estresse` (opcional), `var(--acc)` check, `canGenerate = motivo_carga.trim().length>=10 && dor!=null && sono!=null` (`estresse` opcional). Sem responder, `POST` não dispara.
  3. **App → Hermes:** `POST https://hermes/api/micro` (ou `POST https://opengym.edsc.fun/api/hermes/micro` que proxyia para `http://hermes:8091` no Pi) com `headers: { "Content-Type":"application/json", "Idempotency-Key": hex(sha256(uid+":"+meso_id+":"+semana+":"+canonicalHash(answers))), "If-Match-Meso": meso_id, "If-Match-State": String(_ts), "Cookie": gymsid }` + `body: {uid, meso_id:"meso-2026-09-08", semana:"S2", _ts, answers_fase2}` + `signal` do `AbortController` (não em `headers["Signal"]`). `canonicalHash` = `JSON.stringify` com keys ordenadas + `trim()`/lower.
  4. **Hermes (motor):** `hermes_api.py` (FastAPI 8091, `workers 2+` com `jobs/{job_id}.json` em disco com `flock` e `expiração 24h` + `cron`, não `BackgroundTasks` por worker) faz: `verify_gymsid` real (lê `SECRET` via `EnvironmentFile=/home/pi/.hermes/hermes.env` gerado por `install -m 600 <(printf "SECRET=%s\n" "$(sudo cat /mnt/.../secret)")` + `LoadCredential`, valida `uid` do payload, expiração em **segundos** e `HMAC` **hex** com `hmac.compare_digest`), valida `answers_fase2` Zod (`motivo_carga` 10..300, `dor` enum, `sono` enum, `estresse` opcional), lê `mesociclo_ativo.json` com `flock` e valida `meso_id` com `If-Match-Meso` (stale → `409 {code:"STALE_MESO", current_meso_id, current_ts}`), busca `GET /api/coach/analysis` **fresco** (ignora `analysis` do body, valida `truncated:false` senão vai para `state:error` com `error:{code:"ANALYSIS_TRUNCATED", retry_with:"?period=30d"}` no polling, nunca `413` síncrono), compara **executado S1 vs planejado S1** (análise dos micros anteriores para progressão/fadiga), aplica persona Low Volume e gera 5 rotinas `r_push_S2_9a3f`, `r_pull_S2_9a3f` etc. com `id = r_${slug}_S${n}_${hash(meso_id+semana+slug).slice(0,4)}` (determinístico, sem `rand4` aleatório, dedup por `id` antes de `PUT`) + `ex[]` com `id` do catálogo + `wKg/r/rir` do meso, e `dayPlan` para as `n_datas = dias.length` datas da próxima semana ancorado em `next_monday` (próxima Segunda após `today` em `ZoneInfo("America/Sao_Paulo")` ou `periodo.inicio + (semana-1)*7d` se `periodo.inicio` for Segunda) com `weekdayOrder = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]` (ISO, Mon=1), sem apagar `S1` (datas diferentes, `409 {code:"DATE_CONFLICT", date, owner:"meso-...:S1"}` se `date` já ocupado por mesmo `meso_id` diferente `semana`). Retorna `202 {job_id, statusUrl, idempotencyKey}` e `GET /api/hermes/micro/status?job_id` poll `200 {state:"queued|running|done|error", phase:"queued|analisando|planejando|persistindo", progress:0-100, result?:{routines, dayPlan, meso_id, report_id:"S2-2026-09-15"}, error?:{code,msg}}` com `Retry-After: 1` e `jobs/{job_id}.json` em disco com `flock` e `expiração 24h`.
  5. **App ← Hermes (polling):** `Plan.jsx` faz `while(status.state!=="done" && !signal.aborted)` com `await new Promise(r=>setTimeout(r,1500))` + `AbortController` no `unmount`, mostra `loading: fase analisando → planejando → persistindo` com `progress` e `Alert`.
  6. **App grava:** após `done`, `GET /api/data` (base), `merged={...state, routines:[...new Map([...state.routines, ...result.routines].map(r=>[r.id,r])).values()], dayPlan:{...state.dayPlan, ...result.dayPlan}, _ts:Date.now()}` + `delete merged.active` só se `!merged.active.workoutId`, `PUT /api/data` com `headers: {"If-Match-State": String(state._ts)}` + `retryWithMerge(max 3, backoff 500ms)` via `store/useStore.js` (mesma lógica de `spec_fonte_unica`), `clearCoachCache()` e `hard-refresh` sugerido. `html_path` **não** vem no `POST` (só `report_id` opaco); `reports/relatorio_S2_2026-09-15.html` fica só no Hermes em `~/.hermes/workout/reports/` com `data-testid="report-reason"` + `data-ex-id` (teste: `doc.querySelector('h1').textContent.includes('Por que S2') && doc.querySelectorAll('[data-ex-id]').length>=3`), acessível só via `GET /api/hermes/reports/{report_id}.html` autenticado.

- **Arquivos que tocam (para revisitar):**
  - App: `frontend/src/views/Plan.jsx` (novo, 150 linhas) + `frontend/src/lib/hermes.js` (novo, 50 linhas) + `frontend/src/store/useStore.js` (já tem `clearCoachCache()`) + `web/nginx.conf` (`location /api/hermes/ { proxy_pass http://127.0.0.1:8091; }` + `location = /api/hermes/health`)
  - Hermes: `~/.hermes/workout/scripts/hermes_api.py` (novo, 220 linhas, FastAPI 8091, `workers 2+`, `jobs/{job_id}.json`, `verify_gymsid` com `HMAC` hex, `ZoneInfo`, `flock`, `SlowAPI` rate-limit 5/min por `gymsid` cookie `HttpOnly=true`, `CORS` só `https://opengym.edsc.fun`), `~/.hermes/skills/fitness/treino-coach/SKILL.md` (FLUXO passo 6 para `POST /api/hermes/micro` com `S.dayPlan` sem sobrescrita), `~/.hermes/skills/fitness/opengym-workout-pipeline/SKILL.md` (Planner integration para `prefere API, fallback HD`), `~/.hermes/workout/scripts/opengym_reader.py` + `process_workout.py` (já são API-only/fallback, manter)
  - Persistência: `S.routines[]` com `r_*_S2_${hash}` + `S.dayPlan` com 5 datas `America/Sao_Paulo` + `S._ts` server-side; `mesociclo_ativo.json` + `plans/historico/meso-...-HHmmss-rand4.json` (10 retenção) + `reports/relatorio_S2.html` (só no Hermes)

- **Critérios (como testar quando revisitar):**
  - [ ] Com `meso-2026-09-08` S1 e 299 sessões, `Gerar micro S2` bloqueado sem `motivo>=10`, libera após 3 respostas, `POST 202` + poll `pronto` + `PUT 200`, `S.routines` tem `S1+S2` (10) sem duplicar em retry (Idempotency-Key com hash de answers), `S.dayPlan` tem `2026-09-08` e `2026-09-15` sem sobrescrita
  - [ ] `POST` sem `gymsid` `401`, sem `answers` `400`, stale `409`, `truncated:true` → `state:error` com `ANALYSIS_TRUNCATED` no polling (não `413` síncrono)
  - [ ] `reports/relatorio_S2.html` com `Por que S2` e `data-ex-id` ≥3, mas `POST` não retorna `html_path` absoluto (só `report_id`)

---

## BACKLOG-03 — Meso: Criar novo mesociclo via app (app como interface, Hermes como motor) — PRONTO PARA IMPLEMENTAR

- **Status:** Spec v4 detalhada em `docs/specs/spec_micro_meso_via_app.md` (131 linhas, 2026-09-23) — mesma base do Micro, mas para meso.

- **Objetivo:** trazer a **criação do mesociclo** (estratégia de 4-8 semanas, 20|25 sessões com `12=checkpoint`) para o app, mantendo o **Hermes como motor**. O app coleta o desejo de evolução e pede ao Hermes para elaborar o novo meso; o Hermes arquiva o meso anterior e cria o novo.

- **Fluxo completo (estratégico, a cada 4-8 semanas):**
  1. Gatilho no app: botão `Criar novo mesociclo` em `Plan` (ou automático quando o meso atual termina: 12 sessões checkpoint ou `performance < -10%` por 2 sessões → deload + arquiva).
  2. App abre **form de objetivo** com `t()` keys: `Foco para os próximos meses?` (ex: `glúteos P1`, `ombro 3D`), `Duração?` (`12|20|25` com `12=checkpoint` e `semanas[2].fase="checkpoint"`), `Dias?` (`["Tue","Wed","Thu","Sat","Sun"]` 3..6, sort por `weekdayOrder`).
  3. App faz `POST https://hermes/api/meso` com `{objetivo, duracao_sessoes, dias, analysis: GET /api/coach/analysis, historico_meso: GET /api/hermes/meso/historico}` + `Idempotency-Key: hex(sha256(uid:objetivo:duracao:hash(dias)))` + `gymsid`.
  4. Hermes valida `regras_globais` (`reps 6-8`, `deload -40% séries`), arquiva `mesociclo_ativo.json` atual em `plans/historico/meso-2026-09-08-142233-a1b2.json` (id único `meso-YYYY-MM-DD-HHmmss-rand4`, retenção 10 via `ls -t | tail -n +11 | xargs rm`), cria novo `mesociclo_ativo.json` com `id: meso-2026-10-07-091500-c3d4`, `periodo`, `objetivo`, `semanas[]` com `fase: calibração→progressão→deload` e `progressao_planejada` calculada pelo LLM (não hardcoded `+2,5-5%`), e retorna `200 {mesociclo}`.
  5. App mostra `Seu novo mesociclo: 12 sessões, foco glúteo, 5x/semana` e já deixa o próximo `Gerar micro S1` liberado (com `meso_id` novo).

- **Arquivos que tocam:**
  - App: `Plan.jsx` (form), `hermes.js` (`postMeso`), `web/nginx.conf`
  - Hermes: `hermes_api.py` (`POST /api/hermes/meso` + `GET /api/hermes/meso/historico`), `treino-coach/SKILL.md` (FLUXO meso), `mesociclo_ativo.json` + `plans/historico/`

- **Critérios:**
  - [ ] Com meso atual `meso-2026-09-08` (12 sessões, foco ombro) e pedido `foco glúteo, 12 sessões` no app → novo `meso-2026-10-07-...` criado com `objetivo: foco glúteo`, `semanas: 12 sessões` (com `checkpoint` em `semanas[2]`), e o micro seguinte (`S1`) já usa o novo meso (não o antigo) — `POST /micro` sem `meso_id` ativo → `400 {code:"NO_MESO"}`, com `meso` ativo e `force:false` → `409 {code:"MESO_ACTIVE"}` a menos que `force:true`
  - [ ] `POST /meso` sem `objetivo` → `400`; sem `gymsid` → `401`; `duracao_sessoes` fora `12|20|25` → `400`

---

## BACKLOG-04 — `exercise_catalog.json` dentro do repo

- **Status:** Já espelhado em `/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json` para `GET /api/coach/analysis` (fonte única), mas ainda não versionado no repo. Quando revisitar, mover `~/.hermes/skills/fitness/treino-coach/references/exercise_catalog.json` (1324) para `frontend/src/lib/exercises-catalog.json` ou `api/exercise_catalog.json` versionado.
- **Aceite:** `GET /api/coach/analysis` valida `id` sem ler `/home/pi/...`; build copia `img/gif` se necessário.

---

*Criado em 2026-09-09 a partir da Etapa 4 — fonte única. Dono: Emerson. Branch: `emerson-custom`.*
*Atualizado 2026-09-23: BACKLOG-02/03 com especificação completa pronta para implementar (app como interface, Hermes como motor) — ponto crítico `meso → micros` com `S.dayPlan` manda, `S1` preservado, e `reports/*.html` só no Hermes como prova de reflexão.*
