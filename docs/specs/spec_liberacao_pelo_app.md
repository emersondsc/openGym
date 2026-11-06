# Spec: liberar o treinador do chat pelo app (fase 3) — v1
## Objetivo
A pessoa ativa sozinha o treinador do chat no app. O Emerson não precisa mexer no Cloudflare nem no
servidor para cada pessoa: o controle dele continua sendo aprovar a conta no `/#/admin` (convite).
Quem não tem conta no app, ou não ativou, não passa da porta do conector.
## Decisões do Emerson (06/11/2026)
- O Cloudflare pergunta ao app, a cada login no conector, se o e-mail está liberado
  ("avaliação externa" do Access). O servidor não guarda nenhuma chave do Cloudflare.
  Se o plano gratuito não permitir isso (passo 0), esta spec para e volta para ele com o caminho do
  grupo + chave.
- A pessoa digita o e-mail no app. O Cloudflare prova que o e-mail é dela com o código que manda
  no login.
## Como a pessoa ativa
1. Configurações → "Treinador no chat" → digita o e-mail → lê o aviso de privacidade → "Ativar"
   (passkey). O app mostra o endereço do conector, o código de 8 letras (10 min, uso único) e os
   passos.
2. No claude.ai ela adiciona o conector, entra com aquele e-mail (código do Cloudflare) e diz o
   código ao Claude. O conector responde "Conectado como Maria".
3. "Desativar" tira o e-mail e a ligação na hora. Trocar de e-mail = desativar e ativar de novo.
## Decisões assumidas (aprovar junto)
- **Lista de liberados:** `coach-links/state/allowed.json`, escrita só pela API:
  `{version:1, allowed:[{uid, email, enabled_at}]}`. Um e-mail por conta, uma conta por e-mail.
  Só entra conta ativa (não desabilitada no admin).
- **O e-mail do login tem de ser o da ativação:** `link_account` só liga se o e-mail do token do
  Access for o e-mail que aquela conta ativou. Um código vazado não serve para outra pessoa.
- **Desabilitar no admin** tira a pessoa da lista e desfaz a ligação na hora.
- **Corte imediato:** o login do Access dura 24 h, então o MCP confere a lista do app em toda
  requisição. Quem saiu da lista perde o acesso no próximo pedido, sem esperar o Cloudflare.
- **O Emerson não muda nada:** a política atual com o e-mail dele continua e o
  `acesso.json` continua valendo para ele. O MCP aceita quem está em `acesso.json` **ou** em
  `allowed.json`.
- **Cloudflare (com confirmação dele antes de cada mudança):** uma política nova, só do app
  `gym-mcp`: inclui qualquer e-mail com código por e-mail e exige a avaliação externa. A política
  "Emerson da Silva Cardozo" é compartilhada com o `hermes` e **não é alterada**.
- **Aviso de privacidade no próprio app:** a tela de ativação diz em duas frases que os dados de
  treino passam pelo Claude da própria pessoa; ativar vale como ciência. Substitui o aviso por
  escrito da fase 2.
- **Papel:** quem ativa entra como convidado, só leitura, como na fase 2.
- **Limite do plano gratuito:** 50 pessoas no Access. Quem tenta entrar e é recusado não deveria
  contar; isso é conferido no teste real.
## Implementação
### App (API)
- `api/coach-access.js` (novo):
  - par de chaves RSA gerado na primeira vez em `DATA_DIR/coach-access-key.pem` (0600, nunca sai
    em log nem no repo);
  - `GET /api/coach-access/keys`: chave pública no formato JWKS;
  - `POST /api/coach-access/evaluate`: recebe `{token}`, confere a assinatura com as chaves do time
    (`https://<time>/cdn-cgi/access/certs`, RS256) e a validade; responde `{token}` assinado com
    `{success, nonce, iat, exp: iat+60}`. `success` é verdadeiro só se o e-mail está em
    `allowed.json`. Token inválido → `success:false`. Sem dados pessoais na resposta nem no log
    (só o resultado e o uid);
  - leitura/gravação de `allowed.json` (atômica, 0644).
- `api/coach-link.js`: `POST /api/coach-link/activate` (e-mail + passkey com verificação do
  usuário: grava em `allowed.json` e devolve o código, no mesmo passo); `unlink` passa a tirar
  também o e-mail; `processar` recusa com `EMAIL_MISMATCH` quando o e-mail do token não é o da
  ativação (o dono continua sem essa regra). `GET /api/coach-link` devolve também o e-mail ativado.
- `POST /api/admin/user/disable`: ao desabilitar, tira de `allowed.json` e de `links.json`.
- `.env`: `COACH_ACCESS_TEAM=flat-snowflake-0a35.cloudflareaccess.com`.
### App (tela)
- "Treinador no chat": campo de e-mail, aviso, Ativar, código e passos; ativado → e-mail,
  estado da ligação, Desativar.
### MCP
- `acesso.js`: aceita o e-mail se estiver em `acesso.json` ou em `coach-links/state/allowed.json`
  (lido em toda requisição). O resto não muda.
### Cloudflare
- Passo 0 (teste, sem efeito para ninguém): criar a política nova no `gym-mcp` apontando para
  `https://opengym.edsc.fun/api/coach-access/evaluate` e `/keys`. Se o Cloudflare recusar por
  plano, parar. Enquanto o app não responde, a regra nova recusa todo mundo e o Emerson entra pela
  política dele.
## Testes
- API: avaliação aceita e-mail liberado, recusa não liberado, token com assinatura errada,
  vencido ou de outro time; devolve o nonce; JWKS confere com a assinatura. Ativar exige passkey,
  recusa e-mail inválido e e-mail já usado por outra conta; desativar e desabilitar no admin tiram
  da lista e da ligação; `EMAIL_MISMATCH`.
- MCP: e-mail fora das duas listas é recusado; entra pela lista do app; sai da lista → recusado na
  requisição seguinte; isolamento da fase 2 continua passando.
- Front: tela de ativação.
## Deploy e reversão
1. Passo 0 com confirmação. 2. Tags `pre-liberacao-app`. 3. Suítes. 4. Deploy da API e da tela.
5. Deploy do MCP. 6. Teste real: com uma conta de teste (e-mail do Emerson secundário ou de quem ele
indicar), ativar, entrar no conector, ligar, ver só dados dela; desativar e ver o acesso cair;
um e-mail não ativado é recusado no login; conferir o contador de usuários do Access.
Reversão: apagar a política nova no Cloudflare (com confirmação) e voltar as tags. O acesso do
Emerson não depende de nada desta fase.
