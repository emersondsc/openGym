# Spec: ensaio de restauração num ambiente limpo (BACKLOG-14) — v1

> **Status:** proposta para revisão. **Nada aqui foi executado**: esta spec *especifica* o ensaio.
> **Levantamento:** 12/09/2026, somente leitura, no próprio hermes.
> **Regra que governa tudo abaixo:** o ensaio **não toca a produção**. O agente `hermes` está
> rodando (gateway ativo, cron do sistema a cada 15 min, jobs diários). Todo caminho desta spec
> mora em `/home/pi/hermes-novo/` (ensaio) e `/tmp/` (efêmero).

---

## Contexto e Objetivo

O `RESTORE.md` foi corrigido em 12/09/2026 (commit `f2bd5e2`, e depois `e78cbb4` e `5210c7f`) e
hoje devolve `workout/`, `opengym-data/` e o `island-ops.crontab`, reinstala o watchdog em
`/etc/cron.d` e registra que **L0 e L1 não sobrevivem à morte do disco físico** — as duas camadas
são partições (`/dev/sda3` e `/dev/sda1`) do **mesmo** HD de 465 G. O único backup fora desse disco
é o **L1 (GitHub)**, ou seja, o **Cenário B.1** é o único que importa de verdade.

**Nada disso nunca foi seguido do começo ao fim.** O aceite da BACKLOG-08 deixou isto pendente:
provar que os passos do `RESTORE.md`, executados num ambiente vazio, produzem um Hermes com o
**pipeline de treino funcional** — em particular que o **portão P1** (`verificar_prescricao.py`) e o
**`MECANICA_PESOS.md`** voltam junto.

**Objetivo desta spec:** descrever, comando a comando, um ensaio **executável e não destrutivo**, que
(a) roda o Cenário B.1 num diretório vazio desta máquina, (b) mede o sucesso pelo P1 passando no
ambiente restaurado, (c) **registra no próprio `RESTORE.md` a lista do que faltou**, e (d) se limpa
sem deixar rastro.

**Achado que muda o tom do item:** durante o levantamento, rodar o P1 contra a cópia do L1 e contra
o estado vivo deu **FALHA** nos dois casos (4 itens `P4e`, +12,5 % sobre o último executado sem
justificativa). Isso é **pré-existente e não é regressão do ensaio** — mas significa que "P1
passando" precisa de um critério explícito, senão o ensaio nasce vermelho por um motivo alheio a
ele. Ver **Decisão D-4**.

---

## Escopo

### Inclui

- Executar o **Cenário B.1** (só GitHub) num diretório limpo `/home/pi/hermes-novo/`, com
  `HERMES_HOME=/home/pi/hermes-novo/.hermes`.
- Clonar o L1 e restaurar: `config/`, `skills/`, `memories/`, `scripts/`, `sessions/`,
  `plugins/`, `workout/`, `opengym-data/`.
- Apontar o pipeline de treino **para uma cópia** dos dados do openGym (nunca para
  `/mnt/drivebackup/apps/openGym/data` vivo).
- Rodar o **portão P1** no ambiente restaurado (`verificar_prescricao.py`) e conferir a presença e a
  integridade do `MECANICA_PESOS.md`.
- Produzir a **seção "Ensaio de restauração — o que faltou"** dentro do `RESTORE.md`, com data,
  commit do L1 usado, o que voltou, o que faltou e como refazer cada item.
- Limpeza completa e verificável ao final (`rm -rf` do diretório do ensaio).

### Não inclui

- **Não** escreve em `/mnt/drivebackup/apps/openGym/data` (o estado vivo do app). Leitura, cópia
  para `/tmp`, e nada mais.
- **Não** escreve em `/home/pi/.hermes` (produção). Nem `cp`, nem `rm`, nem `mv`.
- **Não** toca `/etc/cron.d`, `systemctl`, o gateway, o cron do agente, nem `~/.hermes/cron/jobs.json`.
- **Não** roda `snapshot.sh` nem `island_backup.sh` (proibidos para este trabalho).
- **Não** roda `git commit`/`git push` em nenhum repo. A seção nova do `RESTORE.md` é **escrita como
  texto pronto** nesta spec; commitá-la é decisão do usuário, fora do ensaio.
- **Não** reaponta a API de produção (`opengym.edsc.fun`) nem faz escrita HTTP nenhuma.
- **Não** prova um "Pi novo de verdade" — é a mesma máquina, mesmo SO, mesmo usuário. Ver
  **Limites honestos**.

---

## Decisões assumidas

**D-1 — Onde o ensaio roda: `/home/pi/hermes-novo/`, no disco raiz.**
`/` tem **201 GB livres**; o HD tem 20 GB. O ensaio inteiro (clone 75 MB de `sessions` + skills
8,5 MB + cópia de estado 276 KB + `hermes-agent` 2,2 GB se for copiado) cabe folgado no raiz.
Usar o HD seria competir com produção por 20 GB e ainda colocar o ensaio no mesmo disco que o L0
— exatamente o ponto cego que o item existe para expor.

**D-2 — Isolamento por `HERMES_HOME`, não por `HOME`.**
Confirmado no código (`hermes_constants.py:85-137`): `get_hermes_home()` resolve
**override de contexto → `HERMES_HOME` → default da plataforma**. Com
`HERMES_HOME=/home/pi/hermes-novo/.hermes` o binário resolve o home novo (verificado:
`get_hermes_home()` devolveu o caminho do probe). **Não** mexer em `HOME`: o `HOME` real é o que
dá ao `git`, ao `gh` e ao `snapshot.sh` os caminhos certos, e trocá-lo quebraria coisas fora do
escopo. `HERMES_HOME` é suficiente e é o que o próprio systemd de produção já usa
(`Environment="HERMES_HOME=/home/pi/.hermes"` na `hermes-gateway.service`).

