# Spec: alarme do sensor da ilha — PATH do cron e entrega verificável — v3 (final)

## Contexto e Objetivo

O Hermes roda num Pi (a "ilha") cujo HD externo (o "continente", `/mnt/drivebackup`) guarda todas as
camadas de backup. Existe **um único sensor independente do agente**: `island_healthcheck.sh`, agendado
em `/etc/cron.d/island-ops` a cada 15 minutos, junto com `island_backup.sh` (rsync da ilha para o
continente, de 6 em 6 horas).

O sensor detecta as falhas corretamente, escreve no log e **tenta** avisar por Telegram. A tentativa
nunca sai: os dois scripts chamam `hermes send --to telegram`, o binário mora em
`/home/pi/.local/bin/hermes` e esse diretório não está no PATH com que o cron executa o arquivo (o PATH
do cron cobre `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin`). O `>/dev/null 2>&1` mais o
`|| true` engolem o "command not found", e não há MTA instalado. Resultado: o sensor existe, detecta e
registra em log, e o aviso morre ali. O último `ALERT:` registrado no log do sensor é de 31/08/2026
18:00 e não houve entrega.

Objetivo: **fazer o aviso chegar** e fazer com que uma falha de entrega deixe rastro em vez de
desaparecer. O núcleo é uma linha de `PATH` no agendamento; o resto do escopo existe para que o caminho
de alerta seja verificável de ponta a ponta e não volte a falhar em silêncio.

Onde vive: máquina `hermes` (Raspberry Pi, Ubuntu ARM64, usuário `pi` com `sudo` NOPASSWD), arquivos em
`/home/pi/.hermes/scripts/` e `/etc/cron.d/island-ops`. A fonte do agendamento é
`/home/pi/.hermes/scripts/island-ops.crontab`, instalada com `sudo install -m644`. Esta spec fecha a
lacuna de alarme da **BACKLOG-08** (`docs/backlog.md` do repo openGym, linha 58) e nasce da varredura de
12/09/2026.

## Escopo

- **Inclui:**
  - `PATH`, `SHELL` e `MAILTO` explícitos no `/etc/cron.d/island-ops` **e** na sua fonte.
  - Os dois scripts deixam de depender do PATH para achar o binário `hermes`.
  - Toda tentativa de envio registrada em log próprio, com 3 tentativas por alerta.
  - Flag `--test` no healthcheck para provar a entrega sob o ambiente do cron.
  - Alarme de "snapshot do GitHub atrasado" no mesmo sensor, alimentado por um carimbo de sucesso do
    `snapshot.sh` (aprovado pelo usuário na pergunta 2).
  - A fonte do agendamento (`island-ops.crontab`) passa a ser versionada no snapshot diário.
- **Não inclui:**
  - Fila de reenvio de alertas: **decidido pelo usuário que não entra** (pergunta 1). Alerta que não sai
    depois das 3 tentativas é registrado e descartado.
  - Mexer nos jobs do cron do agente (`~/.hermes/cron/jobs.json`).
  - Instalar MTA ou canal de alerta novo (o `hermes send` fala direto com a API do Telegram).
  - Monitorar espaço em disco (HD em 91%), saúde dos containers do openGym, temperatura, `vcgencmd`
    quebrado, validade de token e journald sem teto — encontrados na varredura, ficam para itens próprios.
  - Rotacionar o `client_secret` e o `password_hash` que estão no histórico do repo do snapshot.
  - Atualizar o `RESTORE.md` (item separado da BACKLOG-08).

## Decisões

### Do usuário (12/09/2026)

- **Pergunta 1 — aviso que não consegue sair:** o Pi tenta 3 vezes e, se ainda falhar, apenas **registra no
  log**; o aviso daquele ciclo se perde. **Sem fila de reenvio, sem reenvio no ciclo seguinte.**
- **Pergunta 2 — aviso quando o backup do GitHub não sair:** **entra neste conserto.** Snapshot atrasado
  passa a gerar alerta no Telegram.

### Assumidas por mim (detalhe de implementação, sem efeito visível além do descrito)

- **Uma biblioteca compartilhada (`alerta.sh`)** em vez de repetir a lógica nos dois scripts: o sistema já
  sofre de duas cópias divergentes do mesmo script (`sync_treino.sh`) e não vale criar a terceira.
