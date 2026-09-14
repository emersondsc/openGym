# Spec: cobertura do L1 — o que o restore precisa e não sobe ao GitHub (BACKLOG-13) — v1

## Contexto e Objetivo

A camada L1 (repo privado `emersondsc/hermes-snapshot`, snapshot diário às 06:00 via `/etc/cron.d/island-ops`) é a **única camada que sobrevive à morte do disco**. Isso foi verificado, não suposto: `/` (240 GB, `/dev/sda3`) e `/mnt/drivebackup` (216 GB, `/dev/sda1`) são **partições do mesmo HD externo de 465 GB**; só `/boot/firmware` está num pendrive USB. O L0 (`island_backup.sh`, a cada 6h, espelho rsync para `/mnt/drivebackup/HermesLocal/hermes-island`) cobre quase tudo que falta no L1, mas **no mesmo disco físico** — logo, hoje, um defeito de disco leva L0 e L1-ausente juntos.

O objetivo desta spec é fechar a lacuna de cobertura: **cada item da lista do BACKLOG-13 deve estar (a) dentro do L1, ou (b) explicitamente documentado no `RESTORE.md` como "não volta, e como refazer"**. Nada pode ficar implícito.

### Medições que embasam esta spec (levantadas em 12/09/2026, somente leitura)

| Item | Medição real |
|---|---|
| `~/.hermes/mnemosyne` | 677 MB total = **657 MB do modelo** `models/MiniCPM5-1B-Q4_K_M.gguf` + **21 MB de `data/`** (`mnemosyne.db` 16,7 MB, `mnemosyne.db-wal` 4,3 MB, `query_cache.db` 24 KB) + 4 KB de config |
| `~/.hermes/profiles/treinador` | 1,1 GB total = **994 MB de `cache/fastembed`** + 33 MB de `bin/tirith` (ELF aarch64) + **20 MB de `skills/`** (684 arquivos) + 4,3 MB de `models_dev_cache.json` + 524 KB de `state.db` + 45 KB de `projects.db` + 40 KB de `cron/` |
| `cron/jobs.json` | 29 KB, 11 jobs, `updated_at` reescrito **a cada execução de job** (mtime 17:02:32 de hoje) |
| `workout/reports/snapshots/` | 6,6 MB, **24 arquivos** = 5 gerações de run × (baseline 324 KB + draft 324 KB + intent ~0,4 KB) + 3 conjuntos de `sync_snapshot_*.json` de 592 KB |
| `data/audit.jsonl` | 45.438 bytes, **82 linhas**, todas JSON válido, sem IP, sem token |
| `og.key` / `og.crt` | 2048-bit RSA, par confirmado (modulus casa), CN/SAN `pi.tail61c2f4.ts.net` + IPs, válido até 19/08/2036 |
| `data/agent.key` | 64 bytes hex, **derivado** de `data/secret` por HMAC-SHA256 (regenerável) |
| `data/vapid.json` | par de chave de push web (publicKey 87 chars, privateKey 43 chars) |
| `/home/pi/.config/gh/hosts.yml` | 294 B, `oauth_token` de 93 chars, prefixo **`github_pat_`** (fine-grained PAT), perm 600 |
| `.git` do L1 | **1,36 GiB, 2.352 objetos soltos, ZERO packs**, 64 commits, 58 versões de `sessions/state.db.gz` |

**O achado que reordena a prioridade:** o maior problema de custo do repo **não é nenhum item do BACKLOG-13**. É o `sessions/state.db.gz` de ~78 MB que é regravado em **todos** os 64 commits (as 20 últimas revisões, sem exceção) e nunca passou por `git gc`. Os ~6 MB da `workout/reports/snapshots/` que a spec foi chamada a avaliar são **1,1% do que o repo já carrega hoje**. Esta spec trata ambos, porque a pergunta "6 MB cabem?" só tem resposta honesta ao lado do vizinho de 1,36 GB.

---

## Escopo

### Inclui

1. **L1 (novo conteúdo versionado pelo `snapshot.sh`)**
   - `cron/jobs.json` cru (sem segredo — verificado: zero literais ≥40 chars).
   - `workout/reports/snapshots/` completa (24 arquivos, 6,6 MB), em pasta própria.
   - `mnemosyne/` **apenas banco + config** (sem o `.gguf`), com `sqlite3 .backup` para dropar o WAL.
   - `kanban.db` e `projects.db` (120 KB + 45 KB), com `sqlite3 .backup`.
   - `profiles/treinador/` **apenas o essencial** (SOUL.md, profile.yaml, config.yaml, skills/, state.db, projects.db, memories/, assets/, cron/, mnemosyne/data/, e os segredos redigidos).
   - Segredos do openGym e do `gh` **redigidos** (nunca valor real), mais um manifesto de "o que refazer".

2. **`RESTORE.md`** — seção nova consolidando o veredito de cada item, com comando de refazer, e a classificação `recuperável` / `recriável` / `perda real`.

3. **Manutenção do repo L1** — `.gitignore`, `git gc` documentado e o fim da regravação diária de 78 MB.

### Não inclui

- **Não** versiona o modelo `MiniCPM5-1B-Q4_K_M.gguf` (657 MB).
- **Não** versiona `profiles/treinador/cache/fastembed` (994 MB) nem `bin/tirith` (33 MB).
- **Não** versiona `data/secret` nem `data/agent.key` do openGym com valor real.
- **Não** versiona valor real de nenhum segredo (`og.key`, `.env`, `hosts.yml`).
- **Não** versiona `state.db` cru (167 MB) — a decisão sobre ele está em **RF-9** e é a pergunta de produto P-1.
- **Não** muda o horário do snapshot (06:00 é acoplado ao sensor `snapshot_last_ok`).
- **Não** implementa nada nesta entrega: esta é a spec.
- **Não** mexe no `island_backup.sh` (L0) além do que for preciso para coerência de exclusões.

---

## Decisões assumidas

Todas técnicas. As que dependem do usuário estão em **Perguntas de produto**.

**D-1 — O teste de admissão no L1 é uma pergunta de três vias, aplicada item a item.**
(a) É **regenerável por comando** (baixar, reautenticar, reindexar, reinstalar)? → fora do L1, vai para o `RESTORE.md` como "refazer".
(b) É **pequeno e insubstituível** (<10 MB, e não existe comando que o recrie)? → dentro do L1.
(c) É **grande e insubstituível**? → fica fora do L1 por padrão, e sobe somente se o usuário aceitar o custo (é exatamente a pergunta P-1).
Aplicando: `mnemosyne.db` (16,7 MB) cai em (b) por margem — com a ressalva de que seu valor real é o *conteúdo* da memória, o que a torna a candidata natural à pergunta P-1.