**D-3 — O pipeline de treino é apontado por variáveis de ambiente, num sub-shell.**
`verificar_prescricao.py` lê `OPENGYM_UID`, `OPENGYM_DATA_DIR` e `OPENGYM_CATALOG`; `opengym_writer.py`
lê também `OPENGYM_REPORTS`, `OPENGYM_GATE` e `OPENGYM_MEDIA`. Todos têm default absoluto apontando
para produção, então **o ensaio exporta os seis** antes de rodar qualquer coisa. O catálogo
(`/mnt/drivebackup/apps/openGym/openGym/frontend/src/lib/exercises-data.json`) é **somente leitura**
e é a fonte única declarada — o ensaio lê o mesmo arquivo de produção, de propósito, porque
"o catálogo volta junto?" é justamente uma das perguntas do aceite.

**D-4 — Como se mede sucesso do P1 (critério em três linhas).**
Como o P1 **já falha hoje** com 4 itens `P4e` (+12,5 % sem justificativa) tanto no vivo quanto no
L1, "P1 sai 0" não serve como critério sozinho. O ensaio mede, nesta ordem:
1. **P1 roda** (`rc` ∈ {0,1}), **não** `rc=3` — `rc=3` significa arquivo ausente/ilegível, que é
   o modo de falha que o ensaio existe para pegar (estado, catálogo ou uid não voltaram).
2. **A tabela sai completa**: 35 linhas rotina × exercício, as 6 rotinas, sem `P4a`
   (id fantasma) e sem `P4b`/`P4c` (campo inválido) — ou seja, **o dado voltou íntegro**.
3. Com `--justify` cobrindo os 4 itens `P4e`, o veredito é **OK, rc=0** — provado no levantamento:
   `--justify` nos 4 dá `VEREDITO: OK ... Pode aplicar.`
O ensaio **registra** a contagem de `P4e` como linha de base, não como falha do restore.

**D-5 — O `.env` redigido não é restaurável, e isso é o achado principal.**
O `snapshot.sh` faz `sed -i 's/=.*/=***/' config/.env`. Isso substitui o valor de **toda** linha que
tenha `=`, inclusive as que não são segredo. Medido: o `.env` do L1 tem **25 linhas `CHAVE=***`**
(e outras 68 linhas de comentário viraram `# =***`), contra **as mesmas 25 chaves com valor real** no
vivo. Ou seja, `TERMINAL_TIMEOUT=***`, `BROWSERBASE_PROXIES=***`, `VISION_TOOLS_DEBUG=***` etc.
voltam como lixo. O `RESTORE.md` hoje diz apenas "os valores estão como `***`, reaplique os
secrets" — o que subestima o dano: **não é só o segredo que falta, é a configuração não-secreta
também**. O ensaio **não** contorna isso: ele **documenta**, com a lista das 25 chaves e a regra de
reconstrução. Corrigir a redação é escopo da **BACKLOG-15**, não desta.

**D-6 — `opengym_writer.py` não entra no ensaio com escrita.**
O writer tem uma **trava de alvo** explícita (linhas ~807-819) nascida do incidente de 11/09:
`OPENGYM_DATA_DIR` troca só a cópia local — **o servidor que recebe a escrita não muda** com ela.
Em modo `patch` ele exige `--target-live` ou `OPENGYM_TARGET=live` justamente para o operador não
escrever em produção achando que está num ensaio. Consequência para esta spec: o ensaio roda o
writer **somente em `--dry-run`**, e o **sucesso é medido pelo P1** (`verificar_prescricao.py`), que
é puramente leitor. Nada nesta spec liga `OPENGYM_TARGET=live`.

**D-7 — O estado vivo é copiado para `/tmp`, nunca lido no lugar.**
O P1 é leitor, mas ler o arquivo vivo durante uma escrita do app é corrida desnecessária, e o
escritor grava snapshots em `reports/snapshots/` (que apontaria para produção sem `OPENGYM_REPORTS`).
O ensaio copia `state-<uid>.json` para `/home/pi/hermes-novo/opengym-copia/` e trabalha só ali.

**D-8 — Limpeza = `rm -rf` do diretório do ensaio, com checagem de que produção está intacta.**
Ao final, `rm -rf /home/pi/hermes-novo` e três checagens: `hermes-gateway` continua `active`,
`/etc/cron.d/island-ops` continua com 1783 bytes e `mtime` inalterado, e o estado vivo continua com
o mesmo `md5sum` do início. Se qualquer uma falhar, o ensaio é incidente, não sucesso.

**D-9 — A seção nova do `RESTORE.md` tem formato fixo.**
Título `## 🧪 Ensaio de restauração — <data> (BACKLOG-14)`, e uma tabela de três colunas —
**Item · Voltou? · Como refazer** — seguida de um bloco `O que o ensaio NÃO prova`. Formato exato em
**Detalhe de Implementação §4**.

**D-10 — Premissa do estado final da BACKLOG-13 e da BACKLOG-15.**
O ensaio é escrito para funcionar com o estado **final** das duas: (a) mais arquivos passam a estar
no L1 (`cron/jobs.json`, `gh`, `workout/reports/snapshots/`, `mnemosyne`), e (b) o `config.yaml` pode
chegar **redigido**, exigindo reconstrução. Por isso o roteiro trata esses itens como
**condicionais**: se o arquivo existe no L1, restaura; se não existe, registra como "não voltou
nesta versão do L1" — e o mesmo comando serve depois que as duas fecharem.

---

## Requisitos Funcionais

**RF-1 — Ensaio isolado e reversível.** Todo artefato do ensaio vive sob `/home/pi/hermes-novo/`;
ao final, `rm -rf /home/pi/hermes-novo` devolve a máquina ao estado anterior.

**RF-2 — Produção intocada.** Nenhum comando do ensaio escreve em `/home/pi/.hermes`,
`/mnt/drivebackup/apps/openGym/data`, `/etc/cron.d`, `~/.hermes/cron/jobs.json` ou qualquer repo git.

**RF-3 — Restauração pelo L1, não pelo L0.** Os arquivos vêm exclusivamente do clone do
`emersondsc/hermes-snapshot`; `restore_island.sh` **não** é chamado (ele é do Cenário A/C, lê o HD e
escreve em `$HERMES_HOME` — usá-lo aqui confundiria as camadas que o ensaio quer separar).

**RF-4 — P1 medido no ambiente restaurado.** O P1 roda com `HERMES_HOME` do ensaio e as seis
variáveis `OPENGYM_*` apontando para a cópia, e o resultado é classificado pelos três critérios de
**D-4**.

