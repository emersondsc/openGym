# Spec: propostas do treinador no openGym — v3

## Contexto e Objetivo

Hoje o Claude lê e analisa o openGym pelo MCP, mas não grava. Quem publica é o Hermes, no Pi. Esta
spec faz o Claude publicar no app sem Hermes nem Pi: ele cria uma proposta, o app simula e mostra o
que muda, e o Emerson aprova com a passkey. Quem grava é a API do app, nunca o MCP.

- **App:** `/mnt/drivebackup/apps/openGym/openGym`, ramo `emerson-custom`, API Node sem framework,
  React + Vite, deploy por `docker compose up -d --build` na VPS.
- **MCP:** `/opt/opengym-mcp`, repositório próprio, sem credencial do app.
- **Invariante:** o MCP continua sem credencial. Toda escrita de proposta exige sessão do dono e
  prova de passkey presa ao conteúdo exato que ele viu.

## Escopo

**Inclui**

- Propostas de semana, ajuste de rotina, exclusão de rotina, mesociclo, ativação ou exclusão de
  mesociclo e correção de histórico.
- Tela de propostas com simulação do efeito real, cartão na Home e acesso por Configurações.
- Aprovação com passkey e biometria ou PIN; recusa com motivo opcional.
- Detecção de proposta desatualizada olhando só o que ela altera.
- Snapshot do estado antes de cada aplicação, para emergências.
- Ferramentas MCP `propose_change`, `list_proposals`, `get_proposal`, `cancel_proposal`.
- Registro na auditoria com `actor: claude`.

**Não inclui**

- Aplicação automática: toda escrita passa pela sua aprovação.
- Botão de desfazer. Para voltar atrás, o Claude cria uma proposta inversa.
- Regravar o estado inteiro.
- Editar `week` diretamente, exercícios próprios ou configurações do perfil. Exceção:
  `routine_delete` limpa as referências da rotina em `week` e `dayPlan`, como a rota atual, e a tela
  mostra isso.
- Criar, apagar ou mudar data de sessão, e desmarcar série como feita.
- Notificação push: o aviso é o cartão na Home e o link que o Claude envia.
- Desligar o Hermes: as rotas dele não mudam de comportamento.
- Regras de treino no servidor além dos avisos desta spec.

## Decisões do Emerson

- Toda escrita tem aprovação manual, sem exceção.
- Tudo que o Hermes faz o Claude também pode propor, inclusive corrigir histórico.
- Hermes e Claude seguem publicando; o Hermes é disparado à mão.
- Sem botão de desfazer: reversão por proposta inversa.
- Se uma edição manual em outro aparelho sincronizar depois, ela vence, e o treinador vê a diferença
  na revisão seguinte.
- Aprovar autoriza os dias ocupados listados na tela.

## Decisões assumidas

- **Armazenamento em arquivo, fora de `data/`.** `coach-proposals/` tem uma pasta por escritor. Sem
  efeito visível.
- **`rev` não mede proposta velha.** Ele sobe a cada salvamento do app. A proposta guarda `base_hash`
  do que ela altera.
- **Projeção comum.** MCP e API calculam o hash sobre `projetar()`, com os campos que existem na
  cópia filtrada. `sec` entra na cópia para cobrir séries por tempo.
- **Aprovação presa ao que foi visto.** O `GET` calcula `approval_hash` sobre plano, base e efeito
  simulado. O desafio de passkey é emitido para esse hash e essa proposta. Após a prova a API relê
  tudo e recalcula; se algo mudou, nada é gravado.
- **Simulação no servidor.** A tela não calcula o efeito. A API aplica num clone e devolve a diferença
  folha a folha, inclusive padrões preenchidos pelo app e efeitos colaterais.
- **O que o Claude não vê é preservado.** Campos fora da projeção, como `ex.bodyweight` ou extras do
  mesociclo, são copiados do estado atual no caminho das propostas. As rotas antigas não mudam.
- **Correção de histórico no servidor.** `api/history-fix.js` porta o recálculo de `applyWorkoutEdit`,
  com teste de paridade contra o front. Assim nenhuma escrita acontece sem passkey.
- **Aplicar sem passar pelas rotas de agente.** A lógica de cada escrita é extraída em funções
  `apply*`, usadas pela rota antiga e pela aprovação.
