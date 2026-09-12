# Spec: falhas que saem como sucesso — sync do treino e saúde do app — v3 (final)

## Contexto e Objetivo

Duas falhas do sistema terminam com código de sucesso, e por isso ninguém nunca é avisado:

1. **A sincronização do treino das 23h.** `sync_treino.sh` roda `python3 process_workout.py || echo "process_workout FALHOU"` e o último comando do script é um `echo`, então ele **sai 0 mesmo quando o processamento falha**. O job `sync-treino-diario-23h` (`fe7ae09e86b4`, `no_agent: true`, `script: sync_treino.sh`, `deliver: local`) entrega em `local` (nada vai para o Telegram) e todo o rastro vai para `workout/data/sync_treino.log`, que nenhum outro processo lê. O nome curto resolve para `~/.hermes/scripts/sync_treino.sh` — é o próprio `hermes cron --help` que define `--script` como "Path to a script under ~/.hermes/scripts/".
2. **Os containers do app não têm verificação de saúde.** `opengym-api-1` e `opengym-web-1` sobem com `health=NONE` (conferido no `docker inspect`), então API travada com processo vivo aparece como "Up" no `docker ps`. Nada avisa, e o `sync_treino.sh` testa só se o HD está montado, não se a API responde.

Objetivo: fazer as duas falhas **aparecerem** — código de saída honesto e alerta pelo canal que já funciona (a biblioteca `alerta.sh` destravada em 12/09/2026), mais saúde real nos containers e vigilância de transição pelo sensor independente.

Detalhe que liga as duas pontas: o `process_workout.py` busca os dados na própria API do app (`Fonte: api:http://localhost:8081/api/coach/analysis`, visto no log em 12/09/2026), com o `state-*.json` do HD como alternativa. Ou seja, **o sync do treino depende do app estar respondendo** — por isso as duas correções andam juntas.

Onde vive: máquina `hermes` (Pi, Ubuntu ARM64, usuário `pi` com sudo). Arquivos em `/home/pi/.hermes/scripts/`, `/home/pi/.hermes/workout/scripts/`, `/mnt/drivebackup/apps/openGym/openGym/docker-compose.yml` (projeto compose `opengym`) e o agendamento em `/home/pi/.hermes/cron/jobs.json`. Fecha os itens **6a** e **6b** da varredura de 12/09/2026 (o 6c, o espelho do Google Drive, foi aposentado no mesmo dia).

## Escopo

- **Inclui:**
  - `sync_treino.sh` (cópia canônica) propaga o código de saída e alerta no Telegram quando falha — inclusive falha de ambiente (diretório ausente).
  - A cópia divergente em `workout/scripts/` vira **ponteiro** para a canônica (fim da duplicata, lacuna 1b).
  - O prompt do job de domingo deixa de apontar para a cópia velha.
  - `docker-compose.yml` ganha `healthcheck` para `api` e `web` (usando `wget`, que existe nas duas imagens).
  - `island_healthcheck.sh` passa a vigiar os containers **e** a resposta HTTP de ponta a ponta, alertando em transição.
  - Flag `--containers` no healthcheck para inspecionar sem alertar nem escrever estado (usada nos testes).
- **Não inclui:**
  - Trocar a imagem do app, mudar portas, mexer no nginx ou no `Dockerfile`.
  - Fazer o `web` depender de `api` saudável no boot.
  - Alarme de espaço em disco (item 4 da varredura), temperatura, `vcgencmd` ou journald.
  - Os incidentes de falha de job que morrem no banco (item 3): esta spec usa `alerta.sh` direto.
  - O segredo real no `config/config.yaml` (item 2).

## Decisões

### Do usuário (12/09/2026)

- **Sync falhando: avisa no Telegram.** Se a sincronização das 23h falhar, chega mensagem com o motivo; no caminho normal, silêncio total.
- **Janela: agora**, ao terminar a implementação — aceita o reinício de segundos e o teste com um container fora por ~2 minutos.
- **Velocidade: até 15 minutos**, usando o sensor que já roda de 15 em 15 minutos, sem checagem nova e mais rápida.

