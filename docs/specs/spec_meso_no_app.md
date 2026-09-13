# Spec: Mesociclo no app (biblioteca, tela, criação manual, import/export e rotas do assistente) — v2

> **v2 (13/09/2026):** incorpora as respostas do usuário (U6, U7, U8) e os 30 achados da primeira
> revisão por subagente.
>
> **v3 (13/09/2026):** incorpora U9 (a API é overwrite total), a diretriz do usuário de que **esta
> spec é do app** e os 27 achados da segunda revisão. Mudanças de contrato: `checkState` fica
> tolerante (só teto e forma mínima) enquanto a rota do assistente valida a tabela do §6, o cliente
> ganha a mesma régua para nunca escrever o que a API recusaria, o Dockerfile segue a
> `spec_publicacao_micro.md` (alvo `test` com `RUN`), e a mescla da biblioteca perdeu o desempate por
> relógio.
>
> **Diretriz permanente do usuário (13/09/2026):** *"não estamos desenvolvendo o assistente aqui,
> estamos desenvolvendo app"*. Esta spec desenha **o app e a API dele**. O comportamento do
> assistente (quando publicar, o que ler antes de escrever, como perguntar ao usuário) **não** é
> desenhado aqui: a API expõe operações, registra o que aconteceu e **obedece** — sem regras,
> políticas ou proteções especiais para quem está do outro lado.

## Contexto e Objetivo

Hoje o openGym não sabe o que é um mesociclo. O planejamento de médio prazo vive só no Hermes
(`~/.hermes/workout/plans/mesociclo_ativo.json`, `meso-2026-09-02`, 4 semanas), e o app mostra apenas
as rotinas e a semana (`S.routines`, `S.week`, `S.dayPlan`). Quem treina não tem, no celular, onde ver
em que semana do bloco está, o que aquele bloco persegue, nem o que o coach registrou.

Esta entrega põe o **mesociclo dentro do app**: uma biblioteca de mesociclos com um deles ativo, a tela
completa de um mesociclo (o que o assistente escreveu e o que o usuário escreveu, na mesma tela), a
criação manual, import/export de arquivo (CSV e JSON), a visão crua em JSON e as rotas HTTP que o
assistente usa para publicar e ativar um mesociclo.

- **Repo:** `/mnt/drivebackup/apps/openGym/openGym`, branch `emerson-custom`
- **Stack:** React 19 + Vite (PWA, `frontend/`), Node 22 sem framework (`api/`), containers
  `opengym-api-1` e `opengym-web-1`, nginx em `web/nginx.conf`
- **Referência de desenho:** `DESENHO_MESO.md` (espelho local) com o objeto, a biblioteca, o fluxo de
  ativação, o protótipo da tela e o desenho do import
- **Objeto de referência lido:** `mesociclo_ativo.json` do Hermes (`meso-2026-09-02`, 8.287 bytes,
  sha256 `55e0f5aa…a2d47d`), convertido para o objeto do app

## Escopo

- **Inclui**
  - Objeto do mesociclo no estado (`S.mesos[]`, `S.activeMeso`, `S.mesoPrev`), com o esquema do §6.
  - `frontend/src/lib/meso.js` (novo) — modelo, derivações e mescla.
  - `frontend/src/lib/meso-file.js` (novo) — import/export JSON e CSV, reusando `parseCSV`.
  - `frontend/src/views/MesoEdit.jsx` (novo) — a tela do mesociclo, com o formulário de edição.
  - `frontend/src/views/PlanRaw.jsx` (novo) — a visão crua (mesociclo, plano, estado inteiro).
  - `frontend/src/views/Plan.jsx` — painel `MESOCYCLE` (enxuto: nome, semana N de M, fase).
  - `frontend/src/sheets.jsx` — lista de mesociclos, formulário de criação, resumo de import, menu de
    ações do mesociclo, export.
  - `frontend/src/store/useStore.js` — `DEF`, normalização em `loadState`, mescla nos dois caminhos de
    conflito.
  - `frontend/src/index.css` — o bloco `.rawjson` da visão crua.
  - `api/meso.js` (novo) e as rotas `PUT/GET /api/plan/meso` e `POST /api/plan/meso/:id/activate` em
    `api/server.js`, com validação do núcleo, preservação de campos desconhecidos, auditoria e
    identidade de agente. `checkState` passa a conferir `mesos`.
  - `api/Dockerfile` — alvo `test` (o mesmo que a `spec_publicacao_micro.md` §4 especifica; quem
    implementar primeiro faz, o outro encontra pronto).
  - Testes: `api/meso.test.js` (`node --test`), `frontend/src/lib/meso.test.js` e
    `frontend/src/lib/meso-file.test.js` (`vitest`).
  - `docs/MESO.md` (novo) — documento permanente do mesociclo (objeto, rotas, nomenclatura),
    simétrico ao `docs/MICRO.md` que já existe.
- **Não inclui**
  - **O botão que gera a semana** (`Gerar micro S(n)`) e todo o BACKLOG-02: geração por LLM,
    `hermes_api.py`, stepper da Fase 2, publicação das rotinas/dias. O painel do app **reserva o
    lugar** do botão; ele entra na spec seguinte. Nada nesta entrega chama o motor.
  - `Idempotency-Key` no `PUT /api/plan/meso`: a operação é um **upsert por `id`**, naturalmente
    idempotente (mesmo corpo + mesmo `id` = mesmo resultado), e o `If-Match` já cobre a base velha.
    A chave existe no `POST /api/plan/micro` porque lá cada publicação cria ids novos
    (A15).
  - Filtrar ou agrupar rotinas por mesociclo (o id `r_push_S2_af8c` não diz de que meso veio; exigiria
    carimbar o meso em cada rotina publicada, o que é do contrato do micro).
  - Editar, apagar ou reescrever histórico de treino (`workouts[]`).
  - Sincronizar `mesociclo_ativo.json` do Hermes com o app: quem publica é o assistente, por HTTP.
  - Migração dos mesociclos que já existem no Hermes: entram por arquivo (import) ou por publicação.

## Decisões do usuário (produto, 13/09/2026)

| # | Decisão | Efeito visível |
|---|---|---|
| U1 | **Painel enxuto** na aba Plan: nome, semana N de M, fase | Uma linha e meia de leitura; o resto vive na tela do mesociclo |
| U2 | Escopo inclui **as rotas que o assistente usa** para publicar | O assistente pode mandar um mesociclo quando o BACKLOG-02 chamar |
| U3 | Mesociclo vencido **continua ativo** até você ativar outro, fica **marcado "terminado"** na lista e o app **oferece o próximo** | Nada some, nada muda sozinho, e há um caminho de um toque para o próximo bloco |
| U4 | Import valida **só a forma** e **não limita** um arquivo mais rico que o nosso objeto | Campo que o app não conhece é guardado, aparece recolhido e volta no export |
| U5 | Visão crua do plano em JSON, só leitura | Você vê exatamente o que o app guarda, e copia para conversar com o coach |
| U6 | Na lista, **tocar ativa** o mesociclo e o **`>` abre a tela** | Um toque troca o bloco em uso sem sair da lista |
| U7 | **Editar pode tudo**, inclusive o que o coach registrou por semana | Você tem a última palavra no app; o assistente lê o mesociclo antes de escrever (decisão sua, fora desta spec) |
| U8 | Arquivo com vários mesociclos **importa todos**; item sem núcleo é recusado e **nomeado** no resumo | Exportar tudo e reimportar funciona; nada some sem aparecer na contagem |
| U9 | **A API é overwrite total**, sem regras para o assistente | Publicar um mesociclo substitui o daquele id, inteiro; quem coordena é o assistente lendo antes de escrever |
| U10 | Mudar a data de início **move as semanas junto** | O período continua batendo com a grade, e o que o coach escreveu em cada semana viaja com ela |

## Decisões assumidas

- **A1 — Três caminhos de escrita, todos overwrite, nenhum com regra para o assistente.** O app grava a
  biblioteca pelo caminho normal do estado (`update()` → `PUT /api/data` com `If-Match`), como já faz
  com rotinas; `PUT /api/plan/meso` substitui o mesociclo daquele `id` **inteiro** (validado, auditado);
  `POST /api/plan/meso/:id/activate` só mexe no ponteiro. Nenhuma rota decide nada em nome de quem
  chama: o que chega é gravado, o que não cabe na forma é recusado, e o registro guarda quem foi.
  `activatedBy`/`activatedAt` são **fato do registro** (assinatura de agente conferida = `"assistant"`,
  qualquer outra sessão = `"user"`), não política de convivência entre escritores — as duas rotas
  carimbam igual, e é o ponteiro que as distingue.
- **A18 — O cliente aplica a mesma régua da API.** `normalizeMeso` corta o que passa dos limites e
  **anota o corte**, deriva o que falta e recusa o que não tem núcleo, de modo que o app **nunca**
  grave no estado um mesociclo que a API recusaria (um `400` no `PUT /api/data` deixaria a escrita
  pendente para sempre, e isso vale para treino, rotina e peso, não só para o mesociclo).
  `checkState` (a régua do `PUT /api/data`) continua **tolerante como o resto dele**: confere os tetos
  (A7) e a forma mínima (objeto com `id` e `weeks[]`), nunca a tabela inteira do §6 — quem valida a
  tabela é a rota do assistente, onde a recusa é uma resposta e não um estado preso.
- **A2 — Quem ativou vem da assinatura, nunca de um campo declarado no corpo.** O app não tem como
  carimbar "fui o assistente".
- **A3 — A visão crua é uma rota** (`/plan/raw`), não uma folha: JSON longo precisa de tela inteira e
  de rolagem própria. O escopo vem na query (`?scope=meso|plan|all&id=`).
- **A4 — Uma serialização só.** `mesoToJSON()` é usada pela visão crua, pelo export e pelo "copiar".
- **A5 — Semanas com `start`/`end` próprios.** No mesociclo real as semanas não têm 7 dias: a S1 vai de
  `2026-09-02` a `2026-09-07` (6 dias, porque o meso começou numa quarta) e a S4 vai de `2026-09-22` a
  `2026-09-30` (9 dias, para fechar o mês). Quando os campos não vêm, são derivados; quando vêm, são
  respeitados.
- **A6 — `weeks[]` é obrigatório no corpo da API** (1..52, `n` de 1 a N em ordem crescente). O
  **cliente** deriva as semanas quando o arquivo traz só `end` (ou uma linha de CSV sem coluna de
  semana): quem conhece a regra de derivação é o app, e o que atravessa a fronteira é o objeto já
  resolvido. Sem `weeks[]` e sem como derivar, o arquivo é recusado — e um mesociclo sem nenhuma
  semana nunca é gravado (A18).
- **A7 — Teto de tamanho:** 64 KB por mesociclo e 40 mesociclos. Vale nos **dois** caminhos: a rota do
  assistente recusa com `400 MESO_TOO_BIG` / `409 TOO_MANY_MESOS`, e o `checkState` do `PUT /api/data`
  recusa com `400` (senão o app seria a porta larga). O import confere os mesmos dois tetos no resumo
  e recusa o arquivo acima de 2 MB antes de ler.
- **A8 — `id` no formato `meso-AAAA-MM-DD`**, gerado da data de início. O import **pergunta antes de
  substituir** um id que já existe; nunca se gera id fora do formato.
- **A9 — Fase da semana é texto livre curto** (≤ 80 caracteres, o mesmo teto da API; o dado real tem
  41), com padrão na criação: primeira semana `calibração`, última `deload`, as do meio `progressão`.
- **A10 — `rules` é mapa rotulado** (`{ "Reps alvo": "6-8" }`), com a ordem preservada; a tela mostra as
  três primeiras e "ver todas". No CSV o par é `Rótulo=Texto` separado por `|` (A16).
- **A11 — Bump de versão:** `api/package.json` e `frontend/package.json` de `1.2.4` para `1.3.0`, com
  entrada no `CHANGELOG.md`.
- **A12 — `docs/MESO.md` é o documento permanente** (objeto, rotas, nomenclatura), no molde do
  `docs/MICRO.md`.
- **A13 — "Hoje" é do fuso `America/Sao_Paulo`, explícito.** `todayISO()` (de `lib/format.js`) usa o
  fuso do aparelho, e o app é usado em viagem: o novo `todayInMeso()` (em `lib/meso.js`, com
  `Intl.DateTimeFormat(..., { timeZone: 'America/Sao_Paulo' })`) é o que decide "semana atual",
  "terminado" e "futuro". O resto do app segue com o fuso do aparelho — mudar isso é outro assunto.
- **A14 — Nada é cortado em silêncio.** O import corta o que passa dos limites (nome, fase, rótulo e
  valor de regra) **e anota o corte no resumo**; a API **recusa** com `400` em vez de cortar. Assim o
  arquivo do usuário nunca é reescrito pelas costas, e a rota do assistente nunca aceita lixo grande.
- **A15 — Sem `Idempotency-Key` na rota do mesociclo** (ver "Não inclui"): upsert por `id` é
  idempotente por construção.
- **A16 — CSV é um subconjunto declarado.** Ele carrega o núcleo, as semanas (fase, planejado,
  registrado), objetivo, focos, evidência e regras — e **não** carrega `log[]`, `activatedBy/At`,
  `updatedAt` nem campos desconhecidos do mesociclo (extras de semana viajam como colunas). O resumo do
  import diz isso quando o arquivo é CSV; para round-trip fiel, JSON.
- **A17 — Um helper de ativação só.** `activateMesoState(S, id, by)` (em `lib/meso.js`) é usado pelo
  painel, pela lista, pela tela, pelo import e pelo "voltar ao anterior": um lugar decide o que é
  `mesoPrev`, `activeMeso`, `activatedBy` e `activatedAt`.
- Decididas por mim por serem detalhe de implementação e não mudarem o que o usuário vê.

## Requisitos Funcionais

- **RF-1. Biblioteca com um ativo.** `S.mesos[]` (lista, só cresce) e `S.activeMeso` (id em uso).
  Nenhum mesociclo é apagado por troca de ativo; `S.mesoPrev` guarda o id anterior para o desfazer.
