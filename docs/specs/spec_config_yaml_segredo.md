# Spec: parar de versionar o segredo do config.yaml (BACKLOG-15) — v1

## Contexto e Objetivo

O `hermes-snapshot` é o **L1**: a única camada de backup que sobrevive à morte do disco do
Raspberry Pi. Ele roda por `snapshot.sh`, que copia partes de `~/.hermes` para
`/home/pi/hermes-snapshot` e faz push para o repositório **privado**
`emersondsc/hermes-snapshot`.

O `snapshot.sh` **redige** o `.env` antes de versioná-lo (linha 40, `sed -i 's/=.*/=***/'`),
mas copia o `config.yaml` **cru** (linha 37). O `config.yaml` contém dois valores sensíveis
que são copiados como estão para o repositório e para todo o seu histórico:

| Chave no `config.yaml` | O que protege | Tamanho | Localização no YAML |
|---|---|---|---|
| `password_hash` | A senha de entrada do **painel web do agente** (dashboard na porta 9119) | 86 caracteres | `dashboard.basic_auth.password_hash` |
| `client_secret` | A credencial da **integração de login externo via Auth0** | 64 caracteres | `webui_oidc.client_secret` |

Ambos estão **idênticos** no arquivo vivo (`/home/pi/.hermes/config.yaml`, 6702 bytes) e na
cópia do repositório (`config/config.yaml`, 6702 bytes) — conferido por `sha256` dos valores,
nunca por leitura direta. O arquivo é **byte a byte idêntico**.

**Objetivo:** fazer o `snapshot.sh` parar de versionar qualquer valor real de segredo; tornar
isso verificável por um teste que falha se um valor real voltar; documentar no `RESTORE.md`
como reconstruir o `config.yaml` no restore; e registrar o procedimento de rotação dos dois
valores, assumindo-os **comprometidos no histórico**.

**Onde vive:** host `hermes` (`pi@192.168.50.40`), arquivos `/home/pi/.hermes/scripts/snapshot.sh`
(e sua cópia versionada `/home/pi/hermes-snapshot/scripts/snapshot.sh`, que hoje é **idêntica**
ao vivo) e `/home/pi/hermes-snapshot/RESTORE.md`.

### Achados da investigação (base das decisões)

1. **`password_hash` — 12 commits com o valor vivo (30 no total incluindo clones/branches).**
   `git log --follow -- config/config.yaml` lista **17 commits** (26/07 → 12/09). Comparando o
   valor vivo com cada revisão por sha256: **12 dos 17** têm o hash **idêntico ao vivo**; os 5
   primeiros (26/07, 27/07, 10/08, 11/08, 13/08) têm valores **diferentes**, ou seja, senhas
   antigas já rotacionadas. Contando todos os objetos alcançáveis (`git log --all`), são **30
   commits** cujo `config.yaml` contém o hash real.
2. **`client_secret` — 12 commits.** A chave só passou a existir no `config.yaml` a partir de
   **29/08**; os 12 commits desde então trazem o valor **idêntico ao vivo**. O bloco é
   `webui_oidc` (Auth0, issuer `dev-*.us.auth0.com`, `redirect_uri` no host
   `hermes-webui.edsc.fun`). Não há valor diferente em nenhuma revisão: ele nunca foi rotacionado.
3. **O bloco `webui_oidc` não tem leitor no código.** A busca por `webui_oidc` em todo o
   `~/.hermes/hermes-agent` retorna **zero arquivos**. O agente lê o caminho canônico
   `dashboard.oauth.self_hosted.{issuer,client_id,scopes,client_secret}` (plugin
   `plugins/dashboard_auth/self_hosted/`), que **não existe** no config vivo (`dashboard` só tem
   `theme` e `basic_auth`). As variáveis `HERMES_DASHBOARD_OIDC_*` também estão ausentes do
   `.env`. O log do gateway mostra o provider ativo: `auth gate enabled. Providers: basic` —
   **só `basic`**, nunca o OIDC. Portanto o `client_secret` está **inerte**, ao lado de um
   caminho de configuração legado/órfão — mas o valor continua sendo um segredo real do Auth0 e
   continua versionado.
4. **`key_env` é um NOME, não um valor.** Em `auxiliary.vision.key_env` (20 caracteres, formato
   de nome POSIX em maiúsculas, sem prefixo de credencial conhecido); esse nome **existe como
   chave no `.env` vivo**. É um ponteiro para onde o segredo mora: versioná-lo não vaza nada.
   Fica na lista de permissão.
5. **O `.env` do repositório está limpo e a regra é idempotente.** O `.env` vivo tem 512 linhas;
   a regra `s/=.*/=***/` produz **214 linhas `=***`** e é **idempotente** (aplicar duas vezes =
   aplicar uma). O `.env` do repositório tem exatamente **214 linhas `=***`**, **0** linhas com
   valor não-`***`, e **nenhuma** linha acima de 104 caracteres. O histórico do `.env` nunca teve
   valor real (0 linhas longas em todos os commits amostrados).