**D-2 — Política de segredo: redigir na cópia, nunca omitir o arquivo.**
O valor real **nunca** entra no repo. O arquivo **sempre** entra, com o valor trocado por `***`, preservando as chaves. É o padrão que o `.env` já usa (`sed -i 's/=.*/=***/'`). Para JSON (`auth.json`, `vapid.json`) e YAML (`hosts.yml`) o `sed` de `=` não serve — usa-se reescrita estrutural por `python3` (RF-5). Motivo de preservar em vez de omitir: um arquivo ausente faz o operador achar que não precisa daquilo; um arquivo com `***` diz "isto existe e você precisa recompor".

**D-3 — Segredo real é substituído por um marcador que nomeia a origem.**
O valor vira a string `***REDACTED***` (ou `***` onde o formato exigir). O `RESTORE.md` mapeia cada arquivo redigido ao comando que o refaz. Nunca um placeholder que pareça um valor válido.

**D-4 — Banco SQLite nunca é copiado a quente com `cp`; usa `sqlite3 .backup`.**
`cp` de um SQLite em uso produz um arquivo que pode não abrir (WAL pendente fora do arquivo). Medido agora: `kanban.db` tem `-wal` de 0 B mas `-shm` de 32 KB, `mnemosyne.db` tem `-wal` de **4,3 MB** — ou seja, 4,3 MB de memória viva estão *fora* do `.db`. `sqlite3 <src> ".backup '<dst>'"` produz um arquivo íntegro e único. Se `sqlite3` não estiver disponível, o script **falha alto** em vez de copiar torto (o binário não está instalado hoje — ver R-2).

**D-5 — Nomes de pasta no repo: espelham o `$HERMES_HOME`, um nível, sem abreviação.**
`cron/`, `mnemosyne/`, `kanban/`, `projects/`, `profiles/treinador/`, `workout/reports/snapshots/`, `opengym-keys/`. Espelhar o caminho de origem torna a linha de restore um `cp -r` direto e impede a ambiguidade de "onde isso volta?".

**D-6 — O `snapshot.sh` passa a ser idempotente e a imprimir um ANTES→DEPOIS por bloco.**
Cada bloco anuncia `antes: N arquivos / X KB` e `depois: N arquivos / X KB`, e acumula um resumo final. Motivo: o modo de falha desta família de itens é o **silêncio** — o `-maxdepth 1` deixou 24 arquivos de fora por meses sem que ninguém visse. Um bloco que não muda de tamanho fica visível na saída.

**D-7 — O repo ganha `.gitignore` (hoje não tem nenhum).**
Sem ele, qualquer arquivo que apareça numa pasta versionada entra no commit. O `.gitignore` barra as bombas conhecidas: `*.gguf`, `fastembed/`, `bin/tirith`, `*.tmp`, `*~`, `.DS_Store` e os segredos de valor real caso alguém os coloque ali por engano.

**D-8 — `state.db.gz` sai do commit diário e entra em `gc`.**
Não é item do BACKLOG-13, mas decide se algo "cabe": 78 MB × todos os commits. A decisão técnica é parar de regravá-lo todo dia (mantém o arquivo, condiciona o commit à mudança relevante) e rodar `git gc` uma vez. Sem isso, adicionar 6 MB ou 20 MB ao repo é discutir a cor da cortina com a casa pegando fogo.

**D-9 — 6,6 MB é barato o suficiente para entrar sem discussão de produto.**
Contra o `.git` de 1,36 GiB, `workout/reports/snapshots/` é 1,1% e é a única cópia da "fonte do desfazer". Entra, e não vira pergunta.

**D-10 — `restore_island.sh` NÃO é o veículo de restore do L1.**
Ele lê o HD (L0) e escreve em `$HERMES_HOME`. Ele **aceita** diretório de destino: o primeiro argumento posicional não-flag é o `SRC`, e o destino é a variável `TARGET`, que vem de `$HERMES_HOME` e **não** é parametrizável por flag (só `--apply` e `--no-alert` existem). Para o L1, o veículo é o procedimento do `RESTORE.md`; esta spec adiciona um script novo e explícito (RF-8) em vez de forçar o `restore_island.sh` a fazer o que ele não faz.

---

## Requisitos Funcionais

**RF-1 — `cron/jobs.json` versionado cru.**
`snapshot.sh` copia `$HERMES_HOME/cron/jobs.json` para `cron/jobs.json` no repo, **sem redação** (verificado: os 11 jobs não contêm token, segredo, webhook nem literal ≥40 chars; as únicas chaves com nome sensível são `base_url`/`monitor_url`, que são `None`) . Testável: `git show HEAD:cron/jobs.json | python3 -m json.tool >/dev/null` sai 0 e `git show HEAD:cron/jobs.json | grep -c 'jobs'` ≥ 1.

**RF-2 — `jobs.json` versionado em forma estável, para o diff diário ser legível.**
O arquivo é reescrito pelo agendador a cada execução, mudando `updated_at`, `last_run_at`, `next_run_at`, `last_status`, `last_dispatch`, `failure_streak`. A cópia no repo deve ser **canônica**: chaves ordenadas (`sort_keys=True`), indentação fixa de 2 espaços, `ensure_ascii=False`, terminada por newline. Os campos voláteis **permanecem** no arquivo (eles são a lista viva, e a spec opta por fidelidade a um arquivo que só um `hermes cron` restaura). Testável: rodar a canonicalização duas vezes sobre o mesmo conteúdo produz bytes idênticos, e `git diff` de um dia sem mudança de agendamento mostra apenas as linhas de timestamp.

**RF-3 — `workout/reports/snapshots/` sobe inteira.**
Todos os 24 arquivos, em `workout/reports/snapshots/`, sem filtro de extensão e **sem `-maxdepth`**. Testável: `find workout/reports/snapshots -type f | wc -l` no repo é igual ao do Hermes (24), e a soma dos tamanhos bate byte a byte.

**RF-4 — `mnemosyne/` sobe como banco + config, sem o modelo.**
`mnemosyne/data/*.db` (via RF-4b) e `mnemosyne/config.yaml`. O `.gguf` **não** sobe. Testável: o repo contém `mnemosyne/data/mnemosyne.db` e `mnemosyne/config.yaml`; `find . -name '*.gguf'` no repo devolve vazio.

**RF-4b — Bancos são copiados com `sqlite3 .backup`, e o `-wal`/`-shm` nunca é copiado.**
Para cada banco sobe exatamente um arquivo, íntegro, sem `-wal`/`-shm` ao lado. Testável: `find . -name '*.db-wal' -o -name '*.db-shm'` no repo devolve vazio, e `python3 -c "import sqlite3;sqlite3.connect('mnemosyne/data/mnemosyne.db').execute('pragma integrity_check').fetchone()"` devolve `('ok',)`.

**RF-5 — Todo segredo é redigido na cópia; nenhum valor real entra no repo.**
Aplica-se a: `config/.env` (`sed` de `=` para `***`, como hoje), `profiles/treinador/.env` (idem, 25 chaves), `profiles/treinador/auth.json`, `profiles/treinador/config.yaml`, `opengym-keys/vapid.json`, `opengym-keys/og.crt` (o certificado é público e **entra integral**), `opengym-keys/hosts.yml` (redigido) e o manifesto `opengym-keys/REFAZER.md`. Testável: a linha de aceite 5 roda um grep de padrões de segredo no repo inteiro e não encontra nenhum.

