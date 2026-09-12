# Spec: falha de job deixa de morrer no banco (BACKLOG-11) — v3

> **v3 (12/09/2026, depois da 2ª revisão):** três correções de fato que mudam a implementação — e uma delas evitaria o pior desfecho possível:
> **(1)** o alvo do aviso passa a ser `--failure-deliver telegram`, **não** `origin`: o job `Hermes Snapshot` tem `origin: null` e `hermes-local-backup` tem `origin: {platform: webui}`, então `origin` não chegaria no celular em dois dos quatro (ver §1);
> **(2)** o rollback é `hermes cron edit <id> --failure-deliver ''`, que **funciona** (a CLI documenta `''` apaga o override) — a v2 dizia o contrário, por engano;
> **(3)** a perna `err` ganha componente de **data** na chave, porque `last_delivery_error` descreve **a última execução** (é limpo a cada execução que entrega bem), e sem a data ela alertaria uma vez e nunca mais.

## Contexto e Objetivo

O agente detecta falha de job, agrupa em incidente e **tenta** avisar. O que falta é a entrega — e o banco diz exatamente onde ela não aconteceu:

- `cron/scheduler.py:2826` marca o incidente como **`alerted`** só quando o desfecho da entrega é `delivered` ou `not_configured`; `_classify_delivery_outcome` (`scheduler.py:2599`) devolve **`failed`** quando há `delivery_error` (checado **antes** de qualquer outra regra). Logo: **entrega que falha deixa o incidente em `detected`**.
- `detected` também é o estado de quem nunca tentou entregar, porque o job entrega em `local`. Hoje são **12 dos 14** incidentes (mais 2 `alerted`), com **0 reconhecidos e 0 fechados**.
- A causa é de configuração: quatro dos oito jobs ativos entregam em `local` e não têm `failure_deliver`. Foi assim que o `snapshot.sh` falhou **10 dias seguidos** (31/08 a 09/09, `exit 128`, `fatal: a branch named 'main' already exists`) com cada falha gravada num arquivo de `cron/output/` que ninguém leu.

Objetivo: fazer a falha de job **chegar no usuário**, usando o que já existe (agrupamento por assinatura, estados e `ack`), mais uma rede de segurança independente do agente para o que ficar sem aviso.

Onde vive: máquina `hermes` (Pi, Ubuntu ARM64, usuário `pi` com sudo). Arquivos em `~/.hermes/cron/{jobs.json,executions.db}`, `~/.hermes/scripts/`, `/etc/cron.d/island-ops` e o código do agente em `~/.hermes/hermes-agent/`. Fecha a **BACKLOG-11** (criada em 12/09/2026; é a causa raiz do silêncio de 10 dias da BACKLOG-08).

## Escopo

- **Inclui:**
  - `failure_deliver: telegram` nos quatro jobs ativos que hoje entregam em `local`, pelo caminho suportado (`hermes cron edit`). **Não** é `origin` (ver §1: dois deles não têm origem que chegue no celular).
  - Vigilância independente, dentro do `island_healthcheck.sh`, de (a) incidentes em `detected` **vivos** (falha recente que ninguém anunciou) e (b) jobs com erro de entrega na última execução — alertando pelo `alerta.sh`, uma vez por ocorrência.
  - Flag `--incidents` no healthcheck para inspecionar o alertável e sair, sem alertar e sem gravar nada (mesmo desenho do `--containers`).
  - Mensagem com o que falhou, desde quando, o motivo e **como reconhecer** (`hermes cron incidents ack <id>`).
- **Não inclui:**
  - **Patch no código do agente.** Nada em `~/.hermes/hermes-agent/**` é editado: o `hermes update` sobrescreve a árvore, e o módulo de incidentes já faz o que precisa.
  - Consertar a assinatura de erro: o texto do erro carrega data/hora, então a mesma falha diária mina um incidente novo por dia (8 ids para o snapshot, um por dia). Isso passa a ser **desejado**, não corrigido (ver Decisões).
  - Reconhecer (`ack`) incidente automaticamente.
  - Alertar sobre sucesso/recuperação: silêncio no sucesso é o comportamento querido.
  - Apagar histórico: os 12 `detected` de 30/08 a 09/09 ficam onde estão (e **não** viram alerta — são história morta, ver RF-3).
  - Corrigir o caso em que o alvo de entrega não resolve (`not_configured` marca `alerted` sem ter mandado nada): registrado como limitação em Riscos.

## Decisões

### Do usuário (12/09/2026)

- **Ser lembrado enquanto continuar falhando** (um aviso por dia, no máximo, por job) em vez de avisar uma vez só.
- **Fica pendente até ele reconhecer**, com o comando de `ack` dentro da própria mensagem.
- **Os quatro jobs mudos passam a avisar** (backup diário, sync do treino, backup local e o de atualizar a data).

### Assumidas por mim (técnicas, sem pergunta)