- **Horário fora do hash.** `apply*` recebem `agora`. A simulação usa `created_at` da proposta, então
  `updatedAt` e `activatedAt` não mudam entre o `GET` e a aprovação. `rev` e `_ts` ficam fora de
  `changes`.
- **Leitura crua para corrigir histórico.** `get_session` passa a expor os valores gravados e os
  índices, porque `history_fix` precisa do `from` exato.
- **Identidade.** `actor: 'claude'`, `verified: 'passkey'`, `proposalId`. Mesociclo aprovado recebe
  `activatedBy: 'assistant'`.
- **Biometria ou PIN.** `requireUserVerification: true` só na aprovação de proposta.
- **Dono por configuração.** `COACH_OWNER_UID` no `.env`. Sem a variável, as rotas respondem 404, o
  que serve de desligamento rápido.
- **Mesociclo apagado pode voltar nesta versão.** O app não tem marca de exclusão. Se outro aparelho
  com dado antigo sincronizar, o mesociclo reaparece. O treinador vê isso em `changed_after_apply`, e
  impedir exigiria mudar a mescla do app, fora deste escopo.
- **Treino em andamento bloqueia toda aprovação.** O app confere `S.active` neste aparelho; a API
  confere a presença de outro aparelho.
- **Snapshot só para emergência.** Ficam os 10 mais recentes, por até 30 dias, sem rota nem botão.
- **Avisos recalculados pela API.** A tela confia nos avisos do servidor. O texto do Claude aparece
  rotulado como explicação do treinador.

## Requisitos Funcionais

RF-1. `propose_change` recusa plano com erro em `validate_plan` e não grava arquivo.

RF-2. A proposta é um arquivo `pending/<id>.json` com `id`, `kind`, `plan`, `title`, `summary`,
`reasons[]`, `base_hash`, `created_at`, `expires_at` (7 dias) e `created_by`.

RF-3. Limites, conferidos no MCP e de novo na API: 20 propostas abertas, 128 KB por arquivo, 200
caracteres em `title`, 2.000 em `summary`, 30 itens em `reasons`, 500 por item, 50 operações em
`history_fix`. Arquivo fora do limite, malformado, com `id` diferente do nome ou que não seja arquivo
regular é ignorado, registrado no log e não afeta os demais. Um plano com `autorizar` é recusado no
MCP e na API.

RF-4. O estado segue esta precedência, e o primeiro que valer ganha:

| Ordem | Estado | Condição |
|---|---|---|
| 1 | `applied` ou `rejected` | Existe decisão gravada, ou a auditoria tem o `proposalId` |
| 2 | `canceled` | Existe marcador `<id>.canceled` |
| 3 | `expired` | `expires_at` passou |
| 4 | `stale` | `base_hash` não confere |
| 5 | `blocked` | A API recusaria agora; `blocked_reason` é o código do 409, inclusive `WORKOUT_IN_PROGRESS` e `NO_CHANGES` |
| 6 | `pending` | Pode ser aprovada |

Quando o estado 1 vier da auditoria, a API regrava a decisão, porque a auditoria rotaciona.

RF-5. `GET /api/proposals` exige sessão do dono e lista `pending`, `stale` e `blocked`, mais recente
primeiro, com `?all=1` incluindo as demais. Outro usuário recebe 403. Sem `COACH_OWNER_UID`, 404.

RF-6. `GET /api/proposals/:id` devolve proposta, estado, `changes[]`, `dates_replaced[]`, `warnings[]`
e `approval_hash`. `changes[]` traz toda folha do JSON que difere entre o estado atual e o simulado.

RF-7. `POST /api/proposals/:id/challenge` recebe `approval_hash`, confere que a proposta está `pending`
e que o hash atual é igual, e só então devolve `{cid, options}`, com `userVerification: 'required'` e
o desafio preso ao dono, à proposta e ao hash. Se não conferir, responde 409 sem pedir biometria.

