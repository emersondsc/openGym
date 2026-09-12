# Spec: escritor de rotinas — script reutilizável com `--dry-run` (lado Hermes) — v4 (final)

> Implementa o **"meio-caminho barato"** da BACKLOG-07 (`docs/backlog.md:90`) e o passo 6 da
> `~/.hermes/skills/fitness/treino-coach/SKILL.md` (`:225-234`): hoje o escritor é montado à mão
> a cada sessão e a segurança vem de uma receita em prosa. Esta spec substitui isso por **um**
> script python3 de biblioteca padrão, dirigido por **intenção declarativa**, com snapshot,
> portão P1 fail-closed, verificação API==disco e recibo.
>
> **Par:** `docs/specs/spec_api_rotinas.md`. Ver "Relação com a outra spec".
>
> **Revisão 1 (subagente revisor, contra o código real):** 24 achados, 7 bloqueantes. O que mudou
> de desenho: **a garantia de concorrência foi reescrita** (o guard do servidor é `incoming < cur._ts`,
> então enviar um `_ts` novo *sempre passa* — o script passa a enviar **o `_ts` lido como base**, o
> que faz do `409` um teste de igualdade real); **a união de `workouts[]` virou cinto de segurança
> documentado** (com o aborto por base mudada ela é, por construção, uma no-op); **o portão ganhou
> `--baseline`/`--draft`/`--no-p1`** com semântica explícita em vez de reuso ambíguo do `--intent`;
> **o modo de escrita é sondado, não inferido**; e **`prog` saiu do formato de intenção** (o portão
> P2 recusa qualquer coisa fora de `off`, então deixá-lo declarável era um conflito embutido).
> Mapa completo no fim do documento.

## Contexto e Objetivo

**Onde vive:** `~/.hermes/workout/scripts/` no hermes (Pi). Não é repositório git — o corpus é
versionado pelo snapshot diário (`emersondsc/hermes-snapshot`, BACKLOG-08). O que o script escreve
é o **estado do app**, via `PUT https://opengym.edsc.fun/api/data` (ou o fallback local
`http://localhost:8081/api/data`) com sessão forjada por HMAC do `SECRET` — receita em
`~/.hermes/skills/fitness/opengym-workout-pipeline/references/og_state_mutation.md`.

**O problema.** Um `PUT /api/data` manda o **estado inteiro**, então quem escreve precisa montar o
objeto completo à mão num script temporário por sessão. A proteção contra estrago não está no
código: está numa receita em prosa ("snapshot", "handshake", "re-GET", "união de `workouts[]`",
"portão P1", "verificação campo a campo", "recibo"). O próprio recibo registra que a receita
**falhou** pelo menos uma vez — `~/.hermes/workout/reports/sync_log.md:16`: *"Handshake: PWA fechado
NAO confirmado pelo usuario antes do PUT (desvio do protocolo)"*. Prosa não é portão.

**O que muda.** Passa a existir **um** script, `opengym_writer.py`, que recebe uma **intenção**
(qual rotina, qual exercício, quais campos) em vez do estado inteiro, e executa a sequência
snapshot → portão → 1 escrita → verificação → recibo. O agente declara o que quer; o script garante
que **ou sai inteiro, ou não sai nada** — e prova os dois casos.

**O que NÃO muda nesta entrega.** O canal de escrita continua o `PUT /api/data` (Spec B ainda não
existe). O script já nasce com o caminho novo (`PATCH /api/routines/:id`) pronto para ser ligado
por **sondagem** (A7), sem alterar o formato dos recibos.

## Escopo

**Inclui:**
- `~/.hermes/workout/scripts/opengym_writer.py` (novo, python3 stdlib, ~650 linhas) com os
  subcomandos `apply`, `plan`, `doctor`, `dump`.
- Formato da **intenção declarativa** (`--intent arq.json` ou `--json '{...}'`), com `patch`,
  `unfreeze` e `noop`.
- Snapshot datado (API + disco), `sha256` do estado, hashes de invariante por subárvore, e rollback
  definido como 1 escrita do snapshot.
- Pré-voo: `SECRET` legível, `GET` autenticado 200 com estado não-nulo, aborto se `S.active`, aborto
  se a base mudou entre a leitura e a escrita.
- `workouts[]` como **união por id** (nunca substituição) e `week`/`dayPlan`/`exWeights`/`customEx`/
  `bodyweight` transportados byte a byte.
- Portão `verificar_prescricao.py` antes de aplicar (fail-closed), com três argumentos novos no
  portão (§5) — hoje ele só sabe auditar o arquivo vivo, e o `--intent` dele tem semântica
  *invertida* do nome.
- Verificação campo a campo contra API **e** disco (`API≠disco = falha aberta`).
- Recibo em `~/.hermes/workout/reports/sync_log.md` no formato atual (`sync_log.md:2-17`), ancorado
  no **fim** do arquivo (a linha 1 de hoje é vazia).
- `--dry-run` que imprime o diff **e o que a tela vai mostrar**, sem escrever.
- `doctor` (auditoria read-only do estado contra os contratos) e a conferência de mídia
  (`img`/`gif`) dos itens **adicionados**.
- Testes com fixtures, servidor de mentira local e um `db.json` de fixture (§8).

**Não inclui (e não pode incluir):**
- **Decisão de treino.** Quando perguntar ao usuário, o que fazer com um treino faltado, qual carga
  escolher, se troca um exercício: é trabalho do agente, não do script. O script **materializa** o
  que foi declarado e **recusa** o que não consegue garantir. (Decisão do usuário, 11/09/2026:
  "a infraestrutura de api para o agente usar como ele achar melhor".)
- **`prog` (progressão automática).** O portão P2 recusa qualquer `prog` fora de `off`/ausente em
  `verificar_prescricao.py:72-74`, e `MECANICA_PESOS.md:21` diz que o planejador mantém `off`
  enquanto prescreve. `prog` **saiu** do formato de intenção (§2): deixá-lo declarável criaria a
  contradição "campo permitido que o portão sempre reprova". A API de rotinas continua aceitando
  `prog` (Spec B §4.3) para uso do editor; este script não escreve esse campo.
- API de rotinas, validação no servidor, identidade e token de concorrência — isso é a
  `spec_api_rotinas.md`. Aqui só se **consome** o que existe hoje.
- Micro/meso via app (BACKLOG-02/03), `S.unit` por exercício (BACKLOG-01), fonte única do protocolo
  (BACKLOG-08).
- Qualquer escrita em `S.exWeights`, `S.workouts`, `S.week`, `S.dayPlan`, `S.bodyweight`,
  `S.customEx`, `S.unit` e nas chaves de ajuste (`restSec`, `globalRestSec`, `theme`, `lang`,
  `reminder`, …) — o script **prova** que não tocou (RF-11).

## Decisões do usuário (produto)

| # | Decisão | Efeito visível |
|---|---|---|
| U1 | **O que o usuário faz no app vence o que o assistente escreveu** (11/09/2026) | Se você mexeu no app depois do assistente, sua versão prevalece e o app avisa que descartou a mudança do assistente; você pode pedir o plano de novo |
| U2 | O **comportamento do agente** (quando perguntar, o que fazer com um treino faltado, o que escolher) fica fora desta spec | Nada muda no dia a dia do treino por causa destes documentos; eles criam a infraestrutura |
| U3 | **Quando a API de rotinas (Spec B) estiver publicada, o script passa a usá-la sozinho, na sessão seguinte, sem pedir autorização a cada vez** (11/09/2026) | Você publica a API uma vez; a próxima sessão do assistente já escreve pela porta nova (manda só o que muda, em vez do plano inteiro) e o registro no servidor fica completo. Sem passo novo para você, e nada muda na tela |
| U4 | **A trava manual continua existindo** (11/09/2026, junto da U3) | Se em algum momento você quiser segurar o assistente no caminho antigo — deixar a API no ar sem ninguém escrever por ela — existe `--mode put`: comando de quem opera, não pergunta ao usuário |

`U1` tem consequência direta no escopo do script (§4.6 e RF-4): o script **nunca** força a
prescrição por cima da versão do app. Se a base mudou durante a execução, ele **aborta** e diz que
abortou — quem decide insistir é o agente, com o usuário presente.

`U3`/`U4` são o par que fecha a passagem de um caminho para o outro: **automática** (não depende de
alguém lembrar de ligar) e **reversível** (uma bandeira segura). O *como* dessa detecção é a **A7**.

## Decisões assumidas

Decididas por mim por serem detalhe de implementação. Nenhuma muda o que o usuário vê — exceto onde
indicado.

- **A1 — Subcomandos em vez de flags.** `apply` (escreve), `plan` (**read-only**: mostra o que o
  `apply` faria), `doctor` (**read-only**: audita o estado vivo contra os contratos) e `dump`
  (imprime o JSON de uma rotina para o agente montar a intenção). Sem subcomando, `argparse`
  imprime o uso e sai com código 1. Efeito visível: nenhum.
- **A2 — Biblioteca padrão apenas** (`argparse`, `json`, `hashlib`, `hmac`, `base64`, `os`, `re`,
  `shutil`, `subprocess`, `sys`, `time`, `urllib.request`, `urllib.error`, `ssl`, `datetime`).
  Sem `requests`, sem `pytest` (não existe no Pi — verificado: `command -v pytest` → vazio; Python
  3.12.3). Motivo: o script roda em produção no Pi e precisa sobreviver a `apt`/`pip` indisponíveis.
- **A3 — O script escreve em `reports/` do Hermes, nunca em `data/`.** O snapshot de disco é um `cp`
  de leitura para `~/.hermes/workout/reports/snapshots/`; nada em
  `/mnt/drivebackup/apps/openGym/data/`. O `state-<uid>.json` é `root:root 0644` e o `secret` é
  `root:root 0600` (medido em 11/09/2026): o usuário `pi` **lê** o estado e **não** escreve nele —
  é o que mantém a escrita no caminho da API.