- **A janela é medida por `last_seen_at`, não por `first_seen_at`.** `first_seen_at` é gravado uma vez e nunca muda (coluna no `INSERT` de `incidents.py:164-168`; o `UPDATE` de `159-162` só toca `last_seen_at`/`error`/`output_file`); com a falha recorrente mintando incidente novo por dia, todo incidente vivo tem `first_seen_at` recente. `last_seen_at` é o que diz "isto está acontecendo agora". **Efeito visível:** o vigia fala do que está falhando hoje e fica quieto sobre o histórico de agosto.
- **Duas pernas de vigilância.** (1) Incidente em `detected` com `last_seen_at` dentro da janela de 48 h e mais velho que a carência de 60 min; (2) job com `last_delivery_error` preenchido — cobre o aviso que foi tentado e não chegou. **Efeito visível:** nenhuma classe de aviso perdido fica sem rede.
- **`last_delivery_error` descreve a ÚLTIMA execução, não um estado permanente.** `mark_job_run` (`jobs.py:2185`) grava `job["last_delivery_error"] = delivery_error` em **toda** execução, com `None` quando a entrega deu certo (é o mesmo bloco que zera `failure_streak` e limpa `last_fire_error` em execução saudável, `jobs.py:2174-2184`); o `scheduler.py:2794` cobre o caso do shutdown interrompido, em que o `mark_job_run` é pulado. Logo o campo **se limpa sozinho** na próxima execução que entregar bem.
- **A chave da perna `err` leva a data** (`d:<job>:<assinatura>:<AAAA-MM-DD>`), pelo mesmo motivo da perna (a): sem isso o mesmo texto de erro alertaria **uma vez na vida** e o usuário deixaria de ser lembrado enquanto a entrega continuasse falhando (o requisito (a)). Com a data, ele recebe no máximo um aviso por dia, e o aviso **para sozinho** quando o campo é limpo pela próxima execução que entregar bem.
- **Carência de 60 minutos** antes de reclamar: o agendador registra o incidente antes de entregar, então sem folga o vigia poderia avisar durante uma entrega a caminho. O caminho nativo é imediato; o vigia é rede.
- **Chaves com prefixo no arquivo de anunciados** (`i:<id>` para incidente, `d:<job>:<assinatura>:<data>` para erro de entrega), em `~/.hermes/drive_backup/.incidents-told`. Assim as duas pernas não colidem e o dedup é por ocorrência.
- **Nada de escrever no banco:** leitura somente (`file:…?mode=ro`), estado em arquivo texto. Escrever `alerted` no banco seria semanticamente defensável, mas mexer no ledger do agente tem risco de esquema/WAL.
- **Os dados saem do python como campos separados por TAB** e o erro de leitura sai como `ERRO:<motivo>` — impossível colidir com um id de incidente (`^[0-9a-f]{6}_[0-9a-f]{12}$`).
- **Nome do job e motivo passam por colapso de espaço** (`" ".join(str(x).split())`) antes de virar campo: um TAB ou quebra de linha no nome do job quebraria o alinhamento do `read` e trocaria os campos. Hoje os 11 nomes estão limpos (conferido), mas o texto de erro **não** está: 12 dos 14 incidentes têm TAB/newline no `error` cru, e é o colapso que salva o formato.
- **O laço de alerta é alimentado por process substitution** (`done < <(printf …)`), não por pipe: mantém o laço no shell atual (nada de variável perdida em subshell) e elimina qualquer dúvida sobre stdin compartilhado. *(O revisor levantou que o heredoc do `python3` comeria o stdin do laço; testei no Pi e isso **não acontece** — mas a forma é mais robusta e não custa nada.)*
- **O `--incidents` sai cedo, igual ao `--containers` (linhas 147-150 atuais), antes do `log` do ciclo e de qualquer alerta.** Cheguei a especificar o contrário (rodar depois da linha de estado), e isso estava errado por dois motivos: a inspeção rodaria **depois** do bloco de alerta, então ela mesma mandaria as mensagens que deveria só listar, e o bloco de alerta marcaria as ocorrências em `.incidents-told` — a espiada consumiria o aviso. Modo de inspeção tem que ser leitura pura: imprime, `exit 0`, e o ciclo seguinte continua alertando normalmente.
- **A ocorrência só é marcada em `.incidents-told` quando a mensagem SAI.** `alert()` engole o resultado da entrega (o `enviar_alerta` roda e a função termina com `return 0`, `island_healthcheck.sh:45-51`), então o bloco novo não pode usá-la às cegas: se o canal estiver fora, o alerta se perderia **e** a ocorrência ficaria marcada. O bloco usa uma variante que devolve o código de entrega e só marca depois do sucesso; se falhar, o ciclo seguinte (15 min depois) tenta de novo — retentativa enquanto o canal estiver fora, e silêncio absoluto quando ele voltar.
- **O `hermes cron edit` é quem limpa o override** (`--failure-deliver ''`), e a CLI documenta isso (`hermes_cli/subcommands/cron.py:96`). A v2 afirmava que só dava para editar o `jobs.json` na mão; estava errado.
- **Sem mensagem de recuperação** para incidentes: quem fecha é o humano, com o `ack` que já existe.
- Decidido por mim porque é detalhe de implementação e não muda o que o usuário vê.

## O que já existe (levantado em 12/09/2026, com linha)

