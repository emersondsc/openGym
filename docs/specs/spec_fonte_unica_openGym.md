# Spec: Fonte única openGym — remover Sheets/e-mail/CSV e consolidar análise na API — v1

## Contexto e Objetivo

Hoje o fluxo de treino do Emerson depende do **Hermes** para análise: o Planilheiro lê direto do disco `/mnt/drivebackup/apps/openGym/data/state-*.json` via `opengym_reader.py`, gera `workout_analysis.json`/`workout_progress.json` com `process_workout.py` (Epley e1RM, tonnage, semanas/meses, PRs), escreve Google Sheets `19cxe...` via Composio `ca_7tT9O...` e envia relatórios por e-mail via `send_workout_email.py`. CSV Hevy (`workout_data_YYYY-MM-DD.csv`) ainda é aceito como fallback histórico.

O openGym já possui **fonte única pronta**: `api/server.js` persiste por usuário em `/data/state-<uid>.json` + `/data/db.json` (passkey), com sync `PUT /api/data` last-write-wins com `_ts` e guarda `409 stale base`; frontend `store/useStore.js` já configura rotinas (`S.routines`, `S.week`, `S.dayPlan`, `S.workouts`, `S.bodyweight`) e consome via `api('/api/data')`. Desde 2026-09-05 o leitor já é HD-only (`opengym_reader.py` lê continente primeiro, espelho na ilha só como degradação).

Objetivo: **eliminar Sheets, e-mail e CSV como dependências obrigatórias** e tornar a análise independente do Hermes, portando a matemática validada para dentro da API do openGym. Após esta spec, `GET /api/coach/analysis` no próprio container `api` deve entregar a mesma análise que hoje sai de `workout_analysis.json`, e o frontend deve consumi-la — sem escrever em Sheets, sem enviar e-mail e sem exigir CSV.

Onde vive: `/mnt/drivebackup/apps/openGym/openGym` (branch `emerson-custom`), stack Node `api/server.js` (sem framework) + React Vite `frontend/`, Docker Compose `api + web (nginx :9000) + media`.

## Escopo

- Inclui:
  - 1) **Remover Google Sheets** como destino obrigatório: desativar `scripts/update_dashboard.py`, `scripts/composio_google.py`, dependência `COMPOSIO_HOME`/Sheets `19cxe...` e qualquer escrita em abas `Dashboard/Sessões/Progresso/PRs`.
  - 2) **Remover e-mail** como entrega obrigatória: desativar `scripts/send_workout_email.py`, `scripts/send_train_email.py`, `scripts/generate_premium_pdf.py`-e-mail, e conexão Composio GOOGLESUPER. Relatórios passam a ser servidos via API e renderizados no app.
  - 3) **Remover CSV como fonte primária**: `process_workout.py`/`opengym_reader.py` deixam de exigir `workout_data_*.csv` e `EXMAP`; CSV fica apenas como import opcional `POST /api/coach/import` (fora do fluxo normal). Nenhum cron/job pode depender de CSV.
  - 4) **Consolidar fonte única no openGym**: portar matemática de `process_workout.py`+`opengym_reader.py` para Node em `api/coach.js` (ou módulo dentro de `server.js`), lendo direto de `/data/state-<uid>.json` (mesma semântica do volume Docker), expondo `GET /api/coach/analysis` autenticado por `gymsid` e consumido pelo frontend. Rotinas continuam configuráveis via `PUT /api/data` (contrato existente).
- Não inclui:
  - Migração completa do treinador (persona Low Volume, 4 fases, `mesociclo_ativo.json`, perguntas Fase 2, planejamento de meso/micro). O `mesociclo_ativo.json` permanece em `/home/pi/.hermes/workout/plans` nesta spec — apenas a análise é espelhada.
  - Mudança no modelo de auth (passkey `@simplewebauthn/server` permanece), no contrato `PUT /api/data` com `_ts`/`409`, ou no volume `/data`.
  - Novo serviço Python no compose; tudo fica em Node na `api`.
  - Reescrita do dataset `exercise_catalog.json` (1324 exercícios com `img/gif`) — permanece onde está, não é movido nesta spec.