**RF-5 — `MECANICA_PESOS.md` conferido por conteúdo, não por existência.** O aceite pede que ele
"volte junto": o ensaio compara o `md5sum` do arquivo restaurado com o do L1 e confere que as quatro
seções obrigatórias estão lá (precedência, reps/P3, P2, verificação P1+P4) e que a linha
`**Verificado em:**` traz o commit `49fa3c1`.

**RF-6 — Lacunas registradas.** Cada item que **não** volta pelo L1 entra na seção nova do
`RESTORE.md` com uma instrução de como refazer. No mínimo: `hermes-agent`/venv, `auth.json`,
`~/.config/gh/hosts.yml`, `cron/jobs.json`, `mnemosyne/`, `kanban.db`, `state.db`,
`workout/reports/snapshots/`, `workout/data/`, `profiles/treinador`, `ms-playwright`, `og.key`/`og.crt`,
`data/agent.key`, `data/vapid.json`.

**RF-7 — Classificação por consequência.** Cada lacuna é marcada como:
**recuperável** (reautentica/reinstala/rebaixa), **recriável** (existe comando, o conteúdo se perde) ou
**perda real** (a única cópia estava no disco morto). O usuário precisa saber qual é qual.

**RF-8 — Nada destrutivo sem aviso.** Os únicos comandos que apagam algo são o `rm -rf` do diretório
do ensaio e o `rm -rf` do clone descartável dentro dele. Ambos com o caminho **literal e absoluto**
na linha, sem variável que possa expandir vazia.

**RF-9 — Registro do ensaio.** O ensaio grava `~/hermes-novo/ensaio-<timestamp>.log` com a saída de
cada passo e o resultado final, para o operador poder colar a evidência no `RESTORE.md`.

**RF-10 — Reexecutável.** Rodar o ensaio duas vezes seguidas funciona: o passo 0 limpa um diretório
de ensaio remanescente antes de começar.

---

## Detalhe de Implementação

### 0. Pré-condições (rodar e conferir ANTES de qualquer coisa)

```bash
# deve dizer 'active' e 'enabled' — é a produção que NÃO pode ser tocada
systemctl --user is-active  hermes-gateway.service
systemctl --user is-enabled hermes-gateway.service

# linha de base para a checagem final (D-8)
md5sum /mnt/drivebackup/apps/openGym/data/state-ZPJbmYUfHlfbAYzi.json | tee /tmp/ensaio-baseline.md5
stat -c '%s %Y' /etc/cron.d/island-ops | tee -a /tmp/ensaio-baseline.md5

# espaço: o ensaio usa o raiz (201 GB livres)
df -h / /mnt/drivebackup

# o L1 tem rede?
git -C /home/pi/hermes-snapshot status -sb | head -1
```

### 1. Preparar o diretório do ensaio (passo 0 = limpeza idempotente)

```bash
ENSAIO=/home/pi/hermes-novo
[ -d "$ENSAIO" ] && echo "ATENCAO: $ENSAIO ja existe — limpando" && rm -rf /home/pi/hermes-novo
mkdir -p "$ENSAIO"
export HERMES_HOME="$ENSAIO/.hermes"
export ENSAIO
echo "ensaio em $ENSAIO / HERMES_HOME=$HERMES_HOME"
```

### 2. Cenário B.1 — passo 2 do `RESTORE.md`: clonar o L1 do GitHub

```bash
git clone https://github.com/emersondsc/hermes-snapshot.git "$ENSAIO/l1" 2>&1 | tail -3
cd "$ENSAIO/l1"
git log -1 --format='%h %ad %s' --date=iso | tee "$ENSAIO/ensaio-commit.txt"
```

> **Nota de execução:** o `RESTORE.md` manda clonar em `~/hermes-snapshot-clone`. Aqui o destino é
> `$ENSAIO/l1` de propósito: o clone de produção já existe em `/home/pi/hermes-snapshot` e clonar por
> cima dele seria interferência. O comando `git clone <url> <destino>` é equivalente.

### 3. Cenário B.1 — passos 3 a 9: restaurar o conteúdo para o home do ensaio

Todos os `cp` abaixo usam caminhos **absolutos** do ensaio. O `RESTORE.md` usa `~` porque assume
um Pi novo; dentro do ensaio o `$HOME` real continua sendo `/home/pi`, então `~` **apontaria para
produção**. Esta é a correção mais importante que o ensaio faz no documento.

```bash
mkdir -p "$HERMES_HOME"

# passo 3 — config
cp "$ENSAIO/l1/config/config.yaml" "$HERMES_HOME/config.yaml"
cp "$ENSAIO/l1/config/.env"        "$HERMES_HOME/.env"     # vem com =*** (ver B.2 e a seção nova)

# passo 4 — skills
rm -rf "$HERMES_HOME/skills"
cp -r "$ENSAIO/l1/skills" "$HERMES_HOME/skills"

# passo 5 — memories
rm -rf "$HERMES_HOME/memories"
cp -r "$ENSAIO/l1/memories" "$HERMES_HOME/memories"

# passo 6 — scripts locais
mkdir -p "$HERMES_HOME/scripts"
cp "$ENSAIO/l1/scripts/"*.sh      "$HERMES_HOME/scripts/" 2>/dev/null || true
cp "$ENSAIO/l1/scripts/"*.py      "$HERMES_HOME/scripts/" 2>/dev/null || true
cp "$ENSAIO/l1/scripts/"*.crontab "$HERMES_HOME/scripts/" 2>/dev/null || true

# passo 7 — sessions (historico compactado)
mkdir -p "$HERMES_HOME/sessions"
cp "$ENSAIO/l1/sessions/state.db.gz" "$HERMES_HOME/sessions/"
gunzip -f "$HERMES_HOME/sessions/state.db.gz"

# passo 8 — plugins com patch local (opencode-zen).
# ATENCAO: no Pi novo, ~/.hermes/hermes-agent/plugins/ nasce do `hermes update`.
# Aqui ele NAO existe no home do ensaio, entao este passo e CONDICIONAL e reportado como tal.
# O clone do L1 guarda 2 arquivos; o alvo tem 39 provedores. Restaurar so o que veio.
if [ -d "$ENSAIO/l1/plugins/model-providers" ]; then
  mkdir -p "$HERMES_HOME/plugins/model-providers"
  cp -r "$ENSAIO/l1/plugins/model-providers/." "$HERMES_HOME/plugins/model-providers/"
  echo "plugins: restaurado em \$HERMES_HOME/plugins (o destino do RESTORE.md,"
  echo "         ~/.hermes/hermes-agent/plugins/, NAO existe num home limpo)"
fi

# passo 9 — a operacao de treino (portao P1, mecanica, planos, recibos) <<< O CORACAO DO ACEITE
mkdir -p "$HERMES_HOME/workout"
cp -r "$ENSAIO/l1/workout/." "$HERMES_HOME/workout/"

# passo 10 — dados do openGym: NAO para o HD vivo. Copia para dentro do ensaio.
mkdir -p "$ENSAIO/opengym-data"
cp "$ENSAIO/l1/opengym-data/"*.json "$ENSAIO/opengym-data/"
```