- `cron/incidents.py`: `upsert_incident(job_id, error)` agrupa por `(job_id, sha256 do erro normalizado nos primeiros 200 caracteres)`, grava `first_seen_at`/`last_seen_at`/`error`/`output_file` e estados `detected → alerted → closed`; `ack_incident(id)` fecha e carimba `acked_at`; assinatura igual atualiza `last_seen_at` sem duplicar; incidente fechado **não** reabre (erro novo mina um novo).
- `cron/scheduler.py:2826` e `2865`: marca `alerted` só em `delivered`/`not_configured`; `2599-2611` classifica `failed` quando há `delivery_error` e devolve `suppressed_acked` quando o operador já reconheceu aquela assinatura.
- `cron/scheduler.py:345-362`: `_upsert_incident_for_failure` — se a assinatura já está `closed`, o incidente volta como `acked=True` (linha 359) e o agendador **suprime** o ping repetido daquela assinatura; `_mark_incident_alerted` nunca ressuscita um incidente reconhecido.
- `cron/jobs.py:2174-2185`: fim de execução grava `last_delivery_error` (None quando a entrega deu certo) e, em execução saudável, limpa `preflight_alerted`/`drift_alerted`/`last_fire_error` e zera `failure_streak`.
- `scheduler_delivery.py:785-805`: `failure_deliver` é honrado quando o alvo é falha; `local` resolve para nenhum alvo.
- CLI: `hermes cron incidents [list|ack] [id] [--state detected|alerted|closed]`; `hermes cron edit --failure-deliver` documenta `'local' suppresses; '' clears the override`; `--script` aceita **apenas caminho relativo sob `~/.hermes/scripts/`** (caminho absoluto é recusado por `tools/cronjob_job_args.py:291-309`, guarda contra injeção).
- Canal de aviso: `~/.hermes/scripts/alerta.sh` (binário por caminho absoluto, 3 tentativas, log em `~/.hermes/logs/island_alerts.log`, sem fila de reenvio — decisão do usuário em 12/09). `enviar_alerta` devolve 0/1 (0 = entregue; 1 depois das 3 tentativas, com `DESCARTADO` no log).
- Jobs: **11 no `jobs.json`** (8 `enabled`, 3 `paused`), e a tabela abaixo lista os 8 ativos. Entrega: `Hermes Snapshot` (**local**, `origin: null`), `sync-treino-diario-23h` (**local**, origin telegram), `hermes-local-backup` (**local**, origin **webui**), `update-date-daily` (**local**, origin telegram), `analise-diaria-pos-treino` (origin), `auditoria-skills-hermes` (origin), `Lembrete Dia da Avó` (origin), `treino-planejamento-semanal` (local **com `failure_deliver: origin`** — o único). Nenhum job tem `last_delivery_error` preenchido hoje. Job pausado **também** gera incidente (o `sync-treino-opengym` pausado responde por um dos 2 `alerted`).

## Requisitos Funcionais

- **RF-1.** Os **quatro** jobs ativos hoje mudos (`c75628767d63`, `fe7ae09e86b4`, `c7881494de97`, `2e74802a9fe1`) passam a ter `failure_deliver: telegram` por `hermes cron edit <id> --failure-deliver telegram`; os outros campos ficam idênticos. **`telegram` explícito, não `origin`:** `origin` só chega no celular quando a origem do job é o Telegram, e o `Hermes Snapshot` tem `origin: null` (não resolveria para nada: vira `not_configured`, o incidente fica `alerted` e **nenhuma mensagem sai**) enquanto o `hermes-local-backup` tem origem `webui` (entregaria na sessão web, não no celular).
- **RF-2.** Depois do `edit`, a **próxima** falha de cada um desses jobs chega no Telegram e nasce como incidente novo em `hermes cron incidents --state alerted` (assinatura nova, porque o texto do erro carrega data). **Os incidentes antigos daquela assinatura continuam em `detected`** — o `edit` não move incidente nenhum; eles só saem com `ack`.
- **RF-3.** O `island_healthcheck.sh` alerta, uma vez por ocorrência, para: (a) incidente em `detected` com `last_seen_at` **mais velho que `INCIDENTES_GRACE_MIN`** (60 min) e **dentro da janela `INCIDENTES_JANELA_H`** (48 h); (b) job **ativo** com `last_delivery_error` preenchido (a última execução tentou entregar e não conseguiu). Incidente fora da janela (histórico antigo) **não** alerta.
- **RF-4.** Repetição não gera aviso no mesmo dia: a chave da ocorrência (`i:<id>` ou `d:<job>:<assinatura>:<data>`) fica em `.incidents-told` e é consultada antes de cada envio.
- **RF-5.** Falha de leitura do banco ou do `jobs.json` não alerta: imprime `ERRO:<motivo>`, registra `incidentes=sem-leitura` no log do ciclo e segue.
- **RF-6.** `island_healthcheck.sh --incidents` lista o que está alertável (id, job, tipo de falha, desde, último, motivo) e o resumo, e sai com 0 **antes** de qualquer alerta e antes de gravar estado: não manda mensagem, não escreve `.incidents-told` e não altera a linha do ciclo em `island_health_cron.log`. É leitura pura, como o `--containers`. **Não combinar com `--test`**, que tem precedência (bloco na linha 53, antes do ponto de inserção) e manda mensagem de teste de verdade.
- **RF-7.** A linha do ciclo no log (`island_health_cron.log`, a que já traz `continent=… app=… http=…`) ganha `incidentes=<n>detected/<n>alerted`; o arquivo de estado de 4 linhas **não** muda de formato.
- **RF-8.** Nada em `~/.hermes/hermes-agent/**` é modificado.
- **RF-9.** O ciclo humano é documentado na mensagem e no `RESTORE.md`/backlog: `hermes cron incidents ack <id>` fecha o incidente e ele sai de `--state detected`. **O que o `ack` faz e o que não faz:** ele cala **aquela assinatura** (o próprio agendador passa a suprimir, `scheduler.py:359` + `2609`), então o vigia e o agente param de falar dela; uma falha **nova** do mesmo job mina incidente novo e avisa de novo. É a composição das duas decisões do usuário: lembrado todo dia enquanto falha, e cada aviso fica pendente até o `ack` dele.

## Detalhe de Implementação (nível código)

### 1. Ligar o aviso nativo (RF-1)

Verificação ANTES (guarda contra o erro que quase entrou na v2): um `failure_deliver: origin` só chega no celular se a origem do job for o Telegram. Rodar isto primeiro e olhar a coluna `origem`:

```bash
export PATH="/home/pi/.local/bin:$PATH"
python3 -c "
import json
j = json.load(open('/home/pi/.hermes/cron/jobs.json', encoding='utf-8'))
for x in j['jobs']:
    o = x.get('origin') or {}
    print('%-28s deliver=%-7s failure_deliver=%-8s origem=%s' % (
        x['name'][:28], x.get('deliver'), x.get('failure_deliver') or '-', o.get('platform') or 'NENHUMA'))
"
```

O que se espera ver hoje (chaves: `origin: null` no snapshot e origem `webui` no backup local, os dois casos em que `origin` **não** alcança o celular):

