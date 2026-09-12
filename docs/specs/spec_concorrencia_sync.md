# Spec: concorrência do sync do app — releitura ao voltar e fim do conflito em todo salvamento (fechar a BACKLOG-09) — v3

> **Item:** BACKLOG-09 — *"Concorrência real no sync do app: `_ts` é relógio, não token"*.
> **Par:** `docs/specs/spec_api_rotinas.md` (implementou o token `S.rev` + `If-Match`; esta spec fecha o que sobrou).
> **Repo/branch:** `emersondsc/openGym`, `emerson-custom`. Frontend React + Vite (`frontend/`), API Node sem framework (`api/server.js`), servido atrás do `nginx.conf`; o openGym roda em Docker no hermes (`/mnt/drivebackup/apps/openGym/openGym`).
> **Base medida (12/09/2026), conferida por sha256 contra a árvore do hermes:** `api/server.js` 796 linhas · `frontend/src/store/useStore.js` 284 linhas · `frontend/src/lib/plan-merge.js` 58 linhas · `frontend/src/locales/pt.js` 39.712 bytes. Último commit da branch: `73b4134`, árvore limpa.
> **Revisão 1 (código real):** 20 achados, 4 bloqueantes → aplicados na v2. **Revisão 2:** 15 achados, 4 bloqueantes → aplicados na v3. **Medição (12/09/2026):** 1 achado bloqueante — o critério de saída não media o que dizia medir — e a v4 instrumenta o servidor para medi-lo. As três tabelas estão no fim.

---

## Contexto e Objetivo

A BACKLOG-07 implementou o **token de concorrência real**: o servidor conta a revisão (`S.rev`, incrementada a cada escrita) e o cliente manda a base que leu em `If-Match`, comparada por **igualdade**. Um cliente com estado velho que edita e tenta salvar leva `409 STALE_STATE`, relê, mescla e reenvia. Isso fechou a corrida que a BACKLOG-09 descrevia — *"um PWA aberto, com estado carregado antes de uma escrita externa, envia um `_ts` mais novo e sobrescreve a escrita do agente"* — **para quem manda o token**.

O item continua aberto por dois motivos, e a leitura do código para esta spec achou mais dois.

**1. O app não relê o plano enquanto está aberto.** `pullState()` só é chamado em `boot()` (`useStore.js:268`). O listener de `visibilitychange` só age quando o app **sai** de vista (`useStore.js:96-109`): ele empurra o que estiver pendente e nunca relê.
**Resposta à pergunta que o backlog deixou em aberto** (*"hoje existe caminho em `useStore.js:169/176/183/220` — confirmar se cobre o caso 'aberto e sujo'"*): **não cobre.** Essas linhas são o caminho de `409` (que só roda quando você salva) e o comentário do `pullState` que explica por que o boot não empurra.

**2. O cenário do aceite nunca foi medido.** O aceite pede *"cenário reproduzido (PWA aberto + escrita externa + edição local) com o resultado medido"*, com o registro do servidor (`GET /api/audit`) como prova de quem escreveu o quê.

**3. (Achado desta leitura) O app nunca guarda a revisão que o servidor confirmou.** `pushState` faz `await send()` e **descarta a resposta** (`useStore.js:148`). O `S.rev` local continua sendo o da última **leitura**, então **todo salvamento depois do primeiro de cada sessão** manda base velha, leva `409`, relê e reenvia: 3 requisições por edição (`PUT` 409 → `GET` → `PUT` 200). O primeiro salvamento depois de um boot limpo passa, porque o boot adota o estado inteiro do servidor, `rev` incluído (`useStore.js:200`). A `spec_api_rotinas.md` já exige o contrário (R2-13 / §4.13 item 6); o código não faz.

**4. (Achado desta leitura, na revisão) O ramo de mescla do `pullState` não protege a sua edição.** Ele adota as rotinas do servidor **inteiras** (`useStore.js:210`, `Object.assign(clone(DEF), state)`), sem passar pelo `adoptServerRoutines` que o caminho de `409` usa — conferido e confirmado na revisão 2. Hoje isso quase não aparece (o ramo exige `_ts` do servidor maior, e depois de uma edição local o seu `_ts` é sempre maior). **Com a releitura ao voltar, esse ramo passa a ser o caminho normal do caso "aberto e sujo"** — e sem corrigi-lo a releitura descartaria exatamente a edição que você acabou de fazer.

**Objetivo:** com o app aberto, o plano é relido quando você volta para ele, com aviso sempre que o plano guardado mudou de verdade; o salvamento passa a mandar a base certa (uma requisição no caso normal); e o cenário do aceite fica medido, com o critério de saída da janela do cliente antigo escrito em números.

---

## Escopo

**Inclui**
- releitura do plano quando o app volta para a frente (aba, desbloqueio do celular), com limite de frequência;
- decisão de adoção por **token** (`rev`), substituindo as duas comparações por `_ts` do `pullState`;
- mescla que preserva a edição local também no ramo de mescla da releitura;
- aviso sempre que o plano guardado mudou de verdade, uma vez por revisão, inclusive com treino em andamento;
- gravar a revisão confirmada em toda escrita bem-sucedida (inclusive no reenvio pós-`409`), inclusive no armazenamento nativo do Android;
- a tradução do aviso no idioma escolhido no app;
- testes: arquivo novo para a função pura do aviso, e invariantes no teste do store (o padrão do projeto);
- roteiro de verificação **medido**, com instância de teste separada para a escrita perigosa e trava de alvo antes de cada escrita.

**Não inclui (explícito)**
- **Bloquear cliente antigo** (decisão do usuário de 12/09/2026: medir e esperar). O guard por `_ts` continua valendo para quem não manda `If-Match`. **O `api/server.js` muda em três linhas, só de instrumentação** — o campo `ifMatch` no registro e dois logs de escrita recusada — autorizado pelo usuário em 12/09/2026, depois que a medição mostrou que o rótulo `actor: "pwa-legacy"` não distinguia as versões. **Nenhuma regra de aceitação ou de recusa foi alterada.**
- Mudar o contrato das rotas de rotina (`GET`/`PATCH`/`DELETE /api/routines`) ou o `opengym_writer.py`.
- Resolver o *replay* do `PUT` dentro da janela de 300 s (A19 da `spec_api_rotinas.md`): aceito por desenho.
- A BACKLOG-02 (criação de rotinas em lote) — nem desbloqueia nem bloqueia.
- Sincronizar treino **em andamento** entre aparelhos: `active` continua local por desenho (o servidor apaga `active` em todo `PUT`, `api/server.js:589`).
- Resolver duas abas abertas no mesmo aparelho (cada aba tem o próprio store; o token já resolve o conflito com uma releitura a mais — ver *Riscos residuais*).

---

## Decisões do usuário

| # | Decisão | Data | O que muda para ele |
|---|---|---|---|
| U1 | **Relê e avisa na hora**, inclusive com treino em andamento | 12/09/2026 | Ao voltar para o app, a tela já mostra o plano novo e o aviso aparece ali mesmo, sem ele tocar em nada |
| U2 | **Cliente antigo: medir e esperar** (não bloquear) | 12/09/2026 | Nada muda agora; o risco de um aparelho com a versão velha sobrescrever o que o assistente escreveu continua de pé, e o item só fecha com **7 dias sem nenhuma escrita de versão antiga** no registro |
| U3 | **Aviso sempre que o plano mudou de verdade, sem o app separar quem mudou** — *"não quero fazer distinção entre mudanças que eu faço e mudanças que o agente faz"* | 12/09/2026 | O aviso dispara pelo fato de o plano guardado ter mudado, não por quem escreveu. Consequência aceita: ele pode aparecer quando a mudança do assistente foi descartada e nada mudou na tela — a mensagem diz o desfecho, não o autor |

---

## Decisões assumidas

Detalhe de implementação, decidido por mim porque não muda o que o usuário vê — exceto onde está dito o contrário.

