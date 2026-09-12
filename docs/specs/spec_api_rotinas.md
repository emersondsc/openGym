# Spec: API de rotinas no servidor + ajuste no cliente — v4 (final)

> Implementa a **BACKLOG-07** (`docs/backlog.md:74-94`) e resolve o satélite **BACKLOG-09**
> (`docs/backlog.md:121-133`) no que toca ao token de concorrência e ao destino do
> `If-Match-State`. **Par:** `docs/specs/spec_escritor_rotinas.md`. Ver "Relação com a outra spec".
>
> **Decisão do usuário (11/09/2026), que atravessa toda esta spec:** *"o que o usuário faz no app
> vence o que o assistente escreveu"* — o app avisa e segue a versão dele. E: **o comportamento do
> agente está fora de escopo** ("a infraestrutura de api para o agente usar como ele achar melhor").
> O servidor entrega **contrato** (recusa o inválido, diz quem escreveu, impede overwrite cego);
> não decide treino.
>
> **Revisão 1 (subagente revisor, contra o código real):** 24 achados, vários bloqueantes. O que
> mudou de desenho: **`GET /api/data` passa a injetar `rev`** (o cliente não podia enviar `If-Match`
> no primeiro sync); **a tolerância do legado (`mode:"normal"`, `sg:0`) entrou no código** do
> validador, senão o primeiro `PUT` do PWA publicado tomaria `400`; **`withState` propaga o `_meta`**
> do handler (o `DELETE` perdia `weekCleaned`/`orphanWorkouts`); **`S.active` deixou de ser apagado
> pelo `PATCH`**; **`adoptServerRoutines` foi reescrita** (a versão anterior ressuscitava rotina
> apagada); **`parseIfMatch` normaliza as três rotas**; e **o risco do §"Rollout" deixou de ser
> chamado de raro**, com um contador (`pwa-legacy`) para medir a janela em vez de estimá-la. Mapa
> completo no fim do documento.

## Contexto e Objetivo

**Onde vive:** repo `openGym`, branch `emerson-custom`, no hermes
(`/mnt/drivebackup/apps/openGym/openGym`). Stack: API Node **sem framework** (`api/server.js`,
614 linhas), React + Vite (`frontend/`), PWA de uso pessoal. Deploy:
`docker compose build api && docker compose up -d --force-recreate api` (e `web` para o frontend).
Verificado em 11/09/2026: o container `opengym-api-1` roda o `api/server.js` **do fork**.

**O problema, medido no código de hoje:**

- **Não existe operação de rotina.** O roteador é uma tabela de chaves exatas
  (`api/server.js:277`, `const routes = {`, consultada em `:606-608` com
  `req.method + ' ' + url.pathname`). Não há ação para criar, editar ou apagar **uma** rotina:
  quem quer mudar qualquer coisa monta o **estado inteiro** e manda num `PUT /api/data`
  (`api/server.js:433-452`).
- **A validação é rasa.** `checkState` (`api/server.js:56-72`) confere só: é objeto, `routines` é
  array, cada `ex[].id` é string não-vazia e `ex[].sets` é número ≥ 1. **Não valida** `weight`,
  `reps`, `prog`, `mode`, `week`, `dayPlan`, `workouts` nem o `id` contra o catálogo. Foi essa
  fresta que produziu o incidente de 08/09/2026 (id fantasma aceito no `PUT` e descoberto dias
  depois como "Unknown exercise") — o comentário em `api/server.js:53-55` registra o episódio.
- **A concorrência é decidida por relógio.** `api/server.js:446-448`:
  `if (cur && incoming < (cur._ts || 0)) → 409`. O cliente carimba `S._ts = Date.now()` em toda
  edição local (`frontend/src/store/useStore.js:68`). Um PWA **aberto**, com estado velho, que
  sofra **qualquer** edição (inclusive mecânica — ver §5.6) envia um `_ts` **maior** que o do
  agente, passa no guard e sobrescreve a escrita do agente. O guard não é um token: é um desempate
  por ordem de relógio.
- **Não existe identidade.** A credencial é a sessão do próprio usuário, forjada com o `SECRET`
  (`api/server.js:190-193`, `og_state_mutation.md:9-21`). Toda escrita do agente sai como se fosse
  você; o único registro de "quem escreveu" é o `reports/sync_log.md` do Hermes.
- **Não existe limpeza.** Apagar rotina não remove o id de `S.week`/`S.dayPlan`: quem chama tem que
  lembrar — a UI lembra (`frontend/src/views/RoutineEdit.jsx:143-147`), o agente reimplementa.

**O que muda.** Passam a existir **operações por rotina** no servidor, com validação de campo, sem
identidade falsa e com um token de concorrência que é **token** (base lida, comparada por
igualdade). O app ganha o mesmo token sem trocar de endpoint, e o caminho de atualização do cliente
já publicado é explícito e **medido** (§5.7).

## Escopo

