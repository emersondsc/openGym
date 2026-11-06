# Spec: gravação direta pelo chat (fase 1, só o dono) — v1

## Regra numa frase

O treinador grava direto pelo chat **semana nova** (sem remarcar dia já ocupado ou treinado) e
**mesociclo novo** (inclusive já ativo). Ajuste avulso de rotina, apagar rotina, trocar ou apagar
mesociclo existente, ativar outro mesociclo e corrigir histórico continuam pedindo passkey no app.

## Decisões do Emerson (06/11/2026)

- Só criar entra direto; alterar e apagar seguem com passkey.
- A semana entra direto mesmo atualizando as rotinas que já existem (é a operação normal da semana),
  desde que não mude dia já marcado nem dia já treinado.
- Mesociclo novo entra direto e pode já ficar ativo.
- A confirmação acontece no chat: o treinador mostra o plano e só cria a proposta depois do "sim".

## Decisões assumidas (aprovar junto com a spec)

- **Um caminho só.** O MCP continua só criando o arquivo em `pending/`. A API decide e aplica. O MCP
  segue sem credencial e sem rede até a API.
- **Aumento de carga acima de 15% pede passkey** (aviso `WEIGHT_JUMP` com `pct > 15`). Redução não.
- **Mesociclo que tira uma restrição de saúde do ativo pede passkey** (aviso `RESTRICTION_DROPPED`).
- **Limite:** no máximo 10 gravações diretas em 24 h. Acima disso, a proposta fica para a passkey.
- **Treino em andamento:** a gravação espera. Assim que o treino termina, ela entra sozinha (até
  expirar em 7 dias).
- **Desligamento rápido:** `COACH_AUTO_APPLY=1` no `.env`. Sem a variável, tudo volta a pedir passkey.
- **Desfazer:** como hoje, por proposta inversa. Há snapshot antes de cada gravação.

## Comportamento

1. A API olha `pending/` a cada 3 s e quando a pasta muda (`fs.watch`).
2. Para cada proposta `pending` (ordem de criação) calcula `modoDe(S, p, sim)`:
   `{modo: 'auto'}` ou `{modo: 'passkey', motivo}` com motivo em `KIND_NEEDS_PASSKEY`,
   `REPLACES_DAYS`, `WEIGHT_JUMP`, `MESO_OVERWRITE`, `RESTRICTION_DROPPED`, `AUTO_LIMIT`, `AUTO_OFF`.
3. Se `auto`, aplica com a **mesma função** da aprovação por passkey (`aplicarProposta`): revalida,
   snapshot, `withState` com `ifMatch` do rev lido, auditoria `actor: 'claude'`,
   `verified: 'auto'` (ou `'passkey'` no caminho antigo), `proposalId`, e decisão
   `{status: 'applied', mode: 'auto' | 'passkey', rev, at, result_hash}` publicada com `link`.
   Entre ler o estado e gravar a decisão não há `await`, então ela não intercala com a aprovação
   manual nem com um PUT do app.
4. Proposta `stale`, `blocked` por outro motivo, ou com `modo: 'passkey'` fica como hoje, aguardando
   a passkey no app.

## MCP

- `app-api/proposals.js` é a mesma cópia da API, com `modoDe` exportado.
- `propose_change` prevê o modo com `modoDe`. Se `auto`, espera até 15 s pela decisão e devolve
  `{status: 'applied', mode: 'auto', message: 'Gravado no app.'}`; se não chegar, devolve
  `pending` com `message` explicando que vai entrar sozinha. Se `passkey`, devolve o link e o motivo
  em português ("ajuste de rotina existente pede sua passkey no app").
- `list_proposals` e `get_proposal` passam a mostrar `mode`.
- Descrição de `propose_change` e `treinador/INSTRUCOES.md` explicam a regra e exigem o "sim"
  explícito do Emerson no chat antes de chamar a ferramenta.

## App

- Lista de propostas e detalhe: proposta aplicada direto mostra "Gravada pelo chat".
- Cartão da Home: além das abertas, mostra por 3 dias as gravadas pelo chat, para o Emerson ver o
  que entrou sem ter aberto nada.

## Testes

API (`proposals.test.js`): `modoDe` por tipo e por aviso; aplicação automática de semana e de
mesociclo novo com auditoria `verified: 'auto'` e snapshot; `routine_patch`, `routine_delete`,
`mesocycle_action`, `history_fix`, semana com dia ocupado e mesociclo existente **não** aplicam;
treino em andamento espera e aplica depois; limite de 24 h; sem `COACH_AUTO_APPLY` nada aplica;
aprovação por passkey continua igual e grava `mode: 'passkey'`; corrida entre automático e passkey
gera uma decisão só.
MCP (`propostas.test.js`): previsão do modo, espera pela decisão, mensagens.
Front (`vitest`): rótulo "Gravada pelo chat" e cartão.

## Deploy e reversão

1. `git tag pre-gravacao-direta` no app e no MCP.
2. Suítes da API, do front e do MCP.
3. Deploy do app **sem** `COACH_AUTO_APPLY` e conferir que nada muda.
4. Deploy do MCP; conector: "Atualizar lista de ferramentas".
5. Ligar `COACH_AUTO_APPLY=1` e recriar a API.
6. Teste real: uma semana pelo chat entra direto; um ajuste avulso pede passkey.

Reversão: tirar `COACH_AUTO_APPLY` do `.env` e recriar a API.
