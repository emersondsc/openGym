# ROTINAS — a API de rotinas do openGym

> Documento permanente. Serve para **o usuário, o agente do Hermes e qualquer sessão futura**
> entenderem a API de rotinas **como ela está implementada hoje**, sem reler 2.000 linhas de código.
>
> Este documento descreve o **comportamento atual** (contrato + invariantes). Ele não é uma spec:
> spec é proposta, isto aqui é retrato. As specs que originaram o desenho ficam em
> `docs/specs/spec_api_rotinas.md` (servidor) e `docs/specs/spec_escritor_rotinas.md` (lado Hermes).

Última conferência contra o código: **13/09/2026** — `emerson-custom`, suíte `api/routines.test.js`
com **69 testes, 69 passando** (medida dentro da imagem da API, contra a árvore de trabalho).

> **Mesociclo não é rotina.** A biblioteca de mesociclos, o ponteiro do ativo e as rotas
> `PUT`/`GET /api/plan/meso` e `POST /api/plan/meso/:id/activate` têm documento próprio:
> **`docs/MESO.md`**. Rotina continua sendo template de exercícios; mesociclo é o bloco de
> semanas que a contém.

---

## 1. Resumo em uma tela

O estado de um usuário é **um arquivo JSON só** (`/data/state-<uid>.json`) que contém tudo:
rotinas, histórico de treinos, plano da semana, peso corporal. Não há tabela de rotinas, não há
banco de dados.

Por cima desse arquivo existem **duas portas de escrita**:

| Porta | Alcance | Quem usa |
|---|---|---|
| `PUT /api/data` | o estado **inteiro** (replace total) | o PWA, o agente na ausência da porta nova |
| `PATCH /api/routines/:id` | **uma** rotina, por merge | o agente do Hermes (caminho principal hoje) |

A API **não tem política de treino**. Ela valida *forma* (o peso é número? o id existe no catálogo?),
grava o que o payload declara e devolve informação quando um dia já está ocupado. Se o exercício é
certo para o mesociclo é decisão do portão P1 do Hermes, não daqui.

Quatro rotas compõem a API de rotinas:

```
GET    /api/routines            lista leve + rev            (sessão)
PATCH  /api/routines/:rid       edita UMA rotina por merge  (sessão + ator + If-Match)
DELETE /api/routines/:rid       apaga e limpa referências   (sessão + ator + If-Match)
GET    /api/audit?limit=N       trilha de auditoria         (sessão)
```

Onde cada coisa mora no código:

| Arquivo | Papel |
|---|---|
| `api/server.js` | rotas, sessão, `rev`, `If-Match`, ator, auditoria, `PUT /api/data`. **Dono** do relógio e do arquivo |
| `api/routines.js` | validação de campo, merge por id, limpeza de referências. **Não escreve no socket** — devolve `{code, body}` |
| `api/catalog.js` | leitor único do catálogo de exercícios (memoizado por caminho) |
| `api/routines.test.js` | 69 testes (`node --test`), incluindo o contrato de `api/routines.fixtures.json` |
| `frontend/src/lib/plan-merge.js` | funções puras do merge do lado do app (o usuário vence o agente) |
| `frontend/src/store/useStore.js` | `pushState` / `pullState` — como o PWA conversa com `PUT /api/data` |

Fronteira de dependência (importante para não criar import circular): `routines.js` é **burro de
propósito**. Ele precisa de `readSession`, `readState`, `stateFile`, `readRawBody`, `atomicWrite`,
`DATA`, `SECRET` — e recebe tudo isso por **injeção** em `makeHandlers(deps)` (`server.js:764`).
Quem responde no socket é sempre o `server.js`.

---

## 2. Onde o dado mora

### 2.1 O arquivo de estado

`/data/state-<uid>.json` (o uid é sanitizado: `replace(/[^a-zA-Z0-9_-]/g, '')`, `server.js:58`).
Gravado por `atomicWrite` (tmp + rename) — nunca há arquivo meio escrito.

Campos que interessam às rotinas:

| Campo | O que é | Quem escreve |
|---|---|---|
| `routines[]` | a lista de rotinas: `{id, name, emoji, prog, ex[]}` | PATCH (uma) ou PUT (todas) |
| `routines[].ex[]` | os exercícios da rotina (a prescrição) | idem |
| `week{}` | dia da semana (0-6) → `routineId` | app; o DELETE limpa |
| `dayPlan{}` | `"YYYY-MM-DD"` → `routineId` ou `"rest"` | app; o DELETE limpa |
| `workouts[]` | histórico executado. **Registro, não ponteiro** | app |
| `customEx[]` | exercícios próprios do perfil (id fora do catálogo base) | app |
| `active` | treino em andamento **daquele aparelho** | app; nunca vai ao servidor |
| `rev` | contador do servidor (token de concorrência) | **só o servidor** |
| `_ts` | carimbo de tempo do cliente | cliente (o PUT preserva) |
| `unit` | unidade padrão do perfil (`kg`/`lb`) | app |

**`active` é sempre local.** O `PUT /api/data` faz `delete body.state.active` (`server.js:593`) e o
`DELETE` de rotina faz `dropActive: true`. Editar rotina por `PATCH` **não** mexe em `active`.

**`workouts[]` nunca é tocado por escrita de rotina.** Apagar uma rotina não apaga o histórico: o
treino que já aconteceu aconteceu. O `DELETE` conta quantos `workouts` ficaram órfãos
(`routineId` apontando para rotina que não existe) mas **não** os remove.

### 2.2 O catálogo de exercícios — fonte única

`frontend/src/lib/exercises-data.json` é **o** arquivo canônico (`api/catalog.js:20`), o mesmo que o
app carrega. Hoje tem **1.324 exercícios** (`CATALOG_EXPECTED`). Nem a API nem o agente escrevem
nele — só leem.

- `OG_CATALOG` aponta para outro arquivo sem rebuild (é o que os testes usam).
- Contagem diferente da esperada = **aviso** no boot, não erro (a base pode crescer).
- Catálogo **ausente** = o servidor **não sobe** (`process.exit(1)`, `server.js:780`). Sem catálogo a
  validação aceitaria id inexistente em silêncio, e a análise devolveria id no lugar do nome.
- Um id é válido se está no catálogo **ou** em `customEx` daquele perfil.

### 2.3 A trilha de auditoria

`/data/audit.jsonl` — **um arquivo global para todos os perfis**, uma linha JSON por escrita
(tanto `PUT /api/data` quanto `PATCH`/`DELETE` de rotina). Cada linha carrega `prev` (o `h` da linha
anterior) e `h` (sha256 de `prev + JSON.stringify(rec)`): é uma **hash-chain**.

Rotação em 5.000 linhas (mantém as últimas). A rotação quebra a cadeia **por construção** — é por
isso que `GET /api/audit` devolve `chainIntact: false` em vez de fingir integridade.

O que a cadeia prova: que nenhuma linha do meio foi alterada sem que a seguinte deixasse de casar.
O que ela **não** prova: que a linha mais antiga ainda é a original (rotação) e que alguém não
reescreveu o arquivo inteiro. É detecção de adulteração local, não assinatura externa.

---

## 3. As rotas, uma por uma

### 3.1 `GET /api/routines`

Lista **leve** + metadado de concorrência. **Não** devolve `ex[]` (de propósito: o agente pergunta
"o que existe" sem baixar o estado inteiro).

Requer sessão (`gymsid`). Respostas:

```
200  { routines: [ {id, name, emoji, prog, exCount, setsTotal}, … ], rev, _ts, etag }
401  { error: "not signed in" }
404  { error: "no state for this profile", code: "NO_STATE" }
```

`rev` = contador do servidor (`0` se o estado nunca foi escrito pela versão nova); `_ts` = carimbo do
cliente; `etag` = UUID novo a cada leitura (não é token de concorrência, é rastro).

**O 404 é funcional, não decorativo:** é assim que o escritor do Hermes descobre em que modo falar
(`spec_escritor_rotinas` A7). `200` → o servidor tem a porta nova, use `PATCH`. `404` → servidor
antigo, cai para `PUT /api/data` com o estado inteiro.

### 3.2 `PATCH /api/routines/:rid`

Edita **uma** rotina. Toda outra rotina e todo o resto do estado ficam intocados.

