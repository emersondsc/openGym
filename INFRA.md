# Infraestrutura do openGym — a instância do emersondsc

> Documento em português de propósito: isto é o runbook de quem opera **esta** instância, não a
> documentação do projeto. O guia genérico de self-hosting continua sendo o
> [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md), do upstream; aqui está só o que é específico
> deste deployment.
>
> **Estado em 17/09/2026**, dia em que o app saiu do Raspberry Pi da rede local e passou a rodar
> numa VM da Oracle Cloud. Tudo que está escrito aqui foi medido nesse dia. As armadilhas da
> seção 9 custaram tempo de verdade para descobrir; cada uma diz como foi descoberta.

## 1. Onde as coisas rodam

| Peça | Onde vive |
|---|---|
| Aplicação (containers) | VM Oracle Cloud, região São Paulo, `VM.Standard.A1.Flex`, 2 OCPU / 12 GB, Ubuntu 24.04.4 LTS arm64 |
| Entrada pública | Cloudflare Tunnel `opengym-vm`, conector rodando na própria VM |
| Domínio | `https://opengym.edsc.fun` |
| Dado vivo | disco da VM, `/mnt/drivebackup/apps/openGym/data` |
| Backup do dado | repo **privado** `emersondsc/opengym-backup` no GitHub |
| Sensores e alertas | Raspberry Pi da rede local (o "continente"), que fica de pé quando a VM cai |
| Código | `emersondsc/openGym`, ramo `emerson-custom` (fork de `arvids-unavailable/openGym`) |

```
   celular / navegador
          |
          |  HTTPS, domínio exato (passkey não aceita outro)
          v
   Cloudflare  (DNS + edge, proxy ligado)
          |
          |  túnel de SAÍDA: nenhuma porta de entrada é aberta no servidor
          v
   VM Oracle ── cloudflared-opengym.service ──> http://localhost:8081
                                                    |
                                        [ opengym-web-1 ]  nginx
                                          |            |
                                  /api/* → api:3000    /img /gif (volume)
                                          |
                                        [ opengym-api-1 ]  Node, sem framework
                                          |
                          /mnt/drivebackup/apps/openGym/data  (JSON, sem banco)
```

