# Spec: Unidade por exercício (kg/lb) — v1

> BACKLOG-01 · repo `openGym` · branch `emerson-custom` · base `7aa3935` · 2026-09-11

## Contexto e Objetivo

Hoje a unidade de peso é **uma só para o perfil inteiro**: `S.unit = 'kg' | 'lb'` (`frontend/src/store/useStore.js:12`). Ela governa a exibição (`exLine`, `setLabel`, `WeightInput`, `Stats`, plano impresso) e a conversão da análise (`api/coach.js:44-45`).

Dois exercícios do perfil são de máquinas cuja escala é em **libras** — `0585` (lever leg extension) e `0599` (lever seated leg curl) — e o template das quatro entradas (`r_leg1_20260823`, `r_leg2_20260823`) diz `weight: 200`, `reps: "6-8"`, `sets: 3`. Não há unidade declarada em lugar nenhum, então o app lê **200 kg**.

**O histórico desses dois exercícios conta a história inteira — e é a evidência que decide o desenho.** Medido no estado real (`state-ZPJbmYUfHlfbAYzi.json`, 300 treinos) em 11/09/2026: os pesos distintos já registrados são `13,61 · 14,51 · 17,69 · 20,41 · 27,22 · 31,75 · 36,29 · 45,36 · 49,9 · 54,43 · 58,97 · 63,5 · 68,04 · 72,57 · 77,11 · 81,65 · 90,7 · 90,72 · 95,25 · 99,79 · 108,86 · 117,93 · 127,01` — **todos são conversões exatas de libras redondas** (30, 40, 45, 60, 70, 80, 100, 110, 120, 130, 140, 150, 160, 170, 180, 200, 210, 220, 240, 260, 280 lb). Exemplos: `63,5 = 140 lb`, `90,72 = 200 lb`, `108,86 = 240 lb`, `45,36 = 100 lb`.

Ou seja: **o histórico antigo já está em kg**, convertido à mão a partir da escala da máquina. Até 23/08/2026 o usuário anotava o equivalente em kg; em **02/09/2026** passou a digitar o número cru do mostrador (`200`), e desde então:

| Data | `0585` registrado | Como o app lê hoje | O que era de fato |
|---|---|---|---|
| 09/08 – 23/08 | `108,86 · 63,5 · 90,72` | 108,86 · 63,5 · 90,72 **kg** | correto (já convertido) |
| **02/09 e 06/09** | `200x8, 200x8, 200x6` | **200 kg** (errado) | 90,72 kg (200 lb) |

Consequências que a spec tem de resolver:

- `GET /api/coach/analysis` calcula `wKg = 200` para as 6 séries de setembro → `wmax = 200` e e1RM ≈ **253 kg** num exercício cujo topo histórico real é `108,86 kg` / e1RM ≈ **131 kg**. É um pico isolado de ~1,9× que o filtro de outlier (`w0 > 2,5×w1`) **não** pega.
- a tela mostra `200 kg` num aparelho cujo mostrador diz 200 lb, e a prescrição de `200` não tem unidade declarada.

**A normalização `lb→kg` que o backlog afirma existir não existe.** Confirmado em 11/09/2026 no repo (`git log -S0585 -- api/` devolve só `routines.test.js`, um fixture) e no container `opengym-api-1` (`/app/coach.js` de 09/09/2026): `0585` **nunca** apareceu no código do `api/`. O texto de `docs/backlog.md:7` ("Normalização pontual `lb→kg` já feita em `api/coach.js`") está **errado** e precisa ser corrigido junto com esta spec. O que existe são duas declarações em prosa que apontam para o lugar certo: `docs/specs/spec_escritor_rotinas.md:240-245` (RF-13: *"não existe conversão de unidade … `api/coach.js` é quem converte lb→kg na análise"*) e `docs/specs/spec_micro_via_app_v5.md:577` (*"0585 e 0599 ficam em 200 lbs"*).

**Objetivo:** um exercício pode declarar a própria unidade, no mesmo espírito de `mode: reps|time|cardio` e das flags `bodyweight`/`side` — ausente herda `S.unit`, e nada do que já está gravado é reescrito.

## Escopo

**Inclui**

1. Modelo: `S.routines[].ex[].unit?: 'kg'|'lb'`, propagado para `workouts[].entries[].target.unit` (automático: `target: { ...cfg }`), e `workouts[].entries[].sets[].wUnit?: 'kg'|'lb'` como override de série. `wUnit` entra no **modelo e na leitura** (a ordem de resolução em RF-1 o consulta primeiro) e **não** é validado no servidor nem escrito por tela nenhuma — é a decisão A-13, não uma omissão.
2. Resolução canônica e única da unidade de um peso: `wUnit → target.unit → S.unit`.
3. Análise por série: `api/coach.js` deixa de converter pelo perfil e passa a converter pela unidade da série.
4. Exibição e entrada na unidade do exercício: bloco de treino, sheet de confirmação de peso, detalhe do exercício, histórico, editor de rotina, Stats, plano impresso.
5. Troca da unidade **no meio do treino**, espelhando o `RestChip` já existente (grava na sessão e na rotina, com toast).
6. Validação no servidor: `unit` fora de `kg|lb` → `400 BAD_UNIT` nas escritas de rotina (`PATCH` e `PUT /api/data`).
7. Migração única que marca `0585` e `0599` como `lb` nas rotinas existentes.
8. Testes de unidade (frontend e API) e correção do texto do backlog.
9. Companheiro no Hermes: o escritor de rotinas preserva `unit`, e a lista `FROZEN = {"0585","0599"}` deixa de ser necessária.

**Não inclui**

- **Reescrever o histórico dos dois aparelhos.** Decisão do usuário (U1): os treinos já gravados continuam valendo 200 kg; a leitura em libras vale só para sessões novas.
- **Converter o número ao trocar a unidade.** Decisão do usuário (U3): 200 continua 200.
- UI para marcar unidade **por série** (`wUnit` é lido, validado e documentado, mas nenhuma tela escreve).
- Import de CSV com unidade por linha: `import-csv.js` já converte cada linha **para a unidade do perfil** (`parseWorkoutCSV`, `:398-401`). O que entra pelo import não ganha `unit` de exercício.
- Trocar a unidade do perfil (`Settings → Weight unit` continua como está) e converter `w.vol` já gravado quando o perfil muda de unidade (bug pré-existente, ver Riscos).
- Seed de demonstração (`demoSeed.js`) e rotinas de exemplo (`starter.js`): tudo nasce na unidade do perfil.
- Normalizar os outliers de dados que não são destes dois aparelhos (ex.: `0584` com 474 registrado). Ver Riscos.

## Decisões do usuário (produto)

| # | Pergunta | Resposta |
|---|---|---|
| **U1** | O que fazer com o histórico já registrado nos dois aparelhos? | **Só daqui pra frente** — o que já está gravado continua contando 200 kg; a correção vale só para treinos novos. |
| **U2** | Onde escolher que um exercício é em libras? | **Editor da rotina + no meio do treino** |
| **U3** | Ao trocar a unidade, o número prescrito (200) vira o quê? | **Continua 200** — passa a ser lido como 200 lb; nada é recalculado. |
| **U4** | E os dois treinos de 02/09 e 06/09, gravados com o número cru (`200`) antes de o app saber que a máquina é em libras? (pergunta feita depois de descobrir que o histórico tem duas partes — ver Contexto) | **Ficam como estão**, lidos como 200 kg. Nada é marcado retroativamente: nem a migração, nem `wUnit` em série antiga. Consequência aceita em R-1. |

## Decisões assumidas

Detalhe de implementação — não muda o que o usuário decide, e está registrado aqui para a revisão atacar.

- **A-1. Ordem de resolução única:** `set.wUnit → entry.target.unit → S.unit`, normalizada por `normUnit()` (qualquer coisa que comece com `lb` é libra; todo o resto é kg — mesma tolerância que `api/coach.js:44` já usa hoje, e que aceita `"200 lbs"` em texto livre do agente).
- **A-2. Dos módulos espelhados, não um compartilhado:** `frontend/src/lib/units.js` e `api/units.js` com o mesmo conteúdo. `api/` é um pacote separado (Dockerfile próprio) e não enxerga `frontend/src/`. Precedente no repo: `api/coach.js` é "matemática portada", e `api/routines.js:173` duplica `isValidRest` com o comentário `= isValidRest (useStore.js:19)`.
- **A-3. Volume de treino soma em kg e exibe na unidade do perfil.** `workoutVolume(w, unit)` converte cada série pela **unidade dela** antes de somar; sem isso um treino que mistura 100 kg e 200 lb somaria 300. Para perfil `kg` e dados atuais (todas as séries resolvem para `kg`), o resultado é **idêntico** ao de hoje.
- **A-4. Agregações por exercício ficam na unidade atual do exercício** (`bestWeightFor`, "Best:", `exWeights`, séries de e1RM do app). É consequência direta de U3: trocar a unidade reinterpreta o histórico daquele exercício, e é o que o usuário pediu. Quem converte por série e não sofre disso é a **análise** (`api/coach.js`), que é a fonte dos números "oficiais".
- **A-5. Troca no meio do treino grava nos dois lugares** (sessão e rotina), exatamente como o `RestChip` faz hoje (`Workout.jsx:168-190`): a descoberta "essa máquina é em libras" vale para a próxima vez também.
- **A-6. A migração é do cliente, em `loadState()`**, com flag em `localStorage` (`gym_unit_pin_v1`), e **não** um script no servidor. Motivo: o estado do aparelho é quem manda no app, e o push seguinte leva o `unit` para o servidor sem precisar de `PATCH` nem de recarga coordenada. A flag evita que a migração reescreva a escolha de quem remover o `unit` depois.
- **A-7. `ExConfig` só grava `unit` quando ele difere da unidade do perfil**, espelhando o tratamento de `flags` (`sheets.jsx:510-511`) e `prog` (`:502-504`): plano exportado continua enxuto e "ausente = herda" continua valendo.
- **A-8. Cardio não tem unidade.** Não há carga em `mode: 'cardio'`; o seletor não aparece e nenhum `unit` é gravado nessa branch de `save()`.
- **A-9. O sufixo `kg`/`lb` só aparece quando diverge do perfil.** É o que o backlog pediu ("mostram sufixo `kg/lb` quando diverge") e evita um `kg` redundante em todo rótulo do app.
- **A-10. `wUnit` entra no modelo e na leitura, sem UI.** Custa 3 linhas e fecha o modelo que o backlog descreve; quem escrever é o agente/import, não a tela.
- **A-11. `exWeights` (caderno) não muda de forma** e passa a ser lido na unidade do exercício. Ele é gravado com o número **cru** na unidade da entrada (`sheets.jsx:965`, `Workout.jsx:302-303`) e lido cru por `buildSets` (`history.js:230`) — as duas pontas concordam porque o caderno é **por exercício**, e um exercício tem uma unidade por vez. Trocar a unidade reinterpreta o caderno junto com o resto do histórico daquele exercício, que é o que U3 pede. O template da rotina já vence o caderno desde a BACKLOG-06, então o caderno só decide quando o template prescreve 0.
- **A-13. `wUnit` (unidade por série) é lido e **não** validado no servidor.** `validateExEntry` opera em `routines[].ex[]`; `wUnit` vive em `workouts[].entries[].sets[]`, que `checkState` (`server.js:61-77`) e `checkRoutineFields` (`:270-286`) deliberadamente não percorrem — o `checkState` é declarado "loose: rejeita corrupção, nunca estado legítimo". Como nenhuma tela escreve `wUnit`, o único escritor possível é um agente, e a leitura normaliza com `normUnit` (tolerante). Aceito como best-effort, declarado em vez de silencioso.
- **A-12. `FROZEN = {"0585","0599"}` do escritor do Hermes fica obsoleto.** Depois desta mudança a unidade é um campo explícito, e congelar o id deixa de proteger coisa alguma; o portão que importa (peso não muda sem intenção) continua no `opengym_writer.py`/`verificar_prescricao.py`.

## Requisitos Funcionais

**RF-1.** A unidade de um peso é resolvida **por série**, na ordem `wUnit → target.unit → S.unit`. Ausente em todas as camadas = comportamento de hoje, byte a byte.

**RF-2.** `GET /api/coach/analysis` converte **cada série** pela sua própria unidade: `wKg = Number(s.w) * (unidade(lb) ? 0.45359237 : 1)`. Uma série sem `unit` num perfil `kg` continua produzindo exatamente o mesmo `weight_kg`, `tonnage`, `e1rm` e `wmax` de hoje.