> **Correção obrigatória do passo 10:** o `RESTORE.md` manda
> `mkdir -p /mnt/drivebackup/apps/openGym/data` e copiar para lá. Num ensaio isso **sobrescreve o
> estado vivo do app** — é a única linha do B.1 que é genuinamente perigosa de rodar como está.
> A spec mantém o destino real documentado no `RESTORE.md` (é o certo para um Pi novo) e registra o
> desvio do ensaio.

### 4. O passo 11 do `RESTORE.md` fica de FORA do ensaio (e por quê)

```bash
# RESTORE.md passo 11:  sudo install -m644 ~/.hermes/scripts/island-ops.crontab /etc/cron.d/island-ops
```

Isto instala um watchdog **de sistema** que roda a cada 15 min e dispara alerta no Telegram. Rodar
no ensaio significaria (a) escrever fora do diretório do ensaio, (b) duplicar/sobrescrever o
`/etc/cron.d/island-ops` de produção (1783 bytes, `mtime` 12/09 17:02), e (c) gerar alarme falso no
Telegram do usuário. O ensaio **valida o arquivo sem instalar**:

```bash
# o arquivo volta do L1 e e sintaticamente valido?
test -f "$HERMES_HOME/scripts/island-ops.crontab" && echo "crontab: presente no L1"
diff -q "$HERMES_HOME/scripts/island-ops.crontab" /etc/cron.d/island-ops \
  && echo "crontab: IDENTICO ao instalado em producao (passo 11 seria no-op)" \
  || echo "crontab: DIFERE do instalado — o RESTORE.md precisa dizer por que"
grep -q '^HOME=/home/pi$' "$HERMES_HOME/scripts/island-ops.crontab" \
  && echo "crontab: tem a linha HOME= (a correcao da BACKLOG-10 veio junto)"
grep -q '^PATH=' "$HERMES_HOME/scripts/island-ops.crontab" \
  && echo "crontab: tem PATH explicito (o binario hermes esta fora do PATH do cron)"
```

Os dois `grep` são o teste real: sem `HOME=` o `snapshot.sh` monta `/hermes-snapshot` e morre em
silêncio; sem `PATH=` o alerta falha em silêncio. São as duas regressões que já aconteceram.

### 5. Restaurar os `opengym-data` **por cima do estado vivo? NÃO** — cópia isolada

```bash
# o dado que o P1 vai auditar e uma COPIA, com o uid real
cp "$ENSAIO/opengym-data/state-ZPJbmYUfHlfbAYzi.json" "$ENSAIO/opengym-data/auditado.json"
md5sum "$ENSAIO/opengym-data/state-ZPJbmYUfHlfbAYzi.json"
```

### 6. Rodar o portão P1 no ambiente restaurado (o aceite)

```bash
export OPENGYM_UID=ZPJbmYUfHlfbAYzi
export OPENGYM_DATA_DIR="$ENSAIO/opengym-data"
export OPENGYM_CATALOG=/mnt/drivebackup/apps/openGym/openGym/frontend/src/lib/exercises-data.json
export OPENGYM_REPORTS="$ENSAIO/.hermes/workout/reports"
export OPENGYM_GATE="$ENSAIO/.hermes/workout/scripts/verificar_prescricao.py"
export OPENGYM_MEDIA=/mnt/drivebackup/apps/openGym/media

cd "$ENSAIO"
python3 "$HERMES_HOME/workout/scripts/verificar_prescricao.py" \
  > "$ENSAIO/ensaio-p1-sem-justify.txt" 2>&1
echo "P1 (sem justificativa) rc=$?"
tail -8 "$ENSAIO/ensaio-p1-sem-justify.txt"
```

**Critério 1 (D-4):** o `rc` tem de ser **0 ou 1**. `rc=3` = dado ausente/ilegível, e o ensaio
reprova. **Critério 2:** a tabela tem de sair com as **6 rotinas** e **35 linhas**, e a lista de
falhas não pode ter nenhum `P4a`/`P4b`/`P4c`.

```bash
# Critério 3: com as 4 justificativas de base, o veredito tem de ser OK
JUSTIFY='{"r_leg1_20260823:0738":"divida tecnica pre-existente (BACKLOG-14)","r_leg2_20260823:0738":"divida tecnica pre-existente (BACKLOG-14)","r_push_C_20260829:0738":"divida tecnica pre-existente (BACKLOG-14)","r_upper_C_20260829:0326":"divida tecnica pre-existente (BACKLOG-14)"}'
python3 "$HERMES_HOME/workout/scripts/verificar_prescricao.py" --justify "$JUSTIFY" \
  > "$ENSAIO/ensaio-p1-com-justify.txt" 2>&1
echo "P1 (com justificativa) rc=$?"
grep -c 'OK$' "$ENSAIO/ensaio-p1-com-justify.txt"
grep 'VEREDITO' "$ENSAIO/ensaio-p1-com-justify.txt"
```

Sucesso esperado, medido no levantamento: **`VEREDITO: OK — tela bate com a intenção`** e `rc=0`.

### 7. Conferir o `MECANICA_PESOS.md` (o outro item do aceite)

