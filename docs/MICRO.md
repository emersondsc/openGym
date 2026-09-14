# MICRO — como o microciclo é criado, nomeado e publicado

> Documento permanente. Serve para **o usuário, o agente do Hermes e qualquer sessão futura**
> consultarem o funcionamento do micro sem redescobrir nada.
>
> - Contrato e implementação da publicação (nível de código): `docs/specs/spec_publicacao_micro.md` (v3)
> - Geração (LLM, persona, análise): BACKLOG-02 / `docs/specs/spec_micro_meso_via_app.md`
> - Escritor do agente: `~/.hermes/workout/scripts/opengym_writer.py`
> - As rotas HTTP que a publicação usa (contrato e invariantes): `docs/ROTINAS_API.md`

## 1. O que é "o micro" (e por que a palavra significa duas coisas)

O mesmo ciclo tem **duas representações**, com donos diferentes. Confundir as duas é a origem de
todo erro de fronteira neste assunto.

| | No Hermes (motor) | No openGym (app) |
|---|---|---|
| O que é | plano da semana: 3–6 treinos com exercícios, cargas, séries, reps e **os porquês** de cada escolha | as **rotinas** da semana e os **dias** em que cada uma cai |
| Onde vive | `~/.hermes/workout/planos/`, `mesociclo_ativo.json`, `reports/relatorio_S<n>_<data>.html` | `state-<uid>.json`: `routines[]`, `week{}`, `dayPlan{}` |
| Quem escreve | o motor (LLM + portão P1) | o Hermes, pela publicação (`POST /api/plan/micro`); o app escreve só as edições do usuário |

O que **atravessa** a fronteira é só o que o app renderiza: as rotinas e o dia de cada uma. O
relatório com os porquês **não** atravessa (no máximo um `report_id` opaco na auditoria).

**Divisão de responsabilidade (importante):** a API do openGym **não tem política**. Ela valida
forma, grava o que o payload declara e devolve informação quando um dia já está ocupado. **Como o
assistente age** — quando perguntar ao usuário, o que fazer com um dia ocupado, o que fazer com treino
faltado — é definido pelo usuário **com o assistente**, e não está escrito aqui nem na spec.

## 2. Nomenclatura (o padrão é contrato)

### Mesociclo

| Objeto | Formato | Exemplo | Observação |
|---|---|---|---|
| Meso ativo | `meso-YYYY-MM-DD` | `meso-2026-09-08` | a data é o **início** do meso |
| Meso arquivado | `meso-YYYY-MM-DD-HHmmss-rand4` | `meso-2026-09-08-142233-a1b2` | vai para `planos/historico/`, retenção de 10 |
| Semanas | `S<n>` | `S1`, `S2` … | `n` sequencial dentro do meso (1..52) |
| Meso | `12 \| 20 \| 25` sessões | 25 | `12` = mesociclo de checkpoint |

### Rotina publicada

```
r_<slug>_S<n>_<hash4>          ex.: r_push_S2_af8c   (meso-2026-09-08, semana 2, slug push)
```

- `slug`: minúsculas e dígitos, sem acento (`push`, `pull`, `legs`, `upper`).
- `S<n>`: a semana do micro — **igual** ao `semana` do payload; o servidor confere e recusa
  (`BAD_ROUTINE_ID_WEEK`) quando não bate.
- `hash4`: **4 caracteres** de `sha256(meso_id + semana + slug)`, em minúsculas. Determinístico de
  propósito: a mesma semana do mesmo meso gera **exatamente o mesmo id**. Valores reais de
  `meso-2026-09-08`/semana 2: `push` = `af8c`, `pull` = `b3d1`, `legs` = `0a2d`, `upper` = `d887`.
- O servidor **recomputa o `hash4`** e recusa quando não casa (`BAD_ROUTINE_ID_HASH`): o id é
  contrato, não sugestão.