**RF-6 — A redação de JSON e YAML é estrutural, não por regex de `=` .**
Implementada em `python3` dentro do `snapshot.sh`: percorre o objeto e troca **valores de chaves cujo nome casa** `token|secret|key|pass|cred|api_key|oauth` por `***REDACTED***`, preservando a estrutura e as demais chaves. Testável: o arquivo redigido continua sendo JSON parseável (`json.load` sai 0) e a chave existe com o valor redigido.

**RF-7 — O `snapshot.sh` reporta ANTES→DEPOIS por bloco e um resumo final.**
Cada bloco imprime `✓ <nome> (antes: N/MB → depois: N/MB)`. No fim, uma tabela e a contagem de arquivos novos/alterados/removidos que o `git add -A` vai commitar. Testável: a saída contém a linha de resumo e um `git diff --cached --stat` coerente com ela.

**RF-8 — Script de restore do L1, explícito e destrutivo-por-padrão-não.**
Novo `scripts/restore_from_l1.sh` no repo, que restaura o conteúdo do L1 num destino parametrizável (`--target`, default `$HERMES_HOME`), em modo **dry-run por padrão**, exigindo `--apply` para escrever, e fazendo backup do destino antes. Ele **não** toca em arquivo redigido (`***` fica como está) e **não** inventa segredo. Testável: rodar sem `--apply` não escreve nada (mtime do destino inalterado) e imprime o plano.

**RF-9 — O `snapshot.sh` não regrava `state.db.gz` quando ele não mudou de forma relevante.**
O arquivo continua sendo produzido, mas o `git add` do `sessions/` só ocorre se o tamanho variar mais de 5% em relação ao commitado, ou se o arquivo não existir no repo. Justificativa e risco em **R-1**. Testável: dois snapshots consecutivos sem tráfego novo não geram commit de `sessions/state.db.gz`.

**RF-10 — O `snapshot.sh` termina com um `git gc --auto` e o repo tem `.gitignore`.**
`.gitignore` com as exclusões de D-7; `git gc --auto` ao fim (barato quando não há nada a fazer). Testável: `.gitignore` existe e `git check-ignore -v mnemosyne/models/x.gguf` casa uma regra.

**RF-11 — O `RESTORE.md` consolida o veredito de cada item.**
Seção nova "BACKLOG-13 — cobertura: o que volta e o que se refaz", com uma linha por item, coluna `Volta pelo L1?`, coluna `Como refazer` (comando literal) e a etiqueta `recuperável` / `recriável` / `perda real`. Cobre, no mínimo, os 12 itens do BACKLOG-13. Testável: os 12 nomes aparecem na seção.

**RF-12 — O `RESTORE.md` marca explicitamente as perdas reais.**
Etiqueta `perda real` só para o que não tem comando de recomposição **e** cuja cópia única está no disco que morre. Hoje: `og.key`/`og.crt` (o par RSA não é reemitido por comando — o cert é autoassinado e o CA é o próprio), `data/secret` e `vapid.json` (se não versionados). Testável: cada etiqueta `perda real` tem uma linha correspondente em Riscos.

**RF-13 — O restore dos jobs é verificável sem recriar nada à mão.**
O `RESTORE.md` documenta `hermes cron` e o caminho de cópia do `cron/jobs.json` restaurado. Testável: o procedimento termina com `hermes cron list` mostrando 11 jobs e 8 ativos.

---

## Detalhe de Implementação

Tudo abaixo é `snapshot.sh` (`/home/pi/.hermes/scripts/snapshot.sh`) e o repo `/home/pi/hermes-snapshot`. O script tem `set -euo pipefail` — **cada bloco novo precisa do seu próprio `|| true`/guard**, senão o primeiro caminho ausente mata o snapshot inteiro e o `snapshot_last_ok` deixa de ser carimbado (é o sensor do alarme). Isso é o erro mais fácil de cometer aqui.

### 1. Novo: `.gitignore` do repo

**ANTES:** não existe `.gitignore` em `/home/pi/hermes-snapshot` (verificado: `cat .gitignore` → não tem).

**DEPOIS** — criar `/home/pi/hermes-snapshot/.gitignore`:

```gitignore
# BACKLOG-13 / D-7 — bombas conhecidas que NAO devem entrar no L1.
# O snapshot.sh monta a arvore por copia explicita; isto e a rede de seguranca
# para o caso de alguem copiar uma pasta inteira por engano.

# Modelo de embedding (657 MB) — rebaixavel, nunca versionar
*.gguf
mnemosyne/models/

# Cache regeneravel do perfil paralelo (994 MB)
**/cache/fastembed/
**/bin/tirith

# Segredos de VALOR REAL: se aparecerem, e bug de redacao, nao conteudo
**/.env.real
**/og.key
**/data/secret
**/data/agent.key

# Ruido de copia
*.tmp
*~
.DS_Store
*.db-wal
*.db-shm
```

### 2. Novo bloco: `cron/jobs.json` (RF-1, RF-2)

**ANTES** — em `snapshot.sh`, depois do bloco `# 6. Scripts locais`, não há nada sobre `cron/`.

**DEPOIS** — inserir entre o bloco 7 (plugins) e o bloco 8 (opengym-data):

```bash
# 7b. Agendamento do agente (BACKLOG-13 / RF-1, RF-2)
#     jobs.json NAO tem segredo (verificado: zero literais >=40 chars; base_url e
#     monitor_url sao None). Sobe CRU, mas canonicalizado: o agendador reescreve o
#     arquivo a cada execucao e o diff diario ficaria ilegivel sem ordenacao fixa.
mkdir -p cron
if [ -f "$HERMES_HOME/cron/jobs.json" ]; then
    before_cron=$(find cron -type f 2>/dev/null | wc -l)
    python3 - "$HERMES_HOME/cron/jobs.json" cron/jobs.json <<'PYEOF' || echo "⚠ cron/jobs.json: canonicalizacao falhou"
import json, sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding='utf-8-sig') as f:
    d = json.load(f)
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, sort_keys=True, indent=2)
    f.write('\n')
PYEOF
    echo "  ✓ cron/jobs.json ($(python3 -c "import json;print(len(json.load(open('cron/jobs.json'))['jobs']))" 2>/dev/null || echo '?') jobs; antes: $before_cron arquivos)"
else
    echo "  ⚠ cron/jobs.json nao encontrado em $HERMES_HOME/cron/ — agendamento NAO versionado"
fi
```

Nota do `utf-8-sig`: o arquivo pode ter BOM (há teste dedicado a isso no Hermes, `test_jobs_json_utf8_bom.py`), e `json.load` com BOM cru estoura. A leitura com `utf-8-sig` e a escrita sem BOM tornam a cópia estável.

