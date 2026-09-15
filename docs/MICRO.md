# MICRO — como o microciclo é criado, nomeado e publicado

> Documento permanente. Serve para **o usuário, o agente do Hermes e qualquer sessão futura**
> consultarem o funcionamento do micro sem redescobrir nada.
>
> - Contrato e implementação da publicação (nível de código): `docs/specs/spec_publicacao_micro.md` (v6)
> - Geração (LLM, persona, análise): o motor, no Hermes (o "app como interface" foi cancelado em 14/09/2026)
> - Escritor do agente: `~/.hermes/workout/scripts/opengym_writer.py` (subcomando `publish`)
> - As rotas HTTP que a publicação usa (contrato e invariantes): `docs/ROTINAS_API.md`

## 1. O que é "o micro" (e por que a palavra significa duas coisas)

O mesmo ciclo tem **duas representações**, com donos diferentes. Confundir as duas é a origem de
todo erro de fronteira neste assunto.

| | No Hermes (motor) | No openGym (app) |
|---|---|---|
| O que é | plano da semana: os treinos com exercícios, cargas, séries, reps e **os porquês** de cada escolha | o **conteúdo dos treinos** que já existem; o **dia** de cada um é do usuário |
| Onde vive | `~/.hermes/workout/planos/`, `mesociclo_ativo.json`, `reports/relatorio_S<n>_<data>.html` | `state-<uid>.json`: `routines[]`, `week{}`, `dayPlan{}` |
| Quem escreve | o motor (LLM + portão P1) | o Hermes, pela publicação (`POST /api/plan/micro`) — só o conteúdo; o app escreve as edições do usuário e os dias |

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

A publicação **atualiza os treinos que já existem** (upsert por id), não cria treinos novos por semana
(decisão do usuário 14/09/2026). O id é o do app — `r_push_C_20260829`, `r_leg1_20260823` — e o que
muda a cada semana é o **conteúdo** (cargas, reps, séries, descanso).

- `id`: obrigatório, `^[A-Za-z0-9_-]{1,64}$`, único no payload. **Id existente = substituição total do
  conteúdo** (nome, emoji, `ex`, e `prog` quando declarado), mantendo o id — e por isso o dia que já
  apontava para ele continua valendo. **Id novo = criação.**
- **Não existe formato de semana no id** (a v5 exigia `r_<slug>_S<n>_<hash4>`): a lista do app não
  cresce e o histórico executado continua nos treinos registrados (`workouts[]`).
- **Não existe regra de autoria.** A API não distingue rotina publicada de rotina do usuário.
- `prog` é do usuário: ausente no payload, a rotina existente **mantém** o `prog` do estado; rotina
  nova nasce `"off"` (BACKLOG-06). O `meta` devolve `progAntes`/`progDepois`.
- **Rotina publicada nasce limpa.** `mode` explícito (`reps`/`time`/`cardio`) e sem os valores de
  legado do estado antigo (`mode:"normal"` → `"reps"`, `sg:0` removido) — o publicador normaliza antes
  de validar, para o intent montado a partir do `dump` não ser recusado.
- **Corrigir** uma rotina publicada é republicar o mesmo id com o conteúdo novo: é a operação normal,
  sem autorização especial.
- Rotinas antigas do usuário seguem o padrão do app (`r_push_C_20260829`, `mtwzfylw47b2j`).

### Dias e datas (o dia é do usuário)

- **Os dias são do usuário** (decisão 2B de 14/09/2026): a publicação **nunca** escreve a grade da
  semana (`S.week`). O normal é publicar **sem declarar data nenhuma** — a semana já aponta para os
  mesmos treinos, então trocar o conteúdo basta.
- `dias: ["AAAA-MM-DD"]` por rotina é **opcional** e só vai no payload **depois de o usuário
  autorizar** aquela remarcação (ele é perguntado; a publicação aplica o sim dele). Escreve
  `dayPlan[data]`, e o app mostra nesse dia o selo de "ajustado para este dia".