## Requisitos Funcionais

RF-1. **Sheets removido como dependência obrigatória** — Nenhum código em `api/` ou `frontend/` ou cron no Hermes pode exigir variável `GOOGLESUPER`, `google_token.json` ou Sheets ID `19cxe...` para que `GET /api/coach/analysis` funcione. "Removido" = nenhum `import`/`require` que quebre se o token não existir, nenhum job que falhe o boot do `api` por falta de Sheets.

RF-2. **E-mail removido como entrega obrigatória** — Nenhum fluxo de geração de relatório pode exigir `send_workout_email.py` ou SMTP/Composio para concluir. O plano/relatório deve ser acessível via `GET /api/coach/analysis` (e futuro `GET /api/coach/plan`) mesmo com e-mail desconfigurado. E-mail pode permanecer como script manual, mas não no caminho crítico.

RF-3. **CSV removido como fonte primária** — `GET /api/coach/analysis` deve funcionar com zero arquivos `workout_data_*.csv` no disco. CSV só é lido se explicitamente enviado via `POST /api/coach/import` (opcional). Se `OPENGYM_DATA` e CSV estiverem ausentes, a análise deve vir do `state-<uid>.json` do usuário autenticado, não falhar.

RF-4. **Fonte única openGym via API** — As rotinas e workouts são lidos e escritos exclusivamente via `GET /api/data` / `PUT /api/data` (contrato existente com `S._ts`, `401` sem `gymsid`, `409` stale). `GET /api/coach/analysis` deve: (a) exigir `gymsid` válido (mesmo `readSession(req)` de `server.js:readSession`), (b) ler `stateFile(uid)` do usuário autenticado via `fs.readFileSync` (mesmo `stateFile` de `server.js`), (c) computar e retornar JSON equivalente a `workout_analysis.json` + `workout_progress.json` sem tocar no Hermes.

RF-5. **Paridade matemática com `process_workout.py`** — `GET /api/coach/analysis` deve replicar exatamente: (i) conversão `unit` (`lb` → kg via `0.45359237`, `kg` = 1.0), (ii) mapeamento `customEx` (`exmap[id] = {n, eq}`) e fallback `exmap[id] || id`, (iii) regra de lastro com sufixo weighted quando `eq==body weight && w>0`, (iv) `set_type` (`warmup` se `phase==warmup` ou warmup true, senão `cardio` se `min/speed` presente e sem `r`, senão `normal`), (v) outlier: peso >2.5x 2º maior do mesmo exercício é excluído do volume/e1RM, (vi) `e1rm = w*(1+reps/30)` apenas se `w>0 && 1<=reps<=30`, (vii) sessões agrupadas por `w.start` (epoch ms via `_fmt_legacy` em `opengym_reader.py`), (viii) semanas ISO `YYYY-Sww` e meses `YYYY-MM`, (ix) PRs ordenados por e1RM desc. Diferença numérica >0.01 nos testes de snapshot deve falhar.

RF-6. **Sem escrita no Hermes** — `GET /api/coach/analysis` não deve escrever em `/home/pi/.hermes/workout/data/`, não deve exigir `MIRROR` (`/home/pi/.hermes/workout/opengym-mirror`) nem `EXMAP` do Hermes. Degradação "continente → espelho" é removida; a única degradação é "sem workouts" → retorna `{n_sessions:0, ...}` com `200`.

RF-7. **Contrato de API testável** — `GET /api/coach/analysis` retorna `200 { analysis: {...}, progress: {...}, meta: {uid, generatedAt, n_sets, n_sessions, period}}` quando autenticado e `401 {error:'not signed in'}` sem cookie. `analysis` deve conter chaves `n_sets, n_sessions, n_exercises, period{first,last}, sessions[], prs[], weeks[], months[], top_ex[], titles[]` com mesmos tipos do JSON atual. `progress` é mapa `ex -> [{date,e1rm,wmax,tonnage}]`.

RF-8. **Frontend consome fonte única** — `frontend/src/lib/coach.js` (novo) deve expor `fetchAnalysis()` que chama `api('/api/coach/analysis')` e armazena em cache em memória (TTL 60s). Nenhum componente pode importar `workout_analysis.json` do Hermes ou fazer fetch para Sheets.