- O formato também casa com `^[A-Za-z0-9_-]{1,64}$`, então `PATCH`/`DELETE /api/routines/:id`
  alcançam a rotina publicada.
- **Não existe regra de autoria.** A API não distingue rotina publicada de rotina do usuário: os dias
  que o payload declara são sobrescritos, e o que já estava lá volta como informação na recusa.
- Nome visível: o slug com a semana (`Push S2`). Rotinas antigas do usuário seguem o padrão do app
  (`r_push_C_20260829`, `mtwzfylw47b2j`).
- **Corrigir uma semana publicada** = republicar o mesmo id com o conteúdo novo e `autorizar.routines`
  com esse id (substituição autorizada; o dia continua apontando para ele). Sem autorização, id
  existente é `409 ROUTINE_EXISTS`. Republicar a semana inteira exige listar todos os ids existentes;
  a recusa devolve a lista.

### Datas e dias da semana (a pegadinha)

- Datas sempre ISO `YYYY-MM-DD`, no fuso **`America/Sao_Paulo`**, calculadas pelo motor.
- O app guarda o dia da semana com o `getDay()` do JavaScript, **domingo = 0**, e é essa numeração
  que vale em `week` e no mapa `grade` do payload. Planejamento em linguagem humana costuma usar ISO,
  **segunda = 1**. Converter:

| Dia | ISO | `week` do app e `grade` (`getDay()`) |
|---|---|---|
| domingo | 7 | **0** |
| segunda | 1 | 1 |
| terça | 2 | 2 |
| quarta | 3 | 3 |
| quinta | 4 | 4 |
| sexta | 5 | 5 |
| sábado | 6 | 6 |

Toda troca de mensagem entre as partes usa **data ISO**. A conversão para `getDay()` acontece uma vez
só, no servidor.

### A semana da publicação (janela)

- Todas as datas de uma publicação caem na **mesma semana ISO** (segunda a domingo) → senão
  `DATE_OUT_OF_WINDOW`.
- A janela pode ser a semana corrente ou **no máximo duas semanas à frente** → passado é
  `WINDOW_IN_PAST`, mais longe é `WINDOW_TOO_FAR`. O limite é o que mantém o congelamento pequeno
  (≤ 21 datas) e o estado enxuto.
- Nenhuma data pode ser **anterior a hoje** → `DATE_IN_PAST`: a publicação planeja o presente e o
  futuro, e o passado é histórico (treino registrado não se reescreve).

### Outros nomes

| Objeto | Formato | Onde |
|---|---|---|
| Relatório da semana (com os porquês) | `relatorio_S<n>_<data>.html` | `~/.hermes/workout/reports/` (só no Hermes) |
| `report_id` no payload | o nome do arquivo, sem caminho | vai só para a auditoria do openGym |
| Chave de idempotência | `sha256(uid + "\n" + bytes do corpo)` | cabeçalho `Idempotency-Key` |
| Recibo do escritor | `run=<AAAAMMDD-HHMM>` | cabeçalho `X-OG-Actor` |

## 3. O fluxo completo

```
1. GATILHO      o usuário pede no app/chat "gera a semana S2"           (BACKLOG-02, não implementado)
2. GERAÇÃO      o motor lê o meso ativo, a análise fresca e o executado da semana anterior,
                aplica a persona (Low Volume), gera 3–6 rotinas com cargas/reps/séries, escolhe as
                datas da semana seguinte e passa pelo portão P1 (faixa 6-8, deload, alta > 10%)
3. RELATÓRIO    escreve o HTML com os porquês (fica no Hermes, é a prova de reflexão)
4. PUBLICAÇÃO   opengym_writer.py publish --uid <uid> --target-live --yes
                  └─ POST /api/plan/micro
                       ├─ 409 PLAN_CONFLICT  → devolve datas[]/grade[]/limpar[] (decisão: spec do assistente)
                       ├─ 409 STALE_STATE    → relê o estado e reconstrói
                       ├─ 409 ROUTINE_EXISTS → corrige com autorizar.routines
                       └─ 201                → rotinas + dias + grade numa escrita só, rev +1
5. LEITURA      o app adota no próximo pull (voltar para a frente, ou boot): week/dayPlan do
                servidor + rotinas novas; aviso "Plan updated — your own edits were kept."
6. USO          o usuário treina; os treinos entram em workouts[] normalmente (histórico)
7. PRÓXIMA      no fim da semana o ciclo recomeça com S(n+1) — S1..S(n-1) continuam existindo
```