RF-8. `POST /api/proposals/:id/approve` recebe `{cid, credential, approval_hash}` e executa nesta
ordem. Entre os passos 3 e 10 não há `await`, então a decisão é atômica dentro do processo.
1. sessão do dono e id válido;
2. prova de passkey presa a esta proposta e a este hash, com verificação do usuário, e `saveDb()`;
3. relê a proposta e o estado;
4. estado precisa ser `pending`; senão, 409 com o código do estado ou `blocked_reason`;
5. recalcula `approval_hash`; diferente dá 409 `PROPOSAL_CHANGED`;
6. confere de novo a presença de treino, que pode ter mudado durante a prova;
7. revalida o plano já com os campos preservados e `autorizar.datas` igual a `dates_replaced`;
8. grava o snapshot;
9. aplica com `withState`, `ifMatch = String(rev)` lido no passo 3;
10. grava `decisions/<id>.json` com `status`, `rev`, `at` e `result_hash`, escrevendo em temporário e
    publicando com `link`, que falha se a decisão já existir.

RF-9. Nos passos 3 a 7, nada muda no estado. A proposta continua aberta, e a resposta diz o motivo.
A prova de passkey é consumida; nova tentativa pede outra prova.

RF-10. Duas decisões simultâneas sobre a mesma proposta resultam em uma só: a outra recebe 409
`PROPOSAL_DECIDED`. Se o passo 10 falhar depois do 9, o `proposalId` na auditoria mantém a proposta
como `applied`.

RF-11. `POST /api/proposals/:id/reject` não exige passkey, aceita motivo de até 500 caracteres, nunca
grava no estado e usa a mesma publicação atômica de RF-10.

RF-12. `get_publish_log` mostra a escrita com `actor`, `verified`, `proposalId` e ação em até 1 minuto.

RF-13. Antes do desafio, o app confere `S.active`, envia qualquer edição local pendente e relê a
proposta. Se o hash mudou, mostra a tela atualizada e pede nova confirmação. Depois da aprovação,
chama `pullState(false)`. Rotina editada à mão em outro aparelho vence pela mescla atual. Mesociclo
apagado pode voltar por essa mesma mescla, e isso aparece em `changed_after_apply`.

RF-14. `result_hash` é `hashBase` do estado logo após aplicar. `get_proposal` traz
`changed_after_apply: true` quando o hash atual difere. O campo é indicativo: em mesociclos, a
normalização do app num salvamento posterior pode acendê-lo sem mudança real.

RF-15. Toda folha de `changes[]` aparece na tela. O que não tiver visual próprio entra em "Outros
campos", com caminho, antes e depois.

RF-16. Texto da proposta é exibido como texto puro e rotulado "Explicação do treinador". Avisos do
servidor aparecem antes dele.

RF-17. `history_fix` aceita `field` em `w`, `r`, `sec`, `min`, `speed`, `rir`, `rpe` e `wUnit`. Exige
`from` igual ao valor atual, com `null` equivalente a ausente, sem conversão de tipo, e `to` diferente
de `from`. Só `rir` e `rpe` aceitam `to: null`. Faixas: `w` 0..1000, `r` 0..200, `sec` 1..3600,
`min` 1..600, `speed` 0..40, `rir` 0..10, `rpe` 1..10, `wUnit` `kg` ou `lb`. `set_index` e `entry_index`
começam em 0. Duas operações no mesmo campo da mesma série são proibidas. Uma operação inválida
recusa a proposta inteira.

RF-18. Data vencida numa semana deixa a proposta `blocked`, com motivo. Aprovação nunca aplica parte
de uma proposta. Proposta sem efeito real fica `blocked` com `NO_CHANGES`.

## Detalhe de Implementação (nível código)

### 1. Formato de `plan` por tipo

| `kind` | `plan` |
|---|---|
| `week` | `{meso_id, semana, report_id?, routines[]}`, sem `autorizar` |
| `routine_patch` | `{routine_id, patch}` |
| `routine_delete` | `{routine_id}` |
| `mesocycle` | `{meso, activate: 'now' | 'none'}` |
| `mesocycle_action` | `{meso_id, action: 'activate' | 'delete'}` |
| `history_fix` | `{ops[]}` |

`op = {workout_id, exercise_id, entry_index?, set_index, field, from, to}`. `validate_plan` passa a usar
exatamente esses formatos, inclusive `{meso, activate}`.

### 2. Pastas e compose

Criadas antes do deploy, senão o Docker as cria como root:

