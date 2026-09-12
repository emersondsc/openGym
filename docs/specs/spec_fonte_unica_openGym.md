# Spec: Fonte única openGym — remover Sheets/e-mail/CSV e consolidar análise na API — v3

## Contexto e Objetivo

Hoje o openGym já importa de vários apps (Hevy etc.) pela própria UI/API e persiste em `/data/state-<uid>.json` via `PUT /api/data`. Mesmo assim, a análise que o Emerson consome ainda depende do Hermes: `opengym_reader.py` abre o arquivo no disco (`/mnt/drivebackup/apps/openGym/data/state-*.json`), `process_workout.py` calcula `workout_analysis.json`/`workout_progress.json` (Epley, tonnage, semanas ISO, meses, PRs) e escreve Sheets `19cxe...`/e-mail. CSV `workout_data_*.csv` ainda é lido como fallback, mesmo o app já tendo tudo.

Objetivo (1,2,3,4 garantidos):
1. Sheets some do caminho crítico — nada em `api/`/`frontend/` exige `GOOGLESUPER`/`google_token.json`.
2. E-mail some do caminho crítico — relatório via `GET /api/coach/analysis`, não via `send_workout_email.py`.
3. CSV some como obrigação — análise lê só `state-*.json`; import Hevy já existente no openGym (UI → `PUT /api/data`) segue fora desta spec e já alimenta `state-*.json`.
4. App passa a calcular sozinho — `api/coach.js` puro dentro do container `api` expõe `GET /api/coach/analysis` (autenticado por `gymsid`), lendo `stateFile(uid)` do usuário autenticado; `frontend/src/lib/coach.js` consome e `Stats.jsx` renderiza card "Análise — fonte única".

Onde vive: `/mnt/drivebackup/apps/openGym/openGym` (`emerson-custom`), Node `api/server.js` sem framework + React Vite `frontend/`, Docker `api:3000` + `web:nginx:9000` (proxy `/api`) + `media`. Decisões v3: sem `POST /api/coach/import` (já existe import no app), paridade validada ao vivo com Hermes (cópia congelada do `state-*.json` no momento do teste), limpezas no Pi são checklist separado, `unit` por exercício vai para `docs/backlog.md` (BACKLOG-01) — nesta v3 normalização pontual `lb`→`kg` para os 2 exercícios de perna é opcional e documentada como migração única com backup.

## Escopo

- Inclui:
  - 1) Remover Sheets do caminho crítico (nenhum `import` que quebre sem `COMPOSIO_HOME`; verificação via `rg`).
  - 2) Remover e-mail do caminho crítico (nenhum `send_workout_email` no fluxo `GET /api/coach/analysis`).
  - 3) Remover CSV do caminho crítico (nenhum `fs` de `*.csv`/`EXMAP` em `api/`; import Hevy existente permanece fora da spec).
  - 4) App calcula: `api/coach.js` (LB_TO_KG, rowsFromState, buildAnalysis) + `GET /api/coach/analysis` + `frontend/src/lib/coach.js` (TTL 60s + invalidação) + card em `Stats.jsx` + verificação `web/nginx.conf` proxy.
- Não inclui:
  - Treinador completo (persona Low Volume, `mesociclo_ativo.json`) — permanece no Hermes.
  - `unit` por exercício (BACKLOG-01); nesta v3 apenas migração pontual opcional.
  - `exercise_catalog.json` no repo (BACKLOG-03).
  - Novo serviço Python.

## Requisitos Funcionais

RF-1. **Sheets fora do caminho crítico** — `GET /api/coach/analysis` não importa `composio_google`, não lê `google_token.json`, sobe com `COMPOSIO_HOME=""`. Verificação: `rg -n "composio|google_token|GOOGLESUPER" api frontend` deve retornar 0 (exceto docs/backlog).

RF-2. **E-mail fora do caminho crítico** — com e-mail desconfigurado, `GET /api/coach/analysis` retorna `200`. Nenhum `await send_workout_email` no fluxo.