```bash
MEC="$HERMES_HOME/workout/MECANICA_PESOS.md"
test -f "$MEC" && echo "MECANICA_PESOS.md: presente" || echo "MECANICA_PESOS.md: AUSENTE — ACEITE FALHOU"
diff -q "$MEC" "$ENSAIO/l1/workout/MECANICA_PESOS.md" && echo "MECANICA: identico ao L1"
for s in "Ordem de precedência" "Reps exibidas" "Progressão automática" "Verificação obrigatória"; do
  grep -q "$s" "$MEC" && echo "  secao OK: $s" || echo "  SECAO FALTANDO: $s"
done
grep -q '49fa3c1' "$MEC" && echo "MECANICA: cita o commit do app (49fa3c1)"
grep -q 'verificar_prescricao.py' "$MEC" && echo "MECANICA: aponta para o portao P1"
```

**Por que isto importa:** o `MECANICA_PESOS.md` é a **fonte única da precedência** (template >
caderno > último treino) e o P1 é a implementação dela. Se o `.md` volta e o `.py` não (ou ao
contrário), o pipeline fica com duas verdades — foi exatamente a causa do bug de semanas, segundo o
próprio arquivo.

### 8. Testes que o L1 também devolve (prova de que o pipeline voltou inteiro)

```bash
cd "$HERMES_HOME/workout/scripts"
python3 test_verificar_prescricao.py 2>&1 | tail -5
python3 test_semana_atual.py         2>&1 | tail -5
```

> `test_escritor_rotinas.py` (28 testes) faz escrita/HTTP — **ficar fora**, ou rodar só se houver
> um modo `--dry-run` confirmado no arquivo na hora do ensaio.

### 9. O que NÃO voltou — levantar automaticamente

```bash
# hermes-agent e venv: o L1 nao tem (o RESTORE.md diz isso corretamente)
ls -d "$HERMES_HOME/hermes-agent" 2>/dev/null || echo "FALTOU: hermes-agent/ (binario+venv, 2.2 GB)"

# auth.json do agente (perfil/credencial de provider)
ls "$HERMES_HOME/auth.json" 2>/dev/null || echo "FALTOU: auth.json (reauth: 'hermes auth')"

# credencial do gh — a que faz o proprio backup autenticar
ls "$HOME/.config/gh/hosts.yml" 2>/dev/null && \
  echo "gh: existe em producao, NAO no L1 -> reauth: 'gh auth login'"

# os itens da BACKLOG-13
for p in cron/jobs.json mnemosyne kanban.db projects.db state.db \
         workout/reports/snapshots workout/data profiles/treinador; do
  if [ -e "$ENSAIO/l1/$p" ]; then echo "VOLTOU (L1): $p"
  else echo "FALTOU: $p"; fi
done

# ms-playwright (browser)
ls -d "$HOME/.cache/ms-playwright" 2>/dev/null && echo "ms-playwright: so em producao, reinstala com o hermes"

# chaves de copia unica do openGym (estao no HD, nao no L1)
for p in /mnt/drivebackup/apps/openGym/openGym/og.key \
         /mnt/drivebackup/apps/openGym/openGym/og.crt \
         /mnt/drivebackup/apps/openGym/data/agent.key \
         /mnt/drivebackup/apps/openGym/data/vapid.json \
         /mnt/drivebackup/apps/openGym/data/secret; do
  [ -e "$p" ] && echo "existe em producao (copia unica, BACKLOG-13): $p"
done
```

### 10. Limpeza e verificação de que produção está intacta

```bash
cd /   # sair de dentro do diretorio antes de apagar
rm -rf /home/pi/hermes-novo
test -d /home/pi/hermes-novo && echo "ERRO: sobrou algo" || echo "ensaio removido"

systemctl --user is-active hermes-gateway.service          # tem de seguir 'active'
md5sum -c /tmp/ensaio-baseline.md5 2>/dev/null || true
stat -c '%s %Y' /etc/cron.d/island-ops                     # comparar com a linha de base
```

### 11. Mudanças no `RESTORE.md` — ANTES → DEPOIS

Esta seção é o **produto textual** do ensaio: as correções que ele obriga no documento, no formato
que o operador aplica depois (o ensaio **não** commita).

**11.1 — Passo 3: o `.env` (a correção mais urgente).**

ANTES:
```markdown
# 3. Restaurar config (ATENCAO: .env vem com secrets redactados como ***)
mkdir -p ~/.hermes
cp config/config.yaml ~/.hermes/config.yaml
# IMPORTANTE: o .env do repo tem os valores como *** — voce PRECISA reaplicar os secrets reais:
#   - copie suas chaves reais para ~/.hermes/.env, OU
#   - rode `hermes auth` / reconfigure os providers pelo CLI
#   cp config/.env ~/.hermes/.env   # so se voce confia no repo; melhor redefinir manualmente
```

DEPOIS:
```markdown
# 3. Restaurar config (ATENCAO: .env vem REDIGIDO INTEIRO — nao so os secrets)
mkdir -p ~/.hermes
cp config/config.yaml ~/.hermes/config.yaml
# O `snapshot.sh` roda `sed 's/=.*/=***/' config/.env`, que apaga o VALOR de TODA linha com `=`.
# Nao e "secrets redactados": as 25 chaves do arquivo perdem o valor, inclusive as que nao sao
# segredo (TERMINAL_TIMEOUT, BROWSERBASE_PROXIES, VISION_TOOLS_DEBUG, ...).
# Reconstrucao: reaplique as 5 credenciais reais e copie os ~20 parametros de configuracao vivos
# de outra copia. As 25 chaves afetadas:
#   grep -n '^[A-Z_][A-Z0-9_]*=' config/.env
# Reparo definitivo e escopo da BACKLOG-15 (redigir so o que e segredo).
cp config/.env ~/.hermes/.env   # e DEPOIS edite — o arquivo volta inutilizavel como esta
```

**11.2 — Passo 8: o destino dos plugins não existe num home limpo.**

ANTES:
```markdown
# 8. Restaurar plugins com patches locais (ex.: opencode-zen fix)
if [ -d plugins/model-providers ]; then
  cp -r plugins/model-providers ~/.hermes/hermes-agent/plugins/ 2>/dev/null || true
fi
```