## 4. Invariantes (nunca quebrar)

1. **Nada é apagado.** Nem rotina de semana antiga, nem treino. A lista de rotinas cresce; corrigir é
   substituir o conteúdo do mesmo id, com `autorizar.routines`.
2. **Uma gravação por publicação.** Rotinas, dias e grade entram numa escrita só; falhou, não gravou
   nada e o `rev` não mudou.
3. **O `rev` é do servidor.** O agente lê a base e manda `If-Match` com o `rev` lido; base velha =
   `409 STALE_STATE`, nunca sobrescrita. `If-Match: *` é recusado (`412`).
4. **Identidade assinada.** `X-OG-Actor` + `X-OG-Actor-Sig` (HMAC sobre `t\nMETHOD\npath\nuid\nsha256(corpo)`);
   sem assinatura não entra (`401`). O par de chaves é o **arquivo** `/data/agent.key` (ver §8).
5. **Idempotência por conteúdo, com dono.** Mesma chave + mesmo corpo + mesmo perfil, dentro de 24 h
   = replay (`200 replayed:true`), e o replay acontece **antes** da checagem de `rev` — é para isso que
   ele existe. O replay também diz `intact`: se a rotina publicada não existe mais, ele avisa.
6. **O passado não muda.** O congelamento só acontece quando a publicação **mexe na grade** (data que
   troca weekday, ou `grade`), e cobre a **segunda da semana corrente até ontem** mais o que vier antes
   da janela, no valor que já resolviam (`meta.congeladas`) — inclusive quando a janela é a própria
   semana corrente. Sem datas (só `grade`), a fronteira é o **fim da semana corrente**. Publicar uma
   rotina de reserva (sem `dias` e sem `grade`) **não escreve pin nenhum**. Toda data declarada é
   `>= hoje` (`400 DATE_IN_PAST`). Efeito colateral conhecido: os dias fixados passam a ter marcação no
   `dayPlan` e o app mostra neles o selo de "ajustado para este dia", com o valor que já aparecia.
7. **O que não foi declarado só sai com autorização.** Data da janela não declarada que aponta para
   `r_*_S<semana>_*` (resto de publicação anterior da mesma semana) é limpa sozinha e vem em
   `meta.limpas = [{date, current}]`; **qualquer outra marcação** (um override seu, rotina de outra
   semana) vira `PLAN_CONFLICT` com `limpar[]` e exige `autorizar.limpar` — que só vale **dentro da
   janela** e nunca no passado (fora dela, `400 BAD_AUTORIZAR`).
7b. **A grade é um mapa único de sete chaves, sem data.** Por isso declarar uma data **conta como
   mudança de grade**: o weekday dela entra em `grade[]` (com `from` = a data) e exige
   `autorizar.grade` — senão uma data da semana nova apagaria a linha de outra semana em silêncio.
   `grade` e datas têm de concordar: data cujo weekday a `grade` põe em `null`/outra rotina é
   `400 BAD_GRADE`.
8. **Rotina publicada nasce limpa.** `mode` explícito (`reps`/`time`/`cardio`), sem os valores de
   legado (`mode:"normal"`, `sg:0`), `prog` desligado por padrão.
9. **O dia pertence ao payload, não à autoria.** Rotina publicada sem `dias` existe como reserva e
   nenhum dia aponta para ela; nenhuma regra genérica liga rotina a dia.