- **3 tentativas com 5 segundos** entre elas (máximo 10 segundos de bloqueio por alerta). A rota do
  Telegram para o Pi falha em janelas curtas; o `errors.log` registra de 13 a 139 falhas de rede por dia.
- **Limiar de 26 horas** para o snapshot atrasado: o job roda a cada 24h às 06:00, então qualquer limiar
  abaixo de 24h daria alarme falso todo dia. Com 26h, um snapshot que falha é avisado no dia seguinte por
  volta das 08:00.
- **Carimbo de sucesso em arquivo** (`~/.hermes/snapshot_last_ok`) em vez de olhar a data do último commit:
  o commit não muda quando o job falha antes de commitar, e o carimbo só é escrito no fim de uma execução
  bem-sucedida (o `snapshot.sh` usa `set -euo pipefail`, então um `git push` rejeitado aborta antes de
  chegar lá). Sem carimbo, o sensor cai para a data do último commit do clone.
- **O carimbo é copiado pelo rsync da ilha para o HD** (não está em nenhuma exclusão). Depois de um
  restore ele pode voltar com data antiga e o sensor alerta: comportamento conservador, aceito de propósito.
- **Sem `hermes send --quiet`**: capturo stdout e stderr juntos e só uso o texto quando o comando falha
  (no sucesso a saída é descartada).
- **Backups dos arquivos alterados seguem a convenção da casa:** `arquivo.bak.20260912`.

## Requisitos Funcionais

- **RF-1.** `/etc/cron.d/island-ops` declara `PATH` com `/home/pi/.local/bin` na frente, mais
  `SHELL=/bin/bash` e `MAILTO=""`; a fonte `island-ops.crontab` fica idêntica ao instalado (a fonte é o que
  o `RESTORE.md` manda instalar, então as duas não podem divergir).
- **RF-2.** Os dois scripts acham o binário `hermes` por caminho absoluto, sem depender de `PATH`, na ordem
  `$HERMES_BIN` → `$HOME/.local/bin/hermes` → `/home/pi/.local/bin/hermes` → `command -v hermes`. Nenhum
  deles chama `hermes send` diretamente.
- **RF-3.** Todo envio tem resultado registrado em `~/.hermes/logs/island_alerts.log`: `OK` com o número da
  tentativa, `FALHA` com o código e o erro devolvido, e `DESCARTADO` quando as 3 tentativas se esgotam. A
  função `alert()` **sempre devolve 0** para o chamador: alerta não pode abortar o script do cron.
- **RF-4.** `island_healthcheck.sh --test` envia uma mensagem de teste, termina com código 0 se a entrega
  funcionou e 1 se falhou, e **não** toca no arquivo de estado do sensor (`~/.hermes/drive_backup/.health-state`)
  nem nas checagens: sai antes delas. Ele registra 2 linhas no log do sensor (`TESTE: …`), o que é
  intencional.
- **RF-5.** O healthcheck avisa quando o snapshot do GitHub passa de `SNAPSHOT_MAX_H` horas (padrão 26),
  medindo primeiro o carimbo `~/.hermes/snapshot_last_ok` e, se ele não existir, a data do último commit do
  clone `~/hermes-snapshot`. Sem carimbo e sem clone, registra `snapshot=ausente` e não alerta.
- **RF-6.** O `snapshot.sh` passa a carimbar `~/.hermes/snapshot_last_ok` **depois** de uma execução
  bem-sucedida e a copiar `*.crontab` de `~/.hermes/scripts` para o repo.
- **RF-7.** Se a biblioteca `alerta.sh` estiver ausente ou quebrada, os dois scripts registram
  `ENVIO IMPOSSIVEL: …` no log uma vez por execução e seguem funcionando; nada é descartado em silêncio.

## Detalhe de Implementação (nível código)

Ordem: 1 → 2 → 3 → 4 → 5, e depois os testes. Caminhos absolutos no Pi. Numeração de linha conferida
contra os arquivos reais em 12/09/2026.

### 1. `~/.hermes/scripts/alerta.sh` (arquivo novo)