## Detalhe de Implementação (nível código)

> Arquivo a arquivo, função a função, com código ANTES→DEPOIS copiável. Linhas referem-se ao estado atual em `emerson-custom` (2026-09-09).

### 1. `api/server.js` (linhas ~1-20 imports e ~275 routes)

**1.1 Imports (linha 1-10) — ANTES:**
```js
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
```
**1.1 — DEPOIS:**
```js
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildAnalysis } from './coach.js';
```

**1.2 Novo módulo `api/coach.js` (novo arquivo, 180-220 linhas):**
```js
// api/coach.js — matemática portada de process_workout.py + opengym_reader.py (sem Sheets/CSV)
const LB_TO_KG = 0.45359237;
const MESES_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtLegacy(ms){
  if(!ms) return '';
  const dt = new Date(Number(ms));
  return `${dt.getDate()} ${MESES_EN[dt.getMonth()]} ${dt.getFullYear()}, ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}
function toFloat(v){ const n=Number(String(v).replace(',','.').trim()); return Number.isFinite(n)?n:null; }
function e1rm(w,reps){ if(!w||!reps||w<=0||reps<=0||reps>30) return null; return w*(1+reps/30); }
export function rowsFromState(state){
  const exmap = {};
  for(const c of state.customEx||[]) if(c.id) exmap[c.id]={n:c.n||c.id, eq:c.eq||'custom'};
  const toKg = state.unit==='lb'?LB_TO_KG:1.0;
  const rows=[];
  for(const w of state.workouts||[]){
    const start=fmtLegacy(w.start), end=fmtLegacy(w.end)||start;
    const title=(w.name||'Imported').trim();
    for(const e of w.entries||[]){
      const exId=e.id||''; const meta=exmap[exId]||{n:exId, eq:''};
      const baseName=meta.n||exId; const isBw=meta.eq==='body weight';
      for(let i=0;i<(e.sets||[]).length;i++){
        const s=e.sets[i]; const isWarm=(String(s.phase||'').toLowerCase()==='warmup')||s.warmup===true;
        const isCardio=(s.min!=null||s.speed!=null)&& s.r==null;
        const setType=isWarm?'warmup':(isCardio?'cardio':'normal');
        let rpe=s.rpe; if(s.rir!=null){ try{ rpe=10-Number(s.rir);}catch{} }
        let wtf=0; try{ wtf= s.w==null||s.w===''?0: Number(s.w);}catch{ wtf=0;}
        const exName=(isBw && wtf>0)? `${baseName} (weighted)`: baseName;
        rows.push({ title, start_time:start, end_time:end, exercise_title:exName, set_index:String(i), set_type:setType, weight_kg: s.w==null||s.w===''? '': String(Math.round(wtf*toKg*100)/100), reps: s.r==null||s.r===''? '': String(s.r), rpe: rpe==null||rpe===''? '': String(rpe)});
      }
    }
  }
  return rows;
}
export function buildAnalysis(state){
  const rows=rowsFromState(state);
  // outliers, sessões, e1RM, weekly, monthly, prs, top_ex, titles — portado linha-a-linha de process_workout.py
  // ... (implementação completa no arquivo, ver seção 6. Testes manuais para validação)
  return { analysis, progress };
}
```
Regras: sem `fs` para Sheets/CSV, sem `process.env.OPENGYM_DATA` do Hermes, apenas recebe `state` já lido do `stateFile(uid)`.

**1.3 Rota `GET /api/coach/analysis` (novo, após `GET /api/health`, linha ~277):**
```js
// ANTES: não existe
// DEPOIS:
  'GET /api/coach/analysis': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    let state=null; try{ state=JSON.parse(fs.readFileSync(stateFile(user.id),'utf8')); }catch{ state={ workouts:[], routines:[], bodyweight:[], customEx:[], unit:'kg' } }
    const { analysis, progress } = buildAnalysis(state);
    json(res, 200, { analysis, progress, meta:{ uid:user.id, generatedAt: Date.now(), n_sets: analysis.n_sets, n_sessions: analysis.n_sessions, period: analysis.period }});
  },
