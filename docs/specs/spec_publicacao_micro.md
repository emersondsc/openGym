# Spec: publicação do micro no openGym pelo Hermes — v5

> Contrato e implementação da **publicação do micro**: uma operação do servidor que recebe as
> rotinas da semana, cada uma com o dia em que cai, e grava tudo numa escrita só.
>
> Documento permanente de operação (nomenclatura, fluxo, invariantes): **`docs/MICRO.md`**.
>
> **v5 — o que mudou da v4** (verificação executada da v4: 12 dos 15 fechados, 2 parciais, 0 abertos,
> 5 bloqueantes novos — todos corrigidos aqui):
> **1)** o `ReferenceError` que derrubava **todo** payload com `grade` (`of dates` → `of datas`).
> **2)** "a semana corrente não muda" passa a valer de verdade: o congelamento cobre
> **segunda da semana corrente até ontem** mesmo quando a janela é a própria semana corrente, e a
> limpeza **nunca** toca data anterior a hoje (antes, publicar a semana corrente trocava a quinta já
> treinada e o próprio hoje). **3)** data declarada no passado é `400 DATE_IN_PAST` — publicação
> planeja o presente e o futuro. **4)** `autorizar.limpar` só vale dentro da janela; fora dela é
> `400 BAD_AUTORIZAR` (antes apagava `dayPlan` de qualquer data, inclusive de agosto).
> **5)** o congelamento só acontece quando a publicação **mexe na grade** (tem data que troca weekday
> ou `grade`): publicar uma rotina de reserva sem dia não escreve mais sete pins na semana corrente.
> **6)** `meta.grade` é o mapa resultante **esparso** (só os weekdays com rotina; descanso = chave
> ausente, que é como o app lê `S.week[wd] || null`) — o texto e o teste diziam "as sete chaves" e
> estavam errados. **7)** `grade[]` mantém `from` mesmo quando a `grade` declarada é quem manda no
> weekday. **8)** `A11`: a ordem real é conflito **antes** de presença. **9)** o cliente ganhou o
> **código copiável** do subcomando `publish` (antes só tinha texto) e `b"\n"` de verdade.
> **10)** `docker-compose.yml` fixa `target: runtime` no build (sem isso, o alvo `test` vira a imagem
> final e a produção sobe com os `*.test.js` dentro).
>
> **v4 — o que mudou da v3** (olhar adversarial sobre as mecânicas novas: 15 achados, 4 bloqueantes):
> **1)** declarar uma data agora **conta como mudança de grade**: o weekday dela entra em `grade[]`
> com a data de origem, exige `autorizar.grade` e aparece no `meta` — antes uma data de S2 trocava a
> linha de S3 na grade global em silêncio (bloqueante B3). **2)** `grade` sem `dias` deixa de ser a
> brecha do congelamento: a fronteira passa a ser o **fim da semana corrente**, então a grade também
> não mexe no que já passou (bloqueante B2). **3)** `meta.limpas` passou a devolver
> `{date, current}` (antes só a data, sem valor nem `trained`). **4)** data validada de verdade no
> calendário: `2026-02-30` (que o V8 rolava para 02/03 e criava chave inalcançável) e
> `2026-13-01` (que estourava `RangeError` e virava 500) agora são `400 BAD_DATE`. **5)** a grade e as
> datas não podem discordar: data declarada cujo weekday a `grade` põe em `null`/outra rotina é
> `400 BAD_GRADE`. **6)** treino em andamento passou a ser detectado por **o que a publicação muda em
> hoje** (antes só se uma data declarada fosse hoje). **7)** ordem: `428`/`400`/`412` do `If-Match`
> vêm antes do `409 NO_STATE`, sem perder o replay antes de todos eles. **8)** replay agora compara
> **conteúdo** (hash das rotinas gravadas), não só existência. **9)** cliente: `--uid` `required=True`,
> trava de alvo própria do `publish`, `--dry-run` sai `0` (o `7` fica só para "falta `--yes`") e
> `canonical_bytes` é reusado. **10)** `413` só para corpo grande; os demais erros de leitura viram
> `400`. **11)** o motivo do `client_max_body_size` foi corrigido: o estado (276 KB) cabe no default
> de 1m — o limite é folga, e o teto efetivo é o `MAX_BODY` (5 MB) da API.
>
> **v3 — o que mudou da v2** (verificação executada: 11 dos 14 bloqueantes fechados, 2 parciais,
> 1 aberto, 5 achados novos):
> **1)** o congelamento passou a cobrir a **semana corrente inteira** (segunda..domingo de hoje), não
> só de hoje em diante — publicar a semana que vem não altera mais nenhum dia desta semana, inclusive
> os já passados e já treinados (fecha o parcial R1-B1). **2)** a janela da publicação é limitada a
> **duas semanas à frente** e nunca no passado (`WINDOW_IN_PAST` / `WINDOW_TOO_FAR`), o que limita o
> congelamento a no máximo 21 datas (fecha NB-2, que chegou a 205 datas). **3)** a limpeza dentro da
> janela só é automática para resto da **mesma semana** (`r_*_S<semana>_*`); qualquer outra marcação
> vira conflito e exige `autorizar.limpar` — antes o override do usuário era apagado em silêncio
> (fecha NB-1). **4)** o `S<n>` do id é conferido contra `semana` (`BAD_ROUTINE_ID_WEEK`).
> **5)** a linha de auditoria passa a carregar a chave de idempotência (`idemKey` no `_meta`).
> **6)** `DUPLICATE_WEEKDAY` saiu (inalcançável dentro de uma semana ISO) e `DUPLICATE_DATE` entrou na
> tabela. **7)** critério de aceite executável: alvo `test` no `api/Dockerfile`
> (`docker build --target test -f api/Dockerfile .`) — no host não há node no PATH nem deps da API.
> **8)** deploy com `pull_policy: never` no serviço `api` (o compose puxaria `latest` do outro
> namespace no `up -d`, inclusive no rollback) e o `8m` do nginx nos **dois** blocos `location /api/`.
> **9)** exemplo do contrato corrigido (`hash4` real `af8c`/`b3d1`) e em dois passos: o 409 que o
> agente realmente recebe primeiro e o retry autorizado que grava.
>
> **v2 — o que mudou da v1** (41 achados de 2 revisões, 14 bloqueantes): a API ficou **funcional e
> autônoma**, sem nenhuma regra de autoria ("rotina do agente"), sem política de perguntar ao usuário
> e sem inferência de posse; correção de semana publicada passou a existir (`autorizar.routines`);
> janela de uma semana ISO; a API nunca muda o que uma data passada resolve; idempotência com TTL na
> leitura, dono da chave e verificação contra o estado; ordem real das checagens (idempotência **antes**
> do `If-Match`); cliente com `--uid` explícito, trava de alvo e erro de rede com código próprio;
> seção de deploy e rollback; tabela de recusas completa.

## Contexto e Objetivo

Hoje o micro nasce no Hermes (plano + relatório com os porquês) e o openGym não sabe dele. O desenho
da BACKLOG-02 mandava o **PWA** receber as rotinas, fazer o merge e gravar o estado inteiro com
`PUT /api/data`: o navegador virava autor de um dado que o motor gerou, e a publicação dependia do
app aberto na hora.

Esta spec entrega a **operação do servidor** que o agente usa para publicar, com identidade de
máquina, idempotência, auditoria e recusa explícita. O que atravessa a fronteira é só o que o app
renderiza: as rotinas e o dia de cada uma.

- Repo: `/mnt/drivebackup/apps/openGym/openGym`, branch `emerson-custom`
- Servidor: Node 22 — `api/server.js`, `api/routines.js`, `api/catalog.js` (+ `api/plan-micro.js`, novo)
- App: React PWA (`frontend/`) — **nenhuma mudança nesta entrega** (salvo o limite de corpo no nginx)
- Agente: `~/.hermes/workout/scripts/opengym_writer.py` (cliente autenticado que já existe)
- Substitui o **passo 6** da BACKLOG-02 (o app gravando com `PUT`). O gatilho no app e a geração do
  micro (LLM, `hermes_api.py`, `POST /api/hermes/micro`) continuam como estão.

## Escopo

- **Inclui**
  - `POST /api/plan/micro` — N rotinas com o dia de cada uma, numa gravação só.
  - Identidade de máquina obrigatória, `If-Match`, `Idempotency-Key`, auditoria, códigos de recusa.
  - Substituição autorizada de rotina publicada (`autorizar.routines`) — via de correção.
  - Janela de uma semana ISO (no máximo duas semanas à frente), limpeza autorizada e congelamento da
    semana corrente.
  - Cliente: `Api.publish_micro()` + subcomando `publish` (com `--uid` explícito e trava de alvo).
  - `web/nginx.conf`: `client_max_body_size 8m` nos **dois** blocos `location /api/` (portas 9000 e 8081).
  - `api/Dockerfile`: alvo `test` (critério de aceite executável).
  - `docker-compose.yml`: `pull_policy: never` no serviço `api`.
  - `docs/MICRO.md`: documentação permanente (nomenclatura, fluxo, invariantes, deploy, diagnóstico).
  - Testes `node --test` dos casos de aceite, rodando pelo alvo `test` da imagem.
  - Atualização do passo 6 da BACKLOG-02 no `docs/backlog.md` (feito em 12/09/2026).
- **Não inclui**
  - **Como o assistente age**: quando perguntar ao usuário, o que fazer com um dia ocupado, como
    redigir a pergunta, o que fazer com um treino faltado. Isso o usuário define **com o assistente**,
    fora desta spec; a API só informa e obedece ao que for autorizado.
  - Gerar o micro (LLM, persona, análise, prompt) — BACKLOG-02 / `spec_micro_meso_via_app.md`.
  - O gatilho no app (botão, stepper da Fase 2, poll de status) — BACKLOG-02.
  - Apagar rotinas (nada é apagado; a correção substitui o conteúdo do mesmo id).
  - Qualquer regra na API de rotina ligando autoria a dia: `PATCH`/`DELETE`/`GET /api/routines` ficam como estão.
  - Mudar `PUT /api/data` e o caminho de escrita do PWA.
  - Backup do `audit.jsonl` e do `micro-idem.json` no snapshot das 06:00 (família da BACKLOG-13;
    registrado em Riscos, não resolvido aqui).

## Decisões do usuário (produto)

| # | Decisão | Efeito visível |
|---|---|---|
| U1 | A publicação **sobrescreve os dias declarados**; a API não distingue rotina do agente de rotina do usuário | Mesma regra para qualquer rotina: o dia que a publicação declara passa a apontar para ela |
| U2 | A **lista de segunda a domingo** pode ser substituída pela semana publicada (mapa `grade`), e dia não usado pode virar descanso — decisão de quem publica, declarada no payload | A aba Plan mostra a semana publicada, sem tocar no que ainda falta desta semana |
| U3 | **Nada é apagado**: rotina de semana antiga e histórico de treino ficam; corrigir é substituir o conteúdo do mesmo id | A lista cresce; nenhum treino some |
| U4 | O app **deixa de escrever o micro** (convenção; ver Riscos: não há guarda no servidor) | A semana aparece mesmo com o app fechado, na próxima vez que você abrir |
| U5 | O dia vem **atrelado à rotina publicada**; nenhuma regra genérica diz que rotina publicada tem dia | Publicar rotina sem `dias` é permitido e nenhum dia aponta para ela |
| U6 | **A API não tem política.** Ela relata o que ocupa o dia e aplica o que vier autorizado; perguntar ou não é do assistente | Nada é sobrescrito (nem apagado) sem que a requisição autorize explicitamente |