```bash
#!/usr/bin/env bash
# alerta.sh — envio de alerta dos sensores da ilha (healthcheck e backup).
# Por que existe: os scripts chamavam `hermes send` contando com o PATH, e o PATH do
# cron nao inclui ~/.local/bin — o alerta falhava calado ate 12/09/2026.
# Decisao do usuario (12/09/2026): sem fila de reenvio; se as tentativas falharem, o
# motivo fica em island_alerts.log e o aviso daquele ciclo se perde.
# Uso:  . "$HERMES_HOME/scripts/alerta.sh"; enviar_alerta "texto"
# Precedencia do binario: $HERMES_BIN > $HOME/.local/bin/hermes > /home/pi/.local/bin/hermes > `command -v hermes`
: "${HERMES_HOME:=/home/pi/.hermes}"
: "${ALERTA_LOG:=$HERMES_HOME/logs/island_alerts.log}"
: "${ALERTA_TENTATIVAS:=3}"
: "${ALERTA_ESPERA:=5}"

alerta_registrar(){
  mkdir -p "$(dirname "$ALERTA_LOG")"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$ALERTA_LOG"
}

# Resolve o binario sem depender do PATH do cron.
alerta_bin(){
  local b
  for b in "${HERMES_BIN:-}" "$HOME/.local/bin/hermes" /home/pi/.local/bin/hermes; do
    if [ -n "$b" ] && [ -x "$b" ]; then printf '%s' "$b"; return 0; fi
  done
  b="$(command -v hermes 2>/dev/null || true)"
  if [ -n "$b" ]; then printf '%s' "$b"; return 0; fi
  return 1
}

# Envia uma mensagem. Devolve 0/1; o motivo da falha fica em ALERTA_ERRO.
alerta_enviar(){
  local msg="$1" bin out rc
  ALERTA_ERRO=""
  bin="$(alerta_bin)" || { ALERTA_ERRO="binario hermes nao encontrado (PATH=$PATH)"; return 1; }
  out="$("$bin" send --to telegram "$msg" 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && return 0
  ALERTA_ERRO="rc=$rc: ${out:-sem saida}"
  return 1
}

# Tenta ate ALERTA_TENTATIVAS vezes, com ALERTA_ESPERA segundos entre as tentativas.
enviar_alerta(){
  local msg="$1" i=1
  while [ "$i" -le "$ALERTA_TENTATIVAS" ]; do
    if alerta_enviar "$msg"; then
      alerta_registrar "OK: alerta entregue (tentativa $i)"
      return 0
    fi
    alerta_registrar "FALHA tentativa $i/$ALERTA_TENTATIVAS: $ALERTA_ERRO"
    i=$((i + 1))
    if [ "$i" -le "$ALERTA_TENTATIVAS" ]; then sleep "$ALERTA_ESPERA"; fi
  done
  alerta_registrar "DESCARTADO: alerta nao entregue (decisao do usuario: sem reenvio)"
  return 1
}
```

O arquivo é apenas carregado com `.` (source), não precisa de bit de execução. Ele é `.sh` na raiz de
`~/.hermes/scripts/`, então o snapshot já o copia pelo passo 6 sem mudança.

### 2. `~/.hermes/scripts/island_healthcheck.sh`

Antes de editar: `cp island_healthcheck.sh island_healthcheck.sh.bak.20260912`.

**2.1 Cabeçalho de uso (linha 6):**

```bash
# ANTES
# Uso: island_healthcheck.sh [--no-alert]
# DEPOIS
# Uso: island_healthcheck.sh [--no-alert] [--test]
```

**2.2 Leitura de argumentos (linhas 19-20, conferidas: a 19 é `NO_ALERT=""` e a 20 é o teste):**

```bash
# ANTES
NO_ALERT=""
[ "${1:-}" = "--no-alert" ] && NO_ALERT=1
# DEPOIS
NO_ALERT=""
TESTE=""
for a in "$@"; do
  case "$a" in
    --no-alert) NO_ALERT=1 ;;
    --test)     TESTE=1 ;;
  esac
done
```

O `TESTE=""` antes do laço não é enfeite: o script roda com `set -uo pipefail` (linha 7) e, sem essa
inicialização, `[ -n "$TESTE" ]` abortaria a execução normal do cron por variável não definida.