- **Limite de 20 s entre releituras** (`FOCUS_PULL_MS = 20000`). Alternar de app várias vezes não dispara uma consulta por volta; 20 s é menor que qualquer pausa real de treino. Efeito visível: nenhum.
- **A releitura nunca empurra.** Voltar para o app não é edição — regra que a BACKLOG-09 fixou para o boot (`useStore.js:218-220`).
- **Só `visibilitychange` dispara a releitura; `window.focus` fica de fora.** Em desktop, `focus` dispara também no diálogo de passkey (`navigator.credentials`, `lib/api.js:48-58`), em seletor de arquivo e na volta do app nativo: seriam consultas inúteis. `visibilitychange` já cobre os dois casos que o usuário descreveu (trocar de aba, desbloquear o celular).
- **A releitura não roda se houver push agendado** (`if (pushTm) return`). O push pendente (debounce de 1,5 s) sai com o estado capturado antes; se a releitura adotasse o servidor no meio, ele mandaria um payload já velho e provocaria um segundo conflito.
- **A releitura que falha não consome a janela de 20 s** (`pullState` devolve `false` quando o `GET` falhou e o `lastPull` volta a zero). Sem isso, voltar ao app offline deixaria a tela sem reler mesmo reconectando em seguida.
- **A decisão de adotar passa a ser por `rev`, não por `_ts`.** O servidor "andou" quando `state.rev > S.rev`. Por `_ts` a releitura mentiria: depois de qualquer edição local o `S._ts` é sempre **mais novo**, então nenhum ramo adotaria nada. Substitui as comparações de `useStore.js:198` e `:206`. Premissa declarada: **`rev` só cresce** (é o contador do servidor, `api/server.js:587`), então uma revisão já vista nunca volta.
- **O ramo de mescla da releitura passa a usar `adoptServerRoutines` com a base** (`useStore.js:210` hoje adota as rotinas do servidor inteiras). Sem isso, a releitura ao voltar descartaria a edição local — o oposto do RF-1.
- **A adoção total só acontece sem nada pendente** (`!dirty`). Quando `dirty` é falso, tudo o que existe neste aparelho já foi confirmado pelo servidor, então adotar o estado inteiro não descarta nada (o único campo local é `active`, preservado explicitamente).
- **O gatilho do aviso é o plano do SERVIDOR contra a base local** (`planChanged(state.routines, base)`), nunca o resultado da mescla — é a U3. Usar o resultado mesclado daria falso positivo: uma rotina criada **só neste aparelho** não está na base, sobraria no mapa e faria o aviso disparar sem o servidor ter mudado nada.
- **A mensagem não atribui autoria:** passa de *"Plan updated by the coach — your own edits were kept."* para *"Plan updated — your own edits were kept."*, coerente com a U3. Ela diz o desfecho (nada seu foi perdido), não quem escreveu.
- **O aviso é por REVISÃO, não por mudança individual.** Duas escritas do agente entre duas leituras chegam como uma revisão só e geram **um** aviso. É o comportamento desejado (o usuário não quer um aviso por escrita enquanto esteve fora) e está declarado aqui para não ser lido como bug depois.
- **O aviso passa a ser chaveado pela revisão** (`gym_coach_notice_rev`), no lugar da chave `gym_coach_notice_shown` — gravada em `useStore.js:180` e **nunca removida em lugar nenhum do código**: hoje o aviso aparece no máximo **uma vez na vida do aparelho**.
- **O valor lido da chave do aviso é validado com `Number.isInteger`.** `parseInt` de lixo devolve `NaN` e `rev <= NaN` é sempre falso — sem a validação, o aviso apareceria em **toda** releitura.
- **A chave antiga `gym_coach_notice_shown` fica órfã de propósito:** é inerte, e removê-la exigiria mexer no `loadState()` por ganho nulo.
- **A revisão confirmada é gravada sem carimbar `_ts`** e sem disparar push: sincronizar não é editar. `_ts` continua significando "quando este aparelho editou por último" — por isso a mescla da releitura usa `Math.max(Date.now(), state._ts || 0) + 1`, igual ao caminho de `409`, em vez de um `Date.now()` solto.
- **No Android a revisão confirmada também vai para o armazenamento nativo** (`if (MOBILE) nativePersist()`): o `boot()` do app nativo lê de lá (`useStore.js:243-247`), e sem isso o aparelho voltaria a mandar base velha no boot seguinte.
- **O `rev` da resposta é campo da raiz do corpo** — `api()` devolve o JSON já lido (`frontend/src/lib/api.js:8-13`) e o `PUT` responde `{ok, ts, rev, meta}` (`api/server.js:601`), então `adoptRev(res && res.rev)` é seguro.
- **O aviso precisa existir em português.** Em `frontend/src/lib/i18n.js` as strings em inglês **são** as chaves (`t(s)` devolve `dict[s] || s`, linhas 34-38) e o dicionário mora em `frontend/src/locales/<lang>.js`. A frase não está em `pt.js` (conferido, e **nenhuma** das palavras "treinador"/"coach"/"assistente" existe lá). A tradução entra direto, sem escolher vocabulário de autor — a mensagem não nomeia autor por U3.

---

## Requisitos Funcionais

**RF-1.** Ao voltar para a frente (visibilidade → *visível*), com sessão ativa e **sem** push agendado, o app relê `GET /api/data` e aplica a adoção/mescla de §2.7, no máximo uma vez a cada 20 s, e **nunca** envia o estado. A decisão de adotar é por token: o servidor "andou" quando `state.rev > S.rev`. `active` (treino em andamento) e as edições locais são preservados.

**RF-2.** Quando a releitura encontra rotinas do servidor diferentes das que este aparelho baixou (a base local), o app mostra o aviso **uma vez por revisão**, inclusive com treino em andamento, **sem separar quem escreveu** (U3). A mesma revisão não avisa duas vezes, mesmo alternando de app dez vezes. Sem mudança, nenhum aviso. A frase sai no idioma do app.

**RF-3.** Toda escrita aceita (`200` em `PUT /api/data`) tem a revisão devolvida gravada no estado local, no `localStorage` **e** no armazenamento nativo quando for o app Android, sem carimbar `_ts` e sem novo push. Consequência testável: duas edições seguidas geram **dois** `200` e **nenhum** `409`.

**RF-4.** O caminho de `409` continua inteiro: relê, mescla (rotina tocada aqui fica; a que não toquei vem do servidor; treino por união de id; `active` local), reenvia com a revisão recém-lida, e o reenvio bem-sucedido também grava a revisão (RF-3). **O aviso desse caminho sai do próprio bloco de `409` (§2.6), com a mesma base lida antes da adoção** — não do `pullState`, que só avisa quando chamado com `notify` verdadeiro (a releitura de foco).

**RF-5.** Cliente antigo (sem `If-Match`, sem ator) continua **aceito** com `200`, e cada escrita dele fica registrada — no audit, pelo campo novo `ifMatch: "none"`, e no log da API como `op=put` com `ifMatch=none`. O item fecha quando passar **7 dias consecutivos sem nenhuma escrita com `ifMatch: "none"`** de cliente de navegador.
**Ressalva que a medição impôs (achado M1):** o rótulo `actor: "pwa-legacy"` **não** distingue cliente antigo de novo — o servidor o aplica a qualquer requisição sem a assinatura do assistente, e o navegador nunca manda essa assinatura. Antes do campo `ifMatch`, **toda** escrita do app caía nesse rótulo (medido: 72 de 72 linhas do registro em 12/09/2026, incluindo as feitas já com o bundle novo no ar). O critério antigo ("7 dias sem `pwa-legacy`") era, por isso, **impossível de cumprir** e teria dado falso positivo sobre a versão em uso.

**RF-6.** Nada muda para o agente: `PATCH`/`DELETE`/`GET /api/routines` mantêm `If-Match` obrigatório (`428` se ausente) e a assinatura de ator.

---