```
Hermes Snapshot              deliver=local   failure_deliver=-        origem=NENHUMA
sync-treino-diario-23h       deliver=local   failure_deliver=-        origem=telegram
hermes-local-backup          deliver=local   failure_deliver=-        origem=webui
update-date-daily            deliver=local   failure_deliver=-        origem=telegram
```

Aplicar o alvo explícito nos quatro:

```bash
export PATH="/home/pi/.local/bin:$PATH"
for j in c75628767d63 fe7ae09e86b4 c7881494de97 2e74802a9fe1; do
  hermes cron edit "$j" --failure-deliver telegram
done
```

Conferência (tem que sair `telegram` nos quatro, e nenhum `origin: null` envolvido):

```bash
python3 -c "
import json
j = json.load(open('/home/pi/.hermes/cron/jobs.json', encoding='utf-8'))
alvo = {'c75628767d63','fe7ae09e86b4','c7881494de97','2e74802a9fe1'}
falhou = 0
for x in j['jobs']:
    if x['id'] in alvo:
        ok = x.get('failure_deliver') == 'telegram'
        falhou += 0 if ok else 1
        print('%-28s failure_deliver=%s %s' % (x['name'][:28], x.get('failure_deliver') or '-', 'OK' if ok else 'FALHOU'))
raise SystemExit(1 if falhou else 0)
"
```

Se a conferência falhar, **não** siga: sem `failure_deliver` no alvo certo a falha continua sem avisar (a perna (a) do vigia cobre, mas com até 15 min de atraso e menos contexto).

> **Por que não `origin`.** `origin` entrega no canal **de onde o job foi criado**. Três dos quatro foram criados no Telegram, mas o `Hermes Snapshot` tem `origin: null` (nada para resolver: o desfecho vira `not_configured`, o incidente é marcado `alerted` e **nenhuma mensagem sai** — o pior desfecho possível, porque parece resolvido) e o `hermes-local-backup` nasceu na WebUI (`origin.platform = webui`), então o aviso iria para a sessão web, não para o celular do usuário. `telegram` é explícito e é o mesmo alvo que o `alerta.sh` já usa (`hermes send --to telegram`).
> Os quatro ids são os da resposta do usuário ("todos os que hoje estão mudos"). Se algum fosse excluído, ele continuaria mudo e a perna (a) do vigia cobriria as falhas dele.

### 2. `~/.hermes/scripts/island_healthcheck.sh`

Antes de editar: `cp -p island_healthcheck.sh island_healthcheck.sh.bak.20260912-$(date +%H%M)` (com hora no sufixo: `cp -p` sobrescreve em silêncio, e `~/.hermes/scripts/` **não** é versionado pelo git — o `.bak` é a única volta, o `hermes update` não o protege nem o restaura).

**2.1 Uso e argumentos (linha 6 e o `case` do laço):**

```bash
# ANTES
# Uso: island_healthcheck.sh [--no-alert] [--test] [--containers]
# DEPOIS
# Uso: island_healthcheck.sh [--no-alert] [--test] [--containers] [--incidents]
```

```bash
# ANTES (dentro do case)
    --containers) SO_CONTAINERS=1 ;;
# DEPOIS
    --containers) SO_CONTAINERS=1 ;;
    --incidents)  SO_INCIDENTES=1 ;;
```
e inicializar junto das outras flags (achar com `grep -n 'SO_CONTAINERS=' island_healthcheck.sh`): `SO_CONTAINERS=""` → `SO_CONTAINERS=""` + `SO_INCIDENTES=""`.

> **Combinações de flag (documentar, não combinar):** `--test` tem **precedência** — o bloco dele está na linha 53, muito antes do ponto de inserção do `--incidents`, e faz `exit 0`/`exit 1`. Logo `island_healthcheck.sh --incidents --test` **manda mensagem de teste de verdade** no Telegram em vez de inspecionar (o usuário acha que espiou e mandou mensagem). `--incidents --no-alert` é inofensivo: inspeção pura, como sozinho.

**2.2 Constantes novas (junto de `APP_CONTAINERS`/`APP_HEALTH_URL`):**

```bash
CRON_DB="${CRON_DB:-$HERMES_HOME/cron/executions.db}"
JOBS_JSON="${JOBS_JSON:-$HERMES_HOME/cron/jobs.json}"
INCIDENTES_TOLD="${INCIDENTES_TOLD:-$HERMES_HOME/drive_backup/.incidents-told}"
INCIDENTES_GRACE_MIN="${INCIDENTES_GRACE_MIN:-60}"
INCIDENTES_JANELA_H="${INCIDENTES_JANELA_H:-48}"
```

**2.3 Funções novas (depois de `app_ruim`):**

> Usa o `python3` **do sistema** (`/usr/bin/python3`), resolvido pelo `PATH` do cron declarado em `/etc/cron.d/island-ops` — **não** é o `venv` do agente (`~/.hermes/hermes-agent/venv`, que não está nesse PATH). Só biblioteca padrão (`sqlite3`, `hashlib`, `json`, `datetime`).