**2.3 Substituir a linha 24 inteira** (a linha real tem 139 caracteres, é uma linha só e foi conferida
byte a byte):

```bash
# ANTES (linha 24, uma linha unica)
alert(){ local msg="🩺 [SENSOR ILHA] $1"; log "ALERT: $1"; [ -z "$NO_ALERT" ] && hermes send --to telegram "$msg" >/dev/null 2>&1 || true; }

# DEPOIS (bloco que ocupa o lugar da linha 24)
# Biblioteca de envio: nao depende do PATH do cron (ver alerta.sh).
# ALERTA_LOG entra aqui porque a mensagem de falha do --test cita o arquivo mesmo
# quando a biblioteca nao carregou (com `set -u`, usar a variavel seria erro fatal).
: "${ALERTA_LOG:=$HERMES_HOME/logs/island_alerts.log}"
ALERTA_LIB="$HERMES_HOME/scripts/alerta.sh"
alerta_lib_ok=0
if [ -r "$ALERTA_LIB" ] && . "$ALERTA_LIB" && command -v enviar_alerta >/dev/null 2>&1; then
  alerta_lib_ok=1
else
  log "ENVIO IMPOSSIVEL: $ALERTA_LIB ausente ou quebrada (nenhum alerta sera enviado)"
fi

alert(){
  log "ALERT: $1"
  if [ "$alerta_lib_ok" -eq 1 ] && [ -z "$NO_ALERT" ]; then
    enviar_alerta "🩺 [SENSOR ILHA] $1"
  fi
  return 0
}

if [ -n "$TESTE" ]; then
  log "TESTE: enviando alerta de teste"
  if [ "$alerta_lib_ok" -eq 1 ] && enviar_alerta "🧪 [SENSOR ILHA] teste manual do sensor em $(date '+%F %T'). Recebeu? Entao o caminho de alerta esta funcionando."; then
    log "TESTE: entrega OK"
    exit 0
  fi
  log "TESTE: entrega FALHOU — veja $ALERTA_LOG"
  exit 1
fi
```

O bloco do teste é o **último** pedaço da linha 24 trocada: ele sai antes das checagens de continente e
ilha (linhas 26 a 47) e antes de ler o arquivo de estado (linhas 51 a 54), então não altera o estado do
sensor. É intencional (RF-4).

**2.4 Idade do snapshot, depois do bloco de `last_bk` (depois da linha 62, antes da linha 64):**

```bash
# --- Idade do backup do GitHub (RF-5) ---
SNAP_REPO="${SNAP_REPO:-$HOME/hermes-snapshot}"
SNAP_STATE="${SNAP_STATE:-$HERMES_HOME/snapshot_last_ok}"
SNAPSHOT_MAX_H="${SNAPSHOT_MAX_H:-26}"
snap_age_h=""
snap_origem=""
snap_txt=""
snap_ref=0
if [ -f "$SNAP_STATE" ]; then
  snap_ref=$(date -r "$SNAP_STATE" +%s 2>/dev/null || echo 0)
  snap_origem="execucao"
fi
if [ "${snap_ref:-0}" -eq 0 ] && [ -d "$SNAP_REPO/.git" ]; then
  snap_ref=$(git -C "$SNAP_REPO" log -1 --format=%ct 2>/dev/null || echo 0)
  snap_origem="commit"
fi
if [ "${snap_ref:-0}" -gt 0 ]; then
  snap_age_h=$(( ($(date +%s) - snap_ref) / 3600 ))
  snap_txt="${snap_age_h}h(${snap_origem})"
fi
```

**2.5 Linha 64 (registro de estado):**

```bash
# ANTES
log "continent=$cur_continent island=$cur_island last_backup=$last_bk"
# DEPOIS
log "continent=$cur_continent island=$cur_island last_backup=$last_bk snapshot=${snap_txt:-ausente}"
```

**2.6 Dentro do `else` do continente (depois do alerta de backup obsoleto, linha 84):**

