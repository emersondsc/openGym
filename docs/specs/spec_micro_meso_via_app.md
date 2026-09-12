# Spec: Micro e Meso via app — app como interface, Hermes como motor — v4 detalhada

## Contexto e Objetivo

O openGym já é fonte única da análise (`GET /api/coach/analysis` em `api/coach.js` com `exercise_catalog.json`, `n_sets 5917` idêntico ao Hermes, `period` com `America/Sao_Paulo`, sem Sheets/e-mail/CSV) e mostra em `Stats → Your progress` em inglês logo abaixo de `Activity` (com `0585 → lever leg extension` corrigido, sem Volume). O `opengym_reader.py` e `process_workout.py` no Hermes já preferem `GET /api/coach/analysis` (com `gymsid` forjado, `http://localhost:8081` primeiro) e só caem para HD se a API falhar. O `process_workout.py` agora é API-only com `process_workout_legacy.py` backup.

Falta trazer a **interação** do treinador para o app, mantendo o **Hermes como motor de IA** (mesma persona Low Volume, mesmo LLM `muse-spark-1.2-contributor` via `opencode-go` em `~/.hermes/config.yaml`). Hoje o usuário pede análise no Telegram, responde Fase 2 lá e recebe relatório por e-mail — quer levar tudo para o app e só usar o Hermes como quem chama o LLM e grava `mesociclo_ativo.json`/`reports/*.html`.

Objetivo desta v4 (com decisões 2026-09-22 — S.dayPlan manda, Hermes gera tudo, Hermes Pi 8091 atrás do web proxy — e 2026-09-23 — idempotência com hash de answers, jobs em disco, Hermes busca analysis fresco, IDs determinísticos):
- **Micro via app:** botão manual `Gerar micro S(n)` em `Plan` abre stepper Fase 2 no app (bloqueante com Zod `motivo_carga>=10`, `dor`/`sono` enums, `estresse` opcional), chama `POST /api/hermes/micro` no Hermes com `Idempotency-Key: hex(sha256(uid:meso_id:semana:canonical_hash(answers)))` + `If-Match-Meso: meso_id` e `If-Match-State: _ts`, Hermes com `flock` lê `mesociclo_ativo.json` + `GET /api/coach/analysis` fresco (ignora `analysis` do body, valida `truncated:false`), gera 5 novas rotinas `r_${slug}_S${n}_${hash(meso_id+semana+slug).slice(0,4)}` sem apagar `S1..S(n-1)` e aloca em `S.dayPlan` para as datas da próxima semana (America/Sao_Paulo, `next_monday` após `today` ou `periodo.inicio + (semana-1)*7d`, com `dias.length` rotinas, não fixo 5), retorna `202 {job_id, statusUrl}` com `jobs/{job_id}.json` em disco (workers 2+ com flock, não BackgroundTasks por worker), app faz polling `GET /api/hermes/micro/status?job_id` até `done` (`state: queued|running|done|error`, `phase: analisando|planejando|persistindo`, `progress:0-100`, `Retry-After:1`) e depois `PUT /api/data` com merge por `id`/`date` e `clearCoachCache()`; Hermes também gera `reports/relatorio_Sn.html` com `data-testid` mas não envia para o app (só `report_id` opaco via `GET /api/hermes/reports/{id}.html` separado).
- **Meso via app:** botão `Criar novo mesociclo` em `Plan` abre form de objetivo (`foco`, `duracao_sessoes 20|25` com `12=checkpoint`, `dias` 3..6), chama `POST /api/hermes/meso` com `Idempotency-Key` similar, Hermes arquiva `mesociclo_ativo.json` em `plans/historico/meso-...-HHmmss-rand4.json` (retenção 10) e cria novo `mesociclo_ativo.json` com `semanas[]` e `progressao_planejada` calculada pelo LLM, retorna `200 {mesociclo}`.

Onde vive: **app** `/mnt/drivebackup/apps/openGym/openGym` (`emerson-custom`, React Vite + Node `api`) + **Hermes** `~/.hermes/skills/fitness/treino-coach/SKILL.md`, `~/.hermes/skills/fitness/opengym-workout-pipeline/SKILL.md`, `~/.hermes/workout/scripts/{opengym_reader.py, process_workout.py, hermes_api.py}`, `~/.hermes/workout/plans/mesociclo_ativo.json`, `~/.hermes/workout/reports/`.

## Escopo

