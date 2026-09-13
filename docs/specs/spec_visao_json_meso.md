# Spec: visão crua do mesociclo — revisão da superfície de JSON do app — v2

> **v2 (13/09/2026):** incorpora os 19 achados da revisão por subagente. As três perguntas de produto
> (escopo e instante do aviso de "não enviado"; mesociclo de 64 KB) foram respondidas com **"backlog"**
> pelo usuário: saíram desta spec e viraram **BACKLOG-17** e **BACKLOG-18**. Também entraram no escopo
> os dois documentos que ainda descreviam os escopos retirados.
>
> **Já implementado e no ar:** commits `3aaaa29`, `e0efb7b`, `0850441` e o das correções da revisão.
> Nada nesta spec está pendente de código — o que sobrou está no backlog, por decisão.

## Contexto e Objetivo

O app ganhou uma tela de "visão crua" (o JSON que ele guarda). Ela nasceu com **três escopos** —
mesociclo, plano e estado inteiro — e o usuário abriu a tela e perguntou o que ninguém deveria
precisar perguntar: *"estamos mostrando um json mocado, por quê?"*.

Ele estava certo. O escopo "plano" não era um objeto do app: era um **envelope montado na hora**
(`{mesos, activeMeso, mesoPrev, routines, week, dayPlan, customEx}`), com dados reais dentro de uma
forma inventada. Junto vinham três defeitos menores e um de verdade: o subtítulo dizia `plan.json`
(nome de arquivo que não existe — o arquivo real é `state-<uid>.json`), o botão **Compartilhar**
gerava `opengym-plan.json`, quase o nome do arquivo de plano que o app realmente compartilha mas com
outra forma (quem importasse levaria erro), e o escopo do mesociclo sem id mostrava "não está neste
perfil" em vez do mesociclo ativo.

**Correção decidida com o usuário:** a visão crua mostra **só o mesociclo**. Os outros escopos saem.

- **Repo:** `/mnt/drivebackup/apps/openGym/openGym`, branch `emerson-custom`
- **Stack:** React 19 + Vite (PWA com service worker), API Node 22, containers no Pi

## Escopo

- **Inclui**
  - A tela de visão crua (`/plan/raw`) reduzida ao **objeto do mesociclo**, sem seletor de escopo.
  - Rótulos honestos: nada de nome de arquivo que não existe; o subtítulo diz o que a coisa é.
  - `Compartilhar .json` reusando o caminho de export que já existe (`exportMeso`), em vez de uma
    segunda cópia do mesmo download.
  - A escolha do mesociclo mostrado (`?id` → ativo → primeiro) como **função pura testada**
    (`pickMeso`), usada pela visão crua **e** pelo Plan Tools.
  - O bloco `EXTRAS` da tela do mesociclo: valor aninhado indentado, não numa linha só.
  - Limpeza das chaves de tradução mortas e do plural da contagem de linhas.
  - **Os dois documentos que ainda descreviam os escopos retirados**: `docs/MESO.md` (§4) e
    `docs/specs/spec_meso_no_app.md` (RF-11 e teste manual 9), este último com nota de superação.
- **Não inclui**
  - **Escopo de plano e escopo de estado inteiro** — retirados por decisão do usuário. O backup do
    perfil continua em Settings, que é onde ele pertence.
  - Editar JSON na tela: escrever continua sendo pelo formulário (validado) e pelo import (que valida
    forma).
  - Exportar CSV/JSON do mesociclo (menu do mesociclo) e o import (folha própria).
  - O formato do arquivo de plano compartilhável (`lib/plan-share.js`).
- **Adiado para o backlog (decisão do usuário em 13/09/2026)**
  - **BACKLOG-17** — aviso de que a cópia na tela pode estar à frente do servidor. Não entrou porque o
    sinal não existe: o `gym_dirty` do `localStorage` só liga quando o envio **falha**, e o `pushTm`
    que agenda o envio é um `let` de closure dentro do `create()` do store — não dá para ler de fora
    nem dispara re-render. Falta decidir escopo do aviso, instante e onde o sinal mora.
  - **BACKLOG-18** — mesociclo grande (até 64 KB) na tela: rolar tudo ou mostrar o começo com "mostrar
    tudo". Hoje a tela rola tudo, e o tamanho aparece no subtítulo.