```bash
# ---------- Incidentes de job ----------
# Le APENAS: o banco do agente nunca e escrito por este script.
# Saida (stdout): uma linha por ocorrencia, campos separados por TAB.
#   inc<TAB>id<TAB>nome do job<TAB>tipo de falha<TAB>desde<TAB>ultimo<TAB>motivo
#   err<TAB>job_id<TAB>nome do job<TAB>assinatura<TAB>dia<TAB>erro de entrega
# Falha de leitura sai como "ERRO:<motivo>" (nunca colide com um id).
incidentes_listar(){
  command -v python3 >/dev/null 2>&1 || { echo "ERRO:sem-python3"; return; }
  [ -f "$CRON_DB" ] || { echo "ERRO:banco-ausente"; return; }
  CRON_DB="$CRON_DB" JOBS_JSON="$JOBS_JSON" \
  INCIDENTES_GRACE_MIN="$INCIDENTES_GRACE_MIN" INCIDENTES_JANELA_H="$INCIDENTES_JANELA_H" \
  python3 - <<'PY'
import hashlib, json, os, sqlite3
from datetime import datetime, timezone

db = os.environ["CRON_DB"]
grace = int(os.environ.get("INCIDENTES_GRACE_MIN") or 60)
janela = float(os.environ.get("INCIDENTES_JANELA_H") or 48) * 60

def minutos(iso):
    try:
        t = datetime.fromisoformat(str(iso))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() / 60
    except Exception:
        return None

def limpo(v):
    return " ".join(str(v or "").split())

nomes = {}
try:
    j = json.load(open(os.environ["JOBS_JSON"], encoding="utf-8"))
    nomes = {x["id"]: limpo(x.get("name", "?")) for x in j.get("jobs", [])}
except Exception:
    pass

con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
con.row_factory = sqlite3.Row
linhas = []
try:
    for r in con.execute(
        "select id, job_id, state, failure_type, first_seen_at, last_seen_at, error "
        "from cron_incidents where state='detected' order by last_seen_at desc"
    ):
        idade = minutos(r["last_seen_at"])
        if idade is None or idade < grace or idade > janela:
            continue          # entrega ainda em curso, ou historia morta
        nome = nomes.get(r["job_id"]) or ("%s (nao esta mais no agendador)" % r["job_id"])
        motivo = limpo(r["error"])[:160]
        linhas.append("\t".join(["inc", r["id"], nome, limpo(r["failure_type"]),
                                 str(r["first_seen_at"])[:16], str(r["last_seen_at"])[:16], motivo]))
finally:
    con.close()

# Perna 2: a ULTIMA execucao do job tentou entregar o aviso e nao conseguiu.
# O campo e reescrito a cada execucao (None quando a entrega deu certo), entao isto
# descreve o estado atual do job, nao um evento antigo.
try:
    dados = json.load(open(os.environ["JOBS_JSON"], encoding="utf-8"))
    for x in dados.get("jobs", []):
        err = limpo(x.get("last_delivery_error"))
        if not err:
            continue
        if not x.get("enabled", True):
            continue          # job pausado nao vai rodar de novo: erro de entrega e passado
        assinatura = hashlib.sha256((x["id"] + " " + err[:200]).encode()).hexdigest()[:12]
        # A data entra na chave de proposito: o mesmo texto de erro amanha e ocorrencia nova,
        # para o usuario ser lembrado enquanto a entrega continuar falhando.
        dia = datetime.now().strftime("%Y-%m-%d")
        linhas.append("\t".join(["err", x["id"], limpo(x.get("name", "?")), assinatura,
                                 dia, err[:160]]))
except Exception:
    pass

print("\n".join(linhas))
PY
}

incidentes_resumo(){
  [ -f "$CRON_DB" ] || { echo "sem-leitura"; return; }
  CRON_DB="$CRON_DB" python3 - <<'PY' 2>/dev/null || echo "sem-leitura"
import os, sqlite3
con = sqlite3.connect("file:%s?mode=ro" % os.environ["CRON_DB"], uri=True)
try:
    d = con.execute("select count(*) from cron_incidents where state='detected'").fetchone()[0]
    a = con.execute("select count(*) from cron_incidents where state='alerted'").fetchone()[0]
    print("%ddetected/%dalerted" % (d, a))
finally:
    con.close()
PY
}

ocorrencia_ja_avisada(){
  [ -f "$INCIDENTES_TOLD" ] && grep -qxF "$1" "$INCIDENTES_TOLD" 2>/dev/null
}

ocorrencia_marcar(){
  mkdir -p "$(dirname "$INCIDENTES_TOLD")"
  printf '%s\n' "$1" >> "$INCIDENTES_TOLD"
}

# Igual a alert(), mas devolve o codigo de entrega em vez de sempre 0: o bloco de
# incidentes marca a ocorrencia SO quando a mensagem sai. Se o canal estiver fora,
# o ciclo seguinte (15 min) tenta de novo, em vez de o aviso sumir para sempre.
# Depende de o script NAO usar 'set -e' (nao usa): o codigo de retorno e o predicado.
alerta_confirmado(){
  log "ALERT: $1"
  [ "$alerta_lib_ok" -eq 1 ] && [ -z "$NO_ALERT" ] || return 1
  enviar_alerta "🩺 [SENSOR ILHA] $1"
}
```

**2.4 Alerta (depois do bloco de transição do app, no fim do fluxo normal):**

```bash
# ---------- Incidentes de job que nao chegaram em ninguem ----------
# 'detected' = o agendador nao conseguiu entregar (entrega que falha nao vira
# 'alerted'); a segunda perna cobre a ultima execucao cujo aviso nao saiu.
# Campos por linha (TAB): linha 'inc' = inc|id|nome|tipo|desde|ultimo|motivo
#                         linha 'err' = err|job_id|nome|assinatura|dia|erro
LISTA_INC=$(incidentes_listar)
case "$LISTA_INC" in
  ERRO:*) log "incidentes=sem-leitura (${LISTA_INC#ERRO:})" ;;
  "")     : ;;
  *)      while IFS=$'\t' read -r forma a b c d e f; do
            case "$forma" in
              inc)
                ocorrencia_ja_avisada "i:$a" && continue
                if alerta_confirmado "⚠️ JOB FALHANDO SEM AVISO: \"$b\" ($c) desde $d, visto por ultimo em $e. Motivo: $f — para marcar como visto: hermes cron incidents ack $a"; then
                  ocorrencia_marcar "i:$a"
                else
                  log "incidente $a nao entregue; tento de novo no proximo ciclo"
                fi
                ;;
              err)
                CHAVE="d:$a:$c:$d"
                ocorrencia_ja_avisada "$CHAVE" && continue
                if alerta_confirmado "⚠️ AVISO DE FALHA NAO ENTREGUE: o job \"$b\" ($a) falhou em $d e o aviso nao saiu ($e). Verifique a entrega do Telegram e o job em si."; then
                  ocorrencia_marcar "$CHAVE"
                else
                  log "erro de entrega de $a nao anunciado; tento de novo no proximo ciclo"
                fi
                ;;
            esac
          done < <(printf '%s\n' "$LISTA_INC")
          ;;
esac
```