`:rid` casa `^[A-Za-z0-9_-]{1,64}$` (`server.js:367`). Id com espaço, `%20` ou acento **não casa a
rota**: é `404 not found` do roteador, não erro de validação. **Consequência:** uma rotina cujo id
tenha caractere fora desse conjunto é inalcançável por `PATCH`/`DELETE` — só o `PUT` de estado
inteiro a toca. O gerador de id do app já respeita o formato (o mesmo padrão de `r_upper_C_20260829`).

Exige **três** coisas além da sessão, nesta ordem de checagem:

1. `X-OG-Actor` — obrigatório (`400 ACTOR_REQUIRED` se faltar)
2. `X-OG-Actor-Sig` — se presente e inválida: `400 BAD_ACTOR_SIG`
3. `If-Match` — obrigatório e tem de bater: `428` / `400` / `409`

Corpo (todos os campos opcionais, mas o corpo vazio `{}` é uma chamada que não muda nada):

```jsonc
{
  "name": "Upper C",              // 1..60 chars (trim); string vazia = BAD_NAME
  "emoji": "🔺",                   // string não-vazia; cortada em 32 chars
  "prog": "linear",               // off | linear | greyskull | double | time
  "exRemoved": ["0584"],          // ids a REMOVER desta rotina
  "ex": {                         // merge POR ID: o que não é citado não muda
    "0326": { "weight": 9, "sets": 4 },
    "0584": { "mode": "time", "sec": 40 }
  }
}
```

Resposta de sucesso:

```json
{
  "ok": true,
  "rev": 9,
  "meta": {
    "rev": 9, "revBefore": 8, "revAfter": 9, "etag": "…uuid…",
    "actor": "hermes", "verified": "signature",
    "stateHash": "…", "beforeHash": "…", "action": "patch-routine",
    "at": "2026-09-13T18:22:01.123Z", "routines": ["r_upper_C_20260829"]
  }
}
```

`rev` sobe **1 por requisição aceita**, não 1 por campo alterado. Uma chamada que não muda nada
(idêntico ao que já estava) ainda assim grava, incrementa `rev` e audita.

### 3.3 `DELETE /api/routines/:rid`

Mesmos três requisitos do PATCH. Sem corpo. Query opcional `?force=1`.

O que ele faz, em ordem:

1. Recusa se a rotina não existe → `404 ROUTINE_NOT_FOUND`
2. Recusa se é a rotina do **treino em andamento** (`S.active.routineId === rid`) e não veio
   `force=1` → `409 ROUTINE_IN_USE` (a resposta traz `active: <id do treino>`)
3. Remove a rotina de `S.routines[]`
4. Limpa **todas** as referências em `week{}` e `dayPlan{}` (`sweepRoutineRefs`)
5. Preserva `workouts[]` inteiro e conta os órfãos

A resposta traz o que foi limpo:

```json
{ "ok": true, "rev": 10,
  "meta": { "action": "delete-routine", "routines": ["r_leg1"],
            "weekCleaned": 1, "dayPlanCleaned": 2, "orphanWorkouts": 7, "…": "…" } }
```

`dropActive: true` neste caminho: o `S.active` sai do estado junto (o treino em andamento não pode
sobreviver à rotina que ele executa — por isso o `409` existe antes).

### 3.4 `GET /api/audit?limit=N`

Últimas N operações, **mais recente primeiro**. `limit` é preso a `1..500`, default `50`.

Quem vê o quê: o dono vê **só o dele**; admin (`user.admin` ou uid em `ADMIN_UIDS`) pode passar
`?uid=<outro>` e ver o daquele perfil. Pedir uid alheio sem ser admin → `403 forbidden`.

```
200  { entries: [ …linhas do audit.jsonl… ], chainIntact: true }
401  { error: "not signed in" }
403  { error: "forbidden" }
```

Cada `entry` tem: `otp` (= `etag` da escrita), `uid`, `rev`, `revBefore`, `revAfter`, `etag`,
`actor`, `verified`, `stateHash`, `beforeHash`, `action`, `at`, `prev`, `h` — mais o que o handler
acrescentou (ex.: `routines`, `weekCleaned`, e `ifMatch` no caso do `PUT`).