**RF-3.** Aceite do backlog, verificável: perfil `kg`, `100 lb` num exercício e `100 kg` em outro → a análise devolve `45.36` e `100` para as duas séries, e `e1rm`/`tonnage` de cada exercício saem do valor convertido.

**RF-4.** O editor de rotina oferece a unidade do exercício (kg/lb) quando o exercício tem carga, e grava `ex.unit` **apenas quando difere de `S.unit`**. Escolher a unidade do perfil **remove** a chave (`delete`), não grava `unit: 'kg'`.

**RF-5.** O treino em andamento permite trocar a unidade do exercício; a troca vale para a sessão **e** para a rotina **de origem da sessão** (`S.active.routineId`), com toast. Sem rotina (treino avulso), vale só para a sessão. Se o mesmo exercício aparecer em outra rotina, essa outra **não** é tocada — quem manda é a rotina que está sendo treinada, a mesma escolha que o `RestChip` já faz hoje (`Workout.jsx:172-183`).

**RF-6.** Trocar a unidade **não altera nenhum número gravado** — nem `weight` do template, nem `exWeights`, nem séries de treinos passados. Só muda como o número é lido e exibido.

**RF-7.** O servidor recusa `unit` fora de `kg|lb` com `400 { code: 'BAD_UNIT', field: 'ex.<id>.unit' }`, tanto no `PATCH /api/routines/:id` quanto no `PUT /api/data`. `unit` **presente e válido** passa; `unit` ausente passa; campos desconhecidos continuam sendo ignorados (sem whitelist nova). A comparação é **exata** (`'lb'`, não `'LB'` nem `'lb '`) por escolha fail-closed — e é seguro porque o campo **não existia** antes desta spec: nenhum estado já gravado pode conter um valor inválido, e o único escritor é este cliente, que só emite `'kg'` ou `'lb'`. Um estado inválido não pode travar o `PUT` do PWA inteiro (`server.js:270-286`) por um campo que ninguém tinha.

**RF-8.** O servidor **não** perde `unit`: `mergeRoutine` (`api/routines.js:236-249`) preserva o campo porque parte de `{...target}`, e `checkRoutineFields` (`api/server.js:270-286`) valida sem reconstruir. Um `PATCH` que não cita `unit` mantém o valor existente. **Teste obrigatório para isso.**

**RF-9.** Migração única: numa instalação que ainda não tem a flag `gym_unit_pin_v1`, `loadState()` escreve `unit: 'lb'` nas entradas de `0585` e `0599` que **não** têm `unit` em nenhuma rotina, marca a flag e registra um `console.info`. Rodar duas vezes não muda nada; remover o `unit` à mão depois **não** faz a migração voltar.

**RF-10.** Nenhum treino já gravado é tocado (U1/U4): o histórico de `0585`/`0599` continua resolvendo para `S.unit` = `kg` porque `target.unit` não existe nos treinos antigos — inclusive as duas sessões de 02/09 e 06/09, que seguem valendo `200 kg` por decisão explícita. `wUnit` nunca é escrito pela migração, nem por tela nenhuma.

**RF-11.** Volume de treino (`workoutVolume`) soma em kg e devolve na unidade do perfil; `w.vol` de treinos gravados com uma só unidade não muda de valor.

**RF-12.** O sufixo de unidade aparece em `setLabel` **somente** quando a unidade da série difere da unidade do perfil (`200 lb×12` vs `200×12`). Sem o 4º argumento novo, `setLabel` mantém o comportamento atual — os testes existentes não mudam.

**RF-13.** O plano impresso (`planPrintHTML`) e o editor de rotina mostram cada exercício na unidade dele.

**RF-14.** O escritor do Hermes (`opengym_writer.py`) **preserva** `unit` nas entradas que não edita e aceita `unit` numa intenção; `FROZEN` deixa de ser aplicado a `0585`/`0599`.

**RF-15.** Os textos errados somem: `docs/backlog.md` (BACKLOG-01) deixa de afirmar que a normalização já existe e passa a registrar esta spec como o caminho.

## Detalhe de Implementação (nível código)

> Todos os caminhos são relativos à raiz do repo (`/mnt/drivebackup/apps/openGym/openGym`).
> Números de linha conferidos em `7aa3935`.

### 1. `frontend/src/lib/units.js` — **arquivo novo**

```js
// frontend/src/lib/units.js — quem decide em que unidade um peso está (BACKLOG-01).
//
// Uma unidade é uma propriedade do exercício, não do perfil: `0585` e `0599` são máquinas
// em libras num perfil em kg. A regra é a mesma de `mode`/`bodyweight`/`side` — campo
// ausente herda o perfil, e nenhum dado antigo precisa ser migrado para continuar lendo
// exatamente o que lia antes.
//
// Espelhado em `api/units.js` de propósito: `api/` é um pacote separado e não enxerga
// `frontend/src/` (mesmo precedente de `api/coach.js`, matemática portada).
export const LB_TO_KG = 0.45359237

// Normaliza o que vier do estado, do import ou de um agente. Qualquer coisa que comece
// com "lb" é libra ("lb", "lbs", "LB") — o coach escreve "200 lbs" em texto livre — e
// todo o resto é kg, que é o padrão do app.
export const normUnit = v => (String(v ?? '').trim().toLowerCase().startsWith('lb') ? 'lb' : 'kg')

export const isLb = v => normUnit(v) === 'lb'
export const kgFactor = v => (isLb(v) ? LB_TO_KG : 1)

// Valor cru de uma série → kg (o que a análise soma).
export const toKg = (w, unit) => (Number(w) || 0) * kgFactor(unit)
// kg → a unidade pedida, com a mesma precisão de 1 casa que o resto do app usa.
export const fromKg = (kg, unit) => Math.round(((Number(kg) || 0) / kgFactor(unit)) * 10) / 10

// A unidade de um exercício na rotina (ou no sheet de configuração).
export const unitOfCfg = (cfg, S) => normUnit(cfg && cfg.unit != null ? cfg.unit : S && S.unit)
// A unidade de uma entrada de treino — a prescrição que a sessão copiou ao começar.
export const unitOfEntry = (entry, S) =>
  normUnit(entry && entry.target && entry.target.unit != null ? entry.target.unit : S && S.unit)
// A unidade de UMA série, na ordem canônica (RF-1).
export const unitOfSet = (s, entry, S) => normUnit(
  s && s.wUnit != null ? s.wUnit
    : entry && entry.target && entry.target.unit != null ? entry.target.unit
      : S && S.unit)
```

### 2. `api/units.js` — **arquivo novo**

Mesmo conteúdo do anterior, sem comentários de frontend, com o cabeçalho:

```js
// api/units.js — a unidade de um peso, do lado do servidor (BACKLOG-01).
// Cópia deliberada de `frontend/src/lib/units.js`: `api/` é um pacote separado (Dockerfile
// próprio) e não enxerga `frontend/src/`. Mesmo precedente de `api/coach.js` (matemática
// portada de process_workout.py) e de `api/routines.js` (`= isValidRest (useStore.js:19)`).
// Ao mudar uma das duas, mude a outra — o teste `api/coach.test.js` fixa os números.
export const LB_TO_KG = 0.45359237
export const normUnit = v => (String(v ?? '').trim().toLowerCase().startsWith('lb') ? 'lb' : 'kg')
export const isLb = v => normUnit(v) === 'lb'
export const kgFactor = v => (isLb(v) ? LB_TO_KG : 1)
export const toKg = (w, unit) => (Number(w) || 0) * kgFactor(unit)
export const fromKg = (kg, unit) => Math.round(((Number(kg) || 0) / kgFactor(unit)) * 10) / 10
// A unidade de uma série, na ordem canônica: override da série → prescrição da sessão → perfil.
export const unitOfSet = (s, entry, profileUnit) => normUnit(
  s && s.wUnit != null ? s.wUnit
    : entry && entry.target && entry.target.unit != null ? entry.target.unit
      : profileUnit)
```

### 3. `api/coach.js` — conversão por série

**3.1 Import e o `LB_TO_KG` local (linhas 13 e 44-45).**

```js
// ANTES (linha 13)
const LB_TO_KG = 0.45359237;
```
```js
// DEPOIS
import { normUnit, kgFactor, unitOfSet } from './units.js';
```
> `LB_TO_KG` **não** é importado aqui: o fator passou a vir de `kgFactor(setUnit)` e o arquivo não usa mais a constante (`api/units.js` continua exportando-a para os testes).

**3.2 `rowsFromState`, cabeçalho (linhas 44-45).**

```js
// ANTES
  const unit = String(state.unit || 'kg').toLowerCase().startsWith('lb') ? 'lb' : 'kg';
  const toKg = unit === 'lb' ? LB_TO_KG : 1;
```
```js
// DEPOIS
  // A unidade é do exercício, não do perfil (BACKLOG-01): `0585`/`0599` são máquinas em
  // libras num perfil em kg. Cada série é convertida pela unidade dela — `wUnit` da série,
  // senão a prescrição que a sessão copiou (`entry.target.unit`), senão o perfil.
  const profileUnit = normUnit(state.unit);
```
> **As duas linhas de cima desaparecem inteiras.** Se `toKg` sobreviver à edição e for usado junto com `kgFactor`, a conversão é aplicada **duas vezes** num perfil `lb` com exercício `kg` (`100 × 0,4535 × 0,4535 = 20,6`). O único uso de `toKg` no arquivo é a linha 77, substituída em 3.3.

**3.3 `rowsFromState`, o laço de séries (linhas 75-78 e 80-96).**

```js
// ANTES
        let wKg = 0;
        try{
          wKg = s.w == null || String(s.w).trim() === '' ? 0 : Number(s.w) * toKg;
        }catch{ wKg = 0; }
```
```js
// DEPOIS
        let wKg = 0;
        let setUnit = profileUnit;
        try{
          setUnit = unitOfSet(s, e, profileUnit);
          wKg = s.w == null || String(s.w).trim() === '' ? 0 : Number(s.w) * kgFactor(setUnit);
        }catch{ setUnit = profileUnit; wKg = 0; }
```
> O `catch` continua sendo `wKg = 0` (comportamento de hoje); `setUnit` volta ao perfil para que o `_unit` da linha nunca fique `undefined`.

E no objeto da linha, ao lado de `_wKg` (linha 93), para o teste e para quem consome a análise:

```js
// ANTES
          _wKg: wKg,
          _reps: hasReps ? Number(s.r) : null,
```
```js
// DEPOIS
          _wKg: wKg,
          _unit: setUnit,
          _reps: hasReps ? Number(s.r) : null,
```

> Nada mais em `buildAnalysis` muda: outlier, sessões, `progress`, `prs`, `weeks` e `months` já trabalham sobre `_wKg` e passam a estar certos de graça.

### 4. `api/routines.js` — validação de `unit`

**4.1 Perto das outras listas (linhas 15-17).**

```js
// ANTES
export const PROG_ALLOWED = ['off', 'linear', 'greyskull', 'double', 'time'];
export const MODE_ALLOWED = ['reps', 'time', 'cardio'];
```
```js
// DEPOIS
export const PROG_ALLOWED = ['off', 'linear', 'greyskull', 'double', 'time'];
export const MODE_ALLOWED = ['reps', 'time', 'cardio'];
export const UNIT_ALLOWED = ['kg', 'lb'];   // BACKLOG-01: unidade do exercício
```

**4.2 `validateExEntry`, logo depois do laço das flags booleanas (linhas 153-155).**

```js
// ANTES
  for (const f of ['bodyweight', 'side']) {
    if (e[f] !== undefined && typeof e[f] !== 'boolean') return bad('BAD_FLAG', f, `${f} must be a boolean`);
  }
```
```js
// DEPOIS
  for (const f of ['bodyweight', 'side']) {
    if (e[f] !== undefined && typeof e[f] !== 'boolean') return bad('BAD_FLAG', f, `${f} must be a boolean`);
  }
  // Ausente = herda S.unit (RF-1). Presente tem que ser uma das duas — o agente escrevendo
  // "lbs" cairia em silêncio na herança e o exercício voltaria a ser lido em kg.
  if (e.unit !== undefined && !UNIT_ALLOWED.includes(e.unit)) {
    return bad('BAD_UNIT', 'unit', `unit must be one of ${UNIT_ALLOWED.join('|')}`, UNIT_ALLOWED);
  }
```