```bash
sudo install -d -o ubuntu -g ubuntu -m 700 /mnt/drivebackup/apps/openGym/coach-proposals
sudo install -d -o ubuntu -g ubuntu -m 755 /mnt/drivebackup/apps/openGym/coach-proposals/pending
sudo install -d -o root -g root -m 755 /mnt/drivebackup/apps/openGym/coach-proposals/decisions
sudo install -d -o root -g root -m 700 /mnt/drivebackup/apps/openGym/coach-proposals/snapshots
```

App, serviço `api`:

```yaml
      - /mnt/drivebackup/apps/openGym/coach-proposals/pending:/coach-proposals/pending:ro
      - /mnt/drivebackup/apps/openGym/coach-proposals/decisions:/coach-proposals/decisions
      - /mnt/drivebackup/apps/openGym/coach-proposals/snapshots:/coach-proposals/snapshots
```

MCP:

```yaml
      - /mnt/drivebackup/apps/openGym/coach-proposals/pending:/coach-proposals/pending
      - /mnt/drivebackup/apps/openGym/coach-proposals/decisions:/coach-proposals/decisions:ro
```

Arquivos de `decisions/` têm modo 0644, porque o MCP roda como 1001, e o MCP ignora arquivo que não
consiga ler. Snapshots usam `writeFileSync` com `mode: 0o600`, sem `atomicWrite`, que não aceita modo.
`.env` ganha `COACH_OWNER_UID`. `RP_ID` e `ORIGIN` não mudam.

### 3. `api/micro.js`, `api/meso.js`, `api/routines.js`

Extrai sem mudar comportamento:

```js
// micro.js
export function applyPublish(S, body, catalog) { /* corpo atual do withState, sem _meta */ }
// meso.js
export function applyPutMeso(S, body, stamp, agora) {}      // stamp: 'assistant' | 'user'
export function applyActivateMeso(S, mid, stamp, agora) {}
export function applyDeleteMeso(S, mid) {}
// routines.js
export function applyRoutinePatch(S, rid, body, catalog, custom) {}
export function applyRoutineDelete(S, rid, force) {}
```

Cada handler antigo monta o mesmo `_meta` de hoje. Um teste compara o registro de auditoria da rota
antiga antes e depois da extração.

Opções de `withState` no caminho das propostas:

| `kind` | `action` | `dropActive` | `_meta` |
|---|---|---|---|
| `week` | `publish-micro` | false | `meso_id, semana, report_id, routines, criadas, trocadas, progAntes, progDepois, datas, dayPlan, trained, proposalId` |
| `routine_patch` | `patch-routine` | false | `routines, proposalId` |
| `routine_delete` | `delete-routine` | true | `routines, proposalId` + varredura |
| `mesocycle` | `put-meso` | false | `mesoId, created, activated, activate, proposalId` |
| `mesocycle_action` | `activate-meso` ou `delete-meso` | false | `mesoId, proposalId` + `deleted, wasActive` |
| `history_fix` | `history-fix` | false | `workouts, ops, proposalId` |

### 4. `api/proposals.js` (novo)

```js
const CAMPOS_ROTINA = ['id', 'name', 'emoji', 'prog'];
const CAMPOS_EX = ['id', 'sets', 'reps', 'weight', 'mode', 'restSec', 'unit', 'sec', 'min', 'speed',
                   'inc', 'repsMin', 'repsMax', 'side', 'sg', 'prog'];
const CAMPOS_MESO = ['id', 'name', 'start', 'end', 'goal', 'origin', 'priorities', 'rules', 'weeks',
                     'evidence', 'log', 'cargas_prescritas', 'estrutura_atual', 'status_semanas',
                     'fonte', 'criado_em', 'atualizado_em'];
const CAMPOS_SET = ['done', 'w', 'wUnit', 'r', 'rir', 'rpe', 'min', 'speed', 'sec'];
export const so = (o, c) => Object.fromEntries(c.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]));

export function projetar(S, kind, plan) { /* por kind, com as listas acima */ }
export const hashBase = (S, kind, plan) => sha256(canon(projetar(S, kind, plan)));

/** Campos que o Claude nao ve seguem iguais. So copia chave ausente no plano e fora da projecao. */
export function preservarOcultos(kind, plan, S) { /* devolve plan com ex.* e meso.* ocultos do estado */ }

/** Efeito real: aplica num clone com `agora = p.created_at`, valida o resultado depois de preservar
    ocultos (inclusive MAX_MESO_BYTES) e ignora `rev` e `_ts`. Devolve {changes, dates_replaced} ou {error}. */
export function simular(S, proposta, catalog) {}

export const diffFolhas = (antes, depois, prefixo = '') => { /* {path, before, after} por folha */ };
export const avisos = (S, kind, plan) => []; // WEIGHT_JUMP, RESTRICTION_DROPPED, MESO_OVERWRITE...
export const approvalHash = (p, base, changes, dates_replaced) =>
  sha256(canon({ id: p.id, kind: p.kind, plan: p.plan, title: p.title, summary: p.summary,
                 reasons: p.reasons, base, changes, dates_replaced }));
```