```bash
  if [ -n "$snap_age_h" ] && [ "$snap_age_h" -gt "$SNAPSHOT_MAX_H" ]; then
    alert "⚠️ Snapshot do GitHub atrasado (${snap_age_h}h, limite ${SNAPSHOT_MAX_H}h, medido por ${snap_origem}). Verifique o job Hermes Snapshot."
  fi
```

### 3. `~/.hermes/scripts/island_backup.sh`

Antes de editar: `cp island_backup.sh island_backup.sh.bak.20260912`.

**Função `alert` (linhas 29 a 35, conferidas; a linha 36 em branco fica):**

```bash
# ANTES
alert(){
  local msg="🛡️ [ILHA→CONTINENTE] $1"
  log "ALERT: $1"
  if [ -z "$NO_ALERT" ]; then
    hermes send --to telegram "$msg" >/dev/null 2>&1 || log "WARN: falha ao enviar Telegram"
  fi
}
# DEPOIS
# Biblioteca de envio: nao depende do PATH do cron (ver alerta.sh).
ALERTA_LIB="$HERMES_HOME/scripts/alerta.sh"
alerta_lib_ok=0
if [ -r "$ALERTA_LIB" ] && . "$ALERTA_LIB" && command -v enviar_alerta >/dev/null 2>&1; then
  alerta_lib_ok=1
else
  log "ENVIO IMPOSSIVEL: $ALERTA_LIB ausente ou quebrada (nenhum alerta sera enviado)"
fi

alert(){
  log "ALERT: $1"
  if [ "$alerta_lib_ok" -eq 1 ] && [ -z "$NO_ALERT" ]; then
    enviar_alerta "🛡️ [ILHA→CONTINENTE] $1"
  fi
  return 0
}
```

### 4. `~/.hermes/scripts/island-ops.crontab` (fonte) e `/etc/cron.d/island-ops` (instalado)

Hoje os dois são **idênticos**: 6 linhas, 558 bytes, md5 `04a8e5948d85acc350bd1af4b1656074`, ambos com
newline final. Antes de editar: `cp island-ops.crontab island-ops.crontab.bak.20260912`.

```cron
# ANTES (linhas 4 a 6 da fonte)
# Formato:  min hora dom mes dow  usuario  comando
*/15 * * * *  pi  /home/pi/.hermes/scripts/island_healthcheck.sh >> /home/pi/.hermes/logs/island_health_cron.log 2>&1
0 */6 * * *    pi  /home/pi/.hermes/scripts/island_backup.sh        >> /home/pi/.hermes/logs/island_backup_cron.log 2>&1

# DEPOIS (a fonte passa a ter 12 linhas)
# PATH explicito: o binario 'hermes' mora em /home/pi/.local/bin, que NAO esta no
# PATH com que o cron executa este arquivo. Sem esta linha todo alerta falha em
# silencio (foi o que aconteceu ate 12/09/2026 — ver spec_alerta_sensor_ilha.md).
SHELL=/bin/bash
PATH=/home/pi/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
# Formato:  min hora dom mes dow  usuario  comando
*/15 * * * *  pi  /home/pi/.hermes/scripts/island_healthcheck.sh >> /home/pi/.hermes/logs/island_health_cron.log 2>&1
0 */6 * * *    pi  /home/pi/.hermes/scripts/island_backup.sh        >> /home/pi/.hermes/logs/island_backup_cron.log 2>&1
```

Aplicar as duas pontas:

```bash
chmod 644 /home/pi/.hermes/scripts/island-ops.crontab          # hoje esta 664 (grupo escreve)
sudo install -m644 /home/pi/.hermes/scripts/island-ops.crontab /etc/cron.d/island-ops
diff <(sudo cat /etc/cron.d/island-ops) /home/pi/.hermes/scripts/island-ops.crontab && echo IDENTICOS
```

Três fatos que valem registrar: `install -m644` copia o conteúdo byte a byte e **sobrescreve o alvo sem
backup**; o modo 644 é obrigatório porque o cron ignora arquivos de `/etc/cron.d` que qualquer usuário
possa escrever; e `SHELL=/bin/bash` não é decorativo, é o que garante que o `set -uo pipefail` dos dois
scripts seja interpretado por bash e não por `sh`.

### 5. `~/.hermes/scripts/snapshot.sh` — carimbo de sucesso e a fonte do agendamento