- **RF-2. Tela do mesociclo com todo o conteúdo.** `/plan/meso/:id` mostra, na ordem: cabeçalho com
  nome e procedência; cartão com estado (ativo/inativo), período, trilha `S1..S4` e a fase da semana
  escolhida; bloco da semana (`Planned` / `Logged`); objetivo; prioridades; regras (três + ver todas);
  evidência recolhida; histórico do coach recolhido; extras recolhidos. **Seção sem dado não
  renderiza** — é o que faz o mesociclo do usuário (2 seções) e o do assistente (8 seções) caberem na
  mesma tela sem parecer que falta coisa.
- **RF-3. Estados derivados, nunca gravados.** `semana atual` (a que cobre hoje), `terminado`
  (`end` < hoje), `futuro` (`start` > hoje), `✓` da semana que tem `log` e `●` da semana atual saem das
  datas e do próprio objeto, sempre com `todayInMeso()` (A13).
- **RF-4. Ativação pelo usuário.** Na lista, **tocar a linha ativa** e o **`>` abre a tela** (U6). Na
  tela, o rodapé ativa quando o mesociclo não é o ativo. Os dois caminhos chamam
  `activateMesoState(S, id, 'user')` (A17) e mostram os dois avisos: qual mesociclo passou a valer e que
  **a semana publicada não muda** até a próxima publicação.
- **RF-5. Ativação pelo assistente.** `PUT /api/plan/meso` com `activate: "now"` ativa na mesma escrita
  (grava `S.mesoPrev` e carimba `activatedBy: "assistant"` a partir da assinatura verificada). O app não
  pergunta nada: o **painel** mostra a faixa "Ativado pelo assistente · voltar ao anterior", e o
  desfazer é a ativação do `S.mesoPrev` pelo helper local (o app escreve o estado dele, como em A1).
- **RF-6. Mesociclo vencido.** Continua ativo, aparece na lista e no painel marcado `terminado`, e o
  painel oferece o próximo (`Começar o próximo`, que abre o formulário; e `Importar`, que abre o
  seletor de arquivo), sem trocar nada sozinho.
- **RF-7. Sem mesociclo ativo.** Se existe um mesociclo cujas datas cobrem hoje, o painel o oferece
  ("`{nome}` cobre hoje · Ativar"); se não existe nenhum, mostra `Nenhum mesociclo ainda` com as duas
  portas (`Criar`, `Importar`).
- **RF-8. Criação manual.** Formulário de quatro campos obrigatórios (nome, começa em, semanas 4/6/8,
  objetivo) e três opcionais (foco lower, foco upper, reps alvo). Derivados: `id`, `end`, `weeks[]` com
  as fases padrão e `origin: "user"`.
- **RF-9. Import de arquivo (CSV ou JSON).** Valida só o núcleo (§6), deriva o que falta, **preserva
  campos desconhecidos em qualquer nível**, **importa todos os mesociclos do arquivo** (U8) e mostra um
  resumo antes de gravar: quantos mesociclos, semanas, regras, extras preservados, o que foi derivado,
  o que foi cortado e **quais ids já existem** (com `Substituir` no lugar de `Importar`). Os mesociclos
  entram **inativos**; o resumo oferece ativar.
- **RF-10. Export.** JSON (round-trip fiel, extras incluídos) e CSV (o subconjunto de A16), pelo menu de
  ações do mesociclo — que funciona para o ativo e para qualquer mesociclo da lista. O export usa a
  mesma serialização da visão crua (A4).