## Detalhe de Implementação (nível código)

### 1. `frontend/src/lib/plan-merge.js` — função pura nova

**1.1 `planChanged(srv, base)` (novo, no fim do arquivo, junto de `ifMatchFor`):**

```js
/**
 * O plano do servidor mudou em relação ao que ESTE aparelho baixou (a base)?
 * É o gatilho do aviso (U3): o fato é "o plano guardado mudou", sem separar quem escreveu.
 * `srv` é a lista de rotinas vinda do servidor; `base` é o MAPA id→rotina de `readBase()`
 * (não uma lista — passar lista aqui devolve false sempre). Compara rotina a rotina e responde
 * true se qualquer uma apareceu, sumiu ou mudou. Pura de propósito: entra no teste sem DOM.
 * Nota: a comparação é por JSON e portanto sensível à ORDEM das chaves (ver Riscos).
 */
export function planChanged(srv, base) {
  const byId = new Map((srv || []).map(r => [r.id, r]))
  for (const [id, before] of Object.entries(base || {})) {
    const after = byId.get(id)
    if (after === undefined) return true               // estava na base e sumiu: foi apagada
    if (JSON.stringify(before) !== JSON.stringify(after)) return true
    byId.delete(id)
  }
  return byId.size > 0                                 // sobrou rotina que a base não tinha
}
```

### 2. `frontend/src/store/useStore.js`

**2.1 Import (linha 5):**
```js
// ANTES
import { adoptServerRoutines, rememberBase, readBase, ifMatchFor } from '../lib/plan-merge.js'
// DEPOIS
import { adoptServerRoutines, rememberBase, readBase, ifMatchFor, planChanged } from '../lib/plan-merge.js'
```

**2.2 Constantes (linhas 21-22):**
```js
// ANTES
// Um aviso de "o plano foi atualizado" por sessão de sync (evita repetir a cada 409).
const NO_TOAST_KEY = 'gym_coach_notice_shown'
// DEPOIS
// Um aviso por MUDANÇA: a chave guarda a revisão em que o aviso já apareceu. A chave antiga
// (`gym_coach_notice_shown`) era gravada e nunca removida — o aviso saía uma vez na vida.
const NOTICE_REV_KEY = 'gym_coach_notice_rev'
// No máximo uma releitura a cada 20 s quando o app volta para a frente (RF-1).
const FOCUS_PULL_MS = 20000
```

**2.3 Cabeçalho do `create` (linhas 75-78):**
```js
export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null
  let lastPull = 0        // última releitura por volta ao app (RF-1)
```

**2.4 Dois helpers novos, logo depois de `persist` e antes do `visibilitychange`:**

```js
  // RF-3: grava a revisão que o servidor confirmou. Sincronizar não é editar, então não carimba
  // `_ts` e não dispara push — só deixa a PRÓXIMA escrita mandar a base certa em vez de levar 409.
  // `nativePersist()` no Android é obrigatório: o boot do app nativo lê o armazenamento nativo
  // (nativeLoad, useStore.js:243-247) e sem isso o aparelho voltaria a mandar base velha.
  const adoptRev = rev => {
    if (!Number.isInteger(rev)) return
    const S = clone(get().S)
    if (S.rev === rev) return
    S.rev = rev
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
  }

  // RF-2 / U3: um aviso por mudança de plano, sem separar quem escreveu. `srvRoutines` é SEMPRE a
  // lista do SERVIDOR (não o resultado da mescla, que incluiria rotina criada só aqui e daria
  // aviso falso); `prevBase` é a base lida ANTES de qualquer adoção. A revisão guardada é validada:
  // lixo no localStorage não pode transformar "uma vez por revisão" em "toda releitura".
  const noticeIfChanged = (srvRoutines, prevBase, rev) => {
    if (!planChanged(srvRoutines, prevBase)) return
    const parsed = Number.parseInt(localStorage.getItem(NOTICE_REV_KEY) ?? '-1', 10)
    const shown = Number.isInteger(parsed) ? parsed : -1        // parseInt de lixo = NaN
    if (Number.isInteger(rev) && rev <= shown) return
    if (Number.isInteger(rev)) localStorage.setItem(NOTICE_REV_KEY, String(rev))
    import('./useUI.js')
      .then(({ useUI }) => useUI.getState().toast(t('Plan updated — your own edits were kept.')))
      .catch(() => { /* sem UI montada não é erro */ })
  }
```

**2.5 Listener de visibilidade (linhas 96-109):**
```js
// ANTES
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    // ... flush do save nativo e push do que estiver pendente ...
  })
```
```js
// DEPOIS
  // Voltar para o app é o momento de descobrir o que foi escrito enquanto ele estava aberto.
  // Relê; nunca empurra (empurrar aqui é o que a BACKLOG-09 tirou do boot). Só a visibilidade
  // entra: `window.focus` dispararia também em diálogo de passkey e seletor de arquivo.
  const pullOnReturn = async () => {
    if (!get().user) return
    if (pushTm) return                       // push agendado: ele resolve pelo 409, sem corrida
    const now = Date.now()
    if (now - lastPull < FOCUS_PULL_MS) return
    lastPull = now
    const ok = await get().pullState(true)
    if (!ok) lastPull = 0                    // offline não consome a janela: a próxima volta tenta
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { pullOnReturn(); return }
    // ... o bloco de esconder continua igual (flush + push do pendente) ...
  })
```

**2.6 `pushState` — guardar a revisão confirmada e passar a base ao adotador (linhas 147-186):**
```js
// ANTES
      const send = (base = ifMatchFor(sanitized)) => sendState(sanitized, base)
      try { await send(); localStorage.removeItem('gym_dirty'); try{ const {clearCoachCache}=await import('../lib/coach.js'); clearCoachCache(); }catch{} }
      catch (e) {
        localStorage.setItem('gym_dirty', '1')
        if (e && e.status === 401) { get().setUser(null); return }
        if (e && e.status === 409) {
          try {
            const { state: srv } = await api('/api/data')
            if (srv) {
              // ... sanitização e mescla, como hoje ...
              const adopted = adoptServerRoutines(srv.routines || [], S.routines || [], readBase())
              merged.routines = adopted.routines
              merged._ts = Math.max(Date.now(), srv._ts || 0) + 1
              merged.rev = Number.isInteger(srv.rev) ? srv.rev : merged.rev
              persist(merged, false)
              rememberBase(adopted.routines)
              await sendState(merged, merged.rev)
              localStorage.removeItem('gym_dirty')
              if (adopted.changed && !localStorage.getItem(NO_TOAST_KEY)) { /* toast */ localStorage.setItem(NO_TOAST_KEY, '1') }
            }
          } catch { /* stays dirty, heals on next boot */ }
        }
      }
```
```js
// DEPOIS
      const send = (base = ifMatchFor(sanitized)) => sendState(sanitized, base)
      try {
        const res = await send()
        adoptRev(res && res.rev)                     // RF-3: o próximo PUT já manda a base certa
        localStorage.removeItem('gym_dirty')
        try { const { clearCoachCache } = await import('../lib/coach.js'); clearCoachCache() } catch { /* */ }
      } catch (e) {
        localStorage.setItem('gym_dirty', '1')
        if (e && e.status === 401) { get().setUser(null); return }
        if (e && e.status === 409) {
          try {
            const prevBase = readBase()              // ANTES do rememberBase: é o que liga o aviso
            const { state: srv } = await api('/api/data')
            if (srv) {
              // ... sanitização e mescla, como hoje (sem mudança) ...
              const adopted = adoptServerRoutines(srv.routines || [], S.routines || [], prevBase)
              merged.routines = adopted.routines
              merged._ts = Math.max(Date.now(), srv._ts || 0) + 1
              merged.rev = Number.isInteger(srv.rev) ? srv.rev : merged.rev
              // RF-4: o aviso deste caminho sai daqui, do plano do SERVIDOR contra a base.
              noticeIfChanged(srv.routines || [], prevBase, Number.isInteger(srv.rev) ? srv.rev : null)
              persist(merged, false)
              rememberBase(adopted.routines)
              const res2 = await sendState(merged, merged.rev)
              adoptRev(res2 && res2.rev)             // RF-3: o reenvio também confirma revisão
              localStorage.removeItem('gym_dirty')
            }
          } catch { /* stays dirty, heals on next boot */ }
        }
      }
```
Notas: `prevBase` **tem** que ser lido antes do `rememberBase`; ele é passado também ao `adoptServerRoutines` para o adotador não reler o `localStorage` e para base e aviso não divergirem. O aviso usa `srv.routines` (o servidor), não `merged.routines`.