RF-3. **CSV fora do caminho crítico** — `GET` nunca lê `*.csv` nem `OPENGYM_DATA`/`MIRROR`/`EXMAP` do Hermes. Import Hevy já existente via UI (`PUT /api/data`) segue fora da spec e já alimenta `state-*.json`.

RF-4. **Fonte única + app calcula** — `GET /api/coach/analysis` (a) exige `gymsid` via `readSession(req)` → `401 {error:'not signed in',code:'UNAUTH'}` com `Cache-Control: no-store`; (b) lê apenas `stateFile(uid)` sanitizado (ver Detalhe 1.3) dentro de `DATA`; (c) computa via `buildAnalysis(state)` puro; (d) retorna `200 {analysis,progress,meta}` com `Cache-Control: private, no-store, max-age=0` + `Vary: Cookie` e `Pragma: no-cache`; nunca escreve em `/home/pi/...`.

RF-5. **Paridade matemática** — ordem canônica: (i) `unit = String(state.unit||'kg').toLowerCase().startsWith('lb')?'lb':'kg'`; `toKg = unit==='lb'?0.45359237:1`; (ii) `exmap` = `state.customEx` (`id→{n,eq}`) + fallback `id` cru (sem catalog nesta v3); (iii) lastro ` (weighted)` se `eq==='body weight' && wKg>0`; (iv) `set_type` = `warmup` se `phase==='warmup'||warmup===true`, senão `cardio` se `(min!=null||speed!=null) && !hasReps` onde `hasReps = s.r!=null && String(s.r).trim()!==''`, senão `normal`; (v) outlier por `exercise_title` (com ` (weighted)`), lista só `set_type==='normal' && wKg>0`; se `n>=2 && wKgList[0] > 2.5*wKgList[1]` então `w0 = wKgList[0]` cru; `isOutlier(r)` = existe `w0` e `Math.abs(Number(r._wKg)-w0) < 0.001` (tolerância cru, não arredondado); excluir **todos** sets com `wKg===w0` apenas de `tonnage/e1RM/prs/weeks/months`, manter `n_sets` bruto; (vi) `e1rm = wKg*(1+reps/30)` com `wKg` cru não arredondado, apenas se `1<=reps<=30 && wKg>0`; `weight_kg` string display = `Math.round(wKg*100)/100` só para UI; `tonnage = sum(wKg*reps)` com `wKg` cru; (vii) sessões agrupadas por `w.start` epoch ms UTC (`Number(w.start)`), não por `fmtLegacy` string; `period.first/last` = `YYYY-MM-DD` de `sessions[].date`; (viii) semanas ISO 8601 UTC (`YYYY-Sww`, segunda, semana 1 contém 4 jan, regra Thu, `ww` zero-pad); (ix) meses `YYYY-MM`; (x) PRs `e1rm` desc. Paridade alvo `±0.01` absoluto em `e1rm/tonnage/wmax` vs Hermes ao vivo sobre **mesma cópia congelada** do `state-*.json` (ver Critérios).

RF-6. **Sem escrita no Hermes em runtime** — `GET` não escreve em `/home/pi/...`, não lê `MIRROR`/`EXMAP`. Degradação: `ENOENT` → `200` vazio (`n_sessions:0, period:{first:null,last:null}`); `SyntaxError` ou `state.workouts` não-array ou `state==null` → `500 {error:'state corrupt',code:'STATE_CORRUPT',hint:'restore backup'}` + `console.error('[coach] corrupt',safeUid)`; `EACCES`/`EPERM` → `500`; leitura truncada impossível com `atomicWrite` (rename) mas coberta por `SyntaxError`.

