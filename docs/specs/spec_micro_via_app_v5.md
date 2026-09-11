# Spec: Micro via app — app como interface, Hermes como motor (e como quem grava) — v2 (final para revisão)

> **Lastro desta spec, sem enfeite:** passou por **1 revisão adversarial completa** que devolveu
> **48 achados** (30 bloqueantes) — todos tratados aqui; por **10 verificações empíricas** na
> máquina real (ver `hermes/notes/spec_v5_evidencias.md`, seções 1 a 10); e por **4 checagens
> mecânicas**: o Python embutido compila, os 5 blocos de troca batem literalmente com os arquivos
> reais, as chaves de tradução foram deduplicadas contra `pt.js`, e não há `slowapi`/`mesoId` fora
> de prosa explicativa.
>
> **A 2ª revisão foi interrompida** — rodou 5 rodadas sem retornar e foi cancelada para não segurar
> o trabalho. Ou seja: os fatos estão provados por experimento, mas esta spec **não** teve a segunda
> passada adversarial que o processo pede. O ponto mais provável de ainda esconder defeito é o
> **§9 (`hermes_api.py`)**, por ser o maior bloco de código novo. Tratar isso como risco conhecido,
> não como algo já coberto.
>
> A v4 (`spec_micro_meso_via_app.md`) fica como histórico: a premissa dela — rotinas novas por
> semana — foi derrubada por decisão do usuário em 10/09/2026.

## Contexto e Objetivo

Hoje o treinador é operado por conversa: você pede a análise no Telegram, responde a Fase 2 lá, e o
agente gera a semana e sincroniza as rotinas vivas no openGym seguindo a receita endurecida do passo
6 da skill `treino-coach`. O objetivo é trazer **a interação** para o app, mantendo o Hermes como
motor de IA e como **quem executa a gravação**.

O que muda para o usuário: em `Plan` aparece um botão que abre as 4 perguntas da Fase 2; o Hermes
pensa **sem gravar nada**; devolve o que pretende mudar (exercício por exercício, com o porquê);
você aprova; e só então as suas 5 fichas são reescritas. Já não é preciso abrir o Telegram.

Decisões do usuário (discussão de 10/09/2026) que moldam tudo:

- **5 fichas, reescrever os números.** Nenhuma rotina nova. As rotinas continuam
  `r_push_C_20260829`, `r_pull_C_20260829`, `r_upper_C_20260829`, `r_leg1_20260823`,
  `r_leg2_20260823`; muda apenas `ex[]` e o caderno de pesos (`exWeights`).
  Isto derruba as premissas da v4: `r_*_S(n)_<hash>`, `S.dayPlan` com as datas da semana,
  GC de rotinas órfãs, `DATE_CONFLICT`, `MESO_ACTIVE`.
- **Propor → aprovar → aplicar.** Gravar é um segundo passo explícito.
- **O Hermes grava**, com **código determinístico** seguindo a receita do passo 6 — não o agente
  com shell. O agente devolve apenas a prescrição em JSON.
- **Semana já gerada** ⇒ o app avisa e espera confirmação para substituir.
- **Aplicar no meio da semana** ⇒ mantém o aviso de quais treinos ainda mudam (não trava a geração).
- **Rede** ⇒ uma regra de firewall escopada liberando **só o container** até a porta do motor.
- **Sem selo de semana** no app: só a confirmação "semana aplicada".

Onde vive: **app** `/mnt/drivebackup/apps/openGym/openGym` (branch `emerson-custom`, React Vite +
Node `api`) e **Hermes** `~/.hermes/workout/scripts/hermes_api.py`, `~/.hermes/workout/{plans,jobs,proposals,reports}`,
`~/.hermes/profiles/treinador-api/`.

## Escopo

- **Inclui:** a entrada em `Plan`; a sheet com stepper, revisão e aplicar; o `hermes.js`; as chaves de
  tradução; o congelamento de envio no store; o serviço `hermes_api.py` (FastAPI 127.0.0.1 → bridge);
  o profile e a skill headless do motor; `web/nginx.conf`; `docker-compose.yml`; a regra de `ufw`;
  a unit `hermes-api.service`.
- **Não inclui:** BACKLOG-03 (meso pelo app); BACKLOG-01 (`unit` por exercício); BACKLOG-04 (feito);
  mover o treinador para Node; selo de semana; editar a skill global `~/.hermes/skills/...`
  (o profile tem cópia própria e é ela que vale); agendar datas futuras.

## Decisões assumidas

1. **O agente roda com toolset inerte `-t todo`.** Verificado: `validate_toolset("todo")` → `True`;
   `"none"`/`"empty"` → `False`, e `-t` sem nenhum válido é **erro**. O agente recebe todo o dado no
   prompt e devolve só JSON, então não precisa de ferramenta — e o `-z` **força YOLO**
   (`oneshot.py:197-199`), logo o toolset é a única contenção.
2. **Profile dedicado `treinador-api`** (isola `auth.lock`/`state.db`/memória do profile interativo).
3. **Skill headless `treino-coach-api`** sem o passo 6 (sync) e sem passos de ferramenta, com o
   contrato JSON — senão o agente tenta sincronizar sozinho ou responde "não tenho ferramentas".
4. **Um worker, geração serializada** (`ThreadPoolExecutor(max_workers=1)` + lock). A v4 pedia
   "workers 2+", o que só criaria coordenação entre processos para um único usuário.
5. **A semana-alvo é derivada no serviço** (lida de `mesociclo_ativo.json` com `flock`); o app não
   envia `meso_id` e o `hermes.js` **não** monta chave com ele.
6. **O app congela o envio durante o fluxo** — portão dentro de `pushState()` (não só em `persist`),
   porque o handler de `visibilitychange` também envia. Congelamento **com contador**, liberado num
   `finally`.
7. **"Você está treinando" é trava de app.** `PUT /api/data` faz `delete body.state.active`
   (`server.js:449`): o servidor **nunca** tem essa informação. O `409 WORKOUT_ACTIVE` do serviço é
   apenas defensivo e, na prática, nunca dispara (o estado relido não tem `active`) — fica
   documentado como tal, não como garantia.
8. **`exWeights` é escrito junto.** `buildSets`: `conf?.w > 0 ? conf.w : (usable ? usable.w : cfg.weight)`
   (`history.js:205`) — o caderno vence o template e o último treino. Sem ele a semana gerada aparece
   com as cargas antigas e o teste passa mesmo assim.
9. **Validação fail-closed**, agora com as formas reais (ver §8.5): catálogo é **lista**
   (`{x["id"] for x in cat}`, 1324 itens) e `customEx` é lista de **objetos** com `id`/`n`.
   Verificado: os 24 ids de catálogo + 5 `customEx` das 5 fichas **todos resolvem**.
10. **`0585`/`0599` e Leg Press são comparados com o valor atual da rotina**, não com constantes
    (`200`, `+5`). Isso elimina dependência de unidade e o risco de rejeitar valor legítimo.
11. **Correções de fato sobre a v4** — todas provadas por experimento, não por leitura:
    MAC do `gymsid` é **base64url sem padding** (hex ⇒ 401); expiração em **ms** (segundos ⇒ 401);
    valida-se `sv` e `disabled`; `PUT /api/data` **não lê `If-Match`** (a guarda é `state._ts`);
    `truncated` vive em **`meta.truncated`** e `?period=30d` **não existe**; `state.uid` **não existe**
    (vem de `GET /api/me`); o cookie é host-only e same-origin (nem `Domain` nem CORS são necessários).
12. **Rede: `extra_hosts` + bind no bridge + regra de `ufw`.** Medido: `host.docker.internal` não
    resolve; e o container **não alcança porta alguma do host** — `nc` na 22 (liberada no ufw) dá
    `rc=0`, na 8081/9000 dá `rc=1`, com `ufw` em `deny (incoming)`. Portanto: `extra_hosts` no serviço
    `web`, serviço escutando em `0.0.0.0:8091`, e
    `ufw allow from 172.16.0.0/12 to any port 8091 proto tcp` (nada exposto à LAN nem à Tailscale).
13. **Sem `slowapi`.** Verificado: o venv tem `fastapi 0.133.1`, `pydantic 2.13.4`, `uvicorn 0.41.0`,
    mas **não** tem `slowapi`. Rate limit é um limitador em memória por `uid`, sem dependência nova.
14. **`_ts` do `PUT` = `max(agora_ms, base_ts + 1)`.** O relógio do Pi pode estar atrás do último
    `_ts` gravado (que vem do browser); sem isso todo `apply` morreria em `409`.
15. **Recibo é best-effort.** `reports/sync_log.md` no diretório antigo é `root:root`; o serviço roda
    como `pi`. O recibo vai para um arquivo **do serviço** (`reports/micro/sync_log.md`) e falha de
    recibo **não** derruba o `apply` depois de o `PUT` ter passado.
16. **`_extract_json` por `raw_decode`**, não por "primeiro `{` … último `}`".
17. **A ordem "snapshot antes de tudo"** do RF-4 passa a ser: reler → checar `active` → checar `_ts`
    → **snapshot** → marcar intenção → montar → PUT → verificar (rollback se divergir) → recibo.
    O snapshot fica imediatamente antes da primeira escrita, que é o que importa.

## Requisitos Funcionais

**RF-1. Proposta assíncrona e idempotente.** `POST /propose` autenticado devolve
`202 {job_id,statusUrl,idempotencyKey}` em menos de 1 s e **não escreve nada no app**. Mesma
`Idempotency-Key` + mesmo `uid` ⇒ mesmo `job_id`. A chave do **servidor** é
`sha256(uid + ":" + semana + ":" + canonical(respostas))` — a do cliente é só dica e nunca é aceita
sem conferência contra o `uid`. `400 MISSING_ANSWERS` / `401 UNAUTH`.
Rate limit: 5 por minuto por `uid` ⇒ `429 RATE_LIMITED`.