## Decisões assumidas

Decididas por mim por serem detalhe de implementação. Nenhuma muda o que o usuário vê.

- **A1 — Rota `POST /api/plan/micro`** na tabela exata de rotas do `server.js`. O path é o que a
  assinatura do ator cobre, então não pode variar (barra final, query) sem quebrar o cliente.
- **A2 — Módulo novo `api/plan-micro.js`** (o `routines.js` tem 469 linhas). Devolve `{code, body}`; quem responde é o `server.js`.
- **A3 — Idempotência em `data/micro-idem.json`** (`0600`, `atomicWrite`, TTL 24 h **na leitura**, 200 registros), não no arquivo de estado (o PWA baixa o estado inteiro e o `PUT` reescreveria o campo). O registro guarda `key`, `bodyHash`, `uid`, `rev`, `at` e `meta`.
- **A4 — Assinatura do ator obrigatória** (`X-OG-Actor` + `X-OG-Actor-Sig`, `verified: "signature"`). O par de chaves real é o arquivo `/data/agent.key` (o cliente deriva `HMAC(SECRET,"opengym-agent-v1")` justamente porque não lê o arquivo, que é root 0600) — ver Riscos.
- **A5 — Formato do id exigido e conferido**: `r_<slug>_S<n>_<hash4>`, com
  `hash4 = sha256(meso_id + semana + slug).slice(0,4)` e **`n` igual a `semana`** — o servidor
  recomputa e recusa (`BAD_ROUTINE_ID_HASH`, `BAD_ROUTINE_ID_WEEK`). O id casa com
  `^[A-Za-z0-9_-]{1,64}$`, então `PATCH`/`DELETE /api/routines/:id` alcançam a rotina publicada. É
  formato de id desta operação, não regra de autoria.
- **A6 — O servidor nunca apaga rotina.** Corrigir é **substituir o conteúdo do mesmo id**, com
  `autorizar.routines` (RF-8). `sweepRoutineRefs` continua existindo só para o `DELETE` explícito.
- **A7 — `prog` ausente vira `"off"`** na rotina publicada (progressão nasce desligada; BACKLOG-06).
- **A8 — 1..10 rotinas por publicação** (meso de 3 a 6 dias, mais folga). Cinco é política do motor.
- **A9 — Datas ISO `YYYY-MM-DD` no fuso `America/Sao_Paulo`**, geradas pelo motor; o servidor valida
  formato e janela e usa `America/Sao_Paulo` para saber o que é a semana corrente.
- **A10 — `report_id` opaco** (opcional) entra na linha de auditoria; o relatório em si fica no Hermes.
- **A11 — Ordem canônica das checagens** (a mesma no código e nesta spec): sessão → corpo →
  **idempotência** → `If-Match` (400/412/428) → `NO_STATE` → catálogo → forma/janela → colisão de id →
  conflito → treino em andamento → gravação. A idempotência vem antes do `If-Match` de propósito: um
  retry depois de resposta perdida traz o `rev` velho e **tem** de receber replay em vez de `409`.
  O conflito vem antes da presença: uma publicação que colide devolve `409 PLAN_CONFLICT` mesmo com
  treino vivo (a lista é o que o assistente precisa para decidir).
- **A12 — Log de uma linha no `stdout`** (`[og-routine] op=publish-micro …`) e uma linha no
  `audit.jsonl` com `action`, `meso_id`, `semana`, rotinas, datas, grade, `autorizar`, **`idemKey`**,
  `report_id` e `rev` antes/depois.
- **A13 — `201` na primeira publicação, `200 {replayed:true}` no replay.**
- **A14 — A chave de idempotência é derivada do corpo canônico** — e o cliente tem **uma** função que
  gera os bytes do corpo e a chave, para os dois casarem byte a byte. Corpo novo (com `autorizar`
  preenchido depois de decidir) é publicação nova: **chave nova**.
- **A15 — Uma publicação vive numa semana ISO** (segunda a domingo), **no máximo duas semanas à frente**
  e nunca no passado: `WINDOW_IN_PAST` / `WINDOW_TOO_FAR`. É o que permite limpar e congelar sem tocar
  em outra semana e sem crescer o estado (achado NB-2: sem o limite, uma janela distante congelava 205 datas).
- **A16 — A API não muda a semana corrente**: antes de trocar a grade, o servidor fixa em `dayPlan`
  **todas** as datas da semana ISO corrente (segunda a domingo de hoje) e as que vierem antes da
  janela, com o valor que elas já resolviam (ou `rest`). Sem isso, trocar a grade mudaria
  retroativamente o dia de hoje **e os dias já passados e já treinados desta semana** (achado R1-B1).
- **A17 — Publicação com treino em andamento é recusada** (`409 WORKOUT_IN_PROGRESS`), usando o mapa
  `presence` (`POST /api/activity`, TTL 70 s) quando a publicação toca a data de hoje. O estado em
  disco não tem `active` (o `PUT` o remove), então `S.active` não serve para isso.
- **A18 — `If-Match: *` é recusado** aqui (`412 IF_MATCH_WILDCARD`).
- **A19 — `503 CATALOG_UNAVAILABLE` é defensivo e praticamente inalcançável** (o boot faz
  `process.exit(1)` sem catálogo e o mapa fica memoizado). Fica no código, sai dos critérios de aceite.
- **A20 — Cliente sem herança do validador de intenção do `apply`**: o `publish` tem validador
  próprio (`validate_publish_payload`), porque `validate_intent` exige `op ∈ {patch,unfreeze,noop}`.
  O `--allow-any-uid` do script **não** vale aqui: `--uid` é obrigatório e explícito.
- **A21 — Códigos de saída do `publish`** (estende a tabela do script): `0` ok/replay · `1` payload
  inválido · `2` conflito que exige decisão (`PLAN_CONFLICT`) · `3` credencial/ambiente · `4` base
  mudou (`STALE_STATE`, `IF_MATCH_REQUIRED`, `IF_MATCH_WILDCARD`) · `5` rede/timeout/5xx · `6`
  verificação pós-escrita · `7` falta `--yes`/`--target-live` · `8` id já existe (`ROUTINE_EXISTS`).
- **A22 — A limpeza dentro da janela é automática só para resto da mesma semana**: `dayPlan` que
  aponta para `r_*_S<semana>_*` da semana publicada é resto de publicação anterior (removido, com
  aviso em `meta.limpas`); **qualquer outra marcação** (override do usuário, rotina de outra semana)
  vira conflito e exige `autorizar.limpar` (achado NB-1: antes era apagada em silêncio).
- **A23 — A chave de idempotência sai na auditoria** (`idemKey` no `_meta`), porque o
  `micro-idem.json` não entra no backup e sem isso não há como correlacionar publicação e retry.
- **A24 — Critério de aceite executável**: alvo `test` no `api/Dockerfile`
  (`docker build --target test -f api/Dockerfile .`), porque a imagem de produção apaga os
  `*.test.js` e no host não há `node` no PATH nem `api/node_modules`.
- **A25 — `pull_policy: never` no serviço `api`** do `docker-compose.yml`: o serviço tem `image:`
  (outro namespace) **e** `build:`, e sem `pull_policy` o Compose tenta puxar `latest` antes de subir —
  inclusive no rollback, o que desfaria o retag local.
- **A26 — O cliente reusa o caminho de requisição que já existe**: `Api._request` ganha um parâmetro
  `extra` (cabeçalhos) e passa a tratar corpo não-JSON sem estourar; `publish_micro` monta em cima
  disso, herdando cookie, assinatura, contexto TLS e tratamento de `HTTPError`.
- **A27 — A grade é um mapa único de sete chaves, sem data.** Por isso **declarar uma data conta como
  mudança de grade**: o weekday dela entra em `grade[]` (com `from` = a data), exige `autorizar.grade`
  e aparece no `meta` — sem isso, uma data de S2 apagava a linha de S3 sem aviso, sem autorização e
  sem rastro. E `grade` e datas não podem discordar: data declarada cujo weekday a `grade` põe em
  `null`/outra rotina é `400 BAD_GRADE`.
- **A28 — `grade` sem `dias` é permitido, e a fronteira do congelamento passa a ser o fim da semana
  corrente** (não a véspera de uma janela que não existe). Sem isso, `dias: []` + `grade` mudava o
  passado inteiro sem nenhum congelamento.
- **A29 — O `publish` do cliente tem as travas no lugar certo**: `--uid` `required=True` (nunca herda
  `$OPENGYM_UID`; 6 perfis no `db.json`), detector de alvo próprio do `publish` (o `probe_mode` atual
  só trava o modo `patch`) exigindo `--target-live` quando a URL não é local, `--dry-run` que sai `0`
  quando o ensaio passa (`7` fica só para "falta `--yes`"), e o corpo gerado por `canonical_bytes`
  (uma fonte só, A14) — sem uma segunda função de serialização.

## Requisitos Funcionais