RF-7. **Contrato testável** — Sem cookie → `401 {error:'not signed in',code:'UNAUTH'}`. Com cookie → `200 {analysis:{n_sets:number,n_sessions:number,n_exercises:number,period:{first:string|null,last:string|null},sessions:Array<{date:string,start:string,end:string,title:string,n_sets:number,n_exercises:number,tonnage:number,avg_rpe:number|null}>,prs:Array<{ex:string,e1rm:number,wmax:number,reps:number,date:string,sets:number}>,weeks:Array<{week:string,sessions:number,tonnage:number,sets:number}>,months:Array<{month:string,sessions:number,tonnage:number,sets:number}>,top_ex:Array<[string,number]>,titles:Array<[string,number]>},progress:Record<string,Array<{date:string,e1rm:number|null,wmax:number|null,tonnage:number}>>,meta:{uid:string,generatedAt:number,n_sets:number,n_sessions:number,period:{first:string|null,last:string|null}}}`. `progress` por data `YYYY-MM-DD` UTC, `e1rm` max do dia, `wmax` max `wKg` do dia, `tonnage` soma do dia (só `normal` não-outlier). Se `n_sets>20000` → ainda `200` com `meta.truncated:true` + `meta.limitedTo:20000` (não `206`).

RF-8. **Frontend consome com invalidação** — `frontend/src/lib/coach.js` `fetchAnalysis(force?)` com cache memória TTL 60s e `clearCoachCache()`. `store/useStore.js` após `PUT /api/data` `200` (em `persist`/`pushState` sucesso) chama `clearCoachCache()` (import dinâmico). `Stats.jsx` usa `const user=useStore(s=>s.user)` e `useEffect([user])`, não `getState()`; `visibilitychange` não é necessário.

## Detalhe de Implementação (nível código)

### 1. `api/coach.js` (novo, 230-270 linhas)

```js
// api/coach.js — sem fs de Hermes, sem csv-parse, sem compsio
const LB_TO_KG = 0.45359237;
function isoWeekKeyUTC(dateStr){ // dateStr YYYY-MM-DD UTC → YYYY-Sww
  const d=new Date(dateStr+'T12:00:00Z'); const day=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-day+3);
  const firstThu=new Date(Date.UTC(d.getUTCFullYear(),0,4)); const week=Math.round((d-firstThu)/604800000)+1;
  return `${d.getUTCFullYear()}-S${String(week).padStart(2,'0')}`;
}
function e1rm(wKg,reps){ if(!wKg||!reps||wKg<=0||reps<=0||reps>30) return null; return wKg*(1+reps/30); }
export function rowsFromState(state){
  const exmap={}; for(const c of state.customEx||[]) if(c.id) exmap[c.id]={n:c.n||c.id, eq:c.eq||'custom'};
  const unit=String(state.unit||'kg').toLowerCase().startsWith('lb')?'lb':'kg'; const toKg=unit==='lb'?LB_TO_KG:1;
  const rows=[];
  for(const w of state.workouts||[]){
    const startMs=Number(w.start); const endMs=Number(w.end)||startMs;
    // fmtLegacy só para display de rows.start_time (não para agrupar)
    const fmt=(ms)=>{ const d=new Date(Number(ms)); const MESES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
    const start=fmt(startMs), end=fmt(endMs)||start; const title=(w.name||'Imported').trim();
    for(const e of w.entries||[]){
      const exId=e.id||''; const meta=exmap[exId]||{n:exId, eq:''}; const baseName=meta.n||exId; const isBw=meta.eq==='body weight';
      for(let i=0;i<(e.sets||[]).length;i++){
        const s=e.sets[i]; const isWarm=String(s.phase||'').toLowerCase()==='warmup'||s.warmup===true;
        const hasReps=s.r!=null && String(s.r).trim()!==''; const isCardio=(s.min!=null||s.speed!=null)&&!hasReps;
        const setType=isWarm?'warmup':(isCardio?'cardio':'normal');
        let rpe=s.rpe; if(s.rir!=null && Number.isFinite(Number(s.rir)) && Number(s.rir)>=0 && Number(s.rir)<=10){ const v=10-Number(s.rir); if(Number.isFinite(v)) rpe=v; }
        if(rpe!=null && !Number.isFinite(Number(rpe))) rpe=null;
        let wKg=0; try{ wKg=s.w==null||String(s.w).trim()===''?0: Number(s.w)*toKg; }catch{ wKg=0; }
        const exName=(isBw && wKg>0)? `${baseName} (weighted)`: baseName;
        rows.push({ title, start_time:start, end_time:end, _startMs:startMs, _endMs:endMs, exercise_title:exName, set_index:String(i), set_type:setType, weight_kg: s.w==null||String(s.w).trim()===''? '': String(Math.round(wKg*100)/100), reps: hasReps?String(s.r):'', rpe: rpe==null||String(rpe).trim()===''? '': String(rpe), _wKg:wKg, _reps: hasReps?Number(s.r):null });
      }
    }
  }
  return rows;
}
export function buildAnalysis(state){
  const rows=rowsFromState(state);
  // outlier, sessions por _startMs, weeks UTC via isoWeekKeyUTC, months, prs, top_ex, titles, progress por date
  // tonnage e e1rm usam _wKg cru
  return { analysis, progress };
}
```