10. **A API não julga.** Ela relata ocupação (`datas[]`, `grade[]`, `limpar[]`) e aplica o que vier em
    `autorizar`. Perguntar, avisar ou desistir é decisão do assistente com o usuário.

## 5. O contrato em uma página

`POST /api/plan/micro` — sessão do dono (`gymsid`) + assinatura do agente, `If-Match: <rev lido>`,
`Idempotency-Key: <sha256 do corpo>`.

```json
{ "meso_id": "meso-2026-09-08", "semana": 2, "report_id": "relatorio_S2_2026-09-15",
  "routines": [ { "id": "r_push_S2_af8c", "name": "Push S2", "emoji": "🔺", "prog": "off",
                  "dias": ["2026-09-15"],
                  "ex": [ { "id": "0326", "sets": 3, "reps": "6-8", "weight": 8, "mode": "reps" } ] } ],
  "grade": { "0": null, "1": null, "2": "r_push_S2_af8c", "3": null, "4": null, "5": null, "6": null },
  "autorizar": { "datas": ["2026-09-15"], "grade": ["2"], "limpar": ["2026-09-16"], "routines": ["r_push_S2_af8c"] } }
```

- `dias` opcional (`[]` = reserva). `grade` opcional, mas com **as sete chaves** quando presente, e
  substitui a grade inteira. `autorizar` opcional, nomeia exatamente o que libera (datas, grade,
  limpar, routines). Corpo novo = **chave nova**.
- `201 {ok, rev, meta}` — `meta` traz `routines`, `criadas`, `trocadas`, `dias`, `grade` (o mapa
  resultante do `week`, **esparso**: só os weekdays com rotina — descanso é chave ausente, que é como
  o app lê), `congeladas`, `limpas` (`[{date, current}]`), `idemKey`, `rev` antes/depois e os hashes.
- `200 {replayed:true, rev, currentRev, intact}` — a mesma publicação já tinha sido feita; `intact`
  é `false` se a rotina publicada sumiu **ou** foi editada depois.
- `409 PLAN_CONFLICT` → `datas[]` (`date`, `current`, `kind` routine|rest|free, `trained`, `wanted`),
  `grade[]` (`weekday`, `current`, `next`, `from` = a data que pediu a troca, quando houver) e
  `limpar[]` (`date`, `current`).
- `409 ROUTINE_EXISTS` → já existe; corrigir com `autorizar.routines`. `409 STALE_STATE` → reler.
- `409 WORKOUT_IN_PROGRESS` → há treino vivo no aparelho e a publicação muda o dia de hoje.
- `401 ACTOR_*` / `UNAUTH`, `412 IF_MATCH_WILDCARD`, `428 IF_MATCH_REQUIRED`, `400` de forma
  (inclui `WINDOW_IN_PAST`, `WINDOW_TOO_FAR`, `DATE_IN_PAST`, `DATE_OUT_OF_WINDOW`, `BAD_GRADE`,
  `BAD_AUTORIZAR`, `BAD_ROUTINE_ID_HASH`, `BAD_ROUTINE_ID_WEEK`).
- Tabela completa: `docs/specs/spec_publicacao_micro.md`.

## 6. Onde cada coisa mora

| O que | Caminho |
|---|---|
| Repo (branch `emerson-custom`) | `/mnt/drivebackup/apps/openGym/openGym` |
| API em produção | container `opengym-api-1` (compose em `docker-compose.yml`) |
| Estado do perfil | `/mnt/drivebackup/apps/openGym/data/state-<uid>.json` |
| Trilha de auditoria | `/mnt/drivebackup/apps/openGym/data/audit.jsonl` (hash-chain, `GET /api/audit`) |
| Chaves de idempotência | `/mnt/drivebackup/apps/openGym/data/micro-idem.json` (TTL 24 h) |
| Segredo da sessão | `/mnt/drivebackup/apps/openGym/data/secret` (root 0600) |
| Chave do agente (assinatura) | `/mnt/drivebackup/apps/openGym/data/agent.key` (root 0600) |
| Meso ativo e histórico | `~/.hermes/workout/planos/` (`mesociclo_ativo.json`, `historico/`) |
| Relatórios com os porquês | `~/.hermes/workout/reports/` |
| Escritor / cliente | `~/.hermes/workout/scripts/opengym_writer.py` |
| Portão P1 (política de treino) | `~/.hermes/workout/scripts/verificar_prescricao.py` |
| Mecânica de pesos | `~/.hermes/workout/MECANICA_PESOS.md` |