- **RF-1.** `POST /api/plan/micro` aceita `{meso_id, semana, routines[], grade?, autorizar?, report_id?}` e grava **tudo numa escrita só**.
- **RF-2.** Exige sessão do dono (`gymsid`) e assinatura verificada: sem assinatura → `401 ACTOR_SIGNATURE_REQUIRED`; inválida/expirada (>300 s) → `401 BAD_ACTOR_SIG`.
- **RF-3.** Exige `Idempotency-Key` (1..128 chars): ausente → `400 IDEMPOTENCY_REQUIRED`; acima de 128 → `400 IDEMPOTENCY_KEY_TOO_LONG`. Mesma chave + mesmo corpo + **mesmo uid** + dentro de 24 h → replay `200 {replayed:true, rev, meta, currentRev, intact}` **sem escrever**; chave de outro uid ou corpo diferente → `409 IDEMPOTENCY_MISMATCH`.
- **RF-4.** Exige `If-Match` (depois da idempotência, e **antes** de olhar se o perfil tem estado): ausente → `428 IF_MATCH_REQUIRED`; malformado → `400 IF_MATCH_MALFORMED`; `*` → `412 IF_MATCH_WILDCARD`; diferente do `rev` → `409 STALE_STATE` com o `rev` atual; perfil sem estado e com `If-Match` válido → `409 NO_STATE`.
- **RF-5.** Forma validada com os mesmos validadores do `PATCH` (`validateRoutineBody`, `validateExEntry`), **aplicando antes os defaults do app** (`defaultExFields`), para que o mesmo payload que o `PATCH` aceita não seja recusado aqui. Cada exercício é tratado como novo (`isNewEntry: true`): `mode:"normal"` e `sg:0` são recusados.
- **RF-6.** Exercício fora do catálogo e fora do `customEx` → `400 CATALOG_UNKNOWN_EX`; sem catálogo → `503 CATALOG_UNAVAILABLE` (defensivo, A19).
- **RF-7.** `routines[i].id`: obrigatório, no formato de A5 (`S<n>` igual a `semana` e `hash4` conferido), único no payload e inexistente no estado — id repetido no payload → `400 DUPLICATE_ROUTINE_ID`; já existente sem autorização → `409 ROUTINE_EXISTS` com `routines:[id]`.
- **RF-8.** **Substituição autorizada (via de correção):** o id listado em `autorizar.routines` e existente no estado é **substituído** (nome, emoji, prog, exercícios) mantendo o id — `dayPlan`/`week` que já apontam para ele passam a valer a versão nova. Sem `autorizar.routines`, id existente é `409 ROUTINE_EXISTS`.
- **RF-9.** **Janela (A15):** todas as datas de `routines[i].dias` caem na mesma semana ISO → senão `400 DATE_OUT_OF_WINDOW`; mais de 7 datas numa rotina → `400 BAD_DATE`; data repetida → `400 DUPLICATE_DATE`; data que não existe no calendário (`2026-02-30`, `2026-13-01`) → `400 BAD_DATE`; data anterior a hoje → `400 DATE_IN_PAST`; semana no passado → `400 WINDOW_IN_PAST`; mais de duas semanas à frente → `400 WINDOW_TOO_FAR`.
- **RF-10.** **Escrita dos dias:** `dayPlan[date] = rotina` para cada data declarada; `week[weekday(date)] = rotina` — e essa escrita do weekday **conta como mudança de grade** (vai para `grade[]` e exige `autorizar.grade`, com `from` = a data que a pediu), porque a grade é um mapa único de sete chaves e uma data de S2 não pode apagar a linha de S3 em silêncio. Se o payload trouxer `grade`, ele **substitui a grade inteira** (as sete chaves; valor = id de rotina conhecido ou `null` = descanso) e a grade e as datas têm de concordar: data declarada cujo weekday a `grade` põe em `null` ou em outra rotina → `400 BAD_GRADE`.
- **RF-11.** **Limpeza dentro da janela (A22):** `dayPlan` de data da janela não declarada que aponte para `r_*_S<semana>_*` é removido (`meta.limpas = [{date, current}]`); **qualquer outro** valor (override do usuário, rotina de outra semana) vira conflito (`limpar[] = {date, current}`) e exige `autorizar.limpar`. **Nunca em data anterior a hoje**, e `autorizar.limpar` só vale dentro da janela (fora dela → `400 BAD_AUTORIZAR`). Fora da janela, nada é tocado.
- **RF-12.** **Congelamento (A16):** **só quando a publicação muda a grade** (data que troca weekday, ou `grade`), e apenas no que já passou: cada data de **segunda da semana corrente até ontem**, mais as anteriores à janela, recebe o valor que resolvia antes (`week[weekday]` ou `"rest"`) — inclusive quando a janela é a própria semana corrente. Sem datas (só `grade`), a fronteira é o **fim da semana corrente**. As datas fixadas vêm em `meta.congeladas` (no máximo 21). Publicar uma rotina de reserva (sem `dias` e sem `grade`) **não** escreve pin nenhum. Efeito colateral declarado: nesses dias o app mostra o selo de "ajustado para este dia", com o valor que já aparecia.
- **RF-13.** **Conflito é informação + autorização, nunca política:** sem autorização — data declarada ocupada (`dayPlan` com outro valor, ou treino em `workouts[].d`) → item em `datas[] = {date, current, kind:"routine"|"rest"|"free", trained, wanted}`; weekday cujo valor final difere do atual (pela `grade` declarada **ou** pela data declarada que cai nele) → item em `grade[] = {weekday, current, next, from}`; data da janela não declarada com marcação que não é resto da mesma semana → item em `limpar[] = {date, current}`. Tudo junto devolve `409 PLAN_CONFLICT`. Com `autorizar.datas` / `autorizar.grade` / `autorizar.limpar`, os itens autorizados são aplicados.
- **RF-14.** **Aplicação atômica:** rotinas acrescentadas (ou substituídas), `dayPlan`/`week` ajustados, `rev` somado pelo servidor, `_ts` do servidor, `workouts[]`, `customEx[]`, `exWeights` e `active` intocados. Uma recusa não grava nada e não muda o `rev`.
- **RF-15.** **Auditoria** (A12, com `idemKey`) e log de uma linha com o mesmo conteúdo essencial.
- **RF-16.** **Nunca apaga rotina.**
- **RF-17.** `201 {ok, rev, meta}` onde `meta` traz `action`, `actor`, `verified`, `ifMatch`, `idemKey`, `revBefore`, `revAfter`, `stateHash`, `beforeHash`, `meso_id`, `semana`, `report_id`, `routines`, `criadas`, `trocadas`, `dias`, `grade` (o mapa resultante do `week`, **esparso**: só os weekdays com rotina — descanso é chave ausente, que é como o app lê `S.week[wd] || null`), `congeladas`, `limpas` (`[{date, current}]`). Replay: `200 {ok:true, replayed:true, rev, currentRev, intact, meta}` — `intact:false` quando alguma rotina publicada não existe mais **ou** foi editada depois (o registro guarda o hash do que foi gravado).
- **RF-18.** O app recebe a publicação **sem mudança de código**: `pullState`/`pullOnReturn` adotam `week`/`dayPlan` do servidor, `adoptServerRoutines` adota a rotina que o aparelho não conhece, e `noticeIfChanged` avisa uma vez por revisão.

## O contrato (o que atravessa a fronteira)

### Passo 1 — a publicação como ela sai do motor (e o 409 que vem primeiro)

```http
POST /api/plan/micro HTTP/1.1
Host: opengym.edsc.fun
Cookie: gymsid=<sessão forjada do dono>
X-OG-Actor: agent=hermes; tool=opengym_writer; run=20260912-1830
X-OG-Actor-Sig: t=1789254659; v1=<hmac-sha256>
If-Match: 85
Idempotency-Key: 3d9a…   (sha256 do MESMO corpo enviado — A14)
Content-Type: application/json
```

```json
{
  "meso_id": "meso-2026-09-08",
  "semana": 2,
  "report_id": "relatorio_S2_2026-09-15",
  "routines": [
    { "id": "r_push_S2_af8c", "name": "Push S2", "emoji": "🔺", "prog": "off",
      "dias": ["2026-09-15"],
      "ex": [ { "id": "0326", "sets": 3, "reps": "6-8", "weight": 8, "mode": "reps", "restSec": 90 },
              { "id": "0584", "sets": 3, "reps": "6-8", "weight": 30, "mode": "reps" } ] },
    { "id": "r_pull_S2_b3d1", "name": "Pull S2", "emoji": "🔻", "prog": "off",
      "dias": ["2026-09-19"], "ex": [ { "id": "0585", "sets": 3, "reps": "6-8", "weight": 200, "mode": "reps" } ] }
  ],
  "grade": { "0": null, "1": null, "2": "r_push_S2_af8c", "3": null, "4": null, "5": null, "6": "r_pull_S2_b3d1" }
}
```

Resposta (o estado real hoje: a grade aponta para as rotinas antigas do meso, e 15/09 está livre):

```json
{ "error": "the published week collides with what is already there", "code": "PLAN_CONFLICT",
  "datas": [],
  "grade": [ { "weekday": "0", "current": "r_leg2_20260823", "next": null },
             { "weekday": "2", "current": "r_push_C_20260829", "next": "r_push_S2_af8c" },
             { "weekday": "3", "current": "r_leg1_20260823", "next": null },
             { "weekday": "4", "current": "r_upper_C_20260829", "next": null },
             { "weekday": "6", "current": "r_pull_C_20260829", "next": null } ],
  "limpar": [],
  "hint": "decide with the user, then retry with autorizar.datas / autorizar.grade / autorizar.limpar" }
```

### Passo 2 — o retry autorizado (grava)

```json
{
  "meso_id": "meso-2026-09-08",
  "semana": 2,
  "report_id": "relatorio_S2_2026-09-15",
  "routines": [ "…as mesmas duas rotinas do passo 1…" ],
  "grade": { "0": null, "1": null, "2": "r_push_S2_af8c", "3": null, "4": null, "5": null, "6": "r_pull_S2_b3d1" },
  "autorizar": { "grade": ["0", "2", "3", "4", "6"] }
}
```

```json
{ "ok": true, "rev": 86, "meta": {
  "action": "publish-micro", "actor": "hermes", "verified": "signature", "ifMatch": "85",
  "idemKey": "9c14…", "revBefore": 85, "revAfter": 86, "stateHash": "…", "beforeHash": "…",
  "meso_id": "meso-2026-09-08", "semana": 2, "report_id": "relatorio_S2_2026-09-15",
  "routines": ["r_push_S2_af8c", "r_pull_S2_b3d1"], "criadas": ["r_push_S2_af8c", "r_pull_S2_b3d1"], "trocadas": [],
  "dias": ["2026-09-15", "2026-09-19"],
  "grade": { "2": "r_push_S2_af8c", "6": "r_pull_S2_b3d1" },
  "congeladas": ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11", "2026-09-12", "2026-09-13"],
  "limpas": [] } }
```

Notas do exemplo, verificáveis hoje (12/09/2026, semana ISO 07–13/09):
`hash4` reais para `meso-2026-09-08`/semana 2 — `push` = `af8c`, `pull` = `b3d1`, `legs` = `0a2d`, `upper` = `d887`;
`2026-09-10` já tinha `dayPlan`, por isso não aparece em `congeladas`;
o passo 2 usa **chave nova** (o corpo mudou — A14);
`grade` com sete chaves e `null` = descanso; `weekday` segue a numeração do `getDay()` (**domingo = 0**).

### Recusas

| HTTP | code | quando |
|---|---|---|
| 400 | `BAD_JSON`, `BAD_BODY`, `BAD_MESO_ID`, `BAD_SEMANA`, `BAD_ROUTINES`, `BAD_ROUTINE`, `BAD_ROUTINE_ID`, `BAD_ROUTINE_ID_HASH`, `BAD_ROUTINE_ID_WEEK`, `DUPLICATE_ROUTINE_ID`, `BAD_NAME`, `BAD_EMOJI`, `BAD_PROG`, `BAD_EX`, `EX_ID_REQUIRED`, `DUPLICATE_EX`, `CATALOG_UNKNOWN_EX`, `BAD_SETS`, `BAD_REPS`, `BAD_WEIGHT`, `BAD_SEC`, `BAD_MIN`, `BAD_SPEED`, `BAD_REST`, `BAD_UNIT`, `BAD_MODE`, `BAD_SG`, `BAD_FLAG`, `BAD_FIELD`, `MODE_TIME_NO_SEC`, `MODE_CARDIO_INCOMPLETE`, `SIDE_ON_TIME`, `BAD_DATE`, `DUPLICATE_DATE`, `DATE_OUT_OF_WINDOW`, `DATE_IN_PAST`, `WINDOW_IN_PAST`, `WINDOW_TOO_FAR`, `BAD_GRADE`, `BAD_AUTORIZAR`, `IDEMPOTENCY_REQUIRED`, `IDEMPOTENCY_KEY_TOO_LONG`, `IF_MATCH_MALFORMED` | forma, janela, grade, autorização ou chave |
| 401 | `UNAUTH`, `ACTOR_SIGNATURE_REQUIRED`, `BAD_ACTOR_SIG` | sessão e identidade |
| 404 | — (corpo `{error:"not found"}`) | **rota não implantada** (ver Deploy) |
| 409 | `PLAN_CONFLICT`, `ROUTINE_EXISTS`, `STALE_STATE`, `IDEMPOTENCY_MISMATCH`, `NO_STATE`, `WORKOUT_IN_PROGRESS` | estado |
| 412 | `IF_MATCH_WILDCARD` | `If-Match: *` |
| 413 | — | corpo acima de `MAX_BODY` da API (5 MB) ou do `client_max_body_size` do nginx (8m) |
| 428 | `IF_MATCH_REQUIRED` | sem `If-Match` |
| 503 | `CATALOG_UNAVAILABLE` | defensivo (A19) |
| 500 | `{error:"server error"}` | exceção (o `server.js` já captura) |

Qualquer `400` de forma significa "corrija o payload e reenvie"; a lista existe para o cliente
escolher a mensagem, não para ele decidir se tenta de novo.