Antes de editar: `cp snapshot.sh snapshot.sh.bak.20260912b` (já existe um `.bak.20260911`).

**5.1 Linha 81, no passo 6:**

```bash
# ANTES
    find "$HERMES_HOME/scripts" -maxdepth 1 -type f \( -name "*.py" -o -name "*.sh" \) -exec cp {} scripts/ \; 2>/dev/null || true
# DEPOIS
    find "$HERMES_HOME/scripts" -maxdepth 1 -type f \( -name "*.py" -o -name "*.sh" -o -name "*.crontab" \) -exec cp {} scripts/ \; 2>/dev/null || true
```

**5.2 No fim do arquivo, depois do bloco de commit e push (RF-6):**

```bash
# DEPOIS (acrescentar no fim do arquivo)
# Carimba a ultima execucao BEM SUCEDIDA: o sensor da ilha mede a idade deste arquivo.
# O script usa `set -euo pipefail`, entao um push rejeitado aborta antes de chegar aqui.
date '+%Y-%m-%dT%H:%M:%S%z' > "$HERMES_HOME/snapshot_last_ok"
```

Depois de editar: `bash -n snapshot.sh` para validar a sintaxe. Rodar `bash snapshot.sh` **é um passo
separado**, porque faz `git commit` e `git push` reais e depende de rede e do token do `gh`; se falhar, o
critério 9 fica sem prova até a execução seguinte das 06:00. **Cuidado:** a execução manual commita também
o que já estava pendente no working tree do clone, inclusive remoções de arquivos que sumiram do vivo
(ao rodar em 12/09/2026, o commit `a1986ad` levou junto 2 arquivos de referência da skill de treino que já
tinham sido apagados da ilha).

## Critérios de aceite

1. `env -i HOME=/home/pi PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin /bin/bash -c 'command -v hermes || echo NAO-ENCONTRADO'`
   imprime `NAO-ENCONTRADO`: é o PATH do cron, e o binário não está nele.
2. `env -i HOME=/home/pi PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin /bin/bash /home/pi/.hermes/scripts/island_healthcheck.sh --test`
   termina com código **0** e a mensagem de teste chega no Telegram: prova entrega sem PATH e sem gateway.
3. `ALERTA_LOG=/tmp/rv_alerts.log HERMES_BIN=/bin/false ALERTA_TENTATIVAS=2 ALERTA_ESPERA=1 /bin/bash /home/pi/.hermes/scripts/island_healthcheck.sh --test; echo rc=$?`
   termina com `rc=1` e `/tmp/rv_alerts.log` tem duas linhas `FALHA tentativa …` e uma `DESCARTADO`,
   tudo em segundos.
4. `touch -d '3 days ago' /tmp/rv_carimbo; ALERTA_LOG=/tmp/rv_alerts.log SNAP_STATE=/tmp/rv_carimbo SNAPSHOT_MAX_H=26 /bin/bash /home/pi/.hermes/scripts/island_healthcheck.sh --no-alert; grep 'atrasado' /home/pi/.hermes/logs/island_health.log | tail -1`
   imprime a linha `ALERT: ⚠️ Snapshot do GitHub atrasado (72h, …)` sem mandar nada para o Telegram: prova
   o gatilho do RF-5 e a supressão do `--no-alert`.
5. `/bin/bash /home/pi/.hermes/scripts/island_healthcheck.sh --no-alert; echo rc=$?` termina com `rc=0`
   (alerta suprimido não propaga erro).
6. `! grep -q 'hermes send' ~/.hermes/scripts/island_healthcheck.sh` e o mesmo para `island_backup.sh`:
   nenhum dos dois chama o binário direto (só `alerta.sh` chama).
7. Depois do próximo tick (≤15 min): `tail -5 ~/.hermes/logs/island_health_cron.log` tem linha nova, com
   `snapshot=…h(…)` no registro de estado e sem "command not found".
8. `diff <(sudo cat /etc/cron.d/island-ops) ~/.hermes/scripts/island-ops.crontab` sem diferenças e
   `wc -l` da fonte = **12**.
9. Depois do snapshot seguinte: `git -C ~/hermes-snapshot ls-files | grep -c island-ops.crontab` → `1`, e
   `ls -l ~/.hermes/snapshot_last_ok` existe com a data de hoje.