**2.7 `pullState(notify = false)` (linhas 188-223) — corrigido por inteiro**

Quatro mudanças: (a) o parâmetro e o retorno booleano; (b) a base lida no topo; (c) a decisão por `rev`; (d) a mescla usando `adoptServerRoutines`. Este é o bloco mais delicado da spec — o "DEPOIS" está completo de propósito, sem "como hoje".
```js
// ANTES (linhas 188-223, resumido)
//   const dirty = localStorage.getItem('gym_dirty') === '1'
//   if (state && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) { ...adota tudo... }
//   else if (hasData(S)) {
//     if (state && (state._ts || 0) > (S._ts || 0)) { ...mescla com as rotinas do SERVIDOR inteiras... }
//     // Sem push aqui de propósito ...
//   }
```
```js
// DEPOIS
    async pullState(notify = false) {
      try {
        const { state } = await api('/api/data')
        const base = readBase()                 // a base ANTES de adotar (é o que liga o aviso)
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        if (state) {
          // ... sanitização de restSec como hoje, sem mudança ...
        }
        // O servidor ANDOU? Comparação por TOKEN, não por relógio. `rev` só cresce (é o contador do
        // servidor, api/server.js:587) e o GET injeta 0 quando o arquivo nunca foi escrito pela
        // versão nova (api/server.js:544). Substitui as comparações de `_ts` que estavam aqui e no
        // ramo de mescla.
        const serverRev = Number.isInteger(state?.rev) ? state.rev : null
        const myRev = Number.isInteger(S.rev) ? S.rev : -1
        const serverMoved = serverRev !== null && serverRev > myRev
        if (state && (!hasData(S) || (serverMoved && !dirty))) {
          // Nada pendente (`dirty` falso): o que este aparelho tinha já está confirmado no
          // servidor, então adotar o estado inteiro não descarta edição nenhuma. `active` é local.
          const active = S.active
          const next = Object.assign(clone(DEF), state)
          if (active) next.active = active
          if (notify) noticeIfChanged(state.routines || [], base, serverRev)
          persist(next, false)
          rememberBase(next.routines)
          try { const { clearCoachCache } = await import('../lib/coach.js'); clearCoachCache() } catch { /* */ }
        } else if (hasData(S) && serverMoved) {
          // Tem coisa local (ou edição pendente): MESCLA em vez de sobrescrever — e a mescla de
          // rotina passa pelo mesmo adotador do caminho de 409, senão a releitura ao voltar
          // descartaria a edição que o usuário acabou de fazer.
          const byId = new Map()
          ;(state.workouts || []).forEach(w => byId.set(w.id, w))
          ;(S.workouts || []).forEach(w => { if (!byId.has(w.id)) byId.set(w.id, w) })
          const merged = Object.assign(clone(DEF), state)
          merged.workouts = [...byId.values()]
          if (S.active) merged.active = S.active
          merged.routines = adoptServerRoutines(state.routines || [], S.routines || [], base).routines
          merged._ts = Math.max(Date.now(), state._ts || 0) + 1     // igual ao caminho de 409
          if (notify) noticeIfChanged(state.routines || [], base, serverRev)
          persist(merged, false)
          rememberBase(merged.routines)
          try { const { clearCoachCache } = await import('../lib/coach.js'); clearCoachCache() } catch { /* */ }
        }
        // Sem push aqui de propósito: voltar ao app NÃO é edição (regra que a BACKLOG-09 fixou).
        // Sem `serverMoved`, nada é adotado — e portanto nenhum aviso.
        return true
      } catch (e) { /* offline — keep local */ }
      return false
    },
```
O `boot()` continua chamando `await get().pullState()` sem argumento (o bloco de boot ignora o retorno): no boot a tela acabou de carregar e o estado já vem do servidor, então o aviso não é necessário. **O aviso do caminho de `409` não vem daqui** — vem do próprio bloco de `409` (§2.6, RF-4).

### 3. `frontend/src/lib/plan-merge.test.js` (novo)

Padrão da casa: **vitest**, como `frontend/src/lib/onerm.test.js`.
```js
import { describe, it, expect } from 'vitest'
import { planChanged } from './plan-merge.js'

const r = (id, weight) => ({ id, name: id, prog: 'off', ex: [{ id: '0326', sets: 2, weight }] })

describe('planChanged — o plano do servidor mudou em relação à base do aparelho?', () => {
  it('base vazia e servidor com rotina: mudou', () => {
    expect(planChanged([r('r1', 8)], {})).toBe(true)
  })
  it('servidor igual à base: não mudou', () => {
    expect(planChanged([r('r1', 8)], { r1: r('r1', 8) })).toBe(false)
  })
  it('peso diferente da base: mudou', () => {
    expect(planChanged([r('r1', 10)], { r1: r('r1', 8) })).toBe(true)
  })
  it('rotina que estava na base e sumiu do servidor: mudou', () => {
    expect(planChanged([], { r1: r('r1', 8) })).toBe(true)
  })
  it('rotina nova no servidor: mudou', () => {
    expect(planChanged([r('r1', 8), r('r2', 20)], { r1: r('r1', 8) })).toBe(true)
  })
  it('nada nos dois lados: não mudou', () => {
    expect(planChanged([], {})).toBe(false)
  })
  it('mesmas chaves em ORDEM diferente: MUDOU (JSON.stringify é sensível à ordem — fixado de propósito)', () => {
    const a = { id: 'r1', name: 'r1', prog: 'off', ex: [{ id: '0326', sets: 2, weight: 8 }] }
    const b = { ex: [{ weight: 8, sets: 2, id: '0326' }], prog: 'off', name: 'r1', id: 'r1' }
    expect(planChanged([a], { r1: b })).toBe(true)
  })
})
```
O último caso **fixa** a sensibilidade à ordem como comportamento conhecido (documentada em *Riscos*), para ninguém a descobrir como surpresa.

### 4. `frontend/src/store/useStore.test.js` — invariantes no texto do store

O projeto **não tem jsdom**: `useStore.js` mexe em `document` e o teste existente verifica o **texto-fonte** do store. **Quatro asserções existentes mudam** (conferido na implementação de 12/09/2026, quando o `vitest run` apontou as quatro):
- **linha 108** — `/adoptServerRoutines\(srv\.routines \|\| \[\], S\.routines \|\| \[\], readBase\(\)\)/` passa a esperar `prevBase` (o adotador recebe a base já lida, achado R7);
- **linha 112** — `SRC.indexOf('async pullState()')` passa a `'async pullState('` (a assinatura ganhou o parâmetro `notify`); sem isso o `indexOf` devolve `-1` e o recorte fica vazio;
- **linha 113** — `'} else if (hasData(S))'` passa a `'} else if (hasData(S) && serverMoved)'`;
- **linhas 122-125** — o teste do aviso antigo (`adopted.changed && ...NO_TOAST_KEY` e `Plan updated by the coach`) é substituído por um que prende a frase nova e nega a antiga; a cobertura de comportamento vive no `describe` novo.
E **conferir que cada marcador existe antes de fatiar** o texto: `indexOf` que devolve `-1` produz recorte vazio, e `.not.toMatch()` sobre string vazia passa sempre — verde falso.