### 2. `api/server.js` — imports e rota

**ANTES:**
```js
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
```
**DEPOIS:**
```js
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildAnalysis } from './coach.js';
```

**Rota `GET /api/coach/analysis` — ANTES:** não existe.
**DEPOIS:**
```js
  'GET /api/coach/analysis': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error:'not signed in', code:'UNAUTH' }, {'Cache-Control':'private, no-store, max-age=0'});
    const rawUid=String(user.id||'');
    const safeUid=rawUid.replace(/[^a-zA-Z0-9_-]/g,'');
    if(!safeUid) return json(res,400,{error:'bad uid',code:'BAD_UID'});
    const p=path.resolve(DATA, 'state-'+safeUid+'.json');
    const rel=path.relative(path.resolve(DATA), p);
    if(rel.startsWith('..') || path.isAbsolute(rel)) return json(res,400,{error:'bad uid',code:'BAD_UID'});
    let state; try{ const txt=fs.readFileSync(p,'utf8'); if(!txt.trim()) throw new SyntaxError('empty'); state=JSON.parse(txt); }catch(e){
      if(e.code==='ENOENT') state={ workouts:[], routines:[], bodyweight:[], customEx:[], unit:'kg' };
      else if(e instanceof SyntaxError){ console.error('[coach] corrupt',safeUid,e.message); return json(res,500,{error:'state corrupt',code:'STATE_CORRUPT',hint:'restore backup'}); }
      else { console.error('[coach] read error',safeUid,e); return json(res,500,{error:'server error'}); }
    }
    // validação schema mínima
    if(!state || typeof state!=='object' || (state.workouts!=null && !Array.isArray(state.workouts))){ console.error('[coach] corrupt schema',safeUid); return json(res,500,{error:'state corrupt',code:'STATE_CORRUPT',hint:'restore backup'}); }
    try{
      const { analysis, progress } = buildAnalysis(state);
      // SLO p95 <150ms para 5k sets; se >20000 sets, não 206, apenas flag
      if(analysis.n_sets>20000) return json(res,200,{analysis, progress, meta:{uid:user.id, generatedAt:Date.now(), n_sets:analysis.n_sets, n_sessions:analysis.n_sessions, period:analysis.period, truncated:true, limitedTo:20000}}, {'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','Pragma':'no-cache'});
      json(res,200,{analysis, progress, meta:{uid:user.id, generatedAt:Date.now(), n_sets:analysis.n_sets, n_sessions:analysis.n_sessions, period:analysis.period}}, {'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','Pragma':'no-cache'});
    }catch(e){ console.error('[coach] build error',safeUid,e); json(res,500,{error:'server error'}); }
  },
```

### 3. `frontend/src/lib/coach.js` (novo)