## 7. Como consultar e como operar

```bash
# o que o motor vê hoje: rotinas, revisão e datas
opengym_writer.py dump --uid <uid>
opengym_writer.py dump --uid <uid> --routine r_push_S2_af8c

# o que a publicação faria, sem escrever (imprime corpo canônico, chave e rev lido)
opengym_writer.py publish --uid <uid> --intent semana_S2.json --dry-run

# publicar de verdade (exige --uid, --target-live em produção e --yes)
opengym_writer.py publish --uid <uid> --intent semana_S2.json --target-live --yes
```

```bash
# o que o servidor registrou da última publicação (idemKey incluída)
curl -s -b "gymsid=<sessão>" https://opengym.edsc.fun/api/audit?limit=1 | jq '.entries[0]'
docker logs opengym-api-1 --tail 20 | grep publish-micro

# deploy: testes no alvo `test` da imagem, build local, recriação sem pull
cd /mnt/drivebackup/apps/openGym/openGym
docker build --target test -f api/Dockerfile .          # a imagem de produção apaga os *.test.js
docker inspect --format '{{.Image}}' opengym-api-1      # anote: é o rollback
docker compose build api
docker compose up -d --force-recreate --pull never api
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://opengym.edsc.fun/api/plan/micro   # 401, não 404
```

**Nunca `docker compose pull`** — e o serviço `api` tem `pull_policy: never` justamente porque o
`up -d` puxaria `latest` de `ghcr.io/duartesantos8/opengym-api`, de outro namespace, que **não** tem
esta rota nem o `readActor`. Rollback: retag da imagem anotada + `up -d --force-recreate --pull never api`.

Códigos de saída do escritor: `0` ok/replay (e ensaio `--dry-run` que passa) · `1` payload inválido ·
`2` conflito que exige decisão (`PLAN_CONFLICT`) · `3` credencial/ambiente · `4` base mudou
(`STALE_STATE`, `428`, `412`) · `5` rede/timeout/5xx · `6` verificação pós-escrita · `7` falta
`--yes`/`--target-live` numa tentativa de escrita · `8` id já existe (`ROUTINE_EXISTS`).

## 8. O que ainda não existe, e o que é de quem

- O **gatilho** no app (botão "Gerar micro S2" + stepper da Fase 2) e o serviço `hermes_api.py`
  (FastAPI 8091) que recebe o pedido e roda o job: BACKLOG-02.
- A **geração** em si (prompt, persona, análise) é a mesma BACKLOG-02; este documento cobre a
  publicação e a nomenclatura.
- **Política do assistente** (quando perguntar, o que fazer com dia ocupado, o que fazer com treino
  faltado): definida pelo usuário com o assistente, **fora** desta documentação e da spec da API.
- **Aposentar rotinas antigas**: decidido não fazer. Se um dia mudar, muda aqui primeiro.
- **Rotação do `SECRET`**: o cliente assina com `HMAC(SECRET,"opengym-agent-v1")` e o servidor confere
  com `/data/agent.key`, que só é regenerado quando o arquivo some. Apagar `data/secret` sozinho gira
  a chave do lado do cliente e o servidor passa a responder `401 BAD_ACTOR_SIG` para sempre: apague
  `data/agent.key` junto.
- **`audit.jsonl` e `micro-idem.json` não entram no snapshot** das 06:00 (que copia `state-*.json` e
  `db.json`). É a família da BACKLOG-13.