DEPOIS:
```markdown
# 8. Restaurar plugins com patches locais (ex.: opencode-zen fix)
# ATENCAO a ordem: ~/.hermes/hermes-agent/plugins/ SO existe DEPOIS do passo 1 (instalar o Hermes
# Agent). Sem ele o `cp` falha e o `|| true` engole o erro — o patch nao volta e ninguem percebe.
# O L1 guarda 2 arquivos (opencode-zen); o alvo tem 39 provedores: isto e um PATCH, nao o diretorio.
if [ -d plugins/model-providers ] && [ -d ~/.hermes/hermes-agent/plugins ]; then
  cp -r plugins/model-providers/. ~/.hermes/hermes-agent/plugins/model-providers/
else
  echo "AVISO: patch de plugin NAO aplicado — faltou ~/.hermes/hermes-agent/plugins/ (rode o passo 1 antes)"
fi
```

**11.3 — Passo 10: o destino no HD vivo (perigoso fora de um Pi novo).**

ANTES:
```markdown
# 10. Restaurar os dados do openGym (state-*.json + db.json) — vao para o HD, nao para a ilha
mkdir -p /mnt/drivebackup/apps/openGym/data
cp opengym-data/*.json /mnt/drivebackup/apps/openGym/data/ 2>/dev/null || true
```

DEPOIS:
```markdown
# 10. Restaurar os dados do openGym (state-*.json + db.json) — vao para o HD, nao para a ilha
# PERIGO: num Pi novo este e o destino certo. Numa maquina VIVA isto sobrescreve o estado do app.
# Confirme que o container do openGym esta parado, ou que voce esta mesmo num sistema vazio.
mkdir -p /mnt/drivebackup/apps/openGym/data
cp opengym-data/*.json /mnt/drivebackup/apps/openGym/data/ 2>/dev/null || true
# Em ENSAIO (maquina viva): aponte OPENGYM_DATA_DIR para uma copia e NAO rode esta linha.
```

**11.4 — Passo 11: falha silenciosa se `~/.hermes/scripts` não voltou.**

ANTES:
```markdown
# 11. Reinstalar o watchdog independente (o cron so le arquivos de /etc/cron.d)
sudo install -m644 ~/.hermes/scripts/island-ops.crontab /etc/cron.d/island-ops
```

DEPOIS:
```markdown
# 11. Reinstalar o watchdog independente (o cron so le arquivos de /etc/cron.d)
# O install FALHA EM SILENCIO se o passo 6 nao rodou (o arquivo nao existe em ~/.hermes/scripts).
test -f ~/.hermes/scripts/island-ops.crontab || \
  { echo "ERRO: island-ops.crontab ausente — rode o passo 6 antes"; exit 1; }
sudo install -m644 ~/.hermes/scripts/island-ops.crontab /etc/cron.d/island-ops
# Confira as duas linhas que fazem este arquivo funcionar (BACKLOG-10 e o alerta silencioso):
grep -q '^HOME=/home/pi$' /etc/cron.d/island-ops && echo "HOME= ok" || echo "FALTA HOME= (snapshot.sh morre)"
grep -q '^PATH='          /etc/cron.d/island-ops && echo "PATH= ok" || echo "FALTA PATH= (alerta morre)"
```

**11.5 — Seção NOVA (o registro do ensaio, D-9).**

Acrescentar ao final do `RESTORE.md`, depois do FAQ:

```markdown
---

## 🧪 Ensaio de restauração — 12/09/2026 (BACKLOG-14)

> Cenário **B.1** executado num diretório limpo (`/home/pi/hermes-novo`), com
> `HERMES_HOME` dedicado. **Não** é um Pi novo: mesmo SO, mesmo usuário, mesmo venv.
> L1 usado: commit `<hash>` (`git log -1`), de 12/09/2026.
> Log completo: `~/hermes-novo/ensaio-<timestamp>.log` (apagado na limpeza; o resumo é isto).

### O que voltou

| Item | Voltou? | Evidência |
|------|---------|-----------|
| `workout/scripts/verificar_prescricao.py` (portão P1) | ✅ | rodou no ensaio, tabela com 6 rotinas |
| `workout/MECANICA_PESOS.md` | ✅ | md5 idêntico ao L1; 4 seções + commit `49fa3c1` |
| `workout/plans/`, `reports/`, `specs/` | ✅ | restaurados pelo passo 9 |
| `skills/`, `memories/`, `scripts/`, `sessions/` | ✅ | passos 4-7 |
| `opengym-data/` (4 `state-*.json` + `db.json`) | ✅ | passo 10, destino desviado para o ensaio |

### O que NÃO voltou (e como refazer)

| Item | Voltou? | Como refazer |
|------|---------|--------------|
| `hermes-agent/` + venv (2,2 GB) | ❌ | `hermes update` (rede) / `git clone` do repo oficial |
| `auth.json` (provider/credencial do agente) | ❌ | `hermes auth` — reautenticação, não perda |
| `~/.config/gh/hosts.yml` | ❌ | `gh auth login` — sem isto **o backup não empurra nada** |
| `cron/jobs.json` (11 jobs, 8 ativos) | ❌ | recriar com `hermes cron` — a lista não existe versionada |
| `cron/` (agendamento do agente) | ❌ | `hermes cron` — ver BACKLOG-13 |
| `mnemosyne/` (677 MB, banco + modelo) | ❌ | só no L0 (mesmo disco!) — reindexar |
| `kanban.db` / `projects.db` | ❌ | só no L0 — recriável, conteúdo perdido |
| `state.db` (167 MB, histórico) | ❌ | só no L0 — o L1 tem `state.db.gz` comprimido |
| `workout/reports/snapshots/` (24 arq.) | ❌ | `-maxdepth 1` do `snapshot.sh` deixa fora; é a "fonte do desfazer" |
| `workout/data/` (CSVs + análise) | ❌ | regenera com `sync_treino.sh` |
| `profiles/treinador` | ❌ | Hermes paralelo inteiro — ver BACKLOG-13 |
| `ms-playwright` | ❌ | reinstala com o `hermes` (precisa baixar) |
| `og.key`/`og.crt`, `data/agent.key`, `vapid.json`, `data/secret` | ❌ | cópia única no HD — **perda real se o disco morrer** |
| `.env` (25 chaves com valor) | ⚠️ | volta **inutilizável**: `sed 's/=.*/=***/'` apaga todo valor |

### O que o ensaio NÃO prova

- Não é um **Pi novo**: mesmo SO (Ubuntu ARM64, kernel raspi), mesmo Python, mesmo usuário `pi`,
  mesma rede. Um SO limpo, um Python diferente ou outro usuário **não** foram exercitados.
- Não exercita o **passo 1** (instalar o Hermes Agent), porque o binário e o venv desta máquina
  seguem no lugar. O restore começa num sistema onde o agente **já funciona**.
- Não exercita o **passo 11** (instalar o watchdog em `/etc/cron.d`) nem `hermes gateway restart`,
  por serem de produção. Os arquivos foram validados, não instalados.
- Não prova que o **portão P1 passa limpo**: ele sai com 4 itens `P4e` (+12,5 % sem justificativa)
  **também no estado vivo**. É dívida de dado pré-existente, não regressão do restore.
- Não exercita a **morte do disco**: L0 e L1 continuaram onde estavam; o ensaio só simula "só tenho
  o GitHub".
```