```js
describe('concorrência do sync (BACKLOG-09)', () => {
  const at = marker => {
    const i = SRC.indexOf(marker)
    expect(i).toBeGreaterThan(-1)      // sem isto, um recorte vazio passaria em silêncio
    return i
  }

  it('a revisão confirmada é gravada no sucesso e no reenvio pós-409 (RF-3)', () => {
    expect(SRC).toMatch(/const res = await send\(\)/)
    expect(SRC).toMatch(/adoptRev\(res && res\.rev\)/)
    expect(SRC).toMatch(/const res2 = await sendState\(merged, merged\.rev\)/)
    expect(SRC).toMatch(/adoptRev\(res2 && res2\.rev\)/)
  })

  it('adoptRev não carimba _ts e leva a revisão ao armazenamento nativo no Android (RF-3)', () => {
    const body = SRC.slice(at('const adoptRev = rev =>'), at('const noticeIfChanged'))
    expect(body).not.toMatch(/_ts\s*=/)
    expect(body).not.toMatch(/pushState/)
    expect(body).toMatch(/if \(MOBILE\) nativePersist\(\)/)
  })

  it('voltar para o app relê, com limite, sem push pendente e sem window.focus (RF-1)', () => {
    const body = SRC.slice(at('const pullOnReturn'), at("document.addEventListener('visibilitychange'"))
    expect(body).toMatch(/if \(pushTm\) return/)
    expect(body).toMatch(/now - lastPull < FOCUS_PULL_MS/)
    expect(body).toMatch(/if \(!ok\) lastPull = 0/)
    expect(body).not.toMatch(/pushState/)
    expect(SRC).toMatch(/visibilityState === 'visible'\) \{ pullOnReturn\(\); return \}/)
    expect(SRC).not.toMatch(/addEventListener\('focus'/)
  })

  it('o aviso é por revisão, com valor validado, e a chave antiga sumiu (RF-2)', () => {
    expect(SRC).toMatch(/NOTICE_REV_KEY/)
    expect(SRC).toMatch(/Number\.isInteger\(parsed\) \? parsed : -1/)
    expect(SRC).not.toMatch(/NO_TOAST_KEY|gym_coach_notice_shown/)
  })

  it('o aviso usa o plano do SERVIDOR, não o resultado da mescla (U3)', () => {
    expect(SRC).toMatch(/noticeIfChanged\(state\.routines \|\| \[\], base, serverRev\)/)
    expect(SRC).toMatch(/noticeIfChanged\(srv\.routines \|\| \[\], prevBase,/)
    expect(SRC).not.toMatch(/noticeIfChanged\(merged\.routines/)
    expect(SRC).not.toMatch(/noticeIfChanged\(next\.routines/)
  })

  it('a releitura decide por rev (não por _ts) e mescla com a base (RF-1)', () => {
    const body = SRC.slice(at('async pullState'), at('async signOut'))
    expect(body).toMatch(/const serverMoved = serverRev !== null && serverRev > myRev/)
    expect(body).not.toMatch(/\(_ts \|\| 0\)\s*[<>]=?/)     // nenhuma comparação de relógio sobrou
    expect(body).toMatch(/adoptServerRoutines\(state\.routines \|\| \[\], S\.routines \|\| \[\], base\)/)
  })

  it('a base do aviso é lida antes do rememberBase nos dois caminhos', () => {
    expect(at('const base = readBase()')).toBeLessThan(at('rememberBase(next.routines)'))
    expect(at('const prevBase = readBase()')).toBeLessThan(at('rememberBase(adopted.routines)'))
  })
})
```

### 5. `frontend/src/locales/pt.js` — o aviso no idioma do app

A chave é a própria string em inglês (padrão do `i18n.js`), então basta acrescentar a linha:
```js
// ANTES — não existe chave para a frase do aviso (sairia em inglês)
// DEPOIS
  'Plan updated — your own edits were kept.': 'Plano atualizado — suas edições foram mantidas.',
```
A frase não nomeia autor (U3), então não depende de vocabulário de "assistente" — que, aliás, **não existe** em `pt.js` hoje.

---

## Comportamento Visual/UX

**O aviso (RF-2)** é o toast que já existe (`frontend/src/store/useUI.js:35-38`, 2,2 s, sem som), reaproveitado. Ele aparece sobre a tela em que você está — inclusive a do treino — e não bloqueia nada:

```
   ┌──────────────────────────────────────────────┐
   │  Supino reto                        3 × 6-8  │
   │  ┌────────────────────────────────────────┐  │
   │  │ ✓ Plano atualizado — suas edições      │  │  ← uma vez por revisão, no seu idioma
   │  │   foram mantidas.                       │  │
   │  └────────────────────────────────────────┘  │
   │  45 kg  ▸  40 kg                  ⏱ 90s      │  ← o peso novo já está na tela
   └──────────────────────────────────────────────┘
```

**A linha do tempo, que é o que a medição confere:**

```
17:00  app aberto, plano lido (rev 5)          →  a tela mostra o plano de 17:00
17:10  alguém escreve pelo agente (rev 6)      →  nada muda na tela ainda (o app não sabe)
17:12  você volta para o app                   →  relê sozinho (RF-1), adota e avisa (RF-2)
17:13  você edita o descanso de um exercício    →  PUT If-Match "6" → 200, rev 7, UMA requisição (RF-3)
17:14  você edita de novo                       →  PUT If-Match "7" → 200, rev 8, sem 409  ← o que muda
```

Sem esta spec, os dois últimos passos custam 3 requisições cada (`PUT` 409 → `GET` → `PUT` 200).

---

## Roteiro de verificação (medido)

> **Trava de alvo (nasceu do incidente registrado em `spec_api_rotinas.md:1472-1476`, onde 4 `PATCH` atingiram produção porque a `OPENGYM_API_URL` continuou apontando para a API real enquanto só o diretório de dados era uma cópia):** antes de **cada** escrita, imprimir a URL alvo e o diretório de dados, e conferir que o `uid` alvo é o do usuário. A escrita perigosa (bloco A) **não roda contra produção**.
> **Armadilha de nome de variável (achado S5, conferido em `api/server.js:18`):** o servidor lê `DATA_DIR`. `OPENGYM_DATA_DIR` é variável do **escritor Python**, não da API — usá-la aqui faz a instância de teste cair no padrão `'/data'`, que dentro do container **é o estado real**. Escreva `DATA_DIR` e confira a URL antes de qualquer escrita.
> Execução autorizada pelo usuário em 12/09/2026, avisando antes de cada escrita.

**Preparação (só leitura em produção)**
1. `GET /api/data` no estado vivo: anotar `rev` e `_ts`.
2. Backup datado do estado. O caminho do arquivo é `<DATA>/state-<uid>.json` (`api/server.js:58`, `stateFile`), **não** `data/state/<uid>.json`: `cp data/state-<uid>.json /tmp/og-<uid>.bak-$(date +%Y%m%d-%H%M)` e registrar o `sha256` do original. **Nenhuma escrita ainda.**
3. Sessão forjada, para os passos que escrevem: cookie `gymsid = sign("<uid>:<exp>:<sv>")` com `exp` no futuro; `sign(p) = p + "." + base64url(HMAC-SHA256(SECRET, p))` (`api/server.js:181-204`). `SECRET` em `data/secret`.
4. Ator assinado para a escrita do agente. Formato exato, conferido no código (`api/server.js:232-265`):
   - headers `X-OG-Actor: agent=hermes` e `X-OG-Actor-Sig: t=<unix-segundos>; v1=<hex>`;
   - `v1` = **hex minúsculo de 64 caracteres** (`/^[0-9a-f]{64}$/`, `:228` e `:247`) de `HMAC-SHA256(agentKey, "<t>\n<METHOD>\n<path>\n<uid>\n<sha256hex(body)>")`;
   - `agentKey` = `hex(HMAC-SHA256(SECRET, "opengym-agent-v1"))` (`:232`);
   - `t` é o **mesmo** valor usado dentro do HMAC, em segundos, e a janela é de ±300 s (`:250`);
   - `path` sem query string; `METHOD` em maiúsculas (`PUT`, `PATCH`).