**Inclui:**
- Despacho de rota por padrão (`/api/routines/:id`) em `api/server.js`.
- `PATCH /api/routines/:id` — editar o template de **uma** rotina (merge por id, nunca "estado
  inteiro").
- `DELETE /api/routines/:id` — apagar a rotina limpando `week`/`dayPlan` e **preservando
  `workouts[]`**.
- `GET /api/routines` — lista com o metadado de concorrência (`rev`, `_ts`), para o agente montar a
  intenção sem baixar 5 MB de estado.
- **`GET /api/data` passa a devolver `rev` injetado** (§4.7), sem o qual o cliente novo não teria
  base para mandar `If-Match` antes da primeira escrita.
- Validação de campo no servidor (§4.3), com o `id` conferido contra `api/exercise_catalog.json`
  **ou** `S.customEx`.
- **Identidade do agente** por cabeçalho (`X-OG-Actor`, assinatura opcional) e **trilha de
  auditoria** em `/data/audit.jsonl` + `GET /api/audit`.
- **Token de concorrência real:** `S.rev`, com `If-Match` por **igualdade**.
- Compatibilidade com o **PWA já publicado** (§5): cliente antigo não passa a quebrar, e a janela em
  que ele ainda pode vencer é **medida**, não estimada.
- Ajuste do cliente em `frontend/src/store/useStore.js` (token, merge, sem push mecânico no boot).
- **Decisão sobre o header `If-Match-State`**: **removido do desenho** (§4.10).
- `POST /api/routines` — **não incluído**, com a justificativa registrada (§4.1).
- Fechamento dos furos de validação conhecidos, incluindo o caso do id fantasma (§8).
- `api/routines.test.js` com `node --test` (runner embutido no Node 22) — a API não tem suíte hoje.

**Não inclui:**
- **Comportamento do agente** (decisão do usuário, 11/09/2026): quando perguntar ao usuário, o que
  fazer com um treino faltado, qual exercício escolher, o que fazer quando a rotina não existe no
  plano. O servidor recusa o inválido — não escolhe plano.
- UI nova no app: nenhuma tela, botão ou texto novo, exceto o toast do §5.5 (U1) e o contador de
  compatibilidade do §5.7 (invisível para o usuário).
- Micro/meso via app (BACKLOG-02/03), `unit` por exercício (BACKLOG-01), `POST /api/routines`
  (§4.1), operação em lote de várias rotinas numa chamada (§4.2).
- Regra de treino (faixa 6-8 do mesociclo, hierarquia de falha, alta > 10 %): é do portão P1 do lado
  Hermes (`spec_escritor_rotinas.md` §5), **não** do servidor do app. O servidor valida **forma**;
  a política de prescrição fica com quem prescreve.

## Decisões do usuário (produto)

| # | Decisão | Efeito visível |
|---|---|---|
| U1 | **O que você fez no app vence** o que o assistente escreveu (11/09/2026) | Se o app estava aberto com a versão antiga e você mexeu, o app mantém a **sua** versão e mostra um aviso de que descartou a mudança do assistente — que pode ser pedida de novo |
| U2 | A **decisão de treino** do agente fica fora desta spec | O assistente continua conversando com você para decidir; estes documentos só criam as operações e a auditoria dele no servidor |
| U3 | **Publicada a API, o assistente passa a escrever por ela sozinho, na sessão seguinte, sem autorização a cada vez** (11/09/2026) | Você publica uma vez; a próxima sessão do assistente já usa a porta nova (manda só a rotina que muda, em vez do plano inteiro) e o registro no servidor fica completo. A trava para segurar no caminho antigo é `--mode put` (Spec A, U4) |

Consequência de U1 no desenho: o servidor **não** tenta reconciliar rotina contra a vontade do app.
Quando o app é quem está escrevendo e a base dele é velha, o servidor devolve **conflito**; quem
resolve é o cliente, e a política do cliente é preservar o que é dele e **adotar a versão do
servidor para o que veio do agente** — com aviso.

## Decisões assumidas

Decididas por mim por serem detalhe de implementação. Nenhuma muda o que você vê — exceto onde
indicado (marcado **visível**).

- **A1 — `rev` (número) dentro do arquivo de estado, incrementado pelo servidor.** `S.rev` começa em
  `1` na primeira escrita e soma 1 a cada escrita aceita. É **gravado** no arquivo e **injetado**
  nas respostas (`GET /api/data`, `GET /api/routines`, `meta` de toda escrita) como
  `Number.isInteger(S.rev) ? S.rev : 0`. Justificativa: é atomicamente consistente com o arquivo
  (gravação única, `atomicWrite`, `api/server.js:46-50`) e sobrevive a restart sem estado paralelo.
  **Visível:** nada na tela; muda o corpo das respostas.
- **A2 — `If-Match` forte (igualdade), não "não é mais velho".** Nos endpoints novos é
  **obrigatório** (`428` se ausente). No `PUT /api/data`, quando o cliente envia um `rev`, a
  comparação é por igualdade; quando não envia (cliente antigo), mantém-se o guard por `_ts` que
  existe hoje (`api/server.js:446-448`). Nenhum caminho fica sem guarda; `parseIfMatch` é a **única**
  função que interpreta o header (§4.9).
- **A3 — `rev: 0` é estado válido e não é gravado.** "Arquivo nunca escrito pela Spec B" e
  `rev: 0` são o mesmo estado; o campo só aparece no arquivo depois da primeira escrita. Evita
  reescrever 300 treinos só para semear um contador. Como `GET /api/data` **injeta** o `rev` (§4.7),
  o cliente tem base para `If-Match: "0"` desde o primeiro boot — sem depender de o campo estar no
  arquivo.
- **A4 — A identidade é atribuição, e a spec diz exatamente o quanto ela vale.** O agente já lê o
  `SECRET` (premissa do `og_state_mutation.md`); uma chave separada **não** aumentaria o poder dele.
  O que esta spec compra: (a) toda escrita passa a **declarar** quem é; (b) com assinatura, a
  atribuição é **verificada** (`verified: "signature"`); (c) sem assinatura, ela é uma **alegação
  não verificada** (`verified: "claimed"`) e o log diz isso — a auditoria **não** afirma identidade
  que não pode provar, e quem tem a sessão pode alegar qualquer nome. O aceite da BACKLOG-07:92
  ("o log do servidor mostra **qual agente** escreveu o quê") é atendido no sentido operacional
  (dá para ver a sequência e distinguir máquina de navegador), **não** no sentido criptográfico.
- **A5 — Chave do agente derivada, em `/data/agent.key` (modo 600).** O servidor cria no boot se não
  existir **ou se o conteúdo não for 64 hex** (arquivo vazio/corrompido é regenerado; leitura
  ilegível vira `400 BAD_ACTOR_SIG`, nunca `500`): `agent_key = HMAC_SHA256(key=SECRET,
  msg="opengym-agent-v1")`. O arquivo guarda o **derivado**, não o `SECRET`. Trocar o `SECRET`
  invalida a chave **e a regenera** na próxima leitura (a checagem de formato não sabe distinguir
  "chave da era anterior" de "lixo", então regenera e o agente reassina — efeito: uma janela de um
  request com `400`, registrada no log).
- **A6 — Sem sessão nova, sem token de máquina separado.** A autenticação continua sendo o cookie
  HMAC (`api/server.js:194-212`); o cabeçalho de ator é **camada** de atribuição, não uma segunda
  autenticação. Menos superfície, menos coisa para o agente guardar.
- **A7 — Não existe `If-Match-State`.** Confirmado por varredura: **9 ocorrências, todas em texto**
  (`docs/specs/spec_micro_meso_via_app.md`, `docs/specs/spec_micro_via_app_v5.md`,
  `docs/backlog.md`), **zero em `frontend/src`** e zero em `api/server.js`. O header real do cliente
  novo é o padrão `If-Match` (que também não existe hoje). **Decisão:** remover o `If-Match-State` do
  desenho e corrigir as três menções do `BACKLOG-02`. Atende literalmente o aceite da BACKLOG-09:131
  ("decisão registrada sobre o `If-Match-State`").
- **A8 — `POST /api/routines` fica fora** (§4.1) e **operação em lote fica fora** (§4.2), com o
  motivo escrito.
- **A9 — Auditoria em `/data/audit.jsonl`** (append-only, fora do arquivo de estado para não inflar
  o payload do PWA), com **hash-chain** (`prev` = sha256 da linha anterior) e `GET /api/audit`.
  **O que a cadeia prova e o que não prova:** prova que uma linha **do meio** foi alterada (o `h`
  deixa de casar com o `prev` da seguinte); **não** prova contra truncamento ou remoção do fim, e a
  rotação (5.000 linhas) quebra a cadeia por construção — por isso `GET /api/audit` devolve
  `chainIntact: false` quando a primeira linha lida tem `prev` não-nulo (sinal de que houve corte),
  em vez de fingir integridade. Truncar o arquivo exige escrita em `/data`, que hoje é root-only.
- **A10 — O log também vai para o `stdout` do container** numa linha única e grepável
  (`[og-routine] op=patch uid=… actor=… verified=… rev=3→4`), porque é isso que
  `docker logs opengym-api-1` mostra sem abrir arquivo.
- **A11 — `DELETE` responde `200` com corpo**, não `204`: um `204` sem corpo custaria um `GET` extra
  ao cliente e ao script só para saber a nova revisão.
- **A12 — O catálogo é carregado uma vez, no boot, com falha alta.** `api/exercise_catalog.json`
  (array de 1324 objetos `{id,name,bp,eq,tg,img,gif}` — estrutura verificada) é lido no início; se
  não existir ou não parsear, o servidor **registra erro e sobe** sem validação de catálogo,
  respondendo `503 CATALOG_UNAVAILABLE` em toda escrita de rotina. Preferível a derrubar a API
  inteira: o `PUT /api/data` (e portanto o app) continua vivo.
- **A13 — Legado tolerado, com regra explícita.** O estado real tem `"mode":"normal"` em **todas**
  as entradas de template e `"sg": 0` nos pares `0585`/`0599` de Legs 1 e Legs 2 (medido em
  11/09/2026). Regra do validador: `mode`/`sg` são aceitos **no valor que já está no item**
  (`legacyOk`) e recusados como valor novo; `mode:"normal"` é lido como `reps` por `modeOf`
  (`frontend/src/lib/history.js:14-18`). O servidor **não** normaliza nada em silêncio. `prog`
  ausente ≠ `prog:"off"` no arquivo: o editor grava `'off'` explicitamente
  (`RoutineEdit.jsx:93`, sem condicional) e o estado real tem `prog:"off"` em 5 de 6 rotinas — o
  `PATCH` grava o que vier declarado, **inclusive `'off'`**.
- **A14 — O servidor valida forma, não política.** Faixa de reps é aceita em qualquer par `A ≤ B`
  dentro de 1..100 (não só `6-8`), porque `6-8` é regra do **mesociclo** (`MECANICA_PESOS.md:14`),
  não do app. Quem recusa `10-12` é o portão P1 do lado Hermes
  (`verificar_prescricao.py:94-97`), que também aceita faixa decimal — **os dois conjuntos não são
  idênticos e a spec não finge que são** (ver "Relação com a outra spec").
- **A15 — Nenhuma migração de dados.** O estado ganha `rev` na primeira escrita e nada mais muda
  de forma; `workouts[]`, `exWeights`, `week`, `dayPlan` ficam intactos.
- **A16 — Um arquivo novo para não inchar o `server.js`:** `api/routines.js` (validação, merge,
  limpeza, auditoria) — e o `api/Dockerfile` **precisa** copiá-lo (§4.11), senão a API não sobe.
- **A17 — Sem rate limiting novo.** O app não tem rate limit por decisão de projeto (é papel do
  proxy, comentário em `api/server.js:581-584`).
- **A18 — `PATCH` não apaga `S.active`.** O `PUT` apaga (regra de hoje, `api/server.js:449`:
  treino em andamento é local do aparelho) e o `DELETE` recusa com `409` quando a rotina apagada é a
  do treino em andamento (RF-12). O `PATCH` **preserva** `S.active`: ajustar o peso de uma rotina
  durante o treino é uso legítimo e não pode derrubar a sessão do aparelho (achado F-21 da revisão).
- **A19 — Replay de assinatura dentro da janela de 300 s é aceito por desenho — no `PUT /api/data`.** Lá uma repetição passaria pelo guard de `_ts` (igual, não menor) e reescreveria o mesmo estado. Nos endpoints de rotina o replay não muda nada depois da primeira aplicação: o `rev` mudou, então o `If-Match` da assinatura capturada devolve `409`. Não há nonce nem
  memória de `(actor, t)`: a assinatura prova *quem* montou o request, não *quantas vezes* ele pode
  ser usado. Consequência prática: quem capturar a assinatura pode repetir a operação por 5 minutos
  (e a operação repetida vai esbarrar no `If-Match`, porque o `rev` mudou na primeira). Está aqui
  para não virar surpresa.

## Requisitos Funcionais

- **RF-1.** `PATCH /api/routines/<rid>` altera **apenas** a rotina `<rid>`; toda outra rotina, e
  todo campo não citado no payload, permanece **byte a byte** igual. `ex` é merge por id (campos
  citados substituem; id novo entra no fim), `exRemove` remove explicitamente, e **omitir nunca
  apaga**.
- **RF-2.** `DELETE /api/routines/<rid>` remove a rotina, remove `<rid>` de `S.week` (todas as
  chaves) e de `S.dayPlan` (todas as datas), e **não toca** em `S.workouts[]` — nem para remover a
  referência `routineId` do histórico.
- **RF-3.** Toda escrita de rotina é **validada campo a campo** antes de gravar (§4.3). Campo
  inválido ⇒ `400` com `{error, code, field, allowed?}` e **nada** é gravado (sem escrita parcial).
  A **mesma** função de validação roda no `PUT /api/data`, com uma diferença de modo: lá ela é
  **fail-open para o legado** (§4.3.3), aqui é fail-closed.
- **RF-4.** Todo `ex[].id` é conferido contra `api/exercise_catalog.json` **ou** `S.customEx` do
  próprio perfil; fora dos dois ⇒ `400 CATALOG_UNKNOWN_EX` citando o id recusado. Fecha o furo do
  incidente de 08/09/2026.
- **RF-5.** Concorrência por **igualdade**: `If-Match: "<rev>"` obrigatório nos endpoints de rotina
  (`428 IF_MATCH_REQUIRED` se ausente ou string vazia) e comparado com o `rev` efetivo do disco;
  divergência ⇒ `409 STALE_STATE` com `{rev, _ts, etag}` atuais. No `PUT /api/data`, se houver
  `If-Match` válida, ela é comparada por igualdade **em vez** do guard de `_ts`; se não houver,
  mantém-se o guard de hoje. `If-Match: *` significa "não checar" (usado só pelo rollback
  consciente).
- **RF-6.** Toda escrita aceita incrementa `S.rev` em 1 e devolve `meta` com `rev`, `etag` (uuid da
  operação), `actor`, `verified`, `stateHash` (sha256 do JSON canônico gravado) e `beforeHash` —
  para o lado Hermes fechar o recibo sem uma segunda leitura.
- **RF-7.** Toda escrita de rotina passa a ser **atribuível**: o `X-OG-Actor` é registrado no
  `audit.jsonl` e no `stdout`, com o campo `verified` dizendo se a atribuição foi assinada. Sem o
  cabeçalho, o servidor **recusa** escrita de rotina (`400 ACTOR_REQUIRED`); o `PUT /api/data` sem
  cabeçalho continua aceito (o app antigo não manda nada) e é auditado como `actor:"pwa-legacy"`,
  `verified:"none"`.
- **RF-8.** `GET /api/audit?limit=N` (1..500, default 50) devolve as últimas N operações em ordem
  **decrescente**, com `otp`, `actor`, `verified`, `action`, `uid`, `routines` tocadas, `rev`
  antes/depois, `stateHash` antes/depois e `chainIntact`. O dono do estado vê o dele; admin vê
  qualquer `uid` (`?uid=`), filtrando sempre por `rec.uid`.
- **RF-9.** `GET /api/routines` devolve `{routines: [{id, name, emoji, prog, exCount, setsTotal}],
  rev, _ts, etag}` — leve, sem `workouts`, para o agente montar a intenção e o `If-Match` sem baixar
  o estado completo.
- **RF-10.** `PUT /api/data` **mantém** o comportamento atual para cliente antigo (sem cabeçalho de
  ator, sem `If-Match`): guard por `_ts` (`api/server.js:446-448`), `checkState` atual (`:56-72`),
  `active` removido (`:449`) e `{ok:true, ts}` (`:451`) — com `rev` **acrescentado** na resposta.
  Cliente antigo **não passa a quebrar**.
- **RF-11.** A validação do `PUT /api/data` **endurece sem rejeitar o que o app já produz**: as
  regras novas de §4.3 são aplicadas por item de `routines[].ex[]`, com `400` só para valores que o
  app nunca gera (`weight` não numérico, `sets` < 1, `reps` inválido, `id` fora do
  catálogo/custom). Estado legado tolerado (A13) **não** é motivo de `400`, e o `PUT` **não** recusa
  por campo que ele não está alterando (§4.3.3).
- **RF-12.** Se a rotina apagada (`DELETE`) estiver referenciada em `S.active` (treino em andamento
  no aparelho), a operação é recusada com `409 ROUTINE_IN_USE` trazendo `active.id`; com `?force=1`,
  apaga e remove a referência. O campo existe e foi verificado: `s.active = { id, d, start,
  routineId, name, bw, cur, entries }` (`frontend/src/sheets.jsx:841`), e a UI já o lê em
  `Workout.jsx:64,172,374`. Motivo da guarda: hoje `active` é removido de todo `PUT`
  (`api/server.js:449`), então um agente escrevendo durante o treino já pode quebrar a sessão em
  andamento sem aviso.
- **RF-13.** `DELETE` com treinos que apontam para a rotina **preserva** `routineId` no histórico:
  histórico é registro, não ponteiro. O `meta` informa `weekCleaned`, `dayPlanCleaned` e
  `orphanWorkouts` (quantos treinos citam a rotina apagada).
- **RF-14.** Nenhuma resposta de erro devolve o estado inteiro nem o `SECRET`; mensagens citam campo
  e valor recebido, nunca conteúdo de outros perfis.

## Detalhe de Implementação (nível código)

### 4.1 `POST /api/routines` — **não entra nesta entrega** (justificativa)

O critério do usuário: *"incluir só se valer o custo"*. Não vale, hoje, por três razões concretas:

1. **É a operação que menos dói.** O app cria rotina pelo editor (grava via `update()`, que passa
   pelo `PUT` de estado) e o agente cria pelo payload do próprio `PUT` (a receita de 29/08/2026
   criou 3 rotinas assim, `og_state_mutation.md:48-55`). Ninguém está travado. As operações que
   **doem** são editar e apagar **uma** rotina, porque exigem montar o estado inteiro.
2. **O custo não é a validação — é o resto.** Um `POST` implicaria: geração de `id` no servidor
   (hoje `uid()` existe no cliente e os ids do agente são determinísticos,
   `docs/backlog.md:28`), semântica de "rotina nova entra no `week`?" (hoje ninguém põe, `week` é do
   usuário), idempotência (uma retentativa de rede criaria duas rotinas) e **mais uma** forma de
   escrever rotina para auditar e testar.
3. **Criação tem caminho que já existe:** `exRemove`/`patch` cobrem edição; criação continua no
   `PUT` de estado até que exista motivo medido para o `POST`.

Fica registrado como **próximo passo natural da BACKLOG-02** (que cria 3–5 rotinas por semana):
quando o micro/meso via app for implementado, a criação em lote vira o caminho quente e o `POST`
(ou um `PUT /api/routines` em lote) se paga. Esboço para não redescobrir depois: `POST
/api/routines` com `{routine, idempotencyKey, slot?}` → `201 {routine, rev, meta}`,
`Idempotency-Key` obrigatório (janela de 24 h em memória), `id` gerado pelo servidor quando ausente
(`r_<slug>_<base36>`), recusa se `id` já existir (`409 ROUTINE_EXISTS`), e **nunca** mexe em
`week`/`dayPlan`.

### 4.2 Operação em lote (várias rotinas em 1 chamada) — **recusada**

O `PATCH` é por rotina, de propósito. Uma chamada com N rotinas precisa de semântica de atomicidade
("tudo ou nada") que o armazenamento atual (um arquivo por perfil, `atomicWrite`) **não** oferece de
graça, e o caso real (o agente ajusta 2–3 rotinas por semana) cabe em 2–3 chamadas. O
`spec_escritor_rotinas.md` §4.7 registra a consequência: se a 2ª chamada falhar, o recibo marca
`PARCIAL`.

### 4.3 Validação de campo (o contrato)

**4.3.1 `api/routines.js` — cabeçalho com tudo o que é citado no resto da spec.** Nenhuma destas
funções existe hoje; as que já existem em `server.js` são **exportadas** e reusadas, não
reescritas:

```js
// api/routines.js — operações por rotina: validação de campo, merge por id, limpeza e auditoria.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// --- vem de server.js (exportado lá, importado aqui) ---
//   readSession(req) -> user|null      readState(uid) -> S|null      stateFile(uid) -> path
//   readRawBody(req) -> Promise<string>        (o par readBody/readRawBody vive em server.js)
//   atomicWrite(file, content)         DATA (diretório)   SECRET
//   (json() e o `res` ficam com o server: routines.js devolve {code, body})
// --- nasce aqui ---
export const PROG_ALLOWED = ['off', 'linear', 'greyskull', 'double', 'time'];
export const MODE_ALLOWED = ['reps', 'time', 'cardio'];
const MODE_LEGACY = ['normal'];            // escrito por versao anterior do agente; modeOf le como reps
const REP_RANGE = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/;
const MAX_SETS = 20, MAX_WEIGHT = 1000, MAX_REPS = 100, MAX_SEC = 3600;

export function canon(S)              // JSON canônico: JSON.stringify com chaves ordenadas
export function sha256(str)            // hex de 64
export function stateMeta(S)          // { rev: Number.isInteger(S.rev) ? S.rev : 0, _ts: S._ts || null, etag: crypto.randomUUID() }
export function parseIfMatch(h)       // -> null (ausente/vazio) | '*' | string sem aspas
export function loadCatalog(dir)       // -> Map(id -> {name, eq}) | null (A12)
export function defaultExFields(eid, mode, eq)   // reproduz defaultConfig (history.js:121-129)
export function validateExEntry(e, opt)          // -> null | {code, field, message, allowed?}
export function validateRoutineBody(body, cur)   // regras de rotina (name/emoji/prog) -> null | erro
export function mergeRoutine(cur, body, catalog, customIds)  // -> null | erro  (muta `cur`)
export function sweepRoutineRefs(S, rid)         // -> {weekCleaned, dayPlanCleaned, orphanWorkouts}
export function cleanupSg(ex)                    // porta de history.js:145-149 (4 linhas, pura)
export function stripCrossModeFields(e, mode)    // espelha exConfigSheet (sheets.jsx:512-523)
export function appendAudit(rec)                 // /data/audit.jsonl + hash-chain + rotação
export function readAudit(uidFilter, limit)      // -> {entries, chainIntact}   (filtro por rec.uid)
export function withState(uid, ctx, fn)          // escrita única + auditoria (ver 4.6)
```

**4.3.2 Validador de exercício, com os ramos de tolerância (F-05/F-11 da revisão):**

```js
const num = v => typeof v === 'number' && Number.isFinite(v);   // bool NÃO é número

/**
 * opt = { catalog: Map, custom: Set, where: 'ex.0326', legacy: {mode, sg}, modeChanged: bool }
 * Devolve null (ok) ou {code, field, message, allowed?} — nunca grava nada.
 */
export function validateExEntry(e, opt) {
  const { catalog, custom, where = 'ex' } = opt;
  const lg = opt.legacy || {};
  const bad = (code, field, message, allowed) => ({ code, field: `${where}.${field}`, message, allowed });
  if (!e || typeof e !== 'object' || Array.isArray(e)) return bad('BAD_EX', 'ex', 'ex entry must be an object');
  if (typeof e.id !== 'string' || !e.id) return bad('EX_ID_REQUIRED', 'id', 'ex.id required');
  if (!catalog.has(e.id) && !custom.has(e.id)) {
    return bad('CATALOG_UNKNOWN_EX', 'id',
      `unknown exercise id "${e.id}" — not in exercise_catalog.json nor in this profile's customEx`);
  }
  if (!(Number.isInteger(e.sets) && e.sets >= 1 && e.sets <= MAX_SETS)) {
    return bad('BAD_SETS', 'sets', `sets must be an integer 1..${MAX_SETS}`, [1, MAX_SETS]);
  }
  // mode: validos os 3 do app; 'normal' SO no valor que ja estava no item (A13).
  // A tolerancia vale tambem para item NOVO no estado em disco (lg.mode === undefined): o que ela
  // proibe e INTRODUZIR o valor legado, nao carregar um que ja existe (N03 da revisao 2 — sem
  // isto, `sg:0` era recusado no PUT porque `undefined === 0` e falso).
  const notIntroduced = (v, lgv) => lgv === undefined || v === lgv;
  if (e.mode !== undefined && !MODE_ALLOWED.includes(e.mode)) {
    const legacySame = MODE_LEGACY.includes(e.mode) && e.mode === lg.mode;
    if (!legacySame) {
      return bad('BAD_MODE', 'mode', `mode must be one of ${MODE_ALLOWED.join('|')}`
        + (MODE_LEGACY.includes(e.mode) ? ' ("normal" is legacy: only where it already is)' : ''));
    }
  }
  if (e.weight !== undefined && !(num(e.weight) && e.weight >= 0 && e.weight <= MAX_WEIGHT)) {
    return bad('BAD_WEIGHT', 'weight', `weight must be a number 0..${MAX_WEIGHT}`);
  }
  if (e.reps !== undefined) {
    const okNum = Number.isInteger(e.reps) && e.reps >= 1 && e.reps <= MAX_REPS;
    const m = typeof e.reps === 'string' ? REP_RANGE.exec(e.reps) : null;
    const okRange = m && +m[1] >= 1 && +m[1] <= +m[2] && +m[2] <= MAX_REPS;
    if (!okNum && !okRange) return bad('BAD_REPS', 'reps', `reps must be an integer 1..${MAX_REPS} or a range "A-B" (A<=B)`);
  }
  if (e.sec !== undefined && !(Number.isInteger(e.sec) && e.sec >= 1 && e.sec <= MAX_SEC)) {
    return bad('BAD_SEC', 'sec', `sec must be an integer 1..${MAX_SEC}`);
  }
  if (e.min !== undefined && !(Number.isInteger(e.min) && e.min >= 1 && e.min <= 600)) {
    return bad('BAD_MIN', 'min', 'min must be an integer 1..600');
  }
  if (e.speed !== undefined && !(num(e.speed) && e.speed >= 0 && e.speed <= 40)) {
    return bad('BAD_SPEED', 'speed', 'speed must be a number 0..40');
  }
  for (const f of ['bodyweight', 'side']) {
    if (e[f] !== undefined && typeof e[f] !== 'boolean') return bad('BAD_FLAG', f, `${f} must be a boolean`);
  }
  if (e.inc !== undefined && !(num(e.inc) && e.inc >= 0)) return bad('BAD_FIELD', 'inc', 'inc must be a number >= 0');
  for (const f of ['repsMin', 'repsMax']) {
    if (e[f] !== undefined && !(Number.isInteger(e[f]) && e[f] >= 1)) return bad('BAD_FIELD', f, `${f} must be an integer >= 1`);
  }
  if (e.prog !== undefined && !PROG_ALLOWED.includes(e.prog)) {
    return bad('BAD_PROG', 'prog', `prog must be one of ${PROG_ALLOWED.join('|')}`, PROG_ALLOWED);
  }
  if (e.sg !== undefined) {
    const legacySame = (e.sg === 0 || e.sg === '') && notIntroduced(e.sg, lg.sg);   // sg:0 do estado real (A13)
    if (!legacySame && !(typeof e.sg === 'string' && e.sg)) {
      return bad('BAD_SG', 'sg', 'sg must be a non-empty string (0/"" are legacy: only where they already are)');
    }
  }
  if (e.restSec !== undefined && !(Number.isInteger(e.restSec) && e.restSec >= 30 && e.restSec <= 300)) {
    return bad('BAD_REST', 'restSec', 'restSec must be an integer 30..300');   // = isValidRest, useStore.js:19
  }
  // Consistência de modo. A regra só cobra o campo quando o modo está sendo CRIADO ou TROCADO
  // (`opt.modeChanged`): um template antigo sem `sec` (plan-share.js:30 só carrega sec se existir)
  // tem de continuar passando pelo PUT, senão o endurecimento quebra o app publicado (RF-11).
  const mode = e.mode === 'normal' ? 'reps' : (e.mode || 'reps');
  if (mode === 'time' && opt.modeChanged && e.sec === undefined) {
    return bad('MODE_TIME_NO_SEC', 'sec', 'mode "time" requires sec');
  }
  if (mode === 'cardio' && opt.modeChanged && (e.min === undefined || e.speed === undefined)) {
    return bad('MODE_CARDIO_INCOMPLETE', 'min', 'mode "cardio" requires min and speed');
  }
  if (e.side === true && mode === 'time') return bad('SIDE_ON_TIME', 'side', 'side only applies to reps work');
  return null;
}
```

**4.3.3 Modo de falha diferente no `PUT` (F-05 da revisão).** O `PUT` recebe o estado inteiro de um
cliente que pode estar com legado; ele **não** pode recusar o que já está lá. Por isso a mesma
função roda com `legacy` preenchido **a partir do estado em disco** (o `mode`/`sg` que já estão
naquele item) e com `modeChanged` calculado item a item:

```js
// server.js — a MESMA regra do PATCH, com o "antes" vindo do disco. Extraída em função nomeada
// porque o PUT precisa dela: sem isto, o primeiro sync do PWA publicado toma 400 BAD_MODE
// (o estado real tem mode:"normal" em 100% dos templates).
function checkRoutineFields(state, cur) {
  const catalog = routines.loadCatalog(DATA);              // A12; null = sem catálogo
  if (!catalog) return null;                               // A12: sem catálogo, o PUT segue (o app não pode parar)
  // customEx: UNIÃO do que está no disco com o que veio no payload. Usar só o payload faria o
  // cliente que manda customEx reduzido perder o direito de citar os próprios exercícios.
  const custom = new Set([...(cur?.customEx || []), ...(state.customEx || [])].map(c => c.id));
  for (const r of state.routines || []) {
    const before = (cur?.routines || []).find(x => x.id === r.id) || {};
    for (const e of r.ex || []) {
      const b = (before.ex || []).find(x => x.id === e.id) || {};
      const bad = routines.validateExEntry(e, {
        catalog, custom, where: `ex.${e.id}`,
        legacy: { mode: b.mode, sg: b.sg },
        modeChanged: (e.mode ?? b.mode) !== b.mode
      });
      if (bad) return bad;
    }
  }
  return null;
}
```

### 4.4 Identidade do agente (atribuição, com o alcance declarado)

**Cabeçalhos aceitos:**

```
X-OG-Actor: agent=hermes; tool=opengym_writer; run=20260911-140200; intent=sha256:4f9c1a7e
X-OG-Actor-Sig: t=1789135321; v1=<hex(hmac_sha256(agent_key, canon))>       (opcional hoje)
```

```
canon = `${t}\n${method}\n${pathname}\n${uid}\n${sha256_hex(rawBody)}`
```

| situação | `actor` gravado | `verified` |
|---|---|---|
| `X-OG-Actor` + `X-OG-Actor-Sig` válidos, `\|now-t\| ≤ 300 s` | o nome alegado | `signature` (**verificado**) |
| `X-OG-Actor` sem assinatura (o caso de hoje: `/data/agent.key` ainda não existe) | o nome alegado | `claimed` (**alegação não verificada** — qualquer portador da sessão pode alegar) |
| assinatura inválida / expirada / corpo mudou | — | **`400 BAD_ACTOR_SIG`** (não grava) |
| `X-OG-Actor` ausente em rota de rotina | — | **`400 ACTOR_REQUIRED`** |
| `X-OG-Actor` ausente em `PUT /api/data` (app antigo) | `pwa-legacy` | `none` |
| `X-OG-Actor` com nome absurdo (`agent=` vazio, >40 chars) | `unknown` | `claimed` |

```js
// server.js — fora do roteador, junto de readSession
function agentKey() {                        // A5: derivada, em /data/agent.key (600)
  const f = path.join(DATA, 'agent.key');
  const valid = s => /^[0-9a-f]{64}$/.test(s || '');
  let cur = null;
  try { cur = fs.readFileSync(f, 'utf8').trim(); } catch { /* ausente ou ilegivel */ }
  if (!valid(cur)) {                         // ausente, vazio, corrompido ou de outra era: regenera
    const k = crypto.createHmac('sha256', SECRET).update('opengym-agent-v1').digest('hex');
    try { fs.writeFileSync(f, k, { mode: 0o600 }); } catch (e) { console.error('agent.key write failed', e.message); }
    return k;
  }
  return cur;
}
function readActor(req, uid, rawBody, method, pathname) {
  const raw = (req.headers['x-og-actor'] || '').toString().trim();
  const sig = (req.headers['x-og-actor-sig'] || '').toString().trim();
  if (!raw) return { actor: null, verified: 'none' };
  const m = /(?:^|;\s*)agent=([^;]{1,40})/.exec(raw);
  const actor = m && m[1].trim() ? m[1].trim() : 'unknown';
  if (!sig) return { actor, verified: 'claimed', header: raw };
  const s = /(?:^|;\s*)t=(\d{1,15});\s*v1=([0-9a-f]{64})/.exec(sig);
  if (!s) return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' };
  const t = +s[1];
  if (Math.abs(Date.now() / 1000 - t) > 300) return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' };
  let expect;
  try {
    const bodyHash = crypto.createHash('sha256').update(rawBody || Buffer.alloc(0)).digest('hex');
    expect = crypto.createHmac('sha256', agentKey()).update(`${t}\n${method}\n${pathname}\n${uid}\n${bodyHash}`).digest('hex');
  } catch (e) { console.error('agent key unavailable', e.message); return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' }; }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(s[2], 'hex'), Buffer.from(expect, 'hex'))) {
      return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' };
    }
  } catch { return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' } }
  return { actor, verified: 'signature', header: raw };
}
```

> **A4 aplicado em código:** sem assinatura o log grava `"verified":"claimed"` — a auditoria **não**
> afirma identidade que não pode provar. A frase "a assinatura inviabiliza a alegação casual" só vale
> para o caso **assinado**; hoje (sem `/data/agent.key`) o que existe é declaração, e o valor dela é
> operacional (distinguir máquina de navegador na sequência do log), não probatório.

### 4.5 Roteador por padrão (`/api/routines/:id`)

```js
// ANTES (604-608)
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res); }