```

**1.4 Rota opcional `POST /api/coach/import` (CSV legado, fora do caminho crítico):**
```js
  'POST /api/coach/import': async (req, res) => {
    const user = readSession(req); if(!user) return json(res,401,{error:'not signed in'});
    const body=await readBody(req);
    if(!body.csvText) return json(res,400,{error:'csvText required'});
    // parse CSV mínimo, converte para workouts e faz merge via mesma lógica de PUT /api/data
  },
```
Se não houver tempo, esta rota pode ser stub `501 not implemented` nesta v1 — RF-3 continua atendido porque CSV não é exigido.

### 2. `api/package.json` (linha 13 dependencies)

**ANTES:** `"dependencies": {"@simplewebauthn/server":..., "web-push":...}`
**DEPOIS:** sem nova dependência (matemática é JS puro). Não adicionar `csv-parse` nesta v1; se necessário, usar split manual.

### 3. `frontend/src/lib/coach.js` (novo, 30 linhas)

```js
import { api } from './api.js';
let cache=null, cacheAt=0;
export async function fetchAnalysis(force=false){
  if(!force && cache && Date.now()-cacheAt<60000) return cache;
  const data=await api('/api/coach/analysis');
  cache=data; cacheAt=Date.now(); return data;
}
export function clearCoachCache(){ cache=null; }
```

### 4. `frontend/src/views/Stats.jsx` ou `frontend/src/views/Home.jsx` (consumo)

**ANTES:** nenhum consumo de análise (dados vêm só de `S.workouts`).
**DEPOIS (exemplo em Stats):**
```js
import { fetchAnalysis } from '../lib/coach.js';
const [coach,setCoach]=useState(null);
useEffect(()=>{ if(user) fetchAnalysis().then(setCoach).catch(()=>{}); },[user]);
 // render: coach.analysis.weeks, coach.progress['lever leg extension'], etc.
 // fallback: se 401 ou coach==null, renderiza "faça login para ver análise"