**Bloco A — instância de teste: o cenário do cliente antigo (nada toca produção)**
5. Subir uma segunda instância da API com cópia do `data/` (incluindo o `secret`, para o cookie forjado valer):
   `DATA_DIR=/tmp/og-teste/data PORT=8099 node api/server.js`. Confirmar a URL e o `DATA_DIR` impressos **antes** de qualquer escrita.
6. Nessa cópia: `PUT /api/data` **sem** `If-Match` e **sem** ator, com `_ts` novo e o payload **velho** → **200** (o guard por relógio deixa passar, `api/server.js:581-586`) e o registro da cópia mostra `actor: "pwa-legacy"`, `verified: "none"` (`api/server.js:593`). Conferir que o `stateHash` da linha corresponde ao payload velho, **não** ao do servidor: é a prova de que a janela existe. Derrubar a instância e apagar `/tmp/og-teste` em seguida.

**Bloco B — produção, com backup e edições revertidas: o cenário do cliente novo**
7. Com o app aberto (`rev` `R` do passo 1), o agente escreve: `PATCH /api/routines/<rid>` com `If-Match: "R"` e ator → **200**, `rev` `R+1`. `GET /api/audit?limit=1` mostra `actor: "hermes"`, `verified: "signature"`, `revBefore: R`, `revAfter: R+1`.
8. Sem fechar o app, uma edição local: o app empurra com `If-Match: "R"` → **409 `STALE_STATE {rev: R+1}`** → relê, mescla e reenvia com `If-Match: "R+1"` → **200**, `rev` `R+2`. Conferir no estado que **as duas** coisas estão lá: a rotina do agente **e** a edição local.
9. **Prova do RF-3 (a diferença medível desta spec):** uma **segunda** edição local, logo depois, sai em **uma** requisição. Instrumento: aba *Network* do DevTools filtrada por `data`; conta como "uma ida" um `PUT /api/data` com `200` **sem** um `409` antes dele. Esperado: 1. Antes desta spec: 3 (`PUT` 409 → `GET` → `PUT` 200).
10. **Prova do RF-1 + RF-2 no caso "aberto e sujo" — é o passo que responde ao item.** Com o app aberto:
    (a) no DevTools, *Network* → **Offline**, e **antes** de qualquer edição confirme no console que ainda não há pendência: `localStorage.getItem('gym_dirty')` deve ser `null`;
    (b) faça a edição local e confirme no console `localStorage.getItem('gym_dirty') === '1'` — **este é o instrumento**, não "cortar a rede por alguns segundos" (o debounce de 1,5 s pode ter enviado antes do corte);
    (c) pelo agente (que não passa pelo DevTools), escreva uma rotina que você **não** tocou;
    (d) volte *Network* para Online e vá para outra aba e de volta ao app → o plano do agente chega na tela, a sua edição pendente **continua lá** e o aviso aparece uma vez, **em português**;
    (e) alternar de app e voltar de novo, mesma revisão → o aviso **não** repete.
    Antes desta spec, por `_ts` e sem o adotador, este passo não adotaria nada e ainda poderia descartar a edição local.
11. **Prova do `active`:** com treino em andamento, o agente escreve e você volta ao app → a sessão em andamento continua no aparelho (o servidor apaga `active` de todo `PUT`, `api/server.js:589`) e a tela não volta ao início.
12. **Reverter as edições de teste** no app (desfazer o que os passos 8-10 mudaram) e conferir: o estado final bate com o backup do passo 2, **exceto** a rotina escrita pelo agente no passo 7. Se ela não deve ficar, apagar com `DELETE` auditado (o mesmo caminho do agente, com `If-Match`).

**Bloco C — o critério de saída e o custo por edição**
13. No registro de **produção**, contar as linhas dos últimos 7 dias com `action: "put-state"` e **`ifMatch: "none"`** — o campo novo mede exatamente "escrita de navegador sem o token". **Zero** ⇒ a janela fechou e a BACKLOG-09 pode ser encerrada, com esta medição como prova. Qualquer linha ⇒ o item segue aberto com a data da última registrada no backlog.
    **O que NÃO serve como critério:** `actor: "pwa-legacy"`. Medido em 12/09/2026: ele aparece em **100%** das escritas do app (72 de 72 linhas), antigas ou novas, porque só significa "sem a assinatura do assistente". O critério anterior, escrito na v3, era impossível de cumprir.
    **Ressalva:** uma chamada manual minha `PUT` sem token também entraria nessa contagem. Durante a janela eu não faço nenhuma — e, se fizer, registro aqui com a data e o motivo.
14. Para medir o **custo por edição** (RF-3), no log da API (`docker logs opengym-api-1`): contar, por janela de uso, as linhas `op=put` (aceitas, com `ifMatch=<rev>`) e `op=put-rejected` (recusadas, `reason=stale` ou `reason=clock`). Cliente novo = **1** `op=put` por edição. Cliente antigo = **1** `op=put-rejected reason=stale` **+** `GET` **+** `1` `op=put` (o `GET` da releitura não é logado pela API; a conta se fecha pelo par recusa+aceitação).

**Fechamento**
15. Conferir o `sha256` do estado vivo (`state-<uid>.json`) contra o do passo 2 e registrar a diferença intencional; confirmar que a instância de teste está derrubada e que nada em `/tmp/og-teste` foi copiado de volta.
16. Automatizados: `cd frontend && npm test` — medido em 12/09/2026: **10 arquivos, 252 testes, verdes** (a spec irmã tinha medido 219 em 11/09). O `node --test api/routines.test.js` **não roda no host** (falta `@simplewebauthn/server`, que vive na imagem): se a verificação da API for necessária, ela roda dentro do container.

---

## Rollout e reversão

1. `frontend/src/lib/plan-merge.js` + `plan-merge.test.js` (puro, sem risco).
2. `frontend/src/store/useStore.js` + os invariantes em `useStore.test.js` (substituindo a asserção da linha 123).
3. `frontend/src/locales/pt.js`.
4. `cd frontend && npm test` (a suíte inteira — **252** testes em 12/09/2026: os de antes + 8 do `plan-merge.test.js` + os invariantes novos). O build é o do passo 5, **dentro do Docker**: o `npm run build` **no host falha** se o `frontend/dist` tiver arquivos com dono `root`, o que acontece depois de um build no container — o `vite` não consegue esvaziar o diretório (`_rmdirSync` EACCES). Não é defeito desta spec; o build que vale é o da imagem.
   Nota: `node --test api/routines.test.js` **não roda no host** (falta `@simplewebauthn/server`, que vive na imagem). Se a verificação da API for necessária, ela roda dentro do container.
5. `docker compose build web && docker compose up -d --force-recreate web`.
6. Medição (roteiro acima) e, se o passo 13 der zero, encerrar a BACKLOG-09 no `docs/backlog.md`.

**Reversão:** `git revert` do commit do frontend. Nada no servidor muda, então não há migração para desfazer. O cliente revertido volta a não guardar a revisão (3 requisições por edição, como hoje) e para de reler ao voltar; `gym_coach_notice_rev` fica órfã e inerte. O `nginx.conf` já serve o `index.html` com `no-cache, must-revalidate`, então a próxima abertura do app pega a versão publicada.

---

## Riscos residuais e limitações