- Inclui:
  - **App frontend:** view `Plan.jsx` (150 linhas) + `hermes.js` (50 linhas) com `Idempotency-Key`, `If-Match-Meso`/`If-Match-State`, `AbortController`, `retryWithMerge(max 3)`, `t()` keys, `var(--acc)`; `PUT /api/data` com `If-Match` e `409` retry.
  - **Hermes skills:** atualizar `treino-coach/SKILL.md` e `opengym-workout-pipeline/SKILL.md` para `S.dayPlan manda` (leitura canônica `dayPlan[YYYY-MM-DD] ?? (isWithinMeso(date) ? week[weekday] : null)`, `S.week` congelado como fallback, `dayPlan` TTL 14 dias (janela de leitura, não deleção), `PUT` recusa `date < today` (não `today-1`) só para criação com `409 DATE_CONFLICT`, GC rotina sem refs por 30 dias arquivada em `/data/gc/*.json`) e `hermes_api.py` como novo ponto de entrada.
  - **Hermes scripts:** novo `hermes_api.py` (FastAPI 8091, `workers 2+` com `jobs/{job_id}.json` em disco com `flock` e `expiração 24h` + `cron find jobs -mtime +1 -delete`, `rate-limit 5/min por gymsid` via `SlowAPI` com `key_func` por `gymsid` cookie `HttpOnly=true, Secure, SameSite=Lax, Domain=.edsc.fun` (frontend nunca lê cookie, Hermes repassa via `Cookie` header server-side), `CORS` só `https://opengym.edsc.fun` (localhost só em `HERMES_ENV=development`), `healthcheck GET /api/hermes/health → {"ok":true}` sem auth, `verify_gymsid` real lendo `SECRET` via `EnvironmentFile=/home/pi/.hermes/hermes.env` gerado por `install -m 600 <(printf "SECRET=%s\n" "$(sudo cat /mnt/.../secret)")` + `LoadCredential`, validando `uid` do payload, expiração em **segundos** e `HMAC` **hex** com teste unitário e `hmac.compare_digest`).
  - **Persistência:** `mesociclo_ativo.json` com `id = meso-YYYY-MM-DD-HHmmss-rand4` + `plans/historico/${id}.json` (10 retenção via `ls -t | tail -n +11 | xargs rm`) + `reports/relatorio_Sn.html` (só no Hermes, com `data-testid="report-reason"` + `data-ex-id`, `h1 Por que S2`, `p hérnia`); `S.routines[]` com `id = r_${slug}_S${n}_${hash(meso_id+semana+slug).slice(0,4)}` (determinístico, sem `rand4` aleatório, dedup por `id` antes de `PUT`) + `S.dayPlan` com `n_datas = dias.length` (não fixo 5) + `S._ts` server-side (`time.time()*1000` de `GET /api/data`).
- Não inclui:
  - Mover o treinador completo para Node (`api/coach.js` com LLM) — Hermes continua sendo o motor.
  - `exercise_catalog.json` dentro do repo (BACKLOG-04) — já espelhado em `api/exercise_catalog.json`.
  - `unit` por exercício (BACKLOG-01) — `hermes_api.py` inclui leitura de `references/config_unidades.json` para emitir `w` na unidade canônica (`kg`).

## Requisitos Funcionais

RF-1. **Micro cria rotinas novas sem apagar e Hermes gera tudo com datas e idempotência correta** — `POST /api/hermes/micro` com `Idempotency-Key: hex(sha256(uid:meso_id:semana:canonical_hash(answers)))` onde `canonical_hash` = `JSON.stringify` com keys ordenadas + `trim()`/lower, + `If-Match-Meso: meso_id` + `If-Match-State: _ts` + `gymsid` Cookie (`HttpOnly=true`) deve: validar `answers_fase2` Zod (`motivo_carga` 10..300, `dor` enum, `sono` enum, `estresse` opcional), ler `mesociclo_ativo.json` com `flock`, validar `meso_id` (stale → `409 {code:"STALE_MESO", current_meso_id, current_ts}`), buscar `GET /api/coach/analysis` fresco (ignora `analysis` do body, valida `truncated:false` senão vai para `state:error` com `error:{code:"ANALYSIS_TRUNCATED", retry_with:"?period=30d"}` no polling, nunca `413` síncrono), gerar `n_datas = dias.length` rotinas `r_push_S2_9a3f` etc. com `hash(meso_id+semana+slug).slice(0,4)` (determinístico), e `dayPlan` para as `n_datas` datas da próxima semana ancorado em `next_monday` (próxima Segunda após `today` em `ZoneInfo("America/Sao_Paulo")` ou `periodo.inicio + (semana-1)*7d` se `periodo.inicio` for Segunda) com `weekdayOrder = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]` (ISO, Mon=1), sem apagar `S1` (datas diferentes, `409 {code:"DATE_CONFLICT", date, owner:"meso-...:S1"}` se `date` já ocupado por mesmo `meso_id` diferente `semana`). Retorna `202 {job_id, statusUrl, idempotencyKey}` e `GET /api/hermes/micro/status?job_id` poll `200 {state:"queued|running|done|error", phase:"queued|analisando|planejando|persistindo", progress:0-100, result?:{routines, dayPlan, meso_id, report_id:"S2-2026-09-15"}, error?:{code,msg}}` com `Retry-After: 1` e `jobs/{job_id}.json` em disco com `flock` e `expiração 24h` + `cron`. App dedup `S.routines` por `id` antes de `PUT` e usa `If-Match-State` com `409` retry.