## Decisões do usuário

| # | Decisão | Efeito visível |
|---|---|---|
| U1 | A visão crua mostra **só o mesociclo** | Uma tela, um objeto; nada de "plano" nem "estado inteiro" |
| U2 | Arquivo só onde o app sabe ler de volta | **Compartilhar .json** existe apenas no mesociclo; copiar existe em todo lugar (copiar não promete nada) |
| U3 | Os dois pontos restantes (aviso de cópia local, mesociclo de 64 KB) vão para o **backlog** | A entrega fecha sem eles; ficam registrados como BACKLOG-17 e BACKLOG-18 |

## Decisões assumidas

- **A1 — A rota continua `/plan/raw`, com `?id=<meso>`.** Mudar o caminho quebraria os dois pontos de
  entrada já no ar; o nome não era o problema (o rótulo era).
- **A2 — A escolha do mesociclo é uma função pura**, `pickMeso(mesos, id, activeMeso)`: o id pedido,
  senão o ativo, senão o primeiro, senão nenhum. Pura de propósito: a decisão entra no teste sem DOM,
  e o Plan Tools usa a mesma função (então um perfil com mesociclos e sem ativo tem seção, em vez de
  nenhuma).
- **A3 — O subtítulo diz o tipo, não um nome de arquivo.** `objeto do mesociclo · 1,2 KB · 68 linhas`,
  com o número no formato da língua (`fmtNum`) e o plural resolvido por chave própria
  (`{0} line` / `{0} lines`). O nome do arquivo só existe onde há arquivo: no `Compartilhar`.
- **A4 — O botão de compartilhar chama `exportMeso`** (já exportado por `sheets.jsx`), em vez de
  repetir blob, nome e MIME. Uma implementação de download no app, não duas.
- **A5 — O aviso de leitura fica no fim da tela.** "Só leitura: é o que o app guarda, não um editor."
- **A6 — Valor aninhado em `EXTRAS` sai em `<pre class="rawjson">`** — o mesmo monoespaçado da visão
  crua — em vez de um `JSON.stringify` de uma linha.
- **A7 — A chave de tradução `Data` é compartilhada com Settings** (`frontend/src/views/Settings.jsx:179`,
  `<Section title={t('Data')}>`). Ao limpar as chaves dos escopos retirados ela tem de ficar; as
  outras quatro (`mesocycle.json`, `plan.json`, `state.json`, `rev {0} · synced {1}`) foram removidas
  depois de conferir zero usos no código.
- **A8 — A visão crua mostra o que o app guarda, e o arquivo é o que ele lê de volta.** O botão de
  compartilhar existe porque o arquivo contém o objeto completo (extras incluídos) — que é o que o
  import aceita, já que ele detecta por **conteúdo**, não por nome de arquivo.
- Decididas por mim por serem detalhe de implementação e não mudarem o que o usuário vê.

## Requisitos Funcionais

- **RF-1. Uma tela, um objeto.** `/plan/raw` mostra **o JSON do mesociclo**: título = nome do
  mesociclo, subtítulo = `objeto do mesociclo · <KB> KB · <n> linhas`, corpo = o objeto indentado com
  dois espaços. Não há seletor de escopo.
- **RF-2. Nada de forma inventada.** O que a tela mostra é exatamente o objeto que o perfil tem em
  `S.mesos[]` — a mesma serialização do export (`mesoToJSON`), campos desconhecidos incluídos.
- **RF-3. Rótulo honesto.** Nenhum nome de arquivo que não exista. O subtítulo diz o que a coisa é; o
  nome do arquivo só aparece onde há arquivo de verdade.
- **RF-4. Sem id, cai no ativo.** `?id=` manda; sem id (ou com id que não existe mais) a tela mostra o
  mesociclo **ativo** e, na falta dele, o **primeiro** da biblioteca.
- **RF-5. Sem mesociclo nenhum.** Estado vazio explícito com o botão `Novo mesociclo` — nunca um bloco
  de JSON vazio nem uma mensagem de erro.
- **RF-6. Copiar sempre, compartilhar só onde volta.** `Copiar JSON` e `Compartilhar .json` nesta tela;
  o arquivo sai pelo mesmo caminho do export do app (`exportMeso` → `<id>.json`) e volta pela folha de
  import, que aceita o objeto completo. O aviso de só leitura aparece abaixo dos botões.