- Data que **já resolve** para outra rotina (o app resolve `dayPlan[data] ?? week[weekday]`) ou que já
  tem treino registrado vira conflito: `409 PLAN_CONFLICT` com `datas[]`, sem gravar. Com
  `autorizar.datas` a data é aplicada.
- Datas sempre ISO `YYYY-MM-DD`, no fuso **`America/Sao_Paulo`**, calculadas pelo motor, validadas por
  round-trip (data que não existe no calendário é `400 BAD_DATE`).
- O app guarda o dia da semana com o `getDay()` do JavaScript, **domingo = 0**. Essa numeração só
  importa para **ler** o mapa `week`:

| Dia | ISO | `week` do app (`getDay()`) |
|---|---|---|
| domingo | 7 | **0** |
| segunda | 1 | 1 |
| terça | 2 | 2 |
| quarta | 3 | 3 |
| quinta | 4 | 4 |
| sexta | 5 | 5 |
| sábado | 6 | 6 |

### A janela das datas

- Data declarada é de **hoje até `hoje + 14 dias`**: antes de hoje é `400 DATE_IN_PAST`, mais longe é
  `400 WINDOW_TOO_FAR`, repetida no payload é `400 DUPLICATE_DATE`.
- A régua é **absoluta** (não é "mesma semana ISO"): o cron roda no domingo e planeja a semana que
  começa **no dia seguinte**, que já é outra semana ISO.
- Nenhum dia do passado é reescrito: treino registrado não se reescreve.

### Outros nomes

| Objeto | Formato | Onde |
|---|---|---|
| Relatório da semana (com os porquês) | `relatorio_S<n>_<data>.html` | `~/.hermes/workout/reports/` (só no Hermes) |
| `report_id` no payload | o nome do arquivo, sem caminho | vai só para a auditoria do openGym |
| Chave de idempotência | `sha256(bytes do corpo)` | cabeçalho `Idempotency-Key` (o uid fica no registro) |
| Recibo do escritor | `run=<AAAAMMDD-HHMM>` | cabeçalho `X-OG-Actor` |

## 3. O fluxo completo

```
1. GATILHO      cron do agente: job `treino-planejamento-semanal`, domingo 18:00 (ativo)
                  (o usuário também pode pedir no chat; NÃO existe botão no app — decisão 14/09/2026)
2. GERAÇÃO      o motor lê o meso ativo, a análise fresca e o executado da semana anterior,
                aplica a persona (Low Volume), gera as rotinas com cargas/reps/séries e passa pelo
                portão P1 (faixa 6-8, deload, alta > 10% sem justificativa)
3. RELATÓRIO    escreve o HTML com os porquês (fica no Hermes, é a prova de reflexão)
4. PUBLICAÇÃO   opengym_writer.py publish --uid <uid> --intent semana_S<n>.json --target-live --yes
                  └─ POST /api/plan/micro
                       ├─ 409 PLAN_CONFLICT        → data declarada ocupada: pergunta ao usuário e
                       │                             reenvia com autorizar.datas (ou registra em aberto)
                       ├─ 409 WORKOUT_IN_PROGRESS  → treino vivo no app: espera e repete
                       ├─ 409 STALE_STATE / 428    → relê o rev e repete UMA vez
                       ├─ 400 BAD_*                → corrige o payload (o código diz o campo)
                       └─ 200/201                  → rotinas atualizadas numa escrita só, rev +1
5. LEITURA      o app adota no próximo pull (voltar para a frente, ou boot): as rotinas atualizadas;
                aviso "Plan updated — your own edits were kept."
6. USO          o usuário treina; os treinos entram em workouts[] normalmente (histórico)
7. PRÓXIMA      no fim da semana o ciclo recomeça com S(n+1) — as MESMAS rotinas, conteúdo novo
```

## 4. Invariantes (nunca quebrar)

1. **A lista de rotinas não cresce.** A semana **atualiza os mesmos treinos** (upsert por id); nada é
   apagado e nenhuma rotina nova nasce por semana. O histórico executado vive em `workouts[]`.