```js
import { api } from './api.js';
let cache=null, cacheAt=0;
export async function fetchAnalysis(force=false){
  if(!force && cache && Date.now()-cacheAt<60000) return cache;
  const data=await api('/api/coach/analysis');
  cache=data; cacheAt=Date.now(); return data;
}
export function clearCoachCache(){ cache=null; cacheAt=0; }
```

**3.1 `frontend/src/store/useStore.js` — invalidação**
Após `await api('/api/data',{method:'PUT',body:JSON.stringify({state:sanitized})})` com `200` em `pushState` e após `persist(next,false)` em `pullState`, chamar:
```js
try{ const {clearCoachCache}=await import('../lib/coach.js'); clearCoachCache(); }catch{}
```

### 4. `frontend/src/views/Stats.jsx` — card (completo, copiável)

```jsx
import { useState,useEffect } from 'react';
import { useStore } from '../store/useStore.js';
import { fetchAnalysis } from '../lib/coach.js';
import { fmtDate } from '../lib/format.js';
export default function StatsExtra(){
  const user=useStore(s=>s.user);
  const [coach,setCoach]=useState(null); const [err,setErr]=useState(null);
  useEffect(()=>{ if(!user){ setCoach(null); setErr(null); return;} fetchAnalysis().then(d=>{setCoach(d); setErr(null);}).catch(e=>setErr(e)); },[user]);
  if(!user) return <div className="card"><div className="muted small">Faça login para ver análise — 401</div><button className="btn" onClick={()=>location.href='/login'}>Entrar com passkey</button></div>;
  if(err && err.status===401) return <div className="card muted small">Faça login para ver análise — 401</div>;
  if(err) return <div className="card"><div className="muted small">Análise indisponível — {err.message||'erro'}</div><button className="btn" onClick={()=>fetchAnalysis(true).then(d=>{setCoach(d); setErr(null);}).catch(e=>setErr(e))}>Tentar novamente</button></div>;
  if(!coach) return <div className="card muted small">Carregando análise…</div>;
  return <div className="card"><div className="row between"><h2>Análise — fonte única (API)</h2><span className="dim small">✓ fonte única · gerado às {fmtDate(coach.meta.generatedAt)} (TTL 60s)</span></div><div className="small dim">{coach.analysis.n_sessions} sessões · {coach.analysis.n_exercises} exercícios · {coach.analysis.period.first||'—'} → {coach.analysis.period.last||'—'}</div></div>;
}
```
Integrar como `<StatsExtra/>` abaixo de `<MuscleBalance/>` em `Stats.jsx`.

### 5. `web/nginx.conf` — verificação

Garantir `location /api/ { proxy_pass http://api:3000; proxy_no_cache 1; proxy_cache_bypass 1; }` e `add_header Cache-Control "private, no-store" always;` para `/api/coach/analysis` (ou via `api` header `Vary: Cookie`).

### 6. Migração pontual `lb`→`kg` (opcional, antes da validação)

Script dry-run que lista candidatos `wKg > 2.5*mediana` por `exercise_title` e só reescreve se IDs confirmados por Emerson, com `cp state-<uid>.json state-<uid>.json.bak` antes. Se não houver IDs, pular — BACKLOG-01 cobre `unit` por exercício futuro.

### 7. Testes manuais (todos sem exigir Sheets/e-mail/CSV)

1. `curl -s http://localhost:3000/api/coach/analysis` → `401 {code:'UNAUTH'}`.
2. Login passkey, `curl -b cookies.txt http://localhost:3000/api/coach/analysis | jq .analysis.n_sessions` → `>0`; comparar com `ssh hermes "cat /home/pi/.hermes/workout/data/workout_analysis.json" | jq .n_sessions` sobre **mesma cópia congelada** (`cp /mnt/drivebackup/apps/openGym/data/state-<uid>.json /tmp/frozen.json` e rodar ambos sobre ele) → `period.first/last` idênticos, `e1rm/tonnage` `±0.01`.
3. `rg -n "composio|google_token|GOOGLESUPER" api frontend` → 0 (fora docs).
4. `COMPOSIO_HOME="" docker compose up api` → `GET` ainda `200`.
5. `Stats` logado → card com `weeks`/`prs` e badge `✓ fonte única`; deslogado → CTA; `500` → botão "Tentar novamente".
6. `curl http://localhost:9000/api/coach/analysis -b cookies.txt -I` → `200` via `web` proxy + `Cache-Control: private, no-store`.