> **Mapa dos campos** — as duas formas usam o mesmo `read -r forma a b c d e f`:
> `inc` (7 campos) → `a`=id, `b`=nome do job, `c`=tipo de falha, `d`=desde, `e`=último, `f`=motivo · `err` (6 campos) → `a`=job_id, `b`=nome, `c`=assinatura, `d`=dia, `e`=erro de entrega, e `f` fica vazio. Ler com menos variáveis engoliria campos.
> **A chave da perna `err` inclui o dia** (`d:<job>:<assinatura>:<dia>`), e é por isso que ela repete no máximo uma vez por dia enquanto o campo continuar preenchido.

**2.5 Modo `--incidents` (leitura pura, logo depois do bloco `--containers` e antes do `log` do ciclo):**

Este bloco tem que vir **antes** do `log "continent=… incidentes=…"` e de todo bloco de transição. Não é preferência de estilo: colocado depois, a inspeção mandaria os alertas que deveria apenas listar e ainda marcaria as ocorrências como anunciadas, silenciando o ciclo seguinte.

```bash
if [ -n "$SO_INCIDENTES" ]; then
  LISTA=$(incidentes_listar)
  case "$LISTA" in
    ERRO:*) echo "incidentes: ${LISTA#ERRO:}" ;;
    "")     echo "incidentes: nada alertavel (carencia ${INCIDENTES_GRACE_MIN} min, janela ${INCIDENTES_JANELA_H} h)" ;;
    *)      while IFS=$'\t' read -r forma a b c d e f; do
              case "$forma" in
                inc) printf 'incidente %s | %s | %s | desde %s (ultimo %s)\n  motivo: %s\n' "$a" "$b" "$c" "$d" "$e" "$f" ;;
                err) printf 'entrega-falhou | %s | %s | assinatura %s | %s\n  erro: %s\n' "$a" "$b" "$c" "$d" "$e" ;;
              esac
            done < <(printf '%s\n' "$LISTA")
            ;;
  esac
  echo "resumo: $(incidentes_resumo)"
  exit 0
fi
```

**2.6 Linha de log do estado (texto literal a copiar; a linha real é a `island_healthcheck.sh:180`):**

```bash
# ANTES
log "continent=$cur_continent island=$cur_island last_backup=$last_bk snapshot=${snap_txt:-ausente} app=$cur_app ($cur_detalhe) http=$cur_http"
# DEPOIS
log "continent=$cur_continent island=$cur_island last_backup=$last_bk snapshot=${snap_txt:-ausente} app=$cur_app ($cur_detalhe) http=$cur_http incidentes=$(incidentes_resumo)"
```

> `incidentes=` entra **depois** de `http=`, no fim da mesma linha. Cuidado para não confundir com o `printf 'containers: … app: …'` do modo `--containers` (linha 148), que tem dois pontos e **não** é a linha do ciclo. Custo: passa a rodar **dois** processos `python3` por ciclo (o `incidentes_listar` do bloco 2.4 e este resumo), 96 vezes por dia — dezenas de milissegundos cada, aceitável para um Pi que já roda `docker inspect` no mesmo ciclo.

## Evidência: o código desta spec já rodou (12/09/2026, antes de implementar)

> **Rodado duas vezes:** primeiro com os blocos da v2, e de novo depois da 2ª revisão, com os blocos da v3 (o `limpo()`, a chave com data, o filtro de job pausado e o `alerta_confirmado`). O segundo ciclo **achou um erro de verdade**: a mensagem da perna `err` imprimia `$f` (vazio) em vez de `$e`, e saía `o aviso nao saiu ()`. Corrigido, e é por isso que a evidência abaixo descreve a execução, não a leitura.

Montei os blocos 2.3, 2.4 e 2.5 num arquivo no Pi e executei contra **uma cópia** do banco (`VACUUM INTO`), com casos plantados. O que ficou provado:

- `bash -n` no arquivo montado: **OK**, sem erro de sintaxe. *(Sintaxe só: `bash -n` não pega campo trocado nem `printf` com argumento faltando — quem pega é a execução abaixo, e pegou.)*
- **Banco real:** lista **vazia** e resumo `12detected/2alerted`. Os 12 incidentes de 30/08 a 09/09 ficam de fora da janela de 48 h (é o silêncio querido sobre a história morta) e nenhum job tem `last_delivery_error`.
- **Cópia com quatro casos plantados** — incidente vivo de 90 min, incidente morto de 10 dias, erro de entrega num job **ativo** e erro de entrega num job **pausado**: a lista traz **só** o vivo e o erro do job ativo. O `cat -A` mostra os TAB e os campos em ordem (`inc^Iid^Inome^Itipo^Idesde^Iultimo^Imotivo` e `err^Ijob^Inome^Iassinatura^Idia^Ierro`), com o nome do job resolvido do `jobs.json` (`Hermes Snapshot`).
- A perna 2.4 anunciou os dois (dois `[TELEGRAM]`), gravou **`i:aaaaaa_111111111111`** e **`d:fe7ae09e86b4:689907dd77d3:2026-09-12`** em `.incidents-told`, e na **segunda passada não repetiu nada** (dedup conferido nas duas pernas).
- **Saída do `--incidents` conferida** (bloco 2.5 rodado de verdade contra a cópia): `incidente … | Hermes Snapshot | script | desde … (ultimo …)` + `motivo: …`, depois `entrega-falhou | … | assinatura … | 2026-09-12` + `erro: …`, e `resumo: …`. É o mesmo texto do preview de UX.
- Incidente de **20 min não aparece** (a carência de 60 min está funcionando).
- `CRON_DB=/tmp/nao-existe` → `ERRO:banco-ausente`, sem alarme.