**Por que túnel e não IP público:** o servidor não aceita conexão de entrada nenhuma além do SSH.
Não há porta 80/443 exposta, não há IP de origem no DNS, e não há certificado para renovar. Se a
Cloudflare mudar de ideia, o caminho B está no `docs/SELF_HOSTING.md` (Caddy com Let's Encrypt).

## 2. O que sobe, e em que portas

`docker compose` sobe três serviços (projeto `opengym`):

| Container | O que é | Porta |
|---|---|---|
| `opengym-web-1` | nginx: serve o React já buildado, faz proxy de `/api/` para a API e serve a mídia | **8081** (HTTP) e 9000 (HTTPS interno, publicado em `${WEB_PORT:-8080}`) |
| `opengym-api-1` | Node sem framework: passkey, dado por usuário, rotas `/api/*` | 3000, **sem porta publicada** |
| `media` | one-shot `alpine/git`: baixa as ~140 MB de imagens/GIFs na primeira vez e sai | — |

- **O túnel aponta para a 8081**, não para a 8080. A 8081 é o nginx em HTTP puro (é o que o
  `cloudflared` consome); a 8080 é o mesmo nginx em HTTPS, com o `og.crt`/`og.key` que existiam
  para o acesso direto na rede local. Trocar de uma para a outra é trocar o `ingress` do túnel.
- O `media` roda **antes** do web (`depends_on: service_completed_successfully`) e não reinicia:
  ele só baixa o dataset se `/out/img` estiver vazio.
- O `api` tem `pull_policy: never` e `build.target: runtime` de propósito. Sem o
  `pull_policy`, um `up -d` puxaria `ghcr.io/duartesantos8/opengym-api:latest` do namespace do
  upstream em vez de usar a imagem construída daqui; sem o `target`, o Compose buildaria o alvo
  `test` do Dockerfile e a API subiria **rodando a suíte de testes** em vez do servidor.

Verificar:

```bash
docker compose -f /mnt/drivebackup/apps/openGym/openGym/docker-compose.yml ps
curl -s http://localhost:8081/api/health          # {"ok":true,"users":N}
curl -s https://opengym.edsc.fun/api/health       # a mesma coisa, pelo mundo
```

## 3. O dado: JSON, sem banco

Não existe banco de dados. Todo o estado são arquivos JSON em
`/mnt/drivebackup/apps/openGym/data`, montado no container da API como `/data`
(`DATA_DIR=/data`):

| Arquivo | O que é | Perder significa |
|---|---|---|
| `db.json` | usuários, credenciais de passkey, inscrições de push, convites | todos voltam a se registrar (passkey nova) |
| `state-<uid>.json` | treino, histórico, medidas de cada usuário | perde-se o histórico de treino |
| `secret` | chave HMAC que assina o cookie de sessão e **deriva o `agent.key`** | ninguém entra até refazer login; o pipeline do Pi precisa do `agent.key` novo |
| `vapid.json` | par de chaves das notificações push | todas as inscrições de push morrem em silêncio |
| `agent.key` | credencial do pipeline do Pi para `/api/coach/analysis` | o pipeline para de autenticar |
| `audit.jsonl` | trilha de auditoria, append-only | perde-se o rastro |
| `micro-idem.json` | idempotência do `POST /api/plan/micro` | um replay pode duplicar escrita |

**Regra que não se quebra:** esses arquivos não fazem merge. Dois processos escrevendo no mesmo
`data/` perdem dado, porque cada escrita reescreve o JSON inteiro. Foi por isso que a migração
exigiu parar o app no Pi antes de copiar, e é por isso que a cópia do Pi **não** é uma segunda
instância viva: ela é espelho.

### A armadilha dos dois `data/`

Existem **dois** diretórios chamados `data` e eles não são a mesma coisa:

| Caminho | O que é |
|---|---|
| `/mnt/drivebackup/apps/openGym/data` | **o dado vivo.** É irmão do clone, está fora de qualquer repositório git |
| `/mnt/drivebackup/apps/openGym/openGym/data` | lixo de demonstração **do upstream**, dentro do clone. Está versionado e é **público** |

O segundo contém um `db.json` de 480 bytes com 1 usuário de demonstração ("Arvids"), um `secret`
e um `vapid.json` que **não são os seus** (vieram do commit `3efe375`, de 03/08/2026, herdado do
upstream, que carrega esses arquivos até hoje). O seu segredo vivo tem outro conteúdo.

Nunca coloque o dado vivo dentro do clone, e nunca aponte o `DATA_DIR` para dentro dele: o
`.gitignore` cobre `.env`, `og.crt` e `og.key`, mas **não cobre `data/`**. Um `git add -A` feito
no lugar errado publicaria segredo de sessão e histórico de treino num repo público. Se algum dia
precisar rodar o app fora da VM, aponte o `DATA_DIR` para fora da árvore do git.

Confira sempre com:

```bash
ls -la /mnt/drivebackup/apps/openGym/data              # o vivo: 13 arquivos, alguns 600
git -C /mnt/drivebackup/apps/openGym/openGym status --short   # tem de sair vazio
```

## 4. Passkey: a restrição que manda em tudo

O login é WebAuthn. Duas regras do navegador governam a vida desta instância:

1. A passkey é vinculada ao **hostname exato** (`RP_ID`).
2. Só funciona em **HTTPS** (a exceção é `http://localhost`, que não serve para o celular).

Consequências práticas, todas já vividas:

- `RP_ID=opengym.edsc.fun` e `ORIGIN=https://opengym.edsc.fun`, no `.env`, **não se mexe**.
  Trocar qualquer um dos dois obriga os 7 usuários a registrar passkey de novo, que é o pior
  defeito possível neste projeto.
- Foi por isso que a migração de Pi para VM **não** trocou de domínio: só o CNAME mudou de alvo.
  O login continuou funcionando sem re-registro, e essa foi a prova de que a migração deu certo.
- Um `.env` perdido é um incidente, não uma conveniência: ele não está no git e existe só no
  disco. Por isso ele passou a ir nos backups.

**Modelo de sessão (detalhe que confunde):** o cookie é um HMAC sobre `<uid>:<exp>:<sv>`. O
servidor exige **igualdade** do campo `sv` (`api/server.js:232`), e quem incrementa `sv` é só o
`POST /api/logout/all` (`api/server.js:552`). Um `db.json` sem o campo `sv` vale `0`, ou seja,
sessão válida. Consequência útil no dia ruim: **restaurar um `db.json` antigo não derruba as
sessões**, porque o `sv` não muda sozinho.

## 5. Backup

Regra do projeto, escrita antes de existir pressa: *backup que nunca foi restaurado não é
backup*. Os dois caminhos abaixo foram executados em ensaio contra um destino local e depois
restaurados de volta, com o `db.json` conferido por sha256.

### O caminho que roda hoje: GitHub

- Repo **privado** `emersondsc/opengym-backup`, ramo `main`.
- `opengym-github-backup.timer` → **todo dia às 04:40 UTC**, com até 5 min de atraso aleatório e
  `Persistent=true` (se a VM estiver reiniciando na hora, roda depois).
- O serviço roda como `ubuntu` e chama `/usr/local/bin/backup_to_github.sh`, que clona em
  `/home/ubuntu/opengym-backup`, copia e faz commit + push por uma **deploy key** read-write em
  `/home/ubuntu/.ssh/id_ed25519_github`.
- Vai para o repo: `db.json`, os `state-*.json`, `audit.jsonl`, `micro-idem.json` e o `.env`,
  mais um `RESTORE.md` que o próprio script escreve (~1,6 MB, 12 arquivos).
- **Não vai, de propósito:** `secret`, `vapid.json` e `agent.key`. O script tem guarda que
  **aborta** se algum deles escapar. Por isso um restore completo precisa deles de outro lugar:
  do Pi (que os mantém atualizados a cada 5 min) ou do pacote do R2.
- **A mídia (1324 arquivos, ~137 MB) também não vai**, nem para o GitHub nem para o pacote do
  R2 (que a copia por `rclone copy` incremental, fora do tar).

### O caminho pronto e ocioso: Cloudflare R2

`backup_to_r2.sh` e os units `opengym-backup.*` estão instalados na VM, ensaiados, e **desligados**
por escolha: o destino é o GitHub. Se um dia quiser ligar, o `rclone config` tem de ser feito
**como root** (`sudo rclone config`), porque esse unit não tem `User=` e lê
`/root/.config/rclone/rclone.conf`. O pacote dele cobre tudo de uma vez, inclusive os três
sensíveis e o certificado.

### Como conferir se o backup está de pé

```bash
systemctl list-timers opengym-github-backup.timer
systemctl show opengym-github-backup.service -p LoadState -p ExecMainStatus --value
git -C /home/ubuntu/opengym-backup log -1 --format='%h %ad %s' --date=iso
git -C /home/ubuntu/opengym-backup status --short    # vazio = a VM e o remoto estao iguais
```

O vigia do Pi faz essas mesmas perguntas sozinho (seção 6), e ainda compara o commit local com o
`git ls-remote origin main`: só a idade não bastaria, porque um push rejeitado deixa o commit novo
na VM e o repo velho no GitHub.

### Restaurar

O passo a passo está em `RESTORE.md`, dentro do próprio repo de backup, e o mapa completo (o que
vem do GitHub, o que vem do Pi, o que vem do R2, e em que ordem) está em
`opengym_restore_runbook.md`, nas notas privadas de operação. **Ressalva honesta:** um restore
completo numa instância nova nunca foi executado ponta a ponta. As peças foram todas testadas
individualmente; a sequência inteira, não.

## 6. Monitoramento

Dois sensores rodam **no Pi**, não na VM: se a VM cair, quem avisa tem de estar em outro lugar.

| Unit (no Pi) | Quando | O que faz |
|---|---|---|
| `og-watchdog.timer` | a cada 15 min (`:05 :20 :35 :50`) | 6 checagens: saúde pública, conector do túnel, containers, frescor do `data/`, e o backup |
| `opengym-credentials-sync.timer` | a cada 5 min | traz `secret` e `db.json` da VM para o Pi, mantendo a cópia dos sensíveis |

O que o vigia checa, e por quê:

1. `https://opengym.edsc.fun/api/health` responde 200 com `{"ok":true}` e pelo menos 1 usuário.
2. O túnel `opengym-vm` tem conector ativo (**pelo UUID**, ver armadilha 9.2).
3. Na VM: `opengym-web-1` e `opengym-api-1` de pé.
4. Na VM: algum arquivo do `data/` foi escrito nas últimas **50 h**. É sensor de **atividade**,
   não de liveness: férias longas disparam, um fim de semana parado não.
5. O backup: unit `loaded`, último status `0`, commit local com menos de **27 h** e igual ao do
   GitHub.

Alerta vai por Telegram (`/home/pi/.hermes/scripts/alerta.sh`), **uma vez por incidente**: fica
quieto enquanto o problema continua e avisa quando recupera. Nada de alarme a cada 15 minutos.

## 7. Operação do dia a dia

```bash
# --- na VM (ubuntu@<ip-da-vm>) ---
cd /mnt/drivebackup/apps/openGym/openGym

curl -s http://localhost:8081/api/health        # o app esta de pe?
docker compose ps                               # containers e healthcheck
docker compose logs -f --tail=100 api           # o que a API esta dizendo
docker compose restart api                      # reiniciar so a API
docker compose down && docker compose up -d     # reiniciar tudo
sudo systemctl status cloudflared-opengym       # o tunel

# --- atualizar o codigo (deploy) ---
git pull --ff-only && docker compose up -d --build

# --- no Pi ---
sudo -H -u pi /usr/local/bin/og_watchdog.sh --dry-run    # checa tudo sem alertar
sudo -H -u pi /usr/local/bin/og_watchdog.sh --test       # testa o caminho do Telegram
bash /usr/local/bin/sync_og_credentials.sh               # forcar a sincronizacao agora
```

`docker compose down` **não** apaga o dado: o `data/` e a mídia são volumes amarrados a caminhos
absolutos do host, não volumes nomeados do Docker. Recriar os containers é seguro.

## 8. Limites do free tier

A VM é Always Free **numa conta Pay As You Go**, e aí a conta é por mês, não permanente:

- **1.500 OCPU-hours e 9.000 GB-hours por mês.** Com 2 OCPU e 12 GB, isso dá para rodar
  **24 horas por dia** com folga (2 × 730 = 1.460; 12 × 730 = 8.760), mas é a conta que decide,
  não a boa vontade da Oracle. Uma segunda instância ARM do mesmo tamanho estouraria.
- **200 GB** somando boot e block volumes (a VM usa 50 GB de boot). **5 backups de volume.**
  **10 TB de egress por mês.**
- A instância é **um disco só**: `/mnt/drivebackup` é um diretório comum no disco de boot, não um
  volume separado. Não existe snapshot de volume configurado.
- O `unattended-upgrades` está ativo, mas **sem reboot automático**: um kernel novo só entra
  quando alguém reiniciar.

Estado atual: 4,0 GB de 48 GB usados (9%), 602 MB de 12 GB de RAM, 2 CPUs, **sem swap**.

## 9. Armadilhas (as que custaram tempo)

### 9.1 Rodar o vigia com `sudo` puro dá falha falsa

`sudo /usr/local/bin/og_watchdog.sh` roda como **root**, e como root o `ssh` não acha o
`/home/pi/.ssh/known_hosts` nem o `~/.cloudflared/cert.pem` do `pi`. O resultado é o túnel
aparecendo como "não existe" e a VM como "inalcançável", **sem haver problema nenhum**. O unit
roda com `User=pi`, então o teste manual tem de imitar isso:

```bash
sudo -H -u pi /usr/local/bin/og_watchdog.sh --dry-run
```

O `-H` importa: sem ele o `HOME` continua sendo o do root, e o `ssh` volta a não achar o
`known_hosts`.

### 9.2 `cloudflared` por NOME aponta para o túnel errado

No Pi (cloudflared 2026.8.2), `cloudflared tunnel info opengym-vm` devolve o túnel **antigo**,
o do `config.yml` dele, não o túnel novo. Pior: `cloudflared tunnel route dns --overwrite-dns
opengym-vm opengym.edsc.fun` imprime `already configured to route to your tunnel
tunnelID=<uuid-do-tunel-antigo>` e **sai com código 0 sem mexer no DNS**. A primeira tentativa de
corte não fez nada e parecia ter funcionado.

**Sempre passe o UUID, nunca o nome.** Pegue o UUID atual em dois lugares:

```bash
grep '^tunnel:' ~/.cloudflared/config.yml     # na VM
cloudflared tunnel list                       # na VM, lista os tuneis da conta
```

Ele também está nas notas privadas de operação. **Neste documento o UUID não aparece de
propósito:** com o proxy ligado, o DNS público devolve apenas IPs da Cloudflare e não expõe o
`CNAME` do túnel, então o UUID não é informação pública. O que é segredo de verdade é o arquivo
de credencial do túnel, que fica em `~/.cloudflared/<uuid>.json` e nunca sai de lá.

### 9.3 `ExecMainStatus` mente para unit que não existe

`systemctl show <unit> -p ExecMainStatus --value` devolve **0** para uma unidade **inexistente**, e
`ExecMainExitTimestamp` fica **vazio mesmo numa oneshot que já rodou** (conferido no
`apt-daily.service`). O único discriminador confiável entre "não instalado" e "rodou ok" é o
`LoadState` (`not-found` vs `loaded`). Foi exatamente esse engano que fez o vigia passar a olhar
um unit que não existia mais sem ninguém notar.

### 9.4 Medir "o dado está fluindo" pelo `db.json` dá alarme falso

O `db.json` só muda quando alguém se registra ou assina push. Medido: 49 h "parado" com o app em
uso diário, porque o que mudava era o `state-<uid>.json`. O sinal certo é o **arquivo mais novo
dentro do `data/`**.

### 9.5 `ssh` precisa de `-i` e de `-n`

A chave da VM **não tem nome padrão**, então sem `-i` o resultado é
`Permission denied (publickey)`. Na máquina de operação isso está resolvido com um alias no
`~/.ssh/config`:

```
Host opengym opengym-vm
    HostName <ip-da-vm>
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519_oracle
    IdentitiesOnly yes
    ConnectTimeout 10
```

Com esse bloco, `ssh opengym` (ou `ssh opengym-vm`) basta e o `-i` some do caminho. O
`IdentitiesOnly yes` é o que impede o `ssh` de ficar oferecendo outras chaves antes da certa, e o
`HostName` real não está neste documento de propósito (o repo é público).

E dentro de um script enviado por `bash -s < arquivo>`, todo
`ssh` precisa de **`-n`**: sem isso ele lê o próprio arquivo como stdin, engole o resto do script,
e a execução **para no meio com código 0**, parecendo sucesso.

### 9.6 Fim de linha LF, e `cmd /c` em vez de pipe

Scripts que vão para o Pi têm de ter quebra de linha **LF**; com CRLF o `bash` reclama de
`\r` e falha de formas criativas. No Windows, envie por redirecionamento, nunca por pipe do
PowerShell (que acrescenta CRLF no stdin):

```powershell
cmd /c "ssh hermes bash < %USERPROFILE%\hermes\scripts\script.sh"
```

E não use `|` dentro dessas aspas: quem interpreta o pipe é o `cmd`, não o `bash`.
Argumentos para `bash -s` vão depois de `--`: `bash -s -- --dry-run`.

### 9.7 Depois de trocar o DNS, 502 intermitente é normal por ~3 minutos

Depois do corte, 8 de 12 requisições deram 502 e depois 8 de 10, e isso **não** era registro
duplicado: a API da Cloudflare mostrava exatamente 1 CNAME apontando para o túnel novo. Era
propagação de borda. Convergiu para 20/20 em cerca de 3 minutos. Não saia "consertando" o DNS
nesse intervalo: a prova é a API, não o `dig` (com proxy ligado, o `dig` devolve o mesmo IP nos
dois casos e não diz nada).

### 9.8 O `.env` e o certificado não estão no git

`RP_ID`, `ORIGIN`, `og.crt` e `og.key` existem **só no disco**. Um restore que erre o `RP_ID`
obriga todo mundo a registrar passkey de novo. Por isso o `.env` passou a ir no backup do GitHub
e o pacote do R2 leva também `og.crt` e `og.key`.

## 10. O que NÃO fazer

- **Não rotacione o `data/secret` sem motivo.** Ele deriva o `agent.key` e assina as sessões;
  restaurar o backup já traz o certo.
- **Não rotacione o `data/vapid.json`.** Regenerar invalida todas as inscrições de push.
- **Não mude `RP_ID` nem `ORIGIN`.** É o defeito mais caro deste projeto (seção 4).
- **Não crie túnel novo sem motivo.** O DNS já aponta para o túnel atual; um túnel novo exigiria
  trocar o CNAME, e por nome isso falha em silêncio (armadilha 9.2).
- **Não rode dois escritores no mesmo `data/`.** Os JSON não fazem merge (seção 3).
- **Não ponha dado vivo dentro do clone do git** (a armadilha dos dois `data/`, seção 3).
- **Não confie no `dig`** para saber se o túnel está atendendo. A prova é o `/api/health`.
- **Não apague o app do Pi.** Ele é o continente: guarda os sensíveis, a mídia, a credencial do
  túnel e os dois sensores. A VM é a que pode morrer.