### 3. Novo bloco: `workout/reports/snapshots/` (RF-3)

**ANTES** — no bloco 9 atual:

```bash
    find "$HERMES_HOME/workout/reports" -maxdepth 1 -type f \( -name "*.md" -o -name "*.txt" \) -exec cp {} workout/reports/ \; 2>/dev/null || true
```

**DEPOIS** — acrescentar logo após a linha acima, dentro do mesmo bloco 9:

```bash
    # BACKLOG-13 / RF-3: snapshots do escritor. O -maxdepth 1 acima deixava os 24
    # arquivos de fora. Sao a "fonte do desfazer" (opengym_writer.py:1036) e a unica
    # copia. 6,6 MB contra um .git de 1,36 GB: cabe.
    mkdir -p workout/reports/snapshots
    find "$HERMES_HOME/workout/reports/snapshots" -maxdepth 1 -type f -name "*.json" \
        -exec cp {} workout/reports/snapshots/ \; 2>/dev/null || true
    echo "  ✓ workout/reports/snapshots/ ($(find workout/reports/snapshots -type f | wc -l) arquivos, $(du -sh workout/reports/snapshots 2>/dev/null | cut -f1))"
```

Sem `rm -rf` prévio da pasta: o `find ... -exec cp` sobrescreve e o `git add -A` remove o que sumiu. (Se preferir telegraphar remoção, `rm -rf workout/reports/snapshots` antes, como o bloco já faz com `workout/` inteiro.)

### 4. Novo bloco: bancos locais (RF-4, RF-4b, D-4)

**ANTES** — não há bloco para `mnemosyne`, `kanban.db` nem `projects.db`.

**DEPOIS** — inserir depois do bloco 7b:

```bash
# 7c. Bancos locais (BACKLOG-13 / RF-4, RF-4b, D-4)
#     SQLite nunca se copia a quente com cp: o mnemosyne.db tem 4,3 MB de WAL FORA
#     do .db agora. `.backup` produz um arquivo unico e integro.
#     O modelo .gguf (657 MB) NAO sobe: e rebaixavel (D-1).
if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "  ⚠ sqlite3 AUSENTE — bancos NAO versionados (instale: sudo apt install sqlite3)"
else
    mkdir -p mnemosyne/data kanban projects
    # mnemosyne: banco + config, sem o modelo
    if [ -f "$HERMES_HOME/mnemosyne/data/mnemosyne.db" ]; then
        sqlite3 "$HERMES_HOME/mnemosyne/data/mnemosyne.db" \
            ".backup 'mnemosyne/data/mnemosyne.db'" 2>/dev/null \
            && echo "  ✓ mnemosyne/data/mnemosyne.db ($(du -h mnemosyne/data/mnemosyne.db | cut -f1))" \
            || echo "  ⚠ mnemosyne.db: backup falhou"
    fi
    [ -f "$HERMES_HOME/mnemosyne/config.yaml" ] && cp "$HERMES_HOME/mnemosyne/config.yaml" mnemosyne/
    # kanban.db e projects.db
    for db in kanban projects; do
        if [ -f "$HERMES_HOME/$db.db" ]; then
            sqlite3 "$HERMES_HOME/$db.db" ".backup '$db/$db.db'" 2>/dev/null \
                && echo "  ✓ $db/$db.db ($(du -h $db/$db.db | cut -f1))" \
                || echo "  ⚠ $db.db: backup falhou"
        fi
    done
    echo "  ✓ bancos (antes: $(git show HEAD:mnemosyne/data/mnemosyne.db 2>/dev/null | wc -c || echo 0) bytes -> depois: $(find mnemosyne kanban projects -type f -exec cat {} + 2>/dev/null | wc -c) bytes)"
fi
```

### 5. Novo bloco: `profiles/treinador` — o essencial, redigido (RF-5, RF-6)

**ANTES** — não há bloco para `profiles/`. O `snapshot.sh` nunca tocou em `profiles/`.

**DEPOIS** — inserir depois do bloco 7c:

```bash
# 7d. Perfil paralelo 'treinador' (BACKLOG-13 / RF-5, RF-6, D-1)
#     1,1 GB dos quais 994 MB sao cache/fastembed (regeneravel) e 33 MB sao o binario
#     tirith. O ESSENCIAL e ~25 MB (skills 20 MB + state.db 524 KB + configs).
#     Segredos vao REDIGIDOS: .env (25 chaves), auth.json, config.yaml.
TR="$HERMES_HOME/profiles/treinador"
if [ -d "$TR" ]; then
    mkdir -p profiles/treinador/{skills,memories,assets,cron,mnemosyne/data,home,workspace}
    # --- arquivos de texto, sem segredo ---
    for f in SOUL.md profile.yaml; do
        [ -f "$TR/$f" ] && cp "$TR/$f" "profiles/treinador/$f"
    done
    # --- skills (684 arquivos, ~20 MB) — o que existe SO na ilha ---
    [ -d "$TR/skills" ] && cp -r "$TR/skills"/. profiles/treinador/skills/ 2>/dev/null || true
    [ -d "$TR/memories" ] && cp -r "$TR/memories"/. profiles/treinador/memories/ 2>/dev/null || true
    [ -d "$TR/assets" ]   && cp -r "$TR/assets"/.   profiles/treinador/assets/   2>/dev/null || true
    # --- bancos ---
    command -v sqlite3 >/dev/null 2>&1 && {
        [ -f "$TR/state.db" ]    && sqlite3 "$TR/state.db"    ".backup 'profiles/treinador/state.db'"    2>/dev/null || true
        [ -f "$TR/projects.db" ] && sqlite3 "$TR/projects.db" ".backup 'profiles/treinador/projects.db'" 2>/dev/null || true
        [ -f "$TR/mnemosyne/data/mnemosyne.db" ] && \
            sqlite3 "$TR/mnemosyne/data/mnemosyne.db" ".backup 'profiles/treinador/mnemosyne/data/mnemosyne.db'" 2>/dev/null || true
    }
    [ -f "$TR/mnemosyne/config.yaml" ] && cp "$TR/mnemosyne/config.yaml" profiles/treinador/mnemosyne/
    # --- cron/ do perfil (executions.db e agenda propria, se houver) ---
    [ -f "$TR/cron/jobs.json" ] && cp "$TR/cron/jobs.json" profiles/treinador/cron/ 2>/dev/null || true

    # --- SEGREDOS: redigidos, NUNCA o valor real (D-2, D-3) ---
    # .env: todas as linhas CHAVE=VALOR viram CHAVE=*** (mesmo idioma do .env da raiz)
    [ -f "$TR/.env" ] && sed 's/=.*/=***/' "$TR/.env" > profiles/treinador/.env.redacted \
        && echo "  ✓ treinador/.env.redacted ($(grep -c '=' profiles/treinador/.env.redacted) chaves, valores=***)"
    # auth.json: redacao ESTRUTURAL (sed de '=' quebraria o JSON)
    [ -f "$TR/auth.json" ] && python3 - "$TR/auth.json" profiles/treinador/auth.json.redacted <<'PYEOF' || echo "  ⚠ treinador/auth.json: redacao falhou"
import json, sys, re
src, dst = sys.argv[1], sys.argv[2]
SENS = re.compile(r'(token|secret|key|pass|cred|oauth|refresh|access)', re.I)
def scrub(o):
    if isinstance(o, dict):
        return {k: ('***REDACTED***' if SENS.search(k) and not isinstance(v,(dict,list)) else scrub(v))
                for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(v) for v in o]
    return o
with open(src, encoding='utf-8') as f:
    d = json.load(f)
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(scrub(d), f, ensure_ascii=False, sort_keys=True, indent=2)
    f.write('\n')
PYEOF
    # config.yaml do perfil: mesma redacao estrutural (contem password_hash/client_secret)
    [ -f "$TR/config.yaml" ] && sed -E 's/^([[:space:]]*[A-Za-z_]*(password|secret|token|key|pass)[A-Za-z_]*[[:space:]]*:).*/\1 ***REDACTED***/I' \
        "$TR/config.yaml" > profiles/treinador/config.yaml.redacted
    echo "  ✓ profiles/treinador (essencial versionado; cache/fastembed e bin/tirith FORA)"
else
    echo "  ⚠ profiles/treinador ausente — nada a versionar"
fi
```