6. **Se um campo chegar redigido no restore, o agente não "volta ao padrão" — ele some com o
   recurso, em silêncio.** O `password_hash` entra em `BasicAuthProvider.__init__`, que rejeita
   hash vazio (`ValueError: password_hash must be non-empty`); a string literal `***` **não** é
   vazia, então o provider **registra normalmente** e passa a **rejeitar todo login** (o scrypt
   falha e devolve `False`, sem erro visível). O `client_secret` só é lido pelo plugin
   `self_hosted`, que já não está ativo. **Consequência para o `RESTORE.md`: um `***` no
   `password_hash` restaurado deixa o painel inacessível com a senha correta**, sem mensagem
   que explique o motivo. Isso precisa estar escrito de forma explícita e destacada.
7. **Rotação tem custos muito diferentes entre os dois valores.**
   - `password_hash`: **barato e local**. O próprio agente tem o fluxo interativo
     `_maybe_setup_dashboard_auth_interactively()` (`hermes_cli/main_dashboard.py:425`), que pede
     usuário + senha, chama `hash_password()` (scrypt, `plugins/dashboard_auth/basic`) e grava
     `dashboard.basic_auth.password_hash` no `config.yaml` via `save_config()`. Também dá para
     pré-computar o hash com
     `python -c "from plugins.dashboard_auth.basic import hash_password; print(hash_password('...'))"`.
     O `hash_password` gera **salt novo** a cada chamada, então o hash resultante é sempre
     diferente do antigo (bom: não dá para comparar por igualdade depois).
   - `client_secret`: **exige ação externa no Auth0.** É um valor gerado pelo provedor (Auth0,
     tenant `dev-*`), não pelo agente. Rotacionar significa **entrar no painel do Auth0, gerar
     um novo secret para a aplicação daquele `client_id` e atualizar o valor**; o fluxo de
     autorização pode precisar ser refeito. Como o bloco está **inerte** (achado 3), o custo
     real é: **gerar o novo secret no Auth0 não quebra nada hoje** — não há consumidor local.
     A alternativa mais barata e mais limpa é **remover o bloco legado inteiro** do `config.yaml`
     depois de rotacionar no Auth0.
8. **Custo de limpar o histórico: alto e arriscado.** O repositório tem **65 commits** e um
   `.git` de **1,4 GB** (o `state.db` comprimido domina). Um `git filter-repo`/BFG reescreveria
   todos os hashes, exigindo `--force` no push, invalidando todo clone existente e **reescrevendo
   a única camada que sobrevive ao disco**. Além disso, plataformas de hospedagem costumam manter
   objetos órfãos alcançáveis por SHA após um force-push — ou seja, **não há garantia de remoção
   completa**. Não há outro clone do repositório no Pi nem no `/mnt` (busca por diretório
   `hermes-snapshot` encontrou apenas `/home/pi/hermes-snapshot`). A rotação dos valores é a
   mitigação que **de fato funciona**; a reescrita de histórico é uma decisão de produto (ver
   Perguntas de produto).
9. **O valor vivo já está fora do alcance de um restore simples.** Nada além de
   `config/config.yaml` no working tree do L1 contém os dois valores reais (varredura completa).
10. **A cópia versionada do `snapshot.sh` é idêntica ao script vivo.** Ou seja, o repositório já
    contém a própria definição da regra de cópia — o fix precisa ser aplicado nos **dois**
    lugares, e o `snapshot.sh` do repositório é sobrescrito por ele mesmo a cada execução.

---

## Escopo

### Inclui

- Alterar `snapshot.sh` (vivo em `/home/pi/.hermes/scripts/snapshot.sh` e cópia versionada em
  `/home/pi/hermes-snapshot/scripts/snapshot.sh`) para **redigir o `config.yaml` por lista de
  permissão**: preservar apenas as chaves consideradas seguras e substituir todo o resto por
  `***`.
- Um **teste de verificação** (`scripts/check_snapshot_redaction.sh`) que roda depois da cópia,
  **falha e aborta o snapshot** se encontrar valor real de segredo no `config.yaml` ou no `.env`
  versionados.
- Atualizar o `RESTORE.md`: seção nova explicando como reconstruir o `config.yaml`, o que vem
  como `***`, a ordem de rotação e o **aviso explícito** de que um `***` no campo de senha deixa
  o painel inacessível.
- Documentar o procedimento de rotação dos dois valores (sem executá-lo nesta entrega).
- Ajustar a tabela B.2 do `RESTORE.md`, que hoje declara o `config.yaml` como subindo "sem
  redação".

### Não inclui

- **Rotacionar** os valores (decisão de produto; a spec só documenta o procedimento).
- **Reescrever o histórico** do repositório (`git filter-repo`/BFG) — explicitamente fora,
  decisão de produto, e proibido nesta tarefa.
- Remover o `client_secret` do `config.yaml` vivo (mexe em produção; decidido pelo dono).
- Redigir outros arquivos do L1 (skills, memories, scripts, workout) — o levantamento mostrou
  que não contêm os dois valores reais, e falsos positivos de nome de chave não são segredos.
- Trocar a infraestrutura de backup, o provider de auth do dashboard ou o provedor de identidade.
- Implementar o fix: esta entrega é **somente a spec**.

---

## Decisões assumidas