- **RF-7. `EXTRAS` legível.** Na tela do mesociclo, campo extra com valor aninhado é renderizado
  indentado (monoespaçado); valor simples continua em texto.
- **RF-8. Dois pontos de entrada, um destino.** O menu do mesociclo (`⋯ → View JSON`) e o Plan Tools
  (`Mesocycle → View JSON`) levam à mesma tela. O Plan Tools usa `pickMeso`: com mesociclo ativo abre
  o ativo; sem ativo, o primeiro da biblioteca (antes, a seção simplesmente não existia). A seção
  `Data` com "View plan as JSON" não existe mais.

## Detalhe de Implementação (nível código)

### 1. `frontend/src/lib/meso.js` — a escolha do mesociclo (novo, testado)

```js
/**
 * Qual mesociclo mostrar quando a tela pergunta por um id: o do id, senão o ATIVO, senão o
 * primeiro da biblioteca, senão nenhum. Pura de propósito — a escolha é o que a visão crua e o
 * Plan Tools decidem, e isso entra no teste sem DOM.
 */
export function pickMeso(mesos, id, activeMeso) {
  const list = mesos || []
  return list.find(m => m.id === id) || list.find(m => m.id === activeMeso) || list[0] || null
}
```

Em `frontend/src/lib/meso.test.js`:

```js
  it('pickMeso: id manda, senão o ativo, senão o primeiro, senão nenhum', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(pickMeso(list, 'c', 'a').id).toBe('c')       // o id pedido vence
    expect(pickMeso(list, 'sumiu', 'b').id).toBe('b')   // id que não existe cai no ativo
    expect(pickMeso(list, null, null).id).toBe('a')     // sem id e sem ativo: o primeiro
    expect(pickMeso([], 'a', 'b')).toBe(null)
    expect(pickMeso(undefined, 'a', 'b')).toBe(null)
  })
```

### 2. `frontend/src/views/PlanRaw.jsx` (reescrito — o arquivo como está)

```jsx
// frontend/src/views/PlanRaw.jsx — o JSON cru de UM mesociclo (só leitura).
//
// Só o mesociclo. É o único objeto do app que esta tela pode mostrar sem inventar nada: ele é
// lido e escrito exatamente como está, e é o único cujo arquivo o app importa de volta.
//
// O que NÃO existe mais aqui, de propósito: escopos de "plano" e de "estado". O plano não é um
// objeto guardado — era um envelope montado na hora, que parecia um arquivo do app sem ser — e o
// estado inteiro é o backup, que vive em Settings. Nome de arquivo que não existe (`plan.json`)
// também saiu: o subtítulo diz o que a coisa é.
//
// O aviso de "cópia à frente do servidor" saiu desta entrega por decisão do usuário e está na
// BACKLOG-17 (precisa de um sinal de verdade no store; o `gym_dirty` de hoje só liga quando o
// envio FALHA). O mesociclo grande (até 64 KB) está na BACKLOG-18.
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { mesoToJSON } from '../lib/meso-file.js'
import { pickMeso } from '../lib/meso.js'
import { exportMeso, mesoFormSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Uma linha ou muitas: a chave em inglês é a fonte, então o singular precisa da sua própria.
const lineCount = n => t(n === 1 ? '{0} line' : '{0} lines', n)

export default function PlanRaw() {
  const [q] = useSearchParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)

  const meso = pickMeso(S.mesos, q.get('id'), S.activeMeso)

  const json = meso ? mesoToJSON(meso) : ''
  const kb = meso ? new Blob([json]).size / 1024 : 0
  const lines = json ? json.split('\n').length : 0

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      useUI.getState().toast(t('Copied'))
    } catch { useUI.getState().toast(t('Could not copy')) }
  }

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <h1 style={{ fontSize: 24 }}>{meso ? meso.name : t('Mesocycle')}</h1>
        <div className="sub">
          {t('mesocycle object')}{meso ? ` · ${fmtNum(kb)} KB · ${lineCount(lines)}` : ''}
        </div>
      </div>
    </div>

    {!meso
      ? <div className="empty">
          <div className="ico"><Icon name="clipboard" /></div>
          {t('No mesocycle yet')}
          <div style={{ height: 12 }} />
          <Button variant="tinted" icon="plus" onClick={() => mesoFormSheet({})}>{t('New mesocycle')}</Button>
        </div>
      : <>
          <div className="dim small" style={{ margin: '0 2px 12px', lineHeight: 1.45 }}>
            {t('Exactly what the app stores for this mesocycle — extra fields included.')}
          </div>
          <pre className="rawjson">{json}</pre>
          <div style={{ height: 12 }} />
          <Button variant="primary" icon="clipboard" onClick={copy}>{t('Copy JSON')}</Button>
          <div style={{ height: 8 }} />
          <Button variant="ghost" icon="upload" onClick={() => exportMeso(meso, 'json')}>{t('Share .json')}</Button>
          <div className="dim small" style={{ margin: '10px 2px 0', lineHeight: 1.45 }}>
            {t('Read-only: this is what the app stores, not an editor.')}
          </div>
        </>}
  </>
}
```