// DEPOIS
// Path patterns first (they carry :params, which the exact table cannot), keeping the exact table
// that every existing route keeps using. url.pathname has no querystring, which is how the
// existing `?id=` routes already work (GET /api/admin/user reads url.searchParams at :542).
function matchRoute(method, pathname) {
  for (const p of PATTERNS) {
    if (p.method !== method) continue;
    const m = p.re.exec(pathname);
    if (m) return { handler: p.handler, params: m.slice(1) };
  }
  const h = routes[method + ' ' + pathname];
  return h ? { handler: h, params: [] } : null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;          // usado SÓ pelo catch abaixo
  const hit = matchRoute(req.method, url.pathname);
  if (!hit) return json(res, 404, { error: 'not found' });
  try { await hit.handler(req, res, hit.params); }
  catch (e) { console.error(key, e); if (!res.headersSent) json(res, 500, { error: 'server error' }); }
```

```js
// NOVO — antes de `const routes = {`
const PATTERNS = [
  { method: 'PATCH',  re: /^\/api\/routines\/([A-Za-z0-9_-]{1,64})$/, handler: routines.patch },
  { method: 'DELETE', re: /^\/api\/routines\/([A-Za-z0-9_-]{1,64})$/, handler: routines.remove }
];

// NOVO — dentro de `routes`
'GET /api/routines': routines.list,
'GET /api/audit': routines.audit,
```

O `catch` continua logando a mesma string de antes (`req.method + ' ' + url.pathname`), e o `key`
deixa de ser a chave de despacho — está escrito no comentário para o próximo leitor não achar que é
variável morta.

### 4.6 Os handlers: `api/routines.js`

**Núcleo comum de escrita** — uma só função, usada pelas três pontas, **propagando o `_meta` do
handler** (F-02 da revisão):

```js
/**
 * Lê o estado, aplica `fn(S, ctx)`, valida o resultado, grava UMA vez e audita.
 * fn devolve: null = ok | {error, code, code_http?, field?, allowed?} = recusa |
 *             {_meta: {...}} = ok com informação extra (o DELETE usa para contar a limpeza)
 * options: { ifMatch, actor, action, uid, dropActive: bool }
 * Devolve { code, body } — nunca grava em caso de erro.
 */
export function withState(uid, { ifMatch, actor, action, req, rawBody, method, pathname, dropActive }, fn) {
  const file = stateFile(uid);
  let S = null;
  try { S = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { S = null; }
  if (!S || typeof S !== 'object') return { code: 409, body: { error: 'no state for this profile', code: 'NO_STATE' } };
  const cur = stateMeta(S);                                  // rev efetiva = S.rev || 0
  if (ifMatch === 'BAD') return { code: 400, body: { error: 'malformed If-Match', code: 'IF_MATCH_MALFORMED' } };
  if (ifMatch === null) return { code: 428, body: { error: 'If-Match required', code: 'IF_MATCH_REQUIRED', rev: cur.rev } };
  if (ifMatch !== '*' && ifMatch !== String(cur.rev)) {
    return { code: 409, body: { error: 'stale base', code: 'STALE_STATE', rev: cur.rev, _ts: cur._ts, etag: cur.etag } };
  }
  const beforeHash = sha256(canon(S));
  // Uma cópia de trabalho: `fn` muta à vontade, e o que é gravado é só o resultado de um `fn` que
  // terminou sem erro. Assim o "nunca grava em caso de erro" é construção, não sorte (N04 da
  // revisão 2: `mergeRoutine` já fez `splice` antes de descobrir um erro em outro item).
  const work = JSON.parse(JSON.stringify(S));
  let out;
  try { out = fn(work, { cur, actor, uid, req }); }
  catch (e) { console.error('withState fn threw', action, e); return { code: 500, body: { error: 'server error' } }; }
  if (out && out.error) return { code: out.code_http || 400, body: { ...out, field: out.field || null } };
  S = work;
  S.rev = cur.rev + 1;
  S._ts = Date.now();
  if (dropActive) delete S.active;                            // A18: so o DELETE (e o PUT, como hoje)
  atomicWrite(file, JSON.stringify(S));
  const meta = {
    rev: S.rev, revBefore: cur.rev, revAfter: S.rev, etag: crypto.randomUUID(),
    actor: actor.actor, verified: actor.verified,
    stateHash: sha256(canon(S)), beforeHash, action, at: new Date().toISOString(),
    ...((out && out._meta) || {})                             // <-- o _meta do handler entra AQUI
  };
  appendAudit({ otp: meta.etag, uid, ...meta });
  console.log(`[og-routine] op=${action} uid=${uid} actor=${actor.actor} verified=${actor.verified} rev=${cur.rev}->${S.rev}`);
  return { code: 200, body: { ok: true, rev: S.rev, meta } };
}
```

**`PATCH` — handler completo:**

```js
export async function patch(req, res, [rid]) {
  const user = readSession(req);
  if (!user) return json(res, 401, { error: 'not signed in' });
  const raw = await readRawBody(req);                       // string crua, para o hash da assinatura
  let body; try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json' }); }
  const actor = readActor(req, user.id, raw, req.method, '/api/routines/' + rid);
  if (actor.err) return json(res, 400, { error: 'actor signature invalid', code: actor.err });
  if (!actor.actor) return json(res, 400, { error: 'X-OG-Actor required on routine writes', code: 'ACTOR_REQUIRED' });
  const catalog = loadCatalog(DATA);                        // A12: carregado no boot, cacheado
  if (!catalog) return json(res, 503, { error: 'exercise catalog unavailable', code: 'CATALOG_UNAVAILABLE' });
  const r = withState(user.id,
    { ifMatch: parseIfMatch(req.headers['if-match']), actor, action: 'patch-routine',
      uid: user.id, req, rawBody: raw, method: req.method, pathname: '/api/routines/' + rid,
      dropActive: false },                                  // A18: PATCH preserva active
    S => {
      const cur = (S.routines || []).find(x => x.id === rid);
      if (!cur) return { error: `routine "${rid}" not found`, code: 'ROUTINE_NOT_FOUND', code_http: 404,
                         routines: (S.routines || []).map(x => x.id) };
      const badR = validateRoutineBody(body);
      if (badR) return badR;
      if (body.name !== undefined) cur.name = String(body.name).trim();
      if (body.emoji !== undefined) cur.emoji = String(body.emoji).slice(0, 32);
      if (body.prog !== undefined) cur.prog = body.prog;     // grava inclusive 'off' (A13)
      const custom = new Set((S.customEx || []).map(c => c.id));
      const out = mergeRoutine(cur, body, catalog, custom);  // ex + exRemove (muta cur.ex)
      if (out) return out;
      cleanupSg(cur.ex);                                     // toda mutação de ex limpa superset órfão
      return { _meta: { routines: [rid] } };
    });
  return json(res, r.code, r.body);
}
```

```js
// mergeRoutine: merge por id sobre o item existente. O que a intenção não cita, não muda.
// Campos do modo anterior são removidos ao TROCAR de modo, como exConfigSheet faz
// (sheets.jsx:513,519 não emitem `reps` ao salvar em `time`, nem `sec` ao salvar em `reps`).
export function mergeRoutine(cur, body, catalog, custom) {
  if (body.exRemove !== undefined) {
    if (!Array.isArray(body.exRemove)) return { error: 'exRemove must be an array', code: 'BAD_EXREMOVE', field: 'exRemove' };
    for (const id of body.exRemove) {
      const i = cur.ex.findIndex(e => e.id === id);
      if (i < 0) return { error: `exRemove: "${id}" is not in routine ${cur.id}`, code: 'EX_NOT_IN_ROUTINE', field: 'exRemove' };
      cur.ex.splice(i, 1);
    }
  }
  if (body.ex === undefined) return null;
  if (!body.ex || typeof body.ex !== 'object' || Array.isArray(body.ex)) {
    return { error: 'ex must be an object keyed by exercise id', code: 'BAD_EX', field: 'ex' };
  }
  for (const [eid, fields] of Object.entries(body.ex)) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return { error: `ex.${eid} must be an object`, code: 'BAD_EX', field: `ex.${eid}` };
    }
    const target = cur.ex.find(e => e.id === eid);
    const meta = catalog.get(eid) || {};
    const declaredMode = fields.mode;
    const mode = declaredMode || (target && target.mode === 'normal' ? 'normal' : null)
                 || target?.mode || (meta.eq === 'cardio' ? 'cardio' : 'reps');
    const base = target ? { ...target } : defaultExFields(eid, mode, meta.eq);
    const merged = stripCrossModeFields({ ...base, ...fields, id: eid }, mode);
    const modeChanged = !target || ((declaredMode ?? target.mode) !== target.mode);
    const bad = validateExEntry(merged, { catalog, custom, where: `ex.${eid}`,
                                          legacy: { mode: target?.mode, sg: target?.sg }, modeChanged });
    if (bad) return { ...bad, error: bad.message };
    if (target) {
      for (const k of Object.keys(target)) if (!(k in merged)) delete target[k];   // troca de modo
      Object.assign(target, merged, { id: eid });
    } else {
      cur.ex.push(merged);
    }
  }
  return null;
}
```

**`DELETE` — handler completo:**

```js
export async function remove(req, res, [rid]) {
  const user = readSession(req);
  if (!user) return json(res, 401, { error: 'not signed in' });
  const raw = await readRawBody(req);
  const actor = readActor(req, user.id, raw, req.method, '/api/routines/' + rid);
  if (actor.err) return json(res, 400, { error: 'actor signature invalid', code: actor.err });
  if (!actor.actor) return json(res, 400, { error: 'X-OG-Actor required on routine writes', code: 'ACTOR_REQUIRED' });
  const force = new URL(req.url, 'http://x').searchParams.get('force') === '1';
  const r = withState(user.id,
    { ifMatch: parseIfMatch(req.headers['if-match']), actor, action: 'delete-routine',
      uid: user.id, req, rawBody: raw, method: req.method, pathname: '/api/routines/' + rid,
      dropActive: true },                                   // única rota nova que limpa active
    S => {
      const i = (S.routines || []).findIndex(x => x.id === rid);
      if (i < 0) return { error: `routine "${rid}" not found`, code: 'ROUTINE_NOT_FOUND', code_http: 404 };
      if (S.active && S.active.routineId === rid && !force) {
        return { error: 'routine is in an in-progress workout on a device', code: 'ROUTINE_IN_USE',
                 code_http: 409, active: S.active.id };   // S.active = {id, d, start, routineId, name, cur, entries} (sheets.jsx:841)
      }
      S.routines.splice(i, 1);
      const swept = sweepRoutineRefs(S, rid);               // week + dayPlan; workouts[] intactos
      return { _meta: { routines: [rid], ...swept } };
    });
  return json(res, r.code, r.body);
}