- **A janela do cliente antigo continua aberta, e isso é decisão consciente (U2).** Um aparelho com o bundle velho em cache não manda `If-Match`; ele carimba `Date.now()` ao editar e passa pelo guard por relógio, sobrescrevendo a escrita do assistente. O que esta spec entrega é a **prova** de que a janela existe (passo 6) e o **critério objetivo** para dizer quando fechou (passo 13: 7 dias). Até lá, o protocolo de pedir "PWA fechado" antes de escrever continua sendo a proteção processual, e o `reports/sync_log.md` continua sendo o registro.
- **O aviso é por revisão, não por escrita:** duas escritas do agente entre duas leituras geram **um** aviso.
- **Duas abas no mesmo aparelho ainda podem gerar `409` mútuo.** Cada aba tem o próprio store em memória (e o próprio `lastPull`), com o `localStorage` compartilhado; quando a aba A adota a revisão 6 e a aba B empurra com a revisão que tem em memória, B leva `409` e se resolve sozinha pela mescla. É correção, não perda — custa uma releitura a mais. Fechar isso exigiria reler o `S` do `localStorage` no início do `pushState`, que é outra mudança.
- **A releitura ao voltar não é instantânea:** acontece no máximo 20 s depois da anterior e não roda se houver push agendado. Numa alternância rápida de app a tela pode ficar até 20 s sem reler.
- **`planChanged` compara rotina inteira por JSON, sensível à ordem das chaves:** uma reordenação de campos conta como mudança e liga o aviso. É aceitável (o aviso informa e não bloqueia nem perde dado) e está **fixado por teste**.
- **O aviso pode aparecer com a tela inalterada** — é a U3: o gatilho é "o plano guardado mudou", sem separar autor.
- **A revisão confirmada é regravada em cada salvamento** (serialização do estado inteiro): com ~300 treinos é uma escrita extra do mesmo tamanho que o `persist` da edição já faz. Aceito — é o preço de ter a base certa na próxima escrita.
- **A chave antiga `gym_coach_notice_shown` fica órfã** nos aparelhos já usados: inerte, sem código de migração.
- **O aviso usa o toast existente:** se a UI não estiver montada no momento da releitura, o aviso não aparece; a próxima revisão nova avisa de novo.
- **Nada disso impede o agente de escrever durante o treino:** o servidor continua apagando `active` em todo `PUT`. O que a spec garante é que o **app** preserva o `active` local e mescla em vez de sobrescrever.

---

## Medição do aceite (12/09/2026) — o cenário reproduzido

Executado contra a produção, com backup datado antes (`state-ZPJbmYUfHlfbAYzi.bak.20260912-162653.json`, `sha256 9bfc338b…`) e **nenhuma alteração de dado**: o estado final difere do backup **apenas em `rev` (77→81) e `_ts`** — conferido campo a campo: 301 treinos, 6 rotinas e os ajustes, idênticos.

**O log da API conta a história inteira.** As três primeiras linhas são edições feitas no app real, no bundle publicado; a terceira do meio é a escrita externa:

```
[og-state] op=put          actor=pwa-legacy ifMatch=77 rev=77->78    ← edição 1: o cliente publicado manda o token
[og-state] op=put          actor=pwa-legacy ifMatch=78 rev=78->79    ← edição 2: mandou 78, que só podia vir da RESPOSTA anterior (RF-3)
[og-state] op=put          actor=hermes     ifMatch=79 rev=79->80    ← escrita externa com o app aberto (sessão forjada + assinatura de ator, o caminho do assistente)
[og-state] op=put-rejected reason=stale     ifMatch=79 serverRev=80  ← a edição local com base velha foi RECUSADA, em vez de sobrescrever
[og-state] op=put          actor=pwa-legacy ifMatch=80 rev=80->81    ← releu, mesclou e reenviou com a base nova
```

**O que isso prova:**
- **RF-3** — o cliente publicado manda `If-Match` (o antigo não mandava nada) e **lembra a revisão que o servidor confirmou**: `77 → 78`, sem nenhuma recusa no meio. Antes desta spec, a segunda edição teria mandado `77`, apanhado `409` e reenviado — as 3 requisições por edição.
- **O coração da BACKLOG-09** — a edição local com base velha foi **recusada**, não sobrescreveu a escrita externa; e o cliente se recuperou sozinho (releu, mesclou, reenviou com a base nova).
- **Nenhuma escrita sem token** em toda a medição (`ifMatch=none` = 0): o teste não sujou o critério de saída.

**O que NÃO foi exercitado ao vivo:** a releitura ao voltar (RF-1). Ela depende de trocar de aba e voltar, e as ferramentas que eu tenho não ativam uma aba já aberta — navegar de novo faria uma recarga, que é o pull de boot e não o de foco. Fica coberta pelos invariantes de §4; o passo 10 do roteiro (com o DevTools) é o que a exercita de verdade.

---

## Mudanças da v1 para a v2 (achados da revisão 1)

| Achado | Severidade | O que mudou |
|---|---|---|
| R1 | bloqueante | `adoptRev` agora chama `nativePersist()` quando `MOBILE` — sem isso a revisão confirmada não chegava ao armazenamento nativo que o boot do Android lê |
| R2 | bloqueante | Invariantes do teste com `at(marker)` que **confere a existência** do marcador antes de fatiar (recorte vazio fazia `.not.toMatch()` passar em silêncio) |
| R3 | bloqueante | §2.7 reescrita **por inteiro**: as duas comparações por `_ts` saem, e a mescla passa a usar `adoptServerRoutines` (antes dizia "como hoje", ambíguo) |
| R4 | bloqueante | Contexto corrigido: é "todo salvamento **depois do primeiro de cada sessão**", e o passo 9 nomeia a sequência exata de 3 requisições |
| R5 | média | `window.focus` **sai** do desenho (disparava em diálogo de passkey e seletor de arquivo); só `visibilitychange` relê |
| R6 | média | Vira decisão do usuário (U3): aviso pelo plano do servidor contra a base, sem separar autor — e a mensagem deixa de atribuir autoria |
| R7 | média | `prevBase` passa a ser entregue ao `adoptServerRoutines` (uma leitura de base, não duas) |
| R8 | média | Declarado que a asserção da **linha 123** de `useStore.test.js` é substituída |
| R9 | média | Chave antiga órfã: decisão explícita de **não** migrar |
| R10 | média | Confirmado o caminho do `rev` no corpo: `lib/api.js:8-13` + `api/server.js:601` |
| R11 | média | Adoção total documentada como segura só sem nada pendente (`!dirty`) |
| R12 | média | `pullOnReturn` não roda com push agendado (`if (pushTm) return`) |
| R13 | média | Valor da chave do aviso validado (na v3 com `Number.isInteger`) |
| R14 | média | Duas abas: registrado como limitação conhecida |
| R15 | leve | Custo da regravação do `rev` registrado e aceito |
| R16 | leve | Instrumento de contagem fixado (DevTools → Network, filtro `data`) |
| R17 | leve | Trava de alvo (URL + diretório + `uid`) e a escrita perigosa movida para **instância de teste** |
| R18 | leve | Contagens de teste alinhadas com a spec irmã (219 e 61, medidas em 11/09/2026) |
| R19 | leve | Caso de teste com chaves reordenadas fixando o comportamento |
| R20 | leve | Ressalva no critério de 7 dias: chamada manual sem ator também vira `pwa-legacy` |
| — | — | **Achado meu, confirmado na revisão 2:** o ramo de mescla do `pullState` adotava as rotinas do servidor inteiras (`useStore.js:210`) — corrigido no §2.7 |

## Mudanças da v2 para a v3 (achados da revisão 2)