> **O rótulo do voltar.** O `aria-label` do botão é `t('Plan')` e o destino é `/plan` — o mesmo
> destino do `‹` das outras telas do app. (A revisão apontou que o rótulo não descreve o destino
> *anterior*; ele descreve **para onde vai**, como no resto do app. Fica, e o critério de aceite
> deixou de exigir que nenhum rótulo mencione "plano": o que a tela não pode fazer é prometer um
> escopo de plano nos **dados**.)

### 3. `frontend/src/views/MesoEdit.jsx` — bloco `EXTRAS`

```jsx
// ANTES: objeto aninhado saía numa linha só, sem estrutura e estourando a largura
{typeof v === 'object' ? JSON.stringify(v) : String(v)}

// DEPOIS
{v !== null && typeof v === 'object'
  ? <pre className="rawjson" style={{ margin: 0 }}>{JSON.stringify(v, null, 2)}</pre>
  : <div className="small dim" style={{ lineHeight: 1.45, overflowWrap: 'anywhere' }}>{String(v)}</div>}
```

### 4. `frontend/src/sheets.jsx` — os pontos de entrada

```jsx
// 4.1 Plan Tools: o mesociclo da folha é o ativo e, sem ativo, o primeiro (a mesma função da tela).
//     Sem isto, um perfil com mesociclos e `activeMeso` nulo não tinha seção nenhuma.
import { …, pickMeso } from './lib/meso.js'
  const activeMeso = pickMeso(st.mesos, null, st.activeMeso)

    {activeMeso && <>
      <h4 className="sec">{t('Mesocycle')}</h4>
      <Button variant="ghost" icon="upload" onClick={() => exportMeso(activeMeso, 'json')}>{t('Export mesocycle (JSON)')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" icon="upload" onClick={() => exportMeso(activeMeso, 'csv')}>{t('Export mesocycle (CSV)')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" icon="code" onClick={() => { close(); nav('/plan/raw?id=' + activeMeso.id) }}>{t('View JSON')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" icon="pencil" onClick={() => { close(); nav('/plan/meso/' + activeMeso.id) }}>{t('Open the mesocycle')}</Button>
    </>}
    {/* a seção `Data` com "View plan as JSON" foi retirada */}

// 4.2 Menu do mesociclo (⋯): a rota perde o `scope` — não há mais escopo
    <Button variant="ghost" icon="code" onClick={() => { close(); nav('/plan/raw?id=' + meso.id) }}>{t('View JSON')}</Button>
```

### 5. `frontend/src/locales/pt.js` — chaves

**Saíram** (zero usos no código, conferido antes de remover): `mesocycle.json`, `plan.json`,
`state.json`, `rev {0} · synced {1}`.

**Entraram:**

```js
  '{0} line': '{0} linha',
  'Exactly what the app stores for this mesocycle — extra fields included.': 'Exatamente o que o app guarda deste mesociclo — campos extras incluídos.',
```

**Ficou** (não é só desta tela): `'Data': 'Dados'` — usada em `views/Settings.jsx:179`.

### 6. Documentos atualizados

- **`docs/MESO.md`** (§4, "No app"): a linha da visão crua passou a descrever `/plan/raw?id=<meso>`,
  só o mesociclo, com a nota de que os outros escopos foram retirados.
- **`docs/specs/spec_meso_no_app.md`**: nota de superação no fim — o RF-11 e o teste manual 9 daquela
  spec descrevem os três escopos e valem como histórico; a fonte da verdade é esta spec.