1. **Redação por lista de permissão, não por lista de bloqueio.** O `config.yaml` mantém no
   repositório **apenas** as chaves de uma allowlist explícita; qualquer chave nova que apareça
   no futuro é redigida por padrão. Motivo: uma lista de bloqueio falha silenciosamente quando
   alguém adiciona uma credencial nova (foi exatamente o que aconteceu com o `webui_oidc`).
   Efeito visível: o `config.yaml` do repositório fica menor e com menos campos.
2. **O `config.yaml` continua no L1, redigido** — não é removido nem reconstruído no restore.
   Motivo: ele é a configuração do agente e é útil num restore; removê-lo trocaria um vazamento
   por uma perda de capacidade de recuperação. O `RESTORE.md` passa a documentar a
   reconstrução dos campos `***`.
3. **A allowlist preserva apenas o que é estrutura e preferência, nunca credencial.** Ficam
   fora, sempre redigidas: `dashboard.basic_auth.password_hash`, `webui_oidc.*`,
   `auxiliary.vision.key_env` e qualquer chave cujo **nome** case com
   `password|passwd|secret|token|api_key|apikey|credential|private|hash|key_env` (case-insensitive).
   A allowlist é aplicada **depois** do filtro de nome: ela nunca pode reintroduzir uma chave
   sensível.
4. **O teste falha e aborta o snapshot (fail-closed), em vez de só avisar.** Motivo: um aviso
   num log que ninguém lê não protege nada; e o `snapshot.sh` já usa `set -euo pipefail`, então
   abortar antes do commit é coerente com o desenho. Efeito visível: se um segredo escapar, o
   snapshot **não sobe** e o `snapshot_last_ok` **não é atualizado**, o que dispara o alerta de
   "snapshot velho" no Telegram. Falhar é melhor do que vazar em silêncio.
5. **O teste detecta valor real por três critérios independentes**, sem nunca imprimir o valor:
   (a) o campo não está na allowlist **e** não é `***`; (b) o valor tem comprimento acima de um
   limiar por chave sensível; (c) o valor **bate com o valor vivo** correspondente (comparação
   por sha256). O critério (c) é o mais forte: pega o caso exato do backlog.
6. **A redação é feita com Python + `PyYAML`, não com `sed`.** Motivo: o `config.yaml` é YAML
   aninhado e com listas (`allow_values`, `scopes`); uma regex destruiria a estrutura. O
   `python3` e o `PyYAML` já são dependências do agente no host. Efeito visível: o `config.yaml`
   do repositório continua sendo YAML válido e restaurável.
7. **A regra vive numa função única e reutilizável (`redact_config`), chamada pelo `snapshot.sh`
   logo após a cópia.** Motivo: permite que o teste exercite a **mesma** função que produz o
   arquivo, em vez de uma reimplementação que pode divergir.
8. **O `key_env` fica na allowlist e é versionado.** Motivo: é o **nome** de uma variável de
   ambiente (verificado: existe como chave no `.env`), não um valor. Foi assumido o risco de
   mantê-lo por ser inofensivo e útil no restore.
9. **O aviso do `RESTORE.md` fica no topo da seção de restore do `config.yaml`, em bloco de
   destaque**, e não numa nota de rodapé. Motivo: o modo de falha (painel inacessível, sem
   mensagem de erro útil) é exatamente o tipo de coisa que o operador precisa ler **antes** de
   copiar o arquivo.
10. **A rotação do `client_secret` é documentada como "gerar novo no Auth0 e, em seguida, remover
    o bloco legado"**, não como "editar o valor". Motivo: o bloco não tem consumidor; manter um
    secret vivo num caminho órfão só recria o problema.
11. **Não usar `sed` no `config.yaml`, não usar `git filter-repo` nesta entrega, não commitar
    nada** — decisões de escopo herdadas da restrição da tarefa.
12. **A allowlist inicial** (estrutura de execução + preferências, sem credenciais):

    ```yaml
    model: [default, provider, base_url]
    agent: [max_turns, reasoning_effort, verbose]
    terminal: [backend, cwd, timeout, home_mode, container_cpu, container_memory,
               container_disk, container_persistent, docker_mount_cwd_to_workspace,
               lifetime_seconds, inactivity_timeout]
    browser: [backend, use_gateway]
    compression: [enabled, progress_notices, threshold, target_ratio, protect_last_n,
                  min_tail_user_messages, max_attempts, proactive_prune_tokens,
                  proactive_prune_min_result_chars, proactive_prune_min_reclaim_tokens,
                  protect_first_n, idle_compact_after_seconds]
    prompt_caching: [enabled, cache_ttl]
    auxiliary: [vision]
    display: [compact, busy_input_mode, bell_on_complete, show_reasoning, streaming,
              skin, interim_assistant_messages, busy_ack_detail, cleanup_progress,
              long_running_notifications, tool_progress]
    dashboard: [theme]
    tts: [provider, use_gateway]
    stt: [enabled, provider, use_gateway]
    memory: [memory_enabled, user_profile_enabled, memory_char_limit, user_char_limit,
             nudge_interval, flush_min_turns]
    delegation: [max_iterations]
    moa: [max_tokens]
    skills: []
    approvals: [destructive_slash_confirm]
    plugins: []
    code_execution: [enabled, max_tool_calls, timeout]
    streaming: []
    onboarding: []
    updates: [pre_update_backup, backup_keep, non_interactive_local_changes]
    group_sessions_per_user: []
    _config_version: []
    known_plugin_toolsets: []
    platform_toolsets: []
    known_builtin_toolsets: []
    ```

    Toda chave de topo **não listada** (ex.: `webui_oidc`, `fallback_providers`,
    `command_allowlist`, `image_gen`, `session_reset`) é **removida** do arquivo versionado, e
    toda chave **sensível por nome** é substituída por `***` mesmo que esteja na allowlist.