`chainIntact: false` significa que a **primeira** linha do arquivo tem `prev` não-nulo: houve
rotação ou corte. É informação, não erro.

### 3.5 `PUT /api/data` — a porta antiga, ainda aberta

Substitui o **estado inteiro**. É o que o PWA usa hoje (`useStore.pushState`) e o caminho de
recuo do agente quando `GET /api/routines` devolve `404`.

Ordem de checagem: sessão → JSON válido → `body.state` é objeto → `checkState` (guarda de forma,
deliberadamente frouxa: rejeita corrupção, nunca estado legítimo) → **`checkRoutineFields`** (as
mesmas regras de campo do PATCH, com o "antes" lido do disco) → ator → concorrência → grava.

Duas diferenças que importam:

- **Catálogo indisponível não bloqueia** o `PUT` (o PATCH devolve `503`). Motivo: o app não pode
  parar de aceitar o próprio estado por causa de um arquivo de dados que falta. A validação de id é
  **pulada** nesse caso.
- **`customEx` do disco conta.** O `checkRoutineFields` usa a união de `cur.customEx` (disco) com
  `state.customEx` (payload), então um cliente que manda a lista reduzida não perde os exercícios
  próprios que já existiam.

Concorrência: com `If-Match`, comparação por **igualdade** com `rev`; sem `If-Match`, cai no guard
por relógio (`body.state._ts < cur._ts` → `409`). O `rev` do corpo é **sobrescrito** pelo servidor
(`curRev + 1`).

### 3.6 `POST /api/routines` — não existe, e é de propósito

Não há criação de rotina por endpoint dedicado. **Criar rotina é `PUT /api/data` com o estado
inteiro** (o cliente é dono do array). A justificativa registrada na spec: é a operação que menos
dói, e a criação em lote (BACKLOG-02) é quem vai querer um `POST` com `idempotencyKey`.

Consequência prática: quem cria rotina por `PUT` assume o estado todo — inclusive o risco de
sobrescrever edição alheia se não mandar o `If-Match` certo. `PATCH` num id inexistente devolve
`404 ROUTINE_NOT_FOUND` com a lista de ids válidos; ele **nunca** cria a rotina.

---

## 4. Validação de campo (`validateExEntry`)

Uma entrada de exercício só é aceita se passar em **tudo** isto. A primeira falha devolve
`{code, field, message}` — e `allowed` quando faz sentido. Nada é gravado quando há recusa.

| Campo | Regra | Código se falhar |
|---|---|---|
| *(entrada)* | tem de ser objeto (não array, não null) | `BAD_EX` |
| `id` | string não-vazia, no catálogo **ou** em `customEx` | `EX_ID_REQUIRED` / `CATALOG_UNKNOWN_EX` |
| `sets` | inteiro **1..20** | `BAD_SETS` |
| `weight` | número finito **0..1000** (bool não é número) | `BAD_WEIGHT` |
| `reps` | inteiro **1..100** **ou** faixa `"A-B"` com `1 ≤ A ≤ B ≤ 100` | `BAD_REPS` |
| `sec` | inteiro **1..3600** | `BAD_SEC` |
| `min` | inteiro **1..600** | `BAD_MIN` |
| `speed` | número **0..40** | `BAD_SPEED` |
| `bodyweight`, `side` | booleano | `BAD_FLAG` |
| `unit` | `kg` \| `lb`, exatamente. **Ausente = herda `S.unit`** | `BAD_UNIT` |
| `inc` | número **≥ 0** | `BAD_FIELD` |
| `repsMin`, `repsMax` | inteiro **≥ 1** | `BAD_FIELD` |
| `prog` | `off` \| `linear` \| `greyskull` \| `double` \| `time` | `BAD_PROG` |
| `sg` | string não-vazia (superset) | `BAD_SG` |
| `restSec` | inteiro **30..300** (= `isValidRest`, `useStore.js:28`) | `BAD_REST` |
| `mode` | `reps` \| `time` \| `cardio` | `BAD_MODE` |

Três regras que não são de faixa e por isso vivem fora da tabela:

**→ `mode` legado.** `"normal"` (e `sg` `0`/`""`) é legado do estado real — 100% dos templates
medidos em 11/09/2026 são assim. A regra é: **tolera onde já está, recusa onde é introduzido.**
`isNewEntry` recusa um exercício novo declarando `"normal"`. `modeOf` lê `"normal"` como `reps`.

**→ `mode` que exige campo.** Trocar para `time` sem `sec` → `MODE_TIME_NO_SEC`. Trocar para
`cardio` sem `min` ou `speed` → `MODE_CARDIO_INCOMPLETE`. A cobrança só vale quando o modo
**mudou** (`modeChanged`) — um item legado em `time` sem `sec` continua passando.

**→ `side` só em reps.** `side: true` com `mode: "time"` → `SIDE_ON_TIME`.

O `unit` merece nota: `"lbs"`, `"LB"`, `"lb "` são **recusados**, não normalizados. Se a validação
fosse tolerante, um erro de digitação cairia em silêncio na herança do perfil e o exercício voltaria
a ser lido em kg sem ninguém perceber.

### 4.1 O merge por id (`mergeRoutine`)

O merge é **sobre o item existente**: o que a intenção não cita não muda, nem é normalizado.

- **Item existente** → base é uma cópia do atual; o payload se sobrepõe. `weight: 9` muda o peso e
  deixa `sets`, `mode`, `sg`, `unit` exatamente como estavam. **A posição na lista é preservada.**
- **Item novo** → base são os defaults do modo (`defaultExFields`, porta 1:1 de
  `frontend/src/lib/history.js`): `reps` → `{sets:3, reps:10, weight:0, mode:'reps'}`;
  `time` → `{sets:3, sec:45, weight:0, mode:'time'}`; `cardio` → `{sets:1, min:20, speed:8}`;
  equipamento `body weight` acrescenta `bodyweight: true`. **O item novo vai para o FIM da lista.**
- **Troca de modo limpa o modo anterior** (`stripCrossModeFields`): virar `time` remove
  `reps/min/speed/repsMin/repsMax`; virar `cardio` remove `reps/sec/repsMin/repsMax/prog/inc`,
  além de remover do objeto qualquer chave que não tenha sobrado no merge. Sem isso, sobraria
  `reps: 8` num exercício cronometrado.
- **`exRemoved` com id ausente é erro** (`EX_NOT_IN_ROUTINE`), não silêncio: o servidor não adivinha
  se o id está escrito errado.
- **`cleanupSg` roda sempre no fim**: um `sg` que ficou sozinho (o par do superset foi removido)
  é apagado.

### 4.2 Validação no nível da rotina (`validateRoutineBody`)

Antes do merge, o corpo do PATCH passa por: `name` 1..60 chars → `BAD_NAME`; `emoji` string
não-vazia → `BAD_EMOJI`; `prog` no conjunto → `BAD_PROG`; `exRemoved` é array → `BAD_EXREMOVE`;
`ex` é objeto (não array) → `BAD_EX`.

`name`/`emoji`/`prog` são **gravados como vieram, inclusive `prog: "off"`** — a intenção declarada
manda (é o `if (body.prog !== undefined)` no handler de PATCH, `api/routines.js:425`). Campos
desconhecidos no corpo são ignorados.

---

## 5. Concorrência: `rev` + `If-Match`

**`rev` é do servidor.** O cliente nunca inventa um `rev`: ele manda o que tem e o servidor decide.
`GET /api/data` injeta `rev: 0` quando o arquivo nunca foi escrito pela versão nova — sem isso o
cliente não teria base para o primeiro `If-Match`.

O `If-Match` é interpretado por `parseIfMatch` (`routines.js:49`), uma função só para as três rotas:

| Valor do header | Interpretação | Efeito |
|---|---|---|
| ausente / vazio | `null` | **`428 IF_MATCH_REQUIRED`** no PATCH/DELETE. No PUT: guard por `_ts` |
| `*` | curinga | passa (aceita qualquer base) |
| `"7"`, `7`, `"7` | `"7"` (aspas normalizadas) | compara por **igualdade** com `rev` |
| `abc`, `7a` | `'BAD'` | **`400 IF_MATCH_MALFORMED`** |

- `rev` diferente → **`409 STALE_STATE`**, com `{rev, _ts, etag}` do servidor no corpo para o
  cliente poder mesclar.