### Assumidas por mim

- **O estado do app é guardado como predicado (`ok`/`ruim`), não como código HTTP cru.** Comparar o código cru causaria flood: entre leituras ele oscila (`502` → `504` → `000`) e cada valor diferente re-dispararia o alerta.
- **Alerta de "quebrou" também na primeira observação ruim** (estado anterior vazio). Se o app já está quebrado quando o sensor olha pela primeira vez, isso é dito; e assim o aviso de "voltou ao normal" nunca aparece sem um aviso de problema antes.
- **`starting` conta como ok.** Um container em `starting` está dentro do `start_period` (20s no web, 30s na api); se nunca ficar saudável, o próprio Docker o marca `unhealthy` e aí o alerta sai. Tratar `starting` como ruim dispararia aviso em todo reinício legítimo.
- **Manter `depends_on: service_started` para o `web`.** Trocar para `service_healthy` faria o app inteiro não subir quando a API demora; como está, o site sobe e o `/api` responde 502.
- **Aplicar o compose com `--no-deps`.** O serviço `media` é one-time e tem `condition: service_completed_successfully` no `depends_on` do `web`; sem `--no-deps`, o compose reavaliaria (e poderia recriar) o `media`, que baixa ~140 MB quando o volume está vazio.
- **Teste de saúde por `wget` do busybox** (é o que existe: `/usr/bin/wget` é link para `/bin/busybox` nas duas imagens), usando só `-q -O /dev/null`, que é o que o busybox suporta.
- **A ponteiro em `workout/scripts/sync_treino.sh` usa `exec ... "$@"`**, então o código de saída e os argumentos atravessam igual.
- **A ausência do HD continua sendo sucesso** (`exit 0` no `SKIP`): não é falha do sync, e o sensor da ilha já alerta quando o continente cai.
- **O aviso é emitido por uma função única (`avisa`)**, usada tanto na falha do processamento quanto na falha de ambiente, e o diagnóstico de "não consegui avisar" sai pelo fd 3 (o stderr original do cron), porque o script faz `exec >>"$LOG" 2>&1`.
- Decidido por mim porque é detalhe de implementação e não muda o que o usuário vê.

## Requisitos Funcionais

- **RF-1.** `sync_treino.sh` (canônico) sai com **o código de saída do `process_workout.py`**: 0 quando processa, não-zero quando falha. O caso "continente ausente" continua saindo 0.
- **RF-2.** Quando o código for não-zero, o script registra `process_workout FALHOU (rc=N)` no log **e** compõe e envia um alerta no Telegram pelo `alerta.sh`. Quando for 0, nenhuma mensagem é enviada. Falha de ambiente que impeça o processamento (diretório ausente) também avisa.
- **RF-3.** `workout/scripts/sync_treino.sh` (hoje com **19 linhas**) deixa de ter implementação: passa a executar a canônica via `exec ... "$@"`, preservando argumentos e código de saída.
- **RF-4.** O prompt do job `treino-planejamento-semanal` (`067210e41560`) passa a citar `/home/pi/.hermes/scripts/sync_treino.sh`, sem alterar mais nada do prompt.
- **RF-5.** O `docker-compose.yml` define `healthcheck` para `api` e `web`: `wget -q -O /dev/null http://127.0.0.1:3000/api/health` e `wget -q -O /dev/null http://127.0.0.1:8081/`, com `interval: 60s`, `timeout: 5s`, `retries: 3` e `start_period` (30s na api, 20s no web).
- **RF-6.** `island_healthcheck.sh` monta um predicado do app (containers `running/healthy` **e** HTTP 200 em `http://127.0.0.1:8081/api/health`), grava `ok`/`ruim` e o detalhe nas linhas 3 e 4 do arquivo de estado, e alerta quando o predicado **muda para ruim** (inclusive na primeira observação) e quando **volta a ok** vindo de ruim. Enquanto não muda, nada é enviado.
- **RF-7.** Se o `docker` não existir ou não responder, o healthcheck registra `containers=sem-docker` no log, **não** alerta e **preserva o último estado conhecido** nas linhas 3 e 4.
- **RF-8.** `island_healthcheck.sh --containers` imprime o detalhe do app e o código HTTP e sai sem alertar e sem escrever o arquivo de estado. Sem `docker`, imprime `containers: sem-docker`.
- **RF-9.** Nenhuma mudança altera o comportamento dos jobs existentes fora do previsto: o job diário continua às 23:00, o de domingo às 18:00, o healthcheck a cada 15 minutos, e nenhum serviço do compose é recriado além de `api` e `web`.