`dates_replaced` sai de `findConflicts` e lista cada dia ocupado, com a rotina atual, a origem e se já
houve treino nele. Faz parte de `approval_hash`. No `approve`, `autorizar.datas` recebe exatamente
essa lista. `week` usa `validatePublish(..., todaySP(), ...)`; data vencida vira `blocked`.

`makeHandlers(deps)` exporta `listProposals`, `getProposal`, `challengeProposal`, `approveProposal` e
`rejectProposal`. Nunca exportar `list`, que sobrescreveria `GET /api/routines` no
`Object.assign(ROUTINE_HANDLERS, ...)`.

Leitura segura de `pending/`: nome em `/^prop-[a-z0-9-]{1,40}\.json$/`, `lstat` de arquivo regular,
tamanho até 128 KB, `try` por arquivo, `id` igual ao nome e formato validado. Temporários e `.canceled`
não são tratados como proposta.

### 5. `api/server.js`

```js
// PATTERNS
{ method: 'GET',  re: /^\/api\/proposals\/(prop-[a-z0-9-]{1,40})$/, params: ['pid'], handler: 'getProposal' },
{ method: 'POST', re: /^\/api\/proposals\/(prop-[a-z0-9-]{1,40})\/challenge$/, params: ['pid'], handler: 'challengeProposal' },
{ method: 'POST', re: /^\/api\/proposals\/(prop-[a-z0-9-]{1,40})\/approve$/, params: ['pid'], handler: 'approveProposal' },
{ method: 'POST', re: /^\/api\/proposals\/(prop-[a-z0-9-]{1,40})\/reject$/, params: ['pid'], handler: 'rejectProposal' },
// mapa
'GET /api/proposals': (req, res) => ROUTINE_HANDLERS.listProposals(req, res),
// GET /api/me, login e registro devolvem a mesma forma
const publicUser = user => ({ id: user.id, name: user.name, admin: isAdmin(user), coachOwner: user.id === COACH_OWNER_UID });
```

`checkAssertion(c, credential, cred, uv = false)` passa `requireUserVerification: uv`.
O desafio de proposta usa campo próprio, `{ proposalReauth: user.id, proposalId, approvalHash }`, e
nunca `reauth`. Assim ele não serve para adicionar ou remover passkey, e o desafio comum não serve
para aprovar. `proveProposal(body, user, id, hash)` é uma função separada de `proveOwner`, com
`uv = true`. `sameSiteWrite` já cobre as novas rotas POST.

### 6. `api/history-fix.js` (novo)

Puro, recebe `S` e `ops` e altera `S`:

1. agrupa `ops` por treino e valida RF-17;
2. aplica as operações em cada série, removendo a chave quando `to` for `null`;
3. em cada exercício tocado, recalcula `topW` como em `applyWorkoutEdit`;
4. recalcula `w.vol` com a fórmula de `workoutVolume`, usando `api/units.js`; lá `unitOfSet` recebe
   `normUnit(S.unit)`, não `S`;
5. recalcula `w.prs` só do treino editado, com a regra de `bestEntryFor`;
6. recalcula `S.exWeights` dos exercícios tocados, com a regra de `applyWorkoutEdit`.

Não recalcula recordes de treinos posteriores, porque o app também não faz isso. Não remove entrada
nenhuma: `done` não é editável, então toda série feita continua feita.

### 7. Frontend

- `lib/api.js`: exporta `provePasskeyFor(url, body)` com as opções devolvidas pelo `challenge`.
- `lib/proposals.js` (novo): `listProposals`, `getProposal`, `approveProposal`, `rejectProposal`.
- `lib/proposal-diff.js` (novo, puro e testado): agrupa `changes[]` por rotina, exercício, dia, regra e
  série. O que sobrar vai para "Outros campos". Toda folha aparece exatamente uma vez.