### 5. `frontend/src/lib/history.js`

**5.1 Import (linha 2-4).**

```js
// ANTES
import { isCardio, isBodyweightEq } from './exercises.js'
import { t } from './i18n.js'
```
```js
// DEPOIS
import { isCardio, isBodyweightEq } from './exercises.js'
import { t } from './i18n.js'
import { normUnit, unitOfSet, toKg, fromKg } from './units.js'
```
> `unitOfCfg` **não** entra: `exLine` continua recebendo a unidade por parâmetro (§5.4), e quem chama é `RoutineEdit.jsx` (§9.2).

**5.2 `setLabel` (linhas 102-119): quarto argumento opcional com o estado.**

```js
// ANTES
export function setLabel(id, s, cfg) {
  const c = cfg || { id }
  const mode = modeOf(c)
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h`
  if (mode === 'time') return fmtSec(s.sec) + (s.w > 0 ? ` · ${fmtNum(s.w)}` : '')
  const reps = s.r || 0
  if (isBw({ ...c, id: c.id ?? id })) {
    const load = s.w > 0 ? `+${fmtNum(s.w)} × ` : ''
    return `${load}${reps}` + effortTail(s)
  }
  return `${fmtNum(s.w || 0)}×${reps}` + effortTail(s)
}
```
```js
// DEPOIS
// `S` é opcional e serve só para decidir se o sufixo de unidade aparece: ele é mostrado
// quando a unidade da SÉRIE difere da unidade do PERFIL ("200 lb×12" num perfil kg) e
// omitido quando coincidem — sem isso todo rótulo do app ganharia um "kg" redundante.
// A comparação é com `S.unit`, nunca com o `cfg` que chegou: o `cfg` de uma sessão antiga
// (`last.target`) é justamente de quem se quer saber a unidade, compará-lo consigo mesmo
// daria sempre "não diverge". Sem `S`, o rótulo sai exatamente como saía antes desta spec.
export function setLabel(id, s, cfg, S) {
  const c = cfg || { id }
  const mode = modeOf(c)
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h`
  const u = unitOfSet(s, { target: c }, S)
  const tail = S && u !== normUnit(S.unit) ? ' ' + u : ''
  if (mode === 'time') return fmtSec(s.sec) + (s.w > 0 ? ` · ${fmtNum(s.w)}${tail}` : '')
  const reps = s.r || 0
  if (isBw({ ...c, id: c.id ?? id })) {
    const w = s.w > 0 ? `+${fmtNum(s.w)}${tail} × ` : ''
    return `${w}${reps}` + effortTail(s)
  }
  return `${fmtNum(s.w || 0)}${tail}${tail ? ' × ' : '×'}${reps}` + effortTail(s)
}
```

**5.3 `workoutVolume` (linhas 236-242): somar em kg.**

```js
// ANTES
export function workoutVolume(w) {
  let v = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) v += (s.w || 0) * (s.r || 0) }))
  return v
}
```
```js
// DEPOIS
// Um treino pode ter um exercício em kg e outro em lb (BACKLOG-01). Somar os números crus
// somaria unidades diferentes — então cada série vira kg pelo fator dela e o TOTAL volta para
// a unidade do perfil, que é a unidade em que o app exibe volume em todo lugar. Converter o
// total UMA vez (e não série a série) evita acumular o arredondamento de 1 casa: 100 kg + 100 lb
// dá 1453,6 num perfil kg (somar já arredondado daria 1454). Com uma unidade só (todo o dado
// anterior a esta spec) o resultado é o mesmo de antes, byte a byte.
export function workoutVolume(w, S) {
  const profile = normUnit((S || {}).unit)
  let kg = 0
  w.entries.forEach(e => e.sets.forEach(s => {
    if (s.done) kg += toKg(s.w, unitOfSet(s, e, S)) * (s.r || 0)
  }))
  return fromKg(kg, profile)
}
```
> **`S` é obrigatório em toda chamada.** O parâmetro é opcional na assinatura apenas para não quebrar os testes existentes que chamam `workoutVolume(w)` com um argumento (`history.test.js:451,456,461`); sem ele, `normUnit(undefined)` devolve `'kg'` e um perfil em **libras** receberia um total ~2,2× maior em silêncio. Os dois chamadores de produção passam o estado: `sheets.jsx:961` (`workoutVolume(w, st)`) e `Admin.jsx:60` (`workoutVolume(w, { unit: d.unit })`). Chamador novo que esquecer o segundo argumento é um bug que nenhum teste pega — por isso os dois estão listados aqui e em §16.1.

**5.4 `exLine` não muda de assinatura** — quem chama passa a unidade do exercício (item 9).

### 6. `frontend/src/store/useStore.js` — a migração

**6.1 Constante da flag, perto de `NO_TOAST_KEY` (linha 21).**

```js
// ANTES
const NO_TOAST_KEY = 'gym_coach_notice_shown'
```
```js
// DEPOIS
const NO_TOAST_KEY = 'gym_coach_notice_shown'
// BACKLOG-01 (U1): `0585` e `0599` são máquinas em libras e estavam sendo lidas como kg.
// A flag marca a migração como feita — ela NÃO é um "todo boot": quem remover o `unit` de um
// exercício à mão não o vê voltar no próximo carregamento.
const UNIT_PIN_KEY = 'gym_unit_pin_v1'
const LB_EXERCISES = ['0585', '0599']   // lever leg extension, lever seated leg curl
```

**6.2 Dentro de `loadState()`, logo **depois** do bloco de limpeza de `active` (linhas 49-53) e imediatamente antes do `return state` (linha 54) — não no fim da limpeza por-rotina (linhas 39-47), que roda antes da limpeza de `active`.**

```js
// ANTES
      // Limpeza active se houver
      if(state.active?.entries){
        state.active.entries.forEach(e=>{
          if('restSec' in e && !isValidRest(e.restSec)) delete e.restSec
        })
      }
      return state
```
```js
// DEPOIS
      // Limpeza active se houver
      if(state.active?.entries){
        state.active.entries.forEach(e=>{
          if('restSec' in e && !isValidRest(e.restSec)) delete e.restSec
        })
      }
      migrateUnitPin(state)
      return state
```

**6.3 A função, ancorada na linha 60 (`const hasData = ...`) — a linha 59 é vazia.**

```js
// ANTES (linha 60)
const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)
```
```js
// DEPOIS
const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

// BACKLOG-01, decisão U1 ("só daqui pra frente"): marca a unidade dos dois aparelhos de
// perna que estão em libras. Só a PRESCRIÇÃO é marcada — `workouts[]` não é tocado, porque
// uma sessão antiga não tem `target.unit` e continua resolvendo para S.unit (kg), que é
// exatamente o que o histórico antigo precisa (ele JÁ está em kg, convertido à mão).
// `active` entra junto: um treino interrompido que volta depois da atualização não pode
// continuar lendo o aparelho em kg no meio da sessão.
// A flag só é marcada quando há rotinas para migrar — num aparelho novo, sem estado ainda,
// marcar a flag aqui faria a migração nunca acontecer quando o estado chegasse do servidor.
function migrateUnitPin(state) {
  try {
    if (localStorage.getItem(UNIT_PIN_KEY)) return
    if (!(state.routines || []).length) return
    let n = 0
    const pin = ex => { if (LB_EXERCISES.includes(ex.id) && ex.unit == null) { ex.unit = 'lb'; n++ } }
    ;(state.routines || []).forEach(r => (r.ex || []).forEach(pin))
    ;((state.active || {}).entries || []).forEach(e => { if (e.target) pin(e.target) })
    localStorage.setItem(UNIT_PIN_KEY, '1')
    if (!n) return
    // **Grava o estado migrado aqui mesmo**, antes de marcar o trabalho como feito. Sem esta
    // linha a migração se perde: `loadState` devolve o objeto em memória com `unit`, mas se o
    // boot não disparar nenhum `persist` (caso comum — `pullState` cai no ramo que NÃO persiste
    // quando `hasData(S)` é verdadeiro e o servidor não é mais novo, `useStore.js:201-217`), o
    // localStorage continua com as rotinas sem `unit` e a flag já está marcada. No boot
    // seguinte a migração não roda mais e o exercício volta a ser lido em kg, em silêncio.
    localStorage.setItem(KEY, JSON.stringify(state))
    console.info('[unit] migração BACKLOG-01: ' + n + ' entrada(s) marcada(s) como lb')
  } catch { /* localStorage privado/quota: sem migração, o app segue lendo pelo perfil */ }
}
```

**6.4 `pushState` (linhas 139-142) — nada a fazer.** A sanitização existente só mexe em `restSec`/`globalRestSec`; `unit` passa inteiro.

**6.5 Limites conhecidos da migração (documentados, não corrigidos).** `migrateUnitPin` roda **só no boot**, dentro do ramo que tem estado local. Três caminhos ficam de fora, e todos se curam:

1. **Sem estado local** (`loadState` devolve `clone(DEF)` na linha 57, fora do `if (raw)`): não há rotina nenhuma para migrar, então não há o que fazer — e a flag **não** é marcada (o `return` de `!(state.routines||[]).length` vem antes do `setItem`). O estado chega depois por `pullState` (linha 184-219), que persiste em `localStorage`, e a migração roda no boot **seguinte**. Num aparelho novo isso significa "a correção chega no próximo boot" — um boot de atraso, não uma perda.
2. **Rotinas vindas do servidor sem `unit`** (`pullState` linha 186-200, e o caminho de `409` nas linhas 150-179): os dois chamam `persist(...)` sem passar pela migração. Mesmo desfecho: chega no próximo boot, porque a flag só é marcada quando há rotinas para migrar.
3. **Nada disso roda duas vezes** — a flag e a gravação do estado acontecem juntas (6.3), então o caso perigoso (flag marcada sem o estado ter sido gravado) não existe.

Chamar a migração também dentro de `pullState` e do caminho de `409` é possível e não é errado; a decisão é manter um ponto único de migração no boot para não espalhar escrita por três caminhos de sync que têm regras de merge próprias (BACKLOG-07/09).

### 7. `frontend/src/components/UnitChip.jsx` — **arquivo novo**

```jsx
// Chip de unidade (BACKLOG-01), na mesma gramática do RestChip: cinza quando o exercício
// herda a unidade do perfil, destacado em --acc quando tem unidade própria. Tocar abre o
// sheet com kg / lb / "Padrão do perfil".
import { t } from '../lib/i18n.js'
import { normUnit } from '../lib/units.js'
import Icon from './Icon.jsx'
import { useUI } from '../store/useUI.js'

export default function UnitChip({ value, base, onChange }) {
  const openSheet = useUI(s => s.openSheet)
  const profile = String(base || 'kg').toLowerCase().startsWith('lb') ? 'lb' : 'kg'
  // `value` igual ao perfil conta como "herda", mesmo que a chave exista: o editor só grava
  // quando difere (`A-7`), mas um plano importado ou o agente podem ter gravado `unit:'kg'`
  // num perfil kg — e aí o chip diria "própria" para um exercício que não tem nada de próprio.
  const own = value == null || normUnit(value) === profile ? null : normUnit(value)
  const unit = own == null ? profile : own
  const open = () => openSheet(close => (
    <>
      <h3>{t('Weight unit')}</h3>
      <div className="sect-b">
        {['kg', 'lb'].map(v => (
          <button key={v} className="lrow tap" onClick={() => { close(); onChange(v) }}>
            <span className="lrow-m"><span className="lrow-t">{v}</span></span>
            {unit === v && <Icon name="check" className="lrow-k" />}
          </button>
        ))}
        <button className="lrow tap" onClick={() => { close(); onChange(null) }}>
          <span className="lrow-m">
            <span className="lrow-t">{t('Default')} ({profile})</span>
            <span className="lrow-s">{t('Use the profile unit')}</span>
          </span>
          {own == null && <Icon name="check" className="lrow-k" />}
        </button>
      </div>
      <div style={{ height: 8 }} />
    </>
  ))
  return (
    <button className={'tag tap nocap' + (own != null ? ' acc' : '')} onClick={open} aria-label={t('Weight unit')}>
      <Icon name="scale" />{unit}
    </button>
  )
}
```

> Os quatro imports são obrigatórios: `normUnit` é usado na normalização de `own` logo abaixo, e sem ele o arquivo não compila. `useUI` já é importado em `Workout.jsx:4` (`import { useUI } from '../store/useUI.js'`), e a assinatura `openSheet(close => <>…</>)` é a mesma do `RestChip` (`Workout.jsx:69-90`).

### 8. `frontend/src/views/Workout.jsx`

**8.1 Imports (linha 6 e seguintes).**

```js
// ANTES
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort } from '../lib/history.js'
```
```js
// DEPOIS
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort } from '../lib/history.js'
import { unitOfEntry, unitOfSet } from '../lib/units.js'
import UnitChip from '../components/UnitChip.jsx'
```
> `unitOf` de `history.js` é o helper de **supersets** (índices), não de unidades — os nomes convivem: `unitOf(units, idx)` continua vindo de `history.js`, e as unidades vêm de `units.js`. Se isso confundir na revisão, renomeie o de superset para `supersetOf` num commit separado; esta spec **não** faz esse rename.

**8.2 `ExerciseBlock`: a unidade da entrada (depois da linha 118).**

```js
// ANTES
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
```
```js
// DEPOIS
  const cfg = { ...(entry.target || {}), id: entry.id }
  // `exUnit`, e não `wUnit`: `wUnit` é o nome do campo POR SÉRIE do modelo (§1). Usar o mesmo
  // nome para a unidade da ENTRADA convida a trocar os dois — e `ActiveWorkout`, logo abaixo,
  // já tem um `unit` que é o array de superset (`unitOf(units, cur)`, linha 229).
  const exUnit = unitOfEntry(entry, S)         // BACKLOG-01
  const bw = !cardio && isBw(cfg)
```

**8.3 `loadCol` (linha 121).**

```js
// ANTES
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
```
```js
// DEPOIS
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', exUnit) : t('Weight ({0})', exUnit) }
```

**8.4 O chip de unidade, na mesma linha do `RestChip` (depois do bloco do `RestChip`, linha 190).**

```jsx
// ANTES
    </div>
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
```
```jsx
// DEPOIS
      <UnitChip value={entry.target?.unit ?? null} base={S.unit} onChange={v => {
        // Mesma semântica do RestChip: a descoberta "essa máquina é em libras" vale para a
        // próxima vez também, então grava na sessão e na rotina DE ORIGEM da sessão
        // (`S.active.routineId`) — não em todas as rotinas que usam o exercício. É a mesma
        // escolha que o RestChip já faz, e é o que resolve o caso de `0585` estar em Legs 1
        // e Legs 2 com unidades diferentes: quem manda é a rotina que você está treinando.
        const routineId = useStore.getState().S.active?.routineId
        const routineName = useStore.getState().S.routines.find(r => r.id === routineId)?.name || ''
        useStore.getState().update(s => {
          const e = s.active.entries[entryIdx]
          // Revalida a identidade: o sheet de unidade fica aberto enquanto a sessão pode
          // avançar de exercício, e escrever pelo índice sem conferir acertaria o vizinho.
          // `e.target` pode ser null numa sessão restaurada de versão anterior (`§8.2` lê com
          // `?.` justamente por isso) — sem a guarda, escolher "Padrão do perfil" quebra.
          if (!e || e.id !== entry.id || !e.target) return
          if (v == null) delete e.target.unit; else e.target.unit = v
          if (routineId) {
            const cfg = s.routines.find(r => r.id === routineId)?.ex.find(x => x.id === entry.id)
            if (cfg) { if (v == null) delete cfg.unit; else cfg.unit = v }
          }
        })
        // Treino avulso não tem nome de rotina: a mensagem não pode sair "Unit saved for  — lb".
        useUI.getState().toast(v == null
          ? t('Unit reset to the profile default')
          : routineName
            ? t('Unit saved for {0} — {1}', routineName, v)
            : t('Unit saved for this session — {0}', v))
      }} />
    </div>
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target, S)).join(', ')}</div>}
```

**8.5 O selo "Best:" (linha 167).**

```jsx
// ANTES
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
```
```jsx
// DEPOIS
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {exUnit}</span>}
```

**8.6 "Add exercise" (linha 375) — nada a mudar.** `target: { ...cfg }` já leva `unit` para a entrada nova, e `buildSets` já resolve a carga pela unidade do exercício (a carga é um número cru, não convertido — RF-6).

### 9. `frontend/src/views/RoutineEdit.jsx`

**9.1 Imports (linha 7).**

```js
// ANTES
import { supersetUnits, cleanupSg, exLine } from '../lib/history.js'
```
```js
// DEPOIS
import { supersetUnits, cleanupSg, exLine } from '../lib/history.js'
import { unitOfCfg } from '../lib/units.js'
```

**9.2 A linha do exercício (linha 111).**

```jsx
// ANTES
          <div className="grow"><div className="tt capitalize">{ex.n}</div><div className="ss">{exLine(e, S.unit)}</div><div style={{marginTop:4}}><RestChipForRoutine ex={e} routineId={r.id} /></div></div>
```
```jsx
// DEPOIS
          <div className="grow"><div className="tt capitalize">{ex.n}</div><div className="ss">{exLine(e, unitOfCfg(e, S))}</div><div style={{marginTop:4}}><RestChipForRoutine ex={e} routineId={r.id} /></div></div>
```

### 10. `frontend/src/sheets.jsx`

**10.1 Imports (linha 6 em diante).** Acrescentar:

```js
import { unitOfCfg, unitOfEntry, normUnit } from './lib/units.js'
import UnitChip from './components/UnitChip.jsx'
```

**10.2 `ExConfig`: o seletor de unidade (depois do bloco de bodyweight/per-side, linha 570).**

```jsx
// ANTES
    </div>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
```
```jsx
// DEPOIS
    </div>}
    {/* BACKLOG-01: a unidade pertence ao exercício, não ao perfil — `0585` e `0599` são
        máquinas em libras. Só aparece quando há carga para medir (cardio não tem, e
        bodyweight puro também não), pela mesma regra que esconde os steppers de peso. */}
    {!cardio && !(bw && !(c.weight > 0)) && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}
        subtitle={unitSel === normUnit(st.unit)
          ? t('Same as your profile ({0})', normUnit(st.unit))
          : t('This exercise is measured in {0}', unitSel)}>
        <Segmented value={unitSel} onChange={v => setC(x => ({ ...x, unit: v }))}
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
      </Row>
    </div>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
```

**10.3 `ExConfig`: a variável da unidade (depois da linha 494).**

```js
// ANTES
  const perSide = isPerSide(c)
```
```js
// DEPOIS
  const perSide = isPerSide(c)
  // A unidade em edição: a que já estava no exercício ou, na falta dela, a do perfil.
  const unitSel = normUnit(c.unit != null ? c.unit : st.unit)
```

> **A condição do seletor é exatamente a do stepper de peso** (`bw && !(c.weight > 0)` esconde o stepper em `reps`): um exercício de peso corporal sem cinto não mostra unidade, um aparelho mostra. No modo `time` o app **já** mostra o stepper de peso mesmo para bodyweight (`sheets.jsx:543-546`), então o seletor acompanha esse comportamento em vez de inventar uma segunda regra. Um hold sem carga em `time` vai mostrar "Weight unit" com `w=0` — é ruído aceito, não um bug, porque o campo de peso também está lá.

**10.3b `ExConfig`: os três steppers de peso passam a usar a unidade em edição (linhas 546, 552 e 576) — sem isso o sheet diria "Weight (kg)" para um exercício em libras.**

```jsx
// ANTES (546, branch time)
        <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
// ANTES (552, branch reps)
        {!bw && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />}
// ANTES (576, peso adicionado em bodyweight)
        <Stepper label={t('Added ({0})', st.unit)} value={c.weight || 0} step={2.5}
```
```jsx
// DEPOIS (546)
        <Stepper label={t('Weight ({0})', unitSel)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
// DEPOIS (552)
        {!bw && <Stepper label={t('Weight ({0})', unitSel)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />}
// DEPOIS (576)
        <Stepper label={t('Added ({0})', unitSel)} value={c.weight || 0} step={2.5}
```

**10.4 `ExConfig.save()` (linhas 502-524): gravar `unit` só quando diverge.**

```js
// ANTES
    const flags = {}
    if (bw !== isBodyweightEq(ex.id)) flags.bodyweight = bw
    if (cardio) onSave({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8) })
    else if (mode === 'time') onSave({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), ...flags, ...prog })
```
```js
// DEPOIS
    const flags = {}
    if (bw !== isBodyweightEq(ex.id)) flags.bodyweight = bw
    // BACKLOG-01 / decisão A-7: só grava quando difere do perfil, como `prog` e as flags.
    // Ausente = herda, e é isso que mantém o plano exportado igual ao de antes.
    // A segunda condição é a mesma do seletor (§10.2) e não é decorativa: ligar "Bodyweight"
    // zera o peso e esconde a unidade, mas `unitSel` continua com o valor antigo — sem ela o
    // estado ficaria com um `unit` invisível e impossível de apagar pela interface, que é
    // exatamente o que A-7 existe para evitar.
    if (!cardio && !(bw && !(c.weight > 0)) && unitSel !== normUnit(st.unit)) flags.unit = unitSel
    if (cardio) onSave({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8) })
    else if (mode === 'time') onSave({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), ...flags, ...prog })
```

> A branch `reps` (linha 519) já espalha `...flags`, então herda o `unit` sem mudança. A branch `cardio` **não** espalha `flags` de propósito (RF/A-8: cardio não tem carga) — e isso **já remove** um `unit` que existisse antes, porque o chamador substitui a entrada inteira (`RoutineEdit.jsx:108`: `x[i] = { id: x[i].id, sg: x[i].sg, ...cfg }`) em vez de fazer merge. Não é preciso `delete` explícito.

**10.5 `ProgressionFields` (linha 593 e 467): o passo da progressão na unidade do exercício.**

```jsx
// ANTES
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} />
```
```jsx
// DEPOIS
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={unitSel} />
```
```js
// ANTES (linha 467, dentro de ProgressionFields)
  const inc = c.inc > 0 ? c.inc : (mode === 'time' ? 5 : defaultIncrement(ex.id, unit))
```
```js
// DEPOIS — sem mudança: `inc` já usa o `unit` que o chamador passou, que agora é o do exercício.
```
> `defaultIncrement(exId, unit)` (`progression.js:56-61`) já devolve 10/5 em libras e 5/2,5 em kg. Só faltava passar a unidade certa.

**10.5b `frontend/src/lib/progression.js:169-170` — o mesmo unit, senão o passo mostrado mente.** `ProgressionFields` exibe o passo a partir de `defaultIncrement(ex.id, unitSel)`, mas quem **aplica** o passo é `nextPrescription`, que ainda lê `S.unit`. Num exercício em lb dentro de perfil kg os dois discordam (2,5 exibido × 5 aplicado). `nextPrescription` recebe `cfg`, e `cfg` carrega `unit` — é a mesma fonte que `unitOfCfg` usa:

```js
// ANTES (linha 169)
  const unit = S.unit || 'kg'
```
```js
// DEPOIS
  // A unidade é do exercício (BACKLOG-01): o passo exibido no sheet e o passo aplicado aqui
  // têm de sair da mesma conta, ou o usuário lê 2,5 e recebe 5.
  const unit = unitOfCfg(cfg, S)
```
> Import novo no topo de `progression.js`: `import { unitOfCfg } from './units.js'`. As outras leituras de `S.unit` em `progression.js` (linhas 220, 223, 238-248) são **strings de mensagem** interpoladas com `{1}`/`{2}` — elas passam a exibir a unidade do exercício automaticamente, que é o desejado.

**10.6 `TopWeight` (linhas 846-893): o sheet de confirmação de peso.**

> **Atenção ao nome `unit`:** dentro de `TopWeight` já existe `const unit = entry ? unitOf(units, entryIdx) : []` (linha 862) — o **array de superset** de `history.js:unitOf`. Ele precisa ser renomeado antes de a unidade entrar, senão o nome é sombreado, `unit.every(...)` quebra com `TypeError` e o sheet não abre. Rename completo:

```js
// ANTES (linhas 861-865)
  const units = supersetUnits(A ? A.entries : [])
  const unit = entry ? unitOf(units, entryIdx) : []
  const unitDone = !!entry && unit.every(i => A.entries[i].sets.every(s => s.done))
  const unitIdx = units.findIndex(u => u === unit)
  const isLastUnit = unitIdx === units.length - 1
```
```js
// DEPOIS
  const units = supersetUnits(A ? A.entries : [])
  const supUnit = entry ? unitOf(units, entryIdx) : []                    // rename: o nome `unit` passa a ser a unidade
  const supDone = !!entry && supUnit.every(i => A.entries[i].sets.every(s => s.done))
  const supIdx = units.findIndex(u => u === supUnit)
  const isLastUnit = supIdx === units.length - 1
  const unit = entry ? unitOfEntry(entry, st) : normUnit(st.unit)          // BACKLOG-01
```
```js
// ANTES (linha 858)
  const [v, setV] = useState(entry ? (Math.max(maxSet, prevBest) || entry.target.weight || 0) : 0)
```
```js
// DEPOIS — a linha 858 fica **igual**: ela não usa unidade nenhuma. O `unit` que a spec
// introduz é declarado depois dela (junto do bloco de superset, linhas 861-865), e as
// linhas que o consomem (880, 884, 885, 887) vêm depois disso. Ordem importa aqui: se o
// `unit` fosse declarado depois da 888, o sheet quebra.
  const [v, setV] = useState(entry ? (Math.max(maxSet, prevBest) || entry.target.weight || 0) : 0)
```
```jsx
// ANTES (linhas 880, 884, 885, 887, 888 — as CINCO linhas que usam o array de superset)
    } else toast(t('Tracked for this exercise: {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))
...
    <div className="muted small">{t('Confirm the weight you worked with — it is saved for this exercise and used when a routine prescribes no load.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {st.unit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
```
```jsx
// DEPOIS
    } else toast(t('Tracked for this exercise: {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + unit))
...
    <div className="muted small">{t('Confirm the weight you worked with — it is saved for this exercise and used when a routine prescribes no load.')}{!supDone && supUnit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {unit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {supDone ? <>
```

> **`unit.length > 1` é um teste de superset disfarçado de unidade.** Depois do rename, `unit` é a string `'lb'` e `'lb'.length` é **2** — `'lb'.length > 1` é `true` e a frase "Then finish the superset partner." apareceria até num treino avulso sem parceiro. E se `unitDone` não acompanhar o rename, a linha lança `ReferenceError` e o sheet de confirmação de peso **não abre**. O rename tem de pegar as **cinco** ocorrências na mesma edição: `unit` (861-865), `unitDone` (863, 884, 888), `unitIdx` (864) e `unit.length` (884).

**10.7 `WeightInput` (linhas 60-75): sem mudança.** Já recebe `unit` e ajusta o teto (`wHi`: 660 em lb, 300 em kg). Só passa a receber a unidade do exercício.

**10.8 `FinishSummary` (linha 916) e os cartões de volume (753, 797, 816).**

**A mudança que importa é a chamada em `doFinishWorkout`, linha 961** — sem ela o volume gravado continua somando números crus:

```js
// ANTES (linha 961, dentro de doFinishWorkout)
  w.vol = workoutVolume(w)
```
```js
// DEPOIS
  w.vol = workoutVolume(w, st)
```
> `st` já está em escopo: `const st = S()` é a linha 940 de `doFinishWorkout`. `workoutVolume(w, st)` resolve a unidade de cada série e devolve o total na unidade do perfil (§5.3).

```jsx
// DEPOIS — sem mudança de markup: `w.vol` passou a ser somado em kg e devolvido na unidade do
// perfil por `workoutVolume` (RF-11), então `fmtVol(w.vol, st.unit)` continua certo.
```

**10.9 Detalhe do exercício e histórico (linhas 297 e 759).**

```jsx
// ANTES (297)
{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target)).join(', ')}` : ''}
// DEPOIS
{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target, st)).join(', ')}` : ''}
```
```jsx
// ANTES (759)
<div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e.target)).join('  ·  ') || t('no sets')}</div>
// DEPOIS
<div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e.target, st)).join('  ·  ') || t('no sets')}</div>
```