### 6. Novo bloco: chaves do openGym (RF-5, RF-12)

**ANTES** — não existe. O `snapshot.sh` só conhece `/mnt/drivebackup/apps/openGym/data/state-*.json` (bloco 8).

**DEPOIS** — inserir depois do bloco 7d:

```bash
# 7e. Chaves do openGym (BACKLOG-13 / RF-5, RF-12)
#     og.key e a PRIVADA do par RSA (2048) que serve TLS em pi.tail61c2f4.ts.net.
#     data/secret assina as sessoes; agent.key e DERIVADO dele por HMAC (regeneravel);
#     vapid.json e o par de push. NADA de valor real sobe.
OG_APP="/mnt/drivebackup/apps/openGym/openGym"
OG_DATA="/mnt/drivebackup/apps/openGym/data"
mkdir -p opengym-keys
# og.crt e PUBLICO (certificado autoassinado) -> sobe INTEGRAL, e o que permite
# detectar a perda do og.key: se o key novo nao casar o modulus, o restore avisa.
[ -f "$OG_APP/og.crt" ] && cp "$OG_APP/og.crt" opengym-keys/og.crt && echo "  ✓ opengym-keys/og.crt (publico, integral)"
if [ -f "$OG_APP/og.key" ]; then
    printf '%s\n' "***REDACTED — chave privada RSA 2048. NAO versionada.***" \
                  "Refazer: openssl req -x509 -newkey rsa:2048 -nodes -keyout og.key -out og.crt -days 3650 \\" \
                  "           -subj '/CN=pi.tail61c2f4.ts.net' -addext 'subjectAltName=DNS:pi.tail61c2f4.ts.net,IP:192.168.50.40,IP:100.70.29.33'" \
                  "Depois: docker compose restart web" > opengym-keys/og.key.REFAZER
    echo "  ✓ opengym-keys/og.key.REFAZER (valor real NUNCA versionado)"
fi
# vapid.json: redigido (a chave privada de push nao volta sozinha)
if sudo -n test -r "$OG_DATA/vapid.json" 2>/dev/null || [ -r "$OG_DATA/vapid.json" ]; then
    python3 - "$OG_DATA/vapid.json" opengym-keys/vapid.json.redacted <<'PYEOF' || echo "  ⚠ vapid.json: redacao falhou"
import json, sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding='utf-8') as f: d = json.load(f)
for k in ('privateKey',):
    if k in d: d[k] = '***REDACTED***'
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, sort_keys=True, indent=2); f.write('\n')
PYEOF
    echo "  ✓ opengym-keys/vapid.json.redacted (publicKey integral, privateKey=***)"
fi
# audit.jsonl: a PROVA DE AUDITORIA (82 linhas, 45 KB, sem segredo nem IP).
# E a unica copia. 45 KB: cabe.
if sudo -n test -r "$OG_DATA/audit.jsonl" 2>/dev/null; then
    sudo -n cp "$OG_DATA/audit.jsonl" opengym-keys/audit.jsonl 2>/dev/null \
        && sudo -n chown pi:pi opengym-keys/audit.jsonl 2>/dev/null || true
    echo "  ✓ opengym-keys/audit.jsonl ($(wc -l < opengym-keys/audit.jsonl 2>/dev/null || echo 0) linhas)"
fi
# data/secret vira manifesto (agent.key e DERIVADO dele: regenera sozinho)
[ -r "$OG_DATA/secret" ] && printf '%s\n' "***REDACTED***" > opengym-keys/secret.REFAZER
```

`og.key` e `data/audit.jsonl` são `-rw------- root:root` (medido). Por isso o `sudo -n` (não-interativo). **O `sudo -n` falha em silêncio se exigir senha** — o bloco 7e não pode derrubar o snapshot; cada linha tem `|| true` ou guard.

### 7. Credencial do `gh` — o que fazer (RF-5, RF-11)

**Decisão: NÃO versionar; documentar reautenticação.** Medido: o token é um **fine-grained PAT** (prefixo `github_pat_`, 93 chars, conta `emersondsc`), não um OAuth token de escopo amplo. Um PAT fine-grained é reemitido pela interface do GitHub em minutos, e o custo de vazá-lo (acesso de escrita a repos selecionados, incluindo o próprio repo de backup) é maior que o de refazer. **Não** se versiona nem redigido — só o manifesto, porque um `hosts.yml` redigido não restaura nada e só polui.

**DEPOIS** — no `RESTORE.md` (RF-11), seção nova:

```markdown
| `/home/pi/.config/gh/hosts.yml` | ❌ Não | **`gh auth login`** | **recuperável** |
```

### 8. `state.db.gz` — parar de regravar 78 MB por dia (RF-9, D-8)

**ANTES:**

```bash
# 3. Sessions DB
mkdir -p sessions
if [ -f "$HERMES_HOME/state.db" ]; then
    cp "$HERMES_HOME/state.db" sessions/
    # Compact backup
    gzip -f sessions/state.db.gz
    echo "  ✓ sessions/state.db.gz"
fi
```

**DEPOIS:**