### 12. Script único (copiável, LF, para `/tmp/ensaio14.sh`)

> Rodar com `cmd /c "ssh hermes bash < %TEMP%\ensaio14.sh"` — **nunca** por pipe do PowerShell
> (o CRLF quebra o bash). O script é **dry-run por padrão** até o operador ler a saída do passo 0.

Gravar exatamente o que está nas seções 0 a 10 acima, na ordem, com `set -uo pipefail` (não `-e`:
o P1 saindo `1` é resultado esperado e não pode abortar o script). Cada bloco faz `tee` para
`$ENSAIO/ensaio-<timestamp>.log`.

---

## Critérios de aceite

Executáveis, na ordem. **DESTRUTIVO** marca o que apaga algo; **MENSAGEM** marca o que envia/instala.

1. **(não destrutivo)** `systemctl --user is-active hermes-gateway.service` devolve `active` antes e
   depois do ensaio.
2. **(não destrutivo)** `/home/pi/hermes-novo` não existia no início e não existe no fim
   (`test -d` → falso).
3. **(não destrutivo)** O clone `$ENSAIO/l1` existe, é `emersondsc/hermes-snapshot` e
   `git log -1 --format=%h` foi registrado em `ensaio-commit.txt`.
4. **(não destrutivo)** `$HERMES_HOME/workout/scripts/verificar_prescricao.py` existe e é
   **idêntico** (`md5sum`) ao do L1.
5. **(não destrutivo)** `$HERMES_HOME/workout/MECANICA_PESOS.md` existe, é idêntico ao L1, contém as
   4 seções obrigatórias, cita `49fa3c1` e cita `verificar_prescricao.py`.
6. **(não destrutivo)** O P1 roda no ambiente restaurado com `rc` ∈ {0,1} — **nunca `rc=3`** —
   e a tabela traz as 6 rotinas e 35 linhas.
7. **(não destrutivo)** Com `--justify` cobrindo os 4 `P4e` de base, o P1 devolve
   `VEREDITO: OK` e `rc=0`.
8. **(não destrutivo)** A lista de falhas do P1 no ensaio é **igual** à do estado vivo (mesmos 4
   itens `P4e`), provando que o restore não introduziu divergência.
9. **(não destrutivo)** `md5sum` do `state-ZPJbmYUfHlfbAYzi.json` do ensaio é igual ao do arquivo
   **do L1**, e o arquivo vivo em `/mnt/drivebackup/apps/openGym/data/` mantém o `md5sum` da linha
   de base (produção intocada).
10. **(não destrutivo)** O `island-ops.crontab` restaurado tem `HOME=/home/pi` e `PATH=`, e é
    idêntico ao instalado em `/etc/cron.d/island-ops`.
11. **(MENSAGEM — não executado)** O passo 11 NÃO foi rodado: `/etc/cron.d/island-ops` continua com
    1783 bytes e `mtime` 12/09 17:02, e nenhuma mensagem nova chegou ao Telegram.
12. **(não destrutivo)** `test_verificar_prescricao.py` roda e passa no ambiente restaurado.
13. **(DESTRUTIVO — único)** `rm -rf /home/pi/hermes-novo` remove o diretório do ensaio e **nada
    mais**; o caminho é literal e absoluto, jamais uma variável.
14. **(não destrutivo)** A seção `## 🧪 Ensaio de restauração — <data> (BACKLOG-14)` está escrita,
    com a tabela "O que NÃO voltou" preenchida item a item e a lista de limites honestos.
15. **(DESTRUTIVO — verificado)** `/mnt/drivebackup/apps/openGym/data/state-ZPJbmYUfHlfbAYzi.json`
    tem o mesmo `md5sum` do início; nenhum arquivo novo apareceu em
    `/mnt/drivebackup/apps/openGym/data/`.
16. **(não destrutivo)** Nenhum `git commit`/`git push` foi feito em repo nenhum:
    `git -C /home/pi/hermes-snapshot status -sb` continua limpo e no mesmo commit.

---

## Riscos e rollback

**R-1 — O `sed` de redação é irreversível.** Se o ensaio rodar `snapshot.sh` "para conferir", ele
sobrescreve `config/.env` no clone com a versão redigida e **commita**. Mitigação: `snapshot.sh` está
**proibido** nesta spec (RF-2). Se alguém rodar, o push seguinte vai embora com o `.env` destruído.

**R-2 — Confundir o `~` de produção com o `~` do ensaio.** O `RESTORE.md` foi escrito para um Pi
novo, onde `~` = `/home/pi` limpo. Aqui `~` **é** `/home/pi` de produção. Um
`cp -r skills ~/.hermes/skills` copiado direto do documento **sobrescreve as skills de produção**.
Mitigação: todo comando desta spec usa `$HERMES_HOME` absoluto; nunca `~` para o destino.