### 11. `frontend/src/views/Stats.jsx`

**11.1 Imports e a unidade do exercício em foco (linha 208).**

```js
// ANTES
  const exUnit = curCardio ? 'km/h' : curTimed ? 's' : S.unit
```
```js
// DEPOIS
  // BACKLOG-01: a unidade do exercício em foco vem do TEMPLATE da rotina que o usa, não da
  // última sessão registrada. Tirar da última entrada faria o eixo do gráfico e o "Best:"
  // mudarem de unidade sozinhos assim que um treino novo do exercício fosse salvo, sem que
  // nada no dado tivesse mudado — e isso contradiz U1 ("vale só daqui pra frente").
  // Se o mesmo id estiver em mais de uma rotina com unidades diferentes, a primeira vence:
  // a tela é do exercício, não da rotina, e a ambiguidade fica declarada em vez de escondida.
  const curCfg = S.routines.flatMap(r => r.ex).find(x => x.id === curEx) || { id: curEx }
  const exUnit = curCardio ? 'km/h' : curTimed ? 's' : unitOfCfg(curCfg, S)
```
> Import novo no topo de `Stats.jsx`: `import { unitOfCfg } from '../lib/units.js'`.

**11.1b As duas linhas de "Best" (292 e 295) passam a usar `exUnit`, não `S.unit`.** O e1RM vem de `onerm.js` sobre os pesos **crus** do exercício (A-4), então rotulá-lo com a unidade do perfil mente num exercício em libras:

```jsx
// ANTES (292)
<b className="accent">{fmtNum(onE1 ? e1Best.est : exBest)} {onE1 ? S.unit : exUnit}</b>
// DEPOIS
<b className="accent">{fmtNum(onE1 ? e1Best.est : exBest)} {exUnit}</b>
```
```jsx
// ANTES (295)
{t('Best estimate from {0} on {1} — an estimate, not a tested max.', fmtNum(e1Best.w) + ' ' + S.unit + ' × ' + e1Best.r, fmtDate(e1Best.d, true))}
// DEPOIS
{t('Best estimate from {0} on {1} — an estimate, not a tested max.', fmtNum(e1Best.w) + ' ' + exUnit + ' × ' + e1Best.r, fmtDate(e1Best.d, true))}
```

**11.2 O rótulo das séries (linha 289).**

```jsx
// ANTES
<span>{p.sets.map(s => setLabel(curEx, s, p.target)).join('  ')}</span>
// DEPOIS
<span>{p.sets.map(s => setLabel(curEx, s, p.target, S)).join('  ')}</span>
```

### 12. `frontend/src/lib/plan-share.js` — plano impresso

**12.1 `scheme` já recebe a unidade (linhas 146-154): sem mudança.** Ele só monta a string a partir do `unit` que o chamador passa.

**12.2 Import no topo do arquivo (junto dos outros) — não no meio da função.**

```js
// ANTES (topo de plan-share.js)
import { fmtNum } from './format.js'
```
```js
// DEPOIS (topo de plan-share.js)
import { fmtNum } from './format.js'
import { unitOfCfg } from './units.js'
```

**12.3 `routineHTML` (linha 171) e `planPrintHTML` (linha 201): resolver por exercício.**

```js
// ANTES
function routineHTML(r, unit) {
  ...
      return `<div class="ex"><div class="ex-n">${esc(name)}${part}</div><div class="ex-s">${esc(scheme(e, unit))}</div></div>`
```
```js
// DEPOIS
function routineHTML(r, S) {
  ...
      return `<div class="ex"><div class="ex-n">${esc(name)}${part}</div><div class="ex-s">${esc(scheme(e, unitOfCfg(e, S)))}</div></div>`
```
```js
// ANTES (linhas 201-204)
  const unit = S.unit || 'kg'
  ... routines.map(r => routineHTML(r, unit)).join('')
```
```js
// DEPOIS (a `const unit` some: fica sem uso)
  ... routines.map(r => routineHTML(r, S)).join('')
```

**12.4 `cleanEx` (linhas 20-49) precisa carregar `unit` para o plano exportado.**

O `.json` do `buildPlanBundle` passa por `cleanEx`, que **não** copia a entrada inteira: ele monta `const o = { id: e.id, sets: e.sets }` (linha 21) e acrescenta campo a campo por modo. Se `unit` não entrar, o plano impresso mostra "200 lb" mas o arquivo que o amigo importa perde a unidade e o exercício volta a ser lido em kg — impressão e arquivo discordando é pior do que os dois errarem juntos. `unit` viaja **junto do peso**, nas duas branches que gravam peso (`time` e `reps`) — cardio não tem carga, então não tem unidade:

```js
// ANTES (linhas 26-35)
  } else if (mode === 'time') {
    // Written out even though 'reps' is the fallback for a non-cardio id: a plan file that
    // dropped the mode would turn a 45-second plank into a 45-rep one at the other end.
    o.mode = 'time'
    if (e.sec != null) o.sec = e.sec
    if (e.weight) o.weight = e.weight
  } else {
    if (e.reps != null) o.reps = e.reps
    if (e.weight) o.weight = e.weight
  }
```
```js
// DEPOIS
  } else if (mode === 'time') {
    // Written out even though 'reps' is the fallback for a non-cardio id: a plan file that
    // dropped the mode would turn a 45-second plank into a 45-rep one at the other end.
    o.mode = 'time'
    if (e.sec != null) o.sec = e.sec
    if (e.weight) o.weight = e.weight
    if (e.weight && e.unit) o.unit = e.unit          // BACKLOG-01: a unidade viaja com o peso
  } else {
    if (e.reps != null) o.reps = e.reps
    if (e.weight) o.weight = e.weight
    if (e.weight && e.unit) o.unit = e.unit          // BACKLOG-01
  }
```
> Sem peso não há o que medir, então `unit` órfão não é gravado — e um plano sem unidade continua byte a byte igual ao de antes.

### 13. Locales

`en` é a chave-fonte (`i18n.js:34-38`: chave ausente devolve a própria string em inglês), então **só `frontend/src/locales/pt.js` precisa das traduções novas**. As outras 10 línguas (`de, es, fr, hi, it, ko, pl, ru, tr, zh`) vão exibir estas seis strings **em inglês** — é o comportamento normal para string nova, e está registrado aqui de propósito para ninguém achar que é bug.

**Chaves reaproveitadas** (já existem em `pt.js`, não mexer): `'Weight unit'` (`pt.js:256` → `'Unidade de peso'`) e `'Default'` (`pt.js:259` → `'Padrão'`).

**Chaves novas** — a chave tem de ser **exatamente** a string literal usada no `t()`, sem ponto final que não exista no JSX:

```js
  'Use the profile unit': 'Usar a unidade do perfil',
  'Same as your profile ({0})': 'Igual à do seu perfil ({0})',
  'This exercise is measured in {0}': 'Este exercício é medido em {0}',
  'Unit saved for {0} — {1}': 'Unidade salva para {0} — {1}',
  'Unit saved for this session — {0}': 'Unidade salva para esta sessão — {0}',
  'Unit reset to the profile default': 'Unidade de volta ao padrão do perfil',
```

> **`'Default'` é compartilhada de propósito.** A mesma chave já rotula "voltar ao padrão" no `RestChip` (`Workout.jsx:82`) e no `RestChipForRoutine` (`RoutineEdit.jsx:50`), e agora no `UnitChip`. É a mesma ideia ("voltar ao padrão"), então a tradução também tem de ser a mesma — uma chave `'Profile default'` separada produziria duas frases para o mesmo gesto. Registrado aqui para a próxima pessoa não achar que é descuido.

> `'kg'` e `'lb'` **não** são traduzidos em lugar nenhum — são símbolos, não palavras.

### 14. Companheiro no Hermes (fora do repo do app)

Arquivos em `/home/pi/.hermes/workout/scripts/` (versionados pelo `hermes-snapshot`). O contrato abaixo é o mínimo verificável — sem ele, RF-14 não é julgável:

| # | Contrato | Como se prova |
|---|---|---|
| 14.1 | `dump --routine <id>` imprime `unit` quando a entrada tem unidade (ex.: `0585 sets=3 reps=6-8 weight=200 unit=lb`), e **omite** quando não tem | saída do `dump` sobre `r_leg1_20260823` depois da migração |
| 14.2 | `plan --intent i.json` mostra `unit` no diff só quando a intenção o muda; intenção sem `unit` não gera linha de diff | `plan` num intent que só mexe em `weight` |
| 14.3 | `apply` **preserva** `unit` das entradas que a intenção não cita | recibo + releitura: `0585` continua `unit=lb` após um `apply` que muda `0598` |
| 14.4 | intenção com `"unit": "lbs"` é recusada com **código de saída 1** e a entrada em `excluidos[]`, antes de qualquer escrita | `apply --dry-run` no intent inválido |
| 14.5 | `FROZEN = {"0585","0599"}` deixa de bloquear mudança de **peso** nesses ids; o portão P1 (`verificar_prescricao.py`) continua sendo quem compara com o valor atual da rotina | `apply` de `0585` 200→210 sem `--allow-frozen`, com o portão passando |
| 14.6 | teste nomeado em `~/.hermes/workout/scripts/test_escritor_rotinas.py`: `test_unit_preservado_e_validado` cobrindo 14.3 e 14.4 | `python3 -m pytest test_escritor_rotinas.py -k unit` verde no Pi |