export function sweepRoutineRefs(S, rid) {
  let weekCleaned = 0, dayPlanCleaned = 0;
  for (const k of Object.keys(S.week || {})) if (S.week[k] === rid) { delete S.week[k]; weekCleaned++; }
  for (const k of Object.keys(S.dayPlan || {})) if (S.dayPlan[k] === rid) { delete S.dayPlan[k]; dayPlanCleaned++; }
  const orphanWorkouts = (S.workouts || []).filter(w => w.routineId === rid).length;   // preservados
  return { weekCleaned, dayPlanCleaned, orphanWorkouts };
}

// cleanupSg — porta 1:1 de frontend/src/lib/history.js:145-149 (função pura, 4 linhas).
export function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg;
  });
}
```

**Códigos de resposta, tabela completa:**

| situação | status | `code` |
|---|---|---|
| ok | `200` | — (`{ok:true, rev, meta}`) |
| corpo inválido / campo inválido | `400` | `BAD_*` (§4.3) |
| falta `X-OG-Actor` | `400` | `ACTOR_REQUIRED` |
| assinatura de ator inválida | `400` | `BAD_ACTOR_SIG` |
| falta `If-Match` (ou `If-Match: ""`) | `428` | `IF_MATCH_REQUIRED` |
| `rev` divergente | `409` | `STALE_STATE` (+ `rev`, `_ts`, `etag`) |
| rotina não existe | `404` | `ROUTINE_NOT_FOUND` |
| rotina em treino ativo, sem `force` | `409` | `ROUTINE_IN_USE` |
| não autenticado | `401` | — (`not signed in`) |
| catálogo indisponível (A12) | `503` | `CATALOG_UNAVAILABLE` |
| sem estado para o perfil | `409` | `NO_STATE` |

### 4.7 `GET /api/data` e `PUT /api/data`

**4.7.1 `GET` passa a injetar `rev`** (sem isso o cliente novo não tem base para o primeiro
`If-Match` — F-07 da revisão):

```js
// ANTES (424-431)
  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