## Detalhe de Implementação (nível código)

Ordem de execução: 0 → 1 → 2 → 3 → **4 (compose) antes de 5 (sensor)** → 6, depois os testes.
A ordem do compose antes do sensor não é estética: enquanto os containers não tiverem `healthcheck`, o
sensor lê `sem-health` e alertaria "app com problema" logo na primeira leitura.
As inserções no mesmo arquivo são feitas **de baixo para cima**, para os números de linha não invalidarem uns aos outros.

### 0. Cópias de segurança (antes de qualquer edição — sem elas o rollback é impossível)

```bash
cp -p /home/pi/.hermes/scripts/sync_treino.sh            /home/pi/.hermes/scripts/sync_treino.canonico.bak.20260912
cp -p /home/pi/.hermes/workout/scripts/sync_treino.sh    /home/pi/.hermes/workout/scripts/sync_treino.workout.bak.20260912
cp -p /home/pi/.hermes/scripts/island_healthcheck.sh     /home/pi/.hermes/scripts/island_healthcheck.bak.20260912c
cp -p /mnt/drivebackup/apps/openGym/openGym/docker-compose.yml /mnt/drivebackup/apps/openGym/openGym/docker-compose.yml.bak.20260912
/home/pi/.local/bin/hermes cron list > /tmp/jobs_antes_20260912.txt     # registro do agendamento
python3 - <<'PY'
import json
j=json.load(open('/home/pi/.hermes/cron/jobs.json', encoding='utf-8'))
for x in j['jobs']:
    if x['id']=='067210e41560':
        open('/tmp/prompt_semanal_antigo.txt','w',encoding='utf-8').write(x['prompt'])
        print('prompt do job semanal salvo:', len(x['prompt']), 'chars')
PY
```

### 1. `~/.hermes/scripts/sync_treino.sh` (canônico, 24 linhas)

Contexto que **não muda** e que o resto do arquivo usa: a linha 13 define `LOG=/home/pi/.hermes/workout/data/sync_treino.log`, e a linha 15 faz `exec >>"$LOG" 2>&1`.

**1.1 Guardar o stderr original e definir o aviso único (inserir logo depois do `exec`):**

```bash
# ANTES
exec >>"$LOG" 2>&1
echo "=== sync_treino $(date -Iseconds) [HD-only] ==="

# DEPOIS
exec 3>&2            # guarda o stderr do cron: o resto do script vai para o log
exec >>"$LOG" 2>&1

# Aviso unico: falha de processamento e falha de ambiente saem pelo mesmo caminho.
avisa(){
  local lib="$HOME/.hermes/scripts/alerta.sh"
  if [ -r "$lib" ]; then
    . "$lib"
    enviar_alerta "$1" || true
  else
    echo "ENVIO IMPOSSIVEL: falta $lib (o alerta nao saiu)" >&3 || true
    echo "ENVIO IMPOSSIVEL: falta $lib (o alerta nao saiu)"
  fi
}

echo "=== sync_treino $(date -Iseconds) [HD-only] ==="
```

**1.2 Cabeçalho (linhas 6-7):**

```bash
# ANTES
# Deve rodar apos vc treinar (ex: todo dia 23h). Se o HD (continente) estiver
# ausente, pula sem erro.
# DEPOIS
# Deve rodar apos vc treinar (ex: todo dia 23h). Se o HD (continente) estiver
# ausente, pula sem erro.
# Sai com o codigo do process_workout.py: falha de processamento NAO sai mais como
# sucesso (ate 12/09/2026 saia 0 por causa de um `|| echo` no fim). Em falha,
# avisa no Telegram via ~/.hermes/scripts/alerta.sh.
```