2. **Uma gravação por publicação.** As rotinas (e, quando autorizadas, as datas) entram numa escrita
   só; falhou, não gravou nada e o `rev` não mudou.
3. **O `rev` é do servidor.** O agente lê a base e manda `If-Match` com o `rev` lido; base velha =
   `409 STALE_STATE`, nunca sobrescrita. `If-Match: *` é recusado (`412 IF_MATCH_WILDCARD` — conferido
   na própria rota, porque o helper do `routines.js` aceita o curinga).
4. **Identidade assinada, exigida por fato.** `X-OG-Actor` + `X-OG-Actor-Sig` (HMAC sobre
   `t\nMETHOD\npath\nuid\nsha256(corpo)`); sem header a rota responde `401 ACTOR_SIGNATURE_REQUIRED`
   (o `readActor` devolve `verified:"claimed"` sem erro, então a rota exige `"signature"`), inválida é
   `400 BAD_ACTOR_SIG`. O par de chaves é o **arquivo** `/data/agent.key` (ver §8).
5. **Idempotência por conteúdo, com dono.** Mesma chave + mesmo corpo + mesmo perfil, dentro de 24 h
   = replay (`200 replayed:true`), e o replay acontece **antes** da checagem de `rev` — é para isso que
   ele existe. Chave repetida com outro corpo (ou de outro perfil) é `409 IDEMPOTENCY_MISMATCH`. O
   replay também diz `intact`, comparando o **hash de cada rotina publicada**.
6. **O passado não muda, e o dia é do usuário.** A rota nunca escreve `week`. Sem `dias` no payload,
   `dayPlan` não é tocado. Com data declarada e autorizada, escreve **só aquele dia** em `dayPlan`.
   Data já resolvida para outra rotina (por `dayPlan` **ou** por `week`) ou com treino registrado vira
   `409 PLAN_CONFLICT` com `datas[]` (`date`, `current`, `kind`, `from` dayPlan|week, `trained`,
   `wanted`) — sem autorização, nada é aplicado.
7. **Nada é apagado.** Rotina fora do payload continua no estado, com o dia que apontava para ela.
8. **Rotina publicada nasce limpa.** `mode` explícito (`reps`/`time`/`cardio`), sem os valores de
   legado (`mode:"normal"` → `"reps"`, `sg:0` fora), `prog` preservado quando o payload não declara.
9. **A API não julga.** Ela relata a ocupação (`datas[]`) e aplica o que vier em `autorizar`.
   Perguntar, avisar ou desistir é decisão do assistente com o usuário.
10. **Com treino vivo, a publicação espera.** Qualquer sessão em andamento do perfil bloqueia
    (`409 WORKOUT_IN_PROGRESS`), não só quando o payload declara a data de hoje.

## 5. O contrato em uma página

`POST /api/plan/micro` — sessão do dono (`gymsid`) + assinatura do agente, `If-Match: <rev lido>`,
`Idempotency-Key: <sha256 do corpo>`.

```json
{ "meso_id": "meso-2026-09-02", "semana": 3, "report_id": "relatorio_S3_2026-09-15_a_21",
  "routines": [ { "id": "r_push_C_20260829", "name": "Push C - Shoulder 3D", "emoji": "🔺",
                  "prog": "off",
                  "ex": [ { "id": "0326", "sets": 3, "reps": "6-8", "weight": 9, "mode": "reps",
                            "justify": "9 por carga demonstrada (opcional, não vai no corpo)" } ] } ] }
```

- `routines[].dias` é **opcional** e só entra com autorização do usuário; `autorizar.datas` nomeia
  exatamente o que libera. Corpo novo = **chave nova**.
- `justify` (opcional, por exercício) é do **portão P1** do escritor, não do servidor: o `publish`
  tira o campo antes de montar o corpo (senão ele iria para o estado).