// DEPOIS
  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      if (state && typeof state === 'object') state.rev = Number.isInteger(state.rev) ? state.rev : 0;
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },
```

**4.7.2 `PUT` — guarda por token, com o cliente antigo preservado:**

```js
// ANTES (433-452)
  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    const bad = checkState(body.state);
    if (bad) return json(res, 400, { error: bad });
    // Last-writer-wins guard (2026-09-08 sync incident): reject a base older than
    // what's on disk so a stale full-state push can never silently wipe sessions or
    // templates. Clients merge + retry (web pushState handles 409). Retries of the
    // same payload (equal _ts) pass — the write is idempotent.
    let cur = null;
    try { cur = readState(user.id); } catch { /* first write */ }
    const incoming = body.state._ts || 0;
    if (cur && incoming < (cur._ts || 0))
      return json(res, 409, { error: 'stale base, re-pull and merge', serverTs: cur._ts || 0 });
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

// DEPOIS
  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const raw = await readRawBody(req);          // bytes crus: o hash do ator precisa deles
    let body; try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json' }); }
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    const bad = checkState(body.state);
    if (bad) return json(res, 400, { error: bad });
    let cur = null;                              // lido ANTES da validacao: checkRoutineFields precisa do "antes"
    try { cur = readState(user.id); } catch { /* first write */ }
    const badEx = checkRoutineFields(body.state, cur);        // §4.3.3
    if (badEx) return json(res, 400, { error: badEx.message, code: badEx.code, field: badEx.field, allowed: badEx.allowed || null });
    const actor = readActor(req, user.id, raw, req.method, '/api/data');
    if (actor.err) return json(res, 400, { error: 'actor signature invalid', code: actor.err });
    const curRev = (cur && Number.isInteger(cur.rev)) ? cur.rev : 0;
    const ifMatch = parseIfMatch(req.headers['if-match']);
    // Strong token when the client sends one; the _ts clock guard otherwise, exactly as
    // before, so a published PWA that knows nothing about `rev` keeps working.
    if (ifMatch !== null && ifMatch !== '*') {
      if (ifMatch !== String(curRev))
        return json(res, 409, { error: 'stale base, re-pull and merge', code: 'STALE_STATE', rev: curRev, serverTs: cur?._ts || 0 });
    } else {
      const incoming = body.state._ts || 0;
      if (cur && incoming < (cur._ts || 0))
        return json(res, 409, { error: 'stale base, re-pull and merge', serverTs: cur._ts || 0, rev: curRev });
    }
    body.state.rev = curRev + 1;                 // A1: o servidor é quem conta
    body.state._ts = body.state._ts || Date.now();
    delete body.state.active;                    // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    const meta = { rev: body.state.rev, etag: crypto.randomUUID(),
                   actor: actor.actor || 'pwa-legacy', verified: actor.actor ? actor.verified : 'none',
                   stateHash: sha256(canon(body.state)), beforeHash: cur ? sha256(canon(cur)) : null,
                   action: 'put-state', at: new Date().toISOString() };
    appendAudit({ otp: meta.etag, uid: user.id, ...meta });
    console.log(`[og-state] op=put uid=${user.id} actor=${meta.actor} verified=${meta.verified} rev=${curRev}->${meta.rev}`);
    json(res, 200, { ok: true, ts: body.state._ts, rev: meta.rev, meta });
  },
```

> `checkRoutineFields` é o bloco de §4.3.3, extraído em função para o `PUT` ficar legível; ele lê
> `cur` — por isso o handler lê o estado antes de chamá-lo.

**4.7.3 `readRawBody` / `readBody`** (a spec mostra as duas, porque o `readBody` de hoje é usado por
**11 rotas** — `server.js:317,336,380,436,459,471,488,505,558,579,594`; e porque `readRawBody` passa
a ser **exportada** para `api/routines.js`):

```js
// NOVO — divide o helper que hoje faz as duas coisas (server.js:246-260).
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readBody(req) {                    // assinatura e comportamento de hoje: objeto
  const raw = await readRawBody(req);
  try { return raw.length ? JSON.parse(raw) : {}; }
  catch { throw new Error('bad json'); }          // mesma mensagem de api/server.js:256
}
```

As 11 rotas continuam chamando `await readBody(req)` sem mudança. Só `PUT /api/data` e as rotas de
rotina usam `readRawBody` (exportada de `server.js`; `canon`/`sha256` são importadas de
`routines.js` pelo `server.js` — os dois exports estão declarados em §4.3.1).

### 4.8 `GET /api/routines` e `GET /api/audit`

```js
export async function list(req, res) {
  const user = readSession(req);
  if (!user) return json(res, 401, { error: 'not signed in' });
  const S = readState(user.id);
  // 404 (e não 200 com lista vazia) quando o perfil não tem estado: a Spec A liga o modo `patch`
  // ao receber 200 daqui (A7) — responder 200 faria o agente escolher o canal novo para depois
  // bater em `409 NO_STATE` no primeiro PATCH (N/R2-08 da revisão 2).
  if (!S || typeof S !== 'object') return json(res, 404, { error: 'no state for this profile', code: 'NO_STATE' });
  const routines = (S.routines || []).map(r => ({
    id: r.id, name: r.name || null, emoji: r.emoji || null, prog: r.prog || null,
    exCount: (r.ex || []).length, setsTotal: (r.ex || []).reduce((n, e) => n + (Number(e.sets) || 0), 0)
  }));
  const m = stateMeta(S);
  json(res, 200, { routines, rev: m.rev, _ts: m._ts, etag: m.etag });
}

export async function audit(req, res) {
  const user = readSession(req);
  if (!user) return json(res, 401, { error: 'not signed in' });
  const q = new URL(req.url, 'http://x').searchParams;
  const want = q.get('uid');
  const isAdmin = !!user.admin;
  if (want && want !== user.id && !isAdmin) return json(res, 403, { error: 'forbidden' });
  const limit = Math.max(1, Math.min(500, +(q.get('limit') || 50)));
  json(res, 200, readAudit(want && isAdmin ? want : user.id, limit));   // { entries, chainIntact }
}

// readAudit — filtro por rec.uid (o arquivo é global, todos os perfis no mesmo .jsonl).
export function readAudit(uidFilter, limit) {
  const f = path.join(DATA, 'audit.jsonl');
  let lines = [];
  try { lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return { entries: [], chainIntact: true }; }
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try { const rec = JSON.parse(lines[i]); if (!uidFilter || rec.uid === uidFilter) entries.push(rec); } catch { /* linha corrompida */ }
  }
  const first = lines.length ? JSON.parse(lines[0]) : null;
  return { entries, chainIntact: !(first && first.prev) };   // prev não-nulo na 1ª linha = houve corte/rotação
}
```

`GET /api/routines` é leve de propósito (RF-9); hoje `GET /api/data` devolve tudo
(`api/server.js:424-431`).

> **Nota de operação (medida em 11/09/2026):** o `state-<uid>.json` é `root:root 0644` e o `secret`
> é `root:root 0600` (`/mnt/drivebackup/apps/openGym/data/`). O container roda como root, então lê e
> escreve os dois; o usuário `pi` **não** escreve no estado (é o que mantém o
> `spec_escritor_rotinas.md` no caminho da API em vez do arquivo). O `state-*.json` ser legível pelo
> mundo num diretório de backup compartilhado é postura anterior a esta spec e **não** é alterada
> aqui — fica registrado, com a observação de que `secret` e `vapid.json` seguem em `0600`.

### 4.9 `parseIfMatch` — uma só função para as três rotas

```js
// "" e ausente são a MESMA coisa (sem header) — evita que um `If-Match:` vazio vire 409 em vez
// de 428, e que `String(undefined)` seja comparado com "0" por acidente.
// O retorno é SEMPRE string ('7', '*' ou null), nunca número: a comparação com `String(cur.rev)`
// é textual dos dois lados.
// Formato malformado (ex.: uma aspa só, `"7`, ou `abc`) não vira 409 por acidente: devolve 'BAD'
// e a rota responde 400 IF_MATCH_MALFORMED — um 409 diria "sua base está velha" para um erro de
// sintaxe, e o cliente tentaria mesclar em vez de corrigir.
export function parseIfMatch(h) {
  if (h === undefined || h === null) return null;
  const v = String(h).trim();
  if (v === '') return null;
  if (v === '*') return '*';
  const bare = v.replace(/^"|"$/g, '').trim();
  return /^\d+$/.test(bare) ? bare : 'BAD';
}
```

Uso: `PATCH`/`DELETE` passam `'BAD'` para o `withState`, que responde `400 IF_MATCH_MALFORMED`
(antes da checagem de igualdade); `null` → `428`; o `PUT` trata `null` como "sem token" e mantém o
guard de `_ts`.

### 4.10 `PUT /api/data` — o `If-Match-State` sai do desenho (A7)

Nada a implementar: o header **não existe**. O que a spec faz é **decidir e registrar** (BACKLOG-09:131):

1. O cliente novo envia o **padrão** `If-Match` (§5.1).
2. `docs/backlog.md` — as três menções a `If-Match-State` (linhas 27, 30 e 127) passam a dizer
   "`If-Match` com o `rev` lido" / "o header real é `If-Match`", com a nota de que a v4 documentava
   um header inexistente.
3. `docs/specs/spec_micro_meso_via_app.md` fica **como está** (é registro histórico) e ganha uma
   linha de errata no topo: *"o header `If-Match-State` citado neste documento nunca existiu no
   código; o token de concorrência real está em `spec_api_rotinas.md`"*. Reescrever a v4 inteira é
   escopo da BACKLOG-02.

### 4.11 `api/Dockerfile` — o arquivo novo precisa ser copiado (ou a API não sobe)

> Arquivo conferido no Pi em 11/09/2026: `/mnt/drivebackup/apps/openGym/openGym/api/Dockerfile`
> (`COPY package.json package-lock.json* ./` → `RUN npm install --omit=dev` →
> `COPY server.js coach.js exercise_catalog.json ./` → `CMD ["node", "server.js"]`). É esse arquivo
> que a implementação edita, e o teste manual 11 confere o `COPY` antes do build.

```dockerfile
# ANTES
COPY server.js coach.js exercise_catalog.json ./

# DEPOIS
COPY server.js coach.js routines.js exercise_catalog.json ./
```

Sem isso, `import * as routines from './routines.js'` falha no boot do container
(`ERR_MODULE_NOT_FOUND`) e a API **inteira** cai — não é um endpoint quebrado, é o app fora do ar.
É o primeiro item da ordem de rollout, e o teste manual 11 cobre.

### 4.12 Cliente — `frontend/src/store/useStore.js`

**4.12.1 Token: enviar a base lida e guardar a revisão.**

```js
// ANTES (126-131)
      const sanitized = JSON.parse(JSON.stringify(get().S))
      sanitized.routines?.forEach(r=> r.ex?.forEach(ex=>{ if('restSec' in ex && !isValidRest(ex.restSec)) delete ex.restSec }))
      if(sanitized.active?.entries) sanitized.active.entries.forEach(e=>{ if('restSec' in e && !isValidRest(e.restSec)) delete e.restSec })
      if(!isValidRest(sanitized.globalRestSec)) sanitized.globalRestSec = 90
      const send = () => api('/api/data', { method: 'PUT', body: JSON.stringify({ state: sanitized }) })

// DEPOIS
      const sanitized = JSON.parse(JSON.stringify(get().S))
      sanitized.routines?.forEach(r=> r.ex?.forEach(ex=>{ if('restSec' in ex && !isValidRest(ex.restSec)) delete ex.restSec }))
      if(sanitized.active?.entries) sanitized.active.entries.forEach(e=>{ if('restSec' in e && !isValidRest(e.restSec)) delete e.restSec })
      if(!isValidRest(sanitized.globalRestSec)) sanitized.globalRestSec = 90
      // The base we actually read travels with the write. The server compares it for EQUALITY,
      // so a push whose base is stale is refused instead of winning on the clock (BACKLOG-09).
      // GET /api/data injects `rev` (0 for a state never written by the new API), so a fresh
      // install has a base from the very first boot. A client that never pulled sends nothing
      // and keeps the old server-side clock guard — that is the migration path, not a hole.
      const rev = Number.isInteger(sanitized.rev) ? sanitized.rev : null
      const send = (base = rev) => sendState(sanitized, base)