## Como o app recebe (sem mudar o app)

| Onde | O que já faz |
|---|---|
| `frontend/src/store/useStore.js:238` `pullState()` | Com `serverRev > rev` local e nada pendente, adota o estado do servidor inteiro (`week`/`dayPlan` inclusos); com dados locais, mescla |
| `frontend/src/store/useStore.js:133` `pullOnReturn()` | Relê ao voltar para a frente (BACKLOG-09), no máximo 1×/20 s, sem empurrar |
| `frontend/src/lib/plan-merge.js:34` `adoptServerRoutines()` | Rotina que o aparelho não conhece → adota a do servidor (caminho da rotina publicada) |
| `frontend/src/store/useStore.js:119` `noticeIfChanged()` | Toast "Plan updated — your own edits were kept." (1× por revisão) |
| `frontend/src/lib/history.js` `effectiveRoutineId()` / `api/server.js:136` | `dayPlan[data]` manda; sem ele, cai no `week[weekday]` — por isso a publicação escreve os dois |

## Detalhe de Implementação (nível código)

### 1. `api/plan-micro.js` (novo)

```js
// api/plan-micro.js — publicação do micro: N rotinas, cada uma com os dias em que cai, numa
// gravação só.
//
// Especificado em docs/specs/spec_publicacao_micro.md (v4); operação e nomenclatura em docs/MICRO.md.
// Par do lado agente: ~/.hermes/workout/scripts/opengym_writer.py (Api.publish_micro).
//
// Sem política e sem autoria: a operação sobrescreve os dias que o payload declara, relata o que
// estava lá e aplica o que vier em `autorizar`. Não há regra "rotina do agente".
//
// Não escreve no socket: devolve {code, body} e quem responde é o server.js.
import fs from 'node:fs';
import path from 'node:path';
import {
  canon, sha256, parseIfMatch, checkIfMatch, withState,
  validateRoutineBody, validateExEntry, defaultExFields, stripCrossModeFields, loadCatalog
} from './routines.js';

export const AGENT_ID_RE = /^r_([a-z0-9]+)_S(\d{1,2})_([0-9a-z]{4})$/;   // A5
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;      // igual ao PATTERNS de server.js (PATCH/DELETE)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** DATE_RE só olha a forma. O calendário fecha aqui: `2026-02-30` o V8 rolaria para 02/03 (chave
 *  inalcançável no dayPlan) e `2026-13-01` estouraria a aritmética com RangeError → 500 (achado M1). */
const validIsoDate = iso => DATE_RE.test(String(iso || '')) && (() => {
  const d = new Date(iso + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
})();
const MESO_RE = /^meso-\d{4}-\d{2}-\d{2}(-[0-9a-z]{1,12}){0,2}$/;
const MAX_ROUTINES = 10, MAX_DIAS = 7;
const MAX_WEEKS_AHEAD = 2;                  // A15: janela no máximo duas semanas à frente
const TZ = 'America/Sao_Paulo';
const IDEM_FILE = 'micro-idem.json', IDEM_TTL_MS = 24 * 3600 * 1000, IDEM_MAX = 200;

/** `getDay()` do JS: domingo = 0. É a chave de `S.week` e de `grade`. */
const weekdayOf = iso => String(new Date(iso + 'T12:00:00').getDay());
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Segunda da semana ISO de `iso`. */
function weekStart(iso) {
  const wd = new Date(iso + 'T12:00:00Z').getUTCDay();     // 0=dom
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}
/** Hoje em São Paulo, sem depender do TZ do container. */
function todaySP() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const g = t => p.find(x => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function agentIdParts(id) {
  const m = AGENT_ID_RE.exec(String(id || ''));
  return m ? { slug: m[1], semana: +m[2], hash4: m[3] } : null;
}
export function expectedHash4(mesoId, semana, slug) {
  return sha256(String(mesoId) + String(semana) + String(slug)).slice(0, 4);
}
/** Resto de publicação anterior da MESMA semana (A22). */
const sameWeekLeftover = (rid, semana) => {
  const p = agentIdParts(rid);
  return !!p && p.semana === semana;
};
const datesOf = body => {
  const out = [];
  for (const r of body.routines || []) for (const d of r.dias || []) out.push({ date: d, routineId: r.id });
  return out;
};

/* ---------------------------------------------------------------- idempotência (A3, RF-3) */

function readIdem(dir) {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, IDEM_FILE), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeIdem(dir, rec) {
  const now = Date.now();
  const keep = readIdem(dir).filter(x => x && now - (x.at || 0) < IDEM_TTL_MS && x.key !== rec.key);
  keep.push(rec);
  const f = path.join(dir, IDEM_FILE), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(keep.slice(-IDEM_MAX)), { mode: 0o600 });
  fs.renameSync(tmp, f);          // falha aqui é propagada: a resposta diz que a chave não ficou
}
/** null | {replay} | {mismatch:true} — TTL aplicada na LEITURA. */
export function idemLookup(dir, key, bodyHash, uid) {
  const rec = readIdem(dir).find(x => x.key === key);
  if (!rec) return null;
  if (Date.now() - (rec.at || 0) > IDEM_TTL_MS) return null;
  if (rec.bodyHash !== bodyHash || rec.uid !== uid) return { mismatch: true };
  return { replay: rec };
}
/** As rotinas publicadas ainda existem E continuam iguais ao que esta publicação gravou? (M8) */
function stillIntact(S, ids, storedHash) {
  const lista = ids || [];
  const atuais = (S.routines || []).filter(r => lista.includes(r.id));
  if (atuais.length !== lista.length) return false;
  if (!storedHash) return true;
  return sha256(canon(atuais)) === storedHash;     // o usuário editou a rotina: não é mais a publicação
}

/* ---------------------------------------------------------------- validação (RF-5..RF-9) */

export function validatePublish(body, catalog, custom, S, hoje) {
  const bad = (code, field, message, allowed) => ({ code, field, message, ...(allowed ? { allowed } : {}) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('BAD_BODY', null, 'body must be an object');
  if (typeof body.meso_id !== 'string' || !MESO_RE.test(body.meso_id)) return bad('BAD_MESO_ID', 'meso_id', 'meso_id must look like meso-YYYY-MM-DD[-hash]');
  if (!Number.isInteger(body.semana) || body.semana < 1 || body.semana > 52) return bad('BAD_SEMANA', 'semana', 'semana must be an integer 1..52');
  if (body.report_id !== undefined && (typeof body.report_id !== 'string' || body.report_id.length > 120)) {
    return bad('BAD_BODY', 'report_id', 'report_id must be a string of at most 120 chars');
  }
  if (!Array.isArray(body.routines) || body.routines.length < 1 || body.routines.length > MAX_ROUTINES) {
    return bad('BAD_ROUTINES', 'routines', `routines must be an array of 1..${MAX_ROUTINES}`);
  }
  const ids = new Set();
  for (let i = 0; i < body.routines.length; i++) {
    const r = body.routines[i], where = `routines[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return bad('BAD_ROUTINE', where, `${where} must be an object`);
    const parts = agentIdParts(r.id);
    if (typeof r.id !== 'string' || !ID_RE.test(r.id) || !parts) {
      return bad('BAD_ROUTINE_ID', `${where}.id`, `${where}.id must be r_<slug>_S<n>_<hash4>`);
    }
    if (parts.semana !== body.semana) {
      return bad('BAD_ROUTINE_ID_WEEK', `${where}.id`, `${where}.id says S${parts.semana} but semana is ${body.semana}`);
    }
    if (parts.hash4 !== expectedHash4(body.meso_id, body.semana, parts.slug)) {
      return bad('BAD_ROUTINE_ID_HASH', `${where}.id`, `${where}.id hash does not match sha256(meso_id + semana + slug)[0..4]`);
    }
    if (ids.has(r.id)) return bad('DUPLICATE_ROUTINE_ID', `${where}.id`, `duplicate id "${r.id}"`);
    ids.add(r.id);
    if (typeof r.name !== 'string' || !r.name.trim()) return bad('BAD_NAME', `${where}.name`, 'name is required');
    if (typeof r.emoji !== 'string' || !r.emoji) return bad('BAD_EMOJI', `${where}.emoji`, 'emoji is required');
    const rb = validateRoutineBody({ name: r.name, emoji: r.emoji, prog: r.prog });
    if (rb) return { ...rb, field: `${where}.${rb.field || 'name'}` };
    if (!Array.isArray(r.ex) || r.ex.length < 1) return bad('BAD_EX', `${where}.ex`, 'ex must be a non-empty array');
    const exIds = new Set();
    for (let j = 0; j < r.ex.length; j++) {
      const raw = r.ex[j], exWhere = `${where}.ex.${raw && raw.id ? raw.id : j}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !raw.id) {
        return bad('EX_ID_REQUIRED', `${where}.ex[${j}].id`, 'ex.id required');
      }
      if (exIds.has(raw.id)) return bad('DUPLICATE_EX', exWhere, `duplicate exercise "${raw.id}"`);
      exIds.add(raw.id);
      if (catalog && !catalog.has(raw.id) && !custom.has(raw.id)) {
        return bad('CATALOG_UNKNOWN_EX', `${exWhere}.id`, `unknown exercise id "${raw.id}"`);
      }
      // RF-5: os MESMOS defaults do app antes de validar — o payload que o PATCH aceita passa aqui.
      const meta = catalog ? (catalog.get(raw.id) || {}) : {};
      const mode = raw.mode || (meta.eq === 'cardio' ? 'cardio' : 'reps');
      const filled = stripCrossModeFields({ ...defaultExFields(raw.id, mode, meta.eq), ...raw, id: raw.id, mode }, mode);
      const v = validateExEntry(filled, { catalog, custom, where: exWhere, modeChanged: true, isNewEntry: true });
      if (v) return { ...v, error: v.message };
    }
    if (r.dias !== undefined) {
      if (!Array.isArray(r.dias) || r.dias.length > MAX_DIAS) return bad('BAD_DATE', `${where}.dias`, `dias must be an array of at most ${MAX_DIAS}`);
      for (const d of r.dias) {
        if (typeof d !== 'string' || !validIsoDate(d)) return bad('BAD_DATE', `${where}.dias`, `"${d}" must be a real calendar date YYYY-MM-DD`);
      }
    }
  }
  // RF-9: uma janela só, dentro do limite de distância, e sem data repetida.
  const datas = datesOf(body);
  if (datas.length) {
    const ws = weekStart(datas[0].date);
    if (datas.some(d => weekStart(d.date) !== ws)) {
      return bad('DATE_OUT_OF_WINDOW', 'routines[].dias', 'all dates must fall in the same ISO week (Mon..Sun)');
    }
    const seen = new Set();
    for (const d of datas) {
      if (seen.has(d.date)) return bad('DUPLICATE_DATE', 'routines[].dias', `date "${d.date}" appears twice`);
      seen.add(d.date);
    }
    const cs = weekStart(hoje);
    if (ws < cs) return bad('WINDOW_IN_PAST', 'routines[].dias', `window ${ws} is before the current week ${cs}`);
    if (ws > addDays(cs, 7 * MAX_WEEKS_AHEAD)) {
      return bad('WINDOW_TOO_FAR', 'routines[].dias', `window ${ws} is more than ${MAX_WEEKS_AHEAD} weeks ahead (max ${addDays(cs, 7 * MAX_WEEKS_AHEAD)})`);
    }
    // v5/NB-2: publicação planeja o presente e o futuro. Data anterior a hoje reescreveria um dia
    // que já aconteceu (e que pode ter treino registrado).
    for (const { date } of datas) {
      if (date < hoje) return bad('DATE_IN_PAST', 'routines[].dias', `date "${date}" is in the past (today is ${hoje})`);
    }
  }
  if (body.grade !== undefined) {
    const g = body.grade;
    if (!g || typeof g !== 'object' || Array.isArray(g)) return bad('BAD_GRADE', 'grade', 'grade must be an object');
    if (Object.keys(g).length !== 7 || !['0','1','2','3','4','5','6'].every(k => k in g)) {
      return bad('BAD_GRADE', 'grade', 'grade must declare all seven weekdays ("0".."6")');
    }
    for (const [wd, rid] of Object.entries(g)) {
      if (rid === null) continue;
      const known = ids.has(rid) || (S.routines || []).some(x => x.id === rid);
      if (typeof rid !== 'string' || !known) return bad('BAD_GRADE', `grade.${wd}`, `grade.${wd} must be null or a known routine id`);
    }
    // B3: a grade declarada e uma data declarada não podem discordar sobre o mesmo weekday.
    for (const { date, routineId } of datas) {
      const wd = weekdayOf(date);
      if (g[wd] !== routineId) {
        return bad('BAD_GRADE', `grade.${wd}`,
          `grade.${wd} is ${g[wd] === null ? 'null (rest)' : g[wd]} but the date ${date} declares ${routineId}`);
      }
    }
  }
  const az = body.autorizar;
  if (az !== undefined) {
    if (!az || typeof az !== 'object' || Array.isArray(az)) return bad('BAD_AUTORIZAR', 'autorizar', 'autorizar must be an object');
    for (const d of az.datas || []) if (typeof d !== 'string' || !validIsoDate(d)) return bad('BAD_AUTORIZAR', 'autorizar.datas', `"${d}" must be a real calendar date YYYY-MM-DD`);
    for (const d of az.limpar || []) {
      if (typeof d !== 'string' || !validIsoDate(d)) return bad('BAD_AUTORIZAR', 'autorizar.limpar', `"${d}" must be a real calendar date YYYY-MM-DD`);
      // v5/NB-3: autorizar limpeza fora da janela apagava dayPlan de qualquer data (até de meses atrás)
      const janela = datas.length ? [weekStart(datas[0].date), addDays(weekStart(datas[0].date), 6)] : null;
      if (!janela || d < janela[0] || d > janela[1]) {
        return bad('BAD_AUTORIZAR', 'autorizar.limpar', `"${d}" is outside this publication's week (${janela ? janela[0] + '..' + janela[1] : 'no dates declared'})`);
      }
    }
    for (const w of az.grade || []) if (!/^[0-6]$/.test(String(w))) return bad('BAD_AUTORIZAR', 'autorizar.grade', `"${w}" must be a weekday 0..6`);
    for (const rid of az.routines || []) if (!ids.has(rid)) return bad('BAD_AUTORIZAR', 'autorizar.routines', `"${rid}" is not in this payload`);
  }
  return null;
}