```
Não remover render atual baseado em `S.workouts` nesta v1; apenas adicionar seção "Análise (API)" com badge `✓ fonte única`.

### 5. Remoções no Hermes (fora do repo openGym, mas parte do aceite 1,2,3)

**5.1 Desativar escrita em Sheets:**
- `crontab -l | grep -v update_dashboard | crontab -` — remover cron que chama `update_dashboard.py`.
- Renomear `/home/pi/.hermes/workout/scripts/update_dashboard.py` → `.../deprecated/update_dashboard.py` e remover imports de `composio_google.py` em `sync_treino.sh`.
- Não apagar `google_token.json` nesta v1 (apenas não é mais exigido; RF-1 valida que `GET /api/coach/analysis` não quebra sem ele).

**5.2 Desativar e-mail como dependência:**
- Em `sync_treino.sh` e `plans/*.md` generation, remover chamada a `send_workout_email.py` do caminho crítico; manter script mas sem ser chamado por `GET /api/coach/analysis`.

**5.3 CSV como opcional:**
- Em `process_workout.py` adicionar guard no topo: se `SRC==None` e `state-*.json` existe, não exigir CSV (já é o comportamento atual via `opengym_reader`; apenas garantir que nenhum cron falhe se `workout_data_*.csv` sumir).

### 6. Testes manuais (todos devem passar sem Hermes)

1. `curl -s http://localhost:3000/api/coach/analysis` sem cookie → `401`.
2. Login via passkey (UI), depois `curl -b cookies.txt http://localhost:3000/api/coach/analysis | jq .analysis.n_sessions` → `>280` (mesmo número que `workout_analysis.json` no Hermes).
3. Comparar snapshot: `ssh hermes "cat /home/pi/.hermes/workout/data/workout_analysis.json" | jq .period` vs `curl .../api/coach/analysis | jq .analysis.period` → idênticos.
4. Remover `workout_data_*.csv` do Hermes (`ssh hermes "ls /home/pi/.hermes/workout/data/*.csv"` → vazio) e repetir passo 2 → ainda `200` (RF-3).
5. Renomear `google_token.json` temporariamente (`ssh hermes "mv google_token.json google_token.json.bak"`) e repetir passo 2 → ainda `200` (RF-1/2).
6. No frontend, abrir `Stats` logado → seção "Análise (API)" mostra `weeks` e `prs` sem spinner infinito; deslogado mostra "faça login".

## Comportamento Visual/UX

Esta spec é majoritariamente backend, mas o aceite exige visibilidade no app de que a fonte única está ativa.

### Mock ASCII — Stats (nova seção)

```
┌─ Análise — fonte única (API) ─────────────────────┐
│ 280 sessões · 12 exercícios · 2024-11-22 → 2026-09-08 │
│  [✓ fonte única]  gerado em 09 set 13:44 (60s cache)  │
├───────────────────────────────────────────────────┤
│  Weeks (ISO)        │ Sessions │ Tonnage           │
│  2026-S36           │ 3        │ 32.420 kg         │
│  2026-S35           │ 4        │ 41.110 kg         │
├───────────────────────────────────────────────────┤
│  Top exercícios     │ PR e1RM  │ wmax              │
│  lever leg extension│ 253 kg   │ 200 kg (2026-09-02)│
└───────────────────────────────────────────────────┘
Sem login: [Faça login para ver análise — 401]
```

### Fluxo

`Login passkey → GET /api/me 200 → GET /api/coach/analysis 200 → render Stats/Home`. Sem login, o card mostra estado vazio com mensagem, nunca quebra.

## Persistência e Dados

- Fonte: `/data/state-<uid>.json` lido via `stateFile(uid)` de `server.js` (mesmo path do `PUT /api/data`). Nenhum novo arquivo em `/data` nesta v1.
- Cache: apenas em memória no frontend (`coach.js` TTL 60s) e sem cache no backend (sempre recomputa; custo <50ms para 300 sessões).
- Compat: `S._ts` e guarda `409` permanecem inalterados; `buildAnalysis` é puro e não escreve.

## Integração

- `api/server.js` ↔ `api/coach.js` (import puro), `frontend/src/lib/coach.js` ↔ `api('/api/coach/analysis')`, `frontend/src/views/Stats.jsx` (ou Home) consome.
- Desacopla: nenhum import de `~/.hermes`, nenhum env `OPENGYM_DATA`/`MIRROR`/`EXMAP` do Hermes, nenhum Sheets/e-mail.

## Casos de Borda

- Usuário sem workouts: retorna `{n_sessions:0, period:{first:null,last:null}, sessions:[], prs:[]}` com `200`.
- `state-<uid>.json` ausente/corrompido: trata como `{workouts:[], customEx:[], unit:'kg'}`, não `500`.
- `unit=='lb'` → converte todos os pesos com `0.45359237` antes de outlier/e1RM (paridade com leitor).
- Outlier: se maior peso >2.5x segundo maior do mesmo exercício, exclui só do volume/e1RM, mas mantém série no `n_sets` (mesma regra do Python).
- Múltiplos perfis em `/data`: nunca lista diretório; usa `uid` do cookie (não `OPENGYM_UID`).
- CSV importado via `POST /api/coach/import` com formato inválido → `400 {error:'bad csv'}`, sem efeito colateral.

## Critérios de Aceite

- [ ] `GET /api/coach/analysis` sem `gymsid` → `401`, com `gymsid` válido → `200` com chaves `analysis{...}, progress{...}, meta{...}`.
- [ ] Snapshot paridade: `n_sessions`, `n_sets`, `period`, `weeks[0].tonnage`, `prs[0].e1rm` idênticos ao `workout_analysis.json` do Hermes (±0.01) para o mesmo usuário.
- [ ] Com `*.csv` removidos e `google_token.json` renomeado no Hermes, o endpoint ainda retorna `200` (prova de 1,2,3).
- [ ] Frontend logado exibe seção "Análise — fonte única" com dados; deslogado exibe mensagem sem erro.
- [ ] Nenhum job/cron exige Sheets/e-mail/CSV para o app subir: `docker compose up api` sobe sem env `COMPOSIO_HOME`.
- [ ] `npm run build` no frontend e `node --check api/coach.js` passam; `docker compose build api` passa.