- `views/Proposals.jsx` (novo): lista e detalhe.
- `store/useStore.js`: `pushState` passa a devolver `{ok, rev}` e zera `pushTm`, e a nova ação
  `flushBeforeApproval()` envia o push agendado. Sem sucesso, o app não abre o desafio. Com sucesso,
  relê a proposta e compara `approval_hash`.
- `App.jsx`: rotas `/proposals` e `/proposals/:id`.
- `Home.jsx`: `ProposalsCard` acima de `ExerciseProgressCard`, só com `user.coachOwner`, que também vem
  no login e no registro.
- `Settings.jsx`: linha "Propostas do treinador", só com `user.coachOwner`.
- `locales/pt.js`: textos em `t()`. Inglês é a chave.

### 8. MCP

- `app-api/` ganha `proposals.js`, `history-fix.js` e `units.js`. `VALIDADORES` de `saude.py` passa a
  conferir os três, e `Dockerfile` copia `propostas.js`.
- `ferramentas.js`: `get_session` passa a devolver, em cada exercício, `entry_index`, e em cada série
  `set_index` (base 0) e `raw`, com os campos exatos gravados, inclusive `sec`, `rpe`, `rir` e `wUnit`.
- `validacao.js` importa `avisos` de `app-api/proposals.js` e soma só a checagem de libras.
- `filtra.py`: `SET` ganha `sec`.
- `publicacoes.py`: `CAMPOS` ganha `proposalId`, `meso_id`, `semana`, `routines` e `datas`.
- `propostas.js` (novo): grava `.tmp-*` e faz `rename`; `cancel` cria `<id>.canceled`; conta abertas
  cruzando com `decisions/`; ao criar proposta, apaga de `pending/` o que estiver aplicado, recusado,
  cancelado ou expirado há mais de 90 dias, com o marcador. `decisions/` fica como histórico.
- `validacao.js` troca a mensagem que manda usar `autorizar.datas`: o dia ocupado agora só é informado.
- `server.js`: `z.enum` do `validate_plan` com os seis tipos, e as ferramentas abaixo.

| Ferramenta | Entrada | Hints |
|---|---|---|
| `propose_change` | `kind`, `plan`, `title`, `summary`, `reasons[]` | `readOnlyHint: false`, `destructiveHint: false` |
| `list_proposals` | `status?`, `cursor?`, `limit?` | leitura |
| `get_proposal` | `id` | leitura |
| `cancel_proposal` | `id` | `readOnlyHint: false`, `destructiveHint: false` |

`propose_change` devolve `id`, avisos e `https://opengym.edsc.fun/#/proposals/<id>`.

### 9. Backup

`backup_to_github.sh` inclui `pending/` e `decisions/`. Snapshots ficam fora do git, porque são o
estado inteiro.

### 10. Ordem de deploy

1. `git tag pre-propostas` no app.
2. Rodar a suíte da API e do front.
3. Criar as pastas.
4. Deploy do app com `COACH_OWNER_UID`, e conferir que o Hermes publica.
5. Atualizar `app-api/`, `filtra.py`, `publicacoes.py` e `saude.py`; publicar o MCP.
6. Conector: "Atualizar lista de ferramentas".
7. Atualizar as instruções do treinador, saindo do modo sombra.

Reversão: remover `COACH_OWNER_UID` desliga as rotas; voltar à tag desfaz o código.

### 11. Testes

**API (`api/proposals.test.js`, `api/history-fix.test.js`)**