- **A4 — `--dry-run` é o default não declarado.** `apply` sem `--yes` executa tudo até antes da
  escrita, imprime o mesmo relatório de `--dry-run` e para com "nada foi escrito; repita com
  `--yes`" (código **7**, separado do 4 — ver F18 no mapa de revisão). Evita que um comando colado
  pela metade escreva.
- **A5 — O agente key** (auditoria). O script manda o cabeçalho
  `X-OG-Actor: agent=hermes; tool=opengym_writer; run=<run-id>` e, **se** `/data/agent.key` existir,
  `X-OG-Actor-Sig: t=…; v1=…` (HMAC-SHA256 do payload canônico). É para **atribuição**, não para
  sigilo: o Hermes já lê o `SECRET`, então não há segredo a proteger. O contrato completo está em
  `spec_api_rotinas.md` §4.4; a limitação (sem assinatura, `verified: claimed` não é prova de
  identidade) está declarada lá e repetida no recibo (`actor_verified=`).
- **A6 — O uid é obrigatório na linha de comando.** `apply`/`plan`/`doctor`/`dump` **exigem**
  `--uid` (ou `$OPENGYM_UID`), sem "descobrir sozinho": `db.json` usa 1 uid, mas o disco tem
  **dois** perfis com estado (`state-ZPJbmYUfHlfbAYzi.json` e `state-ic0CN_Bt0pbZwB-c.json`, medido
  em 11/09/2026) e o `og_state_mutation.md:90` registra a armadilha ("Emerson tem ic0CN_* e ZPJb_*,
  only ZPJb has routines"). Se o `db.json` tiver mais de um usuário, o script **recusa** sem
  `--allow-any-uid`. Escrever no perfil errado é o pior modo de falha possível: não há rollback do
  perfil errado no recibo.
- **A7 — O modo de escrita é sondado, não inferido** (o *porquê* é a **U3**: a passagem é
  automática, e é isto que a implementa). Com a Spec B no ar, `PATCH /api/routines/:id`
  é melhor (escrita parcial, token de verdade); enquanto ela não existe, o cliente HTTP devolve
  `404 not found` para qualquer `PATCH`. Então: `apply` chama `GET /api/routines` e usa o modo
  `patch` **somente** se receber `200` com `{routines:[...], rev:...}`; qualquer outra resposta
  (404, 401, JSON sem `rev`) mantém o modo `put`. `--mode put|patch|auto` força a mão (default
  `auto`). Não se detecta por `state.rev` (um `rev` qualquer num estado de terceiro ligaria o modo
  errado — foi o achado F04 da revisão).
- **A8 — Fuso do run-id e do carimbo: UTC.** `run-id = YYYYMMDD-HHMMSS` em UTC; a linha do recibo
  usa a data local **derivada** (`time.localtime()`), não um offset fixo (`-03` muda com horário de
  verão).
- **A9 — Nome do arquivo de snapshot unifica a convenção existente.** Os snapshots de hoje são
  `reports/sync_snapshot_<ts>.json` (`sync_log.md:7,12`). O script usa
  `reports/snapshots/sync_snapshot_<run_id>.json`, dentro de uma subpasta para não poluir
  `reports/`, mantendo o prefixo `sync_snapshot_` que o recibo antigo já cita.
- **A10 — Nenhuma carga é arbitrada.** Regra do passo 6 (`SKILL.md:230`): *valor não-numérico do
  relatório = item EXCLUÍDO do PUT (fail-closed, nunca arbitrar carga)*. No script isso deixa de ser
  virtude do operador e passa a ser invariante de código: campo inválido ou ambíguo → o item entra
  em `excluidos[]` **e o script aborta a escrita** (não existe modo "aplicar o resto"), porque uma
  escrita parcial silenciosa é exatamente o modo de falha do incidente de 08/09/2026. **Duas listas
  distintas no relatório:** `excluidos[]` **bloqueia** (código 2); `media_missing[]` **avisa**
  (código 0) — mídia ausente não bloqueia treino, por decisão já registrada em
  `treino-coach/SKILL.md:30`.
- **A11 — Bug de forma corrigido no portão, não contornado no script.**
  `verificar_prescricao.py` precisa de três ajustes (§5): os caminhos por variável de ambiente, o
  `--baseline` (nome honesto para o que hoje se chama `--intent`) e o `--draft`. O script **não**
  copia o arquivo vivo para `/tmp` — isso é corrida com o app. **`--no-p1` foi descartado** (era o
  F06 da revisão: pular o P1 apagaria justamente a checagem que interessa, e o P4e depende das
  mesmas variáveis). No lugar, o `--draft` **mantém o P1** e a comparação passa a ser
  "tela == campos declarados na intenção" (§5.2).
- **A12 — Suíte de testes própria.** `test_escritor_rotinas.py` com `unittest` (stdlib), rodado por
  `python3 test_escritor_rotinas.py`. Sem `pytest` (A2).
- **A13 — `S.active` presente = aborto, sem override.** Hoje o protocolo já diz "abortar se
  `S.active` presente (usuário treinando)" (`SKILL.md:226`), mas não há flag que force. Não vai
  haver: a única saída é o usuário terminar o treino. **Efeito visível:** o agente pode dizer "você
  está treinando agora, fecho o plano quando você terminar" — e isso é o sistema funcionando.
- **A14 — Mídia conferida só no que a intenção adiciona.** Conferir `img/gif` de todos os
  exercícios de todas as rotinas custa leitura de um diretório de ~140 MB por execução. O portão de
  mídia roda **por item adicionado**; `doctor` confere tudo, quando o agente quiser.
- **A15 — O `mode` legado é preservado, nunca normalizado.** O estado real tem
  `"mode":"normal"` em **100%** das entradas de template (medido em 11/09/2026), e `modeOf` o lê
  como `reps` (`frontend/src/lib/history.js:14-18`). O script preserva a string original byte a byte
  (mesma regra de `sg: 0`) e **recusa** declarar `"normal"` como valor novo. Normalizar
  `"normal"→"reps"` mudaria o arquivo do app por conta própria — decisão do dono do dado, não do
  script.
- **A16 — `api_delete()` entra agora, mesmo sem chamador.** É a função que a Spec B habilita
  (apagar rotina) e a que o `doctor` vai querer para `--fix` no futuro; fica marcada no código como
  `# preparado para a Spec B; sem chamador nesta versão`. Registrado aqui para o revisor não
  confundir com escopo morto.

## Requisitos Funcionais

- **RF-1.** O script recebe **uma intenção declarativa** com a lista de itens a tocar e, para cada
  um, **apenas os campos que mudam**. O merge é **sobre o item existente**: o dicionário atual do
  exercício (ou da rotina) é a base, e só os campos declarados o substituem. Campos não citados
  permanecem — inclusive `mode`, `sg`, `restSec`, `inc` — **sem normalização**. **Nada é inferido de
  ausência**: omitir nunca significa apagar.
- **RF-2.** Antes de qualquer coisa, o script grava um **snapshot datado** do estado lido (API +
  cópia de disco) e imprime o caminho e o `sha256`. Rollback documentado no recibo = **1 escrita do
  snapshot** com base fresca.
- **RF-3.** Pré-voo obrigatório, nesta ordem, com aborto no primeiro que falhar: (a) `SECRET`
  legível; (b) `GET /api/data` autenticado devolvendo `200` com `state` **objeto** (o servidor
  devolve `200 {state:null}` quando o arquivo não existe — `api/server.js:424-431` — e isso não é
  "estado vazio", é aborto); (c) `S.active` ausente; (d) `customEx`/`routines`/`workouts` com as
  formas esperadas; (e) divergência `API` × disco ausente (comparação por `sha256` do JSON
  canônico).
- **RF-4.** O script **aborta sem escrever** se a base mudou entre a leitura e a escrita: compara
  `_ts` (e `rev`, quando existir) do estado lido com o do estado fresco, e — no modo `put` — envia
  como `_ts` do payload **exatamente o número lido**, de modo que o guard do servidor
  (`incoming < cur._ts` → `409`, `api/server.js:446-448`) funcione como teste de **igualdade**.
  Não existe "insistir": a mensagem mostra os dois carimbos e pede nova leitura.
- **RF-5.** `workouts[]` do payload é a **união por id** de (workouts da base fresca) ∪ (workouts do
  snapshot). Com o RF-4 garantindo base idêntica, a união é, por construção, uma no-op — ela existe
  como cinto de segurança para o modo `patch` e para uma futura re-leitura sem aborto, e o recibo
  diz quantos ids cada lado tinha.
- **RF-6.** O portão `verificar_prescricao.py` roda **antes** da escrita, sobre o estado que
  resultaria da intenção, com `--draft` e `--baseline`. Só se `VEREDITO: OK` a escrita acontece.
  Qualquer `FALHA` = aborto com a tabela impressa e o código 2 — **inclusive quando a falha é de um
  item que a intenção não citou** (o portão audita o estado inteiro; um estado já inválido não
  pode receber escrita nova).
- **RF-7.** A escrita é **uma só** por rotina tocada, com `X-OG-Actor` (e assinatura, se houver
  chave). Vale apenas com `{ok:true}` **e** carimbo de resposta compatível com o enviado. Timeout,
  `401` ou `409` = falha.
- **RF-8.** Depois da escrita, o script re-lê da API **e** do disco e compara **campo a campo** os
  itens que a intenção tocou, mais os invariantes do RF-11. Divergência `API≠disco`, ou qualquer
  invariante violado = **falha aberta**: o recibo registra falha e o comando sai com código 6.
- **RF-9.** Toda execução com escrita termina com um **recibo** anexado ao **fim** de
  `~/.hermes/workout/reports/sync_log.md` no formato atual (cabeçalho com data/executor, `base_ts`,
  `new_ts`, `resp`, `diff`, `verificacao=OK hash=…`, `handshake`, `rollback`), precedido de uma
  linha em branco se o arquivo não terminar em duas quebras. Recibos **antigos não são reescritos**.
- **RF-10.** Com `--dry-run` (ou sem `--yes`), **nada é escrito** — nem estado, nem `sync_log.md`.
  A **validação roda igual** (itens, portão, base) e o resultado manda no código de saída: falha de
  item ⇒ 2; base mudada ⇒ 4; tudo ok sem `--yes` ⇒ 7. A saída tem três blocos: (1) o diff campo a
  campo, (2) a tabela do portão P1 (o que a tela vai mostrar por rotina × exercício), (3) o que vai
  para o recibo.
- **RF-11.** Invariantes provados antes e depois de toda escrita, por `sha256` de subárvore
  canônica **registrado no `.meta.json` antes da escrita** (não só no recibo, que não tem o "antes")
  : `exWeights`, `week`, `dayPlan`, `bodyweight`, `customEx`, `unit` e todas as chaves de ajuste.
  Chaves voláteis (`_ts`, `rev`) ficam **fora** de cada hash de subárvore. Também: `workouts` só
  pode **crescer** (nenhum id presente antes pode desaparecer depois).
- **RF-12.** O script **não cria valor nenhum**: campo não numérico, fora da faixa permitida
  (Spec B §4.3) ou ambíguo → o item entra em `excluidos[]` e **a escrita não acontece** (A10).
- **RF-13.** Exercício congelado (`0585` e `0599`) não pode ter o peso alterado sem
  `--allow-frozen`, que por sua vez exige `justify` no item, registrado no recibo. O valor de
  referência é **o que está no estado**, por rotina × exercício (hoje `200` nas quatro entradas de
  Legs 1 e Legs 2) — **não existe conversão de unidade**: `weight` está na unidade do perfil
  (`S.unit`, hoje `kg`), e "200 lb" do texto da skill é rótulo do coach, não uma unidade do app
  (`api/coach.js` é quem converte lb→kg na análise — `docs/backlog.md:8`).
- **RF-14.** Os subcomandos `plan` e `doctor` são **read-only por construção** (nenhum caminho de
  código deles chama a função de escrita) e servem de auditoria para o agente antes de propor algo.
- **RF-15.** Toda falha sai com **código de saída distinto por classe** (§4.8) e mensagem de uma
  linha em PT-BR no `stderr`, para o agente poder ramificar sem interpretar texto.

## Detalhe de Implementação (nível código)

### 1. Arquivo novo: `~/.hermes/workout/scripts/opengym_writer.py`

```python
#!/usr/bin/env python3
"""opengym_writer.py — escritor de rotinas do openGym dirigido por intenção.

Substitui o script temporário por sessão descrito em
references/og_state_mutation.md (protocolo endurecido 2026-09-08) e no passo 6 da
treino-coach/SKILL.md. Biblioteca padrão apenas.

Uso:
  opengym_writer.py dump   --routine r_leg1_20260823 --uid UID
  opengym_writer.py plan    --intent i.json --uid UID    # read-only: mostra o diff
  opengym_writer.py doctor  --uid UID                    # read-only: audita o estado
  opengym_writer.py apply   --intent i.json --uid UID [--yes] [--dry-run]
                            [--allow-frozen] [--mode auto|put|patch] [--allow-any-uid]

Saída 0 = ok | 1 = uso/intenção inválida | 2 = item excluído / portão P1 falhou
      3 = ambiente (SECRET/GET/active/state null) | 4 = base mudou
      5 = rede/escrita falhou | 6 = verificação pós-escrita divergiu
      7 = escrita autorizada mas --yes ausente (nada foi escrito)
"""

SCHEMA = 1
REPORTS = Path(os.environ.get("OPENGYM_REPORTS", "/home/pi/.hermes/workout/reports"))
GATE = Path(os.environ.get("OPENGYM_GATE", "/home/pi/.hermes/workout/scripts/verificar_prescricao.py"))
DATA_DIR = os.environ.get("OPENGYM_DATA_DIR", "/mnt/drivebackup/apps/openGym/data")
SECRET_DEFAULT = os.path.join(DATA_DIR, "secret")
CATALOG = os.environ.get("OPENGYM_CATALOG", "/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json")
CATALOG_EXPECTED = 1324
MEDIA = os.environ.get("OPENGYM_MEDIA", "/mnt/drivebackup/apps/openGym/media")
FROZEN = {"0585", "0599"}
MAX_SETS, MAX_WEIGHT, MAX_REPS, MAX_SEC = 20, 1000, 100, 3600
```

> **`OPENGYM_DATA_DIR`, não `OPENGYM_DATA`** (F09 da revisão): `OPENGYM_DATA` é usado por
> `opengym_reader.py:31` para o diretório de dados do app, e um contexto que herde essa variável
> apontaria a checagem `API×disco` para o lugar errado. O nome novo é exclusivo deste script, e
> **todo relatório imprime os caminhos resolvidos no cabeçalho** (data dir, catálogo, reports,
> gate), o que torna um ambiente errado visível na primeira linha.

Blocos internos, cada um com função única e testável:

| bloco | função | responsabilidade |
|---|---|---|
| credencial | `load_secret()`, `forge_session(uid, sv)`, `agent_key_from_secret()` | ler `SECRET` (via `sudo -n cat` se `PermissionError` — igual a `opengym_reader.py:71-76`), montar `uid:exp:sv` + HMAC base64url, e **derivar** a chave do agente do `SECRET` (A5: o script nunca lê `/data/agent.key`, que é `0600 root`) |
| HTTP | `api_get()`, `api_put()`, `api_patch()`, `api_delete()` | `urllib.request`, `Cookie: gymsid=…`, `X-OG-Actor[-Sig]`, timeout 15 s, sem trocar de host em redirect; `api_delete` marcada como preparo da Spec B (A16) |
| leitura | `read_api_state()`, `read_disk_state()`, `canonical_bytes()`, `sha256()`, `subtree_hashes(S)` | estado pela API e em disco; canon = `json.dumps(..., sort_keys=True, ensure_ascii=False, separators=(",",":"))`; hashes de invariante por subárvore (RF-11) |
| snapshot | `write_snapshot(state, disk, run_id)` | `reports/snapshots/sync_snapshot_<run_id>.json` + `.disk.json` + `.meta.json` (com `invariants_before`), em `tmp` + `os.replace`; **recusa (exit 3) se `REPORTS` estiver sob `DATA_DIR`** — é o que faz da A3 um invariante de código e não uma promessa |
| intenção | `load_intent()`, `validate_intent()` | JSON; checa `schema`, `op`, tipos; recusa campo desconhecido |
| merge | `merge_patch(state, op)`, `apply_removals()`, `cleanup_sg(ex)`, `strip_mode_fields(e, mode)`, `union_workouts(base, snap)` | merge sobre o item existente; remoção com limpeza de superset; união por id; troca de `mode` remove os campos do modo anterior (§4.4) |
| regras | `load_catalog(path)`, `build_media_index(media_dir, ids)`, `validate_items(draft, intent, catalog, media)`, `validate_item()`, `REGEX_FAIXA` | o conjunto de §4.4 (igual à Spec B §4.3). `build_media_index` indexa **só os ids que a intenção adiciona** (A14) e devolve o conjunto dos que não têm `img`/`gif`; `validate_items` devolve `{excluidos, media_missing, erros}` |
| portão | `run_gate(draft_path, baseline_path, justify, uid)` | `subprocess.run([sys.executable, GATE, "--draft", draft, "--baseline", base, "--intent-json", intent, "--justify", j], env={**os.environ, "OPENGYM_UID": uid, "OPENGYM_DATA_DIR": DATA_DIR})` — **o uid resolvido vai explícito no `env`** (N06), senão o portão auditа outro perfil; exige `VEREDITO: OK` |
| escrita | `perform_write(payload, base, mode, actor)` | `PATCH` por rotina se `mode == "patch"`, senão um `PUT`; valida `{ok:true}` e o carimbo |
| verificação | `verify_after(intent, before, after_api, after_disk)` | campo a campo dos itens tocados + invariantes (RF-11) |
| recibo | `append_receipt(lines)` | append no fim de `sync_log.md` (nunca reescrever) |
| tela | `screen_view(state, routine_ids)` | reproduz a precedência publicada (`MECANICA_PESOS.md:7-16`) para imprimir "o que a tela vai mostrar" |
| CLI | `cmd_apply/plan/doctor/dump`, `main()` | argparse, exit codes |

### 2. Formato da intenção

`--intent caminho.json` ou `--json '{…}'`. Esquema fechado (campo desconhecido = erro de uso):

```json
{
  "schema": 1,
  "created": "2026-09-11T14:02:00Z",
  "actor": "hermes",
  "summary": "S3 template: +2,5kg no desenv, 0326 sobe p/ 9 no Upper",
  "op": "patch",
  "patch": {
    "r_upper_C_20260829": {
      "name": "Upper C - Shoulder 3D",
      "emoji": "🔺",
      "ex": {
        "0326": { "weight": 9, "justify": "provei 9 na ultima sessao (08/09)" },
        "0762": { "weight": 25 },
        "0585": { "weight": 210, "justify": "pedido explicito do usuario no chat" }
      },
      "exRemove": []
    }
  },
  "unfreeze": ["0585"],
  "noop": ["r_leg1_20260823", "r_leg2_20260823"]
}
```

| campo | regra |
|---|---|
| `schema` | obrigatório, exatamente `1` |
| `op` | um de `patch`, `unfreeze`, `noop` (string, não lista) — uma intenção, uma operação (RF-1) |
| `patch` | objeto `routineId → {name?, emoji?, ex?, exRemove?}`; pelo menos um item |
| `patch[rid].ex` | objeto `exId → {campos…, justify?}`; **merge sobre o item existente**, não substituição |
| `patch[rid].exRemove` | lista de ids a **remover**; id ausente da rotina = erro 1 (não adivinha) |
| `unfreeze` | lista de ids congelados que a intenção pretende alterar; sem ela, RF-13 aborta |
| `noop` | lista de rotinas que a intenção **deliberadamente não toca**; vai para o recibo |
| `justify` | texto livre **por exercício**, dentro do item; a chave montada para o portão é `"<rid>:<eid>"` (o formato que `verificar_prescricao.py:109-112` espera) |
| **`prog`** | **não é um campo do formato** (ver "Não inclui"): declarar `prog` é erro 1, com a mensagem apontando `MECANICA_PESOS.md:21` |

**O que a ausência significa** (o ponto que mais erra na mão): `ex` vazio ⇒ **nada muda**; `exRemove`
ausente ⇒ **nada é removido**; `ex` com id que não está na rotina ⇒ **adiciona** o exercício (com
todos os campos obrigatórios do modo declarado); `exRemove` com id que não está ⇒ **erro 1**.

### 3. Ordem de execução do `apply` (o coração)

```python
def cmd_apply(a):
    uid    = resolve_uid(a)                     # 1  --uid obrigatorio (A6) -> exit 1
    intent = load_intent(a)                     # 2  -> exit 1
    secret = load_secret(a)                     # 3  -> exit 3  (ANTES da sondagem: um 401 aqui e credencial)
    mode   = probe_mode(a, uid, secret)         # 4  GET /api/routines com a sessao -> "patch" | "put" (A7)
    base   = read_api_state(uid, secret)        # 5  -> exit 3 (nao-200, state null)
    disk   = read_disk_state(uid)               # 6  -> exit 3 se ausente/ilegivel
    preflight(base, disk)                       # 7  -> exit 3 (active, API!=disco, formas)
    snap   = write_snapshot(base, disk, run_id) # 8  RF-2 (inclui invariants_before)
    fresh  = read_api_state(uid, secret)        # 9  leitura final, ANTES do portao
    if stamp(fresh) != stamp(base):             # 10 RF-4 / E17: base mudou = o ensaio nao vale mais
        die(4, f"base mudou ({stamp(base)} -> {stamp(fresh)}); releia e refaca a intencao")
    draft  = merge_patch(base, intent)          # 11 RF-1 (base = item existente; so as tocadas)
    catalog, media = load_catalog(CATALOG), build_media_index(MEDIA)   # 12 (A14: indice do disco)
    bad    = validate_items(draft, intent, catalog, media)             # 13 -> exit 1/2
    if bad.excluidos: report_excluidos(bad); die(2, "itens invalidos — nada foi escrito (A10)")
    gate   = run_gate(draft, base, intent.justify_map(), uid)          # 14 -> exit 2
    print_report(intent, base, draft, gate)     # 15 diff + tela + recibo (3 blocos)
    if a.dry_run or not a.yes:
        return 7                                # 16 RF-10: validado, NAO escrito
    payload = build_payload(fresh, draft, intent)   # 17 uniao de workouts (RF-5), SO as rotinas tocadas
    resp    = perform_write(payload, fresh, mode, actor)   # 18 RF-7: o carimbo e o de `fresh` -> exit 5
    after_api, after_disk = read_api_state(uid, secret), read_disk_state(uid)   # 19
    ok, diverg = verify_after(intent, base, after_api, after_disk)             # 20 RF-8
    append_receipt(receipt_lines(intent, base, snap, resp, gate, ok))          # 21 RF-9
    return 0 if ok else 6
```

Pontos que **não** podem ser "otimizados" na implementação:

- **A leitura final (passo 9) é a última leitura antes da escrita (passo 18), e o carimbo que vai no
  payload é o dela (`fresh`) — `base` serve só para comparar (passos 10 e 20).** No modo `put`, é
  isso que transforma o guard `incoming < cur._ts` do servidor em teste de igualdade (RF-4). Passar
  `base` como carimbo anularia o RF-4 inteiro.
- **A verificação de base mudada (passo 10) vem ANTES do portão (passo 14) de propósito** (N09 da
  revisão 2): o diff, a tabela da tela e o portão falam do estado lido no passo 5, e se a base mudou
  eles descrevem um estado que não existe mais. `--dry-run` com base mudada sai **4**, não 2 —
  e isso é o E17.
- **O snapshot (passo 8) vem antes de qualquer validação de conteúdo**: se a intenção estiver
  errada mas o estado estiver bom, o snapshot já existe e o recibo pode registrar o aborto com base
  conhecida.
- **A validação (passos 11-14) roda igual em `--dry-run`** (RF-10) — um ensaio que não valida não
  ensina nada.
- **Só as rotinas tocadas** vêm do `draft` no passo 17; as outras vêm de `fresh` (igual a `base`,
  garantido no passo 10).
- No modo `patch`, se houver **mais de uma** rotina na intenção e a segunda devolver `409`, o script
  **não** desfaz a primeira: registra `verificacao=PARCIAL` no recibo e sai 4.

### 4. Como o script fala com o servidor

**4.1 URLs, alinhadas ao leitor que já existe.**

```python
def api_urls():
    return [os.environ.get("OPENGYM_API_URL") or "https://opengym.edsc.fun/api/data",
            "http://localhost:8081/api/data",
            "https://localhost:9000/api/data"]      # mesma cadeia de opengym_reader.py:36-40
```

`https://localhost:9000` usa `ssl._create_unverified_context()` (certificado self-signed),
exatamente como `opengym_reader.py:115-116`. A API **não** é alcançável direto em `:3000` a partir
do host: ela está atrás do nginx (`nginx.conf:13-14`, `docker-compose.yml:35` publica `8081` e
`9000`). Falha de rede/timeout em todas = 5; **`401` não cai para a próxima URL** (é credencial, não
rede).

**4.2 Cabeçalhos.**

```
Cookie: gymsid=<uid>:<exp>:<sv>.<hmac-b64url>
Content-Type: application/json
X-OG-Actor: agent=hermes; tool=opengym_writer; run=20260911-140200; intent=sha256:<8 primeiros>
X-OG-Actor-Sig: t=<epoch>; v1=<hmac_sha256(agent_key, canon)>
```

Payload canônico da assinatura (contrato compartilhado com a Spec B §4.4):
`canon = f"{t}\n{method}\n{path}\n{uid}\n{sha256_hex(body)}"`, com
`agent_key = hmac_sha256(key=SECRET, msg="opengym-agent-v1").hexdigest()`.

**4.3 Pré-voo: o que exatamente é conferido.**

| checagem | como | falha |
|---|---|---|
| `SECRET` legível | `open()`; `PermissionError` → `sudo -n cat`; vazio/≠64 hex → erro | exit 3 |
| `GET` autenticado | status **200**; `body.state` **objeto** (não `null`) | exit 3 |
| `S.active` | `state.get("active")` verdadeiro | exit 3 (A13) |
| forma do estado | `routines` lista, `workouts` lista, `customEx` lista, `exWeights` objeto | exit 3 |
| cópia de disco | `open()` direto; `PermissionError` → **avisa** e segue sem a checagem `API×disco` (não usa `sudo` aqui: um caminho silencioso que só funciona como root é pior que um aviso honesto) | aviso |
| `API` × disco | `sha256(canon)` diferente | exit 3 (a menos de `--allow-drift`) |
| uid | `--uid`/`$OPENGYM_UID`; se `db.json` tiver >1 usuário e não houver `--allow-any-uid` | exit 1 (A6) |

**4.4 Regras de campo (as mesmas da Spec B §4.3 — fonte única de forma).**

```python
REGEX_FAIXA = re.compile(r"^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$")
# weight: numero finito, 0 <= w <= 1000        (bool NAO e numero; unidade = S.unit)
# reps:   inteiro 1..100  OU  faixa "A-B" com 1 <= A <= B <= 100
# sets:   inteiro 1..20
# sec:    inteiro 1..3600 (exigido so em mode=time)
# min:    inteiro 1..600   speed: numero 0..40   (exigidos so em mode=cardio)
# mode:   "reps" | "time" | "cardio"  -> obrigatorio em exercicio NOVO
#         "normal" e LEGADO do estado real (100% dos templates, medido 11/09/2026):
#         o script PRESERVA o valor existente quando a intencao nao declara mode (A15),
#         e RECUSA declarar "normal" como valor novo.
# sg:     string nao-vazia; 0/"" sao legado: preservados se nao declarados, nunca escritos de novo
# bodyweight/side: bool; side so em mode=reps
# restSec: inteiro 30..300 (mesma regra de isValidRest, useStore.js:19)
# inc: numero >= 0;  repsMin/repsMax: inteiro >= 1
```

Se `mode` não for declarado e o exercício já existir, o **modo atual é preservado**; se for novo,
`defaultConfig` (`frontend/src/lib/history.js:121-129`) é reproduzido: cardio →
`{sets:1,min:20,speed:8}`, time → `{sets:3,sec:45,weight:0,mode:"time"}`, reps →
`{sets:3,reps:10,weight:0,mode:"reps"}` (+ `bodyweight:true` se `eq == "body weight"` no catálogo).
Trocar de modo **remove os campos do modo anterior**, como o editor faz (`sheets.jsx:512-523` não
emite `reps` ao salvar em `time`, nem `sec` ao salvar em `reps`) — um objeto com `reps` fantasma num
exercício `time` voltaria a valer se o usuário trocasse de modo depois.

**Faixa de reps: o script não recorta o meso.** `A ≤ B` dentro de 1..100 passa na validação de
forma; quem recusa piso fora de `6..8` é o **P4d do portão**
(`verificar_prescricao.py:94-97`, "faixa dentro do meso"), e a intenção que pedir `10-12` sai com
**código 2** e a mensagem do portão. A Spec B aceita a faixa larga porque o servidor valida **forma**,
não política (Spec B A14) — é uma diferença **deliberada** entre os dois lados, e o mapa de revisão
registra que §4.4 daqui é subconjunto de forma, com a política no portão.

**4.5 Portão P1 e o "não arbitrar".**

O portão roda sobre o `draft` (§5). Se a intenção tiver item inválido, o script **nem chama o
portão** — ele já abortou no passo 10, com `excluidos[]` impresso. Se o portão reprovar, o script
**não** inventa justificativa: imprime a tabela e sai 2, e o agente reescreve a intenção com
`justify`. Reprovação por P4e (alta > 10 %) em item **não citado** também aborta (RF-6): o portão
audita o estado inteiro, e a mensagem diz de qual rotina × exercício veio.

**4.6 Base mudou (o caso do usuário, U1).**

```
[4] base mudou entre a leitura e a escrita — nada foi escrito.
    base lida   _ts=1789132746742 rev=0
    base agora  _ts=1789133201988 rev=0
    Isso significa que o app gravou algo depois da minha leitura (o que voce fez no app vale mais).
    Releia o estado e refaca a intencao; se quiser insistir, decida com o usuario antes.
```

**O que essa guarda cobre — e o que não cobre (honestidade obrigatória):** a comparação é entre a
**leitura inicial** e a **leitura final**, e o `_ts` enviado é o da leitura final. Ou seja: qualquer
escrita do app entre a leitura final e o `PUT` faz o servidor responder `409` (o `_ts` enviado fica
mais velho que o do arquivo) — a janela é de milissegundos, e o pior caso é um aborto, nunca uma
sobrescrita. Escrita do app **depois** do `PUT` continua vencendo, por decisão do usuário (U1) — é o
app que manda. **A garantia de token de verdade (comparação por `rev`, sem relógio) só chega com a
Spec B** (`spec_api_rotinas.md` RF-5); antes dela, o script depende do guard `incoming < cur._ts` que
existe hoje em `api/server.js:446-448`.

**4.7 Dois modos de escrita (A7).**

| modo | quando | chamada | carimbo no recibo |
|---|---|---|---|
| `put` (hoje) | `GET /api/routines` não devolve 200 com `rev` | `PUT /api/data` com o estado inteiro e `_ts` = **o da leitura final** | `req_ts` / `resp_ts` |
| `patch` (Spec B) | `GET /api/routines` devolve `200 {routines, rev}` | `PATCH /api/routines/<rid>` por rotina tocada, `If-Match: "<rev>"` | `rev` antes/depois + `op_id` da resposta |

`--mode put|patch|auto` força a mão (default `auto`). O modo efetivo vai no cabeçalho do relatório e
no recibo, para o recibo antigo continuar legível sem ambiguidade.

**4.8 Códigos de saída.**

| código | classe | o agente deve |
|---|---|---|
| 0 | sucesso, verificado | seguir |
| 1 | uso/intenção inválida (uid ausente, campo desconhecido, `prog` declarado, rotina inexistente, `exRemove` fora da rotina, congelado sem `unfreeze`) | corrigir a intenção |
| 2 | item excluído (`excluidos[]`) ou portão P1 falhou | corrigir valores ou justificar |
| 3 | ambiente (SECRET, GET, `state:null`, `S.active`, API≠disco, formas inesperadas) | parar e falar com o usuário |
| **4** | base mudou (RF-4) — ou `409` do servidor no modo `patch` | reler e refazer a intenção |
| 5 | rede/escrita falhou (timeout, 401, 5xx) | **nunca** re-forjar cego; reler |
| 6 | verificação pós-escrita divergiu (inclui API≠disco **depois** da escrita) | tratar como incidente: rolar o snapshot |
| **7** | validação passou, `--yes` ausente (nada foi escrito) | repetir com `--yes` |

A distinção **4 × 6** é por *momento*: 4 é falha **antes** de escrever; 6 é falha **depois** de
escrever (o estado pode ter mudado). A distinção **4 × 7** é por *causa*: base mudou (releia) versus
autorização ausente (repita com `--yes`).

### 5. Ajuste obrigatório em `~/.hermes/workout/scripts/verificar_prescricao.py`

**5.1 Caminhos por ambiente** (o portão hoje aponta para o arquivo vivo com o uid cravado):

```python
# ANTES (linhas 26-28)
LIVE = "/mnt/drivebackup/apps/openGym/data/state-ZPJbmYUfHlfbAYzi.json"
CAT = "/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json"

# DEPOIS   (+ import os, no topo)
UID = os.environ.get("OPENGYM_UID", "ZPJbmYUfHlfbAYzi")
DATA_DIR = os.environ.get("OPENGYM_DATA_DIR", "/mnt/drivebackup/apps/openGym/data")
LIVE = os.path.join(DATA_DIR, f"state-{UID}.json")
CAT = os.environ.get("OPENGYM_CATALOG", "/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json")
```

**5.2 Três argumentos novos, com semântica explícita.**

```python
# NOVO — dentro de main(), junto de --justify
ap.add_argument("--draft", default="",
                help="estado QUE RESULTARIA da intencao; quando dado, --state e ignorado")
ap.add_argument("--baseline", default="",
                help="estado ANTES da escrita (para o diff e para a coluna 'antes'). "
                     "Nome honesto do que o --intent fazia; --intent fica como alias.")
ap.add_argument("--intent-json", default="",
                help="a INTENCAO (nao o estado). Com --draft, o P1 passa a comparar a tela "
                     "do draft com os campos que a intencao declara: template declarado x tela.")
```

```python
# NOVO — no corpo
S = json.load(open(a.draft or a.state))
base_path = a.baseline or a.intent               # --intent continua funcionando (compat)
before = json.load(open(base_path)) if base_path else None
wanted = json.load(open(a.intent_json)) if a.intent_json else None
...
# P1 com intencao declarada: para cada item que a intencao declara, a tela tem de mostrar o valor
# declarado (nao o valor que esta no template do draft). E a mesma pergunta ("o que a tela mostra
# e o que eu pedi?"), feita contra o pedido em vez de contra o template.
if wanted:
    for rid, rp in (wanted.get("patch") or {}).items():
        for eid, fields in (rp.get("ex") or {}).items():
            key = f"{rid}:{eid}"
            idx = next((r for r in S["routines"] if r["id"] == rid), None)
            cur = next((e for e in idx["ex"] if e["id"] == eid), None) if idx else None
            if cur is None:
                fails.append(f"P1 {key}: intencao declara exercicio que nao esta no draft")
                continue
            dw, dr = display_of(S, cur)              # mesma precedencia do resto do script
            tw_decl = fields.get("weight", cur.get("weight"))
            tr_decl = rep_floor(fields.get("reps", cur.get("reps")))
            if dw != tw_decl or dr != tr_decl:
                fails.append(f"P1 {key}: tela mostraria {dw}x{dr:g}, intencao pede {tw_decl}x{tr_decl:g}")
else:
    match = "OK" if (dw == tw and dr == fl) else "DIVERGE"     # comportamento de hoje
```

`--no-p1` **não existe** (A11): com `--intent-json` o P1 vira a checagem que interessa — "a tela
mostra o que eu pedi" —, e o P4e continua valendo sempre.

**5.3 `--justify` continua como está** (dict `{"rid:eid": "motivo"}`,
`verificar_prescricao.py:109-112`) — o script monta esse mapa a partir dos `justify` por exercício da
intenção.

**Teste do portão** (BACKLOG-08:113 pede "teste mínimo para o `verificar_prescricao.py`"):

```python
# ~/.hermes/workout/scripts/test_verificar_prescricao.py (novo, unittest, stdlib)
# fixtures/state_ghost.json   -> id fora do catalogo            -> P4a FALHA
# fixtures/state_range.json   -> reps "6-8"                     -> OK
# fixtures/state_alta.json    -> +20% sobre o ultimo executado   -> P4e FALHA (sem --justify)
# fixtures/state_prog.json    -> prog "linear"                  -> P2 FALHA
# fixtures/state_normal.json  -> mode "normal" em tudo           -> OK (legado, F15 da revisao)
# com --draft fixtures/draft_x.json --intent-json fixtures/intent_x.json -> P1 compara com o pedido
# roda com OPENGYM_DATA_DIR=<tmp> OPENGYM_CATALOG=<fixtures>/catalog.json
```

### 6. Artefatos que o script grava

```
~/.hermes/workout/reports/
  sync_log.md                                       (append no FIM; formato atual, RF-9)
  snapshots/sync_snapshot_<run_id>.json             (estado da API — base do rollback)
  snapshots/sync_snapshot_<run_id>.disk.json        (copia de disco, A6 do contexto)
  snapshots/sync_snapshot_<run_id>.meta.json        ({run_id, uid, api_url, mode, actor,
                                                      actor_verified, ts, rev, sha256,
                                                      invariants_before: {exWeights, week, ...}})
  verificacao_p1_<run_id>.txt                       (tabela do portao)
```

`doctor` e `plan` **não** gravam nada — nem `sync_log.md`.

### 7. Casos de borda (contrato explícito)

| # | situação | comportamento | código |
|---|---|---|---|
| E1 | rotina declarada não existe no estado | **aborta**, lista as rotinas existentes com nome e nº de exercícios; nada escrito | 1 |
| E2 | `exRemove` cita exercício que não está na rotina | aborta, diz que a intenção não bate com o estado (não "conserta") | 1 |
| E3 | exercício novo com `id` fora do catálogo **e** fora de `customEx` | aborta (P4a) | 2 |
| E4 | exercício novo com `id` válido mas **sem `img`/`gif`** em `media/` | **avisa** e escreve, registrando `media_missing: [ids]` no recibo (regra existente: "grava mesmo assim, mas loga", `treino-coach/SKILL.md:30`) | 0 |
| E5 | `reps` como faixa `"6-8"` | aceita; piso 6 é o que a tela mostra (`MECANICA_PESOS.md:14`) | 0 |
| E6 | `reps` como `"10-12"` (piso fora do meso) | o **portão P4d** reprova; nada escrito | 2 |
| E7 | `reps` como `"AMRAP"`, `reps: -5`, `weight: "45 kg"`, `sets: 0` | item em `excluidos[]`; existe ≥1 excluído ⇒ **nada é escrito** (A10) | 2 |
| E8 | `0585`/`0599` com peso diferente do estado | aborta com o valor atual e o pedido; só passa com `unfreeze` **e** `justify`, registrado no recibo | 1 |
| E9 | peso declarado > 10 % acima do último executado | portão P4e reprova **mesmo com justificativa ausente em item não citado**; o agente reescreve com `justify` | 2 |
| E10 | intenção declara `prog` | **erro de uso** (campo não existe no formato) | 1 |
| E11 | `S.active` presente | aborta (A13); o agente deve dizer ao usuário que ele está treinando | 3 |
| E12 | `GET` devolve `200 {state: null}` (arquivo ausente/corrompido) | aborta e explica que **não cria estado**; o agente pede ao usuário para abrir o app | 3 |
| E13 | `workouts[]` do servidor tem id que o snapshot não tem | não acontece com base estável (RF-4 aborta antes); no modo `patch` a união protege e o recibo conta os ids de cada lado | 0 |
| E14 | `_ts` do app maior que o da leitura final, entre a leitura e o `PUT` | o servidor responde `409` ⇒ aborta | 4 |
| E15 | API responde `200 {ok:true}` mas o disco não mudou | `API≠disco` ⇒ falha aberta, recibo com falha, snapshot preservado | 6 |
| E16 | modo `patch` e a rotina foi apagada entre a leitura e o `PATCH` | `404` do servidor ⇒ aborta, recibo registra a corrida | 4 |
| E17 | `--dry-run` com a base já mudada | **aborta** (não imprime o diff de um estado que não existe mais) | 4 |
| E18 | intenção mistura campos de modos (ex.: `sec` num exercício `reps` **sem** declarar `mode`) | item em `excluidos[]`, com motivo (`campo sec exige mode=time`) | 2 |
| E19 | estado vivo tem `mode: "normal"` ou `sg: 0` (legado, presente hoje) | **preservado byte a byte** quando a intenção não declara o campo (A15); declarar `"normal"` como valor novo = erro 1 | 0 |
| E20 | exercício existente com `restSec` inválido no estado (fora de 30..300) | `doctor` **avisa**; `apply` preserva o valor (não é campo declarado) e o app já o limpa no `loadState` (`useStore.js:36-43`) | 0 |

### 8. Como testar sem tocar no estado vivo

Três camadas. A camada (8.2) é a única que exercita a escrita, e ela usa **fixtures**, nunca os
arquivos de produção.

**8.1 Fixtures (unitário, sem rede).** `~/.hermes/workout/scripts/fixtures/`:

```
state_base.json     estado SINTETICO (nao e copia do vivo): uid FIXO "ZPJbmYUfHlfbAYzi"
                    (o uid e usado no cookie e no nome do snapshot — "anonimizar" trocando o uid
                    quebraria o caminho), 2 rotinas, 3 treinos, 4 exWeights, 1 customEx,
                    mode "normal" e sg 0 de proposito (para o E19)
db.json             1 usuario com esse uid e sv 0 (o db real tem 1; fixture tambem)
catalog.json        20 entradas reais + 1 id que NAO existe ("zzz_ghost")
                    + 1 entry com eq "body weight" (para o default de bodyweight)
intent_ok.json         +2,5 kg em 0326 no Upper
intent_ghost.json      id fora do catalogo            -> E3
intent_text.json       weight "45 kg"                 -> E7
intent_frozen.json     0585 -> 210 sem unfreeze        -> E8
intent_remove.json     exRemove de id inexistente      -> E2
intent_prog.json       declara prog                    -> E10
```

**8.2 Servidor de mentira (end-to-end, sem rede externa).** `fixtures/fake_api.py` (stdlib,
`http.server`): serve `GET /api/data` do arquivo indicado, aceita `PUT` gravando em `<tmp>` e
devolvendo `{ok:true, ts}` **com a mesma guarda do servidor real** (`incoming < cur._ts` → `409`),
e responde `404` a `PATCH`/`GET /api/routines` por default. Modos de falha por query string:
`?conflict=1` (409 sempre), `?slow=1` (dorme 30 s), `?disk_skip=1` (aceita o `PUT` mas não grava —
o caso E15), `?state_null=1` (devolve `{state:null}` — o E12), `?routines=1` (liga o modo `patch`,
para o E16). Rodar com:

```bash
python3 fixtures/fake_api.py --state /tmp/og/state.json --port 8799 &
OPENGYM_API_URL=http://127.0.0.1:8799/api/data \
OPENGYM_DATA_DIR=/tmp/og OPENGYM_CATALOG=fixtures/catalog.json \
OPENGYM_REPORTS=/tmp/og/reports OPENGYM_GATE=../verificar_prescricao.py \
  python3 opengym_writer.py apply --intent fixtures/intent_ok.json --uid ZPJbmYUfHlfbAYzi --yes
```

Com `OPENGYM_DATA_DIR=/tmp/og`, o `cp` de disco **e** o portão (que lê `OPENGYM_DATA_DIR`) apontam
para o `tmp`. O relatório imprime os caminhos resolvidos no cabeçalho, então um override esquecido
aparece na primeira linha. O `doctor` e o `plan` de (8.3) são os únicos que leem o vivo, e só leem.

**8.3 Dry-run contra o vivo (leitura, zero escrita).**

```bash
python3 opengym_writer.py doctor --uid ZPJbmYUfHlfbAYzi
python3 opengym_writer.py plan --intent fixtures/intent_ok.json --uid ZPJbmYUfHlfbAYzi
python3 opengym_writer.py apply --intent fixtures/intent_ok.json --uid ZPJbmYUfHlfbAYzi   # sem --yes -> 7
```

Critério de aceite do harness: (8.2) verde antes e depois de qualquer alteração do script; e (8.3)
provando que nada mudou — `sha256` do estado do servidor **igual** antes e depois.

### 9. Fila de adoção (o que muda na rotina do agente)

1. Publicar o script em `~/.hermes/workout/scripts/` (LF, `chmod +x`).
2. Rodar `doctor` e guardar a saída em `reports/verificacao_p1_<data>.txt`.
3. Substituir o **passo 6** de `treino-coach/SKILL.md` por um ponteiro curto: "monte a intenção
   (formato em `scripts/opengym_writer.py --help`), rode `plan`, mostre ao usuário, rode `apply
   --yes`; o recibo é automático". Manter a receita de `og_state_mutation.md` como **histórico**,
   marcada como superada por esta spec (é a parte do "uma fonte para o protocolo" que a
   BACKLOG-08:113 pede).
4. Quando a Spec B estiver no ar, `apply` passa sozinho para o modo `patch` (A7, por sondagem) na
   próxima sessão; nenhuma intenção antiga muda de forma.

## Comportamento Visual/UX

O script não tem tela. O que existe é **saída de terminal** lida pelo agente e pelo usuário no
chat. Três blocos fixos, sempre precedidos do cabeçalho de ambiente (F09):

**Cabeçalho (toda execução):**

```
=== openGym writer — PLAN (nada sera escrito) ===
uid=ZPJbmYUfHlfbAYzi  modo=put  base_ts=1789132746742 rev=-
data_dir=/mnt/drivebackup/apps/openGym/data  catalog=/mnt/.../api/exercise_catalog.json (1324)
reports=/home/pi/.hermes/workout/reports  gate=/home/pi/.hermes/workout/scripts/verificar_prescricao.py
actor=hermes (nao assinado)  api=https://opengym.edsc.fun/api/data
snapshot: reports/snapshots/sync_snapshot_20260911-140200.json (sha256 4f9c1a7e)
tocadas: r_upper_C_20260829   nao tocadas (declarado): r_leg1, r_leg2, r_push_C, r_pull_C
```

**Bloco 1, o diff:**

```
rotina                  ex     campo     antes   depois
r_upper_C_20260829      0326   weight        8        9
r_upper_C_20260829      0762   weight       40       25
```

**Bloco 2, a tabela do portão (o que a tela vai mostrar):**

```
rotina                 ex      template  tela_peso  tela_reps  caderno  ult_exec  status
r_upper_C_20260829     0326           9          9          6        9         9  P1=OK
r_upper_C_20260829     0762          25         25          6       25        25  P1=OK
r_upper_C_20260829     0584          45         45          6       45        45  P1=OK
```

**Bloco 3, o que vai para o recibo:**

```
receipt -> reports/sync_log.md
  ## 2026-09-11 11:02 -03 — S3 template (+2,5kg desenv) executor=hermes
  - run=20260911-140200 modo=put base_ts=1789132746742 new_ts=1789132746742 resp={"ok":true,"ts":1789132746742}
  - snapshot=snapshots/sync_snapshot_20260911-140200.json sha256=4f9c1a7e
  - diff: Upper 0326 8->9; 0762 40->25
  - verificacao=OK hash=4f9c1a7e | API==DISK ALL_OK | workouts base=300 snap=300 uniao=300
  - invariantes: exWeights OK week OK dayPlan OK bodyweight OK customEx OK unit OK
  - handshake: S.active ausente; base estavel (_ts identico na leitura final)
  - actor=hermes actor_verified=claimed
  - rollback: 1 PUT de snapshots/sync_snapshot_20260911-140200.json com _ts fresco
```

**`apply --yes` (sucesso):**

```
[1/6] pre-voo OK (secret, GET 200, active ausente, API==DISK)
[2/6] snapshot OK    4f9c1a7e
[3/6] itens OK       2 alterados, 0 excluidos
[4/6] portao P1      VEREDITO: OK (tabela em reports/verificacao_p1_20260911-140200.txt)
[5/6] escrita OK     {ok:true} req_ts=1789132746742 resp_ts=1789132746742
[6/6] verificacao OK API==DISK, invariantes intactos, workouts 300->300
recibo anexado: reports/sync_log.md
```

**`apply` sem `--yes` (o caminho mais comum):**

```
[1/6] pre-voo OK   [2/6] snapshot OK   [3/6] itens OK   [4/6] portao OK
BASE ESTAVEL, diff acima. NADA FOI ESCRITO.
repita com --yes para aplicar (o recibo so sai quando a escrita sai).
```

**Falha de portão:**

```
[4/6] portao P1      VEREDITO: FALHA (2 itens) — NAO aplique.
 - P4e r_upper_C_20260829:0326: +12.5% sobre ultimo executado (8) sem justificativa — ABORTE
 - P4d r_upper_C_20260829:0738: piso 10 fora do meso (6-8)
nada foi escrito. snapshot preservado: reports/snapshots/sync_snapshot_20260911-140200.json
```

**Falha de item (o "nunca arbitra"):**

```
[3/6] itens  FALHA (1 item excluido) — NADA FOI ESCRITO
 - excluido r_upper_C_20260829:0326.weight="45 kg" (nao numerico; unidade do perfil: kg)
 - excluido r_upper_C_20260829:0762.reps="AMRAP" (use um inteiro ou a faixa "A-B")
```

## Testes manuais (numerados)

1. `doctor --uid ZPJbmYUfHlfbAYzi`: sai 0, imprime o cabeçalho com os caminhos resolvidos e a
   tabela rotina × exercício do estado real (6 rotinas hoje); **não** cria nada em `reports/`
   (comparar `ls -la` antes/depois).
2. `dump --routine r_upper_C_20260829 --uid ZPJbmYUfHlfbAYzi`: imprime o JSON da rotina e o
   cabeçalho `_ts=… rev=…`; conferir contra `GET /api/data`.
3. `plan --intent fixtures/intent_ok.json --uid …`: imprime os três blocos; `sha256` do estado do
   servidor **inalterado**; `sync_log.md` **sem** linha nova.
4. `apply --intent fixtures/intent_ok.json --uid …` (sem `--yes`): sai **7**, imprime "NADA FOI
   ESCRITO"; `sync_log.md` continua sem linha nova.
5. **Ambiente de fixture (não o vivo):** com `fixtures/fake_api.py` em `:8799` e
   `OPENGYM_DATA_DIR=/tmp/og` (caminho completo do §8.2), `apply … --yes` → código 0, recibo com
   `API==DISK ALL_OK` e a linha de invariantes; o estado de produção intacto (`sha256` conferido).
6. `fake_api.py ?conflict=1`: `apply --yes` → código **4**, mensagem "base mudou", **nenhuma**
   escrita, recibo **não** anexado.
7. `fake_api.py ?disk_skip=1`: `apply --yes` → código **6**, recibo com `API!=DISK`, snapshot
   preservado no caminho impresso.
8. `fake_api.py ?state_null=1`: código **3**, mensagem "sem estado para o perfil"; nenhum arquivo
   criado.
9. `intent_text.json`: código **2**, item em `excluidos[]`, zero escrita. `intent_prog.json`:
   código **1** (campo não existe no formato).
10. `intent_frozen.json` (`0585` → 210): código **1**; com `unfreeze:["0585"]` e `justify`, código 0
    e o recibo mostra `frozen: 0585 200->210 (justificado)`.
11. `intent_ghost.json` (id fora do catálogo): código **2** (P4a do portão).
12. `python3 test_escritor_rotinas.py` e `python3 test_verificar_prescricao.py`: verdes, sem
    `pytest`, sem rede.
13. `plan` com `OPENGYM_API_URL` apontando para host inexistente: cai para `localhost:8081` e
    depois `localhost:9000`; se todas falharem, código **5** e nenhuma escrita.
14. Estado de fixture com `S.active` presente (só na fixture, **nunca** no vivo): código **3**,
    mensagem do A13.
15. Portão com `OPENGYM_DATA_DIR` errado (diretório sem `state-<uid>.json`): código **3** com o
    caminho impresso no cabeçalho — prova que um ambiente trocado é visível.

## Rollout e reversão

- **Arquivos:** novo `opengym_writer.py`; alterados `verificar_prescricao.py` (3 argumentos + 2
  caminhos por env) e `treino-coach/SKILL.md` (passo 6 vira ponteiro). Nenhum arquivo do app.
- **Ordem:** publicar → `doctor` → `plan` com fixture → **primeira escrita real só depois**, com
  base estável e o usuário avisado. O `apply` sem `--yes` é o ensaio.
- **Reversão da escrita:** `rollback = 1 escrita do snapshot` (RF-2) — o próprio recibo traz o
  caminho e a instrução.
- **Reversão do código:** o script é novo, então voltar a montar à mão é só ignorá-lo; o
  `verificar_prescricao.py` volta com `cp` do `.bak` (**fazer `cp` antes de editar**, como no
  `snapshot.sh.bak.20260911`, BACKLOG-08:111).
- **Risco aceito, declarado com todas as letras (F17 da revisão):** enquanto houver **PWA antigo
  aberto e sujo** (o cliente publicado não manda `If-Match` e o guard dele é por relógio), uma
  escrita do agente pode ser revertida minutos depois pelo app — **não é caso raro**: qualquer
  aparelho que abriu depois da escrita e depois sofreu um `persist` tem `_ts` mais novo e vence
  (`useStore.js:169-190`). O que o script garante é que **ele** não sobrescreve o app (RF-4); o
  contrário é o que o usuário decidiu (U1) e só fecha de vez com a Spec B + cliente novo
  (`spec_api_rotinas.md` §5). Mitigação operacional: depois de um `apply`, o agente pede
  "feche e reabra o app" — a prática que `sync_log.md:16` já registra.

## Relação com a outra spec

- **A funciona sozinha hoje.** Nada da `spec_api_rotinas.md` precisa existir: o modo `put` (A7) é o
  `PUT /api/data` que já está no ar (`api/server.js:433-452`).
- **B não pode invalidar os recibos de A.** Os campos de recibo de A (`req_ts`/`resp_ts`, `hash`,
  `diff`, `handshake`, `rollback`, `invariantes`) continuam todos preenchidos; B só **acrescenta**
  `rev`/`op_id` e o modo `patch`. Recibo antigo segue legível e nenhum é reescrito.
- **B torna A melhor sem tocar em A:** com `rev`, o aborto por base mudada deixa de ser relógio
  (`spec_api_rotinas.md` RF-5) e o pré-voo deixa de depender do `PUT` de estado inteiro (RF-9 da
  Spec B, `GET /api/routines`).
- **As regras de validação são as mesmas nos dois lados, com um recorte declarado.** §4.4 daqui e
  §4.3 da Spec B são o mesmo conjunto de **forma**; a **política** (faixa dentro de 6..8, alta > 10 %,
  congelados, `prog` off) mora só no portão P1 do lado Hermes — o servidor do app não conhece
  mesociclo. Divergência de forma entre os dois lados é bug; o teste que a pega é a mesma intenção
  rodada com `--dry-run` em A contra a API de B, esperando a mesma decisão de forma.

## Fora de escopo (registrado)

- **Comportamento do agente** (U2): quando perguntar, o que fazer com um treino faltado, qual
  exercício escolher, como reagir a dor. Não é infraestrutura.
- **`prog`**: não é escrito por este script (nem declarável na intenção) — ver "Não inclui".
- **Operação em lote de várias rotinas em 1 chamada** (E16): se a 2ª rotina falhar, o recibo
  registra `PARCIAL`. Ver a recusa correspondente em `spec_api_rotinas.md` §4.2.
- **`POST`/`DELETE` de rotina pelo script**: esta versão altera rotinas existentes (`patch`) e remove
  **exercícios** (`exRemove`). Criar e apagar **rotina** inteira pertence à Spec B (§4.1/§4.2) e
  chega ao script na sessão seguinte; `api_delete()` já existe sem chamador (A16).
- **Normalizar o legado do estado vivo** (`mode: "normal"`, `sg: 0`, `prog` ausente na rotina vazia
  `mtwfylw47b2j`, `routineId` órfão `r_push_20260823` — medidos em 11/09/2026): o script **preserva**
  (A15) e `doctor` **avisa**. Correção é decisão do dono do dado (Spec B, "Fora de escopo").
- **Conversão de unidade (`lb`/`kg`)**: `weight` está na unidade do perfil (`S.unit`). O "200 lb" de
  `0585`/`0599` é rótulo do coach (BACKLOG-01/RF-13); quem converte é `api/coach.js` na análise.
- **`S.exWeights`, `S.workouts`, `S.week`, `S.dayPlan`**: intocados por contrato (RF-11).
- **Reconciliação de identidade no servidor** e o **token `rev`**: Spec B.

## Mudanças da v1 para a v2 (achados da revisão 1)

| Achado | O que mudou |
|---|---|
| F01 (bloqueante) | **Garantia reescrita:** RF-4 e §4.6 agora dizem o que a guarda realmente cobre. O payload `put` envia o `_ts` **da leitura final** (não um `Date.now()` novo), o que transforma o guard do servidor (`incoming < cur._ts`) num teste de igualdade; §4.6 declara que o token de verdade só chega com a Spec B |
| F02 (bloqueante) | RF-1 e o bloco `merge` deixam explícito que o merge é **sobre o item existente** (dicionário atual + campos declarados), sem normalizar `mode`/`sg`/`restSec`; **A15** criada para o `mode: "normal"` |
| F03 (bloqueante) | O passo 11 (aborto por base mudada) agora vem **antes** do uso dos dados; a união de `workouts[]` (RF-5) é declarada como **cinto de segurança / no-op sob base estável**, e o exemplo E12 virou E13 com a explicação |
| F04 (bloqueante) | **A7 reescrita:** modo sondado por `GET /api/routines` (não por `state.rev`), com `--mode auto\|put\|patch` |
| F05 (bloqueante) | **A6 criada:** `--uid` obrigatório, recusa com >1 usuário no `db.json` sem `--allow-any-uid` (o disco tem 2 perfis com estado) |
| F06 (bloqueante) | **`--no-p1` descartado**; o portão ganha `--draft` + `--baseline` + `--intent-json`, e o P1 passa a comparar a tela com os **campos declarados** (§5.2) |
| F07 (bloqueante) | RF-13 fixa que o valor de referência é o **do estado** (200 nas 4 entradas de Legs 1/2) e que **não há conversão de unidade** |
| F08 (bloqueante) | §8.1 define as fixtures como **sintéticas com uid fixo** + `db.json` de fixture, em vez de "cópia anonimizada" |
| F09 (média) | Variável renomeada para **`OPENGYM_DATA_DIR`** (não colidir com `opengym_reader.py`), e o cabeçalho de todo relatório imprime os caminhos resolvidos; teste manual 15 cobre |
| F10 (média) | `invariants_before` gravado no `.meta.json` (RF-11) e o recibo imprime os invariantes por nome |
| F11 (média) | `justify` por exercício com chave montada `"<rid>:<eid>"`; RF-6/E9 fixam que reprovação em item **não citado** também aborta |
| F12 (média) | RF-10 e §4.8 separam **validação** (sempre roda) de **autorização** (`--yes`), com o código **7**; E10 mata o conflito P2 × `prog` |
| F13 (média) | `200 {state:null}` vira caso explícito no pré-voo (RF-3) e o **E12** |
| F14 (média) | Cadeia de URLs alinhada a `opengym_reader.py:36-40`, com `_create_unverified_context` no 9000 e a nota de que a API só é alcançável atrás do nginx |
| F15 (média) | Resolvido em **A15**/E19: preserva a string, nunca introduz `mode` novo |
| F16 (média) | `cleanup_sg` entra no bloco `merge` e roda em **toda** remoção (E2) |
| F17 (média) | Risco do PWA aberto reescrito no Rollout: **não é raro**, e a garantia do script é só "ele não sobrescreve o app" |
| F18/F19 (leves) | Tabela de códigos com **7** separado, e a distinção **4 × 6** justificada por *momento* |
| F20 (leve) | Recibo ancorado no **fim** do arquivo, data local derivada (`time.localtime()`), e o snapshot com o prefixo `sync_snapshot_` existente dentro de `snapshots/` |
| F21 (leve) | §4.4 declara que a faixa larga é **forma** (Spec B) e que o recorte 6..8 é **política do portão** (E6) |
| F22 (leve) | `excluidos[]` (bloqueia) × `media_missing[]` (avisa) separados (A10), com o passo que monta o índice de mídia no bloco `merge` |
| F23 (leve) | Catálogo único (espelho do repo, `OPENGYM_CATALOG` de override) com conferência de contagem `1324` e aviso de divergência em `doctor` |
| F24 (leve) | `api_delete()` registrado em **A16** como preparo da Spec B |

### 9.1 Exemplo completo do §8.2 com a fixture certa

O `fake_api.py` serve **o mesmo nome de arquivo** que o script procura em disco, senão o pré-voo
recusa por `API ≠ disco` antes de qualquer teste (N13 da revisão 2):

```bash
python3 fixtures/fake_api.py --state /tmp/og/state-ZPJbmYUfHlfbAYzi.json --port 8799 &
# OPENGYM_API_URL_ONLY=1 impede o fallback para o nginx real do Pi (testes 6/7/8 leriam produção)
OPENGYM_API_URL=http://127.0.0.1:8799/api/data OPENGYM_API_URL_ONLY=1 \
OPENGYM_UID=ZPJbmYUfHlfbAYzi OPENGYM_DATA_DIR=/tmp/og \
OPENGYM_CATALOG=fixtures/catalog.json OPENGYM_REPORTS=/tmp/og/reports \
  python3 opengym_writer.py apply --intent fixtures/intent_ok.json --yes
```

A fixture `state_base.json` precisa conter **todas** as chaves que o RF-11 hasheia (`exWeights`,
`week`, `dayPlan`, `bodyweight`, `customEx`, `unit` + as chaves de ajuste), mesmo vazias — senão o
teste de invariante compara `None` com `{}` (N14 da revisão 2).

## Mudanças da v2 para a v3 (achados da revisão 2)

| Achado | O que mudou |
|---|---|
| N01 (bloqueante) | §1 e §3: `validate_items(draft, intent, catalog, media)` com assinatura fixada no bloco `regras`, e os passos 12 (`load_catalog`/`build_media_index`) explícitos antes da validação |
| N02 (bloqueante) | §3: o carimbo do payload passa a ser o de **`fresh`** (passo 18) e o texto diz que `base` serve só para comparar — era a contradição que anulava o RF-4 |
| N03 (bloqueante) | §4.1: matriz de fallback — só **erro de rede/timeout** cai para a próxima URL; `401`, `409`, `404` e `200` com conteúdo inesperado **abortam**; `OPENGYM_API_URL_ONLY=1` nos testes |
| N04 (bloqueante) | §5.2: o `if wanted:` passou a envolver a **atribuição de `match` dentro do laço** `for e in r["ex"]`, com o laço mostrado |
| N05 (bloqueante) | §5.2/§5.3: `--justify` entra no caminho novo e o mapa de chaves é o do **P4e** (`verificar_prescricao.py:109-112`), que é quem o consome |
| N06 (bloqueante) | §1 bloco `portão`: `run_gate(..., uid)` repassa `OPENGYM_UID` **e** `OPENGYM_DATA_DIR` no `env` do subprocess — sem isso o portão auditava outro perfil |
| N07 (média) | §1 bloco `snapshot`: `write_snapshot` **recusa (exit 3)** se `REPORTS` estiver sob `DATA_DIR` — A3 vira invariante de código |
| N08 (média) | §1 bloco `merge`/`regras`: `build_media_index(media_dir, ids)` existe e recebe **só os ids adicionados** (A14) |
| N09 (média) | §3: a checagem de base mudada passou a ser o **passo 10, antes do portão** (14); E17 e a saída 4 ficam coerentes |
| N10 (média) | §4.4 + `strip_mode_fields`: trocar `mode` explicitamente **remove os campos do modo anterior** — declarado como a única exceção ao "omitir nunca apaga" |
| N11 (média) | §3: `load_secret` passou para **antes** da sondagem, e `401` na sondagem = exit 3 (credencial), não "modo put" |
| N12 (média) | A5: o script **deriva** a chave do agente do `SECRET` (`agent_key_from_secret()`), nunca lê `/data/agent.key` (que é `0600 root`) |
| N13 (média) | §8.2/§9.1: o `--state` do `fake_api.py` usa o nome real `state-<uid>.json` |
| N14 (média) | §8.1/§9.1: a fixture lista **todas** as chaves do RF-11 |
| N15 (leve) | §4.8: `428`/`404`/`503` da Spec B mapeados para **4** (conflito/uso); o 5 fica só para rede/timeout/5xx |
| N16 (leve) | §2: `unfreeze` passa a ser lista de pares `"<rid>:<eid>"`, a mesma chave do `justify` |
| N17 (leve) | §6/§9: `doctor` imprime e **não** grava; a tabela salva em arquivo é a do portão (`verificacao_p1_<run_id>.txt`) |
| N18 (leve) | §1: `doctor` **não** chama `run_gate` — usa `validate_items` e imprime a própria tabela |
| N19 (leve) | §6: citação do snapshot de disco corrigida (A3, não A6) |
| N20 (leve) | §5: o portão trata `OSError` no `open` com mensagem de uma linha e **exit 3** (hoje seria traceback) |

## Implementado em 11/09/2026 — divergências entre esta spec e o código

O script está em produção desde 11/09/2026 (`~/.hermes/workout/scripts/opengym_writer.py`,
28 testes verdes no Pi). O que o código faz **diferente** desta spec, e por quê:

| # | Onde | O que mudou no código | Motivo |
|---|---|---|---|
| I1 | `read_api_state` | a leitura devolve **cópia profunda** e normaliza `rev` para `0` quando ausente | o `GET` mutava o objeto devolvido; e o script precisa de um número para o `If-Match` antes do deploy da Spec B |
| I2 | `write_put` | o `_ts` enviado é o **lido** (RF-4), e depois da escrita o script **espelha** o `_ts` que o servidor gravou no arquivo local | sem o espelho, a verificação acusaria `API != DISCO` por um artefato de carimbo, não por defeito |
| I3 | `sync_disk_copy` | avisa e segue se o arquivo do app não for gravável | `pi` não escreve em `/mnt/drivebackup/...` (root:root); não vale usar `sudo` em silêncio |
| I4 | `--dry-run` com base mudada | **aborta (4)**; não imprime o diff da base nova | o diff descreveria um estado que não existe mais (E17) |
| I5 | `union_workouts` | recebe `fresh` e `base` (que são iguais sob base estável) | com o aborto do RF-4 a união é cinto de segurança, não correção |
| I6 | congelados | a trava é o `unfreeze` da intenção (pares `"<rid>:<eid>"`); a flag `--allow-frozen` **não existe** | ela era um no-op no código: duas formas de destravar a mesma coisa é convite a erro |
| I7 | `probe_mode` | no modo `patch` exige `--target-live` ou `OPENGYM_TARGET=live` | **trava corretiva do incidente de 11/09/2026**: `OPENGYM_DATA_DIR` troca só a cópia local, e um ensaio "numa cópia" escreveu na API de produção (ver `reports/sync_log.md`) |
| I8 | portão | além de `--draft`/`--baseline`, ganhou `--intent-json` e o P1 passou a comparar **tela × campos declarados**; `--no-p1` não existe | era o recorte do achado F06: pular o P1 apagaria a checagem que interessa |
| I9 | portão | `OSError`/arquivo ausente ⇒ mensagem de uma linha e **saída 3** | antes era traceback |
| I10 | report | toda saída imprime os caminhos resolvidos no cabeçalho | um `OPENGYM_*` trocado por engano tem de aparecer na primeira linha |

Evidência de aceite (11/09/2026): `python3 test_escritor_rotinas.py` (28 testes) e
`test_verificar_prescricao.py` (10 testes) verdes no Pi; `doctor` e `plan` rodados contra o estado
real sem alterá-lo; a escrita de ponta a ponta foi exercitada contra a API publicada.

---

> **Atualização de 11/09/2026:** o catálogo de exercícios deixou de ser
> `api/exercise_catalog.json` (e de ter cópia em `~/.hermes/.../references/`). Agora existe **um
> arquivo só**, `frontend/src/lib/exercises-data.json`, lido pelo app, pela API e pelo agente. Onde
> este documento citar `exercise_catalog.json`, ou o campo `name`, leia o arquivo novo e o campo
> `n`. Ver `docs/specs/spec_catalogo_unico.md`.