```bash
# 3. Sessions DB (RF-9 / D-8)
#    state.db.gz tem ~78 MB e era regravado em TODOS os commits (58 versoes no
#    historico, 1,36 GiB de objetos soltos, zero packs). O historico de sessoes
#    quase nao muda de um dia para o outro: sobe so quando muda de verdade.
mkdir -p sessions
if [ -f "$HERMES_HOME/state.db" ]; then
    cp "$HERMES_HOME/state.db" /tmp/state.db.snapshot.$$
    gzip -f /tmp/state.db.snapshot.$$
    NEW=$(stat -c%s /tmp/state.db.snapshot.$$.gz)
    OLD=0
    [ -f sessions/state.db.gz ] && OLD=$(stat -c%s sessions/state.db.gz)
    # margem de 5%: abaixo disso e ruido de escrita normal do banco
    if [ "$OLD" -eq 0 ] || [ "$OLD" -lt $((NEW * 95 / 100)) ] || [ "$OLD" -gt $((NEW * 105 / 100)) ]; then
        mv /tmp/state.db.snapshot.$$.gz sessions/state.db.gz
        echo "  ✓ sessions/state.db.gz ($((OLD/1048576)) MB -> $((NEW/1048576)) MB, variacao > 5%, versionado)"
    else
        rm -f /tmp/state.db.snapshot.$$.gz
        echo "  ↷ sessions/state.db.gz inalterado ($((NEW/1048576)) MB, variacao < 5% — nao recommitado)"
    fi
fi
```

**Uma vez, manual, no repo** (não no snapshot; documentar em `RESTORE.md`):
```bash
cd /home/pi/hermes-snapshot && git gc --aggressive --prune=now
```
Isso deve levar os 1,36 GiB de objetos soltos para um pack. **Atenção:** o `gc --aggressive` reescreve o pack local; o `push` seguinte reenvia os objetos que o remoto ainda tem, e o histórico de 64 commits × 78 MB **permanece no GitHub** (não há `filter-repo` no escopo). O ganho é local (disco do Pi) e futuro (crescimento).

### 9. Fim do script (RF-7, RF-10)

**ANTES** — o fecho atual:

```bash
git add -A
if git diff --cached --quiet; then
    echo "✨ Sem alterações — snapshot já atualizado."
else
    git commit -m "📸 Snapshot $DATE"
    git push origin "$BRANCH" 2>&1 | tail -1
    echo "✅ Snapshot enviado para GitHub!"
fi
```

**DEPOIS:**

```bash
git add -A
# Resumo ANTES->DEPOIS (RF-7): o modo de falha desta familia e o SILENCIO (o
# -maxdepth 1 escondeu 24 arquivos por meses). Um bloco que nao muda fica visivel.
echo "── Resumo do commit ──"
git diff --cached --stat | tail -20
if git diff --cached --quiet; then
    echo "✨ Sem alterações — snapshot já atualizado."
else
    git commit -m "📸 Snapshot $DATE"
    git push origin "$BRANCH" 2>&1 | tail -1
    echo "✅ Snapshot enviado para GitHub!"
fi
git gc --auto 2>/dev/null || true
```

### 10. Novo arquivo: `scripts/restore_from_l1.sh` (RF-8)

Criar em `/home/pi/hermes-snapshot/scripts/restore_from_l1.sh` (LF, `chmod +x`):

```bash
#!/usr/bin/env bash
# restore_from_l1.sh — restaura o L1 (este repo) num $HERMES_HOME.
# Complementa restore_island.sh: aquele le o HD (L0); este le o GitHub (L1).
# DEFAULT: dry-run. Escreva so com --apply.
# Uso: restore_from_l1.sh [--target DIR] [--apply]
set -uo pipefail
export TZ="America/Sao_Paulo"

SRC="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${HERMES_HOME:-/home/pi/.hermes}"
APPLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --apply)  APPLY=1; shift ;;
    *) echo "uso: $0 [--target DIR] [--apply]"; exit 2 ;;
  esac
done

echo "Origem : $SRC"
echo "Destino: $TARGET"
echo "Modo   : $([ -n "$APPLY" ] && echo APLICAR || echo DRY-RUN)"
echo
echo "── O que este script NAO faz (leia RESTORE.md) ──"
echo "  • arquivos .redacted / .REFAZER tem *** — segredo NAO volta por aqui"
echo "  • hermes-agent/ vem de 'hermes update'"
echo "  • o par og.key/og.crt NAO esta aqui (ver opengym-keys/REFAZER.md)"
echo

restore() {  # restore <caminho-no-repo> <caminho-no-destino>
  local rel="$1" dst="$TARGET/$2"
  [ -e "$SRC/$rel" ] || { echo "  ↷ ausente no L1: $rel"; return 0; }
  if [ -n "$APPLY" ]; then
    mkdir -p "$(dirname "$dst")"
    cp -r "$SRC/$rel" "$dst" && echo "  ✓ $rel -> $dst"
  else
    echo "  · copiaria $rel -> $dst"
  fi
}

if [ -n "$APPLY" ] && [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  echo "ATENCAO: $TARGET existe. Backup em ${TARGET}.pre-l1.$(date +%s)"
  mv "$TARGET" "${TARGET}.pre-l1.$(date +%s)"
fi

restore config/config.yaml        config.yaml
restore config/.env               .env
restore cron/jobs.json            cron/jobs.json
restore mnemosyne/data/mnemosyne.db mnemosyne/data/mnemosyne.db
restore mnemosyne/config.yaml     mnemosyne/config.yaml
restore kanban/kanban.db          kanban.db
restore projects/projects.db      projects.db
restore profiles/treinador        profiles/treinador
restore sessions/state.db.gz      sessions/state.db.gz
restore opengym-data              opengym-data
restore workout                   workout
restore skills                    skills
restore memories                  memories
restore scripts                   scripts

[ -n "$APPLY" ] || { echo; echo "(dry-run) rode com --apply para aplicar."; }
```

### 11. `RESTORE.md` — seção nova (RF-11, RF-12)

Inserir depois da seção "B.2 — O que NÃO está neste repo":