**R-3 — `OPENGYM_TARGET=live` ligado por engano.** O `opengym_writer.py` só exige a declaração de
alvo no modo `patch`; sem a variável ele recusa — mas se alguém a exportar, uma escrita vai para
`opengym.edsc.fun`. Mitigação: esta spec **não** define `OPENGYM_TARGET` em lugar nenhum e o writer
só entra em `--dry-run` (D-6).

**R-4 — P1 vermelho por dívida pré-existente lida como falha do restore.** Mitigação: D-4 fixa a
linha de base (4 itens `P4e`), e o critério de aceite 8 exige que a lista seja *igual* à do vivo.

**R-5 — Corrida com o app.** O container do openGym pode escrever `state-<uid>.json` durante o
ensaio. Mitigação: o ensaio trabalha sobre a cópia (D-7) e mede `md5sum`, não `mtime`.

**R-6 — Espaço.** O clone é ~90 MB, mas `hermes-agent` (2,2 GB) e `mnemosyne` (677 MB) ficam
**fora** do ensaio. Se alguém quiser incluí-los, o raiz tem 201 GB — cabe, mas deixa de ser B.1.

**Rollback:** o ensaio é aditivo dentro de `/home/pi/hermes-novo`. O rollback é
`rm -rf /home/pi/hermes-novo`. Nada do ensaio escreve fora desse diretório, com uma exceção
declarada — `/tmp/ensaio-baseline.md5` e `/tmp/ensaio14.sh`, descartáveis.

---

## Testes manuais

**T-1 — Ensaio completo, caminho feliz.** Rodar as seções 0 a 10 de ponta a ponta. Esperado:
P1 com `rc=0` sob `--justify` e `VEREDITO: OK`; `MECANICA_PESOS.md` idêntico; critérios 1 a 16 ok.

**T-2 — Idempotência (RF-10).** Rodar duas vezes seguidas. A segunda tem de limpar e refazer sem
erro; o resultado tem de ser idêntico.

**T-3 — Teste negativo: o ensaio realmente detecta ausência.** Antes do passo 9, suprimir a cópia de
`workout/` e rodar o P1. Esperado: `rc=3` com
`[3] estado auditado nao encontrado` **ou** `python3: can't open file`. Prova que o ensaio mede
alguma coisa — sem isso, "P1 passou" não é evidência.

**T-4 — Teste negativo: catálogo ausente.** Rodar o P1 com `OPENGYM_CATALOG=/tmp/nao-existe.json`.
Esperado: `rc=3` e a mensagem que imprime o caminho de propósito. Prova que o catálogo é dependência
real do portão.

**T-5 — Produção intacta.** Após T-1: conferir critérios 1, 11, 14, 15 e 16; conferir que
`~/.hermes/skills` tem a mesma contagem de arquivos de antes; conferir que o gateway não reiniciou
(`systemctl --user show hermes-gateway.service -p NRestarts` inalterado).

**T-6 — A seção nova é fiel.** Reler a seção `🧪 Ensaio...` e conferir item a item contra a saída do
passo 9. O que não foi medido não pode estar listado como ✅.

---

## Comportamento Visual/UX

O operador vê a saída de cada passo. Como cada um deve se parecer:

**Passo 0 — pré-condições.** Quatro linhas: `active`/`enabled`, dois `md5sum`, o `df -h` com
`/dev/sda3 240G ... 201G ... 12% /`. Se o `df` mostrar o **HD** com 20 GB como destino, parar: o
ensaio não é para lá.

**Passo 1 — criação.** `ensaio em /home/pi/hermes-novo / HERMES_HOME=/home/pi/hermes-novo/.hermes`.
Se aparecer `ATENCAO: ... ja existe — limpando`, é a reexecução esperada (T-2), não um problema.

**Passo 2 — clone.** As linhas do git e, em destaque, a linha do commit:
`632aa92 2026-09-12 16:47:21 -0300 📸 Snapshot 2026-09-12_16-47-21`. **Este hash é a régua**: é ele
que entra na seção nova do `RESTORE.md`. Se o clone pedir usuário/senha, a credencial do `gh`
(`~/.config/gh/hosts.yml`) está fora do L1 — anotar como lacuna, não improvisar.

**Passos 3 a 9 — cópia.** Silêncio é o esperado. Qualquer `No such file` significa que o L1 não
traz aquele arquivo — isso **é** um achado, vai para a tabela "O que NÃO voltou".

**Passo 6 — a tabela do P1 é o clímax visual.** 35 linhas no formato
`r_leg1_20260823  0739  160  160  6  160  160.0  OK`. O operador precisa ver:
as **6 rotinas** (r_leg1, r_leg2, r_push_C, r_pull_C, r_upper_C — e a coluna batendo), a coluna
`status` dominada por `OK`, e nenhuma linha com `DIVERGE`. Depois da tabela, o rodapé:
`VEREDITO: FALHA (4 item(ns)) — NAO aplique.` seguido dos 4 `P4e`. **Esse vermelho é esperado na
primeira passada** — e é por isso que o passo 6 roda duas vezes: a segunda, com `--justify`, tem de
fechar em verde:

```
VEREDITO: OK — tela bate com a intencao em todas as rotinas x exercicios. Pode aplicar.
```

**Passo 7 — `MECANICA_PESOS.md`.** Quatro linhas `secao OK:` e as duas de conteúdo
(`cita o commit do app (49fa3c1)`, `aponta para o portao P1`). Falha aqui é falha do **aceite**,
não do ensaio: o item existe justamente para conferir se ele volta junto.

**Passo 9 — a lista de `FALTOU:` é o produto.** O operador vê a lista crescer e ela **é** o conteúdo
da seção nova do documento. Se a lista sair vazia, algo está errado: o L1 não tem `hermes-agent`,
`auth.json`, `mnemosyne` — uma lista vazia significa que o ensaio não mediu.

**Passo 10 — limpeza.** `ensaio removido`, seguido de `active` e dos dois `md5sum`. O operador tem
de conseguir ver, na mesma tela, que o ensaio sumiu e que a produção continua de pé.

**Sinal de sucesso, em uma frase de tela:** `VEREDITO: OK` do P1 (passo 6, segunda rodada),
`MECANICA_PESOS.md: identico ao L1` (passo 7), a lista de `FALTOU:` preenchida (passo 9) e
`ensaio removido` + gateway `active` (passo 10).