**RF-2. Stepper bloqueante.** `canGenerate = motivo_carga.trim().length >= 10 && dor && sono`
(`estresse` opcional). Sem isso o `POST` não sai. Com `S.active` o botão fica desabilitado.

**RF-3. Acompanhamento.** `GET /status?job_id=` do **dono** (senão `404`) devolve
`{state, phase, progress, proposal?, error?}` + `Retry-After: 1`.
`state ∈ {queued, running, done, error}`; `phase ∈ {queued, lendo_dados, consultando_analise, gerando, validando, pronto, erro}`.
`proposal = {proposal_id, semana, semana_num, fase, periodo:{inicio,fim}, base_ts, dias:[{iso,dia,routine_id,routine_name,remaining}], changes:[{routine_id, ex_id, name, from:{sets,reps,weight}, to:{sets,reps,weight}, why}], notes:[], report_id}`.
Erros: `AGENT_FAILED`, `AGENT_INVALID_JSON`, `ANALYSIS_TRUNCATED`, `MESO_NOT_FOUND`, `MESO_STALE`,
`STATE_MISSING`, `ROUTINES_MISSING`, `WEEK_MISSING`, `SPEC_REJECTED`.

**RF-4. Aplicação.** Ordem exata (Decisão #17). Aborta `409` em `STATE_CHANGED` e `WORKOUT_ACTIVE`
(defensivo). Semana com `applied_at` e sem `confirm:true` ⇒ `409 WEEK_EXISTS`. Divergência na
verificação ⇒ **rollback** a partir do snapshot + `500 VERIFY_FAILED`. Recibo best-effort.
`200 {ok,ts,applied:{n_changes,n_exercises},snapshot_id,report_id}`.

**RF-5. Segurança.** `verify_gymsid` (base64url, ms, `uid`+`sv`+`disabled` de `db.json`) com
`hmac.compare_digest`. `/health` ⇒ `200 {"ok":true}` sem auth. `SECRET` nunca logado; respostas da
Fase 2 só como hash. Todos os endpoints autenticados conferem **dono** (`proposal.uid`,
`job.uid`, índice de relatórios) e devolvem `404` (não `403`) quando não é seu.
`report_id` validado por `^[A-Za-z0-9_-]{1,64}$`.

**RF-6. Relatório só no Hermes.** `reports/micro/<semana>_<AAAA-MM-DD>.html` (formato único), com
`data-testid="report-reason"` e um `data-ex-id` por exercício alterado, num `ul`. Servido por
`GET /api/hermes/reports/{report_id}.html` (autenticado + dono). `POST` devolve só `report_id`,
nunca caminho. O `why` de cada mudança aparece **também** no app.

**RF-7. Nada é escrito sem aplicar.** Entre `propose` e `apply`, o estado do app mantém o mesmo `_ts`
e o mesmo conteúdo das rotinas.

## Contratos

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/hermes/health` | — | `200 {ok:true}` |
| POST | `/api/hermes/micro/propose` | `{answers_fase2}` | `202 {job_id,statusUrl,idempotencyKey}` |
| GET | `/api/hermes/micro/status` | `?job_id=` | `200 {state,phase,progress,proposal?,error?}` |
| POST | `/api/hermes/micro/apply` | `{proposal_id,confirm}` | `200 {ok,ts,applied,snapshot_id,report_id}` |
| GET | `/api/hermes/reports/{id}.html` | — | `200 text/html` |

Nomes canônicos das respostas (iguais no app, no contrato e na validação):
`motivo_carga` (string 10..300), `dor` ∈ `nenhuma|ombro|lombar|cotovelo|outra`,
`sono` ∈ `bem|regular|ruim`, `estresse` ∈ `baixo|medio|alto` (opcional).

## Detalhe de Implementação (nível código)

### 1. `frontend/src/lib/api.js` — propagar o código do erro

```js
// ANTES (linhas 9-14)
export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}
```
```js
// DEPOIS
export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(data.error || data.msg || ('HTTP ' + r.status))
    e.status = r.status
    e.code = data.code || null        // o serviço devolve {code,msg}: sem isto o app só vê "HTTP 409"
    throw e
  }
  return data
}
```
> Aditivo e inócuo para os chamadores atuais (só acrescenta uma propriedade ao erro).

### 2. `frontend/src/lib/hermes.js` (novo)

```js
import { api } from './api.js'

// Assinatura canônica das respostas: chaves ordenadas recursivamente + trim/lower.
// É só uma DICA de idempotência — a chave que vale é calculada no serviço, com uid e semana.
export function canonicalAnswers(a) {
  const norm = v => {
    if (typeof v === 'string') return v.trim().toLowerCase()
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      const out = {}
      Object.keys(v).sort().forEach(k => {
        const val = v[k]
        if (val === undefined || val === null || val === '') return
        out[k] = norm(val)
      })
      return out
    }
    return v
  }
  return JSON.stringify(norm(a))
}

async function sha256Hex(str) {
  // crypto.subtle exige contexto seguro. O app também é servido em http://<host>:8081 pelo túnel,
  // onde ele não existe — por isso a ausência não pode quebrar nada: sem hash, sai sem o header
  // e o serviço calcula a chave sozinho (com uid e semana, que é o que impede colisão).
  if (!globalThis.crypto?.subtle) return ''
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function proposeMicro({ answers, signal }) {
  const headers = { 'Content-Type': 'application/json' }
  const key = await sha256Hex(canonicalAnswers(answers))
  if (key) headers['Idempotency-Key'] = key
  return api('/api/hermes/micro/propose', {
    method: 'POST', headers, body: JSON.stringify({ answers_fase2: answers }), signal
  })
}

export const microStatus = (jobId, signal) =>
  api('/api/hermes/micro/status?job_id=' + encodeURIComponent(jobId), { signal })

export const applyMicro = (proposalId, confirm) =>
  api('/api/hermes/micro/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposal_id: proposalId, confirm: !!confirm })
  })
```
> Sem `mesoId`: o app não conhece o meso (Decisão #5) e um parâmetro que ninguém fornece viraria
> código morto.
> `api()` faz `Object.assign({headers:{…}}, opts)` (`api.js:9`): passar `headers` **substitui** o
> default, por isso o `Content-Type` é repetido.

### 3. `frontend/src/store/useStore.js` — congelamento contado

**3.1 Flag (junto de `let pushTm = null` / `let saveTm = null`, ~linha 59):**
```js
  let pushTm = null
  let saveTm = null
  // Contador, não booleano: a sheet pode ser fechada e reaberta, e o cleanup do efeito não pode
  // descongelar um fluxo que ainda está correndo. Ver Decisões assumidas #6.
  let pushFrozen = 0
```

**3.2 `persist` (linha 74) — não agendar envio enquanto congelado:**
```js
// ANTES
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
```
```js
// DEPOIS
    if (push && get().user && !pushFrozen) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
```

**3.3 `pushState` (linha 123) — o portão que também cobre o `visibilitychange`:**
```js
// ANTES
    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
```
```js
// DEPOIS
    async pushState() {
      if (!get().user) return
      if (pushFrozen) return
      clearTimeout(pushTm)
```

**3.4 Ações novas:**
```js
    freezePush() { pushFrozen++ ; clearTimeout(pushTm); pushTm = null },
    unfreezePush() { pushFrozen = Math.max(0, pushFrozen - 1) },
```

**3.5 Recarregar:** usar `pullState()` (linha 159, condição real em 175):
`if (state && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty)))`. Depois da gravação o
`_ts` do servidor é maior e nada foi enviado no meio ⇒ o app adota o estado do servidor e preserva
`S.active` local.

### 4. `frontend/src/sheets.jsx` — `microSheet()` (novo)

```js
export const microSheet = () =>
  ui().openSheet(close => <Micro close={close} />, { kind: 'center', locked: true })