---

## Requisitos Funcionais

**RF-1.** Ao final da execução do `snapshot.sh`, o arquivo `config/config.yaml` dentro do
repositório **não pode conter** nenhum valor vindo de `dashboard.basic_auth.password_hash`,
`webui_oidc.client_secret`, `webui_oidc.client_id`, `webui_oidc.issuer` ou
`webui_oidc.redirect_uri`. Testável: nenhuma dessas chaves aparece no arquivo versionado.

**RF-2.** A redação é feita por **lista de permissão sobre a lista de bloqueio por nome**:
qualquer chave cujo nome case (case-insensitive) com `password|passwd|secret|token|api_key|
apikey|credential|private|hash|key_env` é substituída por `***`, **independentemente** de estar
na allowlist. Testável: adicionar uma chave fictícia `foo_api_key: xyz` ao `config.yaml` vivo
resulta em `foo_api_key: '***'` no versionado.

**RF-3.** Toda chave de topo **ausente** da allowlist da decisão 12 é removida do arquivo
versionado (não vira `***`, simplesmente não existe). Testável: `webui_oidc` não aparece.

**RF-4.** O `config.yaml` versionado continua sendo **YAML válido** e faz `yaml.safe_load` sem
exceção. Testável: `python3 -c "import yaml;yaml.safe_load(open('config/config.yaml'))"` retorna
sem erro.

**RF-5.** Nenhum valor redigido é escrito no `config.yaml` **vivo** (`~/.hermes/config.yaml`).
O arquivo vivo permanece com seus valores reais e sua permissão `0600`. Testável: o sha256 do
arquivo vivo não muda por causa do snapshot.

**RF-6.** O script `scripts/check_snapshot_redaction.sh` roda **antes** do `git add` e
**aborta** o snapshot (exit ≠ 0) se qualquer um destes for verdadeiro no `config/config.yaml` ou
`config/.env` versionados:
- (a) existe linha `chave: <valor>` cujo valor não seja `***` e cuja chave seja sensível por
  nome (RF-2);
- (b) o valor de qualquer chave sensível tem comprimento > 8 caracteres e não é `***`;
- (c) o valor de qualquer chave sensível é **idêntico ao valor vivo** da mesma chave
  (comparação por sha256, sem imprimir).
Testável: injetar o valor real no arquivo versionado faz o script sair com código ≠ 0.

**RF-7.** Quando o teste falha, o `snapshot.sh` **não** executa `git commit`, **não** executa
`git push` e **não** atualiza `~/.hermes/snapshot_last_ok`. Testável: o timestamp de
`snapshot_last_ok` permanece o anterior.

**RF-8.** A saída do `snapshot.sh` informa explicitamente que o `config.yaml` foi redigido, no
mesmo estilo da linha que já existe para o `.env` (`✓ config/ (.env com secrets redactados)`),
passando a `✓ config/ (.env e config.yaml com secrets redactados)`.

**RF-9.** O teste imprime **apenas o nome da chave** e a origem do problema — **nunca o valor**,
nem parcialmente, nem truncado. Testável: a saída do teste não contém nenhum dos valores reais
(verificável por `grep -F` do valor, que deve falhar).

**RF-10.** O `.env` continua sendo redigido pela regra atual (`s/=.*/=***/`), que já é
idempotente e produziu 214 linhas `=***` com zero valores reais. Nenhuma mudança de
comportamento para o `.env`.

**RF-11.** O `RESTORE.md` passa a ter uma seção **"Restaurar o config.yaml"** com: (a) o comando
de cópia; (b) a lista dos campos que chegam como `***` e o que cada um faz, em linguagem leiga;
(c) o **aviso destacado** de que um `***` no campo de senha do painel deixa o painel
inacessível com a senha correta, sem mensagem de erro; (d) o comando do agente que redefine a
senha; (e) a ordem correta de rotação.

**RF-12.** A tabela B.2 do `RESTORE.md` deixa de declarar o `config.yaml` como "sobe **sem
redação**" e passa a declará-lo como "sobe **redigido** (`***`), reconstruir os campos de
credencial após o restore".

**RF-13.** O `snapshot.sh` versionado em `scripts/snapshot.sh` é atualizado junto com o vivo,
para que os dois permaneçam idênticos após o primeiro snapshot (o script copia a si mesmo).

**RF-14.** Se a função de redação falhar (YAML inválido, `PyYAML` ausente, erro de I/O), o
`snapshot.sh` **aborta** sem commitar e sem fazer push, em vez de versionar o arquivo cru.
Testável: renomear temporariamente o `config.yaml` vivo para conteúdo YAML inválido faz o
snapshot abortar.

---

## Detalhe de Implementação

> **Regra absoluta desta seção:** nenhum valor real de segredo aparece abaixo. Onde um valor
> seria necessário, o texto diz `<valor real — nunca versionado>`.