| Achado | Severidade | O que mudou |
|---|---|---|
| S1 | bloqueante | O aviso passou a receber **`state.routines` (o servidor)** nos dois ramos, não o resultado da mescla: uma rotina criada só neste aparelho sobrava no mapa e disparava aviso falso, violando a U3 |
| S2 | bloqueante (procede em parte) | A validação da revisão guardada passou a `Number.isInteger(parsed) ? parsed : -1`. A v2 já estava correta (`Number.isFinite(NaN)` é `false`), mas `isInteger` é exato para um contador e encerra a dúvida |
| S3 | bloqueante | RF-4 e §2.7 agora dizem explicitamente que o aviso do caminho de `409` sai do próprio bloco de `409` (§2.6), não do `pullState` (que só avisa com `notify` verdadeiro) |
| S4 | bloqueante | Nome do teste de ordem de chaves corrigido (`MUDOU`, não `NÃO mudou`) — o nome dizia o oposto da asserção |
| S5 | média (**segurança**) | `OPENGYM_DATA_DIR` → **`DATA_DIR`** na instância de teste. Com o nome errado a API subia com o padrão `'/data'`, que no container **é o estado de produção**. Armadilha registrada no roteiro |
| S6 | média | Caminho do estado corrigido para `<DATA>/state-<uid>.json` (`api/server.js:58`), nas ocorrências do roteiro |
| S7 | média | Assinatura do ator descrita sem ambiguidade: `v1` em **hex minúsculo de 64**, `t` em segundos repetido no HMAC, `path` sem query, `agentKey` em hex |
| S8 | média | Removida a instrução "conferir o vocabulário de assistente no `pt.js`" (beco sem saída: nenhuma dessas palavras existe lá) e a tradução ficou fixada |
| S9 | média | Premissa declarada: `rev` só cresce; e o aviso é **por revisão**, não por escrita individual |
| S10 | média | Passo 10 ganhou instrumento de verdade para o estado sujo (DevTools Offline **antes** da edição + `localStorage.getItem('gym_dirty')` no console) |
| S11 | leve | Mescla da releitura usa `Math.max(Date.now(), state._ts \|\| 0) + 1`, igual ao caminho de `409`, em vez de `Date.now()` solto |
| S12 | leve | Regex do invariante passou a `\(_ts \|\| 0\)\s*[<>]=?` (antes só pegava `>`, deixando passar um `>=` reintroduzido) |
| S13 | leve | Recorte do teste de `adoptRev` ancorado em `const adoptRev = rev =>` |
| S14 | leve | JSDoc de `planChanged` diz que `base` é o **mapa** id→rotina de `readBase()`, não uma lista |
| S15 | leve | `pullState` devolve `true`/`false` e `pullOnReturn` zera o `lastPull` quando a releitura falha (offline não consome a janela de 20 s) |

---

## Implementação e evidências (12/09/2026)

**Arquivos na branch `emerson-custom`** (sha256 conferido entre o Windows e a árvore do hermes, um a um):

| Arquivo | Linhas | sha256 |
|---|---|---|
| `frontend/src/lib/plan-merge.js` (alterado) | 71 | `6023fddc1250a757b492d36582722e4d7a70d17e3e7e662e011d480b4b32d071` |
| `frontend/src/lib/plan-merge.test.js` (**novo**) | 39 | `bae34740986ffb1682e041ebaa748a861e24c30e2aac6630042f41a7884a9c05` |
| `frontend/src/store/useStore.js` (alterado) | 325 | `821da4c8f736a378dea0f1e11e2a377b81b751e3567958f61f1399817a835563` |
| `frontend/src/store/useStore.test.js` (alterado) | 169 | `95c99d6d5c5f40b2d33ac7a57d777283a3811bd78a32c177574f122f6b27cd5f` |
| `frontend/src/locales/pt.js` (alterado) | 581 | `ab227d7db8e5f03357cf67af641eb43acc1c6ac1b7d44d7575e394e5b97f0604` |

**Backup dos originais:** `/tmp/og-bak-backlog09/` no hermes (os quatro que já existiam). **Nada em `api/` foi tocado** — conferido por `git status`.

**Testes:** `npx vitest run` em `frontend/` → **10 arquivos, 252 testes, todos verdes**, incluindo os 8 novos de `plan-merge.test.js` e os invariantes novos do `useStore.test.js`. A suíte anterior tinha 219 (204 + 15, medida em 11/09/2026).

**O que a implementação revelou, e que a spec não previa:**
1. Além da linha 123, **três outras asserções** do teste existente dependiam do texto antigo (108, 112, 113) — corrigidas e agora listadas em §4. A linha 112 era a mais traiçoeira: com a assinatura nova, `indexOf('async pullState()')` devolvia `-1` e o recorte virava vazio.
2. O `npm run build` **no host** falha com `_rmdirSync EACCES` quando `frontend/dist` tem arquivos com dono `root` (de um build anterior dentro do container). O build que vale é o da imagem, e é por isso que este item não é defeito da spec.
3. `node --test api/routines.test.js` **não roda no host**: falta `@simplewebauthn/server`, que só existe na imagem. A verificação da API, se necessária, roda dentro do container.

**O que falta para o aceite:** publicar a imagem (`docker compose build web` + `docker compose up -d --force-recreate web`) e executar o roteiro — em especial os passos 9, 10 e 13, que **são** a medição.

---

## Mudanças da v3 para a v4 (o que a medição de 12/09/2026 impôs)

| Achado | Severidade | O que mudou |
|---|---|---|
| **M1** | bloqueante | **O critério de saída não media o que dizia medir.** O rótulo `actor: "pwa-legacy"` é aplicado a **qualquer** requisição sem a assinatura do assistente (`api/server.js:593`), e o navegador nunca manda essa assinatura: medido, **72 de 72** linhas do registro eram `pwa-legacy`, incluindo duas escritas de **16:31 de 12/09/2026**, já com o bundle novo no ar. O critério "7 dias sem `pwa-legacy`" era **impossível de cumprir** e teria dado falso positivo sobre a versão em uso. Trocado por `ifMatch: "none"` (RF-5 + passo 13) |
| **M2** | média | **Não havia instrumento para contar o custo por edição.** O `409` não era logado e o `access_log` do nginx está desligado (o `nginx.conf` do repo não tem a diretiva, e `docker logs opengym-web-1` só tem as 24 linhas do entrypoint). Entrou o log `op=put-rejected`, e o passo 14 passou a medir por ele |
| **M3** | leve | O `sha256`/dono do `audit.jsonl` é `-rw------- root root`: qualquer leitura precisa passar pelo container (`docker exec opengym-api-1 cat /data/audit.jsonl`) ou por `sudo`. Registrado no roteiro |
| **M4** | leve | O estado **não** vive em `<repo>/data` (ali só há `db.json`, `secret` e `vapid.json`): vive em `/mnt/drivebackup/apps/openGym/data`, montado como `/data` no container (`docker-compose.yml`, serviço `api`). O caminho do roteiro foi corrigido, e o `uid` em uso é `ZPJbmYUfHlfbAYzi` |
| **M5** | média | **Um ajuste de configuração que perde a corrida é descartado em silêncio.** Medido: o terceiro toggle caiu no caminho de `409`, e a mescla desse caminho monta o estado a partir do SERVIDOR (`merged = Object.assign(clone(DEF), srv)`, `useStore.js:162`) — então o ajuste local voltou atrás sem aviso nenhum (`keepAwake` terminou em `true`, o valor do servidor). É comportamento **pré-existente**, não desta spec: a mescla de escalares é a de antes, e o que esta spec acrescentou foi a mescla de **rotinas** (U1, que cobre plano/rotina/treino). Fica registrado para virar item próprio: *"ajuste de configuração que perde a corrida some sem avisar"* |

---

## Relação com os outros itens

- **Fecha a BACKLOG-09** quando o passo 13 do roteiro der zero (ou fica com o risco declarado e a data, se não der).
- **BACKLOG-02** (criação de rotinas em lote) segue como está: nem desbloqueada nem bloqueada.
- **`docs/specs/spec_micro_meso_via_app.md`** continua como histórico; a errata do `If-Match-State` (A7 da `spec_api_rotinas.md`) não é tocada aqui.
- **`api/server.js` muda em três linhas de instrumentação** (o campo `ifMatch` no audit e dois `console.log` de escrita recusada). A trava original desta spec era "o servidor não muda"; a medição de 12/09/2026 mostrou que sem instrumento o aceite era **imensurável** (ver M1), e o usuário autorizou a linha. Nenhuma regra de aceitação ou recusa foi tocada: o diff é só `console.log` e um campo novo no objeto `meta`.