```
> `locked: true` é obrigatório e **verificado**: `useUI.js:26` declara
> `openSheet(render, { kind = 'sheet', locked = false } = {})` e `Modals.jsx:51,58` só fecha no
> clique fora `if (!sheet.locked)`. Sem ele, o UX prometeria algo falso ao dizer que nada é editável
> durante o fluxo. `openSheet` também devolve `{id, close, lock}`, então há a alternativa de travar
> só durante a fase de geração — a spec trava o tempo todo e deixa o `Cancelar` como saída.

```jsx
function Micro({ close }) {
  const S = useStore(s => s.S)
  const [step, setStep] = useState('form')      // form | running | review | done
  const [answers, setAnswers] = useState({ motivo_carga: '', dor: null, sono: null, estresse: null })
  const [proposal, setProposal] = useState(null)
  const [phase, setPhase] = useState(null)
  const [err, setErr] = useState(null)
  const ctl = useRef(null)
  const frozen = useRef(false)

  const canGenerate = answers.motivo_carga.trim().length >= 10 && !!answers.dor && !!answers.sono

  // Sempre descongela exatamente o que congelou, mesmo desmontando no meio.
  const freeze = () => { if (!frozen.current) { useStore.getState().freezePush(); frozen.current = true } }
  const unfreeze = () => { if (frozen.current) { useStore.getState().unfreezePush(); frozen.current = false } }

  useEffect(() => () => { ctl.current?.abort(); unfreeze() }, [])

  async function run() {
    setErr(null); setStep('running'); freeze()
    ctl.current = new AbortController()
    const { signal } = ctl.current
    try {
      const job = await proposeMicro({ answers, signal })
      // Teto de ~10 min: sem isto, um job preso em `running` deixaria o app congelado para sempre.
      const deadline = Date.now() + 10 * 60 * 1000
      let st
      do {
        if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'ABORTED' })
        await new Promise(r => setTimeout(r, 1500))
        st = await microStatus(job.job_id, signal)
        setPhase(st.phase)
      } while (st.state !== 'done' && st.state !== 'error' && Date.now() < deadline)
      if (st.state === 'error') { setErr(st.error); setStep('form'); return }
      if (st.state !== 'done') { setErr({ code: 'TIMEOUT', msg: t('The engine is taking too long.') }); setStep('form'); return }
      setProposal(st.proposal); setStep('review')
    } catch (e) {
      if (e.code === 'ABORTED') return
      setErr(mapErr(e)); setStep('form')
    } finally {
      unfreeze()
    }
  }

  async function apply(confirm) {
    setErr(null); setStep('running'); freeze()
    try {
      await applyMicro(proposal.proposal_id, confirm)
      await pullState()
      setStep('done')
    } catch (e) {
      if (e.code === 'WEEK_EXISTS') { setErr(e); setStep('review'); return }
      setErr(mapErr(e)); setStep('review')
    } finally { unfreeze() }
  }

  const mapErr = e => ({
    code: e.code || 'HTTP',
    msg: e.code === 'RATE_LIMITED' ? t('Too many attempts. Wait a minute.')
       : e.code === 'STATE_CHANGED' ? t('Your data changed while the plan was being made. Nothing was changed — try again.')
       : e.status === 401 ? t('Session expired.')
       : t('The engine failed. Nothing was changed.')
  })
  // render por step: 'form' → 'running' (com phase/progress) → 'review' (lista from → to + dias restantes) → 'done'
  // em 'review' com err.code === 'WEEK_EXISTS' → confirmSheet antes de reenviar com { confirm: true }
}
```
> `e.code` agora existe porque a §1 propaga `data.code`. Sem isso, `e.message` é literalmente
> `HTTP 409` e nenhum teste por regex funcionaria.

### 5. `frontend/src/views/Plan.jsx` — a entrada

```jsx
// ANTES (linha 5)
import { dayAssignSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
```
```jsx
// DEPOIS
import { dayAssignSheet, loadStarterPlan, planToolsSheet, microSheet } from '../sheets.jsx'
```
```jsx
// ANTES (linhas 20-23)
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
```
```jsx
// DEPOIS
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <div className="row">
        <Button size="sm" variant="tinted" icon="sparkles" disabled={!!S.active}
          title={S.active ? t('Finish your workout first') : t('Generate next week')}
          onClick={microSheet}>{t('Next week')}</Button>
        <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
      </div>
    </div>
```
> Usa `row` (já usado no próprio arquivo, linha 58), não `hrow`.

### 6. `frontend/src/locales/pt.js` — chaves novas

**Verificado por script contra `pt.js`:** já existem e **não devem ser duplicadas**:
`'Lower back'` → `'Lombar'` e `'Today'` → `'Hoje'`. As demais do bloco abaixo não existem ainda
(checagem por regex de chave, não por substring: `'OK'`, `'None'`, `'Pain'` etc. foram conferidas
individualmente). Acrescentar só o que falta:

```js
  'Next week': 'Próxima semana',
  'Generate next week': 'Gerar próxima semana',
  'Finish your workout first': 'Termina o treino primeiro',
  'How did the load feel?': 'Como foi a carga?',
  'Why did any load drop, or what changed?': 'Por que alguma carga caiu, ou o que mudou?',
  'At least 10 characters.': 'Pelo menos 10 caracteres.',
  'Pain': 'Dor', 'None': 'Nenhuma', 'Shoulder': 'Ombro',
  'Elbow': 'Cotovelo', 'Other': 'Outra',
  'Sleep': 'Sono', 'Good': 'Bem', 'OK': 'Regular', 'Bad': 'Ruim',
  'Stress': 'Estresse', 'Medium': 'Médio', 'High': 'Alto', 'Optional': 'Opcional',
  'The engine is reading your data…': 'O motor está a ler os teus dados…',
  'Answer pain and sleep.': 'Responde dor e sono.',
  'What changes next week': 'O que muda na próxima semana',
  'This week was already generated. Applying again replaces it.': 'Esta semana já foi gerada. Aplicar de novo substitui-a.',
  'Week applied.': 'Semana aplicada.',
  'The engine failed. Nothing was changed.': 'O motor falhou. Nada foi alterado.',
  'The engine is taking too long.': 'O motor está a demorar demais.',
  'Too many attempts. Wait a minute.': 'Tentativas demais. Espera um minuto.',
  'Your data changed while the plan was being made. Nothing was changed — try again.':
    'Os teus dados mudaram enquanto o plano era feito. Nada foi alterado — tenta de novo.',
  'Many sessions — the analysis came back partial. Try again later.':
    'Muitas sessões — a análise veio parcial. Tenta mais tarde.',
```

### 7. `web/nginx.conf` — proxy (nos **dois** `server`, 9000 e 8081)

> ### 🔴 ORDEM DE APLICAÇÃO OBRIGATÓRIA — risco de derrubar o app inteiro
>
> Medido em container descartável, na rede `opengym_default`, com a imagem de produção
> `opengym-web:local` e o conf já com este patch:
>
> | Cenário | Resultado |
> |---|---|
> | conf com `host.docker.internal` e **sem** `extra_hosts` | `[emerg] host not found in upstream "host.docker.internal"` ⇒ **nginx não inicia** |
> | conf com o patch **e** com `extra_hosts` | `syntax is ok` / `test is successful` |
>
> O nginx resolve o nome do `proxy_pass` **na partida**: não é um erro de sintaxe que passe
> despercebido — o container `web` morre e **o app inteiro sai do ar**, não só a feature nova.
> Portanto: **`extra_hosts` no `docker-compose.yml` e o patch em `web/nginx.conf` sobem na MESMA
> aplicação** (`docker compose up -d --build web`), nunca em duas etapas. Antes de subir:
> `docker exec opengym-web-1 nginx -t` no container atual para ter a linha de base, e validar o
> conf novo num container descartável antes de recriar o de produção.
> Rollback: reverter `web/nginx.conf` e o compose, e `docker compose up -d --build web`.

```nginx
    # O motor vive no host, fora do Docker. Dois motivos medidos: (1) o container não resolve
    # host.docker.internal sem extra_hosts; (2) o ufw nega tráfego do container para o host
    # (porta 22 liberada conecta, 8081/9000 sem regra falham).
    # Precedência: `location /api/hermes/` (prefixo mais longo) vence `location /api/` — os dois
    # blocos NÃO se encadeiam; este é autônomo.
    location /api/hermes/ {
        proxy_pass http://host.docker.internal:8091;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Cookie $http_cookie;
        proxy_read_timeout 30s;
    }
```

### 8. `docker-compose.yml` — `extra_hosts` no serviço `web`

```yaml
  web:
    image: opengym-web:local
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"   # Linux precisa disto explícito
```

**Validado:** o patch foi aplicado numa cópia do compose dentro do repo (`.dc-test.yml`, para que
`env_file: .env` e o contexto `./api` resolvessem igual) e passou por
`docker compose -f .dc-test.yml config` com **exit 0**, resolvendo
`extra_hosts: - host.docker.internal=host-gateway` no serviço `web`. A cópia foi removida e o
`docker-compose.yml` real não foi tocado.

E a regra de firewall (fora do compose, aplicada uma vez):
```bash
sudo ufw allow from 172.16.0.0/12 to any port 8091 proto tcp comment 'openGym trainer engine (docker bridge only)'
```
O serviço escuta em **`0.0.0.0:8091`** (não `127.0.0.1`): o container chega pelo IP do bridge, e o
ufw é quem escopa o acesso.

### 9. `~/.hermes/workout/scripts/hermes_api.py` (novo — arquivo completo)

```python
#!/usr/bin/env python3
"""Motor do micro via app — app como interface, Hermes como motor e como quem grava.

Nunca escreve no app sem um POST /apply explicito. A gravacao segue a receita endurecida
do passo 6 da skill treino-coach (snapshot, re-relitura, checagem de _ts, exWeights,
conferencia campo a campo, recibo) em codigo deterministico, nao a cargo do agente.
"""
from __future__ import annotations

import base64
import fcntl
import hashlib
import hmac
import json
import os
import re
import subprocess
import threading
import time
import uuid
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from urllib import error as urlerror
from urllib import request as urlrequest
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse

OG_DATA = "/mnt/drivebackup/apps/openGym/data"
CATALOG = "/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json"
WORKOUT = "/home/pi/.hermes/workout"
PLANS = f"{WORKOUT}/plans/mesociclo_ativo.json"
JOBS = f"{WORKOUT}/jobs"
KEYS = f"{JOBS}/keys.json"
PROPOSALS = f"{WORKOUT}/proposals"
REPORTS = f"{WORKOUT}/reports/micro"
SYNC_LOG = f"{REPORTS}/sync_log.md"
ENV_FILE = "/home/pi/.hermes/hermes.env"
TZ = ZoneInfo("America/Sao_Paulo")
API_BASE = "http://localhost:8081"
HERMES_BIN = "/home/pi/.hermes/hermes-agent/venv/bin/hermes"
PROFILE = "treinador-api"
MODEL = "opencode-go/muse-spark-1.3-contributor"
PROVIDER = "opencode-go"
TOOLSETS = "todo"                 # inerte, e o MENOR valido: -t vazio e erro (Decisao #1)
AGENT_TIMEOUT = 900
JOB_TTL = 24 * 3600
JSON_WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
REPS_FLOOR, REPS_CEIL = 6, 8
LEGPRESS_MAX_STEP = 5.0

PROMPT_HEADER = """Voce e o Treinador Low Volume do Emerson. Receba o contexto em JSON e devolva
APENAS um objeto JSON, sem texto antes nem depois, sem cercas de codigo.

Nao use ferramenta alguma. Nao grave nada, nao sincronize nada, nao leia arquivo: a gravacao e
feita por outro processo. Sua unica saida e o JSON abaixo.

Regras inegociaveis: reps 6-8 em tudo; series 2-3 em semana normal; maquinas 0 RIR, livres 1-2 RIR,
supino >= 2 RIR; deload = -40% series, reps mantidas 6-8, 1-2 RIR; zero carga axial (hernia);
progressao de +2,5-5% SO quando todas as series fecharam no topo; perda de reps no mesmo peso em 2
sessoes = recuar 5%; Leg Press sobe no maximo 5 kg por semana; 0585 e 0599 ficam em 200 lbs e nao
mudam; continuidade total, nunca trocar exercicio.

Formato exato:
{"semana":"S3","fase":"...","changes":[{"routine_id":"r_push_C_20260829","ex_id":"0584",
"name":"lever lateral raise","from":{"sets":3,"reps":"6-8","weight":45},
"to":{"sets":3,"reps":"6-8","weight":47.5},"why":"..."}],"notes":["..."]}

Inclua TODOS os exercicios das 5 rotinas, inclusive os que mantem carga (to == from), para o app
poder mostrar "mantem". Contexto:
"""

class SpecError(Exception):
    """Erro de dominio com codigo estavel para o app."""

    def __init__(self, code: str, msg: str = ""):
        super().__init__(msg or code)
        self.code = code


app = FastAPI()
_exec = ThreadPoolExecutor(max_workers=1)
_idx_lock = threading.Lock()
_rate_lock = threading.Lock()
_rate: dict[str, deque] = defaultdict(deque)
_cat_ids: set[str] | None = None

def _bootstrap() -> None:
    for d in (JOBS, PROPOSALS, REPORTS):
        os.makedirs(d, exist_ok=True)

def _gc_jobs() -> None:
    """Expira jobs e chaves com mais de 24 h (promessa de Persistencia)."""
    now = time.time()
    for name in os.listdir(JOBS) if os.path.isdir(JOBS) else []:
        p = os.path.join(JOBS, name)
        if name == "keys.json" or not name.endswith(".json"):
            continue
        try:
            if now - os.path.getmtime(p) > JOB_TTL:
                os.unlink(p)
        except OSError:
            pass
    if os.path.exists(KEYS):
        try:
            idx = _read_json(KEYS)
            fresh = {k: v for k, v in idx.items() if now - v.get("created_at", 0) < JOB_TTL}
            if len(fresh) != len(idx):
                _write_json(KEYS, fresh)
        except Exception:  # noqa: BLE001
            pass

@asynccontextmanager
async def lifespan(_app):
    _bootstrap()
    _gc_jobs()
    yield

app.router.lifespan_context = lifespan   # equivalente a FastAPI(lifespan=lifespan), que exigiria
                                          # declarar o lifespan antes do app

# --- JSON com lock real ------------------------------------------------------

def _read_json(path: str) -> dict:
    """Le com flock compartilhado. 'a+' cria se faltar e permite ler/escrever."""
    with open(path, "a+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_SH)
        try:
            f.seek(0)
            raw = f.read()
            return json.loads(raw) if raw.strip() else {}
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)

def _write_json(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.seek(0)
            f.truncate()
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)

def _update_json(path: str, patch: dict) -> dict:
    with open(path, "a+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.seek(0)
            raw = f.read()
            cur = json.loads(raw) if raw.strip() else {}
            cur.update(patch)
            f.seek(0)
            f.truncate()
            json.dump(cur, f, ensure_ascii=False)
            f.flush()
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
    return cur

# --- auth -------------------------------------------------------------------

def _secret() -> str:
    if os.path.exists(ENV_FILE) and os.access(ENV_FILE, os.R_OK):
        for line in open(ENV_FILE, encoding="utf-8"):
            if line.startswith("SECRET="):
                return line.split("=", 1)[1].strip()
    try:
        return open(f"{OG_DATA}/secret", encoding="utf-8").read().strip()
    except PermissionError:
        return subprocess.check_output(["sudo", "cat", f"{OG_DATA}/secret"], text=True).strip()

def _users() -> list:
    return _read_json(f"{OG_DATA}/db.json").get("users", [])

def verify_gymsid(token: str | None) -> dict | None:
    """Mesmo esquema do server.js: `<uid>:<exp_ms>:<sv>` + '.' + HMAC-SHA256 base64url sem padding."""
    if not token:
        return None
    i = token.rfind(".")
    if i < 0:
        return None
    payload, mac = token[:i], token[i + 1:]
    expect = base64.urlsafe_b64encode(
        hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    if not hmac.compare_digest(mac, expect):
        return None
    parts = payload.split(":")
    uid = parts[0] if parts else ""
    exp = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    ver = int(parts[2]) if len(parts) > 2 and parts[2].lstrip("-").isdigit() else 0
    if not uid or exp < int(time.time() * 1000):        # ms, nao segundos
        return None
    user = next((u for u in _users() if u.get("id") == uid), None)
    if not user or user.get("disabled"):
        return None
    if ver != int(user.get("sv") or 0):                 # revogacao por POST /api/logout/all
        return None
    return user

def _user_of(request: Request) -> dict | None:
    return verify_gymsid(request.cookies.get("gymsid"))

def _rate_ok(uid: str, limit: int = 5, window: int = 60) -> bool:
    now = time.time()
    with _rate_lock:
        q = _rate[uid]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True

# --- ponte com o app --------------------------------------------------------

def _forge(uid: str) -> str:
    user = next((u for u in _users() if u.get("id") == uid), {})
    exp = int(time.time() * 1000) + 300_000
    payload = f"{uid}:{exp}:{int(user.get('sv') or 0)}"
    mac = base64.urlsafe_b64encode(
        hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{payload}.{mac}"

def _call(uid: str, path: str, method: str = "GET", body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urlrequest.Request(API_BASE + path, data=data, method=method,
                             headers={"Content-Type": "application/json",
                                      "Cookie": f"gymsid={_forge(uid)}"})
    try:
        with urlrequest.urlopen(req, timeout=15) as r:
            return r.status, json.load(r)
    except urlerror.HTTPError as e:
        if e.code == 409:
            raise SpecError("STATE_CHANGED") from e
        raise SpecError("APP_HTTP_%d" % e.code) from e
    except Exception as e:  # noqa: BLE001
        raise SpecError("APP_UNREACHABLE", str(e)) from e

def get_state(uid: str) -> dict:
    _, out = _call(uid, "/api/data")
    state = out.get("state")
    if not isinstance(state, dict):
        raise SpecError("STATE_MISSING")
    if not state.get("routines"):
        raise SpecError("ROUTINES_MISSING")
    if not state.get("week"):
        raise SpecError("WEEK_MISSING")
    return state

def get_analysis(uid: str) -> dict:
    """So a base local: o servico roda no MESMO host do nginx, e a 8081 esta publicada.

    Nao ha fallback para a URL publica: a iteracao anterior caia num ramo que devolvia None
    quando a primeira base falhava, e o None explodia depois em `analysis.get(...)`.
    """
    _, out = _call(uid, "/api/coach/analysis")
    if not isinstance(out, dict) or not isinstance(out.get("analysis"), dict):
        raise SpecError("ANALYSIS_MISSING")
    if (out.get("meta") or {}).get("truncated"):
        raise SpecError("ANALYSIS_TRUNCATED")
    return out

# --- semana-alvo ------------------------------------------------------------

def _meso() -> dict:
    return _read_json(PLANS)

def proxima_semana(meso: dict, hoje) -> dict:
    """A semana do meso e a janela que contem hoje; o micro e a SEGUINTE.

    As janelas do meso NAO sao ISO (ex.: 2026-09-08 a 2026-09-14, Ter->Seg), entao casa-se
    por data. Se hoje estiver fora de todas, usa a ultima janela que ja terminou.
    """
    semanas = sorted([s for s in (meso.get("semanas") or []) if s.get("periodo")],
                     key=lambda s: s.get("semana") or 0)
    if not semanas:
        raise SpecError("MESO_NOT_FOUND")
    atual = None
    for s in semanas:
        ini, _, fim = (s["periodo"] + " a ").partition(" a ")
        if ini and fim and ini.strip() <= hoje.isoformat() <= fim.strip():
            atual = s
            break
    if atual is None:
        passadas = [s for s in semanas if s["periodo"].split(" a ")[-1] < hoje.isoformat()]
        atual = passadas[-1] if passadas else semanas[0]
    nxt = next((s for s in semanas if (s.get("semana") or 0) == (atual.get("semana") or 0) + 1), None)
    if nxt is None:
        raise SpecError("MESO_STALE", "semana seguinte a %s nao existe no meso" % atual.get("semana"))
    ini, _, fim = (nxt["periodo"] + " a ").partition(" a ")
    return {"semana_num": nxt.get("semana"), "semana": "S%s" % nxt.get("semana"),
            "fase": nxt.get("fase") or "", "periodo": {"inicio": ini.strip(), "fim": fim.strip()},
            "atual": atual.get("semana"), "status": nxt.get("status")}

def _dias_de_treino(state: dict, semana: dict, hoje) -> list:
    """Deriva as datas do calendario REAL, dentro da janela da semana do meso.

    `S.week` usa a semantica do JS (0=Domingo). Nao se soma o indice a um inicio qualquer:
    as janelas do meso comecam em terca, e somar deslocaria tudo em dois dias.
    """
    ini = datetime.fromisoformat(semana["periodo"]["inicio"]).date()
    fim = datetime.fromisoformat(semana["periodo"]["fim"]).date()
    rots = {r["id"]: r for r in state["routines"]}
    out = []
    d = ini
    while d <= fim:
        js_wd = (d.weekday() + 1) % 7                 # Python: Mon=0 -> JS: Sun=0
        rid = state["week"].get(str(js_wd)) or state["week"].get(js_wd)
        if rid and rid in rots:
            out.append({"dia": JSON_WD[js_wd], "iso": d.isoformat(), "routine_id": rid,
                        "routine_name": rots[rid].get("name"), "remaining": d >= hoje})
        d += timedelta(days=1)
    return out

# --- catalogo ---------------------------------------------------------------

def _catalogo() -> set:
    global _cat_ids
    if _cat_ids is None:
        cat = json.load(open(CATALOG, encoding="utf-8"))   # LISTA de 1324 objetos
        _cat_ids = {str(x["id"]) for x in cat if isinstance(x, dict) and "id" in x}
    return _cat_ids

def _custom_ids(state: dict) -> set:
    return {str(x.get("id")) for x in (state.get("customEx") or []) if isinstance(x, dict)}

# --- agente -----------------------------------------------------------------

def _extract_json(txt: str) -> str:
    """raw_decode a partir do primeiro '{': resiste a cercas de codigo e a texto ao redor."""
    start = txt.find("{")
    if start < 0:
        raise SpecError("AGENT_INVALID_JSON", "sem objeto JSON na resposta")
    try:
        obj, _ = json.JSONDecoder().raw_decode(txt[start:])
    except ValueError as e:
        raise SpecError("AGENT_INVALID_JSON", str(e)) from e
    return json.dumps(obj)

def _gerar(contexto: dict) -> dict:
    usage = os.path.join(JOBS, "usage-%s.json" % uuid.uuid4().hex[:8])
    args = [HERMES_BIN, "-p", PROFILE, "-z", PROMPT_HEADER + json.dumps(contexto, ensure_ascii=False),
            "-m", MODEL, "--provider", PROVIDER, "-t", TOOLSETS, "--usage-file", usage]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=AGENT_TIMEOUT)
    except subprocess.TimeoutExpired as e:
        raise SpecError("AGENT_FAILED", "timeout de %ds" % AGENT_TIMEOUT) from e
    if proc.returncode != 0:
        raise SpecError("AGENT_FAILED", (proc.stderr or "")[-300:])
    if not proc.stdout.strip():
        raise SpecError("AGENT_FAILED", "resposta vazia")
    return json.loads(_extract_json(proc.stdout))

# --- validacao fail-closed --------------------------------------------------

def _parse_reps(reps) -> tuple[int, int | None]:
    s = str(reps).strip()
    lo, _, hi = s.partition("-")
    if not lo.isdigit() or (hi and not hi.isdigit()):
        raise SpecError("SPEC_REJECTED", "reps nao numerico: %s" % s)
    return int(lo), (int(hi) if hi else None)

def validar(resp: dict, state: dict, semana: dict, dias: list) -> list:
    rots = {r["id"]: r for r in state["routines"]}
    exok = {rid: {str(e["id"]) for e in (r.get("ex") or [])} for rid, r in rots.items()}
    ids_validos = _catalogo() | _custom_ids(state)
    deload = "deload" in (semana.get("fase") or "").lower()
    mudancas, vistos, por_ex = [], set(), {}

    for c in resp.get("changes") or []:
        rid = c.get("routine_id")
        eid = str(c.get("ex_id"))
        if rid not in rots:
            raise SpecError("SPEC_REJECTED", "rotina desconhecida: %s" % rid)
        if eid not in exok.get(rid, set()):
            raise SpecError("SPEC_REJECTED", "exercicio %s nao pertence a %s" % (eid, rid))
        if eid not in ids_validos:
            raise SpecError("SPEC_REJECTED", "exercicio fora do catalogo: %s" % eid)
        to = c.get("to") or {}
        sets, peso = to.get("sets"), to.get("weight")
        lo, hi = _parse_reps(to.get("reps"))
        if not isinstance(sets, int) or not 1 <= sets <= 6:
            raise SpecError("SPEC_REJECTED", "series fora de 1..6: %s=%s" % (eid, sets))
        if not isinstance(peso, (int, float)) or peso < 0:
            raise SpecError("SPEC_REJECTED", "peso invalido: %s=%s" % (eid, peso))
        if lo < REPS_FLOOR or lo > REPS_CEIL or (hi is not None and hi > REPS_CEIL):
            raise SpecError("SPEC_REJECTED", "reps fora de 6-8: %s=%s" % (eid, to.get("reps")))
        atual = next(e for e in rots[rid]["ex"] if str(e["id"]) == eid)
        atual_sets = int(atual.get("sets") or 0)
        atual_peso = float(atual.get("weight") or 0)
        if deload and atual_sets and sets > atual_sets:
            raise SpecError("SPEC_REJECTED", "deload subiu series: %s %s->%s" % (eid, atual_sets, sets))
        if eid == "0739" and peso - atual_peso > LEGPRESS_MAX_STEP:
            raise SpecError("SPEC_REJECTED",
                            "Leg Press acima do teto de +5 kg: %s->%s" % (atual_peso, peso))
        if eid in ("0585", "0599") and abs(peso - atual_peso) > 0.001:
            raise SpecError("SPEC_REJECTED", "%s e 200 lbs e nao muda: %s->%s" % (eid, atual_peso, peso))
        # O mesmo exercicio aparece em varias rotinas: o alvo tem de ser coerente.
        alvo = (sets, str(to.get("reps")), float(peso))
        if eid in por_ex and por_ex[eid] != alvo:
            raise SpecError("SPEC_REJECTED", "alvos divergentes para %s em rotinas diferentes" % eid)
        por_ex[eid] = alvo
        if (rid, eid) in vistos:
            raise SpecError("SPEC_REJECTED", "exercicio repetido: %s/%s" % (rid, eid))
        vistos.add((rid, eid))
        mudancas.append({"routine_id": rid, "ex_id": eid, "name": c.get("name") or atual.get("n"),
                         "from": {"sets": atual_sets, "reps": str(atual.get("reps")),
                                  "weight": atual_peso},
                         "to": {"sets": sets, "reps": str(to.get("reps")), "weight": float(peso)},
                         "why": c.get("why") or ""})
    if not mudancas:
        raise SpecError("SPEC_REJECTED", "proposta sem exercicio algum")
    return mudancas

# --- proposta ---------------------------------------------------------------

def _contexto(meso: dict, semana: dict, state: dict, analysis: dict, ans: dict, dias: list) -> dict:
    rots = []
    for rid in [d["routine_id"] for d in dias]:
        r = next(x for x in state["routines"] if x["id"] == rid)
        rots.append({"routine_id": rid, "name": r.get("name"),
                     "ex": [{"id": str(e["id"]), "sets": e.get("sets"), "reps": str(e.get("reps")),
                             "weight": e.get("weight")} for e in (r.get("ex") or [])]})
    prog = analysis.get("progress") or {}
    hist = {str(k): v[-4:] for k, v in prog.items() if isinstance(v, list)}
    return {"hoje": datetime.now(TZ).date().isoformat(), "semana": semana, "dias": dias,
            "objetivo": meso.get("objetivo"), "regras_globais": meso.get("regras_globais"),
            "prioridades": meso.get("prioridades"), "rotinas": rots,
            "historico_recente": hist, "respostas_fase2": ans}

def _rodar_proposta(jid: str, uid: str, ans: dict, key: str) -> None:
    try:
        _update_json(os.path.join(JOBS, jid + ".json"),
                     {"state": "running", "phase": "lendo_dados", "progress": 10})
        hoje = datetime.now(TZ).date()
        meso = _meso()
        semana = proxima_semana(meso, hoje)
        _update_json(os.path.join(JOBS, jid + ".json"),
                     {"phase": "consultando_analise", "progress": 30, "semana": semana["semana"]})
        state = get_state(uid)
        analysis = get_analysis(uid)
        dias = _dias_de_treino(state, semana, hoje)
        if not dias:
            raise SpecError("WEEK_MISSING", "S.week sem dia de treino na janela da semana")
        _update_json(os.path.join(JOBS, jid + ".json"), {"phase": "gerando", "progress": 55})
        resp = _gerar(_contexto(meso, semana, state, analysis, ans, dias))
        _update_json(os.path.join(JOBS, jid + ".json"), {"phase": "validando", "progress": 85})
        mudancas = validar(resp, state, semana, dias)
        pid = "prop-" + uuid.uuid4().hex[:12]
        report_id = "%s_%s" % (semana["semana"], semana["periodo"]["inicio"])
        prop = {"proposal_id": pid, "uid": uid, "key": key, "semana": semana["semana"],
                "semana_num": semana["semana_num"], "fase": semana["fase"],
                "periodo": semana["periodo"], "dias": dias, "changes": mudancas,
                "notes": [str(n) for n in (resp.get("notes") or [])],
                "base_ts": int(state.get("_ts") or 0), "report_id": report_id,
                "created_at": time.time(), "applied_at": None}
        _write_json(os.path.join(PROPOSALS, pid + ".json"), prop)
        _update_json(os.path.join(REPORTS, "index.json"), {report_id: {"uid": uid}})
        _update_json(os.path.join(JOBS, jid + ".json"),
                     {"state": "done", "phase": "pronto", "progress": 100,
                      "proposal": {k: prop[k] for k in
                                   ("proposal_id", "semana", "semana_num", "fase", "periodo",
                                    "dias", "changes", "notes", "report_id")}})
    except SpecError as e:
        _update_json(os.path.join(JOBS, jid + ".json"),
                     {"state": "error", "phase": "erro", "error": {"code": e.code, "msg": str(e)[:400]}})
    except Exception as e:  # noqa: BLE001
        _update_json(os.path.join(JOBS, jid + ".json"),
                     {"state": "error", "phase": "erro",
                      "error": {"code": "AGENT_FAILED", "msg": str(e)[:400]}})

def _validar_respostas(ans) -> str | None:
    if not isinstance(ans, dict):
        return "answers_fase2 ausente"
    motivo = ans.get("motivo_carga")
    if not isinstance(motivo, str) or not 10 <= len(motivo.strip()) <= 300:
        return "motivo_carga precisa de 10 a 300 caracteres"
    if ans.get("dor") not in ("nenhuma", "ombro", "lombar", "cotovelo", "outra"):
        return "dor invalida"
    if ans.get("sono") not in ("bem", "regular", "ruim"):
        return "sono invalido"
    if ans.get("estresse") not in (None, "baixo", "medio", "alto"):
        return "estresse invalido"
    return None

def _chave(uid: str, semana: str, ans: dict) -> str:
    canon = json.dumps(ans, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(("%s:%s:%s" % (uid, semana, canon)).encode()).hexdigest()

# --- gravacao (receita endurecida) ------------------------------------------

def _verificar(uid: str, prop: dict) -> None:
    ver = get_state(uid)
    rots = {r["id"]: r for r in ver["routines"]}
    exw = ver.get("exWeights") or {}
    for c in prop["changes"]:
        ex = next(e for e in rots[c["routine_id"]]["ex"] if str(e["id"]) == c["ex_id"])
        got = (int(ex.get("sets") or 0), str(ex.get("reps")), float(ex.get("weight") or 0))
        want = (c["to"]["sets"], str(c["to"]["reps"]), float(c["to"]["weight"]))
        if got != want:
            raise SpecError("VERIFY_FAILED", "%s: %s != %s" % (c["ex_id"], got, want))
        if float((exw.get(c["ex_id"]) or {}).get("w", -1)) != want[2]:
            raise SpecError("VERIFY_FAILED", "exWeights de %s nao bate" % c["ex_id"])

def _rollback(uid: str, snap_path: str) -> None:
    snap = _read_json(snap_path)
    snap["_ts"] = int(time.time() * 1000)
    _call(uid, "/api/data", method="PUT", body={"state": snap})

def _recibo(prop: dict, ts: int, snap: str) -> None:
    """Best-effort: o PUT ja passou, entao falhar aqui nao pode derrubar o apply."""
    try:
        line = "| %s | %s | %s | %s | %s | %s |\n" % (
            datetime.now(TZ).isoformat(timespec="seconds"), prop["proposal_id"], prop["semana"],
            ts, len(prop["changes"]), os.path.basename(snap))
        novo = not os.path.exists(SYNC_LOG)
        with open(SYNC_LOG, "a", encoding="utf-8") as f:
            if novo:
                f.write("| quando | proposta | semana | _ts | mudancas | snapshot |\n")
                f.write("|---|---|---|---|---|---|\n")
            f.write(line)
    except OSError as e:
        print("[sync] recibo falhou: %s" % e)

def _html_semana(prop: dict) -> str:
    rows = "".join(
        '<li data-ex-id="%s"><b>%s</b> (%s): %s &rarr; %s series, %s reps, %s kg'
        '<br><span data-testid="report-ex-why">%s</span></li>'
        % (c["ex_id"], c["name"] or c["ex_id"], c["routine_id"], c["from"]["sets"], c["to"]["sets"],
           c["to"]["reps"], c["to"]["weight"], c["why"])
        for c in prop["changes"])
    html = ("<!doctype html><meta charset=utf-8><title>Por que %s</title>"
            "<h1>Por que %s</h1><p data-testid=\"report-reason\">%s &middot; %s a %s</p>"
            "<ul>%s</ul>%s" % (
                prop["semana"], prop["semana"], prop["fase"], prop["periodo"]["inicio"],
                prop["periodo"]["fim"], rows,
                "<ul>%s</ul>" % "".join("<li>%s</li>" % n for n in prop["notes"])))
    _write_json(os.path.join(PROPOSALS, prop["proposal_id"] + ".json"), prop)  # mantem coeso
    with open(os.path.join(REPORTS, prop["report_id"] + ".html"), "w", encoding="utf-8") as f:
        f.write(html)
    return prop["report_id"]

def _marcar(pid: str, **patch) -> dict:
    return _update_json(os.path.join(PROPOSALS, pid + ".json"), patch)

def aplicar(uid: str, prop: dict) -> dict:
    state = get_state(uid)                                    # 1. reler fresco
    if state.get("active"):                                   # 2. defensivo (nunca chega do app)
        raise SpecError("WORKOUT_ACTIVE")
    base_ts = int(state.get("_ts") or 0)
    if base_ts != int(prop.get("base_ts") or 0):              # 3. estado mudou desde a proposta
        raise SpecError("STATE_CHANGED")
    snap = os.path.join(REPORTS, "sync_snapshot_%d.json" % int(time.time()))
    _write_json(snap, state)                                  # 4. snapshot ANTES de escrever
    _marcar(prop["proposal_id"], applying_at=time.time())      # 5. intencao antes do PUT

    novo = json.loads(json.dumps(state))                       # copia profunda
    hoje = datetime.now(TZ).date().isoformat()
    exw = dict(novo.get("exWeights") or {})
    for c in prop["changes"]:
        ex = next(e for e in next(r for r in novo["routines"] if r["id"] == c["routine_id"])["ex"]
                  if str(e["id"]) == c["ex_id"])
        ex["sets"], ex["reps"], ex["weight"] = c["to"]["sets"], c["to"]["reps"], c["to"]["weight"]
        exw[c["ex_id"]] = {"w": c["to"]["weight"], "d": hoje}   # 6. senao o template e inocuo
    novo["exWeights"] = exw
    novo.pop("active", None)
    # `workouts[]` NAO e reconstruido: a base do PUT e o proprio estado do servidor, entao a
    # uniao exigida pela receita ja esta satisfeita por construcao. Nunca se copia estado local.
    novo["_ts"] = max(int(time.time() * 1000), base_ts + 1)     # relogio do Pi pode estar atras

    try:
        _call(uid, "/api/data", method="PUT", body={"state": novo})    # 7.
        _verificar(uid, prop)                                          # 8.
    except SpecError as e:
        try:
            _rollback(uid, snap)
        finally:
            _marcar(prop["proposal_id"], applying_at=None)
        raise SpecError(e.code, str(e)) from e

    _recibo(prop, novo["_ts"], snap)                                   # 9. best-effort
    report_id = _html_semana(prop)
    _marcar(prop["proposal_id"], applied_at=time.time(), applied_ts=novo["_ts"],
            report_id=report_id)
    return {"ok": True, "ts": novo["_ts"], "snapshot_id": os.path.basename(snap),
            "report_id": report_id,
            "applied": {"n_changes": len(prop["changes"]),
                        "n_exercises": len({c["ex_id"] for c in prop["changes"]})}}

# --- rotas ------------------------------------------------------------------

@app.get("/api/hermes/health")
def health():
    return {"ok": True}

@app.post("/api/hermes/micro/propose")
def propose(request: Request, body: dict, idempotency_key: str | None = Header(default=None)):
    user = _user_of(request)
    if not user:
        return JSONResponse({"code": "UNAUTH", "msg": "sessao invalida"}, status_code=401)
    uid = user["id"]
    if not _rate_ok(uid):
        return JSONResponse({"code": "RATE_LIMITED"}, status_code=429)
    ans = body.get("answers_fase2")
    err = _validar_respostas(ans)
    if err:
        return JSONResponse({"code": "MISSING_ANSWERS", "msg": err}, status_code=400)
    try:
        semana = proxima_semana(_meso(), datetime.now(TZ).date())["semana"]
    except SpecError as e:
        return JSONResponse({"code": e.code, "msg": str(e)}, status_code=400)
    key = _chave(uid, semana, ans)          # a chave que vale inclui uid e semana
    with _idx_lock:
        idx = _read_json(KEYS) if os.path.exists(KEYS) else {}
        ent = idx.get(key)
        if ent and ent.get("uid") == uid and time.time() - ent.get("created_at", 0) < JOB_TTL:
            jid = ent["job_id"]
            if os.path.exists(os.path.join(JOBS, jid + ".json")):
                return {"job_id": jid, "statusUrl": "/api/hermes/micro/status?job_id=" + jid,
                        "idempotencyKey": key}
        jid = "job-" + uuid.uuid4().hex[:12]
        _write_json(os.path.join(JOBS, jid + ".json"),
                    {"job_id": jid, "uid": uid, "state": "queued", "phase": "queued",
                     "progress": 0, "key": key, "created_at": time.time()})
        idx[key] = {"job_id": jid, "uid": uid, "created_at": time.time()}
        _write_json(KEYS, idx)
    _exec.submit(_rodar_proposta, jid, uid, ans, key)
    return {"job_id": jid, "statusUrl": "/api/hermes/micro/status?job_id=" + jid,
            "idempotencyKey": key}

@app.get("/api/hermes/micro/status")
def status(request: Request, job_id: str):
    user = _user_of(request)
    if not user:
        return JSONResponse({"code": "UNAUTH"}, status_code=401)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", job_id or ""):
        return JSONResponse({"code": "JOB_NOT_FOUND"}, status_code=404)
    path = os.path.join(JOBS, job_id + ".json")
    if not os.path.exists(path):
        return JSONResponse({"code": "JOB_NOT_FOUND"}, status_code=404)
    j = _read_json(path)
    if j.get("uid") != user["id"]:                 # 404 e nao 403: nao confirma existencia
        return JSONResponse({"code": "JOB_NOT_FOUND"}, status_code=404)
    out = {k: j[k] for k in ("state", "phase", "progress", "proposal", "error") if j.get(k) is not None}
    return JSONResponse(out, headers={"Retry-After": "1"})

@app.post("/api/hermes/micro/apply")
def apply_micro(request: Request, body: dict):
    user = _user_of(request)
    if not user:
        return JSONResponse({"code": "UNAUTH"}, status_code=401)
    if not _rate_ok(user["id"]):
        return JSONResponse({"code": "RATE_LIMITED"}, status_code=429)
    pid = str(body.get("proposal_id") or "")
    if not re.fullmatch(r"prop-[A-Za-z0-9]{1,32}", pid):
        return JSONResponse({"code": "PROPOSAL_NOT_FOUND"}, status_code=404)
    path = os.path.join(PROPOSALS, pid + ".json")
    if not os.path.exists(path):
        return JSONResponse({"code": "PROPOSAL_NOT_FOUND"}, status_code=404)
    prop = _read_json(path)
    if prop.get("uid") != user["id"]:
        return JSONResponse({"code": "PROPOSAL_NOT_FOUND"}, status_code=404)
    if prop.get("applying_at"):
        return JSONResponse({"code": "APPLY_IN_PROGRESS"}, status_code=409)
    # Semana ja aplicada: a checagem e por SEMANA, nao por proposta.
    ja = _semana_aplicada(user["id"], prop["semana"])
    if ja and not body.get("confirm"):
        return JSONResponse({"code": "WEEK_EXISTS", "semana": prop["semana"],
                             "applied_at": ja}, status_code=409)
    try:
        return aplicar(user["id"], prop)
    except SpecError as e:
        code = 409 if e.code in ("STATE_CHANGED", "WORKOUT_ACTIVE", "APPLY_IN_PROGRESS") else 500
        return JSONResponse({"code": e.code, "msg": str(e)}, status_code=code)

def _semana_aplicada(uid: str, semana: str) -> float | None:
    for name in os.listdir(PROPOSALS):
        if not name.endswith(".json"):
            continue
        try:
            p = _read_json(os.path.join(PROPOSALS, name))
        except Exception:  # noqa: BLE001
            continue
        if p.get("uid") == uid and p.get("semana") == semana and p.get("applied_at"):
            return p["applied_at"]
    return None

@app.get("/api/hermes/reports/{report_id}.html")
def report(request: Request, report_id: str):
    user = _user_of(request)
    if not user:
        return JSONResponse({"code": "UNAUTH"}, status_code=401)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", report_id or ""):
        return JSONResponse({"code": "NOT_FOUND"}, status_code=404)
    idx_path = os.path.join(REPORTS, "index.json")
    idx = _read_json(idx_path) if os.path.exists(idx_path) else {}
    ent = idx.get(report_id)
    if not ent or ent.get("uid") != user["id"]:          # dono conferido
        return JSONResponse({"code": "NOT_FOUND"}, status_code=404)
    p = os.path.join(REPORTS, report_id + ".html")
    if not os.path.isfile(p):
        return JSONResponse({"code": "NOT_FOUND"}, status_code=404)
    return HTMLResponse(open(p, encoding="utf-8").read())
```

### 10. `~/.hermes/profiles/treinador-api/` (novo profile + skill headless)

- Copiar `~/.hermes/profiles/treinador/config.yaml`, fixando `model.default`/`model.provider` nos
  mesmos valores de `hermes_api.py` e `agent.max_turns: 20`.

- **A skill headless deriva da cópia GLOBAL, não da cópia do profile.** Fonte correta:
  `~/.hermes/skills/fitness/treino-coach/SKILL.md` (249 linhas, atualizada 2026-09-09).
  Verificado por `diff`: a cópia de `profiles/treinador/skills/fitness/treino-coach/SKILL.md`
  (248 linhas) está **dois dias atrás** e contradiz o estado real em dois pontos que mudam a
  prescrição:
  - diz `reps 5-8` para os demais grupos (decisão de 2026-09-08 fixou **6-8 em tudo**);
  - troca os dias: `Qui (PULL) · Sáb (UPPER)` — o correto, e o que o app tem em `S.week`, é
    **Qui (UPPER) · Sáb (PULL)**;
  - não tem as atualizações de 2026-09-09 (análise por API como fonte única, ownership de
    `PUT /api/data`, `spec_fonte_unica_openGym.md`).
  Derivar a skill headless da cópia do profile herdaria os três defeitos.
  (Nota: hoje o agente interativo do profile `treinador` lê justamente a cópia velha. **Decisão do
  usuário em 10/09/2026: sincronizar as duas cópias no momento da implementação** — ou seja, ao
  aplicar esta spec, copiar a global (atual) por cima de
  `profiles/treinador/skills/fitness/treino-coach/SKILL.md`, e então criar a terceira, headless.
  Passos, nessa ordem: (1) backup da cópia do profile; (2) sincronizar; (3) criar
  `treino-coach-api` a partir da global já sincronizada. Enquanto não houver ordem de implementar,
  nada disso é tocado.)

- `skills/fitness/treino-coach-api/SKILL.md`: persona Low Volume + perfil do atleta +
  `regras_globais` + hierarquia de falha (`mesociclo_ativo.json > catálogo > state`) +
  progressão/recuo/deload + **contrato JSON**, **sem** os passos de ferramenta e **sem** o passo 6
  (sync). A validação do serviço (§9) é a rede de segurança que **força** `6-8` e reprova
  propostas fora disso, independentemente do que a skill diga.

### 11. `hermes-api.service`

```ini
[Unit]
Description=openGym trainer engine (micro via app)
After=network-online.target docker.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/.hermes/workout/scripts
# data/secret e root:600 -> le como root e entrega ao pi. Sem -o pi o proprio servico nao leria.
ExecStartPre=/bin/bash -c 'install -o pi -g pi -m 600 <(printf "SECRET=%s\n" "$(sudo cat /mnt/drivebackup/apps/openGym/data/secret)") /home/pi/.hermes/hermes.env'
# 0.0.0.0 e nao 127.0.0.1: o nginx chega pelo IP do bridge, e o ufw escopa o acesso.
ExecStart=/home/pi/.hermes/hermes-agent/venv/bin/uvicorn hermes_api:app --host 0.0.0.0 --port 8091 --workers 1
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/home/pi/.hermes/workout
```
`/bin/bash` explícito porque `<(…)` é process substitution e o `/bin/sh` do systemd é `dash`.
`install -o pi -g pi` porque o `sudo` criaria o arquivo como `root` e o serviço não conseguiria ler.

## Comportamento Visual/UX

### 1. `Plan` — entrada
```
┌──────────────────────────────────────────────────────────┐
│ Plan                                [ ✨ Próxima ] [⤴]   │
│ Your weekly routine                                       │
├──────────────────────────────────────────────────────────┤
│ Week schedule                                             │
│ Sun  Legs2                                               › │
│ Tue  Push C - Shoulder 3D                                › │
└──────────────────────────────────────────────────────────┘
   Com treino em andamento o botão fica cinza: "Termina o treino primeiro".
```

### 2. Stepper (4 perguntas, traduzidas)
```
┌─ Gerar próxima semana ──────────────────────────────────┐
│ Como foi a carga?                                       │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Por que alguma carga caiu, ou o que mudou?          │ │
│ └─────────────────────────────────────────────────────┘ │
│ Pelo menos 10 caracteres.                               │
│ Dor       ( Nenhuma )( Ombro )( Lombar )( Outra )       │
│ Sono      ( Bem )( Regular )( Ruim )                    │
│ Estresse  ( Baixo )( Médio )( Alto )        Opcional    │
│              [ Cancelar ]      [ Gerar ] ← cinza até OK │
└─────────────────────────────────────────────────────────┘
```

### 3. O motor pensa (sheet travada, envio congelado)
```
┌─ Gerar próxima semana ──────────────────────────────────┐
│  ◐  O motor está a ler os teus dados…     ▓▓▓▓▓░░░░░    │
│     fase: consultando_analise — 30%                     │
│                                                         │
│  Nada foi gravado. O app não envia o teu estado enquanto │
│  isto corre — é o que impede a tua semana de ser         │
│  sobrescrita.                                           │
└─────────────────────────────────────────────────────────┘
```

### 4. Revisão (nada gravado ainda)
```
┌─ O que muda na próxima semana ──────────────────────────┐
│ S3 · progressão · 15/09 → 21/09                         │
│ [Ter 15 Push] [Qua 16 Legs 1] [Qui 17 Upper]            │
│ [Sáb 19 Pull ⚠] [Dom 20 Legs2 ⚠]                        │
│ ⚠ Aplicar hoje muda também os 2 treinos que faltam.     │
├─────────────────────────────────────────────────────────┤
│ Push C - Shoulder 3D                                    │
│   0584 lever lateral raise  45 → 47,5 kg                │
│      fechou 8/8/8 em 10/09 com 2 RIR — +2,5%            │
│   0405 chest press          22 kg · mantém              │
│ Legs 1                                                  │
│   0739 leg press 45         160 kg · mantém (teto)      │
├─────────────────────────────────────────────────────────┤
│ Notas: deload obrigatório na semana seguinte (22–30/09).│
│              [ Descartar ]            [ Aplicar ]       │
└─────────────────────────────────────────────────────────┘
```

### 5. Fim · 6. Já gerada
```
┌─ Semana aplicada ✅ ──────────────┐   ┌─ Esta semana já foi gerada ─────────┐
│ 7 exercícios ajustados nas tuas   │   │ Gerada em 14/09 às 21:40. Aplicar    │
│ 5 fichas. As cargas novas já      │   │ de novo substitui aquele plano.      │
│ valem no próximo treino.          │   │      [ Cancelar ]  [ Substituir ]    │
│                    [ Fechar ]     │   └──────────────────────────────────────┘
└───────────────────────────────────┘
```

## Persistência e Dados

**App:** mudam só `routines[].ex[]` (sets/reps/weight) e `exWeights[id]`. `week`, `dayPlan`,
`workouts[]`, `customEx`, `bodyweight` e preferências ficam intactos; `active` nunca é gravado.

**Hermes:**
| Caminho | Conteúdo | Criado por |
|---|---|---|
| `jobs/job-*.json` | estado do job; `flock`; expira em 24 h com GC no arranque | serviço |
| `jobs/keys.json` | índice `chave → {job_id, uid, created_at}` | serviço |
| `jobs/usage-*.json` | tokens/custo de cada chamada do agente | `--usage-file` |
| `proposals/prop-*.json` | proposta + `base_ts` + `applying_at` + `applied_at` + `applied_ts` | serviço |
| `reports/micro/index.json` | `report_id → {uid}` (dono do relatório) | serviço |
| `reports/micro/sync_snapshot_<ts>.json` | estado antes da gravação (rollback) | serviço |
| `reports/micro/sync_log.md` | recibo por gravação (best-effort) | serviço |
| `reports/micro/<semana>_<AAAA-MM-DD>.html` | justificativa da semana | serviço |
| `plans/mesociclo_ativo.json` | lido com `flock`; **nesta versão não é escrito** | — |

Todos os diretórios são criados no arranque (`_bootstrap`), inclusive `reports/micro/`, que hoje
**não existe**. O serviço escreve **apenas** dentro de `~/.hermes/workout`.

## Casos de Borda

- **Meio da semana** ⇒ a revisão mostra em laranja quais treinos ainda mudam (decisão do usuário).
- **Treino em andamento** ⇒ botão cinza no app. O `409 WORKOUT_ACTIVE` do serviço é defensivo e, na
  prática, inalcançável (Decisão #7) — não é garantia.
- **Estado mudou entre propor e aplicar** ⇒ `409 STATE_CHANGED`, **nada** gravado, snapshot nem chega
  a ser útil.
- **Divergência na conferência pós-PUT** ⇒ **rollback** pelo snapshot + `500 VERIFY_FAILED`.
- **Recibo falha** ⇒ o `apply` continua e devolve sucesso; a falha vai para o log do serviço.
- **Agente devolve texto, recusa ou JSON inválido** ⇒ `AGENT_INVALID_JSON` / `AGENT_FAILED`, nada
  gravado, mensagem no app.
- **Agente demora mais de 10 min** ⇒ o app desiste com `TIMEOUT` e **descongela** o envio; o job
  continua no Hermes e as mesmas respostas reaproveitam o `job_id`.
- **Análise parcial** (`meta.truncated`) ⇒ `ANALYSIS_TRUNCATED`, sem retry automático.
- **Serviço fora do ar** ⇒ nginx responde 502; `api()` levanta erro sem `code`; o app mostra falha
  genérica e nada muda.
- **Duplo clique em Gerar** ⇒ mesma chave ⇒ mesmo `job_id`, uma geração.
- **Duplo clique em Aplicar** ⇒ `applying_at` marcado antes do PUT ⇒ `409 APPLY_IN_PROGRESS`; e se o
  primeiro já terminou, `409 STATE_CHANGED` (o `_ts` mudou). Nunca duplica.
- **Processo morre entre o PUT e o `applied_at`** ⇒ o `applying_at` fica gravado; a próxima tentativa
  devolve `409 APPLY_IN_PROGRESS` em vez de reaplicar às cegas (reconciliação manual pelo snapshot).
- **Semana fora de qualquer janela do meso** ⇒ a última janela encerrada define "atual"; se não houver
  seguinte, `MESO_STALE` com a semana atual na mensagem.
- **Holofote de segurança**: `job_id`, `proposal_id` e `report_id` de terceiros ⇒ `404`.

## Critérios de Aceite

- [ ] `Plan` mostra o botão; com `S.active` ele fica desabilitado e explica o motivo.
- [ ] O botão de gerar não habilita com motivo < 10 caracteres, nem sem dor, nem sem sono; habilita com os três.
- [ ] `POST /propose` responde em menos de 1 s com `202`; `GET /status` devolve `state` ∈ {`queued`,`running`,`done`,`error`} e, em algum momento, um `phase` pertencente ao conjunto declarado no RF-3 (`state` e `phase` são campos distintos).
- [ ] **Entre `done` e `apply`, o `_ts` e o conteúdo de `routines[]` do `GET /api/data` são idênticos aos de antes do `propose`** (comparar o hash de `routines`, não só o `_ts`, e com o app fechado).
- [ ] A revisão lista cada mudança com `antes → depois` e o porquê, e marca os dias que ainda mudam.
- [ ] `Aplicar` devolve `200 {ok:true, ts}`; um `GET` fresco mostra `ex[].sets/reps/weight` novos **e** `exWeights[id].w` igual, nas 5 fichas.
- [ ] `week`, `dayPlan` e a contagem de `workouts[]` idênticos antes e depois.
- [ ] Aplicar a mesma semana duas vezes ⇒ `409` (na segunda) e nenhuma alteração duplicada.
- [ ] Uma proposta com exercício de `customEx` (`immt53oq1ac2uhc`) é **aceita** — prova que a validação lê `customEx` corretamente.
- [ ] Uma proposta com Leg Press `160 → 170` é **recusada** com `SPEC_REJECTED`.
- [ ] `POST` sem `gymsid` ⇒ `401`; motivo de 9 caracteres ⇒ `400 MISSING_ANSWERS`; 6 requisições em 1 min ⇒ `429`.
- [ ] Um `gymsid` com MAC em **hex** ⇒ `401` (prova experimental já feita: base64url ⇒ 200).
- [ ] `job_id`/`proposal_id` de outro usuário ⇒ `404`.
- [ ] `GET /api/hermes/health` ⇒ `200 {"ok":true}` sem cookie.
- [ ] `reports/micro/S3_2026-09-15.html` existe, contém `Por que S3` e ≥3 `data-ex-id`; a resposta do `propose` **não** contém caminho de arquivo.
- [ ] `sync_snapshot_*.json` existe após um apply e, restaurado, devolve as cargas anteriores.
- [ ] `sync_log.md` ganhou uma linha com `proposal_id`, `_ts` e o número de mudanças.

## Testes manuais

1. **Modo seco:** responder, gerar, conferir a revisão, fechar sem aplicar ⇒ nada mudou (hash de `routines`).
2. **Aplicar de verdade** e conferir na tela de treino que a carga do exercício alterado já aparece (pega o `exWeights`).
3. **Regenerar** a mesma semana ⇒ aviso e substituição sem duplicar.
4. **Treino aberto** ⇒ botão cinza.
5. **Estado mudado:** gerar, mexer em `Settings` no meio e aplicar ⇒ `409 STATE_CHANGED`, nada muda.
6. **Rollback:** restaurar o snapshot mais recente e conferir o retorno.
7. **Fechar a aba** durante a geração ⇒ reabrir e gerar com as mesmas respostas ⇒ mesmo `job_id`, pronto.

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| `-z` força YOLO (sem aprovação) | `-t todo` (verificado válido) + profile dedicado + quem grava é o serviço |
| Agente sem contrato de saída | `raw_decode` + validação fail-closed; erro terminal, nunca grava |
| Relógio do Pi atrás do último `_ts` | `_ts = max(agora, base+1)` |
| Recibo impossível (`sync_log.md` era `root:root`) | arquivo próprio do serviço + best-effort |
| `db.json` reescrito por `atomicWrite` durante a leitura | `rename` é atômico; leitura por `_read_json` com `flock` |
| Firewall bloqueando o container | regra `ufw` escopada a `172.16.0.0/12` |
| Divergência entre a skill do profile e a global | a skill headless deriva da **global** (atual); o `diff` está documentado na §10 |

## Ordem de implementação (só depois de o usuário autorizar)

Nada aqui foi executado. Esta é a sequência para quando houver ordem de implementar.

1. **Sincronizar a skill do treinador** (decisão do usuário em 10/09): backup de
   `profiles/treinador/skills/fitness/treino-coach/SKILL.md` e então copiar a cópia **global** (a
   atual) por cima. Sem este passo, o agente de conversa continua com `5-8` e quinta/sábado trocados.
2. **Criar a skill headless `treino-coach-api`** no profile novo, derivada da global já sincronizada
   (§10) — e o profile `treinador-api` a partir do `config.yaml` do `treinador`.
3. **App** (§1 a §6), nesta ordem: `api.js` → `hermes.js` → `useStore.js` → `sheets.jsx` →
   `Plan.jsx` → `locales/pt.js`. Rodar o build do frontend e conferir que nada mais quebrou.
4. **Serviço** (§9): criar `hermes_api.py`, checar sintaxe com `py_compile`, e fazer um smoke test
   manual na 8091 **antes** de criar o systemd.
5. **Firewall + compose + nginx JUNTOS** (§7 e §8), nesta ordem: regra de `ufw` primeiro; validar o
   conf novo num container **descartável** (receita da §7); só então
   `docker compose up -d --build web`. Aplicar o conf do nginx sozinho **derruba o app inteiro**.
6. **systemd** (§11), com o `ExecStartPre` gerando o `hermes.env` já com dono `pi`.
7. **Primeira chamada real ao agente**: `POST /propose` com o app fechado, conferindo o
   `usage-*.json` (modelo e provider usados) e `state:done` **sem** gravação no app.
8. **Ponta a ponta como o usuário pediu**: propor → revisar → aplicar, com o app aberto.
9. **Fechamento**: os 18 critérios de aceite e os 7 testes manuais.

> Duas regras atravessam tudo: **nada é gravado no app antes do `apply`**, e `extra_hosts` +
> `nginx.conf` sobem **na mesma** aplicação — sozinho, o conf do nginx derruba o container `web`
> (provado na §7).