## Riscos e rollback

- **Precisa de `sudo`** para gravar em `/etc/cron.d` (o usuário `pi` tem NOPASSWD).
- **Os testes 2 e 4 mandam mensagens reais** no Telegram (o 4 não manda, o 3 usa `/bin/false` e não manda).
  O teste 2 é a única prova de ponta a ponta que existe.
- **O `hermes send` lê as credenciais de `~/.hermes/.env`** pelo diretório do usuário e fala direto com a
  API do bot, sem gateway e sem LLM (confirmado no `--help` e no `send_cmd.py`). Não depende do agente
  estar no ar, que é justamente o ponto do sensor.
- **Bloqueio de até 10 segundos** por alerta quando a rede está fora (3 tentativas com 5s). Em cron é
  irrelevante; rodando à mão, é o tempo de espera antes da mensagem de falha.
- **A rota do Telegram falha em janelas** (13 a 139 falhas de rede por dia no `errors.log`). Com a decisão
  da pergunta 1, um alerta que não sai nessas janelas é perdido: o log diz que foi tentado e descartado, e
  o ciclo seguinte **não** o repete.
- **O alarme de snapshot é intrinsecamente atrasado:** o job roda a cada 24h, então um snapshot que falha
  às 06:00 de hoje só vira alerta depois de passar de 26h, ou seja amanhã por volta das 08:00. Limiar menor
  daria alarme falso todo dia.
- **O HD segue em 91%**, e o sensor continua sem olhar espaço, containers e temperatura: fora do escopo,
  registrado para não parecer resolvido.
- **Rollback:** `sudo install -m644 ~/.hermes/scripts/island-ops.crontab.bak.20260912 /etc/cron.d/island-ops`
  e `cp` dos quatro `.bak.20260912` sobre os originais; `alerta.sh` pode ficar (não é chamado por ninguém
  se os scripts voltarem ao estado anterior). Nenhum dado é tocado em nenhum passo.

## Testes manuais

1. `--test` feliz: mensagem chega no Telegram (critério 2).
2. `--test` com binário falso: `rc=1`, `FALHA` e `DESCARTADO` no log (critério 3).
3. `--no-alert` com carimbo forçado: gatilho registrado e nada enviado (critério 4).
4. `island_backup.sh --dry-run --no-alert`: rsync em modo seco, sem alerta, sem erro.
5. Tick do cron depois de instalar (critério 7).
6. `bash -n` nos quatro scripts alterados.
7. Próximo snapshot: carimbo atualizado e `island-ops.crontab` no repo (critério 9).

## Comportamento Visual/UX

Não há tela: o "usuário" desta mudança é o Telegram dele e os arquivos de log.

- **Antes:** o Telegram fica mudo para sempre; o log do sensor registra `ALERT: …` e nada acontece.
- **Depois:** chega `🩺 [SENSOR ILHA] …` quando o HD cai, quando o backup do continente passa de 12h, quando
  a ilha tem problema de disco e quando o snapshot do GitHub atrasa. Se a entrega falhar nas 3 tentativas,
  fica no máximo uma linha `DESCARTADO` no log, sem repetição depois.
- **Log de entrega** (`~/.hermes/logs/island_alerts.log`):

```
[2026-09-12 15:20:01] OK: alerta entregue (tentativa 1)
[2026-09-12 15:35:02] FALHA tentativa 1/3: rc=1: Temporary failure in name resolution
[2026-09-12 15:35:12] OK: alerta entregue (tentativa 2)
[2026-09-13 03:10:01] FALHA tentativa 3/3: rc=1: sem saida
[2026-09-13 03:10:01] DESCARTADO: alerta nao entregue (decisao do usuario: sem reenvio)
```

- **Registro de estado** (`~/.hermes/logs/island_health.log`, uma linha a cada 15 min):

```
[2026-09-12 15:30:01] continent=OK island=OK last_backup=2026-09-12T16:00:01Z snapshot=9h(execucao)
[2026-09-14 08:00:01] continent=OK island=OK last_backup=2026-09-14T09:00:01Z snapshot=27h(execucao)
```