- A pré-condição é checada **antes de tudo o que é caro** (inclusive antes de carregar o catálogo).
  Motivo medido no deploy de 11/09/2026: sem isso, um pedido sem `If-Match` num servidor sem
  catálogo respondia `503` em vez de `428`. Um erro de concorrência tem de ser o erro de
  concorrência, não um erro de infraestrutura disfarçado.

### 5.1 As duas portas não compartilham o mesmo token

Isto é a pegadinha mais útil deste documento:

- `PATCH` usa **`rev`** (novo).
- `PUT` **sem** `If-Match` usa **`_ts`** (o guard antigo, por relógio do cliente).

Como o `PATCH` incrementa `rev` mas **não** mexe em `_ts`, uma escrita por `PATCH` deixa o `_ts` do
arquivo velho. Um aparelho que faça `PUT` sem `If-Match` e mande um `_ts` menor leva `409` — mesmo
tendo acabado de ler. O caminho correto é sempre mandar `If-Match: <rev lido>`; o cliente antigo é
quem paga o `409` e reenvia (é o que a BACKLOG-09 mede).

### 5.2 Como o app resolve o conflito (o usuário vence)

Decisão do usuário em 11/09/2026: **o que ele fez no app vence o que o assistente escreveu.**
Implementado em `frontend/src/lib/plan-merge.js` (`adoptServerRoutines`), usado nos dois caminhos de
conflito (o 409 do `pushState` e a releitura por volta ao app):

- igual à base baixada (ou sem base) e existe no servidor → **a do servidor** (foi o agente que mudou)
- diferente da base (editada neste aparelho) → **a local**
- existia na base e sumiu do servidor → **some** (foi apagada, e não foi você)
- não está na base e não existe no servidor → **mantida** (sem base não dá para provar que era do
  servidor; o mais seguro é não jogar fora)

O app guarda a "base" (as rotinas **como este aparelho as baixou**) em `localStorage`, chave
`gym_base_routines_v1`. É livro-caixa do aparelho, não do servidor.

---

## 6. Identidade do agente

Dois headers opcionais no `PUT /api/data`, e **um obrigatório** no PATCH/DELETE:

```
X-OG-Actor:      agent=hermes; tool=opengym_writer     ← quem diz ser
X-OG-Actor-Sig:  t=1757788800; v1=<hmac-sha256 hex>    ← a prova
```

O nome do ator sai de `agent=([^;]{1,40})` dentro do primeiro header; sem assinatura ele vira
`"unknown"`. O `verified` no log e no audit assume um de três valores, e a diferença é o ponto:

| `verified` | Quando | O que significa |
|---|---|---|
| `none` | nenhum `X-OG-Actor` | é o PWA antigo. O audit registra `actor: "pwa-legacy"` |
| `claimed` | header sem assinatura | **alegação**, não identidade. Qualquer um pode escrever "sou o hermes" |
| `signature` | assinatura confere | identidade provada pela chave do agente |

**`X-OG-Actor` sem `X-OG-Actor-Sig` é `claimed` e passa.** O PATCH/DELETE exigem o header (para
atribuição), mas não a assinatura — a API é de instância pessoal, e o portão de escrita é a sessão.
O log não finge: `verified: 'claimed'` diz exatamente o que foi provado.

A assinatura (`readActor`, `server.js:240`):

```
canon = t + "\n" + METHOD + "\n" + pathname + "\n" + uid + "\n" + sha256(corpo cru)
v1    = HMAC-SHA256(agentKey(), canon)      ← hex
```

- `t` = epoch em **segundos**. Fora de **±300s** do relógio do servidor → `BAD_ACTOR_SIG`.
- O hash é do **corpo cru** (bytes que chegaram), não do JSON reserializado. Um byte diferente
  invalida.
- `agentKey()` = HMAC-SHA256(`SECRET`, `"opengym-agent-v1"`), guardado em `/data/agent.key` (0600).
  Ausente, vazio, corrompido ou ilegível → **regenerado pela mesma derivação** (nunca derruba a
  requisição com 500). Trocar o `SECRET` troca a chave do agente, e isso invalida o escritor.

Comparações de MAC usam `timingSafeEqual`.