```

**4.12.2 No `409`: adotar a versão do servidor e preservar o que é seu (U1).**

```js
// ANTES (135-156) — o merge só unia workouts[] e mantinha routines locais
            const merged = Object.assign(clone(DEF), srv)
            merged.workouts = [...byId.values()]
            if (S.active) merged.active = S.active
            merged._ts = Math.max(Date.now(), srv._ts || 0) + 1
            persist(merged, false)
            await send()

// DEPOIS
            const merged = Object.assign(clone(DEF), srv)     // routines/week/dayPlan do SERVIDOR
            merged.workouts = [...byId.values()]
            if (S.active) merged.active = S.active
            // Every routine is compared against the copy this device last pulled (`base`): equal
            // to the base = the user did not touch it here, so the server's version (possibly the
            // coach's) wins; different (or created here) = the user edited it, and the user wins.
            // A base vem do localStorage na hora (`readBase()`), não de um campo de `S`: `merged`
            // acabou de nascer de `Object.assign(clone(DEF), srv)` e o `DEF` não tem esse campo,
            // então depender de `S.gymBaseRoutines` perderia a base justamente aqui.
            const adopted = adoptServerRoutines(srv.routines || [], S.routines || [], readBase())
            merged.routines = adopted.routines
            merged._ts = Math.max(Date.now(), srv._ts || 0) + 1
            merged.rev = Number.isInteger(srv.rev) ? srv.rev : merged.rev
            persist(merged, false)
            rememberBase(adopted.routines)
            // O retry reenvia o MERGED (não o `sanitized` do topo, que é o estado velho): mandar o
            // payload antigo com o `If-Match` novo repetiria o 409 ou desfaria a adoção.
            await sendState(merged, merged.rev)               // base = a que acabamos de ler
            localStorage.removeItem('gym_dirty')
            if (adopted.changed) useUI.getState().toast(t('Plan updated by the coach — your own edits were kept.'))
```

```js
// NOVO — o envio virou função, para o retry poder mandar OUTRO estado com OUTRA base.
const sendState = (state, base) => api('/api/data', { method: 'PUT',
  headers: base == null ? undefined : { 'If-Match': String(base) },
  body: JSON.stringify({ state }) })
```

```js
// NOVO — helper do módulo (topo do arquivo), testável isoladamente e SEM ressurreição:
//   - base ausente (aparelho novo, todos hoje): o servidor manda. Rotina que só existe local e
//     nunca esteve na base foi criada NESTE aparelho → mantida. Rotina que o servidor apagou não
//     volta (não está em `srv`, e sem base não há como provar que era local).
//   - base presente: igual à base ⇒ adota a do servidor; diferente ⇒ mantém a local.
export function adoptServerRoutines(srv, local, base) {
  const b = base || {}
  const touched = r => b[r.id] !== undefined && JSON.stringify(r) !== JSON.stringify(b[r.id])
  const out = srv.filter(r => {
    const l = local.find(x => x.id === r.id)
    if (!l) return true                      // apagada no servidor e não existe aqui → fica apagada
    return !touched(l)                       // não mexi aqui → adota a do servidor
  })
  const srvIds = new Set(srv.map(r => r.id))
  let changed = false
  for (const l of local) {
    if (srvIds.has(l.id)) { if (touched(l)) changed = true; continue }
    if (b[l.id] === undefined) out.push(l)   // criada neste aparelho, o servidor nunca a viu
    // else: existia na base e sumiu do servidor (apagada pela API) → não ressuscita
  }
  return { routines: out, changed }
}
```

**4.12.3 `pullState`: semear a base, e parar de empurrar estado no boot.**

```js
// ANTES (175-188)
        } else if (hasData(S)) {
          if (state && (state._ts || 0) > (S._ts || 0)) {
            ... merge de workouts ...
            merged._ts = Date.now()
            persist(merged, false)
          }
          await get().pushState()          // <-- empurra o estado local mesmo sem edição do usuário
        }

// DEPOIS
        } else if (hasData(S)) {
          if (state && (state._ts || 0) > (S._ts || 0)) {
            const byId = new Map()
            ;(state.workouts || []).forEach(w => byId.set(w.id, w))
            ;(S.workouts || []).forEach(w => { if (!byId.has(w.id)) byId.set(w.id, w) })
            const merged = Object.assign(clone(DEF), state)
            merged.workouts = [...byId.values()]
            if (S.active) merged.active = S.active
            merged._ts = Date.now()
            persist(merged, false)
            rememberBase(merged.routines)
            useUI.getState().toast(t('Plan updated by the coach — your own edits were kept.'))
          }
          // No push here on purpose: booting is not an edit. Pushing the whole state just
          // because the app opened is what let a stale copy win the clock race (BACKLOG-09).
          // If the server is behind, the next real edit pushes (with If-Match).
        }
```

**4.12.4 `rememberBase` e a migração.**

```js
// Persistência local da base (fora do estado sincronizado: é livro-caixa do aparelho).
const BASE_KEY = 'gym_base_routines_v1'
function rememberBase(routines) {
  try { localStorage.setItem(BASE_KEY, JSON.stringify(Object.fromEntries((routines || []).map(r => [r.id, r])))) }
  catch { /* */ }
}
function readBase() { try { return JSON.parse(localStorage.getItem(BASE_KEY)) || {} } catch { return {} } }
```

Em `boot()`, **antes** do `pullState()`: nada a semear — `pushState` lê a base do `localStorage` na
hora (`readBase()`), então não há campo de `S` para manter vivo. Quando `BASE_KEY` não existe (todos
os aparelhos hoje), a base é `{}` — o adotador trata "sem base" como "não mexi", adota o servidor e
**mostra o toast** na primeira vez. É a migração: um aviso, uma vez.

### 4.13 Testes

**Cliente** (`frontend/src/store/useStore.test.js`, novo, vitest — a suíte tem 204 testes verdes):

1. `adoptServerRoutines` — rotina igual à base ⇒ adota a do servidor; divergente ⇒ mantém a local;
   criada localmente (sem base) ⇒ mantém; apagada no servidor e sem base ⇒ **não ressuscita**.
2. `pushState` envia `If-Match` com o `rev` do estado quando existe, e **não** envia quando não
   existe.
3. `409` com `srv.rev` novo ⇒ o retry manda o **estado adotado** (`merged`) com o `If-Match` do
   servidor — asserção dupla: payload contém a rotina do servidor **e** o header é o rev novo.
4. `pullState` **não** chama `pushState` quando não há divergência (regressão do §4.12.3).
5. A base sai do `localStorage`, não de um campo de `S`: com `BASE_KEY` populado e `S` recriado a
   partir de `DEF`, `adoptServerRoutines` ainda distingue "eu editei" de "o servidor mudou"
   (regressão do R2-09).
6. `rev` da resposta de sucesso é guardado no estado (para o próximo `If-Match`), sem depender do
   ramo de `409`.

**Contrato entre as duas pontas** (`api/routines.contract.test.js`, `node --test`): o fixture
`api/routines.fixtures.json` é validado **contra o validador real** de `api/routines.js` (3 payloads
aceitos: `validateExEntry` devolve `null`; 6 recusados: devolve o `code` esperado; 2 estados: os
campos que o cliente serializa passam). Assim o contrato é medido **uma vez**, no código de produção
— o cliente não duplica a validação em teste (R2-11).

**Servidor** (`api/routines.test.js`, novo, `node --test`, runner embutido no Node 22, zero
dependência nova):

1. `validateExEntry` — 3 casos aceitos (um por modo) e 12 recusados (um por `code` de §4.3) **mais
   os 4 de tolerância**: `mode:"normal"` onde já está (ok), `mode:"normal"` em item novo (400),
   `sg:0` onde já está (ok), `sec` ausente em `mode:"time"` legado sem troca de modo (ok).
2. `defaultExFields` — os defaults por modo, comparados com `history.js:121-129`.
3. `mergeRoutine` — merge preserva campos não citados, mantém posição, acrescenta no fim, remove
   campos do modo anterior ao trocar de modo, e `exRemove` de id inexistente devolve
   `EX_NOT_IN_ROUTINE`.
4. `cleanupSg` — porta fiel de `history.js:145-149` (3 casos: par quebrado, tripla, `sg:0`).
5. `sweepRoutineRefs` — fixture com 2 rotinas, `week`, `dayPlan` e 2 treinos citando a rotina:
   limpa as chaves, preserva `workouts[]` e devolve `{weekCleaned:1, dayPlanCleaned:1, orphanWorkouts:2}`.
6. `stateMeta`/`parseIfMatch` — `rev` ausente ⇒ `0`; `parseIfMatch('7') === '7'` (**string**, nunca
   número); `parseIfMatch('"7"') === '7'`; `parseIfMatch('')` e `parseIfMatch(undefined)` ⇒ `null`;
   `parseIfMatch('*')` ⇒ `'*'`; `parseIfMatch('"7')` e `parseIfMatch('abc')` ⇒ `'BAD'`.
7. `withState` — recusa por `If-Match` divergente devolve `{code:409}` e **não** grava (arquivo com
   mtime/hash inalterado); sucesso propaga `_meta` do handler para `body.meta`.
8. `readActor` — sem header; header sem assinatura (`claimed`); assinatura válida (`signature`);
   `t` fora de ±300 s; corpo alterado.
9. `agentKey` — arquivo ausente ⇒ cria com 64 hex e modo 600; arquivo com lixo ⇒ regenera; arquivo
   ilegível ⇒ não lança (devolve chave e o request vira `BAD_ACTOR_SIG`, nunca `500`).
10. `appendAudit`/`readAudit` — linha tem `prev` igual ao `h` da anterior; `readAudit` filtra por
    `rec.uid`; `chainIntact:false` quando a 1ª linha tem `prev`.
11. `checkRoutineFields` (o bloco do `PUT`) — estado com `mode:"normal"` em tudo e `sg:0` **passa**
    (regressão do F-05); estado com `weight:"45 kg"` **não** passa.
12. Fixtures em `api/routines.fixtures.json` (3 payloads aceitos + 6 recusados + 2 estados), usado
    só pela suíte do servidor.

## Comportamento Visual/UX

O app **não ganha tela nova**. O que muda é o comportamento de sync e um aviso.

**U1 — o aviso (única mudança visível):**

```
┌─────────────────────────────────────────────────────┐
│  ⓘ Plan updated by the coach — your own edits       │
│    were kept.                                       │
└─────────────────────────────────────────────────────┘
```

Aparece quando o app descobre, num `409`, que o servidor tinha mudado rotinas que este aparelho não
tocou — ou seja, quando a versão do assistente foi adotada. Não aparece em sync normal, não aparece
em erro de rede, e não pede decisão.

**Antes / depois do token, na prática:**

```
ANTES (guarda por relogio)                       DEPOIS (token por igualdade)
─────────────────────────────────────────        ─────────────────────────────────────────
17:00  app aberto, estado velho                 17:00  app aberto, estado velho (rev 5)
17:10  agente escreve rotina (rev 7)            17:10  agente escreve rotina (rev 7)
17:20  usuario da um toque no app               17:20  usuario da um toque no app
       -> _ts = Date.now() (maior)                     -> PUT com If-Match: "5"
       -> PUT passa no guard                            -> 409 STALE_STATE {rev: 7}
       -> rotina do agente APAGADA                      -> app adota a rotina do agente,
           (o recibo de 10/09 avisava disso)               mantem o que o usuario mexeu,
                                                          e avisa na tela (U1)
```

**Log do servidor (o aceite da BACKLOG-07:92 — "mostra qual agente escreveu o quê"):**

```
[og-routine] op=patch  uid=ZPJbmYUfHlfbAYzi actor=hermes     verified=signature rev=7->8  rid=r_upper_C_20260829
[og-state]   op=put    uid=ZPJbmYUfHlfbAYzi actor=pwa-legacy verified=none      rev=8->9
[og-routine] op=delete uid=ZPJbmYUfHlfbAYzi actor=hermes     verified=claimed   rev=9->10 rid=r_teste_20260909
```

**`GET /api/audit?limit=2`:**

```json
{ "chainIntact": true, "entries": [
  { "at": "2026-09-11T17:10:04.512Z", "action": "patch-routine", "uid": "ZPJbmYUfHlfbAYzi",
    "actor": "hermes", "verified": "signature", "otp": "0e0f9a1c-…",
    "revBefore": 7, "revAfter": 8, "routines": ["r_upper_C_20260829"],
    "beforeHash": "9c1f…", "stateHash": "4f9c…", "h": "ab77…", "prev": "11c2…" },
  { "at": "2026-09-11T17:20:31.004Z", "action": "put-state", "uid": "ZPJbmYUfHlfbAYzi",
    "actor": "pwa-legacy", "verified": "none", "otp": "b31d…",
    "revBefore": 8, "revAfter": 9, "routines": null,
    "beforeHash": "4f9c…", "stateHash": "77aa…", "h": "5d10…", "prev": "ab77…" } ] }