### 1. `/home/pi/.hermes/scripts/snapshot.sh` — bloco de config (linhas 35–41)

**ANTES** (linhas 35–41, exatamente como está hoje):

```bash
# 1. Config
mkdir -p config
cp "$HERMES_HOME/config.yaml" config/ 2>/dev/null || echo "⚠ config.yaml não encontrado"
cp "$HERMES_HOME/.env" config/ 2>/dev/null && echo "  ✓ .env" || echo "⚠ .env não encontrado"
# Redact secrets no .env copiado (substitui valores por ***)
sed -i 's/=.*/=***/' config/.env
echo "  ✓ config/ (.env com secrets redactados)"
```

**DEPOIS** (substitui integralmente as linhas 35–41):

```bash
# 1. Config
mkdir -p config
cp "$HERMES_HOME/config.yaml" config/ 2>/dev/null || echo "⚠ config.yaml não encontrado"
cp "$HERMES_HOME/.env" config/ 2>/dev/null && echo "  ✓ .env" || echo "⚠ .env não encontrado"

# Redige o .env copiado. A regra e idempotente: aplicar duas vezes = aplicar uma.
sed -i 's/=.*/=***/' config/.env

# Redige o config.yaml copiado (allowlist + blocklist por nome de chave).
# Fail-closed: qualquer erro aqui aborta o snapshot antes do commit.
if [ -f config/config.yaml ]; then
    python3 "$(dirname "$0")/redact_config.py" config/config.yaml || {
        echo "✗ FALHA ao redigir config/config.yaml — snapshot ABORTADO (nada foi commitado)."
        exit 1
    }
fi

# Portao de seguranca: barra valor real de segredo no que vai ser versionado.
if ! bash "$(dirname "$0")/check_snapshot_redaction.sh"; then
    echo "✗ SEGREDO DETECTADO no conteudo a versionar — snapshot ABORTADO (nada foi commitado)."
    exit 1
fi

echo "  ✓ config/ (.env e config.yaml com secrets redactados)"
```

> Nota: `set -euo pipefail` já está ativo (linha 3), então o `exit 1` é redundante em caso de
> erro não tratado, mas é explícito de propósito — o operador precisa ver a mensagem.

### 2. `/home/pi/.hermes/scripts/redact_config.py` — **arquivo novo**

Faz a redação do `config.yaml` copiado. Recebe o caminho do **arquivo copiado** (nunca o vivo)
e o reescreve no lugar.

```python
#!/usr/bin/env python3
"""Redige o config.yaml copiado para o repo do snapshot.

Regra: allowlist de estrutura/preferencia + blocklist por NOME de chave.
Toda chave sensivel vira '***'; toda chave fora da allowlist e removida.
Nunca toca o config.yaml vivo, nunca imprime valores.
"""
from __future__ import annotations

import re
import sys

import yaml

# Chaves cujo NOME indica credencial: vencem sempre, mesmo se estiverem na allowlist.
SENSITIVE_RE = re.compile(
    r"(password|passwd|secret|token|api_key|apikey|credential|private|hash|key_env)",
    re.IGNORECASE,
)

# Allowlist: {secao_de_topo: [subchaves permitidas]}.
# Lista vazia = a secao inteira e preservada como esta (sem credenciais conhecidas).
ALLOWLIST: dict[str, list[str] | None] = {
    "model": ["default", "provider", "base_url"],
    "agent": ["max_turns", "reasoning_effort", "verbose"],
    "terminal": [
        "backend", "cwd", "timeout", "home_mode", "container_cpu", "container_memory",
        "container_disk", "container_persistent", "docker_mount_cwd_to_workspace",
        "lifetime_seconds", "inactivity_timeout",
    ],
    "browser": ["backend", "use_gateway"],
    "compression": [
        "enabled", "progress_notices", "threshold", "target_ratio", "protect_last_n",
        "min_tail_user_messages", "max_attempts", "proactive_prune_tokens",
        "proactive_prune_min_result_chars", "proactive_prune_min_reclaim_tokens",
        "protect_first_n", "idle_compact_after_seconds",
    ],
    "prompt_caching": ["enabled", "cache_ttl"],
    "auxiliary": ["vision"],
    "display": [
        "compact", "busy_input_mode", "bell_on_complete", "show_reasoning", "streaming",
        "skin", "interim_assistant_messages", "busy_ack_detail", "cleanup_progress",
        "long_running_notifications", "tool_progress",
    ],
    "dashboard": ["theme"],
    "tts": ["provider", "use_gateway"],
    "stt": ["enabled", "provider", "use_gateway"],
    "memory": [
        "memory_enabled", "user_profile_enabled", "memory_char_limit", "user_char_limit",
        "nudge_interval", "flush_min_turns",
    ],
    "delegation": ["max_iterations"],
    "moa": ["max_tokens"],
    "approvals": ["destructive_slash_confirm"],
    "code_execution": ["enabled", "max_tool_calls", "timeout"],
    "updates": ["pre_update_backup", "backup_keep", "non_interactive_local_changes"],
    # Secoes inteiramente estruturais (sem credenciais conhecidas).
    "skills": [],
    "plugins": [],
    "streaming": [],
    "onboarding": [],
    "group_sessions_per_user": None,
    "_config_version": None,
    "known_plugin_toolsets": None,
    "platform_toolsets": None,
    "known_builtin_toolsets": None,
}


def _redact(node):
    """Aplica blocklist por nome, recursivamente. Sensivel -> '***'."""
    if isinstance(node, dict):
        out = {}
        for key, value in node.items():
            if SENSITIVE_RE.search(str(key)):
                out[key] = "***"
            else:
                out[key] = _redact(value)
        return out
    if isinstance(node, list):
        return [_redact(item) for item in node]
    return node


def redact(document: dict) -> dict:
    """Retorna o documento redigido: allowlist no topo, blocklist por nome em tudo."""
    result = {}
    for section, allowed in ALLOWLIST.items():
        if section not in document:
            continue
        value = document[section]
        if allowed is None or not allowed:
            result[section] = _redact(value)
            continue
        if not isinstance(value, dict):
            result[section] = _redact(value)
            continue
        kept = {k: v for k, v in value.items() if k in allowed}
        result[section] = _redact(kept)
    return result


def main() -> int:
    path = sys.argv[1]
    with open(path, encoding="utf-8") as handle:
        document = yaml.safe_load(handle)
    if not isinstance(document, dict):
        print(f"✗ {path}: YAML de topo não é um mapa", file=sys.stderr)
        return 1
    with open(path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(redact(document), handle, allow_unicode=True, sort_keys=False,
                       default_flow_style=False)
    # Nunca imprime valores: apenas a contagem de secoes preservadas.
    print(f"  ✓ config.yaml redigido (allowlist: {len(ALLOWLIST)} secoes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 3. `/home/pi/.hermes/scripts/check_snapshot_redaction.sh` — **arquivo novo**

Portão fail-closed. Nunca imprime valores.

```bash
#!/usr/bin/env bash
# Barra valor real de segredo no que vai ser versionado (config.yaml + .env).
# Saida: codigo 0 = limpo; != 0 = segredo detectado (o snapshot deve abortar).
# NUNCA imprime valores — apenas nomes de chave e origem.
set -uo pipefail