/** Materializa a rotina publicada (defaults do app, modo explícito, sem legado) — igual ao PATCH. */
export function materializeRoutine(r, catalog) {
  const ex = r.ex.map(raw => {
    const meta = catalog ? (catalog.get(raw.id) || {}) : {};
    const mode = raw.mode || (meta.eq === 'cardio' ? 'cardio' : 'reps');
    return stripCrossModeFields({ ...defaultExFields(raw.id, mode, meta.eq), ...raw, id: raw.id, mode }, mode);
  });
  return { id: r.id, name: String(r.name).trim(), emoji: String(r.emoji).slice(0, 32), prog: r.prog || 'off', ex };
}

/* ---------------------------------------------------------------- conflito (RF-13) */

export function findConflicts(S, body) {
  const az = body.autorizar || {};
  const authDatas = new Set(az.datas || []), authGrade = new Set((az.grade || []).map(String));
  const authLimpar = new Set(az.limpar || []);
  const dayPlan = S.dayPlan || {}, week = S.week || {};
  const trained = new Set((S.workouts || []).map(w => w.d).filter(Boolean));
  const datas = [], grade = [], limpar = [];
  for (const r of body.routines) {
    for (const d of r.dias || []) {
      const cur = dayPlan[d];
      const occupied = (cur !== undefined && cur !== r.id) || trained.has(d);
      if (occupied && !authDatas.has(d)) {
        datas.push({ date: d, current: cur === undefined ? null : cur,
                     kind: cur === undefined ? 'free' : (cur === 'rest' ? 'rest' : 'routine'),
                     trained: trained.has(d), wanted: r.id });
      }
    }
  }
  // B3: declarar uma data escreve o weekday dela na grade global — isso é mudança de GRADE e entra
  // nesta mesma lista, com a data de origem. Sem isto, uma data de S2 trocava a linha de S3 em
  // silêncio (a semana de S3 saía da grade sem aviso, sem autorização e sem rastro).
  const wanted = new Map();                       // weekday -> {next, from}
  for (const r of body.routines) for (const d of r.dias || []) wanted.set(weekdayOf(d), { next: r.id, from: d });
  if (body.grade) for (const [wd, next] of Object.entries(body.grade)) {
    // a grade declarada manda no valor, mas o `from` da data daquele weekday não se perde (v5)
    wanted.set(wd, { next, from: (wanted.get(wd) || {}).from || null });
  }
  for (const [wd, w] of wanted) {
    const cur = week[wd], curN = cur === undefined ? null : cur;
    if (curN !== w.next && !authGrade.has(wd)) {
      grade.push({ weekday: wd, current: curN, next: w.next, from: w.from });
    }
  }
  // A22: marcação não declarada dentro da janela só sai sozinha se for resto da MESMA semana.
  const ds = datesOf(body);
  if (ds.length) {
    const ws = weekStart(ds[0].date), we = addDays(ws, 6);
    for (const d of Object.keys(dayPlan)) {
      if (d < ws || d > we) continue;
      if (ds.some(x => x.date === d)) continue;
      const cur = dayPlan[d];
      if (sameWeekLeftover(cur, body.semana) || authLimpar.has(d)) continue;
      limpar.push({ date: d, current: cur });
    }
  }
  if (datas.length || grade.length || limpar.length) {
    return { error: 'the published week collides with what is already there', code: 'PLAN_CONFLICT', code_http: 409,
             datas, grade, limpar,
             hint: 'decide with the user, then retry with autorizar.datas / autorizar.grade / autorizar.limpar' };
  }
  return null;
}

/* ---------------------------------------------------------------- aplicação (RF-8, RF-10..RF-12) */

export function applyPublish(S, body, novas, hoje) {
  const ds = datesOf(body);
  const ws = ds.length ? weekStart(ds[0].date) : null;
  const we = ws ? addDays(ws, 6) : null;
  const dp = { ...(S.dayPlan || {}) }, wk = { ...(S.week || {}) };
  const congeladas = [], limpas = [];
  const cs = weekStart(hoje);

  // v5/NB-4: só congela quando a publicação MUDA a grade (data que troca weekday, ou `grade`).
  // Publicar uma rotina de reserva (sem `dias`) não escreve pin nenhum na semana corrente.
  const novosWd = new Map();
  for (const { date, routineId } of ds) novosWd.set(weekdayOf(date), routineId);
  if (body.grade) for (const [wd, rid] of Object.entries(body.grade)) novosWd.set(wd, rid);
  const mudaGrade = [...novosWd].some(([wd, rid]) => (wk[wd] === undefined ? null : wk[wd]) !== rid);

  // RF-12/A16: o que já passou fica fixado no que resolvia antes. A fronteira é a véspera da
  // primeira data declarada — e NUNCA menos que ontem: com a janela na própria semana corrente o
  // laço antigo rodava zero vezes e trocava o dia já treinado (v5/NB-2). Sem datas (só `grade`),
  // a fronteira é o fim da semana corrente.
  if (mudaGrade) {
    const freezeEnd = ds.length ? (ws > hoje ? ws : hoje) : addDays(cs, 7);
    for (let d = cs; d < freezeEnd; d = addDays(d, 1)) {
      if (dp[d] !== undefined) continue;
      const before = wk[weekdayOf(d)];
      dp[d] = before === undefined ? 'rest' : before;
      congeladas.push(d);
    }
  }
  // RF-11/A22: dentro da janela, o que não foi declarado e é resto da MESMA semana volta à grade.
  // Qualquer outra marcação fica onde está e vira conflito em findConflicts (exige autorizar.limpar).
  // Nunca em data anterior a hoje (v5/NB-2).
  if (ws) for (const d of Object.keys(dp)) {
    if (d < ws || d > we || d < hoje || ds.some(x => x.date === d)) continue;
    const cur = dp[d];
    if (!sameWeekLeftover(cur, body.semana)) continue;
    delete dp[d]; limpas.push({ date: d, current: cur });
  }
  // RF-10: os dias declarados vencem.
  for (const { date, routineId } of ds) { dp[date] = routineId; wk[weekdayOf(date)] = routineId; }
  if (body.grade) for (const [wd, rid] of Object.entries(body.grade)) {
    if (rid === null) delete wk[wd]; else wk[wd] = rid;
  }
  // RF-11 (autorizado): o que o usuário liberou em autorizar.limpar sai, mesmo não sendo resto —
  // só dentro da janela e nunca no passado (v5/NB-3, defesa em profundidade).
  for (const d of body.autorizar?.limpar || []) {
    if (dp[d] === undefined || ds.some(x => x.date === d)) continue;
    if (d < hoje || !ws || d < ws || d > we) continue;
    const cur = dp[d]; delete dp[d]; limpas.push({ date: d, current: cur });
  }
  S.dayPlan = dp; S.week = wk;
  // RF-8: substituição autorizada (mesmo id, conteúdo novo) ou acréscimo.
  const sub = new Set(body.autorizar?.routines || []);
  const trocadas = [], criadas = [];
  for (const nova of novas) {
    const i = (S.routines || []).findIndex(x => x.id === nova.id);
    if (i >= 0 && sub.has(nova.id)) { S.routines[i] = nova; trocadas.push(nova.id); }
    else { S.routines.push(nova); criadas.push(nova.id); }
  }
  const vistos = new Set();
  const limpasUnicas = limpas.filter(x => (vistos.has(x.date) ? false : (vistos.add(x.date), true)));
  return { routines: novas.map(r => r.id), criadas, trocadas, dias: ds.map(d => d.date),
           grade: { ...wk }, congeladas, limpas: limpasUnicas };
}

/* ---------------------------------------------------------------- handler (A11: ordem canônica) */