```

**Tela de rotina (editor) — inalterada**, para deixar claro o que **não** muda:

```
┌─ Upper C - Shoulder 3D ────────────────────── 🔺 ─┐
│  Progression                                     › │   ← nada novo
│  No automatic progression                          │
├────────────────────────────────────────────────────┤
│  lever lateral raise          3 × 6-8 · 45 kg    › │   ← o peso que o agente escreveu
│  smith rear delt row          2 × 6-8 · 25 kg    › │     já aparecia aqui (commit 49fa3c1)
└────────────────────────────────────────────────────┘
```

## Testes manuais (numerados)

> Todos os passos que **escrevem** rodam contra uma **cópia** do estado (backup datado antes, como
> manda o §Rollout) ou contra a fixture do `node --test`. Os passos 1, 2, 9, 10 e 12 podem rodar no
> estado vivo porque são leitura ou idempotentes por construção; os demais, não.

1. `GET /api/routines` autenticado: devolve as 6 rotinas de hoje (5 reais + `mtwfylw47b2j`), com
   `rev: 0` e `_ts: 1789132746742` (valores medidos em 11/09/2026). Sem `workouts` no corpo.
2. `GET /api/data`: o `state` traz `rev: 0` **injetado** (o arquivo não tem o campo).
3. Cópia do estado + `PATCH /api/routines/r_upper_C_20260829` com `{"ex":{"0326":{"weight":9}}}` e
   **sem** `If-Match` → `428 IF_MATCH_REQUIRED`; **sem** `X-OG-Actor` → `400 ACTOR_REQUIRED`.
   Nenhuma escrita em nenhum dos dois (conferir o hash do arquivo).
4. Na cópia, com `If-Match: "0"` e ator: `200 {ok:true, rev:1, meta.verified:"claimed"}` e
   `meta.stateHash`. Só `r_upper_C` mudou (comparar com o snapshot); `prog` das outras rotinas
   intacto.
5. Repetir o mesmo `PATCH` com `If-Match: "0"` → `409 STALE_STATE {rev:1}`. Com `If-Match: "1"` →
   `200 {rev:2}`.
6. Na cópia: `PATCH` com `{"ex":{"0326":{"weight":"45 kg"}}}` → `400 BAD_WEIGHT
   {field:"ex.0326.weight"}`; com `{"ex":{"zzz":{"sets":3}}}` → `400 CATALOG_UNKNOWN_EX`; com
   `{"ex":{"0584":{"reps":"8-6"}}}` → `400 BAD_REPS`; com `{"ex":{"0584":{"sets":0}}}` →
   `400 BAD_SETS`; com `{"ex":{"0584":{"mode":"normal"}}}` → `400 BAD_MODE` (valor legado **novo**).
   Nos cinco, `rev` **não** mudou.
7. Na cópia: `DELETE /api/routines/r_pull_C_20260829` com ator e `If-Match` → `200` com
   `meta.weekCleaned: 1`, `meta.dayPlanCleaned: 0` e **`meta.orphanWorkouts: 0`** (nenhum treino cita
   essa rotina; o único `routineId` órfão medido, `r_push_20260823`, é de uma rotina que já não
   existe — apagá-la daria `404 ROUTINE_NOT_FOUND`). Os **300** treinos seguem intactos (contar).
8. Na cópia: `DELETE` do `r_upper_C_20260829` (referenciada em `week[4]`): a chave `4` de `week`
   some (`meta.weekCleaned: 1`) e o `dayPlan` continua `{}`.
9. `PUT /api/data` de um cliente antigo (sem `If-Match`, sem `X-OG-Actor`): `200` e funciona — é o
   caso do PWA publicado. O `stdout` registra `actor=pwa-legacy`, e o audit registra `verified:"none"`.
10. Fluxo U1 de ponta a ponta, em ambiente de teste: `GET` (rev 5) no cliente A; `PATCH` pelo agente
    (rev 6); cliente A faz `PUT` com `If-Match: "5"` → `409`; A re-lê, adota a rotina do agente,
    mantém a rotina que ele mesmo editou, refaz o `PUT` com `If-Match: "6"` → `200` com o toast.
11. `docker compose build api && docker compose up -d --force-recreate api` e repetir 1–4 no
    container: o `stdout` (`docker logs opengym-api-1`) mostra as linhas `[og-routine]`/`[og-state]`.
    **Antes disso**, conferir o `api/Dockerfile` (§4.11) — sem o `COPY` do `routines.js` o container
    nem sobe.
12. `GET /api/audit?limit=5`: as 5 últimas operações, com `actor`, `verified`, `rev` antes/depois e
    a cadeia encadeada — na leitura (ordem decrescente) vale **`entry[i].h === entry[i+1].prev`**.
13. `frontend`: `npm test` com os 204 testes de hoje + os novos de `useStore.test.js` verdes;
    `npm run build` sem warning novo. `api`: `node --test api/routines.test.js` verde.
14. Reserva: `PATCH` na cópia mudando `0585`/`0599` — **aceito** pelo servidor (o servidor valida
    **forma**; o congelamento dos 200 é regra do portão do Hermes, não do app). Registrado aqui de
    propósito, para a regra não ser "descoberta" como buraco depois.

## Rollout e reversão

- **Ordem (importa):**
  1. `api/routines.js` + `server.js` (despacho, `rev`, `If-Match`, ator, auditoria, `GET` injetando
     `rev`, endurecimento do `PUT`) + **`api/Dockerfile`** (§4.11).
  2. Deploy da API: `docker compose build api && docker compose up -d --force-recreate api`.
     **Nada quebra:** o PWA publicado segue no caminho antigo (RF-10) e o agente também (o `PUT` sem
     `rev` mantém o guard de `_ts`).
  3. `frontend/src/store/useStore.js` + `useStore.test.js`, `npm test`, `npm run build`, deploy do
     `web` (`docker compose build web && docker compose up -d --force-recreate web`).
  4. Só então o `spec_escritor_rotinas.md` §4.7 passa para o modo `patch` — automaticamente, na
     sondagem do A7.
- **Janela de compatibilidade, medida e não estimada.** O `nginx.conf` serve JS/CSS/HTML/JSON com
  `no-cache, must-revalidate` (`nginx.conf:22` e `:42`, nos dois `server` blocks); o `index.html`
  servido por `try_files` (`:21`/`:41`) é a exceção — a regex de `location` só casa URI terminando
  em `.html`, então a navegação para `/` sai com o default do nginx. Na prática o HTML do SPA é
  pequeno e o browser revalida, mas a spec **não afirma** que o cliente novo entra na primeira
  abertura: o fim da janela é **observado** no `GET /api/audit` — enquanto existir linha
  `action:"put-state"` com `actor:"pwa-legacy"`, há cliente antigo escrevendo. Critério de saída da
  janela: **7 dias sem nenhuma linha `pwa-legacy`**.
- **Risco residual — declarado com todas as letras, e ele NÃO é raro.** Um cliente **antigo** cujo
  estado local seja *mais novo* que a escrita do agente vence o guard (guarda por `_ts`,
  `api/server.js:446-448`). Como `pullState` só adota o servidor quando
  `(state._ts || 0) >= (S._ts || 0) && !dirty` (`useStore.js:169`) e **todo** `persist` carimba
  `_ts = Date.now()`, qualquer aparelho que abriu **depois** da escrita do agente tem base mais nova
  e sobrescreve — não é o caso raro, é o caso de "PWA aberto durante a escrita", o mesmo que a
  BACKLOG-09:125 descreve e que o recibo de 10/09/2026 registrou furado. O aceite da BACKLOG-09
  ("cenário reproduzido com o resultado medido") **só é atendido por completo depois** que a janela
  fechar (cliente novo em todos os aparelhos). Até lá: mitigação processual — o agente pede "feche e
  reabra o app" depois de escrever (`sync_log.md:16`) — **e** o §4.12.3 reduz a frequência, porque
  o app novo deixa de empurrar estado só por abrir.
- **Reversão:** `git revert <commit>` da API volta o guard por relógio e remove as rotas novas
  (`404`); o cliente novo, ao receber `rev` ausente, não manda `If-Match` e volta ao caminho antigo
  sozinho. `S.rev` fica no arquivo sem uso — inofensivo (nenhum leitor do app o lê).
- **Antes de testar:** exportar backup (Settings → Export backup) ou `GET /api/data`; e — como diz
  `spec_peso_e_reps_por_rotina.md:570` — nunca contra o estado vivo sem snapshot.

## Relação com a outra spec

- **A funciona sozinha hoje** (`spec_escritor_rotinas.md`): usa `PUT /api/data` com guard por `_ts`,
  exatamente como o protocolo de hoje. Nada desta spec é pré-requisito.
- **B não pode invalidar os recibos de A.** RF-10 garante que o `PUT` de A continua aceito sem
  `If-Match` e sem ator; RF-6 só **acrescenta** campos (`rev`, `meta.etag`, `meta.stateHash`) que o
  recibo de A passa a registrar quando existirem. Nenhum recibo antigo é reescrito, e nenhum campo
  antigo muda de nome ou de formato.
- **B torna A melhor:** com `rev`, o aborto por base mudada deixa de ser relógio (RF-5) e o pré-voo
  de A para de baixar o estado inteiro (`GET /api/routines`, RF-9).
- **As regras de validação: mesmo conjunto de FORMA, política só de um lado.** §4.3 daqui e §4.4 da
  Spec A são o **mesmo conjunto de forma** (e o mesmo código de referência). O que **não** é
  idêntico, e a spec declara: a **política** (piso da faixa dentro de `6..8`, alta > 10 %,
  congelados, `prog` off) mora só no portão P1 do lado Hermes (`verificar_prescricao.py:94-97`), e o
  portão aceita faixa **decimal** (`:34,:91`) enquanto o servidor exige **inteiro**. Divergência de
  *forma* entre os dois lados é bug; divergência de *política* é desenho. O teste que pega a de
  forma: a mesma intenção rodada com `--dry-run` em A contra a API de B tem de receber a mesma
  decisão de forma.

## Fora de escopo (registrado)

- **`POST /api/routines`** (§4.1) e **operação em lote** (§4.2) — com motivo.
- **Comportamento do agente** (U2): quando perguntar, o que fazer com treino faltado, escolha de
  exercício, reação a dor.
- **Corrigir o legado do estado vivo** — medido em 11/09/2026 e **não** tocado por esta entrega:
  `mode: "normal"` em todas as entradas de template (tolerado, A13); `sg: 0` nos pares
  `0585`/`0599` de Legs 1 e Legs 2 (idem); rotina de teste vazia `mtwfylw47b2j` ("New routine", 0
  exercícios) fora do `week`; treino de 2026-08-23 com `routineId: "r_push_20260823"`, que **não
  existe mais** em `routines[]` (10 dos 300 treinos têm `routineId`). Limpeza é decisão do usuário.
- **Unificar o `checkState`** além de `routines[].ex[]`: `week`, `dayPlan`, `workouts` e `exWeights`
  continuam **sem** validação no `PUT`. Escopo assumido (é o desenho da BACKLOG-06:213-215, que
  classifica `checkState` raso como fora de escopo lá); aqui só as entradas de rotina endurecem.
- **`unit` por exercício** (BACKLOG-01), **micro/meso via app** (BACKLOG-02/03), **backup/restore**
  (BACKLOG-08): não entram.
- **Rate limiting, CORS novo, WebAuthn de máquina, nonce anti-replay**: não entram (A6/A17/A19).
- **Reescrever `spec_micro_meso_via_app.md`**: fica como histórico com uma linha de errata (§4.10).

## Furos conhecidos que esta spec fecha (e os que ficam)

| # | furo (verificado no código) | destino |
|---|---|---|
| F1 | `checkState` só valida `ex[].id` e `ex[].sets` (`api/server.js:56-72`) | **fechado** para `routines[].ex[]` (§4.3, RF-11) |
| F2 | id fantasma aceito no `PUT` → "Unknown exercise" dias depois (incidente de 08/09/2026, `api/server.js:53-55`) | **fechado**: `id` conferido contra catálogo/customEx (RF-4) |
| F3 | guard por relógio (`api/server.js:446-448`) + carimbo `Date.now()` do cliente (`useStore.js:68`) | **fechado** com `rev` + `If-Match` por igualdade (RF-5) e com o fim do push mecânico no boot (§4.12.3); a janela do cliente antigo é medida (§5.7) |
| F4 | escrita do agente sai como o próprio usuário (`og_state_mutation.md:9-21`) | **fechado** para atribuição, com o alcance declarado (RF-7, A4); sigilo **não** era o problema |
| F5 | `active` apagado em todo `PUT` (`api/server.js:449`) — agente escrevendo durante o treino quebra a sessão em andamento | **fechado**: `DELETE` recusa com `409` (RF-12) e `PATCH` **preserva** `active` (A18) |
| F6 | `If-Match-State` documentado e inexistente (`docs/backlog.md:127`) | **fechado**: removido do desenho (A7/§4.10) |
| F7 | apagar rotina exige o cliente lembrar da limpeza (`RoutineEdit.jsx:143-147`) | **fechado**: limpeza server-side no `DELETE` (RF-2) |
| F8 | `GET /api/data` não devolvia nenhuma revisão — o cliente não tinha base para `If-Match` | **fechado**: `rev` injetado (§4.7.1) |
| F9 | `workouts[]` **sem** validação no `PUT` (plano externo com `weight: "45 kg"` cai em silêncio, `spec_peso_e_reps_por_rotina.md:579-581`) | **fica aberto** — rota de treino, não de rotina; registrado para a próxima spec |
| F10 | `exWeights` **sem** validação e monotônico (BACKLOG-05/06) | **fica aberto** — decisão do BACKLOG-06 (caderno é fallback) |
| F11 | rota com querystring: a chave do roteador é `pathname` **sem** query (`api/server.js:606-608`), então `GET /api/admin/user?id=…` casa pela tabela exata e lê o `id` de `url.searchParams` (`:542`) | **confirmado como correto** (não é furo); o despacho por padrão preserva isso |

## Mudanças da v1 para a v2 (achados da revisão 1)

| Achado | O que mudou |
|---|---|
| F-01 (bloqueante) | §4.5: o `key` ficou com comentário explícito ("usado SÓ pelo catch") e o `catch` mostra o corpo completo, para não parecer variável órfã |
| F-02 (bloqueante) | §4.6: `withState` agora **espalha `out._meta`** no `meta` da resposta, e o `Object.assign` órfão do `DELETE` saiu |
| F-03 (bloqueante) | §4.3.1: cabeçalho de `api/routines.js` com **todas** as funções citadas, dizendo o que vem exportado de `server.js` e o que nasce no arquivo novo |
| F-04 (bloqueante) | §4.6: `cur.prog = body.prog` (inclusive `'off'`), com A13 registrando que ausente ≠ `'off'` e a citação do `RoutineEdit.jsx:93` |
| F-05 (bloqueante) | §4.3.2/§4.3.3: os ramos de tolerância do legado (`mode:"normal"`, `sg:0`) **entraram no código**, com `legacyOk`; o `PUT` roda o mesmo validador com `legacy` do disco e `modeChanged` por item; teste 11 da suíte do servidor cobre |
| F-06 (bloqueante) | §4.12.2: `adoptServerRoutines` reescrita — comparação única (`touched`), sem ressurreição de rotina apagada, e devolve `{routines, changed}` |
| F-07 (bloqueante) | §4.7.1: `GET /api/data` **injeta `rev`**; A3 reescrito ("o cliente tem base desde o primeiro boot") |
| F-08 (bloqueante) | §5/Rollout: o risco residual **deixou de ser chamado de raro**, com a citação de `useStore.js:169` e o critério de saída da janela **medido** no audit (7 dias sem `pwa-legacy`); §4.12.3 reduz a frequência |
| F-09 (média) | A9: o que a hash-chain prova e não prova; `GET /api/audit` devolve `chainIntact` |
| F-10 (média) | §4.6: `cleanupSg` reimplementada em `routines.js` (porta de `history.js:145-149`) e chamada em **toda** mutação de `cur.ex` |
| F-11 (média) | §4.3.2: `MODE_TIME_NO_SEC`/`MODE_CARDIO_INCOMPLETE` só quando `modeChanged`; `SIDE_ON_TIME` testado sobre o modo efetivo; `sg` com ramo legado |
| F-12 (média) | §4.3.1: `stateMeta` com o corpo mostrado (`rev: S.rev\|0`), e `parseIfMatch` normaliza `""`/`"0"` |
| F-13 (média) | A4 e a tabela de §4.4: `claimed` é **alegação não verificada**; a frase do "inviabiliza alegação casual" ficou restrita ao caso assinado |
| F-14 (média) | A5/`agentKey`: valida 64 hex, **regenera** arquivo vazio/corrompido, e leitura ilegível vira `400`, nunca `500` |
| F-15 (média) | §4.9: `parseIfMatch(h)` única para as três rotas |
| F-16 (média) | §4.6: `stripCrossModeFields` no merge, espelhando `exConfigSheet` (`sheets.jsx:512-523`) |
| F-17 (média) | A14 + "Relação com a outra spec": declarado que os conjuntos **não** são idênticos — forma aqui, política no portão |
| F-18 (média) | Testes 7 e 12 corrigidos (`orphanWorkouts: 0` e `entry[i].h === entry[i+1].prev`) |
| F-19 (média) | §4.1: `r_backlog.md:28` → `docs/backlog.md:28` |
| F-20 (leve) | Rollout: linhas corretas (`nginx.conf:22`,`:42`) e a nota de que o `index.html` do `try_files` é exceção |
| F-21 (leve) | **A18** criado: `PATCH` preserva `active`; só `DELETE`/`PUT` limpam (`dropActive`) |
| F-22 (leve) | §4.8: `readAudit(uidFilter, limit)` mostrada, filtrando por `rec.uid` |
| F-23 (leve) | §4.3.2: ramos de `inc`/`repsMin`/`repsMax` (`BAD_FIELD`) implementados |
| F-24 (leve) | §4.13: fixtures e testes de contrato movidos para `api/routines.test.js` (`node --test`); o teste do cliente virou tabela de forma |

## Mudanças da v2 para a v3 (achados da revisão 2)

| Achado | O que mudou |
|---|---|
| R2-01 (bloqueante) | §4.3.3/§4.7.2: `let cur` é lido **antes** de `checkRoutineFields(body.state, cur)`, e a função passou a existir com nome e `return bad \|\| null` |
| R2-02 (bloqueante) | §4.3.3: `custom` é a **união** de `customEx` do disco com o do payload |
| R2-03 (bloqueante) | §4.3.2: tolerância do legado usa `notIntroduced(v, lgv)` — item **novo** no disco (`lg === undefined`) passa a aceitar `sg:0`/`mode:"normal"` que já vinham no payload, sem liberar a introdução do valor |
| R2-04 (bloqueante) | §4.6 `withState`: `fn(work, ctx)` roda sobre **cópia** e dentro de `try` — "nunca grava em caso de erro" vira construção |
| R2-05 (média) | §4.7.3: 11 rotas (não 12) usam `readBody` |
| R2-06 (média) | §4.9: `parseIfMatch` devolve `'BAD'` para formato inválido ⇒ `400 IF_MATCH_MALFORMED`, em vez de 409 por acidente |
| R2-07 (média) | RF-12 e `remove`: **verificado no código** que `S.active.routineId` existe (`sheets.jsx:841`); o campo do erro é `active.id` (não `workoutId`, que não existe) |
| R2-08 (média) | §4.8 `list`: `404 NO_STATE` quando não há estado — coerente com a sondagem A7 da Spec A |
| R2-09 (média) | §4.12.2/§4.12.4: a base vem de `readBase()` (localStorage) **na hora**, não de um campo de `S` |
| R2-10 (média) | §4.12.2: o retry reenvia o **`merged`** com a base nova, via `sendState(state, base)` |
| R2-11 (média) | §4.13: o contrato entre as pontas virou `api/routines.contract.test.js` rodando **contra o validador real** (o cliente não duplica a validação) |
| R2-12 (média) | §4.6/§4.8: o audit grava `revBefore`/`revAfter` — os campos que o exemplo mostrava e ninguém escrevia |
| R2-13 (média) | §4.13 item 6: o cliente guarda o `rev` da resposta de sucesso para o próximo `If-Match` |
| R2-14 (leve) | §4.11: caminho do `api/Dockerfile` conferido no Pi e conteúdo registrado |
| R2-15 (leve) | (sem ação — registro de revisão; `?uid=` em `/api/routines` não é usado por ninguém) |
| R2-16 (leve) | A19: "o replay esbarra no `If-Match`" ficou restrito aos endpoints de rotina; no `PUT` o replay é aceito por desenho |
| R2-17 (leve) | §4.13 item 6: `parseIfMatch` devolve **string** (`'7'`), nunca número |
| R2-18 (leve) | §4.6 `withState`: `ctx` é passado a `fn` (deixou de ser campo morto) |
| R2-19 (leve) | §4.3.1/§4.7.3: `readRawBody` declarada como **exportada** de `server.js` e importada por `routines.js` |
| R2-20 (leve) | §4.3.1/§4.7.3: `canon`/`sha256` nascem em `routines.js` e são importadas pelo `server.js` (declarado dos dois lados) |

## Implementado em 11/09/2026 — divergências entre esta spec e o código

Está no ar desde 11/09/2026 (containers `opengym-api-1` e `opengym-web-1`). O que o código faz
**diferente** desta spec, e por quê:

| # | Onde | O que mudou no código | Motivo |
|---|---|---|---|
| J1 | catálogo | o arquivo é lido de **`/app/exercise_catalog.json`** (ao lado do `server.js`, com override `OG_CATALOG`), não de `DATA_DIR` | a spec dizia `DATA_DIR` e o Dockerfile copia o catálogo para `/app`; a primeira versão respondia `503 CATALOG_UNAVAILABLE` em toda escrita. Achado no deploy, com o servidor em execução |
| J2 | boot | o catálogo é carregado **no boot** e o log avisa se faltar | falha cedo, em vez de 503 misterioso na primeira escrita |
| J3 | ORDEM da checagem | `If-Match` e ator são verificados **antes** de carregar o catálogo | um pedido sem `If-Match` num servidor sem catálogo devolvia 503 em vez de 428 |
| J4 | `A12` | sem catálogo, o **`PUT /api/data` segue aceito** (só a escrita de rotina responde 503) | a spec dizia "503 em toda escrita de rotina"; o `PUT` é o que mantém o app vivo, e recusá-lo derrubaria o PWA por causa de um arquivo de dados |
| J5 | `A13` | o legado (`mode:"normal"`, `sg:0`) é aceito **onde já existe, inclusive num exercício novo do payload**, e recusado só quando introduzido (`isNewEntry`) | o estado real tem `mode:"normal"` em 100% dos templates; a regra anterior recusaria o `PUT` do PWA publicado |
| J6 | `exRemoved` | o campo de remoção de exercício chama-se **`exRemoved`** (a spec mostrava `exRemove`) | alinhado ao passado do verbo no resto da API; o escritor traduz o nome do lado dele |
| J7 | `prog` no `PATCH` | grava **o que vier declarado**, inclusive `'off'` | é o que o editor faz (`RoutineEdit.jsx:93`, sem condicional) |
| J8 | handler de escrita | `withState` roda `fn` sobre **cópia** e dentro de `try` | "nunca grava em caso de erro" vira construção, não sorte |
| J9 | `agent.key` | regenera quando o conteúdo **não é 64 hex**; leitura ilegível ⇒ `400 BAD_ACTOR_SIG` | antes, arquivo corrompido travava toda assinatura e um erro de permissão virava `500` |
| J10 | `A18` | `PATCH` **preserva** `S.active`; `DELETE` recusa com `409 ROUTINE_IN_USE` | ajusstar peso durante o treino é uso legítimo e não pode derrubar a sessão do aparelho |
| J11 | auditoria | cada registro grava `revBefore`/`revAfter` (os campos que o exemplo mostrava) e a rotação é de 5.000 linhas com `chainIntact` na leitura | o que a cadeia prova e o que ela não prova está escrito na A9 |
| J12 | testes | **61 testes** em `api/routines.test.js` (`node --test`, dentro da imagem) e **+15** no cliente (`plan-merge.js` tem as funções puras, que o store importa) | as funções puras saíram do `useStore.js` (que depende de `document`) para um módulo testável |
| J13 | integração HTTP | a verificação por HTTP é feita **contra o servidor em execução** (`deploy-verify.sh`, com `node:http`/urllib), não dentro do `node --test` | um harness de servidor em processo se mostrou instável (a sessão não validava só naquele contexto); testar o container real pegou o defeito J1 |

Evidência de aceite (11/09/2026): `GET /api/data` com `rev` injetado; `GET /api/routines` (6
rotinas); `GET /api/audit` (cadeia íntegra); 7 casos de recusa conferidos no servidor em produção
(428 `IF_MATCH_REQUIRED`, 400 `IF_MATCH_MALFORMED`, 409 `STALE_STATE`, 400 `ACTOR_REQUIRED`,
400 `BAD_WEIGHT`, 401 sem sessão, 404 `ROUTINE_NOT_FOUND`) — todos sem escrever; `npm test` com
219 testes verdes (204 + 15 novos).

**Incidente registrado (11/09/2026):** durante a prova de ponta a ponta, o escritor foi apontado
para uma cópia local do estado (`OPENGYM_DATA_DIR`) mas a `OPENGYM_API_URL` continuou sendo a API de
produção, e 4 `PATCH` atingiram o estado real (único dado alterado: `0326` no Upper C, 9→10, já
**restaurado** com 1 `PATCH` auditado). O recibo completo está em
`~/.hermes/workout/reports/sync_log.md`; a trava I7 (Spec A) nasceu daí.

---

> **Atualização de 11/09/2026:** o catálogo de exercícios deixou de ser
> `api/exercise_catalog.json` (e de ter cópia em `~/.hermes/.../references/`). Agora existe **um
> arquivo só**, `frontend/src/lib/exercises-data.json`, lido pelo app, pela API e pelo agente. Onde
> este documento citar `exercise_catalog.json`, ou o campo `name`, leia o arquivo novo e o campo
> `n`. Ver `docs/specs/spec_catalogo_unico.md`.