Mais: **`treino-coach/SKILL.md`** (passo 6 e a frase "0585 e 0599 ficam em 200 lbs") passa a dizer que a unidade é um campo do exercício (`ex.unit`), que `200` continua sendo o número e que **não há conversão** a fazer no template — quem converte é `api/coach.js`. **`verificar_prescricao.py`** não muda (compara com o valor atual da rotina).

> Nada disso é bloqueante para a entrega no app: o app funciona com o `unit` gravado pela migração do cliente. Mas sem 14.3 o escritor apaga o `unit` no próximo `apply`, e é exatamente esse tipo de perda silenciosa que a BACKLOG-07 foi feita para evitar.

### 15. Testes

**15.1 `api/coach.test.js` — arquivo novo** (`node --test` dentro da imagem `api`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsFromState } from './coach.js';

const S = (unit, ex) => ({ unit, customEx: [], workouts: [
  { start: 1757500000000, end: 1757503600000, name: 'T', entries: [
    { id: '0585', target: ex,
      sets: [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: true, wUnit: 'kg' }] }
  ]}
]});

test('perfil kg, exercício em lb: converte por série', () => {
  const rows = rowsFromState(S('kg', { unit: 'lb' }));
  assert.equal(rows[0].weight_kg, '45.36');
  assert.equal(rows[0]._unit, 'lb');
  assert.equal(rows[1]._unit, 'kg');      // wUnit vence o target
  assert.equal(rows[1].weight_kg, '100');
});

test('sem unit em lugar nenhum, comportamento de hoje', () => {
  const rows = rowsFromState(S('kg', {}));
  assert.equal(rows[0].weight_kg, '100');
  assert.equal(rows[1].weight_kg, '100');
});

test('perfil lb, exercício em kg', () => {
  const rows = rowsFromState(S('lb', { unit: 'kg' }));
  assert.equal(rows[0].weight_kg, '100');                 // alvo explícito em kg
  assert.equal(rows[0]._unit, 'kg');
  const semUnit = rowsFromState(S('lb', {}));             // sem unit: o perfil lb converte
  assert.equal(semUnit[0].weight_kg, '45.36');
  assert.equal(semUnit[0]._unit, 'lb');
});
```

> Os `start`/`end` numéricos do fixture são obrigatórios: `rowsFromState` faz `new Date(Number(w.start))` e sem eles a sessão colapsa numa chave `NaN` e `_date` vira `"Invalid Date"`. As duas saídas observáveis da decisão por série são `weight_kg` (a que o critério de aceite 1 cita) e `_unit`. O teste roda com `cwd` no repo — `coach.js` carrega `exercise_catalog.json` por caminho relativo ao próprio arquivo, então rodar de fora de `api/` continua funcionando, mas o comando de §15.4 assume a raiz do repo.

**15.2 `api/routines.test.js` — casos novos.**

```js
test('unit: aceita kg/lb e recusa o resto', () => {
  const base = { id: '0585', sets: 3, reps: 10, weight: 200 };
  const where = { where: 'ex.0585' };
  assert.equal(validateExEntry({ ...base, unit: 'lb' }, where), null);
  assert.equal(validateExEntry({ ...base, unit: 'kg' }, where), null);
  assert.equal(validateExEntry(base, where), null);                     // ausente = herda
  const bad = validateExEntry({ ...base, unit: 'lbs' }, where);
  assert.equal(bad.code, 'BAD_UNIT');
  assert.equal(bad.field, 'ex.0585.unit');                              // RF-7 promete o id no campo
  assert.equal(validateExEntry({ ...base, unit: 'LB' }, where).code, 'BAD_UNIT');
});

test('PATCH preserva unit que a intenção não cita', () => {
  const cur = { id: 'r1', ex: [{ id: '0585', sets: 3, reps: 10, weight: 200, unit: 'lb' }] };
  // catálogo e custom de verdade: sem eles `validateExEntry` pula CATALOG_UNKNOWN_EX e o
  // teste deixaria de exercitar o caminho que a RF-8 quer proteger (routines.test.js:145).
  const custom = new Set();
  assert.equal(mergeRoutine(cur, { ex: { '0585': { weight: 210 } } }, CATALOG_MAP, custom), null);
  assert.equal(cur.ex[0].unit, 'lb');
  assert.equal(cur.ex[0].weight, 210);
});
```

**15.3 `frontend/src/lib/history.test.js` — casos novos.**

```js
describe('unidade por exercício (BACKLOG-01)', () => {
  const S = { unit: 'kg', exWeights: {}, routines: [], workouts: [] }

  it('setLabel só mostra o sufixo quando a série não está na unidade do perfil', () => {
    const cfg = { id: 'X', unit: 'lb' }
    expect(setLabel('X', { w: 200, r: 5 }, cfg, S)).toBe('200 lb × 5')
    expect(setLabel('X', { w: 100, r: 5 }, { id: 'X' }, S)).toBe('100×5')
  })

  it('setLabel sem o estado mantém o rótulo de antes', () => {
    expect(setLabel('X', { w: 200, r: 5 }, { id: 'X', unit: 'lb' })).toBe('200×5')
  })

  it('workoutVolume soma em kg e volta para a unidade do perfil', () => {
    const w = { entries: [
      { id: 'A', sets: [{ w: 100, r: 10, done: true }] },                       // kg
      { id: 'B', target: { unit: 'lb' }, sets: [{ w: 100, r: 10, done: true }] } // 45.36 kg
    ]}
    expect(workoutVolume(w, S)).toBe(1453.6)   // 1000 + 453.6
  })

  it('perfil lb converte o exercício em kg', () => {
    const w = { entries: [{ id: 'A', target: { unit: 'kg' }, sets: [{ w: 100, r: 10, done: true }] }] }
    expect(workoutVolume(w, { unit: 'lb' })).toBe(2204.6)   // 100 kg = 220.46 lb × 10
  })
})
```

**15.4 Verificação de ponta a ponta (Fase 6 da spec, manual) — sempre a partir da raiz do repo:**

```bash
cd /mnt/drivebackup/apps/openGym/openGym

# 1. testes do servidor: o alvo é o arquivo, não o diretório — `node --test` na raiz do
#    repo não carrega este teste, e ele faz process.env.DATA_DIR antes do import.
node --test api/routines.test.js api/coach.test.js

# 2. testes e bundle do frontend
(cd frontend && npm test && npm run build)