> **O que a bancada NÃO provou:** a entrega no Telegram (nenhum critério que manda mensagem foi executado — ver o aviso nos critérios) e o comportamento sob `database is locked` real.

## Critérios de aceite

> **Dois destes critérios mandam mensagem real no Telegram** (2 e 4): o resto não.

1. `hermes cron incidents --state detected` **continua** listando os incidentes antigos depois dos quatro `edit` — o `edit` não move incidente nenhum. O que muda: a partir da **próxima** falha de cada job, nasce incidente novo que já aparece em `hermes cron incidents --state alerted` (e a mensagem chegou). Os antigos só saem com `ack`.
2. **Teste ponta a ponta com job descartável** (manda mensagem real). O script precisa ficar sob `~/.hermes/scripts/`: caminho absoluto é recusado pelo agente (`tools/cronjob_job_args.py:291-309`), então **não** use `/tmp/...`:
   ```bash
   printf '#!/bin/bash\nexit 1\n' > ~/.hermes/scripts/falha_teste.sh
   chmod +x ~/.hermes/scripts/falha_teste.sh
   hermes cron create "0 5 * * *" --name teste-incidente --script falha_teste.sh \
     --no-agent --failure-deliver telegram
   hermes cron run <id>
   ```
   Esperado: mensagem de falha no Telegram, incidente novo em `--state alerted`. Depois: `hermes cron remove <id>` e `rm ~/.hermes/scripts/falha_teste.sh`. Nada do job real é tocado (o `Hermes Snapshot` continua intacto, com o `failure_deliver` novo).
3. `bash ~/.hermes/scripts/island_healthcheck.sh --incidents` lista o alertável e o resumo, sai com 0, e a linha do ciclo em `~/.hermes/logs/island_health_cron.log` **não** ganha entrada nova (prova de que saiu antes do `log`); `.incidents-told` fica byte a byte igual e o Telegram fica mudo.
4. Com um incidente vivo forçado numa **cópia** do banco (`sqlite3 "$HOME/.hermes/cron/executions.db" "VACUUM INTO '/tmp/rv_cron.db'"` — precisa de linha com `state='detected'`, `error_sig` preenchido e `last_seen_at` de **90 min**; dentro da carência não adianta, tem que passar dos 60 min), `CRON_DB=/tmp/rv_cron.db bash ~/.hermes/scripts/island_healthcheck.sh` manda **um** alerta; rodando de novo, **não** repete; a chave fica em `.incidents-told`. E o arquivo `~/.hermes/drive_backup/.health-state` continua com **4 linhas** depois da execução (prova de que o bloco novo não pulou a persistência de estado). *(Bancada: pernas e dedup verificados.)*
5. **Histórico morto não alerta:** com a cópia do banco e um incidente `detected` com `last_seen_at` de 10 dias atrás, nem `--incidents` nem o ciclo normal o listam. *(Já verificado.)*
6. `CRON_DB=/tmp/nao-existe bash ~/.hermes/scripts/island_healthcheck.sh --incidents` imprime `incidentes: banco-ausente` e sai com 0. *(A função já devolve `ERRO:banco-ausente`; verificado.)*
7. **Ciclo do ack, as duas metades:** (a) `hermes cron incidents ack <id>` fecha o incidente, ele sai de `--state detected` e o vigia **para** de anunciá-lo (a chave `i:<id>` já está em `.incidents-told`; e o próprio agendador suprime a assinatura reconhecida, `scheduler.py:359`). (b) Uma falha **nova** do mesmo job (assinatura nova, com outra data no texto) mina incidente novo, que **volta a ser anunciado** — é a composição do "lembrado enquanto falha" com o "só fecha com o meu ack".
8. **Degradação sem `jobs.json`:** com `JOBS_JSON=/tmp/nao-existe` e o incidente vivo da cópia, a lista ainda traz a linha `inc`, com o nome trocado pelo aviso `c75628767d63 (nao esta mais no agendador)`, e **nenhuma** linha `err` (a perna `err` sai do mesmo arquivo) — nada de alerta inventado. *(Verificado.)*
9. `bash -n` no script alterado e `hermes cron doctor` sem problemas depois das edições de job. **`bash -n` prova sintaxe, não comportamento** (passaria com campo trocado no `read` ou `printf` com argumento a menos) — o comportamento é o critério 3 e a bancada da seção anterior.
10. `git -C ~/.hermes/hermes-agent status --short --untracked-files=all` vazio **e** `git -C ~/.hermes/hermes-agent log -1 --format=%H` igual ao de antes da implementação (HEAD atual: `e9bccc90a5e314ddf6dd4bd3772d50cb40027275`, de 06/09/2026). Só o `status` vazio não provaria nada: editar e reverter também deixa vazio.

## Riscos e rollback