---

## 7. Tabela de códigos

Status HTTP e `code` do corpo, para não confundir os dois:

| HTTP | `code` | Quando |
|---|---|---|
| `401` | *(sem code)* | sem sessão válida / sessão expirada / conta desabilitada |
| `403` | `forbidden` | `?uid=` alheio no `/api/audit` sem ser admin |
| `404` | `not found` | rota não casa (id de rotina com caractere inválido) |
| `404` | `NO_STATE` | perfil sem estado — e é o **sinal de modo** para o agente |
| `404` | `ROUTINE_NOT_FOUND` | `rid` não existe em `S.routines[]` (a resposta lista os ids válidos) |
| `409` | `STALE_STATE` | `If-Match` diferente de `rev`, ou `_ts` velho no PUT. Traz `rev`/`_ts`/`etag` |
| `409` | `NO_STATE` | estado sumiu entre a leitura e a escrita |
| `409` | `ROUTINE_IN_USE` | a rotina é a do treino em andamento; use `?force=1` |
| `428` | `IF_MATCH_REQUIRED` | PATCH/DELETE sem `If-Match` |
| `400` | `IF_MATCH_MALFORMED` | `If-Match` que não é `*` nem dígitos |
| `400` | `ACTOR_REQUIRED` | PATCH/DELETE sem `X-OG-Actor` |
| `400` | `BAD_ACTOR_SIG` | assinatura malformada, fora da janela de ±300s, ou HMAC errado |
| `400` | `bad json` | corpo não parseia |
| `400` | `BAD_BODY`, `BAD_NAME`, `BAD_EMOJI`, `BAD_PROG`, `BAD_EXREMOVE`, `BAD_EX` | validação no nível da rotina |
| `400` | `BAD_SETS`, `BAD_WEIGHT`, `BAD_REPS`, `BAD_SEC`, `BAD_MIN`, `BAD_SPEED`, `BAD_FLAG`, `BAD_UNIT`, `BAD_FIELD`, `BAD_SG`, `BAD_REST`, `BAD_MODE` | validação de campo |
| `400` | `EX_ID_REQUIRED`, `CATALOG_UNKNOWN_EX`, `EX_NOT_IN_ROUTINE`, `MODE_TIME_NO_SEC`, `MODE_CARDIO_INCOMPLETE`, `SIDE_ON_TIME` | validação semântica |
| `503` | `CATALOG_UNAVAILABLE` | catálogo indisponível **no PATCH** (o PUT apenas pula a checagem de id) |
| `500` | `server error` | exceção no handler; nenhuma linha é gravada |
| `500` | `STATE_CORRUPT` | só em `GET /api/coach/analysis` (JSON inválido no arquivo de estado) |

---

## 8. Invariantes (o que pode quebrar se alguém mexer sem saber)

Cada linha abaixo é uma decisão com motivo. Quebrar uma é criar um bug silencioso.

**→ Falha não grava nada.** `withState` trabalha numa **cópia profunda** e só chama `atomicWrite`
depois de um `fn` que terminou sem erro. Um `fn` que lança → `500`, arquivo intocado. Uma validação
que recusa → `400`, arquivo intocado.

**→ `rev` é sobrescrito pelo servidor.** Mesmo que o cliente mande `rev: 999` no corpo.

**→ O `PATCH` grava sempre o que foi declarado**, inclusive `prog: "off"` — não há "não escreve se
for o default".

**→ Validar antes de carregar o catálogo quando o erro é de concorrência.** Ver §5.

**→ `workouts[]` é registro, não ponteiro.** Apagar rotina nunca apaga histórico.

**→ `active` nunca vai ao servidor.** Todo caminho que grava estado remove `active` (PUT e DELETE).

**→ Tolerar legado é diferente de aceitar legado.** `"normal"` e `sg: 0` sobrevivem onde já estão e
são recusados onde são introduzidos. Um cliente publicado (o PWA em cache) manda exatamente isso.

**→ Duas cópias deliberadas.** `api/units.js` copia `frontend/src/lib/units.js`, e a regra de
`restSec` copia `isValidRest` do store. `api/` é pacote separado (Dockerfile próprio) e não enxerga
`frontend/src/`. Ao mudar uma, mude a outra.

