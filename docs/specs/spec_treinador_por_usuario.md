# Spec: treinador do chat por usuário (fase 2) — v1

## Objetivo

Cada pessoa que entra no conector do claude.ai vê só os próprios dados. Quem não ligou a conta não
vê nada, nem os dados do Emerson. Nesta fase os convidados só leem; gravar continua só para o dono.

## Decisões do Emerson (06/11/2026)

- A ligação é feita pela própria pessoa, uma vez, no app, com a passkey.
- Uma pessoa por vez, primeiro só leitura.

## Como a pessoa liga a conta

1. No app: Configurações → "Treinador no chat" → "Ligar". O app pede a passkey (biometria ou PIN)
   e mostra um código de 8 letras, válido por 10 minutos e de uso único.
2. No claude.ai, com o conector OpenGym: "meu código do OpenGym é K7M4-Q2XP". O conector responde
   "Conectado como Maria".
3. Para desligar: Configurações → "Treinador no chat" → "Desligar". O acesso some na hora.

## Decisões assumidas (aprovar junto)

- **Identidade:** a chave é o `sub` do token do Cloudflare Access, validado em toda requisição
  (assinatura, `aud`, `iss`, validade). O e-mail fica só para exibir. Um `sub` liga a um usuário e um
  usuário a um `sub`.
- **Fonte da verdade:** `coach-links/state/links.json`, escrito só pela API. O MCP só lê. A política
  do Access e a lista de e-mails em `/etc/opengym-mcp/acesso.json` continuam sendo só a porta.
- **Sem ligação, sem dados:** quem passou pela porta mas não ligou a conta só vê `get_status`
  (dizendo como ligar) e `link_account`. Nunca há usuário padrão.
- **O dono também liga** pelo mesmo caminho, uma vez, no deploy. Até ligar, o conector dele fica sem
  dados (alguns minutos).
- **Ferramentas por papel**, montadas por requisição a partir da ligação:
  - sem ligação: `get_status`, `link_account`;
  - convidado (só leitura): leituras, análises, `get_publish_log` e memória do treinador própria;
  - dono: tudo, como hoje (inclusive propostas e `validate_plan`).
  Nenhuma ferramenta recebe uid, caminho ou nome de usuário como entrada.
- **Cópia filtrada por usuário:** `coach-mirror/<uid>/` para cada usuário ligado, gerada pelo mesmo
  filtro. Quem ainda não treinou recebe uma cópia vazia válida. Ao desligar, a cópia é apagada.
- **Memória do treinador por usuário:** `coach-memory/<uid>/`. A memória atual vai para o dono.
- **Correções de dados do dono** (máquinas em libras, ajustes de exercício, cabeças do deltoide) só
  valem para o dono. Para os outros, nada é corrigido.
- **Proteção do código:** 5 tentativas erradas por hora por identidade; depois, espera.
- **LGPD, mínimo:** antes de liberar alguém, o Emerson manda um aviso curto por escrito dizendo que
  os dados de treino passam pelo Claude da própria pessoa. Fora do sistema.

## Implementação

### App (API)
- `api/coach-link.js` (novo): códigos em memória (`code -> {uid, exp}`), varredura de
  `requests/` (mesmo relógio de 3 s da fase 1), validação, `links.json` com escrita atômica 0644,
  `results/<req>.json`, limite de tentativas, `unlink`.
- Rotas: `POST /api/coach-link/challenge`, `POST /api/coach-link/start` (passkey com verificação do
  usuário, desafio próprio que não serve para outra coisa), `GET /api/coach-link`,
  `POST /api/coach-link/unlink`.
- `links.json`: `{links: [{sub, email, uid, name, owner, access, linked_at}]}`; `owner` vem de
  `COACH_OWNER_UID`, `access` é `write` para o dono e `read` para os outros.

### App (tela)
- Configurações: linha "Treinador no chat" com estado, botão Ligar (código e instrução) e Desligar.

### MCP
- `acesso.js` devolve `{email, sub}`; sem `sub`, recusa.
- `usuarios.js` (novo): lê `links.json` a cada requisição e resolve o contexto
  `{uid, nome, email, papel}`.
- `dados.js`: um leitor por uid em `coach-mirror/<uid>/`; correções anexadas só ao do dono.
- `memoria.js`: pasta por uid. `propostas.js`: só no contexto do dono.
- `server.js`: registra as ferramentas conforme o papel; `link_account(code)` grava o pedido e
  espera a resposta da API.

### Espelho (systemd)
- `espelho/todos.py` (novo): para cada uid de `links.json`, filtra o state e as publicações para
  `coach-mirror/<uid>/` e apaga pastas de quem saiu. A saúde roda por uid.
- A path unit passa a observar a pasta `data/`; as units antigas do uid fixo saem.

### Pastas
```
coach-links/requests   ubuntu 755  (MCP grava, API lê)
coach-links/state      root 755    (API grava links.json e results/, MCP lê)
```

## Testes
- API: código expira, é de uso único, preso ao usuário que gerou; limite de tentativas; um `sub`
  não liga a dois usuários e vice-versa; desligar apaga; a passkey do desafio de ligação não serve
  para propostas nem para passkeys.
- MCP: **isolamento** — dois usuários ligados com marcas diferentes nos dados; A chama todas as
  ferramentas do papel e nenhuma resposta traz marca de B; quem não está ligado não lista nem chama
  nenhuma ferramenta de dados; convidado não lista nem chama propostas; estado vazio em todas as
  ferramentas de leitura; correções do dono não aparecem para outro.
- Espelho: um uid por pasta, cópia vazia para quem não treinou, limpeza de quem saiu.
- Front: tela de ligação.

## Deploy e reversão
1. Tags `pre-por-usuario`. 2. Suítes. 3. Pastas. 4. Deploy da API e da tela. 5. Emerson liga a conta
dele. 6. Deploy do MCP e das units novas; memória movida. 7. Teste real: o Emerson vê os dados dele;
uma identidade sem ligação não vê nada.
8. Liberar a primeira pessoa (só leitura): e-mail na política do Access (mudança na Cloudflare,
com confirmação) e em `acesso.json`; ela liga a conta.

Reversão: voltar as tags e as units antigas. Corte de emergência de uma pessoa: "Desligar" no app
dela, ou apagar a entrada em `links.json`.