REPO_DIR="${REPO_DIR:-$HOME/hermes-snapshot}"
LIVE_CONFIG="${HERMES_HOME:-$HOME/.hermes}/config.yaml"
FAILED=0

python3 - "$REPO_DIR" "$LIVE_CONFIG" <<'PY'
import hashlib
import re
import sys

import yaml

repo_dir, live_config = sys.argv[1], sys.argv[2]
SENSITIVE_RE = re.compile(
    r"(password|passwd|secret|token|api_key|apikey|credential|private|hash|key_env)",
    re.IGNORECASE,
)
PLACEHOLDER = "***"
failures = []


def sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def walk(node, path=""):
    """(caminho, chave, valor) para toda folha do documento."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from walk(value, f"{path}.{key}" if path else str(key))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from walk(value, f"{path}[{index}]")
    else:
        yield path, path.split(".")[-1], node


# ---- Valores vivos, apenas para comparacao por hash ----
live_values = {}
try:
    with open(live_config, encoding="utf-8") as handle:
        live_doc = yaml.safe_load(handle) or {}
    for path, key, value in walk(live_doc):
        if SENSITIVE_RE.search(str(key)) and isinstance(value, str) and value:
            live_values[sha(value)] = path
except OSError:
    print("  ⚠ config.yaml vivo ilegivel — checagem por igualdade desativada")


def check_yaml_file(path, label):
    try:
        with open(path, encoding="utf-8") as handle:
            doc = yaml.safe_load(handle)
    except FileNotFoundError:
        return
    except yaml.YAMLError as exc:
        failures.append(f"{label}: YAML invalido ({type(exc).__name__})")
        return
    if not isinstance(doc, dict):
        return
    for key_path, key, value in walk(doc):
        if not SENSITIVE_RE.search(str(key)):
            continue
        if not isinstance(value, str) or not value:
            continue
        if value == PLACEHOLDER:
            continue
        # (a) nao e placeholder, (b) comprimento suspeito, (c) igual ao vivo
        if len(value) > 8:
            failures.append(f"{label}: campo sensivel com valor real ({key_path}, len={len(value)})")
        elif value not in ("", PLACEHOLDER):
            failures.append(f"{label}: campo sensivel preenchido ({key_path})")
        if sha(value) in live_values:
            failures.append(f"{label}: valor IDENTICO ao vivo ({key_path})")


check_yaml_file(f"{repo_dir}/config/config.yaml", "config.yaml")

# ---- .env: a regra e 's/=.*/=***/'; qualquer valor real e falha ----
try:
    with open(f"{repo_dir}/config/.env", encoding="utf-8", errors="replace") as handle:
        for number, line in enumerate(handle, 1):
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=.+$", line.rstrip("\n")) \
                    and not line.rstrip("\n").endswith("=***"):
                failures.append(f".env: linha {number} com valor nao redigido")
except FileNotFoundError:
    pass

if failures:
    for item in failures:
        print(f"  ✗ {item}")
    sys.exit(1)
print("  ✓ portao de segredos: nenhum valor real no conteudo a versionar")
PY
FAILED=$?

exit "$FAILED"
```

### 4. `git add` — ajuste no `snapshot.sh` (linhas 134–142)

O `git add -A` já cobre os dois arquivos novos em `scripts/`. Nenhuma mudança necessária além
de garantir que o portão (seção 1) roda **antes** desta linha.

### 5. `/home/pi/hermes-snapshot/RESTORE.md` — seção nova

Inserir logo **após** o passo "3. Restaurar config" da seção de restore:

```markdown
### 3.1 — Reconstruir o `config.yaml` (leia antes de copiar)

> ⚠️ **O `config.yaml` deste repo vem com os campos de credencial como `***`.**
> Copiar o arquivo e subir o agente **sem** preencher esses campos deixa o **painel web
> inacessível mesmo com a senha correta**, e sem nenhuma mensagem explicando o motivo.
> Preencha antes de subir, ou redefina pelo comando abaixo.

Campos que chegam como `***` e o que fazer com cada um:

| Campo | O que é (em linguagem simples) | Como recuperar |
|---|---|---|
| Senha de entrada do painel do agente | É o que protege a tela de administração do agente na porta 9119 | Redefina com o próprio agente: ele pede a senha nova e grava o hash. **Não** copie o `***`. |
| Credencial da integração de login externo | Chave de um provedor de identidade externo que **não está em uso** (o painel sobe com login por senha) | Não é necessária para o agente subir. Se for reativar o login externo, gere uma credencial nova no provedor. |

Comandos:

```bash
# a) copiar a configuracao
cp config/config.yaml ~/.hermes/config.yaml

# b) redefinir a senha do painel (o agente pergunta a senha nova e grava o hash)
hermes dashboard        # na primeira execucao ele oferece configurar o login

# c) conferir que nao restou placeholder
grep -n '\*\*\*' ~/.hermes/config.yaml   # nao deve listar nenhum campo de credencial
```

**Ordem correta quando for rotacionar:** suba o agente primeiro (a senha é local e barata de
redefinir); só depois trate a credencial do provedor externo.
```

### 6. `/home/pi/hermes-snapshot/RESTORE.md` — tabela B.2 (linha 130)

**ANTES:**

```markdown
| `config.yaml` | ✅ Sim | — (⚠️ sobe **sem redação**: contém `password_hash` e `client_secret` reais) |
```

**DEPOIS:**

```markdown
| `config.yaml` | ✅ Sim | — (⚠️ sobe **redigido**: campos de credencial vêm como `***` — ver §3.1) |
```

### 7. `scripts/snapshot.sh` do repositório

Cópia idêntica do script vivo. Como o próprio `snapshot.sh` copia `$HERMES_HOME/scripts/*.sh`
para `scripts/`, aplicar a mudança no vivo e rodar um snapshot já sincroniza os dois. **Verificar
com `diff` antes de commitar.**

### 8. Teste manual — simular um vazamento e ver o portão barrar

```bash
# 1. Injeta um valor fictício num campo sensível do arquivo COPIADO (nunca no vivo)
python3 - <<'PY'
import yaml
p = "/home/pi/hermes-snapshot/config/config.yaml"
d = yaml.safe_load(open(p))
d.setdefault("dashboard", {}).setdefault("basic_auth", {})["password_hash"] = "valor-ficticio-para-o-teste"
yaml.safe_dump(d, open(p, "w"), allow_unicode=True, sort_keys=False)
PY

# 2. O portão DEVE falhar (exit != 0) e NÃO pode imprimir o valor fictício
bash /home/pi/.hermes/scripts/check_snapshot_redaction.sh; echo "exit=$? (esperado != 0)"

# 3. Restaura o arquivo redigido corretamente
rm -f /home/pi/hermes-snapshot/config/config.yaml
# rodar o snapshot de novo o regenera redigido
```

---

## Critérios de aceite

1. `config/config.yaml` no repositório não contém `webui_oidc` nem nenhuma chave cujo nome case
   com a blocklist sem ser `***`. **Verificável.**
2. `python3 -c "import yaml;yaml.safe_load(open('config/config.yaml'))"` roda sem erro.
   **Verificável.**
3. `grep -c '\*\*\*' config/config.yaml` > 0 e nenhum campo sensível tem valor diferente de
   `***`. **Verificável.**
4. `bash check_snapshot_redaction.sh` sai com 0 no estado correto e com ≠ 0 quando um valor real
   é injetado. **Verificável.**
5. A saída do teste **não contém** nenhum valor real (checável com `grep -F` do valor, que deve
   falhar). **Verificável.**
6. `~/.hermes/config.yaml` vivo permanece com os valores reais, modo `0600`, e sha256 inalterado
   pelo snapshot. **Verificável.**
7. Em caso de falha do teste, `snapshot_last_ok` não é atualizado e não houve `commit`/`push`.
   **Verificável.**
8. O `RESTORE.md` tem a seção §3.1 e o aviso em destaque sobre o painel inacessível.
   **Verificável.**
9. A tabela B.2 não afirma mais que o `config.yaml` sobe "sem redação". **Verificável.**
10. `diff` entre `~/.hermes/scripts/snapshot.sh` e `scripts/snapshot.sh` do repositório é vazio
    após um snapshot. **Verificável.**
11. **Valores rotacionados** — `password_hash` diferente do atual e `client_secret` novo ou bloco
    removido. **⚠️ IRREVERSÍVEL: a senha do painel antiga deixa de funcionar; exige entrar no
    Auth0.** **Não incluído nesta entrega** (decisão de produto).
12. **Histórico limpo** — os valores reais ausentes de todo o histórico. **⚠️ IRREVERSÍVEL e de
    alto risco: reescreve todos os hashes do repo, exige force-push; sem garantia de remoção
    completa. Não incluído** (decisão de produto).

---

## Riscos e rollback

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| O portão falha por falso positivo e o snapshot para de subir | Média | Alto (perda da janela de backup) | O portão só olha campos cujo **nome** é sensível; conferir a saída e ajustar a allowlist sem afrouxar a blocklist |
| A allowlist remove uma chave que fazia falta no restore | Média | Médio | Revisar a lista contra o `config.yaml` vivo antes de subir; a lista é explícita e fácil de estender |
| `PyYAML` ausente no host no futuro | Baixa | Alto (aborta o snapshot) | `hermes` roda em Python com PyYAML; se faltar, o snapshot aborta **sem** vazar (fail-closed) |
| A regra de redação quebra o YAML e o arquivo fica inutilizável | Baixa | Médio | RF-4 valida com `yaml.safe_load`; o teste aborta antes do commit |
| Alguém remove o portão do script depois | Média | Alto | O teste e a regra ficam em **arquivos separados e versionados**, visíveis no L1 |
| A rotação do `client_secret` quebra algo | **Muito baixa** | Baixo | O bloco é inerte (zero consumidores); o custo é entrar no Auth0 |
| A reescrita de histórico corrompe a única camada de backup | **Alta se tentada** | **Crítico** | **Não fazer nesta entrega.** Se for decidida, clonar antes, rodar `git filter-repo` numa cópia e só então forçar o push |

**Rollback:** o fix é aditivo e reversível. Para desfazer, basta remover a chamada de
`redact_config.py` e do portão do `snapshot.sh` — o comportamento volta ao anterior (cópia crua).
O `config.yaml` vivo **nunca** é tocado, então nada em produção depende dessas mudanças. Nenhuma
rotação é feita nesta entrega, portanto **não há rollback irreversível**.

---

## Testes manuais

1. Rodar `snapshot.sh` e conferir na saída a linha `✓ config/ (.env e config.yaml com secrets
   redactados)` e `✓ portao de segredos: nenhum valor real no conteudo a versionar`.
2. `grep -c '\*\*\*' /home/pi/hermes-snapshot/config/config.yaml` → maior que 0.
3. `grep -c 'webui_oidc' /home/pi/hermes-snapshot/config/config.yaml` → 0.
4. `python3 -c "import yaml;yaml.safe_load(open('/home/pi/hermes-snapshot/config/config.yaml'))"`
   → sem erro.
5. Injetar valor fictício num campo sensível do arquivo copiado e rodar
   `check_snapshot_redaction.sh` → exit ≠ 0, sem imprimir o valor.
6. Conferir que `~/.hermes/config.yaml` vivo continua com `0600` e sha256 inalterado.
7. Confirmar no RESTORE.md que a seção §3.1 existe e o aviso está destacado.
8. `diff ~/.hermes/scripts/snapshot.sh /home/pi/hermes-snapshot/scripts/snapshot.sh` → vazio.

---

## Comportamento Visual/UX

O operador vê apenas a saída do script e do portão.

**Saída normal (snapshot completo):**

```
📸 Hermes Snapshot — 2026-09-13_06-00-01
  ✓ .env
  ✓ config.yaml redigido (allowlist: 29 secoes)
  ✓ portao de segredos: nenhum valor real no conteudo a versionar
  ✓ config/ (.env e config.yaml com secrets redactados)
  ✓ skills/ (312 arquivos)
  ✓ sessions/state.db.gz
  ✓ system/info.txt
  ✓ memories/ (4 arquivos)
  ✓ scripts/ (78 arquivos)
  ✓ plugins/ (opencode-zen + opencode-go com patches locais)
  ✓ opengym-data/ (3 arquivos: perfis + treinos do continente)
  ✓ workout/ (41 arquivos: mecanica, portoes, planos, recibos)
✅ Snapshot enviado para GitHub!
```

**Saída quando algo escapou (o snapshot NÃO sobe):**

```
  ✓ .env
  ✓ config.yaml redigido (allowlist: 29 secoes)
  ✗ config.yaml: valor IDENTICO ao vivo (dashboard.basic_auth.password_hash)
  ✗ SEGREDO DETECTADO no conteudo a versionar — snapshot ABORTADO (nada foi commitado).
```

A mensagem nomeia **apenas o caminho da chave** — nunca o valor, nem um trecho dele.
Como o `snapshot_last_ok` não é atualizado, o `island_healthcheck.sh` acaba avisando no Telegram
que o snapshot passou de 26h, o que dá visibilidade sem expor nada.

**Como fica claro que não há valor real:** a linha `✓ portao de segredos: nenhum valor real no
conteudo a versionar` é a evidência positiva em toda execução, e o operador pode conferir a
qualquer momento com `grep -c '\*\*\*' config/config.yaml` no repositório.