- `200 {ok, rev, meta}` na atualização, `201 {ok, rev, meta}` quando **todas** as rotinas do payload
  são novas. `meta` traz `routines`, `criadas`, `trocadas`, `progAntes`/`progDepois`, `datas`,
  `dayPlan` (as datas que passaram a apontar para as rotinas publicadas), `trained`, `idemKey`, `rev`
  antes/depois e os hashes.
- `200 {replayed:true, rev, currentRev, intact}` — a mesma publicação já tinha sido feita; `intact`
  é `false` se alguma rotina publicada sumiu **ou** foi editada depois.
- `409 PLAN_CONFLICT` → `datas[]` (`date`, `current`, `kind` routine|rest|free, `from`, `trained`,
  `wanted`).
- `409 STALE_STATE` → reler o `rev` e repetir uma vez. `409 WORKOUT_IN_PROGRESS` → esperar.
- `401 UNAUTH` / `ACTOR_SIGNATURE_REQUIRED`, `400 BAD_ACTOR_SIG`, `412 IF_MATCH_WILDCARD`,
  `428 IF_MATCH_REQUIRED`, `400` de forma (inclui `WINDOW_TOO_FAR`, `DATE_IN_PAST`, `DUPLICATE_DATE`,
  `BAD_DATE`, `BAD_AUTORIZAR`, `BAD_ROUTINE_ID`, `DUPLICATE_ROUTINE_ID`, `BAD_NAME`, `BAD_EMOJI`,
  `CATALOG_UNKNOWN_EX`).
- Tabela completa: `docs/specs/spec_publicacao_micro.md` (v6).

## 6. Onde cada coisa mora

| O que | Caminho |
|---|---|
| Repo (branch `emerson-custom`) | `/mnt/drivebackup/apps/openGym/openGym` |
| Rota e validação | `api/micro.js` (novo, par do `api/meso.js`) + a rota em `api/server.js` |
| Testes da rota | `api/micro.test.js` (46 casos, roda no alvo `test` da imagem) |
| API em produção | container `opengym-api-1` (compose em `docker-compose.yml`) |
| Estado do perfil | `/mnt/drivebackup/apps/openGym/data/state-<uid>.json` |
| Trilha de auditoria | `/mnt/drivebackup/apps/openGym/data/audit.jsonl` (hash-chain, `GET /api/audit`) |
| Chaves de idempotência | `/mnt/drivebackup/apps/openGym/data/micro-idem.json` (0600, TTL 24 h) |
| Segredo da sessão | `/mnt/drivebackup/apps/openGym/data/secret` (root 0600) |
| Chave do agente (assinatura) | `/mnt/drivebackup/apps/openGym/data/agent.key` (root 0600) |
| Meso ativo e histórico | `~/.hermes/workout/planos/` (`mesociclo_ativo.json`, `historico/`) |
| Relatórios com os porquês | `~/.hermes/workout/reports/` |
| Escritor / cliente | `~/.hermes/workout/scripts/opengym_writer.py` (subcomando `publish`) |
| Portão P1 (política de treino) | `~/.hermes/workout/scripts/verificar_prescricao.py` |
| Mecânica de pesos | `~/.hermes/workout/MECANICA_PESOS.md` |

## 7. Como consultar e como operar

```bash
# o que o motor vê hoje: rotinas (com o id de cada uma), revisão e datas
opengym_writer.py dump --uid <uid>
opengym_writer.py dump --uid <uid> --routine r_push_C_20260829

# o que a publicação faria, sem escrever (imprime corpo canônico, chave e rev lido; roda o portão P1)
opengym_writer.py publish --uid <uid> --intent semana_S3.json --dry-run

# publicar de verdade (exige --uid, --target-live em produção e --yes)
opengym_writer.py publish --uid <uid> --intent semana_S3.json --target-live --yes
```

O `--intent` do `publish` é **o corpo da publicação, sem embrulho**, e é **substituição total** por
rotina (o oposto do intent do `apply`, que é delta):