**1.3 Entrada no diretório de trabalho (linha 21) — falha de ambiente também avisa:**

```bash
# ANTES
cd /home/pi/.hermes/workout/scripts
# DEPOIS
cd /home/pi/.hermes/workout/scripts || {
  echo "ERRO: /home/pi/.hermes/workout/scripts ausente — sync nao rodou"
  avisa "🔁 [SYNC TREINO] nao consegui entrar em workout/scripts em $(date '+%F %T') — sync nao rodou. Log: $LOG"
  exit 1
}
```

**1.4 Fim do script (linhas 23-24):**

```bash
# ANTES
OPENGYM_UID=ZPJbmYUfHlfbAYzi OPENGYM_DATA=/mnt/drivebackup/apps/openGym/data python3 process_workout.py || echo "process_workout FALHOU"
echo "=== fim $(date -Iseconds) [HD-only] ==="

# DEPOIS
rc=0
OPENGYM_UID=ZPJbmYUfHlfbAYzi OPENGYM_DATA=/mnt/drivebackup/apps/openGym/data python3 process_workout.py || rc=$?
if [ "$rc" -ne 0 ]; then
  echo "process_workout FALHOU (rc=$rc)"
  avisa "🔁 [SYNC TREINO] process_workout.py falhou (rc=$rc) em $(date '+%F %T'). Log: $LOG"
fi
echo "=== fim $(date -Iseconds) [HD-only] rc=$rc ==="
exit "$rc"
```

### 2. `~/.hermes/workout/scripts/sync_treino.sh` (a cópia divergente, 19 linhas)

```bash
# ARQUIVO INTEIRO DEPOIS (substitui as 19 linhas atuais)
#!/usr/bin/env bash
# sync_treino.sh — PONTEIRO. A implementacao de verdade vive em
# ~/.hermes/scripts/sync_treino.sh.
#
# Havia duas copias com conteudos diferentes: a daqui nao forcava o fuso (TZ) nem
# criava o diretorio do log (5 linhas a menos que a canonica), e era justamente a
# que o job de domingo (treino-planejamento-semanal) chamava. Em 12/09/2026 virou
# ponteiro para haver uma fonte so. Nao recoloque implementacao aqui.
exec /home/pi/.hermes/scripts/sync_treino.sh "$@"
```

### 3. Job `treino-planejamento-semanal` (`067210e41560`)

```bash
# 1. gerar o prompt novo a partir do antigo, trocando SÓ o caminho do script
sed 's#/home/pi/.hermes/workout/scripts/sync_treino.sh#/home/pi/.hermes/scripts/sync_treino.sh#g' \
  /tmp/prompt_semanal_antigo.txt > /tmp/prompt_semanal_novo.txt
diff /tmp/prompt_semanal_antigo.txt /tmp/prompt_semanal_novo.txt   # so a linha do caminho
# 2. aplicar pelo caminho suportado
/home/pi/.local/bin/hermes cron edit 067210e41560 --prompt "$(cat /tmp/prompt_semanal_novo.txt)"
```

### 4. `/mnt/drivebackup/apps/openGym/openGym/docker-compose.yml`

**4.1 Serviço `api`** — inserir logo depois do `restart: unless-stopped` **do bloco `api`** (linha 31; o bloco `web` tem outro igual na linha 47) e antes de `env_file:`:

```yaml
# DEPOIS (bloco inserido)
    healthcheck:
      # /api/health e rota real da API (api/server.js:384) e responde 200 com {"ok":true}
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3000/api/health"]
      interval: 60s
      timeout: 5s
      retries: 3
      start_period: 30s
```

**4.2 Serviço `web`** — inserir depois do bloco `depends_on` (linhas 48-52) e antes de `ports:` (linha 53):