## Comportamento Visual/UX

**Com dados (200):**
```
┌─ Análise — fonte única (API) ─────────────────────┐
│ 280 sessões · 12 exercícios · 2024-11-22 → 2026-09-08 │
│  [✓ fonte única]  gerado às 13:44 (TTL 60s)           │
├───────────────────────────────────────────────────┤
│  Semanas ISO         │ Sessões │ Carga total        │
│  2026-S36            │ 3       │ 32.420 kg          │
│  2026-S35            │ 4       │ 41.110 kg          │
├───────────────────────────────────────────────────┤
│  Top exercícios      │ PR e1RM │ wmax               │
│  lever leg extension │ 253 kg  │ 200 kg (2026-09-02)│
└───────────────────────────────────────────────────┘
```
**Sem login (401):** card com "Faça login — 401" + botão Entrar.
**Carregando:** "Carregando análise…".
**Erro 500:** "Análise indisponível — tentar novamente" + botão.

Fluxo: `Login → GET /api/me 200 → GET /api/coach/analysis 200 → render`. Após `PUT /api/data` (salvar treino), `clearCoachCache()` garante recomputo.

## Persistência e Dados

- Fonte: `/data/state-<uid>.json` sanitizado, sem novo arquivo em `/data` nesta v3.
- Sem escrita: `buildAnalysis` puro; `GET` nunca escreve; `PUT` único escritor com `atomicWrite`.
- Cache: frontend TTL 60s + `Cache-Control: private, no-store, max-age=0, Vary: Cookie`.

## Integração

- `api/server.js` ↔ `api/coach.js` ↔ `frontend/src/lib/coach.js` ↔ `Stats.jsx` ↔ `web/nginx.conf` proxy.

## Casos de Borda

- Sem workouts → `200` vazio; `ENOENT` → `200` vazio; `SyntaxError`/schema inválido → `500 STATE_CORRUPT`.
- `unit` variações (`LB`, `lbs`) → normalizado.
- Outlier `n<2` desabilita; `weight_kg` vazio ignora.
- `n_sets>20000` → `200` com `truncated:true` (não `206`).
- Traversal `uid` → `400 BAD_UID`.
- `s.r=''` → `hasReps` false.

## Critérios de Aceite

- [ ] `GET` sem cookie `401`, com cookie `200` com `analysis/progress/meta` e `Cache-Control: private, no-store`.
- [ ] Paridade ao vivo sobre cópia congelada: `n_sets/n_sessions/period` exatos, `e1rm/tonnage/wmax` `±0.01`.
- [ ] `rg` Sheets/e-mail retorna 0; `COMPOSIO_HOME=""` ainda `200`; `*.csv` removidos ainda `200`.
- [ ] `Stats` logado com card, deslogado CTA, `500` com retry, `PUT` invalida cache.
- [ ] `docker compose up api` e `curl :9000/api/coach/analysis` via `web` funcionam; `node --check api/coach.js` e `npm run build` passam.


---

> **Atualização de 11/09/2026:** o catálogo de exercícios deixou de ser
> `api/exercise_catalog.json` (e de ter cópia em `~/.hermes/.../references/`). Agora existe **um
> arquivo só**, `frontend/src/lib/exercises-data.json`, lido pelo app, pela API e pelo agente. Onde
> este documento citar `exercise_catalog.json`, ou o campo `name`, leia o arquivo novo e o campo
> `n`. Ver `docs/specs/spec_catalogo_unico.md`.