export function makeHandlers(deps) {
  const { readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor, catalogPath, livePresence } = deps;

  async function publishMicro(req, res) {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in', code: 'UNAUTH' });
    let raw;
    try { raw = await readRawBody(req); }
    catch (e) {
      // 413 só para corpo grande; erro de socket/conexão abortada é 400 (achado L1)
      return e.message === 'body too large'
        ? json(res, 413, { error: 'body too large' })
        : json(res, 400, { error: 'bad request body', code: 'BAD_JSON' });
    }
    let body;
    try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json', code: 'BAD_JSON' }); }
    // 1. identidade
    const actor = readActor(req, user.id, raw, req.method, '/api/plan/micro');
    if (actor.err) return json(res, 401, { error: 'actor signature invalid', code: actor.err });
    if (!actor.actor || actor.verified !== 'signature') {
      return json(res, 401, { error: 'signed agent identity required', code: 'ACTOR_SIGNATURE_REQUIRED' });
    }
    // 2. chave de idempotência — e o REPLAY vem ANTES do If-Match (A11): um retry pós-queda traz o rev velho.
    const idemKey = String(req.headers['idempotency-key'] || '').trim();
    if (!idemKey) return json(res, 400, { error: 'Idempotency-Key required', code: 'IDEMPOTENCY_REQUIRED' });
    if (idemKey.length > 128) return json(res, 400, { error: 'Idempotency-Key too long', code: 'IDEMPOTENCY_KEY_TOO_LONG' });
    const bodyHash = sha256(canon(body));
    const idem = idemLookup(DATA, idemKey, bodyHash, user.id);
    if (idem && idem.mismatch) return json(res, 409, { error: 'Idempotency-Key reused with a different body or owner', code: 'IDEMPOTENCY_MISMATCH' });
    const S0 = readState(user.id);
    if (idem && idem.replay) {
      // o replay não exige base nova (A11) e diz se o publicado continua lá E igual (M8)
      return json(res, 200, { ok: true, replayed: true, rev: idem.replay.rev,
                              currentRev: S0 && Number.isInteger(S0.rev) ? S0.rev : 0,
                              intact: !!S0 && stillIntact(S0, idem.replay.meta?.routines, idem.replay.routinesHash),
                              meta: idem.replay.meta });
    }
    // 3. base declarada — 400/412/428 ANTES de olhar o estado do perfil (L2), e o replay acima já saiu
    const ifMatch = parseIfMatch(req.headers['if-match']);
    if (ifMatch === 'BAD') return json(res, 400, { error: 'malformed If-Match', code: 'IF_MATCH_MALFORMED' });
    if (ifMatch === '*') return json(res, 412, { error: 'If-Match: * is not accepted here', code: 'IF_MATCH_WILDCARD' });
    if (ifMatch === null) {
      return json(res, 428, { error: 'If-Match required', code: 'IF_MATCH_REQUIRED',
                              rev: S0 && Number.isInteger(S0.rev) ? S0.rev : 0 });
    }
    if (!S0 || typeof S0 !== 'object') return json(res, 409, { error: 'no state for this profile', code: 'NO_STATE' });
    const pre = checkIfMatch(S0, ifMatch);
    if (pre) return json(res, pre.code, pre.body);
    // 4. catálogo (defensivo) 5. forma, janela e autorizações
    const catalog = loadCatalog(catalogPath);
    if (!catalog) return json(res, 503, { error: 'exercise catalog unavailable', code: 'CATALOG_UNAVAILABLE' });
    const hoje = todaySP();
    const custom = new Set((S0.customEx || []).map(c => c.id));
    const bad = validatePublish(body, catalog, custom, S0, hoje);
    if (bad) return json(res, 400, bad);
    const novas = body.routines.map(r => materializeRoutine(r, catalog));
    const sub = new Set(body.autorizar?.routines || []);
    const colidem = novas.filter(r => (S0.routines || []).some(x => x.id === r.id) && !sub.has(r.id));
    if (colidem.length) {
      return json(res, 409, { error: 'routine already exists', code: 'ROUTINE_EXISTS', routines: colidem.map(r => r.id),
                              hint: 'authorize the replacement in autorizar.routines' });
    }
    // 6. conflito 7. treino em andamento 8. gravação (tudo na MESMA leitura do withState)
    const resolveHoje = St => {
      const ov = (St.dayPlan || {})[hoje];
      if (ov === 'rest') return null;
      if (ov) return ov;
      return (St.week || {})[weekdayOf(hoje)] ?? null;
    };
    const out = withState(deps, user.id, { ifMatch, actor, action: 'publish-micro', uid: user.id, dropActive: false }, S => {
      const conflict = findConflicts(S, body);
      if (conflict) return conflict;
      // A17/M5: o treino em andamento protege o que a publicação MUDA em hoje — não só as datas
      // declaradas (a limpeza e a grade também mexem em hoje).
      const antesHoje = resolveHoje(S);
      const meta = applyPublish(S, body, novas, hoje);
      if (typeof livePresence === 'function' && livePresence(user.id) && resolveHoje(S) !== antesHoje) {
        return { error: 'a workout is in progress on a device and this publication changes today',
                 code: 'WORKOUT_IN_PROGRESS', code_http: 409 };
      }
      return { _meta: { meso_id: body.meso_id, semana: body.semana, report_id: body.report_id || null,
                        autorizar: body.autorizar || null, ifMatch: ifMatch || null, idemKey, ...meta } };
    });
    if (out.code !== 200) return json(res, out.code, out.body);
    try {
      writeIdem(DATA, { key: idemKey, bodyHash, uid: user.id, at: Date.now(), rev: out.body.rev,
                        routinesHash: sha256(canon(novas)), meta: out.body.meta });
    } catch (e) {
      console.error('[og-micro] idem write failed', e.message);
      out.body.meta.idempotency = 'not-persisted';     // a publicação valeu, mas o retry não terá replay
    }
    return json(res, 201, { ok: true, rev: out.body.rev, meta: out.body.meta });
  }

  return { publishMicro };
}
```

### 2. `api/server.js` — rota e injeção

```js
// ANTES (linha 15)
import * as routines from './routines.js';
// DEPOIS
import * as routines from './routines.js';
import * as planMicro from './plan-micro.js';
```

```js
// ANTES (tabela `routes`, junto das rotas de rotina — `GET /api/routines` em :415, `GET /api/audit` em :418)
  'GET /api/routines': (req, res) => ROUTINE_HANDLERS.list(req, res),
  'GET /api/audit': (req, res) => ROUTINE_HANDLERS.audit(req, res),
// DEPOIS
  'GET /api/routines': (req, res) => ROUTINE_HANDLERS.list(req, res),
  'GET /api/audit': (req, res) => ROUTINE_HANDLERS.audit(req, res),

  // Publicação do micro (spec_publicacao_micro). Path exato: a assinatura do ator cobre esta
  // string, então ela não pode variar (barra final, query) sem quebrar o cliente.
  'POST /api/plan/micro': (req, res) => ROUTINE_HANDLERS.publishMicro(req, res),
```

```js
// ANTES (linha 764, depois do Object.assign das rotinas)
Object.assign(ROUTINE_HANDLERS, routines.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor, CATALOG_PATH
}));
// DEPOIS
Object.assign(ROUTINE_HANDLERS, routines.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor, CATALOG_PATH
}));
Object.assign(ROUTINE_HANDLERS, planMicro.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor,
  catalogPath: CATALOG_PATH, livePresence            // A17: mapa `presence` (TTL 70 s) já existe neste módulo (server.js:354)
}));
```

### 3. `web/nginx.conf` — limite de corpo nos DOIS blocos

```nginx
# ANTES (dois servidores: 9000 ssl e 8081, cada um com o seu `location /api/ {` — linhas 13 e 33)
    location /api/ {
      proxy_pass http://api:3000;
    }
# DEPOIS (o mesmo em ambos)
    location /api/ {
      client_max_body_size 8m;    # folga acima do MAX_BODY (5 MB) da API, que é o teto efetivo
      proxy_pass http://api:3000;
    }