```yaml
# DEPOIS (bloco inserido)
    healthcheck:
      # o nginx do web escuta em 8081 (e 9000 ssl), NAO na 80 — sondar a 80 daria
      # "connection refused" e o container ficaria unhealthy para sempre
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/"]
      interval: 60s
      timeout: 5s
      retries: 3
      start_period: 20s
```

(`wget` nas duas imagens é o do busybox: `/usr/bin/wget -> /bin/busybox`. Só as flags usadas funcionam; nada de `--spider` ou `--tries`.)

Aplicar sem tocar nos outros serviços (recria só `api` e `web`; o app fica fora por alguns segundos):

```bash
cd /mnt/drivebackup/apps/openGym/openGym
docker compose config --quiet                       # valida a sintaxe antes de aplicar
docker compose up -d --no-deps api web              # --no-deps: nao reavalia o servico 'media'
docker inspect -f '{{.Name}} {{.State.Health.Status}}' opengym-api-1 opengym-web-1
```

### 5. `~/.hermes/scripts/island_healthcheck.sh`

Contexto que **não muda**: as constantes das linhas 12 a 17 (`HERMES_HOME`, `CONTINENT_MOUNT`, `DST_BASE`, `LOG_DIR`, `LOG_FILE`, `STATE_FILE`) continuam como estão.

**5.1 Uso e argumentos (linha 6 e o laço de argumentos):**

```bash
# ANTES
# Uso: island_healthcheck.sh [--no-alert] [--test]
# DEPOIS
# Uso: island_healthcheck.sh [--no-alert] [--test] [--containers]
```

```bash
# ANTES (dentro do for a in "$@")
    --no-alert) NO_ALERT=1 ;;
    --test)     TESTE=1 ;;
# DEPOIS
    --no-alert)   NO_ALERT=1 ;;
    --test)       TESTE=1 ;;
    --containers) SO_CONTAINERS=1 ;;
```
e inicializar `SO_CONTAINERS=""` junto de `TESTE=""`.

**5.2 Novas funções, junto de `continent_status` e `island_status`:**

```bash
# ---------- App (containers + resposta HTTP) ----------
APP_CONTAINERS="opengym-api-1 opengym-web-1"
APP_HEALTH_URL="http://127.0.0.1:8081/api/health"

containers_detalhe(){
  command -v docker >/dev/null 2>&1 || { echo "sem-docker"; return; }
  local out="" c st h
  for c in $APP_CONTAINERS; do
    st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null) || { out="$out $c=ausente"; continue; }
    h=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-health{{end}}' "$c" 2>/dev/null)
    out="$out $c=$st/${h:-?}"
  done
  echo "${out# }"
}

# O curl SEMPRE imprime o codigo (000 quando nao conecta) e sai != 0 nesse caso:
# por isso nada de `|| echo 000`, que concatenaria e viraria 000000.
app_http(){ local c; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$APP_HEALTH_URL" 2>/dev/null) || true; printf '%s' "${c:-000}"; }

# Predicado unico do app: usado no estado, para a comparacao nao oscilar com o codigo HTTP.
# 0 = ruim, 1 = ok, 2 = desconhecido (docker fora: nunca alerta, ver RF-7).
# "starting" NAO conta como ruim: e transitorio do start_period e o Docker escala para
# unhealthy sozinho se nunca ficar saudavel.
app_ruim(){
  case "$1" in
    "sem-docker") return 2 ;;
    *"=ausente"*|*"/unhealthy"*|*"/sem-health"*|*"=exited"*|*"=restarting"*) return 0 ;;
  esac
  [ "$2" = "200" ] || return 0
  return 1
}
```

**5.3 Leitura do estado anterior:**