**→ `catalog.js` é o leitor único.** `coach.js` e `routines.js` importam o mesmo mapa memoizado por
caminho. Duas leituras era o que existia antes, e com o arquivo em 888 KB isso era pagar a leitura
inteira a cada `GET /api/coach/analysis`.

---

## 9. Quem escreve hoje, dos dois lados

**Lado agente (Hermes):** `~/.hermes/workout/scripts/opengym_writer.py`. O fluxo é
`GET /api/data` (estado + `rev`) → sonda `GET /api/routines` para escolher `patch` ou `put` →
`PATCH /api/routines/<rid>` por rotina tocada, com `If-Match: <rev>` e assinatura do ator. Tem
`--dry-run`. A política de treino (faixa 6-8 do mesociclo, alta > 10%) mora no portão P1 do Hermes,
**não** na API.

**Lado app (PWA):** `frontend/src/store/useStore.js`. `pushState()` faz `PUT /api/data` com
`If-Match` = `rev` confirmado, com debounce de 1,5s; a cada `409` relê, mescla (o usuário vence) e
reenvia uma vez. `pullState()` relê no boot e na volta ao app (no máximo 1x a cada 20s). O servidor
**nunca** empurra estado: abrir o app não é edição.

**Rota de publicação em lote (`POST /api/plan/micro`):** descrita em `docs/MICRO.md`, **não
implementada** neste servidor — conferido em 13/09/2026 contra `https://opengym.edsc.fun`
(devolve `404`). Publicar microciclo hoje é o escritor do Hermes usando as rotas daqui.

---

## 10. Como conferir isto

```sh
# na raiz do repo, dentro da imagem da API (o repo não versiona api/node_modules)
node --test api/routines.test.js        # 69 testes: validação, merge, sweep, If-Match, ator, audit, roteador
node --test api/catalog.test.js         # amarra o catálogo REAL (1.324 exercícios)
```

A suíte **não** sobe o servidor em processo (tentou-se, e a sessão não validava apenas naquele
contexto). A verificação por HTTP é feita contra o servidor **em execução**, com o mesmo cliente
`node:http` — foi assim que o defeito "catálogo procurado em `/data`" apareceu (registro na
`spec_api_rotinas.md`, J13).

Contrato entre as pontas: `api/routines.fixtures.json` (5 entradas aceitas, 9 recusadas, 2 estados)
é validado **contra o validador real**. O cliente não duplica a validação — quem manda é o servidor.

---

## 11. Furos conhecidos (registrados, não escondidos)

**→ Não há criação de rotina por endpoint.** Criar é `PUT /api/data` com o estado inteiro (§3.6).

**→ Não há operação em lote.** Uma chamada por rotina tocada. Recusado na spec com motivo.

**→ `X-OG-Actor` sem assinatura passa** e é registrado como `claimed`. Atribuição, não autenticação.

**→ O `PUT /api/data` valida só `routines[]`.** `week`, `dayPlan`, `workouts` e `bodyweight` passam
por uma guarda de forma frouxa. Um chamador descuidado pode gravar mapa de semana inconsistente.

**→ A hash-chain não sobrevive à rotação** (5.000 linhas). É por isso que `chainIntact` existe.

**→ `rev` sobe por requisição, não por mudança.** Um "PATCH que não muda nada" custa uma revisão e
uma linha de audit.

**→ A ordem das chaves importa na comparação do app.** `planChanged` compara por `JSON.stringify`,
então é sensível à ordem — o aviso "o plano mudou" pode disparar por reordenação de chaves.

---

## 12. Ponteiros

| Assunto | Onde |
|---|---|
| Spec do servidor (decisões, alternativas descartadas) | `docs/specs/spec_api_rotinas.md` (v4) |
| Spec do escritor do Hermes | `docs/specs/spec_escritor_rotinas.md` (v4) |
| Como o microciclo é criado e publicado | `docs/MICRO.md` |
| Histórico de itens e incidentes | `docs/backlog.md` |
| Testes do servidor | `api/routines.test.js` |
| Testes do catálogo | `api/catalog.test.js` |
| Escritor no Hermes | `~/.hermes/workout/scripts/opengym_writer.py` |