- **Limitação conhecida (aceita):** se o alvo de entrega não resolver, o desfecho é `not_configured` e o incidente vira `alerted` **sem** mensagem ter saído. A perna `err` do vigia não cobre esse caso (não há `last_delivery_error`). É cenário de deriva de configuração, e é exatamente o que motivou usar `telegram` em vez de `origin` no RF-1 (o `Hermes Snapshot` tem `origin: null` e cairia aqui).
- **A falha recorrente re-avisa uma vez por dia** enquanto durar, porque cada dia mina incidente novo (o texto do erro carrega data). É o comportamento pedido pelo usuário; não é "uma vez e nunca mais".
- **O silêncio sobre o histórico de agosto depende da janela, não do `ack`.** Os 12 `detected` de 30/08 a 09/09 continuam no banco e nada os remove; o mais recente está a ~3 dias, e a janela é de 2 dias — a margem é de **cerca de um dia**. Se `INCIDENTES_JANELA_H` subir, eles voltam a alertar. Para tirá-los do jogo de vez, `ack` em cada um.
- **O vigia compartilha o canal com o aviso nativo.** A independência dele é em relação ao **agendador** (roda no cron do sistema, sobrevive a gateway caído), **não** ao canal: os dois usam `hermes send --to telegram`. Uma queda do Telegram derruba os dois, e aí o único vestígio é o `DESCARTADO` no `island_alerts.log`.
- **A marcação da ocorrência só acontece com a mensagem entregue.** Se o canal estiver fora, o vigia tenta de novo a cada ciclo (15 min) em vez de perder o aviso. Efeito colateral aceito: com o Telegram fora por horas, o log acumula uma linha por ciclo — e a primeira tentativa bem-sucedida fecha a ocorrência.
- **O `hermes update` não é afetado** (nada é editado no código do agente; o `~/.hermes/scripts/` está fora do clone, então não é sobrescrito — mas também **não é versionado**: o `.bak` com hora no nome é a única volta).
- **`database is locked`** durante transação do agente é tratado como falha de leitura (silêncio, sem alarme falso; e `incidentes=sem-leitura` no log).
- **`.incidents-told` cresce** uma linha por ocorrência anunciada (~50 bytes). Pior caso com 4 jobs: ~2 KB por ano. **Sem poda** — não vale o risco de reescrever o arquivo no caminho do cron (que roda 96×/dia) por causa de 2 KB.
- **Rollback do `failure_deliver`:** `hermes cron edit <id> --failure-deliver ''` — a CLI documenta `'' clears the override` (`hermes_cli/subcommands/cron.py:96`, e o mesmo em `create`) e o `failures follow --deliver` volta a valer, ou seja, silêncio outra vez (o `deliver` deles é `local`). Não é preciso editar o `jobs.json` na mão.
- **Rollback do sensor:** `cp` do `island_healthcheck.sh.bak.20260912-<hora>` e, se quiser que o vigia volte a anunciar tudo, apagar `.incidents-told`.

## Testes manuais

1. `hermes cron incidents --state detected` antes e depois dos quatro `edit` (critério 1).
2. Job descartável com falha forçada, script sob `~/.hermes/scripts/` (critério 2) — **manda mensagem real**.
3. `--incidents` (critério 3).
4. Incidente vivo e incidente morto numa cópia do banco, e conferência das 4 linhas do `.health-state` (critérios 4 e 5).
5. `CRON_DB` inexistente (critério 6).
6. `ack` e conferência de que aquele incidente sumiu — e de que uma falha nova volta a avisar (critério 7).
7. `bash -n`, `hermes cron doctor` e o código do agente intacto (critérios 9 e 10).

## Comportamento Visual/UX

- **Antes:** a falha virava linha no banco. `hermes cron list` não mostrava nada, o Telegram ficava mudo, e descobrir exigia alguém rodar `hermes cron incidents` por conta própria — foi assim que 10 dias de snapshot falho passaram.
- **Depois**, do caminho nativo (imediato) ou do vigia (até 15 min depois, se o nativo não conseguiu). O prefixo `🩺 [SENSOR ILHA]` é acrescentado pelo `alert()` do próprio healthcheck (`island_healthcheck.sh:45-51`), então as duas mensagens chegam assim:

```
🩺 [SENSOR ILHA] ⚠️ JOB FALHANDO SEM AVISO: "Hermes Snapshot" (script) desde 2026-09-01 06:00, visto por ultimo em 2026-09-09 06:00. Motivo: Script exited with code 128 stderr: fatal: a branch named 'main' already exists — para marcar como visto: hermes cron incidents ack c75628_bdb576a74757
🩺 [SENSOR ILHA] ⚠️ AVISO DE FALHA NAO ENTREGUE: o job "sync-treino-diario-23h" (fe7ae09e86b4) falhou em 2026-09-12 e o aviso nao saiu (Temporary failure in name resolution). Verifique a entrega do Telegram e o job em si.
```

- **A lista continua sendo a fonte da verdade**, agora com estado que significa algo. Este é o formato **real** da CLI (conferido na máquina em 12/09/2026, `hermes cron incidents --state detected`), um bloco por incidente — e não uma linha por incidente:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cron Failure Incidents                          │
└─────────────────────────────────────────────────────────────────────────┘

  c75628_bdb576a74757  detected
    Job:        c75628767d63
    Type:       script
    First seen: 2026-09-09T06:00:40.242124-03:00
    Last seen:  2026-09-09T06:00:40.242124-03:00
    Error:      Script exited with code 128 stderr: fatal: a branch named 'main' already exists stdout: 🐸 Hermes Snapshot — 2026-09-09_06-00-38
    Output:     /home/pi/.hermes/cron/output/c75628767d63/2026-09-09_06-00-40.md

  c75628_15ed3da48045  detected
    ...
```

> **Duas consequências para quem for usar:** o campo `Job:` traz o **id**, não o nome (por isso a mensagem do vigia resolve o nome no `jobs.json` e sai mais legível que a CLI), e o campo `Output:` aponta o arquivo da execução — é o "log completo" quando o motivo resumido não basta.
> O reconhecimento é `hermes cron incidents ack c75628_bdb576a74757`; depois dele o incidente sai de `--state detected` e o vigia para de falar dele.

- **Inspeção rápida, sem alertar:** `bash ~/.hermes/scripts/island_healthcheck.sh --incidents`.