```bash
# ANTES
prev_continent=""; prev_island=""
if [ -f "$STATE_FILE" ]; then
  prev_continent=$(sed -n '1p' "$STATE_FILE" 2>/dev/null)
  prev_island=$(sed -n '2p' "$STATE_FILE" 2>/dev/null)
fi
# DEPOIS
prev_continent=""; prev_island=""; prev_app=""; prev_detalhe=""
if [ -f "$STATE_FILE" ]; then
  prev_continent=$(sed -n '1p' "$STATE_FILE" 2>/dev/null)
  prev_island=$(sed -n '2p' "$STATE_FILE" 2>/dev/null)
  prev_app=$(sed -n '3p' "$STATE_FILE" 2>/dev/null)       # ok | ruim  (arquivo antigo: vazio)
  prev_detalhe=$(sed -n '4p' "$STATE_FILE" 2>/dev/null)
fi
```
(`prev_app` é lido **antes** da coleta, então serve de estado anterior de verdade.)

**5.4 Coleta e modo `--containers`, depois de `cur_island=$(island_status)`:**

```bash
cur_detalhe=$(containers_detalhe)
cur_http=$(app_http)
app_ruim "$cur_detalhe" "$cur_http"; rc_app=$?     # 0 ruim | 1 ok | 2 desconhecido
case "$rc_app" in
  0) cur_app="ruim" ;;
  2) cur_app="desconhecido" ;;   # docker fora: nao alerta e nao sobrescreve o estado
  *) cur_app="ok" ;;
esac

# Sem docker, o ultimo estado conhecido e preservado (o sensor nao "esquece" que o app estava bom
# nem o reanuncia como problema quando o docker voltar).
if [ "$cur_app" = "desconhecido" ]; then
  grava_app="$prev_app"; grava_detalhe="$prev_detalhe"
else
  grava_app="$cur_app"; grava_detalhe="$cur_detalhe"
fi

if [ -n "$SO_CONTAINERS" ]; then
  printf 'containers: %s\nhttp: %s (%s)\napp: %s\n' "$cur_detalhe" "$cur_http" "$APP_HEALTH_URL" "$cur_app"
  exit 0
fi
```

**5.5 Alerta de transição, depois do bloco da ilha:**

```bash
# ---------- Transicao: app (containers + resposta HTTP) ----------
# "quebrou" inclui a primeira observacao ruim (prev_app vazio); assim o aviso de
# "voltou ao normal" nunca aparece sem um aviso de problema antes.
if [ "$cur_app" = "ruim" ] && [ "$prev_app" != "ruim" ]; then
  alert "🚨 APP openGym com problema: $cur_detalhe | $APP_HEALTH_URL devolveu $cur_http. Verifique: docker ps e docker compose logs."
elif [ "$cur_app" = "ok" ] && [ "$prev_app" = "ruim" ]; then
  alert "✅ APP openGym voltou ao normal ($cur_detalhe | HTTP $cur_http)."
fi
```

**5.6 Registro de estado (a linha que hoje grava 2 linhas):**

```bash
# ANTES
printf '%s\n%s\n' "$cur_continent" "$cur_island" > "$STATE_FILE"
# DEPOIS
printf '%s\n%s\n%s\n%s\n' "$cur_continent" "$cur_island" "$grava_app" "$grava_detalhe" > "$STATE_FILE"
```
(arquivo antigo tem 2 linhas: a 3ª e a 4ª vêm vazias na primeira execução. Com `prev_app` vazio e app
saudável, nada é alertado; com app ruim, sai o alerta de problema.)

**5.7 Linha de log do estado (a que já registra `snapshot=`):**

```bash
# DEPOIS (acrescentar no fim da mesma linha)
log "continent=$cur_continent island=$cur_island last_backup=$last_bk snapshot=${snap_txt:-ausente} app=$cur_app ($cur_detalhe) http=$cur_http"
```

## Critérios de aceite