RF-2. **Stepper Fase 2 bloqueante com schema único** — `Plan.jsx` stepper com `t()` keys `plan.fase2.motivo_placeholder`, `plan.fase2.dor_*`, `plan.fase2.sono_*`, `plan.fase2.estresse`; `canGenerate = motivo_carga.trim().length>=10 && dor!=null && sono!=null` (`estresse` opcional); `POST` sem `answers` → `400 {code:"MISSING_ANSWERS"}` com Zod `z.object({motivo_carga: z.string().trim().min(10).max(300), dor: z.enum(["nenhuma","ombro","lombar","cotovelo","outra"]), sono: z.enum(["bem","regular","ruim"]), estresse: z.enum(["baixo","medio","alto"]).optional() })`; `400` mapeado para `Alert` "Responda dor e sono".

RF-3. **Meso cria novo meso com duração correta** — `POST /api/hermes/meso` com `{objetivo, duracao_sessoes:12|20|25 (12=checkpoint com semanas[2].fase="checkpoint", não fim), dias:["Tue","Wed","Thu","Sat","Sun"] (3..6, sort por weekdayOrder)}` deve: validar `regras_globais` (`reps 6-8`, `deload -40% séries`), arquivar `mesociclo_ativo.json` atual em `plans/historico/meso-...-HHmmss-rand4.json`, criar novo `mesociclo_ativo.json` com `id: meso-2026-10-07-091500-c3d4`, `periodo`, `objetivo`, `semanas[]` com `progressao_planejada` calculada pelo LLM (não hardcoded), e retornar `200 {mesociclo}`. `POST /micro` sem `meso_id` ativo → `400 {code:"NO_MESO"}`; com `meso` ativo e `force:false` → `409 {code:"MESO_ACTIVE", current_meso_id}` a menos que `force:true`; GC retenção 10 via `hermes_api.py` após `archive`.

RF-4. **HTML só no Hermes com teste mensurável** — `hermes_api.py` chama `md_to_html.py` unificado para `reports/relatorio_S2_2026-09-15.html` com `h1 Por que S2`, `ul` com `data-ex-id` + `antes→depois` + `motivo ancorado em analysis`, `p hérnia`; teste: `doc.querySelector('h1').textContent.includes('Por que S2') && doc.querySelectorAll('[data-ex-id]').length>=3`; `POST` para o app **não inclui** `html_path` absoluto, só `report_id`; `GET /api/hermes/reports/{report_id}.html` separado, autenticado, nunca no `POST`.

RF-5. **Infra e segurança** — `hermes_api.py` em `127.0.0.1:8091` via `systemd` com `EnvironmentFile=/home/pi/.hermes/hermes.env` (gerado por `ExecStartPre=install -m 600 <(printf "SECRET=%s\n" "$(sudo cat /mnt/drivebackup/apps/openGym/data/secret)") /home/pi/.hermes/hermes.env`), `web/nginx.conf` `location /api/hermes/ { proxy_pass http://127.0.0.1:8091; proxy_set_header Host $host; proxy_http_version 1.1; }` + `location = /api/hermes/health { proxy_pass ... }`, `healthcheck GET /api/hermes/health → {"ok":true}` sem auth, `SECRET` nunca logado, `gymsid` `HttpOnly=true, Secure, SameSite=Lax, Domain=.edsc.fun, Path=/, Max-Age=30d`, frontend nunca lê cookie (Hermes repassa via `Cookie` header server-side), `rate-limit 5/min por gymsid` via `SlowAPI` com `key_func` por cookie, `CORS` só `https://opengym.edsc.fun` (localhost só em `HERMES_ENV=development`), `log` sem `answers` PII (hash).

## Detalhe de Implementação (nível código)

### 1. `frontend/src/views/Plan.jsx` (novo, 150 linhas) + `frontend/src/lib/hermes.js` (novo, 50 linhas)

```js
// hermes.js
import { api } from './api.js';
function canonicalHash(obj){ return hex(sha256(JSON.stringify(obj, Object.keys(obj).sort()))); }
export const postMicro = (payload, {signal}={}) => {
  const key = hex(sha256(payload.uid+":"+payload.meso_id+":"+payload.semana+":"+canonicalHash(payload.answers_fase2)));
  return api('/api/hermes/micro', {method:'POST', headers:{"Content-Type":"application/json","Idempotency-Key":key,"If-Match-Meso":payload.meso_id,"If-Match-State":String(payload._ts)}, body:JSON.stringify(payload), signal});
};
export const getMicroStatus = (job_id) => api(`/api/hermes/micro/status?job_id=${job_id}`);
export const postMeso = (payload) => api('/api/hermes/meso', {method:'POST', body:JSON.stringify(payload)});
```