```

Por que existe: o estado tem **275.935 B** hoje (cabe no default de 1m do nginx) e só cresce
(`routines[]` nunca é podado por U3/A6; `dayPlan` cresce nas janelas publicadas). O limite é folga
para o crescimento, e o **teto efetivo é o `MAX_BODY` da API (5 MB, `server.js:35`)** — entre 5 MB e
8m quem responde `413` é a API (JSON), não o nginx (HTML). Os dois valores precisam ficar coerentes:
se um dia o `MAX_BODY` subir, o `client_max_body_size` sobe junto.

### 4. `api/Dockerfile` — alvo `test` (critério de aceite executável)

```dockerfile
# ANTES (primeira linha: o estágio não tem nome e o runtime remove os testes)
FROM node:22-alpine
...
COPY api/*.js ./
RUN rm -f ./*.test.js
COPY frontend/src/lib/exercises-data.json /app/frontend/src/lib/exercises-data.json
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
# DEPOIS (dá nome ao runtime e acrescenta o alvo de teste no fim do arquivo)
FROM node:22-alpine AS runtime
...
COPY api/*.js ./
RUN rm -f ./*.test.js
COPY frontend/src/lib/exercises-data.json /app/frontend/src/lib/exercises-data.json
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]

# Alvo de teste: mesma árvore e mesmas dependências, com os *.test.js de volta (nenhum byte
# disto entra na imagem de produção, que continua sendo o estágio `runtime`).
# Roda de dentro da imagem porque no host não há node no PATH nem api/node_modules.
#   docker build --target test -f api/Dockerfile .
FROM runtime AS test
COPY api/*.test.js ./
RUN node --test ./*.test.js
```

### 5. `docker-compose.yml` — `pull_policy: never` no serviço `api`

```yaml
# ANTES (linhas 27-30)
  api:
    image: ghcr.io/duartesantos8/opengym-api:latest
    build:
      context: .
      dockerfile: api/Dockerfile
# DEPOIS
  api:
    image: ghcr.io/duartesantos8/opengym-api:latest
    pull_policy: never        # o artefato é o BUILD local; `latest` do outro namespace não tem readActor nem plan-micro
    build:
      context: .
      dockerfile: api/Dockerfile
      target: runtime         # v5: sem isto o alvo `test` (último estágio) vira a imagem final e a
                              # produção sobe com os *.test.js dentro
```

### 6. `api/plan-micro.test.js` (novo — mesmo harness do `routines.test.js`)

| # | Caso | Esperado |
|---|---|---|
| 1 | publicação válida (2 rotinas, 2 datas da mesma semana ISO, `grade` completo) | `201`, `rev` +1, rotinas no estado, `dayPlan` e `week` escritos, `meta.grade` completo |
| 2 | mesmo corpo + mesma chave, depois de gravar | `200 replayed:true`, `rev` **não** muda, `intact:true` |
| 3 | mesma chave depois de a rotina publicada ser apagada por fora | `200 replayed:true` com `intact:false` |
| 4 | chave de outro perfil (uid diferente, mesmo corpo) | `409 IDEMPOTENCY_MISMATCH` |
| 5 | registro de idempotência escrito à mão com `at` de 25 h | não é replay: grava de novo (ou `ROUTINE_EXISTS`) |
| 6 | chave fixa escolhida à mão + corpo diferente (testa o guarda, não o fluxo do agente) | `409 IDEMPOTENCY_MISMATCH` |
| 7 | sem `Idempotency-Key` / chave de 200 chars | `400 IDEMPOTENCY_REQUIRED` / `400 IDEMPOTENCY_KEY_TOO_LONG` |
| 8 | **retry verbatim com o `rev` VELHO** (o caso que a idempotência existe para cobrir) | `200 replayed:true` (não `409`) |
| 9 | sem `If-Match` / `If-Match` velho / `If-Match: *` | `428` / `409 STALE_STATE` / `412 IF_MATCH_WILDCARD` |
| 10 | sem assinatura (`claimed`) / assinatura de outro corpo | `401 ACTOR_SIGNATURE_REQUIRED` / `401 BAD_ACTOR_SIG` |
| 11 | id fora do padrão / `hash4` errado / `S9` com `semana: 2` | `400 BAD_ROUTINE_ID` / `BAD_ROUTINE_ID_HASH` / `BAD_ROUTINE_ID_WEEK` |
| 12 | id já existente, sem `autorizar.routines` | `409 ROUTINE_EXISTS` com `routines:[id]` |
| 13 | id já existente **com** `autorizar.routines` | `201`, conteúdo trocado, mesmo id, `dayPlan`/`week` apontando para ele, `meta.trocadas` |
| 14 | datas em duas semanas ISO diferentes | `400 DATE_OUT_OF_WINDOW` |
| 15 | mesma data repetida em duas rotinas | `400 DUPLICATE_DATE` |
| 16 | janela na semana passada / a três semanas de hoje | `400 WINDOW_IN_PAST` / `400 WINDOW_TOO_FAR` |
| 17 | exercício com `mode:"normal"`/`sg:0` | `400 BAD_MODE` |
| 18 | exercício sem `sets` (o `PATCH` aceitaria, preenchendo default) | `201` com `sets: 3` materializado |
| 19 | `restSec: 10` / exercício fora do catálogo | `400 BAD_REST` / `400 CATALOG_UNKNOWN_EX` |
| 20 | data ocupada por rotina, sem `autorizar.datas` | `409 PLAN_CONFLICT` com `datas[0] = {kind:"routine", wanted:…}` |
| 21 | data só com treino registrado (sem `dayPlan`) | `409 PLAN_CONFLICT` com `kind:"free"`, `trained:true` |
| 22 | a mesma data com `autorizar.datas` | `201` e `dayPlan` trocado |
| 23 | `grade` mudando weekday ocupado, sem `autorizar.grade` | `409 PLAN_CONFLICT` com `grade[]` |
| 24 | `grade` substituindo a grade inteira (incluindo `null`) | `week` exatamente igual ao mapa (descanso = chave ausente) e `meta.grade` = esse mesmo mapa esparso |
| 25 | `dayPlan` do usuário em data da janela não declarada | `409 PLAN_CONFLICT` com `limpar[] = {date, current}` (**não** apaga sozinho) e, com `autorizar.limpar`, `201` + `meta.limpas = [{date, current}]` |
| 26 | `dayPlan` resto da MESMA semana (`r_*_S2_*`) em data não declarada | removido sozinho, em `meta.limpas`, sem conflito |
| 27 | data declarada que cai num weekday ocupado por rotina de outro meso | `409 PLAN_CONFLICT` com `grade[] = {weekday, current, next, from}`; com `autorizar.grade`, `201` (a linha antiga não some em silêncio) — e `from` continua preenchido mesmo com `grade` no payload |
| 28 | data declarada e `grade[weekday] = null` (ou outra rotina) | `400 BAD_GRADE` (grade e datas discordando) |
| 29 | `grade` sem nenhuma data (`dias: []`) | `201`, e o congelamento vai até o **fim da semana corrente** (nada antes de hoje muda) |
| 30 | rotina de reserva (`dias: []`, sem `grade`) | `201` e **nenhum** pin escrito: `week` e `dayPlan` byte a byte iguais aos de antes (`congeladas: []`) |
| 31 | janela **igual à semana corrente** (publicar o resto desta semana) com a grade autorizada | dia passado e já treinado continua resolvendo para a mesma rotina, e hoje não muda sem estar declarado (`congeladas` cobre segunda..ontem) |
| 32 | data declarada no passado (`2026-09-08` com hoje 12/09) | `400 DATE_IN_PAST`, nada gravado |
| 33 | `autorizar.limpar` com data fora da janela (ex.: `2026-08-20`) | `400 BAD_AUTORIZAR`; o `dayPlan` de agosto fica intacto |
| 34 | publicação com janela a duas semanas de hoje | `meta.congeladas` = segunda da semana corrente até a véspera da janela (≤ 21 datas), com o valor anterior |
| 35 | `2026-02-30` e `2026-13-01` (não existem no calendário) | `400 BAD_DATE` nos dois — nunca `500`, e nenhuma chave estranha no `dayPlan` |
| 36 | perfil sem estado, sem `If-Match` | `428 IF_MATCH_REQUIRED` (não `409 NO_STATE`) |
| 37 | publicação que muda hoje (por data declarada, limpeza ou grade) com `presence` ativo | `409 WORKOUT_IN_PROGRESS`; sem mudança em hoje, `201`; conflito não autorizado ganha da presença (`409 PLAN_CONFLICT`) |
| 38 | replay depois de o usuário editar a rotina publicada no app | `200 replayed:true` com `intact:false` |
| 39 | corpo grande / erro de leitura do corpo | `413` no primeiro; `400 BAD_JSON` no segundo |
| 40 | qualquer recusa | estado em disco byte a byte igual ao de antes; `rev` intacto |
| 41 | depois da publicação | `workouts[]`, `customEx[]`, `exWeights` e `active` intactos |
| 42 | auditoria | última linha com `action`, `meso_id`, `semana`, `routines`, `dias`, `grade`, `autorizar`, **`idemKey`** e `report_id` |

### 7. `~/.hermes/workout/scripts/opengym_writer.py` — cliente

```python
    def _request(self, method: str, url: str, body: bytes | None, pathname: str, extra: dict | None = None):
        hdrs = actor_headers(self.secret, method, pathname, self.uid, body, self.run_id)
        hdrs["Cookie"] = self.cookie
        if extra:
            hdrs.update(extra)
        ctx = ssl._create_unverified_context() if url.startswith("https://localhost") else None
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
                raw = r.read().decode("utf-8")
                try:
                    return r.status, (json.loads(raw) if raw.strip() else {})
                except ValueError:
                    # v3: corpo não-JSON não pode virar traceback (mesma correção do publish)
                    return r.status, {"error": raw[:200], "code": "HTTP_NON_JSON"}
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, {"error": raw[:200], "code": "HTTP_" + str(e.code)}

    def publish_micro(self, payload: dict, rev: int, idem_key: str):
        """Publica a semana: N rotinas com os dias de cada uma, numa gravacao so.

        Codigos (spec_publicacao_micro v4): 409 PLAN_CONFLICT -> decisao do usuario (2);
        409 STALE_STATE / 412 / 428 -> reler (4); 409 ROUTINE_EXISTS -> autorizar.routines (8);
        400 -> payload (1); 401 -> credencial (3); 5xx/rede -> (5).
        """
        path = "/api/plan/micro"
        body = publish_body_bytes(payload)          # A14: os MESMOS bytes que geram a chave
        try:
            return self._request("POST", self.base + path, body, path,
                                 extra={"If-Match": str(rev), "Idempotency-Key": idem_key})
        except (urllib.error.URLError, TimeoutError, ssl.SSLError, OSError) as e:
            # erro de rede TEM codigo proprio: a publicacao pode ter entrado, e o agente precisa saber
            die(5, f"[5] rede: {e} — confira o estado antes de repetir (a chave e a mesma)")


def publish_body_bytes(payload: dict) -> bytes:
    """Bytes do corpo. UMA fonte (A14/A29): reusa o `canonical_bytes` que o script já tem
    (opengym_writer.py:112). A chave de idempotência e o hash da assinatura saem dos MESMOS bytes."""
    return canonical_bytes(payload)


def micro_idem_key(uid: str, body: bytes) -> str:
    """sha256 dos MESMOS bytes enviados, amarrado ao uid (o servidor compara uid + sha256(canon(body)))."""
    return sha256_hex(uid.encode() + b"\n" + body)      # v5: b"\n" de verdade (a v4 escrevia \\n)


def validate_publish_payload(raw: dict) -> dict:
    """Forma do payload de publicacao (A20). Nao reusa validate_intent, que exige op in
    {patch,unfreeze,noop} e recusaria meso_id/semana/routines como campo desconhecido.
    Forma minima aqui (o servidor valida de novo, e e ele quem manda):
      meso_id: meso-YYYY-MM-DD[-hash] | semana: int 1..52 | routines: 1..10, cada uma com
      id/name/emoji/ex[>=1], dias opcional (ISO) | grade opcional (7 chaves) | autorizar opcional.
    Levanta Fail(1, ...) com o campo ofensor."""
    def bad(msg): die(1, f"[1] payload de publicacao: {msg}")
    if not isinstance(raw, dict): bad("precisa ser um objeto")
    if not re.fullmatch(r"meso-\d{4}-\d{2}-\d{2}(-[0-9a-z]{1,12}){0,2}", str(raw.get("meso_id", ""))):
        bad("meso_id")
    if not isinstance(raw.get("semana"), int) or not 1 <= raw["semana"] <= 52: bad("semana")
    rot = raw.get("routines")
    if not isinstance(rot, list) or not 1 <= len(rot) <= 10: bad("routines")
    for r in rot:
        if not re.fullmatch(r"r_[a-z0-9]+_S\d{1,2}_[0-9a-z]{4}", str(r.get("id", ""))): bad("routines[].id")
        if not str(r.get("name", "")).strip() or not r.get("emoji"): bad("routines[].name/emoji")
        if not isinstance(r.get("ex"), list) or not r["ex"]: bad("routines[].ex")
        if "dias" in r and (not isinstance(r["dias"], list) or len(r["dias"]) > 7): bad("routines[].dias")
    if "grade" in raw and (not isinstance(raw["grade"], dict) or len(raw["grade"]) != 7):
        bad("grade precisa das sete chaves")
    return raw


# ---------------------------------------------------------------- CLI (o que muda no script)

def build_parser():
    ...
    def common(sp, uid_required=False):
        # v5/A29: o uid passa a ser obrigatorio no publish (o db.json tem 6 perfis e $OPENGYM_UID
        # herdado publicaria no perfil errado em silencio). `--allow-any-uid` nao existe nesse modo.
        sp.add_argument("--uid", required=uid_required, help="perfil (obrigatorio no publish)")
        sp.add_argument("--api-url", help="URL do GET/PUT /api/data (default: cadeia de opengym_reader)")
        if not uid_required:
            sp.add_argument("--allow-any-uid", action="store_true", help="permite uid fora do db.json")
        return sp
    ...
    pb = common(sub.add_parser("publish", help="publica a semana (rotinas + dias) numa gravacao so"),
                uid_required=True)
    pb.add_argument("--intent"); pb.add_argument("--json")
    pb.add_argument("--yes", action="store_true", help="autoriza a escrita")
    pb.add_argument("--dry-run", action="store_true", help="mostra corpo+chave+rev e nao faz POST")
    pb.add_argument("--target-live", action="store_true",
                    help="declara que a URL resolvida e o ALVO da escrita (exigido fora de localhost)")
    return p


def require_target_live(args, url: str):
    """v5/A29: o probe_mode atual so trava o modo `patch`. O publish tem trava propria: fora de
    localhost, escrever exige --target-live (o incidente de 11/09 foi um ensaio que saiu em producao)."""
    if "localhost" in url or "127.0.0.1" in url:
        return
    if not getattr(args, "target_live", False):
        die(7, "[7] alvo remoto sem --target-live: nada foi escrito")


def cmd_publish(a):
    payload = validate_publish_payload(load_intent_publish(a))     # --intent/--json, forma propria
    uid, secret = a.uid, load_secret()                            # nunca resolve_uid: --uid e obrigatorio
    api = resolve_api(secret, uid, run_id_now(), a.api_url)
    require_target_live(a, api.base)
    base = read_api_state(api)
    rev = base.get("rev") if isinstance(base.get("rev"), int) else 0
    body = publish_body_bytes(payload)
    key = micro_idem_key(uid, body)
    info(f"uid={uid} rev={rev} chave={key[:12]}... bytes={len(body)}")
    if a.dry_run or not a.yes:
        info(body.decode("utf-8"))                                # o corpo canonico exato
        if a.dry_run:
            return 0                                              # ensaio que passa = 0 (v5/A29)
        die(7, "[7] falta --yes para escrever")
    status, resp = api.publish_micro(payload, rev, key)
    info(f"HTTP {status} {json.dumps(resp, ensure_ascii=False)[:400]}")
    if status in (200, 201):
        return 0
    code = resp.get("code") if isinstance(resp, dict) else None
    return {  # A21: o orquestrador distingue "pergunte ao usuario" de "corrija o payload"
        "PLAN_CONFLICT": 2, "ROUTINE_EXISTS": 8, "STALE_STATE": 4,
        "IF_MATCH_REQUIRED": 4, "IF_MATCH_WILDCARD": 4,
    }.get(code, 1 if status == 400 else (3 if status in (401, 403) else 5))
```

CLI (`build_parser()`): subcomando `publish` com `--intent` / `--json`, `--uid` **`required=True`**
(nunca herdar `$OPENGYM_UID`: o `db.json` tem 6 perfis e a publicação iria para outro em silêncio;
`--allow-any-uid` não existe aqui), `--yes`, `--dry-run`, `--target-live` (exigido quando a URL
resolvida não é local — o `probe_mode` atual só trava o modo `patch`, então o `publish` tem detector
próprio). Comportamento: `--dry-run` faz os GETs, **não** faz o POST, imprime corpo canônico (`canonical_bytes`) + chave + `rev` lido e **sai `0` quando o ensaio passa**; `7` fica reservado para
"faltou `--yes`" (ou `--target-live`) numa tentativa de escrita de verdade.

### 8. `docs/MICRO.md` e `docs/backlog.md`

- `docs/MICRO.md`: atualizar §2 (sem regra de posse; `S<n>` conferido), §4 (invariantes: janela com
  limite, congelamento da semana corrente, limpeza autorizada, correção por substituição), §5
  (contrato: `grade` com sete chaves, `autorizar.limpar`), §7 (deploy com `pull_policy: never` e o
  alvo `test`), §8 (o que é política do assistente e não da API).
- `docs/backlog.md`: nota no BACKLOG-02 (feita em 12/09/2026) dizendo que o passo 6 mudou.

## Deploy e rollback

```bash
cd /mnt/drivebackup/apps/openGym/openGym

# 1. testes: alvo `test` do Dockerfile (no host não há node no PATH nem api/node_modules)
docker build --target test -f api/Dockerfile .

# 2. anotar a imagem viva, para o rollback
docker inspect --format '{{.Image}}' opengym-api-1

# 3. build local + recriação forçada (o `pull_policy: never` do compose impede o pull do outro namespace)
docker compose build api
docker compose up -d --force-recreate --pull never api

# 4. provar que a rota subiu: 401 (sem credencial) NÃO é 404
docker exec opengym-api-1 grep -c "plan/micro" /app/api/server.js
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://opengym.edsc.fun/api/plan/micro
```

- **Nunca `docker compose pull`.** A imagem em uso é `ghcr.io/duartesantos8/opengym-api:latest`, de
  outro namespace: o `pull` troca o artefato e **some** com esta rota e com o `readActor` — conferido
  em 12/09/2026 (a imagem viva, construída localmente, tem `readActor` e **zero** ocorrências de
  `plan/micro`). Sem `pull_policy: never` (A25), o próprio `up -d` puxaria `latest` antes de subir.
- **Rollback:** `docker tag <image-id-anotado> ghcr.io/duartesantos8/opengym-api:latest && docker compose up -d --force-recreate --pull never api`.
- **404 na rota** = "não implantado" (build não rodou ou o pull trocou a imagem), não é recusa do contrato.
- **Backup antes de publicar de verdade:** `cp data/state-<uid>.json{,.bak.$(date +%Y%m%d-%H%M%S)}`.
  O snapshot das 06:00 cobre `state-*.json` e `db.json`; **não** cobre `audit.jsonl` nem `micro-idem.json` (Riscos).

## Comportamento Visual/UX

Nada de tela nova. O que o usuário vê, em ordem:

```
ANTES (hoje)                                DEPOIS (publicado)
┌─ Plan ────────────────────────┐           ┌─ Plan ────────────────────────┐
│ Week schedule                 │           │ Week schedule                 │
│  Mon  Rest                    │           │  Mon  Rest                    │
│  Tue  🔺 Push C - Shoulder 3D │           │  Tue  🔺 Push S2              │  <- dia declarado
│  Wed  🦵 Legs 1               │           │  Wed  🦵 Legs S2              │     vence
│  Thu  🔺 Upper C - Shoulder 3D│           │  Thu  🔺 Upper S2             │
│  Fri  Rest                    │           │  Fri  Rest                    │
│  Sat  🔺 Pull C - Shoulder 3D │           │  Sat  🔻 Pull S2              │
│  Sun  🍑 Legs2                │           │  Sun  🍑 Legs S2              │
│ Routines (6)                  │           │ Routines (6 + 5 = 11)         │  <- U3: nada sai
└───────────────────────────────┘           └───────────────────────────────┘
```

Os dias desta semana (inclusive os já passados e já treinados) continuam iguais (RF-12): publicar a
semana que vem não muda o que o usuário vê hoje.

Com o app aberto na hora da publicação, o aviso que a BACKLOG-09 já publica aparece uma vez:

```
┌────────────────────────────────────────────┐
│ Plan updated — your own edits were kept.   │
└────────────────────────────────────────────┘
```

O conflito (RF-13) é **informação**, não comportamento: a API devolve as listas
(`datas[]`, `grade[]`, `limpar[]`) e a decisão de perguntar, o texto e a política são do assistente
(U6), definidos com o usuário fora desta spec.

Preview interativo: `micro_publicacao_ux_preview.html` (mesa de design do projeto: `--bg:#000`,
`--surface:#1c1c1e`, `--acc:#30d158`).

## Testes manuais

1. `docker build --target test -f api/Dockerfile .` — a suíte do servidor passa dentro da imagem.
2. Backup datado do estado (comando em Deploy).
3. `opengym_writer.py publish --uid <uid> --intent semana_S2.json --dry-run` — imprime corpo canônico, chave e `rev` lido; **não** faz POST; sai `0` quando o ensaio passa e `7` só quando falta `--yes` para escrever de verdade.
4. Publicar **uma** rotina com `dias: []` (reserva) e sem `grade`: a lista cresce, `week` e `dayPlan` **não** mudam.
5. Publicar a semana: `week`/`dayPlan`/`rev` conferem com o payload e com `meta`; `congeladas` cobre a semana corrente até a véspera da janela; `GET /api/audit?limit=1` mostra a linha `publish-micro` com `idemKey`.
6. Repetir o passo 5 com a mesma chave **e o `rev` velho**: `200 replayed:true`.
7. Republicar a mesma semana mudando uma data: a data antiga (resto da mesma semana) sai sozinha de `dayPlan` e aparece em `meta.limpas`.
8. Marcar um dia à mão no app dentro da janela e republicar: `409 PLAN_CONFLICT` com `limpar[]`; repetir com `autorizar.limpar` → `201`.
9. Corrigir uma rotina publicada: republicar com `autorizar.routines` e conferir id e dia iguais, conteúdo novo.
10. Abrir o app: a aba Plan mostra a semana publicada, a lista tem as antigas e as novas, a contagem de `workouts` é a mesma do backup, e **hoje** continua com o treino de hoje.
11. Forçar conflito de data (marcar uma data declarada no app): `409 PLAN_CONFLICT` com `datas[]`; repetir com `autorizar.datas` → `201`.
12. Declarar uma data cujo weekday já é de outra rotina (a linha de outro meso na grade): `409 PLAN_CONFLICT` com `grade[]` e `from` = a data; com `autorizar.grade` → `201` e a linha antiga registrada no `meta`.
13. `docker logs opengym-api-1 --tail 20` mostra `[og-routine] op=publish-micro uid=… actor=hermes verified=signature rev=85->86`.
14. Rollback ensaiado (Deploy): depois do retag e do `up -d --pull never`, a rota responde `401` e não `404`.

## Riscos e limites

- **U4 não tem guarda no servidor.** O app fica intocado e o `PUT /api/data` continua aceitando o
  estado inteiro; um bundle anterior à BACKLOG-09 (sem `If-Match`) cai no guard por relógio `_ts` e
  pode reverter `week`/`dayPlan` publicados. Critério de saída já existente: **7 dias sem
  `ifMatch: "none"`** no log `[og-state] op=put`. Recuperação: republicar (mesma chave = replay;
  conteúdo novo = publicação nova).
- **Rotação do `SECRET` quebra a assinatura.** O cliente assina com `HMAC(SECRET,"opengym-agent-v1")` e
  o servidor confere com `/data/agent.key`, que **só é regenerado se o arquivo sumir**. Apagar
  `data/secret` (a API o recria no boot) gira a chave do cliente e o servidor passa a responder
  `401 BAD_ACTOR_SIG` para sempre. Procedimento: apagar `data/agent.key` junto.
- **A auditoria e as chaves de idempotência não estão em backup.** O snapshot das 06:00 copia
  `state-*.json` e `db.json`; `audit.jsonl` (47.139 B, 0600 root) e `micro-idem.json` ficam de fora, e
  a rotação de 5.000 linhas do `appendAudit` corta a cabeça da cadeia (quebra `chainIntact`). Família
  da BACKLOG-13.
- **Diretório de dados é do usuário `pi`** (o mesmo do SSH do agente) e o estado é 0644: quem tem a
  conta local pode apagar `audit.jsonl`, `secret` e `agent.key`. Identidade de máquina não protege
  contra compromisso local da conta.
- **`agent` no header não é assinado** (`agent=hermes` é texto; só `t`, método, path, uid e o hash do
  corpo entram na assinatura) e não há nonce: uma assinatura capturada vale 300 s para o mesmo corpo.
  Sem rate limit no nginx.
- **Sem `fsync`** no `atomicWrite` (nem aqui nem no resto da API): queda de energia pode perder a
  última gravação. O destino é HD, não SSD.
- **Janela entre gravar e registrar a chave:** se o processo morrer no meio, o retry cai em
  `ROUTINE_EXISTS` em vez de replay — o agente confere o estado e trata como sucesso se as rotinas
  estiverem lá. Fechar a janela exigiria gravar a chave antes do estado, o que trocaria um erro por
  outro pior (replay de publicação que não aconteceu).
- **Duas semanas à frente é o limite** (A15): uma publicação para daqui a três semanas é recusada com
  `WINDOW_TOO_FAR`. Se o motor precisar planejar mais longe, o limite muda aqui — é o que mantém o
  congelamento pequeno (≤ 21 datas) e o estado enxuto.
- **`semana` não é validada contra o meso**: o servidor não conhece o meso, então coerência entre
  `meso_id`, `semana` e o conteúdo é do motor (o `hash4` e o `S<n>` do id ele confere).

## Sequência completa

```
[app] botão "Gerar micro S2" ──POST /api/hermes/micro──▶ [hermes_api.py :8091]
                                                              │ job em disco, poll do app
                                                              ├─ análise fresca + executado S1
                                                              ├─ persona Low Volume → rotinas + dias
                                                              ├─ relatório com os porquês (fica no Hermes)
                                                              └─ opengym_writer.py publish --uid … --target-live --yes
                                                                     │ POST /api/plan/micro (esta spec)
                                                                     ▼
                                                          [openGym api] valida → 1 gravação → rev+1
                                                                     │ 409 PLAN_CONFLICT?
                                                                     ├─ sim → o assistente decide com o
                                                                     │        usuário e reenvia autorizando
                                                                     ▼
[app] pullOnReturn (visibilitychange) ──GET /api/data──▶ adota week/dayPlan + rotinas novas
                                                          toast "Plan updated — your own edits were kept."
```