1. `bash ~/.hermes/scripts/sync_treino.sh` no caminho normal termina com código **0**, grava `=== fim ... rc=0 ===` e **não** manda nada no Telegram.
2. Falha forçada do sync, provando que a mensagem foi **composta** e que nada saiu de verdade:
   ```bash
   mkdir -p /tmp/fakebin
   printf '#!/usr/bin/env bash\necho "python3 falso: falhando de proposito" >&2\nexit 3\n' > /tmp/fakebin/python3
   chmod +x /tmp/fakebin/python3
   printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" >> /tmp/rv_sync_args.txt\nexit 1\n' > /tmp/hermes_falso.sh
   chmod +x /tmp/hermes_falso.sh
   PATH=/tmp/fakebin:$PATH ALERTA_LOG=/tmp/rv_sync.log ALERTA_TENTATIVAS=1 \
     HERMES_BIN=/tmp/hermes_falso.sh bash ~/.hermes/scripts/sync_treino.sh; echo rc=$?
   cat /tmp/rv_sync_args.txt      # prova o TEXTO do alerta composto
   tail -3 /tmp/rv_sync.log       # FALHA tentativa 1/1 + DESCARTADO
   ```
   **A falha é forçada com um `python3` falso no PATH, não com `OPENGYM_DATA`:** o script fixa
   `OPENGYM_DATA=/mnt/drivebackup/apps/openGym/data` na própria linha de comando, e uma variável de
   ambiente externa é sobrescrita por ela (descoberto na implementação de 12/09/2026, quando o primeiro
   teste voltou `rc=0` e não provou nada).
   Esperado: `rc` **não-zero** (3, o código do falso); `process_workout FALHOU (rc=3)` em
   `workout/data/sync_treino.log`; o arquivo de args mostrando `send --to telegram 🔁 [SYNC TREINO]
   process_workout.py falhou (rc=3) …`; e nenhuma mensagem real no Telegram. (`/bin/false` **não** cai no
   fallback: `alerta.sh` testa `-x` e `/bin/false` é executável — refutado ao vivo na 2ª revisão, que
   reproduziu `FALHA tentativa 1/3: rc=1: sem saida`.)
3. Ponteiro: `grep -c 'exec /home/pi/.hermes/scripts/sync_treino.sh "\$@"' ~/.hermes/workout/scripts/sync_treino.sh` → `1`, e `bash ~/.hermes/workout/scripts/sync_treino.sh` com o app e o HD no estado atual produz o mesmo resultado e o mesmo código de saída da canônica.
4. `docker inspect -f '{{.State.Health.Status}}' opengym-api-1 opengym-web-1` devolve `healthy` nos dois depois de ~1 minuto, e `docker ps` mostra a coluna de saúde preenchida.
5. `bash ~/.hermes/scripts/island_healthcheck.sh --containers` imprime `containers: opengym-api-1=running/healthy opengym-web-1=running/healthy`, `http: 200 (...)` e `app: ok`, sem escrever estado e sem alertar.
6. Primeira execução depois da mudança, com o arquivo de estado ainda no formato antigo (2 linhas) e o app saudável: **nenhum** alerta, e o arquivo passa a ter 4 linhas — `sed -n '3,4p' ~/.hermes/drive_backup/.health-state` mostra `ok` e o detalhe.
7. Container fora por ~2 minutos: `docker stop opengym-web-1`, esperar o tick seguinte (≤15 min) → **um** alerta de app com problema (o `http=000` já basta, não precisa esperar o Docker marcar `unhealthy`); `docker start opengym-web-1`, esperar ~2 minutos (o `web` leva `start_period` 20s + `interval` 60s para voltar a `healthy`) e o tick seguinte → **um** alerta de volta ao normal. Nenhum aviso extra nos ticks do meio, mesmo com o código HTTP oscilando.
8. `tail -1 ~/.hermes/logs/island_health.log` e `tail -1 ~/.hermes/logs/island_health_cron.log` trazem a linha de estado com `app=... http=...` (o `log()` usa `tee`, então a mesma linha aparece nos dois; o `.log` é o arquivo do sensor e o `_cron.log` é a saída do cron).
9. `/home/pi/.local/bin/hermes cron doctor` sem problemas; o job `treino-planejamento-semanal` com o prompt citando `/home/pi/.hermes/scripts/sync_treino.sh`; `git -C /mnt/drivebackup/apps/openGym/openGym diff --stat docker-compose.yml` mostrando só os dois blocos de `healthcheck`.

## Riscos e rollback