```markdown
## 📋 BACKLOG-13 — cobertura: o que volta pelo L1 e o que se refaz

> Levantado em 12/09/2026. `recuperável` = existe comando que refaz.
> `recriável` = o comando existe mas o conteúdo se perde. `perda real` = única cópia
> no disco que morre, sem comando que recomponha.

| Item | Volta pelo L1? | Como refazer | Classe |
|---|---|---|---|
| `cron/jobs.json` (11 jobs, 8 ativos) | ✅ **Sim** (12/09) | `cp cron/jobs.json ~/.hermes/cron/` | — |
| `workout/reports/snapshots/` (24 arq.) | ✅ **Sim** (12/09) | `cp -r workout/reports/snapshots ~/.hermes/workout/reports/` | — |
| `mnemosyne/` banco + config | ✅ **Sim** (12/09) | `cp -r mnemosyne ~/.hermes/` | — |
| `kanban.db` / `projects.db` | ✅ **Sim** (12/09) | `cp kanban/kanban.db projects/projects.db ~/.hermes/` | — |
| `profiles/treinador` (essencial) | ✅ **Sim** (12/09) | `cp -r profiles/treinador ~/.hermes/profiles/` | — |
| `mnemosyne/models/*.gguf` (657 MB) | ❌ Não | **rebaixar**: `huggingface-cli download` / reindexar | recuperável |
| `profiles/treinador/cache/fastembed` (994 MB) | ❌ Não | regenera na 1ª execução do perfil | recuperável |
| `profiles/treinador/bin/tirith` (33 MB) | ❌ Não | reinstalar o binário | recuperável |
| `/home/pi/.config/gh/hosts.yml` | ❌ Não | **`gh auth login`** (PAT fine-grained) | recuperável |
| `og.key` | ❌ Não (só manifesto) | `openssl req -x509 ...` — ver `opengym-keys/og.key.REFAZER` | **perda real** |
| `og.crt` | ✅ **Sim** (público) | já sobe íntegro | — |
| `data/agent.key` | ❌ Não | **derivado** de `data/secret` por HMAC — regenera sozinho | recuperável |
| `data/audit.jsonl` (82 linhas) | ✅ **Sim** (12/09) | `cp opengym-keys/audit.jsonl /mnt/drivebackup/apps/openGym/data/` | — |
| `data/vapid.json` | ⚠️ redigido | regerar par de push | **perda real** (privateKey) |
| `data/secret` | ❌ Não (só manifesto) | `data/agent.key` regenera; sessões caem | **perda real** |
| `hermes-agent/` + venv | ❌ Não | `hermes update` | recuperável |
| `ms-playwright` | ❌ Não | reinstala com o `hermes` (baixa) | recuperável |
```

---

## Critérios de aceite

Executáveis na ordem. **MENSAGEM** marca o que envia mensagem real (Telegram).

1. **(não destrutivo)** `cd /home/pi/hermes-snapshot && git show HEAD:cron/jobs.json | python3 -m json.tool >/dev/null` sai **0**, e `git show HEAD:cron/jobs.json | python3 -c "import json,sys;print(len(json.load(sys.stdin)['jobs']))"` imprime **11**.
2. **(não destrutivo)** `md5sum` agregado de `workout/reports/snapshots/` no repo é idêntico ao de `~/.hermes/workout/reports/snapshots/`, e `find` conta **24** arquivos nos dois lados.
3. **(não destrutivo)** No repo, `find . -name '*.gguf'` devolve **vazio** e `find . -name '*.db-wal' -o -name '*.db-shm'` devolve **vazio**.
4. **(não destrutivo)** `python3 -c "import sqlite3;c=sqlite3.connect('mnemosyne/data/mnemosyne.db');print(c.execute('pragma integrity_check').fetchone()[0])"` imprime **`ok`**; o mesmo para `kanban/kanban.db` e `profiles/treinador/state.db`.
5. **(não destrutivo)** Varredura de segredo no repo **inteiro** não acha valor real:
   `grep -rInE 'gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}|BEGIN (RSA )?PRIVATE KEY' . --exclude-dir=.git` → **sem saída**.
6. **(não destrutivo)** `python3 -c "import json;json.load(open('profiles/treinador/auth.json.redacted'))"` sai **0** (a redação não quebrou o JSON) e o valor de um campo sensível é `***REDACTED***`.
7. **(não destrutivo)** `.gitignore` existe e `git check-ignore -v mnemosyne/models/x.gguf` casa uma regra.
8. **(não destrutivo)** `bash scripts/restore_from_l1.sh` (sem `--apply`) **não** altera o mtime de `$TARGET` e imprime as linhas `· copiaria ...`; com `--target /tmp/l1-teste --apply` popula `/tmp/l1-teste` e **não** escreve fora dele.
9. **(não destrutivo)** Dois snapshots consecutivos sem tráfego novo: o segundo **não** commita `sessions/state.db.gz` e imprime `↷ ... variacao < 5%`.
10. **(MENSAGEM)** Um snapshot completo (`bash ~/.hermes/scripts/snapshot.sh`) termina com `✅ Snapshot enviado para GitHub!`, carimba `~/.hermes/snapshot_last_ok` com o horário atual, e **não** dispara alerta do `island_healthcheck.sh` (o sensor só fala acima de 26h — o aceite é o **silêncio**).
11. **(MENSAGEM)** Forçar a falha: apontar `HERMES_HOME` para um diretório vazio e rodar o `snapshot.sh` deixa os blocos novos imprimindo `⚠` em vez de abortar, e o script **ainda chega ao fim** (o `set -euo pipefail` não pode transformar um bloco novo em morte silenciosa do snapshot).
12. **(não destrutivo)** O `RESTORE.md` contém uma seção `BACKLOG-13` com os **12** nomes de item do backlog, e toda linha marcada `perda real` tem um `Como refazer` não-vazio.
13. **(não destrutivo)** `git count-objects -v` depois do `gc`: `in-pack` > 0 e `size` (soltos) muito abaixo de 1,36 GiB.

---

## Riscos e rollback

**R-1 — `state.db.gz` fora do commit diário pode perder sessões.** *Alto impacto, baixa probabilidade.* Se o disco morrer entre duas variações >5%, o histórico de conversas volta à versão anterior. **Mitigação:** o arquivo continua sendo produzido e o L0 (a cada 6h) tem a versão fresca; a margem de 5% é folgada para um banco que cresce ~2 MB/dia. **Se o usuário preferir fidelidade total, RF-9 se desliga removendo o guard e o custo volta a 78 MB/commit.**

**R-2 — `sqlite3` NÃO está instalado.** Verificado: `command -v sqlite3` falha na máquina. **Sem ele, os blocos 7c e 7d não versionam banco nenhum** e o aceite 4 não roda. **Ação obrigatória antes de aplicar:** `sudo apt install sqlite3`. O script falha **alto e visível** (`⚠ sqlite3 AUSENTE`) em vez de copiar torto — é o comportamento desejado.

**R-3 — `sudo -n` falha em silêncio.** `og.key` e `audit.jsonl` são `root:root` 600. Se o `sudo` pedir senha (não-interativo), o bloco simplesmente não copia. **Mitigação:** cada linha tem guard, e o aceite 12 no `RESTORE.md` registra o item como `perda real` caso não suba. Alternativa: `sudo` no `cron.d` já é NOPASSWD, mas o `snapshot.sh` roda como `pi` via cron — o `-n` funciona nesse contexto.

**R-4 — Segredo vazar por arquivo não previsto.** *Alto impacto, baixa probabilidade.* `profiles/treinador/.env` sobe **redigido**, mas um arquivo novo (ex.: `google_token.json`) pode escapar. **Mitigação:** o `.gitignore` (D-7) barra os nomes conhecidos e o aceite 5 é uma varredura de padrão no repo inteiro. Se algum dia falhar: `git filter-repo` **não** está no escopo; a remediação é **revogar a credencial** e reemitir.

**R-5 — O `og.key` NUNCA esteve no L1, mas o certificado TLS depende dele.** Verificado: `og.key` e `og.crt` estão fora do git do openGym (`.gitignore` os cobre) e **não** aparecem no histórico de blobs (a busca por `c:og.key` em 200 commits voltou vazia; o `git log -- og.key` casou um commit `c42ba6b` "asd" por *rename detection*, não por conteúdo). A cópia no HD é única. **Mitigação:** o `og.crt` sobe íntegro — se o `og.key` for perdido, o `modulus` do novo par **não** casa o cert antigo e o restore detecta antes de servir TLS quebrado.

**R-6 — O `.git` de 1,36 GiB é pré-existente e limitado pelo disco.** `/` tem **201 GB livres** (12% usado) — não é emergência. O ganho do `gc` é higiene e crescimento futuro. **Não** se propõe reescrita de histórico (fora de escopo, destrutivo, e o repo é privado).

**R-7 — `set -euo pipefail` + bloco novo = snapshot que não carimba.** Se qualquer bloco novo falhar sem guard, o script aborta **antes** de `date > snapshot_last_ok`, e o alarme de 26h dispara (mensagem real no Telegram). **Mitigação:** todo bloco novo tem `|| true` ou `if`; o critério 11 testa exatamente isso.

**Rollback geral:** `git -C /home/pi/hermes-snapshot revert <commit>` desfaz o conteúdo do repo; o `snapshot.sh` original está em `~/.hermes/scripts/snapshot.sh` e a cópia boa anterior pode ser restaurada do L0 (`/mnt/drivebackup/HermesLocal/hermes-island/scripts/snapshot.sh`, que tem a versão de antes do rsync de 6h).

---

## Testes manuais

Rodar **depois** de `sudo apt install sqlite3` e **antes** do primeiro commit.

```bash
# T1 — sintaxe do script (nao executa)
bash -n /home/pi/.hermes/scripts/snapshot.sh && echo "T1 OK"

# T2 — dry-run do snapshot num HERMES_HOME de ensaio (NAO toca producao)
cp -a /home/pi/.hermes /tmp/hermes-teste 2>/dev/null
HERMES_HOME=/tmp/hermes-teste REPO_DIR=/tmp/l1-teste bash /home/pi/.hermes/scripts/snapshot.sh
ls -la /tmp/l1-teste/{cron,mnemosyne,kanban,projects,profiles/treinador,opengym-keys}

# T3 — os 24 snapshots chegaram inteiros?
find /tmp/l1-teste/workout/reports/snapshots -type f | wc -l   # espera 24

# T4 — bancos abrem?
for d in /tmp/l1-teste/mnemosyne/data/mnemosyne.db /tmp/l1-teste/kanban/kanban.db; do
  python3 -c "import sqlite3,sys;print(sys.argv[1], sqlite3.connect(sys.argv[1]).execute('pragma integrity_check').fetchone()[0])" "$d"
done

# T5 — nenhum segredo real no repo de ensaio
grep -rInE 'gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN (RSA )?PRIVATE KEY' \
  /tmp/l1-teste --exclude-dir=.git ; echo "T5: sem saida = OK"

# T6 — restore_from_l1 em dry-run nao escreve
touch /tmp/alvo-teste/.keep 2>/dev/null; mkdir -p /tmp/alvo-teste && touch /tmp/alvo-teste/.keep
before=$(stat -c%Y /tmp/alvo-teste/.keep)
bash /tmp/l1-teste/scripts/restore_from_l1.sh --target /tmp/alvo-teste
[ "$before" = "$(stat -c%Y /tmp/alvo-teste/.keep)" ] && echo "T6 OK (nao escreveu)"

# T7 — limpeza
rm -rf /tmp/hermes-teste /tmp/l1-teste /tmp/alvo-teste
```

**T8 (produção, com aviso):** rodar o `snapshot.sh` real uma vez e conferir `git log -1 --stat` — deve mostrar os blocos novos e carimbar `~/.hermes/snapshot_last_ok`. **Isto faz um `push` de verdade para o repo privado e pode mandar mensagem se o snapshot falhar.**

---

## Comportamento Visual/UX

O operador lê a saída do `snapshot.sh` no log do cron (`~/.hermes/logs/snapshot_cron.log`) ou no terminal. O que ele vê depois desta mudança:

```
📸 Hermes Snapshot — 2026-09-13_06-00-01
  ✓ .env
  ✓ config/ (.env com secrets redactados)
  ✓ skills/ (4127 arquivos)
  ✓ sessions/state.db.gz (74 MB -> 76 MB, variacao > 5%, versionado)
  ✓ system/info.txt
  ✓ memories/ (12 arquivos)
  ✓ scripts/ (78 arquivos)
  ✓ plugins/ (opencode-zen + opencode-go com patches locais)
  ✓ cron/jobs.json (11 jobs; antes: 0 arquivos)
  ✓ mnemosyne/data/mnemosyne.db (24M)
  ✓ kanban/kanban.db (120K)
  ✓ projects/projects.db (44K)
  ✓ bancos (antes: 0 bytes -> depois: 21 MB)
  ✓ treinador/.env.redacted (25 chaves, valores=***)
  ✓ profiles/treinador (essencial versionado; cache/fastembed e bin/tirith FORA)
  ✓ opengym-keys/og.crt (publico, integral)
  ✓ opengym-keys/og.key.REFAZER (valor real NUNCA versionado)
  ✓ opengym-keys/vapid.json.redacted (publicKey integral, privateKey=***)
  ✓ opengym-keys/audit.jsonl (82 linhas)
  ✓ opengym-data/ (5 arquivos: perfis + treinos do continente)
  ✓ workout/ (612 arquivos: mecanica, portoes, planos, recibos)
  ✓ workout/reports/snapshots/ (24 arquivos, 6.6M)
── Resumo do commit ──
 config/.env                     |   2 +-
 cron/jobs.json                  | 268 ++++++++++++++
 mnemosyne/data/mnemosyne.db     | Bin 0 -> 25104384 bytes
 opengym-keys/audit.jsonl        |  82 +++++
 workout/reports/snapshots/...   |  24 ++++++
 12 files changed, 412 insertions(+), 3 deletions(-)
✅ Snapshot enviado para GitHub!
```

Mensagens que **mudam de comportamento** e o operador precisa reconhecer:

- **`⚠ sqlite3 AUSENTE — bancos NAO versionados`** — o backup "passou" mas perdeu 5 itens da lista. É a mensagem mais importante: sem ela, o operador acha que está coberto. Ação: `sudo apt install sqlite3` e rodar de novo.
- **`↷ ... variacao < 5% — nao recommitado`** — normal e esperado. Não é erro; é a economia de 78 MB.
- **`⚠ cron/jobs.json nao encontrado`** — o agendamento ficou fora do L1. O operador precisa saber que a lista para recriar os jobs não voltou.
- **`⚠ treinador/auth.json: redacao falhou`** — o arquivo **não** subiu (falha fechada, o que é o comportamento correto): melhor não versionar que versionar token real.

**Se algo der errado (critério 11):** o operador vê os `⚠` e, no fim, `✅ Snapshot enviado` **ou** a ausência do carimbo. A ausência do carimbo é o sinal duro: `cat ~/.hermes/snapshot_last_ok` com data velha = o snapshot não completou. É isso que o alarme de 26h lê.