```json
{ "meso_id": "meso-2026-09-02", "semana": 3,
  "routines": [ { "id": "r_push_C_20260829", "name": "Push C - Shoulder 3D", "emoji": "🔺",
                  "ex": [ { "id": "0326", "sets": 3, "reps": "6-8", "weight": 9, "restSec": 90,
                            "justify": "só quando o portão P1 pedir" } ] } ] }
```

```bash
# o que o servidor registrou da última publicação (idemKey incluída)
curl -s -b "gymsid=<sessão>" https://opengym.edsc.fun/api/audit?limit=1 | jq '.entries[0]'
docker logs opengym-api-1 --tail 20 | grep -e publish-micro -e og-micro

# deploy: testes no alvo `test` da imagem, build local, recriação sem pull
cd /mnt/drivebackup/apps/openGym/openGym
docker build --target test -f api/Dockerfile .          # a imagem de produção apaga os *.test.js
docker inspect --format '{{.Image}}' opengym-api-1      # anote: é o rollback
docker compose build api web
docker compose up -d --force-recreate --pull never api web
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://opengym.edsc.fun/api/plan/micro   # 401, não 404
```

**Nunca `docker compose pull`** — e o serviço `api` tem `pull_policy: never` justamente porque o
`up -d` puxaria `latest` de `ghcr.io/duartesantos8/opengym-api`, de outro namespace, que **não** tem
esta rota nem o `readActor`. Rollback: retag da imagem anotada + `up -d --force-recreate --pull never api`.

Códigos de saída do escritor: `0` ok/replay (e ensaio `--dry-run` que passa) · `1` payload inválido
(não é para repetir igual) · `2` decisão necessária: `PLAN_CONFLICT` (data ocupada, pergunta ao usuário)
ou `WORKOUT_IN_PROGRESS` (espera) ou portão P1 FALHA no `apply` (item/portão) · `3`
credencial/ambiente · `4` base mudou (`STALE_STATE`, `428`, `412`) · `5` rede/timeout/5xx · `6`
verificação pós-escrita · `7` falta `--yes` numa tentativa de escrita. A trava de alvo
(`--target-live`, exigida fora de localhost nos três modos) sai `1`, como sempre saiu.

## 8. O que ainda não existe, e o que é de quem

- **O gatilho no app NÃO existe e não vai existir** (decisão do usuário 14/09/2026): nada de botão
  "Gerar micro", nada de stepper da Fase 2 no app, nada de `hermes_api.py` (FastAPI 8091) nem de proxy
  `/api/hermes/*`. A BACKLOG-02 foi cancelada como desenho. Quem dispara é o **cron do agente**
  (`treino-planejamento-semanal`, domingo 18:00) ou o usuário pedindo no chat.
- A **geração** em si (prompt, persona, análise) é do motor, no Hermes; este documento cobre a
  publicação e a nomenclatura.
- **Os dias são do usuário.** O assistente só escreve uma data depois de perguntar e ouvir sim; em
  execução sem usuário na sessão (cron), ele registra a pergunta e publica sem `dias`.
- **Política do assistente** (quando perguntar, o que fazer com treino faltado): definida pelo usuário
  com o assistente, **fora** desta documentação e da spec da API.
- **Aposentar rotinas antigas**: decidido não fazer. Se um dia mudar, muda aqui primeiro.
- **Rotação do `SECRET`**: o cliente assina com `HMAC(SECRET,"opengym-agent-v1")` e o servidor confere
  com `/data/agent.key`, que só é regenerado quando o arquivo some. Apagar `data/secret` sozinho gira
  a chave do lado do cliente e o servidor passa a responder `400 BAD_ACTOR_SIG` para sempre: apague
  `data/agent.key` junto.
- **`audit.jsonl` e `micro-idem.json` não entram no snapshot** das 06:00 (que copia `state-*.json` e
  `db.json`). É a família da BACKLOG-13.
- **`If-Match: *` continua aceito no `PUT /api/plan/meso`** (o `checkIfMatch` trata o curinga como
  válido); a rota do micro confere à mão e devolve `412`. Item próprio: BACKLOG-19.