- **RF-11. Visão crua.** `/plan/raw?scope=meso|plan|all` mostra o JSON indentado, só leitura, com
  cabeçalho (nome, tamanho em KB, número de linhas e, no escopo `plan`, o `rev` e o `_ts`), `Copiar` e
  `Compartilhar .json`. `meso` = o objeto do mesociclo (`?id=`; id desconhecido mostra "não está neste
  perfil", nunca o estado inteiro); `plan` = `{mesos, activeMeso, routines, week, dayPlan, customEx}`;
  `all` = o estado inteiro, `workouts` incluído. Escopo inválido cai em `plan`.
- **RF-12. Rotas do assistente.**
  - `PUT /api/plan/meso` — upsert por `id`. Corpo `{ meso, activate?: "none" | "now" }`. Exige sessão;
    a assinatura do agente é verificada quando presente. Ordem canônica das checagens: sessão → corpo →
    **`If-Match`** → validação de forma → teto de tamanho → gravação (o `If-Match` vem antes da forma,
    como no `PATCH` de rotina, senão um corpo inválido sem token responde `400` em vez de `428`).
    `201` na criação, `200` na substituição, `meta: { mesoId, created, activated, activate }`.
  - `GET /api/plan/meso` — `{ mesos, activeMeso, mesoPrev, rev, _ts }` (para o `dump` do escritor).
  - `POST /api/plan/meso/:id/activate` — ativa; `409 MESO_NOT_FOUND` se o id não existe.
- **RF-13. Preservação de campo desconhecido.** A API grava o objeto como veio: valida o núcleo e o
  teto de tamanho e **não filtra** chaves que não conhece, em nenhum nível (nem dentro de `weeks[]`).
  Importar um arquivo rico, publicar pelo assistente e exportar devolve o mesmo conteúdo.
- **RF-14. Auditoria e log.** Toda escrita entra no `audit.jsonl` (`action: put-meso` / `activate-meso`,
  com `uid`, `mesoId`, `created`, `activated`, `actor`, `verified`, `rev` antes/depois) e `api/meso.js`
  imprime a linha própria `[og-meso] op=… uid=… meso=… rev=…->…` (o `withState` continua imprimindo a
  dele com o prefixo `[og-routine]`; as duas convivem).

## 6. O objeto do mesociclo

```json
{
  "id": "meso-2026-09-15",
  "name": "Mesociclo 3 · Low Volume",
  "start": "2026-09-15",
  "end": "2026-10-12",
  "goal": "uma linha",
  "origin": "user",
  "priorities": { "lower": "glúteos", "upper": "deltoide lateral" },
  "rules": { "Reps alvo": "6-8", "Intensidade": "falha só em máquina guiada" },
  "weeks": [
    { "n": 1, "start": "2026-09-15", "end": "2026-09-21", "phase": "calibração", "log": "o que aconteceu" },
    { "n": 2, "start": "2026-09-22", "end": "2026-09-28", "phase": "progressão", "plan": "o planejado" },
    { "n": 3, "start": "2026-09-29", "end": "2026-10-05", "phase": "progressão", "plan": "…" },
    { "n": 4, "start": "2026-10-06", "end": "2026-10-12", "phase": "deload", "plan": "…" }
  ],
  "evidence": "por que este mesociclo existe",
  "log": [ { "date": "2026-09-10", "text": "…" } ],
  "activatedBy": "assistant",
  "activatedAt": "2026-09-13T16:00:00Z",
  "updatedAt": "2026-09-13T16:00:00Z"
}
```

| Campo | Obrigatório | Regra (cliente **e** API conferem; a API recusa, o import anota) |
|---|---|---|
| `id` | sim | `^meso-\d{4}-\d{2}-\d{2}$`; derivado de `start` quando ausente (o import anota) |
| `name` | sim | 1..120 caracteres, sem sobra de espaço |
| `start` | sim | ISO `AAAA-MM-DD`, data real do calendário |
| `end` | derivado | data real e ≥ `start`; derivado da última semana quando ausente (anotado) |
| `weeks[]` | sim (corpo) | 1..52; `n` inteiro **sequencial** de 1 a N; em ordem crescente de data; `start` ≤ `end` em cada semana; `start` da primeira ≥ `start` do mesociclo; `end` da última ≤ `end` do mesociclo |
| `phase` | não | ≤ 80 caracteres (o dado real tem 41: `progressão leve (+2,5% só se fechar tudo)`) |
| `goal` | não | ≤ 400 caracteres |
| `origin` | não | `"user"` \| `"assistant"` (padrão `"user"`) |
| `priorities` | não | `{ lower?, upper? }`, texto livre |
| `rules` | não | ≤ 40 pares; rótulo ≤ 40 e valor ≤ 600 caracteres |
| `evidence` | não | texto livre |
| `log[]` | não | ≤ 200 itens `{ date, text }` |
| `activatedBy` / `activatedAt` | não | escritos na ativação (A1), nunca pelo corpo publicado |
| **extras** | não | qualquer chave desconhecida, em qualquer nível, preservada como veio |

## Detalhe de Implementação (nível código)

### 1. `frontend/src/lib/meso.js` (novo)

Funções puras, sem React e sem DOM (rodam no `vitest` como o `plan-merge.js`). O bloco de constantes
vem **no topo do arquivo de verdade** (a ordem dos trechos aqui é de leitura, não de arquivo).

```js
// frontend/src/lib/meso.js — modelo do mesociclo (puro, testável sem DOM).
//
// O objeto guarda só o que o cálculo não sabe: "semana atual", "terminado" e "quantas semanas
// faltam" saem das datas. Campo que o app não conhece não é descartado — fica no objeto,
// aparece recolhido na tela e volta no export (U4).
//
// As funções que normalizam recebem um array `notes` opcional e ANOTAM o que derivaram ou
// cortaram (A14). Nada é reescrito em silêncio: o resumo do import mostra a lista.

export const MESO_KNOWN = new Set([
  'id', 'name', 'start', 'end', 'goal', 'origin', 'priorities', 'rules',
  'weeks', 'evidence', 'log', 'activatedBy', 'activatedAt', 'updatedAt'
])

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86400000
export const isISO = s => typeof s === 'string' && ISO.test(s)
const at = iso => new Date(iso + 'T12:00:00Z')
export const addDays = (iso, n) => new Date(at(iso).getTime() + n * DAY).toISOString().slice(0, 10)

/** Quantos dias a janela `start..end` cobre (inclusive). */
export const spanDays = (a, b) => Math.round((at(b) - at(a)) / DAY) + 1

/**
 * "Hoje" com fuso fixo (A13). O app é usado em viagem e o mesociclo é planejado em
 * America/Sao_Paulo: se a semana atual dependesse do fuso do aparelho, o mesmo dia mostraria
 * semanas diferentes em aparelhos diferentes.
 */
export function todayInMeso(tz = 'America/Sao_Paulo') {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    return p.format(new Date())                        // en-CA já sai AAAA-MM-DD
  } catch { return new Date().toISOString().slice(0, 10) }
}
```

```js
/** Fase padrão por posição: primeira calibração, última deload, o resto progressão (A9). */
export const phaseFor = (n, total) => n === 1 ? 'calibração' : n === total ? 'deload' : 'progressão'

/** Semanas de 7 dias a partir de `start` — o caminho de derivação (A6). */
export function buildWeeks(start, count) {
  const out = []
  for (let n = 1; n <= count; n++) {
    const s = addDays(start, (n - 1) * 7)
    out.push({ n, start: s, end: addDays(s, 6), phase: phaseFor(n, count) })
  }
  return out
}

/**
 * Semanas a partir de start..end quando o arquivo não traz nenhuma. Divide em semanas de 7 dias e a
 * última absorve a sobra (9 dias viram 7 + 2). Uma semana de 9 dias inteira só existe quando o
 * arquivo a declara — é o caso da S4 do mesociclo real (A5).
 */
export function weeksFromRange(start, end) {
  const days = spanDays(start, end)
  if (!(isISO(start) && isISO(end)) || !(days >= 1) || days > 366) return []
  const count = Math.max(1, Math.min(52, Math.ceil(days / 7)))
  const out = buildWeeks(start, count)
  out[out.length - 1].end = end
  return out
}

/** Desloca todas as semanas por `delta` dias, preservando fase, planejado, registrado e extras. */
export function shiftWeeks(weeks, delta) {
  return (weeks || []).map(w => ({
    ...w,
    ...(isISO(w.start) ? { start: addDays(w.start, delta) } : {}),
    ...(isISO(w.end) ? { end: addDays(w.end, delta) } : {})
  }))
}

/** Semanas com start/end resolvidos: o que veio manda, o que falta é derivado (A5). */
export function resolveWeeks(meso) {
  const list = Array.isArray(meso.weeks) ? meso.weeks : []
  const total = list.length || 1
  return list.map((w, i) => {
    const n = Number.isInteger(w.n) ? w.n : i + 1
    const start = isISO(w.start) ? w.start : addDays(meso.start, (n - 1) * 7)
    const end = isISO(w.end) ? w.end : addDays(start, 6)
    return { ...w, n, start, end, phase: String(w.phase || phaseFor(n, total)).slice(0, LIMITS.phase) }
  }).sort((a, b) => a.n - b.n)
}

/** Data ISO que existe no calendário (`2026-02-30` não é). */
export function realISO(s) {
  if (!isISO(s)) return false
  const d = new Date(s + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Teto de cada campo do §6, num lugar só — o cliente corta e anota, a API recusa (A14/A18). */
export const LIMITS = {
  name: 120, phase: 80, goal: 400, rules: 40, ruleKey: 40, ruleValue: 600, log: 200, weeks: 52,
  meso: 64 * 1024,      // A7: bytes por mesociclo (bytes, não caracteres)
  library: 40           // A7: mesociclos na biblioteca
}
/** Bytes do objeto como ele vai para o estado (mesma conta da API, `Buffer.byteLength`). */
export const mesoBytes = m => new TextEncoder().encode(JSON.stringify(m)).length

/**
 * Normaliza o que veio de fora (arquivo, servidor, form) e devolve null quando não há núcleo
 * aproveitável. Corta o que passa dos limites **anotando cada corte** e deriva o que falta
 * (A14/A18): o resultado é sempre um objeto que a API aceita, para nunca deixar o `PUT /api/data`
 * preso num 400 que trava treino, rotina e peso junto.
 */
export function normalizeMeso(raw, notes = []) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!realISO(raw.start)) return null
  const start = raw.start
  const name = String(raw.name || '').trim()
  if (!name) return null
  if (name.length > LIMITS.name) notes.push({ kind: 'cut', field: 'name', to: LIMITS.name })
  if (raw.goal != null && String(raw.goal).length > LIMITS.goal) notes.push({ kind: 'cut', field: 'goal', to: LIMITS.goal })

  // Semanas: resolve as que vieram, deriva do intervalo quando não veio nenhuma, descarta as
  // incoerentes, renumera 1..N e respeita o teto de 52.
  let weeks = resolveWeeks({ ...raw, start }).filter(w => realISO(w.start) && realISO(w.end) && w.end >= w.start)
  if (!weeks.length) {
    if (!realISO(raw.end) || raw.end < start) return null
    weeks = weeksFromRange(start, raw.end)
    notes.push({ kind: 'derived', field: 'weeks', from: 'start..end', count: weeks.length })
  }
  if (weeks.length > LIMITS.weeks) {
    weeks = weeks.slice(0, LIMITS.weeks)
    notes.push({ kind: 'cut', field: 'weeks', to: LIMITS.weeks })
  }
  weeks = weeks.map((w, i) => ({ ...w, n: i + 1 }))
  for (const w of weeks) {
    if (String(w.phase).length > LIMITS.phase) { w.phase = String(w.phase).slice(0, LIMITS.phase); notes.push({ kind: 'cut', field: 'phase', week: w.n, to: LIMITS.phase }) }
  }
  if (!weeks.length) return null                                   // sem semana não há mesociclo (A6)

  const id = /^meso-\d{4}-\d{2}-\d{2}$/.test(raw.id) ? raw.id : 'meso-' + start
  if (id !== raw.id) notes.push({ kind: 'derived', field: 'id', from: 'start', value: id })
  const end = realISO(raw.end) && raw.end >= start ? raw.end : weeks[weeks.length - 1].end
  if (end !== raw.end) notes.push({ kind: 'derived', field: 'end', from: 'weeks', value: end })

  const out = {
    ...raw,                                   // extras primeiro: nada é descartado (U4)
    id, name: name.slice(0, LIMITS.name), start, end,
    origin: raw.origin === 'assistant' ? 'assistant' : 'user',
    weeks
  }
  if (out.goal != null) out.goal = String(out.goal).slice(0, LIMITS.goal)
  if (out.rules && typeof out.rules === 'object' && !Array.isArray(out.rules)) {
    const pairs = Object.entries(out.rules)
    if (pairs.length > LIMITS.rules) notes.push({ kind: 'cut', field: 'rules', to: LIMITS.rules })
    out.rules = Object.fromEntries(pairs.slice(0, LIMITS.rules).map(([k, v]) => {
      const key = String(k).trim().slice(0, LIMITS.ruleKey)
      const val = String(v)
      if (String(k).trim().length > LIMITS.ruleKey || val.length > LIMITS.ruleValue) notes.push({ kind: 'cut', field: 'rules', label: key })
      return [key, val.slice(0, LIMITS.ruleValue)]
    }))
  } else if (out.rules != null) delete out.rules
  if (Array.isArray(out.log) && out.log.length > LIMITS.log) {
    out.log = out.log.slice(0, LIMITS.log)
    notes.push({ kind: 'cut', field: 'log', to: LIMITS.log })
  } else if (out.log != null && !Array.isArray(out.log)) delete out.log
  return out
}

/** Chaves que o app não conhece — o que a tela mostra em EXTRAS e o export devolve. */
export const extrasOf = o => Object.entries(o || {}).filter(([k]) => !MESO_KNOWN.has(k) && !k.startsWith('_'))

/** A semana que cobre a data (inclusive nas bordas), ou null. */
export const weekAt = (meso, iso) => resolveWeeks(meso).find(w => iso >= w.start && iso <= w.end) || null

/** 'future' | 'current' | 'ended' — derivado, nunca gravado (RF-3). */
export function mesoState(meso, today = todayInMeso()) {
  if (!meso) return null
  if (today < meso.start) return 'future'
  return today > meso.end ? 'ended' : 'current'
}

/**
 * Ativação, num lugar só (A17). Usada pelo painel, pela lista, pela tela, pelo import e pelo
 * "voltar ao anterior": `by` é 'user' ou 'assistant' e vale pelo fato verificado, nunca por um
 * campo que o corpo declarou (A2).
 */
export function activateMesoState(S, id, by = 'user') {
  const m = (S.mesos || []).find(x => x.id === id)
  if (!m) return false
  if (S.activeMeso === id) return false
  S.mesoPrev = S.activeMeso || null
  S.activeMeso = id
  m.activatedBy = by
  m.activatedAt = new Date().toISOString()
  return true
}

/**
 * Mescla da biblioteca nos dois caminhos de conflito do store: o servidor manda nos ids que ele
 * tem, o que só existe neste aparelho é preservado. Sem livro-caixa e sem desempate por relógio
 * (U9: a API é overwrite total, e quem coordena é o assistente, lendo antes de escrever — não o
 * app, protegendo-se dele). O preço está em Riscos: um mesociclo editado aqui e também no servidor
 * volta para a versão do servidor na próxima mescla.
 */
export function mergeMesos(srv, local) {
  const out = new Map((srv || []).map(m => [m.id, m]))
  for (const m of local || []) if (!out.has(m.id)) out.set(m.id, m)
  return [...out.values()]
}

/** Ponteiro de ativo coerente com a lista: id que não existe na biblioteca vira null (F16). */
export function fixMesoPointers(S) {
  const ids = new Set((S.mesos || []).map(m => m.id))
  if (S.activeMeso && !ids.has(S.activeMeso)) S.activeMeso = null
  if (S.mesoPrev && !ids.has(S.mesoPrev)) S.mesoPrev = null
  return S
}
```

### 2. `frontend/src/lib/meso-file.js` (novo)

Import/export. Reusa o `parseCSV` de `lib/import-csv.js` (BOM, aspas, vírgula dentro do campo, CRLF) e
acrescenta a detecção de `;` — o separador que o Excel em PT-BR escreve.

```js
// frontend/src/lib/meso-file.js — arquivo de mesociclo: import (JSON/CSV) e export.
//
// O import valida FORMA, nunca conteúdo, e devolve sempre a mesma forma:
//   { mesos, notes, errors }
// `notes` é o que o resumo mostra (derivado, cortado, extras preservados, CSV é subconjunto);
// `errors` são recusas de forma, uma por arquivo ou por item.
import { parseCSV } from './import-csv.js'
import { normalizeMeso, buildWeeks, weeksFromRange, isISO } from './meso.js'

export const MAX_FILE_BYTES = 2 * 1024 * 1024     // teto do arquivo (A7)

const norm = h => String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

// Cabeçalho conhecido → campo, com o rótulo primeiro (mesmo espírito do mapHeader do import-csv).
const COLS = [
  ['id', ['id', 'meso id']], ['name', ['name', 'nome', 'mesociclo']],
  ['start', ['start', 'inicio', 'comeca em', 'data inicio']], ['end', ['end', 'fim', 'termino']],
  ['goal', ['goal', 'objetivo']], ['origin', ['origin', 'origem']],
  ['priority_lower', ['priority lower', 'foco lower', 'prioridade lower']],
  ['priority_upper', ['priority upper', 'foco upper', 'prioridade upper']],
  ['evidence', ['evidence', 'evidencia', 'base evidencia']],
  ['week', ['week', 'semana', 'n']], ['phase', ['phase', 'fase']],
  ['week_start', ['week start', 'semana inicio', 'inicio da semana']],
  ['week_end', ['week end', 'semana fim', 'fim da semana']],
  ['plan', ['plan', 'planejado', 'planejamento']], ['log', ['log', 'registrado', 'registro']],
  ['rules', ['rules', 'regras']]
]

/**
 * `Rótulo=Texto` por linha dentro da célula → mapa, na ordem.
 * O separador canônico é a **quebra de linha dentro da célula** (o `parseCSV` já lê campo entre
 * aspas com `\n` dentro), e é o que o export escreve: `|` e `;` colidiam com o separador de CSV que
 * o Excel em PT-BR usa e com texto real de regra. `|` e `;` continuam aceitos na leitura, para
 * arquivo feito à mão. Não corta nada aqui: quem corta e anota é o `normalizeMeso` (A14).
 */
export function parseRules(cell) {
  const out = {}
  const src = String(cell || '')
  const sep = src.includes('\n') ? '\n' : src.includes('|') ? '|' : ';'
  for (const part of src.split(sep)) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}
```

```js
/**
 * Lê o arquivo. Detecção por conteúdo, não por extensão: `{`/`[` é JSON, o resto é CSV.
 * `filename` entra só nas notas (o resumo diz de onde veio).
 */
export function parseMesoFile(text, filename = '') {
  const notes = [], errors = [], mesos = [], refused = []
  const body = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!body) return { mesos, notes, errors: ['empty'], refused }
  let raw = []
  if (body[0] === '{' || body[0] === '[') {
    let data
    try { data = JSON.parse(body) } catch { return { mesos, notes, errors: ['json'], refused } }
    raw = Array.isArray(data) ? data : Array.isArray(data.mesos) ? data.mesos : [data]
  } else {
    raw = mesoFromCSV(body, notes, errors)
    if (!errors.length) notes.push({ kind: 'format', format: 'csv', loses: ['log', 'extras'] })
  }
  raw.forEach((r, i) => {
    const before = notes.length
    const m = normalizeMeso(r, notes)
    // Recusado não polui as notas dos que entraram, mas fica NOMEADO no resumo (U8/F9).
    if (!m) { notes.length = before; refused.push({ index: i + 1, name: (r && r.name) || null }); return }
    mesos.push(m)
  })
  if (refused.length) errors.push('refused')
  return { mesos, notes, errors, refused, filename }
}

/** Nota do parser → texto do resumo (o resumo não tem lógica própria). */
export function noteText(note, t) {
  if (note.kind === 'derived') return t('{0} derived from {1}', note.field, note.from)
  if (note.kind === 'cut') return t('{0} was trimmed to {1}', note.field + (note.week ? ' (week ' + note.week + ')' : ''), note.to)
  if (note.kind === 'extras') return t('{0} extra fields kept: {1}', note.fields.length, note.fields.join(', '))
  if (note.kind === 'format') return t('CSV carries no coach log and no extra fields')
  return ''
}
```

CSV: uma linha por semana, campos do mesociclo lidos da **primeira linha** e valendo para todas;
coluna desconhecida vira extra **da semana daquela linha** (o nível mais específico, não perde nada).
Um arquivo com só o cabeçalho e **uma linha** (ou nenhuma) vira mesociclo magro com as semanas
derivadas de `start`/`end` (A6).

```js
function mesoFromCSV(text, notes, errors) {
  // `;` como separador quando a primeira linha tem mais ponto-e-vírgula do que vírgula. A troca
  // respeita aspas: `;` dentro de campo entre aspas não é separador (o lookahead conta as aspas
  // que faltam até o fim da linha).
  const first = text.split(/\r?\n/, 1)[0] || ''
  const src = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length
    ? text.replace(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ',') : text
  const rows = parseCSV(src)
  if (!rows.length) { errors.push('csv'); return [] }
  const head = rows[0].map(norm)
  const idx = {}, unknown = []
  head.forEach((h, i) => {
    const hit = COLS.find(([, names]) => names.includes(h))
    if (hit) { if (idx[hit[0]] === undefined) idx[hit[0]] = i } else if (h) unknown.push([h, i])
  })
  if (idx.name === undefined || idx.start === undefined) { errors.push('no-core'); return [] }
  const data = rows.slice(1)
  const firstCell = k => (idx[k] === undefined || !data.length ? '' : String(data[0][idx[k]] ?? '').trim())
  // "Meso magro": nenhuma linha de semana de verdade. Uma linha só com nome/objetivo é o caso
  // comum de planilha — as semanas saem de start..end (ou do padrão de 4), não daquela linha (F6).
  const hasWeekCols = ['week', 'phase', 'plan', 'log', 'week_start', 'week_end'].some(k => idx[k] !== undefined)
  const bare = !data.length || (data.length === 1 && !hasWeekCols)
  const meso = {
    name: firstCell('name'), start: firstCell('start'), goal: firstCell('goal'),
    origin: firstCell('origin') || 'user',
    weeks: bare ? [] : data.map((r, i) => {
      const cell = k => (idx[k] === undefined ? '' : String(r[idx[k]] ?? '').trim())
      const w = { n: Number(cell('week')) || i + 1 }
      if (cell('phase')) w.phase = cell('phase')
      if (cell('week_start')) w.start = cell('week_start')       // semana de 6 ou 9 dias sobrevive (A5)
      if (cell('week_end')) w.end = cell('week_end')
      if (cell('plan')) w.plan = cell('plan')
      if (cell('log')) w.log = cell('log')
      for (const [k, i2] of unknown) {                 // coluna desconhecida → extra DA SEMANA
        const v = String(r[i2] ?? '').trim()
        if (v) w[k] = v
      }
      return w
    })
  }
  for (const k of ['id', 'end']) if (firstCell(k)) meso[k] = firstCell(k)
  const pl = firstCell('priority_lower'), pu = firstCell('priority_upper')
  if (pl || pu) meso.priorities = { ...(pl ? { lower: pl } : {}), ...(pu ? { upper: pu } : {}) }
  const rules = parseRules(firstCell('rules'))
  if (Object.keys(rules).length) meso.rules = rules
  if (firstCell('evidence')) meso.evidence = firstCell('evidence')
  if (unknown.length) notes.push({ kind: 'extras', where: 'weeks', fields: unknown.map(([k]) => k) })
  if (bare) {                                          // CSV de uma linha: mesociclo magro
    const end = meso.end && meso.end >= meso.start ? meso.end : null
    meso.weeks = end ? weeksFromRange(meso.start, end) : buildWeeks(meso.start, 4)
    notes.push({ kind: 'derived', field: 'weeks', from: end ? 'start..end' : 'default', count: meso.weeks.length })
  }
  return [meso]
}
```

```js
/** Serialização única (A4): a visão crua, o export JSON e o "copiar" usam esta função. */
export const mesoToJSON = meso => JSON.stringify(meso, null, 2)

/**
 * CSV declaradamente parcial (A16): leva o núcleo, as semanas, objetivo, focos, evidência e
 * regras. NÃO leva `log[]`, `activatedBy/At`, `updatedAt` nem os extras do mesociclo — quem
 * precisa de round-trip fiel usa JSON, e o resumo do import diz isso quando o arquivo é CSV.
 */
export function mesoToCSV(meso) {
  const cols = ['id', 'name', 'start', 'end', 'goal', 'origin', 'priority_lower', 'priority_upper',
    'evidence', 'rules', 'week', 'week_start', 'week_end', 'phase', 'plan', 'log']
  // Uma regra por linha DENTRO da célula (entre aspas): `|` e `;` quebravam com texto real (F23).
  const rules = Object.entries(meso.rules || {}).map(([k, v]) => `${k}=${v}`).join('\n')
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const body = (meso.weeks || []).map((w, i) => [
    i === 0 ? meso.id : '', i === 0 ? meso.name : '', i === 0 ? meso.start : '', i === 0 ? meso.end : '',
    i === 0 ? (meso.goal || '') : '', i === 0 ? (meso.origin || '') : '',
    i === 0 ? (meso.priorities?.lower || '') : '', i === 0 ? (meso.priorities?.upper || '') : '',
    i === 0 ? (meso.evidence || '') : '', i === 0 ? rules : '',
    w.n, w.start || '', w.end || '', w.phase || '', w.plan || '', w.log || ''
  ].map(q).join(','))
  return [cols.join(','), ...body].join('\n') + '\n'
}

export const mesoFileName = (meso, ext) => `${meso.id}.${ext}`
```

### 3. `frontend/src/store/useStore.js`

**3.1 `DEF` (linhas 12-19) — acrescentar os três campos:**

```js
// DEPOIS
export const DEF = {
  unit: 'kg', restSec: 90, globalRestSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  confirmTopWeight: false,
  reminder: { on: false, time: '08:00', tz: null }, effort: null,
  mesos: [], activeMeso: null, mesoPrev: null
}
```

O diff é **uma linha**: a última. Todo o resto do `DEF` fica byte a byte igual (inclusive
`exWeights: {}`, que é mapa, e `bodyweight: []`, que é lista).

**3.2 `loadState()` (linha 61, antes do `pinUnits`) — normalização única:**

```js
// ANTES
      pinUnits(state, localStorage, KEY)
      return state

// DEPOIS
      pinUnits(state, localStorage, KEY)
      // Mesociclos: normaliza UMA vez, na entrada. Objeto sem núcleo (sem nome, sem data de
      // início ou sem semana derivável) é descartado aqui — nunca na tela, nunca em silêncio no
      // import. As notas de normalização não interessam neste caminho: o arquivo já passou pelo
      // resumo do import, que é onde elas aparecem.
      state.mesos = (Array.isArray(state.mesos) ? state.mesos : []).map(m => normalizeMeso(m)).filter(Boolean)
      fixMesoPointers(state)
      return state
```

E o import no topo do arquivo:
```js
import { normalizeMeso, mergeMesos, fixMesoPointers } from '../lib/meso.js'
```

**3.3 Caminho de `409` em `pushState()` (linhas 211-220)** — o que o usuário fez no app vence:

```js
// ANTES
              const S = get().S
              const byId = new Map()
              ;(srv.workouts || []).forEach(w => byId.set(w.id, w))
              ;(S.workouts || []).forEach(w => { if (!byId.has(w.id)) byId.set(w.id, w) })
              const merged = Object.assign(clone(DEF), srv)      // routines/week/dayPlan do SERVIDOR
              merged.workouts = [...byId.values()]
              if (S.active) merged.active = S.active

// DEPOIS
              const S = get().S
              const byId = new Map()
              ;(srv.workouts || []).forEach(w => byId.set(w.id, w))
              ;(S.workouts || []).forEach(w => { if (!byId.has(w.id)) byId.set(w.id, w) })
              const merged = Object.assign(clone(DEF), srv)      // routines/week/dayPlan do SERVIDOR
              merged.workouts = [...byId.values()]
              merged.mesos = mergeMesos(srv.mesos, S.mesos)      // nada criado aqui se perde
              // Ponteiro: o do SERVIDOR manda (U9 — overwrite total, sem regra de convivência).
              // O mesociclo local que só existe aqui continua na lista, e o ponteiro para um id
              // que sumiu vira null (F16).
              fixMesoPointers(merged)
              if (S.active) merged.active = S.active
```

**3.4 Caminho de mescla em `pullState()` (linhas 264-280)** — a variável da fonte é `state`:

```js
// ANTES
          const merged = Object.assign(clone(DEF), state)
          merged.workouts = [...byId.values()]
          if (S.active) merged.active = S.active

// DEPOIS
          const merged = Object.assign(clone(DEF), state)
          merged.workouts = [...byId.values()]
          merged.mesos = mergeMesos(state.mesos, S.mesos)
          fixMesoPointers(merged)
          if (S.active) merged.active = S.active
```

No caminho limpo de `pullState()` (linhas 254-263, "nada pendente") o estado inteiro do servidor é
adotado, `mesos`/`activeMeso` inclusive — é assim que o mesociclo publicado pelo assistente chega ao
aparelho. Uma linha muda ali, para o ponteiro não ficar órfão (F16):

```js
// ANTES
          const next = Object.assign(clone(DEF), state)
          if (active) next.active = active

// DEPOIS
          const next = Object.assign(clone(DEF), state)
          next.mesos = (next.mesos || []).map(m => normalizeMeso(m)).filter(Boolean)
          fixMesoPointers(next)
          if (active) next.active = active
```

### 4. `frontend/src/views/Plan.jsx` — o painel `MESOCYCLE`

Enxuto (U1): nome, semana N de M, fase. O lugar do botão da semana fica reservado e vazio nesta
entrega (BACKLOG-02 o preenche). Os três estados de RF-5/RF-6/RF-7 estão no código abaixo.

```jsx
// DEPOIS do cabeçalho (.hdr) e ANTES do <div className="cols">
      <h4 className="sec">{t('Mesocycle')}</h4>
      <div className="list" style={{ marginBottom: 4 }}>
        {active ? <div className="item" onClick={() => nav('/plan/meso/' + active.id)}>
          <div className="grow">
            <div className="tt">{active.name}</div>
            <div className="ss">{summaryOf(active)}</div>
          </div>
          {state === 'ended' && <span className="tag">{t('ended')}</span>}
          <Icon name="chevronRight" className="chev" /></div>
        : candidate
          ? <div className="item" onClick={() => activate(candidate.id)}>
              <div className="grow">
                <div className="tt">{candidate.name}</div>
                <div className="ss">{t('covers today')} · {t('tap to activate')}</div>
              </div>
              <Icon name="chevronRight" className="chev" /></div>
          : <div className="item" onClick={mesoListSheet}>
              <div className="grow">
                <div className="tt">{t('No mesocycle yet')}</div>
                <div className="ss">{t('Create one, or import a file')}</div>
              </div>
              <Icon name="chevronRight" className="chev" /></div>}
      </div>
      {active && state === 'ended' && <div className="sect-f">
        {t('{0} ended on {1}.', active.name, fmtDate(active.end))}{' '}
        <a onClick={() => mesoFormSheet({})}>{t('Start the next one')}</a>{' · '}
        <a onClick={pickMesoFile}>{t('Import')}</a>
      </div>}
      {active && active.activatedBy === 'assistant' && S.mesoPrev && <div className="sect-f">
        <span className="tag acc">{t('Activated by the assistant')}</span>{' '}
        <a onClick={() => activate(S.mesoPrev)}>{t('Back to the previous one')}</a>
      </div>}
      {/* O botão "Gerar micro S(n)" entra aqui na spec do BACKLOG-02. O lugar é este. */}
```

No topo do componente:

```jsx
import { fmtDate } from '../lib/format.js'
import { weekAt, mesoState, todayInMeso, activateMesoState } from '../lib/meso.js'
import { mesoListSheet, mesoFormSheet, importMesoFile } from '../sheets.jsx'

  const today = todayInMeso()                                   // A13: fuso fixo
  const active = (S.mesos || []).find(m => m.id === S.activeMeso) || null
  const state = mesoState(active, today)
  const candidate = active ? null
    : (S.mesos || []).find(m => mesoState(m, today) === 'current') || null
  const activate = id => update(s => { if (activateMesoState(s, id, 'user')) {
    toast(t('{0} is now your mesocycle', (s.mesos.find(m => m.id === id) || {}).name))
    toast(t('Your published week stays as it is until the next publication.')) } })
  // O seletor de arquivo do painel é o mesmo input escondido que a folha usa, criado na hora —
  // assim o "Importar" do mesociclo vencido não precisa de outra folha.
  const pickMesoFile = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'application/json,.json,text/csv,.csv'
    inp.onchange = () => { const f = inp.files[0]; if (f) importMesoFile(f) }
    inp.click()
  }
  const wk = active ? weekAt(active, today) : null
  // "semana 2 de 4 · progressão leve" — a semana atual quando existe; fora do período, a primeira
  // (futuro) ou a última (terminado), para a linha nunca ficar vazia.
  const shown = wk || (active ? (state === 'future' ? active.weeks[0] : active.weeks[active.weeks.length - 1]) : null)
  const summaryOf = m => shown
    ? t('week {0} of {1}', shown.n, m.weeks.length) + ' · ' + shown.phase
    : t('{0} weeks', m.weeks.length)
```

### 5. `frontend/src/views/MesoEdit.jsx` (novo)

Rota `/plan/meso/:id`. Estrutura do protótipo (`DESENHO_MESO.md` §7), em blocos. Aparência exata no
protótipo HTML (`meso_screen.html`).

```jsx
export default function MesoEdit() {
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const meso = (S.mesos || []).find(m => m.id === id)
  const [sel, setSel] = useState(null)
  const [open, setOpen] = useState({ rules: false, evidence: false, log: false, extras: false })
  if (!meso) return <div className="empty">{t('That mesocycle is not in this profile.')}</div>

  const weeks = meso.weeks
  const today = todayInMeso()
  const current = weekAt(meso, today)
  const w = weeks.find(x => x.n === (sel ?? current?.n ?? 1)) || weeks[0]
  const active = S.activeMeso === meso.id
  const extras = extrasOf(meso)
  const rules = Object.entries(meso.rules || {})
  const shownRules = open.rules ? rules : rules.slice(0, 3)

  const activate = () => update(s => { if (activateMesoState(s, id, 'user')) {
    toast(t('{0} is now your mesocycle', meso.name))
    toast(t('Your published week stays as it is until the next publication.')) } })

  // Seções, cada uma só quando tem dado (RF-2):
  //   THIS WEEK (Planned / Logged da semana escolhida) · OBJECTIVE · PRIORITIES · RULES ·
  //   EVIDENCE · COACH LOG · EXTRAS
  // No cartão de estado, as datas do mesociclo usam fmtDate(m.start) direto, mas o carimbo de
  // ativação é ISO completo: fmtDate monta `new Date(iso + 'T12:00:00')` e devolveria "Invalid
  // Date" com a hora junto — daí `fmtDate(m.activatedAt.slice(0, 10))` (F14).
}
```

**Edição (U7: pode mexer em tudo).** O formulário é o mesmo da criação e mais três coisas, sempre
**preservando o que não está na tela** (extras em qualquer nível, `plan`/`log` das semanas,
`evidence`, `log[]`, carimbos de ativação). Os campos vêm **preenchidos** do objeto: editar o nome não
pode zerar as nove regras do coach (F19).

```jsx
/* mesoFormSheet({ meso }) — criar (sem `meso`) ou editar (com `meso`).
   Molde: o `CustomExForm` (sheets.jsx:396), que é o formulário de campos do app. */
export const mesoFormSheet = (opts = {}) =>
  ui().openSheet(close => <MesoForm meso={opts.meso || null} close={close} />)

function MesoForm({ meso, close }) {
  const update = useStore(s => s.update)
  const base = meso
  const [name, setName] = useState(base?.name || '')
  const [start, setStart] = useState(base?.start || todayInMeso())
  const [count, setCount] = useState(base ? base.weeks.length : 4)      // só a criação usa
  const [goal, setGoal] = useState(base?.goal || '')
  const [focusL, setFocusL] = useState(base?.priorities?.lower || '')
  const [focusU, setFocusU] = useState(base?.priorities?.upper || '')
  const [reps, setReps] = useState(base?.rules?.['Reps alvo'] || '')
  const [phases, setPhases] = useState(Object.fromEntries((base?.weeks || []).map(w => [w.n, w.phase])))
  // Só o campo que o usuário mexeu é gravado; o resto do objeto passa byte a byte (F19).
  const dirty = useRef(new Set())
  const touch = (k, setter) => v => { dirty.current.add(k); setter(v) }

  const save = () => {
    const notes = []
    update(s => {
      const before = (s.mesos || []).find(m => m.id === base?.id) || null
      let next = before ? { ...before } : { id: 'meso-' + start, origin: 'user', weeks: [] }
      if (!before || dirty.current.has('name')) next.name = name.trim()
      if (!before || dirty.current.has('goal')) next.goal = goal.trim() || undefined
      if (!before) {
        next.start = start
        next.weeks = buildWeeks(start, count)
        next.end = next.weeks[next.weeks.length - 1].end
      } else if (dirty.current.has('start') && start !== before.start) {
        // U10: as semanas ANDAM junto com a data nova, preservando fase, planejado, registrado e
        // extras. Re-derivar do zero perderia o que o coach escreveu (F3).
        const delta = Math.round((new Date(start + 'T12:00:00Z') - new Date(before.start + 'T12:00:00Z')) / 86400000)
        next.start = start
        next.end = addDays(before.end, delta)
        next.weeks = shiftWeeks(before.weeks, delta)
      }
      if (!before || dirty.current.has('focusL') || dirty.current.has('focusU')) {
        const p = { ...(focusL.trim() ? { lower: focusL.trim() } : {}), ...(focusU.trim() ? { upper: focusU.trim() } : {}) }
        if (Object.keys(p).length) next.priorities = p; else delete next.priorities
      }
      if (!before || dirty.current.has('reps')) {
        next.rules = { ...(next.rules || {}) }
        if (reps.trim()) next.rules['Reps alvo'] = reps.trim(); else delete next.rules['Reps alvo']
        if (!Object.keys(next.rules).length) delete next.rules
      }
      if (dirty.current.has('phases')) next.weeks = next.weeks.map(w => ({ ...w, phase: phases[w.n] ?? w.phase }))
      next = normalizeMeso(next, notes) || next        // a mesma régua do import (A18)
      next.updatedAt = new Date().toISOString()
      const i = (s.mesos || []).findIndex(m => m.id === next.id)
      if (i >= 0) s.mesos[i] = next; else s.mesos.push(next)
    })
    close()
    toast(base ? t('Mesocycle updated') : t('Mesocycle created'))
  }
  // Formulário: TextField(nome) · TextField(data, com máscara AAAA-MM-DD) ·
  // Segmented(semanas 4/6/8, só na criação) · TextArea(objetivo) · TextField(foco lower) ·
  // TextField(foco upper) · TextField(reps alvo) · uma linha por semana com o campo da fase ·
  // Button primary (Salvar) + Button ghost (Cancelar).
}
```

**Imports novos no `sheets.jsx`** (o arquivo importa hoje `Button, Slider, Switch, Segmented,
SelectRow, Row` de `components/ui.jsx`, linha 14 — `TextField` entra nesta lista):

```js
import { normalizeMeso, activateMesoState, mesoState, todayInMeso, extrasOf, shiftWeeks,
         buildWeeks, addDays, LIMITS, mesoBytes } from './lib/meso.js'
import { parseMesoFile, noteText, mesoToJSON, mesoToCSV, mesoFileName, MAX_FILE_BYTES } from './lib/meso-file.js'
import { Button, Slider, Switch, Segmented, SelectRow, Row, TextField, TextArea } from './components/ui.jsx'
```

> **A régua duplicada é de propósito:** `LIMITS` (frontend) e as constantes de `api/meso.js` são dois
> runtimes diferentes — o bundle do PWA não importa do servidor. Os números do §6 são o contrato, e o
> teste `frontend/src/lib/meso.test.js` fixa cada um deles para uma mudança acidental não passar.

Rodapé fixo (`.bar-b`): `Ativar este mesociclo` quando não é o ativo; `Editar` sempre; o lugar do botão
da semana fica reservado para o BACKLOG-02.

### 6. `frontend/src/views/PlanRaw.jsx` (novo)

Rota `/plan/raw?scope=plan&id=`. Segmentado com os três escopos, cabeçalho, JSON indentado, `Copiar` e
`Compartilhar .json`.

```jsx
export default function PlanRaw() {
  const [q, setQ] = useSearchParams()
  const S = useStore(s => s.S)
  const scope = ['meso', 'plan', 'all'].includes(q.get('scope')) ? q.get('scope') : 'plan'
  const meso = scope === 'meso' ? (S.mesos || []).find(m => m.id === q.get('id')) : null
  // Escopo `meso` sem id válido mostra o vazio explícito — nunca o estado inteiro (M25).
  const missing = scope === 'meso' && !meso
  const payload = missing ? null : meso ? meso
    : scope === 'plan'
      ? { mesos: S.mesos || [], activeMeso: S.activeMeso, routines: S.routines, week: S.week,
          dayPlan: S.dayPlan, customEx: S.customEx }
      : S
  const json = payload ? (meso ? mesoToJSON(meso) : JSON.stringify(payload, null, 2)) : ''   // A4
  const kb = (new Blob([json]).size / 1024).toFixed(1)
  const lines = json ? json.split('\n').length : 0
  // Cabeçalho (RF-11): nome (do mesociclo ou do escopo) · KB · linhas · e, no escopo plan,
  // `rev` e data do `_ts`. Corpo: <pre className="rawjson">{json}</pre>, ou a mensagem de vazio.
  // Ações: Copiar (navigator.clipboard + toast) e Compartilhar .json (shareExport no nativo,
  // blob no navegador — o mesmo caminho do `exportFile` do PlanTools).
}
```

> **A URL no navegador tem `#`** (o app usa `HashRouter`, `App.jsx:95`): a rota é `/plan/raw`, e o
> endereço é `…/#/plan/raw?scope=plan`. Vale para os links do `PlanTools` e do menu do mesociclo
> (`nav('/plan/raw?scope=meso&id=…')`) e para o teste manual (F15).

CSS novo no fim do `index.css`:

```css
/* Visão crua: monoespaçada, indentada, quebrando linha (o texto do coach é prosa longa;
   rolagem horizontal em telefone é pior do que uma linha a mais). */
.rawjson{
  margin:0;padding:14px;background:var(--surface);border-radius:var(--r-card);
  font:400 12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2;
}
```

### 7. `frontend/src/sheets.jsx` — cinco peças novas

| Peça | Molde que já existe |
|---|---|
| `mesoListSheet()` | `dayAssignSheet` (lista de `.item` + `Icon name="check"`) |
| `mesoFormSheet({ meso })` | `PlanImport` (formulário com `Button`, `TextField`, `Segmented`) |
| `mesoActionsSheet(meso)` | `PlanTools` (menu com botões primário/tinted/ghost) |
| `mesoImportSheet(parsed)` | `ImportSummary` (tiles + avisos + botão primário) |
| `exportMeso(meso, ext)` | função local do `PlanTools` (`shareExport` no nativo, blob no navegador) |

```jsx
/* ============================ mesocycles ============================ */
export const mesoListSheet = () => ui().openSheet(close => <MesoList close={close} />)

function MesoList({ close }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const today = todayInMeso()
  const fileRef = useRef(null)
  // `nav()` é o helper de lib/nav.js, que este módulo já importa (o App.jsx liga o navigate nele).
  const list = [...(st.mesos || [])].sort((a, b) =>
    a.id === st.activeMeso ? -1 : b.id === st.activeMeso ? 1 : (b.start || '').localeCompare(a.start || ''))
  // U6: tocar ATIVA; o `>` abre a tela. O `›` é um alvo próprio, com stopPropagation, para os
  // dois gestos conviverem na mesma linha.
  const activate = id => { update(s => { if (activateMesoState(s, id, 'user')) {
    toast(t('{0} is now your mesocycle', (st.mesos.find(m => m.id === id) || {}).name))
    toast(t('Your published week stays as it is until the next publication.')) } }) }
  const open = id => { close(); nav('/plan/meso/' + id) }
  return <>
    <h3>{t('Mesocycles')}</h3>
    <div className="list">
      {list.map(m => {
        const s = mesoState(m, today)
        return <div key={m.id} className="item" onClick={() => activate(m.id)}>
          <div className="grow">
            <div className="tt">{m.name}</div>
            <div className="ss">{fmtDate(m.start)} – {fmtDate(m.end)} · {t(s === 'ended' ? 'ended' : s === 'future' ? 'starts soon' : 'in progress')}</div>
          </div>
          {m.id === st.activeMeso && <Icon name="check" className="accent" />}
          <button className="iconbtn" onClick={e => { e.stopPropagation(); open(m.id) }} aria-label={t('Open')}>
            <Icon name="chevronRight" /></button></div>
      })}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="plus" onClick={() => { close(); mesoFormSheet({}) }}>{t('New mesocycle')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="tinted" icon="folder" onClick={() => fileRef.current?.click()}>{t('Import a mesocycle file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json,text/csv,.csv" hidden
      onChange={ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) { close(); importMesoFile(f) } }} />
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Lê o arquivo e abre o resumo — mesmo caminho do `importFromApp`. */
export function importMesoFile(file) {
  if (file.size > MAX_FILE_BYTES) { toast(t('That file is too large')); return }   // A7
  const rd = new FileReader()
  rd.onload = () => {
    let parsed
    try { parsed = parseMesoFile(String(rd.result), file.name) }
    catch { toast(t('Could not read that file')); return }
    if (parsed.errors.includes('empty')) { toast(t('That file is empty')); return }
    if (parsed.errors.includes('json') || parsed.errors.includes('csv') || parsed.errors.includes('no-core')) {
      toast(t('That file has no mesocycle in it')); return
    }
    if (!parsed.mesos.length) { toast(t('Nothing to import from that file')); return }
    ui().openSheet(close => <MesoImport parsed={parsed} close={close} />)
  }
  rd.onerror = () => toast(t('Could not read that file'))
  rd.readAsText(file)
}
```

O resumo (`MesoImport`) mostra tiles (mesociclos, semanas, regras, extras preservados), as notas do
parser, as colisões de id, e grava **todos** os mesociclos do arquivo (U8):

```jsx
function MesoImport({ parsed, close }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const clashes = parsed.mesos.filter(m => (st.mesos || []).some(x => x.id === m.id))
  // Teto do estado conferido AQUI também (A7/F10): o arquivo pode ter até 2 MB, e nada impede
  // 60 mesociclos nele. Os que não couberem são recusados pelo nome, não engolidos.
  const room = Math.max(0, LIMITS.library - ((st.mesos || []).length - clashes.length))
  const fits = parsed.mesos.slice(0, room)
  const overflow = parsed.mesos.slice(room)
  const doImport = () => {
    const first = fits[0]
    update(s => {
      for (const m of fits) {
        const i = s.mesos.findIndex(x => x.id === m.id)
        if (i >= 0) s.mesos[i] = m; else s.mesos.push(m)     // colisão só chega aqui depois do aviso
      }
    })
    close()
    toast(t(fits.length === 1 ? '{0} imported' : '{0} mesocycles imported', fits.length))   // F11
    confirmSheet({ title: t('Activate it now?'), message: first.name, confirmText: t('Activate'),
      onConfirm: () => update(s => { if (activateMesoState(s, first.id, 'user')) {
        toast(t('{0} is now your mesocycle', first.name))
        toast(t('Your published week stays as it is until the next publication.')) } }) })
  }
  // Cabeçalho: "{n} mesocycles · {início} → {fim}" (do primeiro).
  // Tiles: fits.length · semanas do primeiro · regras do primeiro · extras preservados (do primeiro
  // mesociclo: extrasOf(m).length — o do nível da semana aparece em EXTRAS na tela).
  // Avisos em amarelo, um por linha, vindos de `parsed.notes.map(n => noteText(n, t))` (F20) —
  // o resumo NÃO tem lógica própria de texto.
  // Recusados (U8/F9): "⚠ {n} item(ns) sem nome ou sem data ficaram de fora: #2, #5".
  // Excedentes (F10): "⚠ {n} mesociclos não cabem na biblioteca (limite de 40): {nomes}".
  // Colisão (A8): "⚠ meso-2026-09-15 já existe" e o botão principal vira `Substituir`.
  // Rodapé: Button primary (`Import` ou `Substituir`, desabilitado quando fits.length === 0) e
  // Button ghost (`Cancel`).
}
```

**`PlanTools`** ganha o bloco do mesociclo (e as duas variáveis que faltavam):

```jsx
function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const activeMeso = (st.mesos || []).find(m => m.id === st.activeMeso) || null   // M24
  // …o resto do componente fica como está…
  {activeMeso && <>
    <h4 className="sec">{t('Mesocycle')}</h4>
    <Button variant="ghost" icon="upload" onClick={() => exportMeso(activeMeso, 'json')}>{t('Export mesocycle (JSON)')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="upload" onClick={() => exportMeso(activeMeso, 'csv')}>{t('Export mesocycle (CSV)')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="code" onClick={() => { close(); nav('/plan/meso/' + activeMeso.id) }}>{t('Open the mesocycle')}</Button>
  </>}
  <h4 className="sec">{t('Data')}</h4>
  <Button variant="ghost" icon="code" onClick={() => { close(); nav('/plan/raw?scope=plan') }}>{t('View plan as JSON')}</Button>
```

> A seção `Data` **nasce nesta entrega** (o `PlanTools` de hoje vai de "Share your plan" direto a
> "Got a plan from a friend?", sheets.jsx:689-704): é o cabeçalho que agrupa o mesociclo e a visão
> crua no fim da folha (F22).

```jsx
/** Export do mesociclo — o mesmo caminho do `exportFile` do PlanTools. */
export async function exportMeso(meso, ext) {
  const text = ext === 'csv' ? mesoToCSV(meso) : mesoToJSON(meso)
  const name = mesoFileName(meso, ext)
  if (MOBILE) { try { await shareExport(text, name) } catch { /* dismissed */ } return }
  const blob = new Blob([text], { type: ext === 'csv' ? 'text/csv' : 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  URL.revokeObjectURL(a.href)
}

/** Menu do mesociclo (⋯): o que vale para o ativo e para qualquer um da lista (RF-10). */
export const mesoActionsSheet = meso => ui().openSheet(close => <MesoActions meso={meso} close={close} />)

function MesoActions({ meso, close }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const active = st.activeMeso === meso.id
  return <>
    <h3>{meso.name}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{fmtDate(meso.start)} – {fmtDate(meso.end)} · {t('{0} weeks', meso.weeks.length)}</div>
    {!active && <><Button variant="primary" icon="check" onClick={() => { close(); update(s => { if (activateMesoState(s, meso.id, 'user')) {
      toast(t('{0} is now your mesocycle', meso.name))
      toast(t('Your published week stays as it is until the next publication.')) } }) }}>{t('Activate this mesocycle')}</Button><div style={{ height: 8 }} /></>}
    <Button variant="tinted" icon="pencil" onClick={() => { close(); mesoFormSheet({ meso }) }}>{t('Edit')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="upload" onClick={() => { close(); exportMeso(meso, 'json') }}>{t('Export mesocycle (JSON)')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="upload" onClick={() => { close(); exportMeso(meso, 'csv') }}>{t('Export mesocycle (CSV)')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="code" onClick={() => { close(); nav('/plan/raw?scope=meso&id=' + meso.id) }}>{t('View JSON')}</Button>
  </>
}
```

### 8. `frontend/src/App.jsx` — rotas

```jsx
// ANTES
              <Route path="/plan/r/:id" element={<RoutineEdit />} />

// DEPOIS
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/plan/meso/:id" element={<MesoEdit />} />
              <Route path="/plan/raw" element={<PlanRaw />} />
```

### 9. `frontend/src/locales/pt.js`

Chaves novas (a chave é a string em inglês, como manda o `i18n.js`). `Planned` **não** entra: a chave já
existe (`pt.js:109`, `'Planned': 'Planeado'`, usada na legenda do calendário) e duplicá-la trocaria a
tradução da outra tela. As outras dez línguas caem no inglês automaticamente.

```js
  'Mesocycle': 'Mesociclo',
  'Mesocycles': 'Mesociclos',
  'No mesocycle yet': 'Nenhum mesociclo ainda',
  'Create one, or import a file': 'Crie um, ou importe um arquivo',
  'covers today': 'cobre hoje',
  'tap to activate': 'toque para ativar',
  'New mesocycle': 'Novo mesociclo',
  'Import a mesocycle file': 'Importar arquivo de mesociclo',
  'Open': 'Abrir',
  'Open the mesocycle': 'Abrir o mesociclo',
  'week {0} of {1}': 'semana {0} de {1}',
  '{0} weeks': '{0} semanas',
  'ended': 'terminado',
  'in progress': 'em curso',
  'starts soon': 'começa em breve',
  '{0} ended on {1}.': '{0} terminou em {1}.',
  'Start the next one': 'Começar o próximo',
  'Activate this mesocycle': 'Ativar este mesociclo',
  '{0} is now your mesocycle': '{0} é o seu mesociclo agora',
  'Your published week stays as it is until the next publication.': 'A sua semana publicada continua igual até a próxima publicação.',
  'Back to the previous one': 'Voltar ao anterior',
  'Activated by the assistant': 'Ativado pelo assistente',
  'THIS WEEK': 'ESTA SEMANA',
  'Logged': 'Registrado',
  'Nothing planned or logged for this week yet.': 'Nada planejado ou registrado nesta semana ainda.',
  'OBJECTIVE': 'OBJETIVO', 'PRIORITIES': 'PRIORIDADES', 'RULES': 'REGRAS',
  'EVIDENCE': 'EVIDÊNCIA', 'Why this mesocycle': 'Por que este mesociclo',
  'COACH LOG': 'HISTÓRICO DO COACH', 'entries': 'registros', 'EXTRAS': 'EXTRAS',
  '{0} fields from your file': '{0} campos do seu arquivo',
  'kept as they came — nothing was rewritten': 'guardados como vieram, nada foi reescrito',
  'Show all ({0})': 'Ver todas ({0})', 'Show less': 'Ver menos',
  'Import mesocycle': 'Importar mesociclo', 'Weeks': 'Semanas', 'Rules': 'Regras', 'Extras': 'Extras',
  'Replace': 'Substituir',
  'Activate it now?': 'Ativar agora?', 'Activate': 'Ativar',
  '{0} imported': '{0} importado',
  '{0} mesocycles imported': '{0} mesociclos importados',
  'Export mesocycle (JSON)': 'Exportar mesociclo (JSON)',
  'Export mesocycle (CSV)': 'Exportar mesociclo (CSV)',
  'View plan as JSON': 'Ver plano em JSON', 'View JSON': 'Ver JSON',
  'Copy JSON': 'Copiar JSON', 'Share .json': 'Compartilhar .json', 'Copied': 'Copiado',
  'That mesocycle is not in this profile.': 'Esse mesociclo não está neste perfil.',
  'Mesocycle created': 'Mesociclo criado',
  'Mesocycle updated': 'Mesociclo atualizado',
  'Everything': 'Tudo',
  'Import': 'Importar',
  '{0} derived from {1}': '{0} derivado de {1}',
  '{0} was trimmed to {1}': '{0} foi cortado em {1}',
  '{0} item(s) without a name or a date were left out: {1}': '{0} item(ns) sem nome ou sem data ficaram de fora: {1}',
  '{0} mesocycles do not fit in the library (limit of 40): {1}': '{0} mesociclos não cabem na biblioteca (limite de 40): {1}',
  '{0} already exists': '{0} já existe',
  'CSV carries no coach log and no extra fields': 'CSV não carrega o histórico do coach nem os campos extras',
  'mesocycle from the assistant': 'mesociclo do assistente',
  'your mesocycle': 'seu mesociclo',
  'That file is too large': 'Esse arquivo é grande demais',
  'That file has no mesocycle in it': 'Esse arquivo não tem mesociclo',
```

### 10. `api/meso.js` (novo)

```js
// api/meso.js — mesociclo: validação do núcleo, upsert e ativação.
//
// Regra que manda aqui (decisão do usuário 13/09/2026): valida FORMA, nunca conteúdo. Um
// arquivo mais rico que o nosso objeto entra inteiro — campo desconhecido é preservado em
// qualquer nível, e a API não filtra nada além de tamanho e do núcleo (RF-13).
import { withState, parseIfMatch, checkIfMatch, stateMeta } from './routines.js';

export const MESO_ID_RE = /^meso-\d{4}-\d{2}-\d{2}$/;
export const MAX_MESO_BYTES = 64 * 1024;
export const MAX_MESOS = 40;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDate = s => { const d = new Date(s + 'T12:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
/** Tamanho em bytes do objeto como ele vai ser gravado (usado aqui e no `checkState`). */
export const mesoBytes = m => Buffer.byteLength(JSON.stringify(m), 'utf8');
const tooLong = (v, n) => typeof v === 'string' && v.trim().length > n;

/** Só o núcleo, com os limites da tabela do §6. Devolve null ou { error, code, field }. */
export function validateMesoBody(meso) {
  if (!meso || typeof meso !== 'object' || Array.isArray(meso)) return { error: 'meso required', code: 'MESO_REQUIRED', field: 'meso' };
  if (!MESO_ID_RE.test(String(meso.id || ''))) return { error: 'id must be meso-YYYY-MM-DD', code: 'BAD_MESO_ID', field: 'id' };
  if (!meso.name || typeof meso.name !== 'string' || !meso.name.trim()) return { error: 'name required', code: 'BAD_MESO_NAME', field: 'name' };
  if (tooLong(meso.name, 120)) return { error: 'name must be <= 120 chars', code: 'BAD_MESO_NAME', field: 'name' };
  if (!ISO.test(String(meso.start || '')) || !realDate(meso.start)) return { error: 'start must be a real ISO date', code: 'BAD_MESO_START', field: 'start' };
  if (meso.end != null && (!ISO.test(String(meso.end)) || !realDate(meso.end) || meso.end < meso.start)) return { error: 'end must be a date >= start', code: 'BAD_MESO_END', field: 'end' };
  if (meso.origin != null && meso.origin !== 'user' && meso.origin !== 'assistant') return { error: 'origin must be user or assistant', code: 'BAD_MESO_ORIGIN', field: 'origin' };
  if (tooLong(meso.goal, 400)) return { error: 'goal must be <= 400 chars', code: 'BAD_MESO_GOAL', field: 'goal' };
  const weeks = meso.weeks;
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > 52) return { error: 'weeks must be 1..52', code: 'BAD_MESO_WEEKS', field: 'weeks' };
  let prevEnd = null;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (!w || typeof w !== 'object') return { error: 'week must be an object', code: 'BAD_MESO_WEEK', field: 'weeks' };
    if (w.n !== i + 1) return { error: 'week.n must run 1..N in order', code: 'BAD_MESO_WEEK_N', field: 'weeks' };
    for (const k of ['start', 'end']) if (w[k] != null && (!ISO.test(String(w[k])) || !realDate(w[k]))) return { error: `week.${k} must be a real ISO date`, code: 'BAD_MESO_WEEK_DATE', field: 'weeks' };
    if (w.start != null && w.end != null && w.end < w.start) return { error: 'week.end must be >= week.start', code: 'BAD_MESO_WEEK_DATE', field: 'weeks' };
    if (prevEnd && w.start != null && w.start < prevEnd) return { error: 'weeks must be in date order', code: 'BAD_MESO_WEEK_ORDER', field: 'weeks' };
    if (w.start != null && w.start < meso.start) return { error: 'week starts before the mesocycle', code: 'BAD_MESO_WEEK_RANGE', field: 'weeks' };
    if (meso.end != null && w.end != null && w.end > meso.end) return { error: 'week ends after the mesocycle', code: 'BAD_MESO_WEEK_RANGE', field: 'weeks' };
    if (w.phase != null && String(w.phase).trim().length > 80) return { error: 'week.phase must be <= 80 chars', code: 'BAD_MESO_PHASE', field: 'weeks' };
    prevEnd = w.end || prevEnd;
  }
  const rules = meso.rules;
  if (rules != null) {
    if (typeof rules !== 'object' || Array.isArray(rules)) return { error: 'rules must be a map', code: 'BAD_MESO_RULES', field: 'rules' };
    const keys = Object.keys(rules);
    if (keys.length > 40) return { error: 'too many rules', code: 'BAD_MESO_RULES', field: 'rules' };
    for (const k of keys) {
      if (!k.trim() || k.length > 40 || String(rules[k]).length > 600) return { error: 'rule label or value too long', code: 'BAD_MESO_RULES', field: 'rules' };
    }
  }
  if (meso.log != null && (!Array.isArray(meso.log) || meso.log.length > 200)) return { error: 'log must be a list of <= 200 entries', code: 'BAD_MESO_LOG', field: 'log' };
  return null;
}
```

```js
/* ---------------------------------------------------------------- handlers */
export function makeHandlers(deps) {
  const { readSession, readState, json, readActor, readRawBody } = deps;

  /** Sessão + assinatura opcional. A ordem das checagens é a do `patch` de rotina (RF-12). */
  function open(req, raw, pathname) {
    const user = readSession(req);
    if (!user) return { code: 401, body: { error: 'not signed in', code: 'UNAUTH' } };
    const actor = readActor(req, user.id, raw, req.method, pathname);
    if (actor.err) return { code: 400, body: { error: 'actor signature invalid', code: actor.err } };
    return { user, actor };
  }

  async function putMeso(req, res) {
    const raw = await readRawBody(req).catch(() => null);
    if (raw === null) return json(res, 400, { error: 'bad json' });
    const o = open(req, raw, '/api/plan/meso');
    if (o.code) return json(res, o.code, o.body);
    const { user, actor } = o;
    // If-Match ANTES da forma: corpo inválido sem token responde 428, não 400 (é o que o
    // routines.js faz de propósito, e o cliente depende disso para reler em vez de corrigir).
    const ifMatch = parseIfMatch(req.headers['if-match']);
    const S0 = readState(user.id);
    if (!S0 || typeof S0 !== 'object') return json(res, 409, { error: 'no state for this profile', code: 'NO_STATE' });
    const pre = checkIfMatch(S0, ifMatch);
    if (pre) return json(res, pre.code, pre.body);
    let body; try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json' }); }
    const bad = validateMesoBody(body.meso);
    if (bad) return json(res, 400, bad);
    if (mesoBytes(body.meso) > MAX_MESO_BYTES) return json(res, 400, { error: 'meso too large', code: 'MESO_TOO_BIG' });
    const activate = body.activate === 'now' ? 'now' : 'none';
    const r = withState(deps, user.id,
      { ifMatch, actor, action: 'put-meso', uid: user.id, dropActive: false },
      S => {
        const list = Array.isArray(S.mesos) ? S.mesos : (S.mesos = []);
        const i = list.findIndex(m => m.id === body.meso.id);
        if (i < 0 && list.length >= MAX_MESOS) return { error: 'too many mesocycles', code: 'TOO_MANY_MESOS', code_http: 409 };
        const created = i < 0;
        const prev = created ? null : list[i];
        // Os carimbos de ativação NUNCA vêm do corpo (A2/F8): sem isto, qualquer sessão manda
        // `activatedBy: "assistant"` e a tela mostra "Ativado pelo assistente" sem assinatura.
        // O que a rota não conhece, ela apaga; o que ela sabe, ela escreve.
        const { activatedBy, activatedAt, ...rest } = body.meso;
        const meso = { ...rest, updatedAt: new Date().toISOString() };
        if (activate === 'now') {
          // Republicar com `activate: "now"` o mesociclo que JÁ é o ativo não pode perder o carimbo
          // (F7): o carimbo é reescrito sempre; o ponteiro só se move quando muda de verdade.
          meso.activatedAt = new Date().toISOString();
          meso.activatedBy = actor.verified === 'signature' ? 'assistant' : 'user';
        } else if (prev) {
          if (prev.activatedAt) meso.activatedAt = prev.activatedAt;   // substituir não desativa
          if (prev.activatedBy) meso.activatedBy = prev.activatedBy;
        }
        if (created) list.push(meso); else list[i] = meso;
        const activated = activate === 'now' && S.activeMeso !== meso.id;
        if (activated) { S.mesoPrev = S.activeMeso || null; S.activeMeso = meso.id; }
        return { _meta: { mesoId: meso.id, created, activated, activate } };
      });
    const code = r.code === 200 ? (r.body?.meta?.created ? 201 : 200) : r.code;
    if (r.code === 200) {
      console.log(`[og-meso] op=put-meso uid=${user.id} meso=${body.meso.id} `
        + `created=${r.body.meta.created} activated=${r.body.meta.activated} rev=${r.body.meta.revBefore}->${r.body.meta.revAfter}`);
    }
    return json(res, code, r.body);
  }

  async function getMeso(req, res) {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in', code: 'UNAUTH' });
    const S = readState(user.id);
    if (!S || typeof S !== 'object') return json(res, 404, { error: 'no state for this profile', code: 'NO_STATE' });
    const m = stateMeta(S);
    json(res, 200, { mesos: S.mesos || [], activeMeso: S.activeMeso || null, mesoPrev: S.mesoPrev || null, rev: m.rev, _ts: m._ts });
  }

  async function activateMeso(req, res, params) {
    const mid = params[0];
    const raw = await readRawBody(req).catch(() => Buffer.alloc(0));
    const o = open(req, raw, `/api/plan/meso/${mid}/activate`);
    if (o.code) return json(res, o.code, o.body);
    const { user, actor } = o;
    const ifMatch = parseIfMatch(req.headers['if-match']);
    const r = withState(deps, user.id,
      { ifMatch, actor, action: 'activate-meso', uid: user.id, dropActive: false },
      S => {
        const list = Array.isArray(S.mesos) ? S.mesos : [];
        const meso = list.find(m => m.id === mid);
        if (!meso) return { error: `mesocycle "${mid}" not found`, code: 'MESO_NOT_FOUND', code_http: 409,
                            mesos: list.map(m => m.id) };
        if (S.activeMeso !== mid) {
          S.mesoPrev = S.activeMeso || null;
          S.activeMeso = mid;
          meso.activatedAt = new Date().toISOString();
          meso.activatedBy = actor.verified === 'signature' ? 'assistant' : 'user';
        }
        return { _meta: { mesoId: mid, activated: true } };
      });
    if (r.code === 200) {
      console.log(`[og-meso] op=activate-meso uid=${user.id} meso=${mid} rev=${r.body.meta.revBefore}->${r.body.meta.revAfter}`);
    }
    return json(res, r.code, r.body);
  }

  return { putMeso, getMeso, activateMeso };
}
```

### 11. `api/server.js` — rotas, injeção e `checkState`

```js
// 1) import no topo, junto de routines/catalog (linhas 14-15) — namespace, não default (M02)
import * as meso from './meso.js';
```

```js
// 2) PATTERNS (linha 366): a rota com parâmetro. O handler é resolvido em ROUTINE_HANDLERS —
//    é lá que os handlers de mesociclo também entram (M01), senão a rota responde 404.
const PATTERNS = [
  { method: 'PATCH',  re: /^\/api\/routines\/([A-Za-z0-9_-]{1,64})$/, params: ['rid'], handler: 'patchRoutine' },
  { method: 'DELETE', re: /^\/api\/routines\/([A-Za-z0-9_-]{1,64})$/, params: ['rid'], handler: 'deleteRoutine' },
  { method: 'POST',   re: /^\/api\/plan\/meso\/([A-Za-z0-9_-]{1,64})\/activate$/, params: ['mid'], handler: 'activateMeso' }
];
```

```js
// 3) tabela exata de rotas (perto das de rotina, linha 415)
  // Mesociclo: o app escreve pelo estado; estas rotas são do assistente (e do dump do escritor).
  'PUT /api/plan/meso':  (req, res) => ROUTINE_HANDLERS.putMeso(req, res),
  'GET /api/plan/meso':  (req, res) => ROUTINE_HANDLERS.getMeso(req, res),
```

```js
// 4) injeção, junto do makeHandlers das rotinas (linha 764) — o MESMO mapa, porque o
//    matchRoute procura handler de padrão só ali
Object.assign(ROUTINE_HANDLERS, routines.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor, CATALOG_PATH
}));
Object.assign(ROUTINE_HANDLERS, meso.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor
}));
```

```js
// 5) checkState (linha 63): a MESMA régua tolerante do resto da função — teto e forma mínima,
//    nunca a tabela inteira. A tabela é da rota do assistente, onde a recusa é uma resposta; aqui
//    um 400 travaria treino, rotina e peso junto, e a escrita ficaria pendente para sempre (F1).
function checkState(s) {
  if (Array.isArray(s)) return 'state must be an object';
  if (s.routines !== undefined) { /* …como está hoje… */ }
  if (s.mesos !== undefined) {
    if (!Array.isArray(s.mesos)) return 'mesos must be an array';
    if (s.mesos.length > MAX_MESOS) return 'too many mesocycles';
    for (const m of s.mesos) {
      if (!m || typeof m !== 'object' || Array.isArray(m)) return 'mesocycle must be an object';
      if (!MESO_ID_RE.test(String(m.id || ''))) return 'mesocycle.id must be meso-YYYY-MM-DD';
      if (!Array.isArray(m.weeks) || !m.weeks.length) return 'mesocycle.weeks required';
      if (mesoBytes(m) > MAX_MESO_BYTES) return 'mesocycle too large';
    }
  }
  return null;
}
```

O import correspondente no topo do `server.js`:

```js
import * as meso from './meso.js';
import { validateMesoBody, mesoBytes, MAX_MESOS, MAX_MESO_BYTES, MESO_ID_RE } from './meso.js';
```

```js
// 6) docker-compose.yml — com o alvo `test` no fim do Dockerfile, ele vira o alvo PADRÃO do
//    build: sem esta linha, `docker compose build api` produziria a imagem de teste e a API
//    subiria rodando a suíte em vez do servidor (F5). É a mesma exigência da
//    spec_publicacao_micro.md §5.
services:
  api:
    build:
      context: .
      dockerfile: api/Dockerfile
      target: runtime
    image: ghcr.io/duartesantos8/opengym-api:latest
    pull_policy: never      # ← da spec_publicacao_micro.md §5; se ela ainda não foi implementada,
                            #   só o `target: runtime` entra aqui
```

`meso` entra na lista de exportados do arquivo (linha 85) para o teste. **Nada muda no
`web/nginx.conf`**: as rotas passam pelo `/api/` que já existe.

### 12. `api/Dockerfile` — alvo `test`

O arquivo de hoje tem um estágio só e apaga os `*.test.js` da imagem de produção (linha 14); não há
como rodar a suíte. É **a mesma mudança** que a `spec_publicacao_micro.md` §4 especifica — quem
implementar primeiro faz, o outro encontra pronto.

```dockerfile
# ANTES (linha 1)
FROM node:22-alpine

# DEPOIS (linha 1)
FROM node:22-alpine AS runtime
```

```dockerfile
# NO FIM do arquivo: alvo de teste. `RUN`, não `CMD` — o `docker build --target test` precisa
# FALHAR quando a suíte falha, senão o portão do deploy não prova nada (F4). Os caminhos são
# relativos ao WORKDIR (/app/api), e nada disto entra na imagem de produção, que continua sendo o
# estágio `runtime`.
FROM runtime AS test
RUN node --test ./*.test.js
```

Com o estágio `test` no fim do arquivo, ele vira o alvo padrão do build — daí o `target: runtime`
no `docker-compose.yml` (item 6 acima).

### 13. Testes

**`api/meso.test.js`** (novo, `node --test`, mesmo arranjo do `routines.test.js`: `DATA_DIR` em
`mkdtemp`, `PORT=0`, import de `server.js`). Cobre:
`validateMesoBody` — id fora do formato, nome vazio, nome com 121 caracteres, `start` que não existe no
calendário (`2026-02-30`), `end` antes de `start`, `origin` desconhecido, `goal` com 401 caracteres,
`weeks` vazio, `n` fora da sequência, semana com `end` antes do `start`, semana fora do intervalo do
mesociclo, 41 regras, regra com valor de 601 caracteres, `log` com 201 itens;
rotas — `401` sem sessão, `428` sem `If-Match` **mesmo com corpo inválido** (a ordem de RF-12),
`400` de forma, `409 STALE_STATE` com base velha, `201` na criação e `200` na substituição,
`MESO_TOO_BIG` com 65 KB, `TOO_MANY_MESOS` no 41º, **campo desconhecido preservado** (no mesociclo, em
`weeks[i]` e em `rules`) depois do `PUT` e no `GET`, `activate: "now"` movendo o ponteiro com `mesoPrev`
e `activatedBy: "assistant"` **só** com assinatura válida (sem assinatura → `"user"`),
`POST /activate` com id inexistente → `409 MESO_NOT_FOUND`, `GET` devolvendo `rev`/`_ts`, as linhas de
auditoria (`put-meso`/`activate-meso`) e a linha `[og-meso]` no stdout.

**`frontend/src/lib/meso.test.js`** (`vitest`): `buildWeeks` (4 semanas, 7 dias cada);
`weeksFromRange('2026-09-02','2026-09-07')` → **1 semana de 6 dias**, e
`weeksFromRange('2026-09-22','2026-09-30')` → **2 semanas** (22–28 e 29–30, a última com 2 dias) —
a semana de 9 dias inteira só existe quando o arquivo a declara (A5/F24); `weeksFromRange` com
intervalo maior que 366 dias → `[]` e `normalizeMeso` → `null` (F2); `resolveWeeks` respeitando o que
veio; `shiftWeeks` movendo as datas e preservando `plan`/`log`/extras; `normalizeMeso` recusando sem
núcleo, derivando `id`/`end`/`weeks` **e anotando cada derivação**, cortando nome (121), `goal` (401),
regra longa, `phase` (81), 53 semanas e 201 registros **com uma nota por corte**, normalizando `n`
para 1..N e preservando extra em qualquer nível; `extrasOf`; `weekAt` nas bordas; `mesoState` nos três
estados com data fixa; `activateMesoState` (grava `mesoPrev`, carimba `by`, não faz nada quando já é o
ativo); `mergeMesos`; `fixMesoPointers` (ponteiro órfão vira `null`); `todayInMeso()` no formato
`AAAA-MM-DD`.

**`frontend/src/lib/meso-file.test.js`** (`vitest`): JSON objeto, lista e `{ mesos: [] }` (os três
caminhos, com **todos** os mesociclos devolvidos); JSON com chave desconhecida preservada; **arquivo
com 5 mesociclos e 2 sem nome → 3 em `mesos` e `refused: [{index:2},{index:5}]`** (F9); CSV de uma
linha sem nenhuma coluna de semana → mesociclo magro com **4 semanas derivadas** (F6); CSV de quatro
linhas com `;` como separador e vírgula dentro do campo entre aspas; coluna desconhecida virando extra
da semana; `rules` com quebra de linha dentro da célula, com `|` e com `;`; `mesoToCSV` →
`parseMesoFile` devolvendo o mesmo núcleo, **com as semanas de 6 e 9 dias preservadas** e com a nota
`format: csv` dizendo o que não volta; arquivo vazio, JSON inválido e CSV sem cabeçalho conhecido.

### 14. Documentação

- **`docs/MESO.md` (novo)** — objeto, nomenclatura (`meso-AAAA-MM-DD`, `S<n>`), as três rotas, o fluxo
  de publicação do assistente, o que é de quem, e a tabela de códigos de recusa. Simétrico ao
  `docs/MICRO.md`.
- **`docs/ROTINAS_API.md`** — uma seção curta apontando para o `docs/MESO.md`.
- **`CHANGELOG.md`** — entrada da versão `1.3.0` (A11).

## Comportamento Visual/UX

Protótipo navegável: `meso_screen.html` (espelho local), com o mesociclo do assistente, o do usuário e
a aba `Raw JSON`. Os tokens são os do app (`index.css`: `--surface:#1c1c1e`, `--acc`, `--r-card:14px`).

### Painel na aba Plan (enxuto, U1)

```
Plan                                        [share]
────────────────────────────────────────────────────
MESOCYCLE
┌──────────────────────────────────────────────────┐
│ Mesociclo 2 · Low Volume                      ›  │
│ semana 2 de 4 · progressão leve                  │
└──────────────────────────────────────────────────┘

Week schedule                  Routines
Terça     Push C               [ + New ]
Quarta    Legs 1               Push C - Shoulder 3D
```

Vencido (`terminado`) — o mesociclo continua ativo e o app oferece o próximo:

```
┌──────────────────────────────────────────────────┐
│ Mesociclo 2 · Low Volume          terminado   ›  │
│ semana 4 de 4 · deload                           │
└──────────────────────────────────────────────────┘
Mesociclo 2 terminou em 30 de set. Começar o próximo
```

Ativado pelo assistente — a faixa com o desfazer (RF-5):

```
┌──────────────────────────────────────────────────┐
│ Mesociclo 3 · Low Volume                      ›  │
│ semana 1 de 4 · progressão leve                  │
└──────────────────────────────────────────────────┘
[Ativado pelo assistente]  Voltar ao anterior
```

### Tela do mesociclo

```
‹   Mesociclo 2 · Low Volume                      ⋯
    mesocycle from the assistant

┌ Active              02 Sep → 30 Sep · 4 weeks ┐
│  [ S1✓ ][ ●S2 ][ S3 ][ S4 ]                   │
│  progressão leve · 08 Sep → 14 Sep · this week │
│  Active since 13 Sep · activated by the        │
│  assistant                                     │
└────────────────────────────────────────────────┘

THIS WEEK
│ Planned   Consolidação: repetir as cargas da…
│ Logged    S2 definida em 07/09 com as suas…

OBJECTIVE      Low Volume com progressão control…
PRIORITIES     Lower  GLÚTEOS · P1 absoluto…
               Upper  DELTÓIDE LATERAL · P1…
RULES          Reps alvo    6-8 em tudo…
               Intensidade  falha só em máquina…
               Descanso     2-3 min nos pesados…
               Show all (9)
EVIDENCE     › Why this mesocycle
COACH LOG    › 3 entries
EXTRAS       › 3 fields from your file

[ Activate this mesocycle ]                  Edit
```

O mesociclo do assistente (`meso-2026-09-02`) convertido tem **9 regras**: as dez chaves de
`regras_globais` viram nove porque `reps_alvo` e `reps_leg` (as duas dizem `6-8`) viram uma só,
"Reps alvo". As semanas reais são S1 02→07/09 (6 dias), S2 08→14/09, S3 15→21/09 e S4 22→30/09 (9
dias) — é o caso que A5 protege.

### Lista de mesociclos

```
Mesocycles                            [ + Novo ]
┌────────────────────────────────────────────────┐
│ ● Mesociclo 3 · Low Volume              ✓   >  │
│   15/09 → 12/10 · em curso                     │
│ ○ Mesociclo 2 · Low Volume                  >  │
│   02/09 → 30/09 · terminado                    │
└────────────────────────────────────────────────┘
  Tocar ativa · o > abre a tela · nada é apagado
```

### Import (vários mesociclos, colisão avisada)

```
Import mesocycle
2 mesocycles · 15 Sep → 12 Oct

┌ Mesocycles ┐ ┌ Weeks ┐ ┌ Rules ┐ ┌ Extras ┐
│     2      │ │   4   │ │   9   │ │   3    │
└────────────┘ └───────┘ └───────┘ └────────┘

⚠ end derived from weeks · id derived from start
ℹ 3 extra fields kept: cargas prescritas, planilha, nota
⚠ meso-2026-09-15 already exists
⚠ CSV carries no coach log and no extra fields

[ Substituir ]                        [ Cancel ]
```

## Testes manuais

1. **Sem mesociclo.** Perfil sem `mesos`: a aba Plan mostra `Nenhum mesociclo ainda`; tocar abre a
   lista, vazia, com as duas portas (`Novo mesociclo`, `Importar arquivo`).
2. **Criar à mão.** Nome `Teste`, começa hoje, 4 semanas, objetivo de uma linha → o painel passa a
   mostrar `semana 1 de 4 · calibração`; a tela mostra as quatro semanas com as fases padrão e
   `EVIDENCE`/`COACH LOG`/`EXTRAS` **ausentes** (mesociclo magro não parece inacabado).
3. **Importar o mesociclo real.** Converter `mesociclo_ativo.json` para o objeto do §6 (dez chaves de
   `regras_globais` → nove regras na tela; S1 de 6 dias e S4 de 9 dias preservadas) e importar: o
   resumo mostra 1 mesociclo, 4 semanas e 9 regras; a tela mostra prioridades, regras com "ver todas
   (9)", evidência e histórico. Ativar pelo resumo → painel troca e a faixa "Ativado por você" aparece.
4. **Arquivo mais rico.** Acrescentar ao JSON uma chave inventada no mesociclo (`cargas_prescritas`) e
   outra dentro de uma semana: as duas aparecem em `EXTRAS`/na semana; o export JSON devolve as duas.
   Exportar em CSV e reimportar devolve o núcleo igual e o resumo avisa que o CSV não carrega
   `log[]` nem extras do mesociclo.
5. **CSV de planilha.** Salvar o CSV com `;` como separador, vírgula dentro de campo entre aspas e as
   regras em `Rótulo=Texto` com quebra de linha dentro da célula → quatro semanas, fases, `Planned` e
   as regras corretas. Salvar também um CSV de **uma linha só** (nome, começa em, objetivo) → o resumo
   mostra 4 semanas derivadas e a tela mostra o mesociclo magro.
6. **Vários num arquivo, um quebrado.** Exportar dois mesociclos num JSON (lista) e importar: o resumo
   mostra 2 e os dois entram na lista, inativos. Reimportar o mesmo arquivo: o resumo avisa a colisão e
   o botão principal é `Substituir`, não `Importar`. Acrescentar ao arquivo um terceiro item sem nome
   → o resumo diz "1 item sem nome ou sem data ficou de fora: #3" e importa os outros dois.
7. **Vencido.** Criar um mesociclo com fim ontem e ativá-lo: o painel mostra `terminado` e a linha
   `terminou em … Começar o próximo · Importar`; criar o próximo e ativá-lo → o vencido continua na
   lista, marcado.
8. **Ativação pelo assistente e desfazer.** Publicar pela rota com `activate: "now"` e assinatura →
   o app, no próximo pull, mostra o mesociclo novo com a faixa "Ativado pelo assistente"; tocar em
   "Voltar ao anterior" devolve o anterior e o aviso de que a semana publicada não mudou.
9. **Visão crua.** `⋯ → Ver plano em JSON`: a URL fica `…/#/plan/raw?scope=plan`; conferir `mesos`,
   `activeMeso`, `routines`, `week`, `dayPlan` e que `workouts` **não** está nesse escopo; trocar para
   `Tudo` e conferir que aparece; `Copiar JSON` copia e o toast confirma. Abrir
   `#/plan/raw?scope=meso&id=nao-existe` mostra "não está neste perfil", nunca o estado inteiro.
10. **Rotas do assistente (no Pi).** `curl -X PUT https://opengym.edsc.fun/api/plan/meso` sem sessão →
    `401`; sem `If-Match` → `428` (inclusive com corpo inválido); base velha → `409 STALE_STATE`; corpo
    válido com `activate: "now"` → `200/201`, e o mesociclo aparece no app no próximo pull. Republicar
    o **mesmo** mesociclo (que já é o ativo) com `activate: "now"` → a faixa "Ativado pelo assistente"
    continua na tela (o carimbo não se perde).
11. **Preservação pela API.** Publicar pela rota um mesociclo com chave desconhecida (no mesociclo e
    dentro de `weeks[0]`) e conferir no `GET /api/plan/meso` e no app (`EXTRAS`) que voltou inteira.
    Publicar com `activatedBy: "assistant"` no corpo e **sem** assinatura → o app mostra "Ativado por
    você" (o corpo não decide quem ativou).
12. **Teto pelo app.** Um `PUT /api/data` com 41 mesociclos (ou um de 65 KB) é recusado com `400`,
    provando que o teto não depende da rota do assistente. Depois disso, uma edição qualquer no app
    (marcar uma série) volta a subir normalmente — o estado não fica preso.

## Critérios de aceite

- [ ] `S.mesos`, `S.activeMeso` e `S.mesoPrev` existem no `DEF`; abrir o app com estado antigo não
      quebra, um mesociclo sem núcleo é descartado na leitura, e `activeMeso`/`mesoPrev` órfãos viram
      `null`.
- [ ] O painel mostra exatamente `{nome}` e `{semana N de M} · {fase}` do mesociclo ativo; com o meso
      vencido, mostra a marca `terminado` e a linha com `Começar o próximo`.
- [ ] Sem mesociclo ativo, o painel oferece o que cobre hoje; sem nenhum, mostra as duas portas.
- [ ] A faixa "Ativado pelo assistente · Voltar ao anterior" aparece quando o ativo foi ativado por
      assinatura e existe `mesoPrev`, e o desfazer volta ao anterior.
- [ ] Na lista, tocar a linha ativa e o `>` abre a tela (U6), com o mesociclo ativo no topo e os
      demais por data decrescente.
- [ ] A tela renderiza estas seções quando há dado e **omite** quando não há: cartão de estado com a
      trilha, THIS WEEK, OBJECTIVE, PRIORITIES, RULES, EVIDENCE, COACH LOG, EXTRAS. Num mesociclo magro
      (nome, datas, objetivo, uma regra) aparecem só o cartão, THIS WEEK (com o vazio explícito),
      OBJECTIVE e RULES.
- [ ] Criar à mão com 4 campos gera `id`, `end` e `weeks[]` com as fases padrão; editar preserva
      `plan`/`log` das semanas, `evidence`, `log[]` e os extras.
- [ ] Import aceita JSON (objeto, lista, `{mesos:[]}`) e CSV (`,` e `;`), **traz todos** os mesociclos
      do arquivo, deriva o que falta **anotando no resumo**, preserva campo desconhecido em qualquer
      nível, avisa colisão de id antes de substituir e recusa arquivo acima de 2 MB.
- [ ] Item sem nome ou sem data é recusado **e nomeado** no resumo (`#2`, `#5`), sem impedir a
      entrada dos bons (U8/F9); mesociclos além do teto de 40 são recusados pelo nome (F10).
- [ ] O cliente nunca grava um mesociclo que a API recusaria (A18/F1): importar um arquivo com nome de
      200 caracteres, 45 regras, `phase` de 120 ou 53 semanas grava o objeto **cortado e anotado**, e a
      edição seguinte no app (marcar uma série) sobe normalmente — o estado não fica preso em `400`.
- [ ] CSV de uma linha sem coluna de semana vira mesociclo magro com 4 semanas derivadas; o export CSV
      devolve as semanas de 6 e 9 dias do mesociclo real (colunas de início/fim de semana).
- [ ] Export JSON faz round-trip fiel (extras incluídos); export CSV leva o subconjunto de A16 e o
      resumo do import diz o que ele não carrega.
- [ ] Visão crua só leitura com os três escopos, cabeçalho com KB/linhas (+ `rev`/`_ts` no escopo
      `plan`), `Copiar`, `Compartilhar .json` e vazio explícito para id desconhecido.
- [ ] `PUT/GET /api/plan/meso` e `POST /api/plan/meso/:id/activate` respondem `401` sem sessão, `428`
      sem `If-Match` (antes de olhar a forma), `409 STALE_STATE` com base velha, `400` de forma
      (id, nome, data, ordem das semanas, origem, limites), `201` criação, `200` substituição, e
      `activate: "now"` move o ponteiro com `mesoPrev` e `activatedBy` **do fato verificado**.
- [ ] Campo desconhecido sobrevive ao `PUT`, ao `GET` e ao app (RF-13), inclusive dentro de `weeks[]`.
- [ ] `PUT /api/data` com 41 mesociclos ou um mesociclo de 65 KB responde `400` (o teto vale nos dois
      caminhos).
- [ ] `docker build --target test -f api/Dockerfile .` **falha** com a suíte vermelha e **passa** com a
      verde (`RUN node --test ./*.test.js`); `npm test` (vitest) verde no frontend; `docker compose
      build api` continua produzindo a imagem de produção (alvo `runtime`, sem `*.test.js`).
- [ ] `npm run build` (vite) sem erro; bundle servido por `opengym-web-1`; a aba Plan abre com o painel
      novo (o app lê `S.mesos` normalizado e o painel mostra o mesociclo ativo).
- [ ] `[og-meso] op=…` no `docker logs opengym-api-1` e registro em `audit.jsonl` para cada escrita.

## Deploy e rollback

```bash
# 1. testes, pelo alvo de teste da imagem (no host não há node no PATH nem api/node_modules)
cd /mnt/drivebackup/apps/openGym/openGym
docker build --target test -f api/Dockerfile .
# 2. frontend
cd frontend && npm test && npm run build && cd ..
# 3. anotar a imagem viva (é o rollback) e recriar sem pull
docker inspect --format '{{.Image}}' opengym-api-1
docker compose build api web
docker compose up -d --force-recreate --pull never api web
# 4. provar que as rotas subiram: 401 (sem credencial) NÃO é 404
curl -s -o /dev/null -w '%{http_code}\n' -X PUT https://opengym.edsc.fun/api/plan/meso
curl -s -o /dev/null -w '%{http_code}\n' https://opengym.edsc.fun/api/plan/meso
```

**Nunca `docker compose pull`**: o serviço `api` tem `image:` de outro namespace, e o
`pull_policy: never` existe justamente por isso (ver `docs/MICRO.md` §7).

## Riscos e limites

- **A semana publicada não acompanha a troca de mesociclo.** Ativar outro mesociclo muda a moldura
  (nome, semanas, fases) e **não** a semana nem as rotinas: quem troca isso é a publicação do micro
  (BACKLOG-02). O app diz isso ao ativar, para ninguém achar que o treino mudou junto.
- **Rotina não pertence a mesociclo.** O id (`r_push_S2_af8c`) não diz de onde veio, então a lista de
  rotinas não filtra por mesociclo.
- **Escritores não se coordenam pela API (U9).** `PUT /api/plan/meso` substitui o mesociclo daquele
  `id` inteiro, sem comparar com o que estava lá e sem regra nenhuma sobre quem escreveu. Quem
  coordena é o assistente, lendo o mesociclo antes de criar o próximo — decisão do usuário, fora
  desta spec. Consequência no app: um mesociclo editado no celular **e** substituído no servidor
  volta para a versão do servidor na próxima mescla.
- **A mescla da biblioteca não tem livro-caixa.** As rotinas têm (`rememberBase`/`adoptServerRoutines`
  decidem o que é edição local e o que veio do servidor); os mesociclos, de propósito, não: o servidor
  vence por `id` e só o que existe **apenas** neste aparelho sobrevive. É o preço de U9, e o lugar de
  mudar isso é aqui, se um dia doer.
- **Estado maior.** Cada mesociclo custa ~2 KB no estado, que é baixado inteiro a cada pull. Daí o teto
  de 64 KB por mesociclo e 40 mesociclos (A7), aplicado nos dois caminhos de escrita.
- **A régua do cliente e a da API precisam andar juntas.** `checkState` é tolerante de propósito
  (teto e forma mínima); se um dia ele passar a validar a tabela inteira do §6, um arquivo importado
  que o cliente deixou passar trava o `PUT /api/data` — e com ele treino, rotina e peso (F1). O teste
  manual 12 existe para pegar isso.
- **`todayInMeso()` é o único lugar com fuso fixo.** O resto do app segue o fuso do aparelho; comparar
  datas de mesociclo com `todayISO()` em código novo reintroduz o bug (M23).
- **Sem `fsync`** no `atomicWrite` (limitação já existente da API): queda de energia pode perder a
  última gravação. O destino é HD, não SSD.
- **A visão crua não edita.** Escrever continua sendo pelo formulário (validado) e pelo import (que
  valida forma); uma caixa de texto livre seria um caminho de escrita sem validação nenhuma.
- **O CSV não é round-trip fiel** (A16): `log[]`, carimbos de ativação, `updatedAt` e extras do
  mesociclo ficam de fora. Quem precisa do arquivo inteiro usa JSON.

---

> **Atualização de 13/09/2026 — a visão crua mudou.** O RF-11 e o teste manual 9 desta spec descrevem
> **três escopos** (`meso`, `plan`, `all`) e o cabeçalho com `rev`/`_ts`. Por decisão do usuário, a
> visão crua passou a mostrar **só o mesociclo** (`/plan/raw?id=<meso>`), e os escopos de plano e de
> estado inteiro foram retirados: o plano não é um objeto guardado (era um envelope montado na hora) e
> o estado inteiro é o backup, que vive em Settings. A fonte da verdade é
> `docs/specs/spec_visao_json_meso.md`; o restante desta spec continua valendo.