## Comportamento Visual/UX

### Antes (o que o usuário viu e questionou)

```
‹  Plan
   plan.json · 18.6 KB · 754 lines
┌──────────────┬───────┬─────────────┐
│  Mesocycle   │ Plan  │  Everything │   ← três escopos, um deles inventado
└──────────────┴───────┴─────────────┘
rev 158 · synced 13/09/2026, 18:58:45
{
  "mesos": [ … ],          ← envelope montado na hora: não é um objeto do app
  "routines": [ … ],       ← e o rótulo prometia um arquivo que não existe
```

### Depois

```
‹  Mesociclo 2 · Low Volume
   objeto do mesociclo · 1,2 KB · 68 linhas
Exatamente o que o app guarda deste mesociclo — campos extras incluídos.

{
  "id": "meso-2026-09-02",
  "name": "Mesociclo 2 · Low Volume",
  "start": "2026-09-02",
  "end": "2026-09-30",
  "origin": "assistant",
  "weeks": [
    { "n": 1, "start": "2026-09-02", "end": "2026-09-07", "phase": "calibração" },
    …
  ],
  "cargas_prescritas": { … }      ← o campo que o app não conhece continua ali
}

[ Copiar JSON ]
[ Compartilhar .json ]
Só leitura: é o que o app guarda, não um editor.
```

### Sem mesociclo nenhum

```
‹  Mesocycle
   objeto do mesociclo

        📋
   Nenhum mesociclo ainda
   [ + Novo mesociclo ]
```

### `EXTRAS` na tela do mesociclo (campo aninhado)

```
▾ 2 campos do seu arquivo
┌────────────────────────────────────────────┐
│ Cargas prescritas                          │
│   {                                        │
│     "Push Ter": "Desenv máq 114",          │
│     "Legs1 Qua": "Hack 75 · Leg Press 160" │
│   }                                        │
└────────────────────────────────────────────┘
```

Protótipo navegável (antes/depois): `visao_json_ux_preview.html`, servido em
`http://127.0.0.1:8765/visao_json_ux_preview.html`.

## Testes manuais

1. **Só o mesociclo.** Abrir `⋯ → View JSON` na tela de um mesociclo: a tela não tem seletor de
   escopo, o título é o nome do mesociclo e o subtítulo diz `objeto do mesociclo · X KB · Y linhas`.
2. **Sem id.** Navegar para `…/#/plan/raw` sem query: aparece o mesociclo **ativo**. Com
   `?id=<id-que-não-existe>`, aparece o ativo; sem nenhum ativo, o primeiro da biblioteca.
3. **Sem mesociclo.** Perfil sem nenhum mesociclo: estado vazio com o botão `Novo mesociclo`.
4. **Round-trip.** `Compartilhar .json` gera `<id>.json`; importar esse arquivo pela folha de import
   devolve o mesmo objeto (com os extras).
5. **Extras aninhados.** Importar um mesociclo com `cargas_prescritas` (objeto) e abrir `EXTRAS`:
   aparece indentado, com quebras de linha.
6. **Plan Tools.** Abrir a folha de compartilhar do Plan: o bloco `Mesocycle` aparece **com ou sem
   mesociclo ativo** (sem ativo, aponta o primeiro); `View JSON` abre o mesmo destino do menu do
   mesociclo; a seção `Data` não existe.
7. **Formato e plural (PT).** Um mesociclo pequeno mostra `1,2 KB` (vírgula) e `68 linhas`; um de uma
   linha só mostra `1 linha`.
8. **Regressão de tradução.** Em PT, `Settings → Dados` continua traduzido (chave `Data` presente).

## Critérios de aceite

- [ ] `/plan/raw` não tem controle de escopo, e nenhum **dado** mostrado vem de forma montada na hora:
      o texto da tela é igual ao mesociclo guardado no aparelho — comparar com
      `JSON.parse(localStorage.getItem('gym_state_v1')).mesos` (mesmo objeto, extras incluídos).
- [ ] O subtítulo não contém nome de arquivo (`.json` só aparece no botão de compartilhar).
- [ ] Sem `?id=`, a tela mostra o mesociclo ativo; sem nenhum mesociclo, mostra o estado vazio com o
      botão de criar.