**Plan.jsx — esqueleto com stepper + polling + PUT dedup:**
```jsx
const [answers,setAnswers]=useState({motivo_carga:"",dor:null,sono:null});
const canGenerate = answers.motivo_carga.trim().length>=10 && answers.dor && answers.sono;
const onMicro = async()=>{
  const {state}=await api('/api/data');
  const job=await postMicro({uid: state.uid, meso_id: meso.id, semana:"S2", _ts:state._ts, answers_fase2:answers}, {signal: controller.signal});
  let status; do{ await new Promise(r=>setTimeout(r,1500)); status=await getMicroStatus(job.job_id); }while(status.state!=="done" && status.state!=="error");
  const merged={...state, routines:[...new Map([...state.routines, ...status.result.routines].map(r=>[r.id,r])).values()], dayPlan:{...state.dayPlan, ...status.result.dayPlan}, _ts:Date.now()}; delete merged.active;
  await api('/api/data',{method:'PUT', body:JSON.stringify({state:merged}), headers:{"If-Match": String(state._ts)}});
};
```

### 2. `~/.hermes/workout/scripts/hermes_api.py` (novo, 220 linhas, workers 2+, jobs em disco, verify_gymsid com HMAC hex, ZoneInfo, flock)

```python
import hmac, hashlib, base64, time
SECRET=open("/home/pi/.hermes/hermes.env").read().split("=")[1].strip()
def verify_gymsid(token, uid):
    try:
        payload, mac = token.rsplit(".",1)
        puid, exp, sv = payload.split(":")
        if puid != uid: return False
        if int(exp) < int(time.time()): return False
        expect = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(mac, expect)
    except: return False
```

Systemd `hermes-api.service` + `web/nginx.conf` diff como em RF-5.

### 3. `~/.hermes/skills/fitness/treino-coach/SKILL.md` — atualizar FLUXO passo 6 para POST /api/hermes/micro com S.dayPlan sem sobrescrita e reports/*.html só no Hermes.

### 4. `frontend/src/store/useStore.js` — já tem clearCoachCache(); Plan.jsx após PUT também chama.

## Comportamento Visual/UX

### Plan — Gerar micro S2
```
┌─ Gerar micro S2 ──────────────────────────┐
│ Semana S2 do meso meso-2026-09-08         │
│ Por que reduziu carga em Desenv 120→110?  │
│ [motivo_carga ________] (10..300 chars)    │
│ Dor? [nenhuma ▼]  Sono? [bem ▼]           │
│ [Gerar micro S2] ← desabilitado até 3 OK  │
│ loading: fase analisando → planejando     │
└───────────────────────────────────────────┘
```

### Plan — done
```
┌─ Micro S2 criado ✅ ──────────────────────┐
│ 5 novas rotinas: Push S2, Pull S2...      │
│ Alocadas em 2026-09-15 → 2026-09-19        │
│ em S.dayPlan (S1 permanece)               │
│ [Ver no Library]                          │
└───────────────────────────────────────────┘
```

## Persistência e Dados

- App /data: S.routines[] com r_*_S2_${hash} + S.dayPlan com 5 datas America/Sao_Paulo + S._ts server-side
- Hermes: mesociclo_ativo.json + plans/historico/meso-...-HHmmss-rand4.json + reports/relatorio_S2.html (só no Hermes)

## Casos de Borda

- truncated:true → state:error com retry ?period=30d
- POST sem meso → 400 NO_MESO; stale → 409 STALE_MESO
- Duplo clique → idempotência via jobs/{job_id}.json com flock

## Critérios de Aceite

- [ ] Gerar micro S2 bloqueado sem motivo>=10, libera após 3 respostas, POST 202 + poll pronto + PUT 200, S.routines com S1+S2 sem duplicar em retry
- [ ] POST sem gymsid 401, sem answers 400, stale 409
- [ ] reports/relatorio_S2.html com Por que S2 e data-ex-id ≥3, mas POST não retorna html_path
```


---

> **Atualização de 11/09/2026:** o catálogo de exercícios deixou de ser
> `api/exercise_catalog.json` (e de ter cópia em `~/.hermes/.../references/`). Agora existe **um
> arquivo só**, `frontend/src/lib/exercises-data.json`, lido pelo app, pela API e pelo agente. Onde
> este documento citar `exercise_catalog.json`, ou o campo `name`, leia o arquivo novo e o campo
> `n`. Ver `docs/specs/spec_catalogo_unico.md`.