# 3. publicar
sudo docker compose up -d --build api web
```

### 16. Fora do caminho principal, mas com uma linha a mudar

**16.1 `frontend/src/views/Admin.jsx:60`** — é o único outro chamador de `workoutVolume`, e chama com **um** argumento:

```jsx
// ANTES
<span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
// DEPOIS
<span className="small muted">{fmtVol(w.vol ?? workoutVolume(w, { unit: d.unit }), d.unit)}</span>
```
> O fallback roda para treinos sem `vol` gravado (importados/antigos). Sem o segundo argumento, `normUnit(undefined)` devolve `kg` e o painel mostraria um número em kg rotulado `lb` num perfil em libras. `d` é o documento do usuário que o admin está olhando, e `d.unit` é a unidade dele.

**16.2 `components/Heatmap.jsx:40` e o `Calendar` (`sheets.jsx:777,797`) — sem mudança, e de propósito.** Os três somam `w.vol` de vários treinos. Como `w.vol` é **gravado na unidade do perfil** (§5.3), a soma é coerente mesmo com exercícios em unidades diferentes dentro de cada treino. O que continua quebrado é trocar `S.unit` depois — problema pré-existente e registrado em R-3.

**16.3 `sheets.jsx:922` (`FinishSummary`) — o PR de e1RM tem de seguir §11.1b.** É o mesmo número do mesmo cálculo (`onerm.js` sobre pesos crus) rotulado em outro lugar da mesma sessão:

```jsx
// ANTES (linha 922)
{e1prs.map(p => <div key={p.id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} {(EXIDX[p.id] || {}).n || p.id} · {fmtNum(p.est)} {st.unit}</div>)}
// DEPOIS
{e1prs.map(p => <div key={p.id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} {(EXIDX[p.id] || {}).n || p.id} · {fmtNum(p.est)} {unitOfEntry(A.entries.find(e => e.id === p.id) || {}, st)}</div>)}
```
> `A` é o `active` que o `FinishSummary` já alcança por `useStore` (a entrada ainda existe quando o sheet abre). Sem isso, terminar um treino com `0585` anuncia "Best estimated 1RM: lever leg extension · 200 kg" num aparelho em libras.

**16.4 `sheets.jsx:297` e o bloco `OneRM` (266-276) — os dois últimos rótulos com `st.unit` sobre número cru.**

`ExerciseDetail` (297) mostra `bestWeightFor(st, ex.id)` — pesos crus (A-4) — e o mesmo `setLabel` que §10.9 corrige está **na mesma linha**:

```jsx
// ANTES (linha 297)
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent">{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target)).join(', ')}` : ''}</div>}
// DEPOIS
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent">{fmtNum(best)} {exUnit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target, st)).join(', ')}` : ''}</div>}
```
> `exUnit` é resolvido no topo de `ExerciseDetail` (depois da linha 286): `const exUnit = unitOfEntry(last || { target: cfgOf(st, ex.id) }, st)`, com `cfgOf` = o mesmo `S.routines.flatMap(r => r.ex).find(x => x.id === id)` de §11.1. **Um só helper, usado nos quatro lugares** (`Stats`, `ExerciseDetail`, `OneRM`, `FinishSummary`) — repetir a busca em cada tela é como as quatro versões divergem.

`OneRM` (o bloco "Estimated 1RM", linhas 258-281) usa `st.unit` em **quatro** pontos — 266, 267, 270 e 275 — sobre `best1RM`/`estimate1RM`, que também são pesos crus. Trocar os quatro por uma `exUnit` resolvida igual (`unitOfEntry(lastEntryFor(st, ex.id) || {}, st)`): o bloco não recebe `ex` como cfg, então a fonte é a última entrada do exercício, com queda para o perfil.

## Comportamento Visual/UX

### 1. Editor da rotina — linha do exercício (Legs 1, depois da migração)

```
┌──────────────────────────────────────────────────────────┐
│  Legs 1                                              ⋯   │
├──────────────────────────────────────────────────────────┤
│ ▸ Lever leg extension                                    │
│   3 × 10 · 200 lb                    [ ⏱ 90s ] [ ⚖ lb ] │   ← chip acc (unidade própria)
│ ▸ Lever seated leg curl                                  │
│   3 × 10 · 200 lb                    [ ⏱ 90s ] [ ⚖ lb ] │
│ ▸ Leg press                                              │
│   3 × 12 · 180 kg                    [ ⏱ 90s ] [ ⚖ kg ] │   ← cinza (herda o perfil)
└──────────────────────────────────────────────────────────┘
```

### 2. Sheet de configuração do exercício

```
┌──────────────────────────────────────────────┐
│  Lever leg extension                         │
│  ─────────────────────────────────────────   │
│   Sets     Reps         Weight (lb)          │
│   [ 3 ]    [ 10 ]       [ 200 ]              │
│   ─────────────────────────────────────────   │
│   ⚖  Weight unit            [ kg | lb ]      │   ← Segmented, lb ativo
│      This exercise is measured in lb.        │
│   ─────────────────────────────────────────   │
│   Bodyweight                          ( )    │
│   Reps per side                       ( )    │
│   ─────────────────────────────────────────   │
│              [        Save        ]          │
└──────────────────────────────────────────────┘
```

### 3. Treino em andamento — bloco do exercício

```
┌──────────────────────────────────────────────────────────┐
│  Lever leg extension                              (i)    │
│  ┌────────┐  [ Upper legs ]  [ leverage machine ]        │
│  │  gif   │  [ Best: 200 lb ]  [ ⏱ 90s ]  [ ⚖ lb ]      │  ← chip verde: unidade própria
│  └────────┘                                              │
│  Last time (8 Sep): 200 lb × 12, 200 lb × 12             │
│  ──────────────────────────────────────────────────────  │
│      Weight (lb)        Reps                    ✓        │
│   1   ─  200  +        ─  12  +                 ☐        │
│   2   ─  200  +        ─  12  +                 ☐        │
│   3   ─  200  +        ─  12  +                 ☐        │
└──────────────────────────────────────────────────────────┘
```

Sheet do chip `⚖ lb`:

```
┌──────────────────────────────────────────────┐
│  Weight unit                                 │
│  ─────────────────────────────────────────   │
│   kg                                         │
│   lb                                       ✓ │
│   ─────────────────────────────────────────   │
│   Default (kg)                               │
│   Use the profile unit                       │
└──────────────────────────────────────────────┘
```

### 4. Sheet de confirmação de peso (fim do exercício)

```
┌──────────────────────────────────────────────┐
│  ✓ Lever leg extension done                  │
│  Confirm the weight you worked with — it is  │
│  saved for this exercise and used when a     │
│  routine prescribes no load.                 │
│                                              │
│              ─  200  +   lb                  │
│                                              │
│         Previous best: 200 lb                │
│                                              │
│           [   Save & next exercise   ]       │
└──────────────────────────────────────────────┘
```

### 5. Toasts

| Ação | Toast |
|---|---|
| marcar `lb` | `Unit saved for Legs 1 — lb` |
| voltar ao padrão | `Unit reset to the profile default` |
| peso confirmado | `Tracked for this exercise: 200 lb` |

### 6. Stats — exercício em foco

```
┌──────────────────────────────────────────────┐
│  Lever leg extension                         │
│  Best: 200 lb      (was 200 kg before)       │
│  ─────────────────────────────────────────   │
│      ╭─────────────╮                         │
│      │   gráfico    │  unidade do eixo: lb   │
│      ╰─────────────╯                         │
│  10 Sep 2026   200 lb × 12  200 lb × 12      │
└──────────────────────────────────────────────┘
```

> As duas sessões de setembro (02/09 e 06/09) continuam sendo lidas em **kg** por causa de U1: são elas que seguram o "Best:" em `200` e o pico de e1RM em ~253 kg, contra um topo histórico real de ~131 kg. É o efeito descrito em R-1.

## Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| 1 | `100 lb` num exercício e `100 kg` em outro, perfil `kg` → análise mostra `45.36` e `100` | RF-3; `api/coach.test.js:1` |
| 2 | e1RM e tonnage saem do valor convertido, por exercício | `GET /api/coach/analysis` → `progress['lever leg extension']` |
| 3 | Sem `unit` em lugar nenhum, os números de hoje não mudam | `api/coach.test.js:2`; suíte do frontend verde |
| 4 | Trocar `S.unit` de `kg` para `lb` não altera peso com `unit` explícito | `api/coach.test.js:3` |
| 5 | O editor grava `unit` só quando difere do perfil (e remove ao voltar) | Inspecionar o `PUT`; `ex.unit` ausente na maioria |
| 6 | Trocar no meio do treino grava na sessão **e** na rotina, com toast | Reload: o chip continua verde e a linha da rotina mostra `lb` |
| 7 | `unit: 'lbs'` no `PATCH` → `400 BAD_UNIT`; `PATCH` sem citar `unit` preserva o valor | RF-7/RF-8; `api/routines.test.js` |
| 8 | `0585`/`0599` passam a `lb` uma única vez; remover à mão não volta | RF-9/RF-10 |
| 9 | Histórico antigo de `0585` continua valendo `108,86 · 63,5 · 90,72` **kg**, e as duas sessões de 02-06/09 continuam valendo `200` **kg** | RF-10 (U1/U4); conferir `GET /api/coach/analysis` |
| 10 | Volume de um treino misto é somado em kg e exibido no perfil (`100kg×10 + 100lb×10` → `1453.6`) | RF-11; `history.test.js` |
| 11 | O passo de progressão exibido e o aplicado são o mesmo num exercício em lb | §10.5b; ligar `prog` num exercício em lb e conferir o número do dia |
| 12 | `exports` do plano preservam `unit` (o `.json` importado mantém `lb`) | §12.4; exportar e reimportar |
| 13 | `npm test` (frontend) e `node --test api/routines.test.js api/coach.test.js` verdes; `npm run build` sem erro | §15.4 |
| 14 | `git diff` não toca `data/`, `.env`, `og.key`, `og.crt` | — |

## Riscos e consequências conhecidas

- **R-1 (consequência de U1 + U4, medida no dado real, e aceita pelo usuário).** As duas sessões de `0585`/`0599` de **02/09 e 06/09** guardam o número cru da máquina (`200x8, 200x8, 200x6`) e continuam sendo lidas em **kg** por decisão explícita (U4). O topo histórico **real** desses exercícios (em kg, convertido à mão) é `108,86 kg` / e1RM ≈ `131 kg`; essas duas sessões aparecem como `200 kg` / e1RM ≈ **253 kg**. É um pico de **1,93×** que o filtro de outlier de `api/coach.js` (`w0 > 2,5×w1`) **não** pega. Efeito permanente e conhecido: o `wmax` de `0585`/`0599` fica em `200 kg`, o e1RM em ~253 kg e o recorde desses dois exercícios **nunca é superado de verdade** (a sessão nova de 90,72 kg aparece como uma queda). A correção existe e foi oferecida — marcar `wUnit: 'lb'` em 6 séries de cada exercício — e o usuário escolheu não fazer. **Não** "conserte" isso na implementação: é decisão de produto, não bug.
- **R-2 (U3).** Trocar a unidade de um exercício reinterpreta **todo** o histórico dele (A-4): plano impresso, "Best:", caderno, gráficos de Stats e as séries de e1RM de `onerm.js` passam a exibir o mesmo número em outra unidade. A análise, que converte por série, é a única imune — e é por isso que ela é a fonte oficial. Consequência aceita, não bug.
- **R-3 (pré-existente, fora de escopo).** `w.vol` é gravado na unidade do perfil do dia; trocar `S.unit` depois não converte o que já está gravado. Já é assim hoje e não piora com esta spec (§16.2).
- **R-4.** Dois módulos espelhados (`units.js`) podem divergir numa edição futura. Mitigação: os dois arquivos exportam a mesma superfície, `api/coach.test.js` fixa os números e o cabeçalho de cada um diz para mudar o outro.
- **R-5 (verificado no estado de produção em 11/09/2026).** Fonte: `/mnt/drivebackup/apps/openGym/data/state-ZPJbmYUfHlfbAYzi.json`, 274376 bytes, `sha256 6bfa0e10f14ffe9534a6f4541aefde02b1a7fe58c8b0a54c855799f936dd1e8e`, mtime `2026-09-11 13:29`. As 5 rotinas reais (`r_leg1_20260823`, `r_leg2_20260823`, `r_push_C_20260829`, `r_pull_C_20260829`, `r_upper_C_20260829`) estão todas `prog: "off"` e nenhum exercício tem `prog` próprio, então mexer no passo da progressão (§10.5b) tem efeito **zero** hoje. Quando a progressão for ligada num desses aparelhos, o passo passa a ser 5/10 em vez de 2,5/5 — desejado, mas é mudança de comportamento visível no dia em que acontecer. **Se este parágrafo for re-verificado, meça o arquivo de produção** (caminho e sha acima): o snapshot em `hermes-snapshot/opengym-data/` tem `prog: "linear"` e templates `108/90`, e é dado velho (R-9).
- **R-6 (dado sujo, não reproduzível a partir do repo).** O estado real tem valores altos isolados fora dos dois aparelhos — `0584` com `474` e `immt53oq1hbpvsp` com `401`, contra templates de `45` e `75`. A razão (10,5× e 5,3×) é maior que 2,5×, então o filtro de outlier da análise **já os descarta** de tonnage e e1RM; eles ficam registrados para não serem confundidos com o efeito desta mudança. `0584` e `0585` **existem** no `api/exercise_catalog.json` do repo (conferido), então não é id fantasma.
- **R-7.** O escritor do Hermes apagando `unit` num `apply` futuro é a falha mais provável desta entrega — o teste de RF-8 cobre o servidor, não o script. O contrato de §14.3/14.6 é o que fecha esse buraco, e ele vive **fora** do repo do app.
- **R-8 (investigado e descartado na revisão).** O estado tem um terceiro id com `200`/`240` — `immt53oq2lms3te`, exercício **custom** chamado *full squat*, barra. Investigado em 11/09/2026: o histórico é de **set/out de 2025** (import antigo) e é uma rampa de agachamento (`40 → 70 → 100 → 150 → 180 → 200 → 220 → 230 → 240`), com valores plausíveis em kg; **não** está em nenhuma rotina. Não é uma máquina em libras e a migração **não** deve tocá-lo. Fica registrado para ninguém reabrir a investigação achando que é o mesmo caso.
- **R-9 (armadilha operacional, encontrada na revisão 2 — leia antes de medir qualquer coisa).** Existe uma **cópia velha** do estado do usuário em `C:\Users\emerson\hermes-snapshot\opengym-data\state-ZPJbmYUfHlfbAYzi.json` (o backup diário do Hermes versiona `opengym-data/`). Em 11/09/2026 ela tinha mtime `05/09 16:56`, 262023 bytes, último treino **25/08**, rotinas com ids antigos (`r_push_20260823`…), `prog: "linear"` e templates `0585 = 108`, `0599 = 90`. **Tudo isso é dado de ~2 semanas antes** — e a diferença não é cosmética: uma revisão que leu esse arquivo concluiu que o template era `108` e que a migração o transformaria em 49 kg, e pediu para reabrir U1/U4 com o usuário. A fonte de verdade é **só** `/mnt/drivebackup/apps/openGym/data/state-ZPJbmYUfHlfbAYzi.json` (no Pi, via `ssh hermes`), conferida por mtime/sha. A própria BACKLOG-08 já registrou um intervalo de **10 dias** sem snapshot (30/08 → 08/09) — o arquivo pode estar bem mais velho do que o mtime sugere.

## Achados da revisão 1 (consolidação)
45 achados de um revisor independente sobre a v1. O que foi **aceito** está aplicado acima; o registro abaixo existe para o implementador não reintroduzir o que foi recusado de propósito.

**Aceitos e aplicados** (com o de maior impacto primeiro): `workoutVolume` convertendo **uma vez no total** em vez de por série (F01/F02 — a v1 errava o teste por 0,4); o rename completo do array de superset em `TopWeight` antes de `unit` virar a unidade (F05 — sem isso o sheet de confirmação de peso quebrava com `TypeError`); `nextPrescription` lendo a unidade do exercício (F21 — o passo exibido e o aplicado discordavam); as três *labels* de peso do `ExConfig` (F42); `Admin.jsx:60` (F31); `cleanEx` carregando `unit` para o plano exportado (F19); o `ANTES→DEPOIS` explícito de `sheets.jsx:961` (F22); a ancoragem de linha da migração (F06/F07); a migração só marcar a flag quando há rotinas, e migrar `active` (F24/F25); `Stats` tirando a unidade do template da rotina em vez da última sessão (F11); as linhas de "Best" do `Stats` usando `exUnit` (F28); o contrato verificável do escritor do Hermes (F26); o `normUnit` no `UnitChip` (F34); a revalidação de `entry.id` no `onChange` (F43); os ajustes dos testes (F03/F32/F33/F39); `unitOfCfg` fora do import de `history.js` (F41); o import de `plan-share` no topo (F18); as chaves de locale sem ponto final (F40).

**Recusados, com motivo:**

| Achado | Por que não |
|---|---|
| **F08** — "`setLabel` compara `target.unit` consigo mesmo e o sufixo nunca aparece" | **Falso.** O código proposto compara com `normUnit(S.unit)` (a unidade do **perfil**), nunca com o `cfg`. `cfg` é a *fonte* da unidade da série, não o termo de comparação. A regra ficou mais explícita na v2 (§5.2) justamente por causa da confusão. |
| **F09** — "`api/coach.js:90` usa `kw = !String(w).startsWith('kg')` e as duas normalizações discordam" | **Falso.** Não existe `kw` nem `startsWith('kg')` em `api/coach.js`; os únicos usos são as linhas 44, 45 e 77. Conferido por grep no arquivo real. |
| **F15** — "`UnitChip` usa `useUI` sem importar" | **Falso.** O `import { useUI } from '../store/useUI.js'` está no bloco proposto desde a v1. |
| **F23** — o detalhe do exercício deveria usar a unidade da rotina atual, não a da última sessão | O sufixo responde "este número **não** está na unidade do seu perfil". Quem sabe disso é o `target` da sessão que gravou a série, não a rotina de hoje. Um exercício em 3 rotinas com unidades diferentes continua correto assim; a ambiguidade de *exibição* de `Stats` é outro caso e foi tratada em §11.1. |
| **F29** — `onerm.js` deveria converter por série | Converter ali contradiz U3: com "o número não é recalculado", o e1RM de um exercício é uma série de números **crus** comparáveis entre si dentro daquele exercício. Declarado em R-2. |
| **F30** — `Heatmap`/`Calendar` somam volumes de unidades diferentes | `w.vol` é gravado **na unidade do perfil**, então a soma é coerente; o que quebra é trocar `S.unit` depois, que é R-3 (pré-existente). |
| **F35** — `wUnit` sem validação no servidor | Registrado como decisão explícita (A-13) em vez de silêncio: nenhuma tela escreve `wUnit`, e `checkState` é *deliberadamente* loose. |
| **F44** — "nada verifica que as rotinas estão `prog:"off"`" | **Verificado no estado de produção**: as 5 rotinas reais estão `prog=off` e nenhum exercício tem `prog`. R-5 passou a citar a medição. |
| **F45** — "`0584` não existe no catálogo versionado" | **Falso**: `grep '"id": *"0584"' api/exercise_catalog.json` encontra. R-6 foi reescrito com a evidência medida. |
| **F04** — fixture do teste sem `start`/`end` | Já tinha `start`/`end` numéricos desde a v1; o que faltava era a nota explicando por que são obrigatórios (§15.1). |
| **F20** — o seletor aparece sem carga em `time` com `w=0` | A condição é a mesma que decide o stepper de peso; em `time` o app **já** mostra peso para bodyweight (`sheets.jsx:543-546`). Ruído aceito e agora explicado (§10.3), em vez de criar uma segunda regra. |

## Achados da revisão 2 (consolidação)

23 achados sobre a v2, com a instrução explícita de tentar **derrubar** as 11 recusas da rodada 1. Resultado: as 11 se sustentaram (as que importavam foram conferidas no código pelo próprio revisor: `setLabel` compara com `normUnit(S.unit)` e não com o `cfg`; `api/coach.js` não tem `kw` nem `startsWith('kg')`; `0584` existe em `exercise_catalog.json`; `useUI` está importado no `UnitChip`), e **três achados "bloqueantes" novos eram falsos por lerem dado velho** (abaixo).

**Aceitos e aplicados:**

| Achado | O que mudou |
|---|---|
| **F01 + F09** — o rename de `TopWeight` estava incompleto: a linha **884** (`!unitDone && unit.length > 1 ? … 'Then finish the superset partner.'`) não aparecia no ANTES/DEPOIS | §10.6 agora cobre as **cinco** ocorrências na mesma edição, com a explicação de que `'lb'.length > 1` é `true` — o teste de superset viraria sempre-verdadeiro, e `unitDone` sem rename derrubaria o sheet com `ReferenceError` |
| **F05** — a migração marcava a flag sem gravar o estado; se o boot não disparasse `persist` (o caso comum de `pullState`, `useStore.js:201-217`), o `localStorage` ficava sem `unit`, a flag ficava marcada e a migração **nunca mais rodava** | §6.3 grava o estado migrado **antes** de marcar a flag, com o porquê escrito no código |
| **F06** — `FinishSummary` (`sheets.jsx:922`) rotula o PR de e1RM com `st.unit`, contradizendo §11.1b | novo §16.3 |
| **F07** — `ExerciseDetail` (`sheets.jsx:297`) rotula "Best:" com `st.unit` **na mesma linha** que §10.9 corrigia, e o bloco `OneRM` (266-276) tem o mesmo defeito em 4 pontos | novo §16.4, com um helper único para os quatro lugares |
| **F13** — o bloco do `UnitChip` usava `normUnit` sem o import | §7 ganhou `import { normUnit } from '../lib/units.js'`; a citação de `Workout.jsx:70` (que é uma chamada de `openSheet`, não um import) foi corrigida para `:4` |
| **F12** — `wUnit` como nome local da unidade da **entrada** colide conceitualmente com `wUnit`, o campo **por série** do modelo | §8.2/8.3/8.5 passam a usar `exUnit` |
| **F14** — o ANTES de `cleanEx` citava uma linha que não existe (a função monta `const o = { id: e.id, sets: e.sets }` e ramifica por modo) | §12.4 reescrito contra o código real: `unit` viaja nas duas branches que gravam peso, nunca em cardio |
| **F16** — `flags.unit` era gravado mesmo quando o seletor está escondido (ligar "Bodyweight" zera o peso), deixando `unit` invisível e inapagável na interface | §10.4 usa a mesma condição do seletor |
| **F17** — o `onChange` do `UnitChip` escrevia em `e.target` sem checar se existe (sessão restaurada pode ter `target: null`), e o toast saía "Unit saved for  — lb" em treino avulso | §8.4 guarda `e.target` e ramifica a mensagem; chave nova em §13 |
| **F10** — `workoutVolume(w)` com um argumento num perfil `lb` normaliza para kg em silêncio (~2,2× maior) | §5.3 declara `S` obrigatório na prática e lista os dois chamadores de produção |
| **F11** — o Escopo dizia "`wUnit` … leitura + validação" e A-13 dizia que **não** há validação | Escopo alinhado com A-13 |
| **F15** — `nextPrescription` passa a calcular o passo pela unidade do exercício, mas aplica sobre `last.weight`, que vem de `readSession` (peso **cru**) | Registrado em R-5: §10.5b pressupõe histórico já na unidade do exercício, e hoje é inerte porque as 5 rotinas estão `prog: "off"` |
| **F08, F18, F19, F20, F21, F22** | Notas de limite da migração reescritas com os três caminhos (§6.5); divergência eixo × rótulo do `Stats` declarada (§11.1); coerência de `w.vol` entre treinos explicada (§16.2); nota contraditória da ordem da linha 858 corrigida (§10.6); frase sobre `_unit` e a dependência de `cwd` do teste corrigidas (§15.1); `'Default'` compartilhada declarada intencional (§13) |

**Recusados, com prova — os três eram "bloqueantes" e vinham de dado velho:**

| Achado | Por que não |
|---|---|
| **F02** — "as 5 rotinas têm `prog: "linear"`, então §10.5b não é inerte" | **Falso.** Medido no arquivo de produção em 11/09/2026 (`sha256 6bfa0e10…`): `prog=off` nas 5 rotinas. O revisor leu `hermes-snapshot/opengym-data/state-…json`, de **05/09**, que tem `prog=linear` e ids de rotina antigos. Virou o risco **R-9**. |
| **F03** — "não existe sessão em 02/09 nem 06/09 e nenhum `200` no histórico; o Contexto é fabricado" | **Falso.** As duas sessões existem (`2026-09-02 Legs 1` e `2026-09-06 Legs2`) e `200` está na lista de pesos distintos do arquivo de produção. O snapshot de 05/09 termina em **25/08** e não tem nem as sessões nem o `200`. |
| **F04** — "o template real é `weight: 108` / `90`, não `200`; a migração derrubaria a prescrição para 49 kg" | **Falso no dado de hoje.** Template de produção: `0585 weight=200`, `0599 weight=200`, `reps=6-8`, `sets=3` nas quatro entradas — os `108/90` são do snapshot de 05/09. A consequência descrita (108 → 108 lb = 49 kg) seria real **se** o template fosse 108; com 200 ela não existe. Fica como aviso: **se** um dia o template for medido em 108, a migração precisa ser revista antes. |
| **F23** — "o exemplo `200→210` do contrato 14.5 descreve dado que não existe" | **Falso**: `200` **é** o valor real do template de `0585` em produção. O exemplo é reproduzível como está. |

## Implementado em 11/09/2026

Entregue no mesmo dia, com as duas suítes verdes e publicado nos containers. Onde o código
divergiu da spec, a divergência está aqui — e as três primeiras foram encontradas **executando**,
não relendo.

### Divergências (o que saiu diferente do que esta spec escreveu)

1. **`api/Dockerfile` precisava listar `units.js` — a spec não previu, e sem isso a API não subia.**
   O Dockerfile da API copia arquivo por arquivo (`COPY server.js coach.js routines.js
   exercise_catalog.json ./`), então um módulo novo simplesmente não entra na imagem e
   `coach.js`/`routines.js` morrem no `import` em produção. Corrigido para
   `COPY server.js coach.js routines.js units.js exercise_catalog.json ./`. **Lição para a
   próxima:** arquivo novo no `api/` exige mexer no Dockerfile — o build local não pega isso,
   só o container.
2. **A migração saiu do `useStore.js` para `frontend/src/lib/unit-migration.js`.** Ela é o único
   pedaço desta mudança que reescreve o estado do usuário em silêncio, e o store importa
   `document` — não roda em teste sem jsdom (que o projeto não tem). Como função pura com
   `storage` injetado, ela ganhou **11 testes de comportamento** (`unit-migration.test.js`), nos
   quais os três riscos que a revisão apontou ficam presos por asserção, não por prosa:
   flag sem gravar, flag sem rotinas, e tocar em `workouts[]`. O `loadState` só chama
   `pinUnits(state, localStorage, KEY)` — e há uma asserção de texto prendendo esse fio.
3. **`FROZEN` ficou condicional em vez de removido (RF-14.5 revisitado).** Em vez de "deixa de
   bloquear", a trava passa a valer **apenas enquanto a entrada não declara `unit`**:
   `congelado = eid in FROZEN and merged.get("unit") is None`. Depois da migração o efeito é
   exatamente o que o RF-14.5 pede (a carga pode progredir), e antes dela o comportamento é
   idêntico ao de hoje — o que é estritamente mais seguro do que apagar a proteção, já que o
   motivo dela (unidade implícita) é que desaparece, não o risco de uma alta sem justificativa.
4. **A nota do `SKILL.md` não era uma correção, era uma adição.** A frase "0585 e 0599 ficam em
   200 lbs" **não está** no `treino-coach/SKILL.md` vivo (conferido por grep): ela vive em
   `docs/specs/spec_micro_via_app_v5.md:577`, que é o prompt do planejador do **BACKLOG-02** —
   ainda não implementado. O que entrou no SKILL foi uma nota nova no passo 6 explicando que a
   unidade agora é um campo (`unit`), que o peso continua sendo o número cru da máquina e que a
   trava de congelado cai quando a unidade é declarada.

### Verificação

| O quê | Resultado |
|---|---|
| `node --test api/routines.test.js api/coach.test.js` | **75 testes, 0 falhas** (61 + 14 novos) |
| `npx vitest run` (frontend) | **237 testes, 0 falhas** (219 + 18 novos), 9 arquivos |
| `python3 -m unittest test_escritor_rotinas` (Pi) | **30 testes, OK** (28 + 2 novos) |
| `npx vite build` | ok, sem erro novo (os avisos de chunk/dynamic-import são pré-existentes) |
| `docker compose build api web` + `up -d` | publicado; `index-DmkE0Msr.js` no ar, web 8081 → 200 |
| `/app/units.js` dentro do container da API | presente, 7 exports |
| `opengym_writer.py doctor` | mostra a unidade na coluna do peso e o estado do congelado |

### O que **não** foi feito, de propósito

- **A marcação de `0585`/`0599` não foi escrita no servidor pelo agente.** O portão P1 do
  `verificar_prescricao.py` reprova a intenção por um motivo **pré-existente e alheio a esta
  mudança**: `0738` está prescrito em **180** nas três rotinas que o usam, e o último executado
  é **160** — +12,5%, acima do limite de 10% sem justificativa, em rotina que a intenção nem
  citava. Rotear por cima disso (declarar `0738` com `justify` só para destravar) enfraqueceria
  uma proteção que o usuário pediu. **A marcação acontece pela migração do app**, no primeiro
  boot depois desta publicação, sem portão e sem escrita do agente — que é o desenho de A-6.
  Fica registrado como pendência de manutenção: **`0738` 180×160** é uma inconsistência real
  entre template e executado que vale resolver (baixar o template para ≤176 ou justificar).
- Nada foi commitado no `app` antes de os testes passarem; o commit é o passo seguinte.