- [ ] O arquivo compartilhado (`<id>.json`) reimporta pela folha de import sem erro.
- [ ] `EXTRAS` com valor aninhado renderiza indentado (monoespaçado, quebrando linha).
- [ ] Plan Tools tem `Mesocycle → View JSON` **com e sem** mesociclo ativo, e não tem a seção `Data`.
- [ ] Em PT, `Settings → Dados` continua traduzido, e a contagem de linhas respeita o singular.
- [ ] `cd frontend && npm test` verde, com o caso de `pickMeso` entre os testes (suíte cobre a escolha
      `?id → ativo → primeiro`).
- [ ] `docker compose build web` sem erro e o container `opengym-web-1` healthy.
- [ ] **Não** existe nenhuma chave de tradução órfã das telas retiradas (`mesocycle.json`, `plan.json`,
      `state.json`, `rev {0} · synced {1}`), e `Data` continua presente.
- [ ] `docs/MESO.md` descreve `/plan/raw?id=<meso>` (uma linha, um escopo) e
      `docs/specs/spec_meso_no_app.md` tem a nota de superação.

## Riscos e limites

- **O PWA pode continuar rodando o bundle antigo.** O app registra service worker (`public/sw.js`,
  network-first para assets) e uma aba já aberta segue com o JS em memória: depois de um deploy, o
  usuário vê a tela antiga até recarregar. Foi exatamente o que aconteceu nesta correção (o bundle em
  produção já estava certo e a tela colada pelo usuário era a antiga). Vale para toda entrega: quem
  for verificar, confere **o que o container está servindo**, não a aba aberta.
- **A visão crua mostra a cópia local**, não a do servidor. Enquanto o aviso não existir
  (BACKLOG-17), a tela pode exibir um mesociclo que o servidor ainda não recebeu — e não avisa.
- **Mesociclo grande rola tudo** (BACKLOG-18): o teto de 64 KB é exceção, e o tamanho aparece no
  subtítulo.
- **A tela não edita.** Escrever é pelo formulário e pelo import; uma caixa de texto livre seria um
  caminho de escrita sem validação.
- **Só o mesociclo é visualizável.** Quem quiser inspecionar rotinas/semana/histórico usa o backup em
  Settings ou o `GET /api/data`; não há tela para isso, por decisão do usuário.

## Histórico das revisões

Revisão 1 (subagente, v1): **19 achados**. Como cada um terminou:

| # | Assunto | Resolução |
|---|---|---|
| F1–F4, F6, F7, F18 | O aviso de "não enviado" (`useSyncExternalStore` sem import, `storage` que não dispara na própria aba, `gym_dirty` que só liga na falha, `pushTm` inacessível, tradução e mock) | **Backlog** (BACKLOG-17) por decisão do usuário; a spec perdeu o bloco pendente e ganhou a seção "Adiado" |
| F5 | Teste manual que passava por acaso | Removido; o instrumento correto (offline **antes** da edição) ficou descrito no BACKLOG-17 |
| F8 | Docs ainda descrevendo os escopos retirados | Entrou no escopo: `docs/MESO.md` e a nota de superação em `spec_meso_no_app.md` |
| F9 | Critério não reprovável ("igual ao export") | Passou a comparar com o que está persistido no aparelho |
| F10 | Sem teste para a tela; `npm test` na raiz não roda | `pickMeso` virou função pura testada; critério diz `cd frontend && npm test` |
| F11 | Rótulo do voltar mencionando "Plano" | Mantido (descreve o destino, como no resto do app) e o critério deixou de exigir isso |
| F12 | Plan Tools sem seção quando não há ativo | Usa `pickMeso`: sem ativo, o primeiro da biblioteca |
| F13 | Chaves de tradução mortas | Removidas (zero usos conferido) |
| F14 | A6 não verificável | Cita `views/Settings.jsx:179` |
| F15 | `share` duplicando o download | Passou a chamar `exportMeso` |
| F16 | Justificativa do botão pelo nome do arquivo | Reescrita: o arquivo vale pelo **conteúdo**; o import detecta por conteúdo |
| F17 | 64 KB sem regra | **Backlog** (BACKLOG-18); a spec registra o comportamento atual |
| F19 | Formato do número e plural | `fmtNum` (vírgula em PT) + chave `{0} line` |