- **Recriar os containers derruba o app por alguns segundos** (`docker compose up -d --no-deps api web`). O critério 7 mantém um container fora por ~2 minutos de propósito: nessa janela o app não responde por completo.
- **`wget` do busybox nas duas imagens**: existe e aceita `-q -O /dev/null` (medido: rc=0 no 200, rc=1 em porta fechada). Se a imagem da api for trocada por uma sem `wget`, o healthcheck fica `unhealthy` e o alerta avisa; o conserto é voltar para `node -e`.
- **Base das imagens:** `ghcr.io/duartesantos8/opengym-api:latest` roda Node v22 e `opengym-web:local` roda nginx 1.31.5 (medido por dentro). O healthcheck depende só do `wget`, não da base.
- **A porta 8081 do `web` é a que o nginx escuta em HTTP** (a 80 não existe dentro do container; a 9000 é SSL). Se as portas internas mudarem, o healthcheck e o sensor passam a dar `000`/connection refused e o alerta é falso — por isso os dois usam constantes no topo.
- **`docker inspect` sem permissão** é lido como `ausente` (o `||` captura o erro), o que gera alerta de app com problema. É conservador: se o sensor não consegue inspecionar, avisar é melhor do que silenciar.
- **A rota `/api/health` responde sem autenticação** e devolve `{ok, users}`; ela conta usuários, não expõe treino. Aceito.
- **A oscilação natural do código HTTP não gera flood** por construção: o estado guarda `ok`/`ruim`.
- **Alerta perdido em janela de rede:** o `alerta.sh` faz 3 tentativas e descarta, registrando no log (decisão do usuário em 12/09/2026).
- **Rollback** (depende do passo §0 ter rodado): `cp` dos quatro `.bak.20260912*` de volta (caminhos absolutos no §0), `docker compose up -d --no-deps api web` para voltar o compose, e `/home/pi/.local/bin/hermes cron edit 067210e41560 --prompt "$(cat /tmp/prompt_semanal_antigo.txt)"` para o prompt.

## Testes manuais

1. `bash -n` nos três scripts alterados.
2. Caminho normal do sync (critério 1).
3. Falha forçada do sync com o binário falso, provando o texto do alerta (critério 2).
4. Ponteiro do workout (critério 3).
5. `docker compose config --quiet` antes de aplicar e `docker inspect` depois (critério 4).
6. `--containers` (critério 5).
7. Primeira execução com estado antigo (critério 6).
8. Derrubar e subir um container para ver os dois alertas e a ausência de repetição (critério 7).
9. `hermes cron doctor` e a conferência do prompt de domingo (critério 9).

## Comportamento Visual/UX

Não há tela nova: o que muda é o que aparece no Telegram e no `docker ps`.

- **Antes:** o sync das 23:00 podia falhar todo dia sem ninguém saber; `docker ps` mostrava `Up 3 hours` mesmo com a API travada.
- **Depois:** `docker ps` mostra `Up 3 hours (healthy)`; e chegam no Telegram, no máximo uma vez por transição:

```
🔁 [SYNC TREINO] process_workout.py falhou (rc=1) em 2026-09-12 23:00:12. Log: /home/pi/.hermes/workout/data/sync_treino.log
🚨 APP openGym com problema: opengym-api-1=running/unhealthy opengym-web-1=running/healthy | http://127.0.0.1:8081/api/health devolveu 502. Verifique: docker ps e docker compose logs.
✅ APP openGym voltou ao normal (opengym-api-1=running/healthy opengym-web-1=running/healthy | HTTP 200).
```

- **Linha de estado do sensor** (a cada 15 min em `~/.hermes/logs/island_health.log`):

```
[2026-09-12 23:15:01] continent=OK island=OK last_backup=2026-09-12T23:00:01Z snapshot=17h(execucao) app=ok (opengym-api-1=running/healthy opengym-web-1=running/healthy) http=200
```

- **Registro de entrega** (em `~/.hermes/logs/island_alerts.log`), igual ao do sensor:

```
[2026-09-12 23:15:03] OK: alerta entregue (tentativa 1)
```