1. Sem `COACH_OWNER_UID`, as rotas respondem 404.
2. Outro usuário recebe 403 nas cinco rotas.
3. `GET /api/routines` segue funcionando.
4. Aprovar sem prova, com prova de outra proposta ou sem verificação do usuário não grava.
5. Proposta alterada no disco após o `GET` dá `PROPOSAL_CHANGED`.
6. Base alterada dá estado `stale`.
7. Presença de treino dá `WORKOUT_IN_PROGRESS`.
8. Cada `kind` gera o mesmo resultado da rota antiga, com campos ocultos preservados.
9. Toda folha alterada aparece em `changes`.
10. Duas decisões simultâneas geram uma.
11. Auditoria da rota antiga idêntica à de antes da extração.
12. Auditoria da proposta com `actor`, `verified` e `proposalId`.
13. Symlink, arquivo grande, JSON quebrado e id divergente são ignorados, sem derrubar a lista.
14. Falha ao gravar a decisão mantém `applied` pela auditoria.
15. Data vencida fica `blocked`.
16. `history_fix`: cada regra de RF-17 e operação inválida sem efeito parcial.
17. Dois `GET` com relógios diferentes dão o mesmo `approval_hash` em todos os tipos.
18. Plano com `autorizar` é recusado, e dia ocupado novo muda `approval_hash`.
19. Desafio de proposta não serve em `/api/passkeys/*`, e desafio comum não serve para aprovar.
20. Preservação que passa de `MAX_MESO_BYTES` fica `blocked`.
21. `changes` vazio fica `NO_CHANGES`.

**Paridade**

22. `projetar` em JS sobre `filtrar(estado)` gera o mesmo hash que sobre o estado real, com fixture que
    inclui treino por tempo, série em libras e campos extras.
23. `api/history-fix.js` e `applyWorkoutEdit` dão o mesmo `vol`, `prs`, `topW` e `exWeights`, inclusive em perfil em libras.

**Front:** `proposal-diff.test.js` cobre folha exatamente uma vez e "Outros campos".

**Regressão:** suítes atuais sem mudar testes existentes. Hermes publica uma semana depois do deploy.

**Manual em produção**, uma vez para cada tipo: criar pelo Claude, ver a tela, aprovar, conferir no app
e em `get_publish_log`, e reverter com proposta inversa. Mais: recusar; aprovar com outro aparelho em
treino; Hermes publicar antes da aprovação; edição manual depois da aprovação aparecer em
`changed_after_apply`.

## Critérios de aceite

- Os seis tipos passam no roteiro manual em produção.
- Nenhuma mudança da API vinda de proposta acontece sem prova de passkey presa ao conteúdo visto.
- O Hermes publica como antes, e a auditoria da rota antiga não muda.
- O MCP segue sem cookie, sem `secret` e sem `agent.key`.

## Comportamento Visual/UX

**Home.** O cartão aparece só com proposta aberta. Sem proposta, nada muda.

```text
+------------------------------------------+
| Treinador                         1 nova |
| Semana 2: ajuste de cargas        >      |
+------------------------------------------+
```

**Lista (`/proposals`).** Abertas primeiro, com tipo, título, data e estado. Selos: Aguardando,
Desatualizada, Bloqueada. "Histórico" mostra aplicadas, recusadas, canceladas e expiradas.

**Detalhe (`/proposals/:id`).** A ordem é fixa: o que o sistema apurou vem antes do texto do treinador.

```text
< Propostas
Semana 2: ajuste de cargas
Treinador · hoje 14:20 · expira em 7 dias

[!] Carga muda 18% em Elevação lateral
[!] Sexta tem outro treino: será trocado

O QUE MUDA
Delt A
  Elevação lateral   35 kg   ->  37,5 kg
  Press máquina      3 séries -> 4 séries
Dias
  Sex 13/11   Delt C  ->  Delt A
Outros campos (1)   v

EXPLICAÇÃO DO TREINADOR
Texto puro.

[ Aprovar com passkey ]
[ Recusar ]
```

**Aprovar.** O toque envia edições pendentes, relê a proposta e abre a passkey, com biometria ou PIN.
Sucesso mostra o aviso "Aplicado ao seu plano" e volta à lista.

**Quando não dá para aprovar.** O botão fica desativado, com o motivo em uma linha:

| Situação | Mensagem |
|---|---|
| Treino neste aparelho | Termine o treino para aprovar |
| Treino em outro aparelho | Há um treino em andamento em outro aparelho |
| Desatualizada | O plano mudou depois desta proposta. Peça uma nova ao treinador. |
| Data vencida | Esta proposta tem um dia que já passou |
| Mudou durante a revisão | A proposta mudou. Confira de novo antes de aprovar. |
| Sem efeito | Esta proposta não muda nada |

**Recusar.** Abre uma folha com motivo opcional e confirma sem passkey.

**Correção de histórico.** Cada linha mostra treino, data, exercício e série: `Série 2: 474 kg -> 47,4 kg`,
e avisa que volume e recordes daquele treino serão recalculados.
