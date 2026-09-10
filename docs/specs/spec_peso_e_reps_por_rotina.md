# Spec: peso e reps por rotina — v3 (final)

> Implementa a **BACKLOG-06**. Origem: conversa de 10/09/2026 — o usuário descreveu o funcionamento
> desejado ("cada rotina deve ter a capacidade de ter seus exercícios com seus respectivos pesos") e
> as decisões de produto foram tomadas ali (D1–D7).
>
> **Duas revisões por subagente revisor**, contra o código real no hermes:
> - **v1 → v2:** 15 achados (2 bloqueantes). Mapeamento achado → mudança no fim deste documento.
> - **v2 → v3:** 18 achados. Os que mudaram desenho de código: **helper único para ler reps**
>   (o regex estava duplicado), **clamp de reps negativas**, **texto do sheet que prometia "recorde"**
>   (o Best também considera `topW`, então a frase não podia afirmar isso), **RF-2 alinhado ao
>   "último treino do mesmo modo"** e **RF-9/RF-10 reconciliados** com a precedência do motor.
>
> A revisão 1 desconfiou de 5 testes quebrados; a apuração no arquivo real mostrou que são **2**.

## Contexto e Objetivo

**Onde vive:** repo `openGym`, branch `emerson-custom` (fork `emersondsc/openGym`), no hermes
(`/mnt/drivebackup/apps/openGym/openGym`). Stack: React + Vite (`frontend/`), Node sem framework
(`api/server.js`), PWA de uso pessoal. Deploy: `npm run build` + `docker compose` no Pi.

**O problema:** cada rotina já guarda o **seu** peso por exercício (`routines[].ex[].weight`), mas
quem decide o número que aparece no treino é outra coisa: o **caderno de pesos** (`S.exWeights`,
uma entrada **por exercício**, sem noção de rotina, gravado só subindo com `Math.max`). Em
`buildSets` a ordem consultada é *caderno → último treino de qualquer rotina → peso da rotina* —
ou seja, o peso que a rotina prescreve é o **último** da fila e quase sempre perde. Resultado
medido no perfil `ZPJbmYUfHlfbAYzi`: `0762 smith rear delt` está 20 no Pull C e 40 no Upper C, e o
app mostra **25 nas duas**; `0598 lever seated hip adduction` está 80 no Legs 1 e 75 no Legs 2 e o
app mostra **100 nas duas**.

**O que muda:** a rotina passa a ser a **prescrição**. O que está escrito nela é o que aparece no
treino, para **peso e reps**. O caderno deixa de mandar e passa a ser apenas a sugestão de quem não
tem prescrição nenhuma (peso 0 / sem reps na rotina). E rotina **nova, importada ou escrita direto
por agente externo (o Hermes)** deixa de sofrer ajuste automático de peso do motor de progressão.

## Escopo

**Inclui:**
- Precedência de peso e reps em `buildSets` (modo `reps`) e de carga no modo `time`.
- Helper `repFloor` em `history.js`, usado pelos **dois** lugares que leem reps de um plano
  (o regex estava duplicado) — ver A6/A12.
- Política de progressão padrão passa a ser **"sem progressão automática"** (rotina precisa optar).
- Rótulo padrão da linha "Progression" no editor de rotina.
- Leitura do piso da faixa de reps em `readSession` (elimina o deload indevido) — ver A6.
- Correção de duas frases que passaram a ser falsas no sheet de confirmação de peso.
- 2 asserções de teste trocadas + 10 casos novos (1 deles no `readSession`).

**Não inclui:**
- Servidor: `checkState` (`api/server.js:56-72`) não valida `weight`/`reps`; `PUT /api/data` segue igual.
- Migração de dados: o formato por rotina já existe desde sempre; `exWeights` mantém o formato plano.
- O caderno por rotina (opção B da BACKLOG-05) — **descartado** por decisão do usuário.
- O lado Hermes (skill `treino-coach`, spec do micro/meso): o Hermes continua escrevendo rotinas como
  escreve; só passa a não ser sobrescrito. **Não** mexer na proibição de alvos divergentes da
  `spec_micro_via_app_v5.md` nesta entrega.
- Normalizar a faixa de reps dentro de `nextPrescription` (política `double`) — ver "Fora de escopo".

## Decisões do usuário (produto)

| # | Decisão | Efeito visível |
|---|---|---|
| D1 | O template da rotina vence para **peso e reps** | Cada treino abre com o peso/reps daquela rotina; 45 no Upper, 40 no Push, 30 no Pull convivem |
| D2 | Aceita perder a sugestão automática do caderno em template velho | Se você levantou mais do que a rotina prescreve, a próxima sessão volta ao valor prescrito (para mudar, edite a rotina) |
| D3 | O rótulo "Last time" continua sendo do **exercício**, não da rotina | O rótulo pode mostrar um peso de outra rotina — é o histórico do exercício, e isso é intencional |
| D4 | Exercício com peso 0 na rotina continua caindo no caderno | Rotina que nunca prescreveu peso mostra o maior peso já levantado naquele exercício (ver nota em RF-2) |
| D5 | Treino **avulso** (sem rotina) também fica sem aumento automático de peso | Nada sobe sozinho em nenhum tipo de treino |
| D6 | O "Best: N kg" da tela do exercício continua sendo o recorde **de qualquer rotina** | Pode aparecer "Best: 100 kg" com a rotina prescrevendo 80 — é recorde, não prescrição |
| D7 | Faixa de reps `6-8` vale **6** | O app pré-preenche o piso da faixa; você sobe para 8 quando fizer 8 |

## Decisões assumidas

Decididas por mim por serem detalhe de implementação, registradas para não virarem dúvida na hora de
escrever o código. Nenhuma muda o que o usuário vê, exceto onde indicado.

- **A1 — `Number()` no peso do template.** `Number(cfg.weight)` na comparação e no valor usado, para
  um estado antigo com `"45"` (string) não chegar como string na série. A duração (`cfg.sec`) fica
  intocada (ver A2). Efeito visível: nenhum.
- **A2 — No modo cronometrado (`time`), só a carga segue o template.** A duração continua como está:
  não é peso (não faz parte do item pedido) e "carregar a duração da última vez" é o que a progressão
  por tempo ("Add time") usa. Interação documentada: numa rotina com política `'time'` ligada, o motor
  reescreve `sec` depois (`applyPrescription`) — é por isso que a duração **não** foi congelada no
  template. Efeito visível: só aparece se a rotina tiver exercício cronometrado — hoje **não tem**
  nenhum nas 5 rotinas.
- **A3 — A precedência mora dentro de `buildSets`**, sem helper novo de precedência e sem mudar
  assinatura: os dois chamadores (`sheets.jsx:836`, `Workout.jsx:375`) continuam iguais.
- **A4 — Sem migração em `loadState()`.** Nada muda de forma; nenhum campo é convertido.
- **A5 — O fallback final de `policyFor` continua `'off'`** para cardio e tempo (já era); só o ramo
  `reps` deixa de herdar `'linear'`. Comportamento por modo inalterado. Verificado: os únicos leitores
  de `prog` no app são `policyFor` e o rótulo do editor (`RoutineEdit.jsx:93`); o editor de exercício
  grava `prog` só quando escolhido (`sheets.jsx:503`). Nenhum outro ponto trata ausência como `linear`.
- **A6 — Um único helper lê reps de um plano:** `repFloor(reps)` em `history.js`, exportado e usado por
  `buildSets` **e** por `readSession` (que passa a importá-lo de `./history.js`, junto de `modeOf` e
  `repStep`). Sem isso, o mesmo regex de faixa existiria em dois arquivos, com risco de divergirem.
- **A7 — A faixa de reps é lida pelo piso (`6-8` → 6) nos dois lugares.** O usuário já autorizou essa
  leitura ("entender faixa 6-8 pode ser 6"), e verifiquei que **as 5 rotinas no app têm
  `"reps": "6-8"` (string)** no template — o `8` que o Hermes usa é o número **executado** nos sets.
  Sem ler o piso, ligar progressão numa rotina com faixa faria o motor julgar toda sessão como falha e
  aplicar **deload de 10% na carga prescrita** (1 sessão no Greyskull, 3 no Linear; em exercício sem
  carga, o alvo simplesmente nunca avançaria).
- **A8 — Reps não numéricas viram `0`**, nunca texto: `repFloor` é o único lugar que decide isso, e
  devolve sempre um número finito ≥ 0 (`'AMRAP'` → 0, `-5` → 0, ausente → 0, `8` → 8, `6-8` → 6).
  Alvo 0 significa "a preencher", e evita `NaN` em volume e e1RM.
- **A9 — No modo `time`, carga planejada ≤ 0 ou ausente resolve para 0** quando não há histórico
  (peso negativo — estado inválido — é achatado a 0 em vez de virar carga negativa).
- **A10 — `RoutineEdit` não grava `prog:'off'` no JSON** ao abrir a rotina: a intenção fica implícita
  no default, e o default é o mesmo no app e na importação de plano (consistente nas duas pontas).
  Nenhum efeito visível.
- **A11 — Duas frases do sheet de confirmação de peso foram corrigidas** (`sheets.jsx:880` e `:884`).
  A frase antiga ("your highest becomes the default next time") virou mentira sob D2 — o default da
  próxima sessão é a prescrição, não o recorde. A nova **não** promete "recorde": `bestWeightFor`
  também considera `topW` de qualquer treino, então o caderno não é a única fonte do Best (D6). O sheet
  só abre com a opção "Confirm top weight" ligada — **hoje está desligada neste perfil** — então é
  higiene. Sem i18n novo: o perfil está em `en` e essas frases não têm entrada PT em `i18n.js`.
- **A12 — Exercício adicionado no meio do treino não herda a prescrição da rotina** (RF-9): ele não faz
  parte da rotina, então vale o que você digita no formulário e, em branco, o caderno. Se a rotina
  tiver política de progressão **ligada**, o motor continua opinando (é o RF-7) — a prescrição da
  rotina é que não se aplica.
- **A13 — O "último treino" para peso é o último do mesmo modo.** `usable` exige `reps > 0`, e isso é
  deliberado (guarda contra contaminação entre modos — protegido pelo teste existente "does not seed
  reps from a timed set when an exercise switches back"). RF-2 descreve exatamente esse degrau.
- **A14 — Testes:** 1 asserção trocada em `history.test.js`, 1 em `progression.test.js` (mais o texto
  do `it`), e 10 casos novos.

## Requisitos Funcionais

- **RF-1.** Em treino **de rotina**, o peso mostrado em cada série é o peso prescrito **naquela
  rotina**, sempre que esse peso for um número maior que 0.
- **RF-2.** Quando a rotina **não** prescreve peso (0 ou ausente), a ordem é: caderno (maior peso já
  registrado naquele exercício) → último treino **do mesmo modo** (uma série com reps registradas) →
  `0`. Nota: o caderno é **global e só sobe**, então uma rotina sem peso prescrito pode abrir no maior
  peso já levantado em qualquer rotina — é o que D4 pede.
- **RF-3.** As reps mostradas vêm da rotina quando ela prescreve reps; faixa `6-8` vale `6`. Sem reps
  numéricas na rotina, cai nas reps do último treino; sem histórico, o alvo é `0` (a preencher).
- **RF-4.** Registrar um peso diferente do prescrito **não** altera a rotina e **não** muda o peso da
  próxima sessão daquela rotina. O caderno continua sendo gravado em silêncio (alimenta o "Best" de
  D6 e o fallback de RF-2).
- **RF-5.** Em exercício cronometrado: a **carga** segue o RF-1; a **duração** segue o comportamento
  atual (último treino, senão a rotina) — e pode ser reescrita pelo motor quando a política `'time'`
  estiver ligada.
- **RF-6.** Treino avulso (sem rotina) e rotina nova/importada/escrita por agente externo **não**
  recebem aumento automático de peso: nada aparece como "Every rep last time — 2.5 kg more" nem
  deload sobre carga prescrita.
- **RF-7.** Exercício (ou rotina) com política de progressão **escolhida explicitamente** continua
  progredindo como hoje — e, quando ligada, é ela que decide o número final da tela (o motor roda
  depois do `buildSets`). Precedência completa: **template (dentro do `buildSets`) → motor, se houver
  política ligada, com prioridade sobre a prescrição**.
- **RF-8.** Trocar a rotina do dia (agenda da semana ou plano do dia) troca o peso mostrado para o da
  rotina nova, na hora de começar o treino.
- **RF-9.** Exercício adicionado **durante** o treino usa o que você digita no formulário; sem peso
  digitado (0), cai no caderno. A prescrição da rotina não se aplica a ele (mas RF-7 continua valendo:
  se a rotina tiver política ligada, o motor pode ajustar o número).
- **RF-10.** Rotina com template em faixa (`6-8`) e política **julgada por sessão** (`linear`,
  `greyskull`, `time`) é julgada pelo **piso** da faixa: bater 6 reps conta como alvo cumprido, e o
  motor não aplica deload sobre a carga prescrita por uma falha que não existiu. A política `double`
  continua fora (ver "Fora de escopo").

## Detalhe de Implementação (nível código)

### 1. `frontend/src/lib/history.js` — helper `repFloor` (novo)

Inserir logo **depois de `repStep`** (linha 41), na seção de helpers de reps:

```js
// How many reps a plan entry targets, as a number. A plan may state a range ('6-8', the format the
// coach writes) and the app works from its bottom: that is the number a set is seeded with and the
// number a session is judged against, so both readings must agree. Anything that is not a positive
// number of reps reads as 0 — a target the session has to fill in — and never as text, which would
// put NaN into volume and e1RM. Used by buildSets and by readSession (progression.js).
export function repFloor(reps) {
  const m = /^\d+/.exec(String(reps ?? ''))
  return m ? parseInt(m[0], 10) : 0
}
```

### 2. `frontend/src/lib/history.js` — `buildSets` (função em 172-209)

Âncoras por conteúdo (a numeração muda depois da edição): ramo `time` = o `if (mode === 'time')`;
os ramos `cardio` e `time` ficam **intactos** no lugar, só o corpo do `time` muda; ramo `reps` = de
`const conf = S.exWeights[cfg.id]` até o `return sets` da função.

**2.1 Ramo `time` — a carga passa a vir do template.**

```js
// ANTES (187-196)
  if (mode === 'time') {
    for (let i = 0; i < n; i++) {
      // Only carry a previous value over when it came from a timed set — switching an
      // exercise from reps to time must not seed the duration from a rep count.
      const prev = prevAt(i)
      const carried = prev && prev.sec > 0 ? prev : null
      sets.push({ sec: carried ? carried.sec : (cfg.sec || 45), w: carried ? (carried.w || 0) : (cfg.weight || 0), done: false })
    }
    return sets
  }

// DEPOIS
  if (mode === 'time') {
    // The planned load is a prescription like any other (RF-1): the routine wins, and last
    // time's load is only a suggestion for a routine that prescribes none. The *duration* is
    // deliberately left alone — it is not a load, and carrying it is what "Add time" lives on
    // (when a time policy is on, applyPrescription rewrites `sec` from the plan afterwards).
    const tplW = Number(cfg.weight) > 0 ? Number(cfg.weight) : null
    for (let i = 0; i < n; i++) {
      // Only carry a previous value over when it came from a timed set — switching an
      // exercise from reps to time must not seed the duration from a rep count.
      const prev = prevAt(i)
      const carried = prev && prev.sec > 0 ? prev : null
      sets.push({
        sec: carried ? carried.sec : (cfg.sec || 45),
        w: tplW != null ? tplW : (carried ? (carried.w || 0) : 0),
        done: false
      })
    }
    return sets
  }
```

**2.2 Ramo `reps` — peso e reps passam a vir do template.**

```js
// ANTES (197-208)
  const conf = S.exWeights[cfg.id]
  // Template reps may be a range string ('6-8'): seed a leading number so a set
  // completed untouched never logs a non-numeric r (NaN volume, null e1RM).
  const m = /^\d+/.exec(String(cfg.reps ?? ''))
  const defR = m ? parseInt(m[0], 10) : cfg.reps
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i)
    const usable = prev && prev.r > 0 ? prev : null
    const w = conf && conf.w > 0 ? conf.w : (usable ? usable.w : cfg.weight)
    sets.push({ w, r: usable ? usable.r : defR, done: false })
  }
  return sets

// DEPOIS
  const conf = S.exWeights[cfg.id]
  // The routine is the prescription (RF-1/RF-3): what it states wins for both the load and the
  // reps, and the notebook / last session are only suggestions for what it leaves blank. This is
  // the opposite of the order this function used until 2026-09-10, where the notebook (one
  // monotonically rising entry per exercise, shared by every routine) was consulted first and
  // flattened every routine onto the heaviest weight ever lifted.
  const tplW = Number(cfg.weight) > 0 ? Number(cfg.weight) : null
  const defR = repFloor(cfg.reps)
  const tplR = defR > 0 ? defR : null
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i)
    // `usable` needs reps > 0 on purpose: a timed set from last time must not seed reps work
    // with its load (see history.test.js, "does not seed reps from a timed set…").
    const usable = prev && prev.r > 0 ? prev : null
    const w = tplW != null ? tplW : (conf && conf.w > 0 ? conf.w : (usable ? usable.w : cfg.weight))
    const r = tplR != null ? tplR : (usable ? usable.r : defR)
    sets.push({ w, r, done: false })
  }
  return sets
```

> `defR` deixou de poder ser texto (`repFloor` devolve sempre número ≥ 0), então o `r` de uma série
> nunca é `NaN` nem string — o que também simplifica o valor terminal de fallback.

### 3. `frontend/src/lib/progression.js` — `policyFor` (67-74)

```js
// ANTES
// The policy in force for one exercise: its own override, else the routine's default, else
// the mode's default. Reps keeps behaving the way the app always did (all reps → add a step).
export function policyFor(cfg, routine, mode) {
  const m = mode || modeOf(cfg || {})
  const allowed = POLICIES_FOR[m] || ['off']
  const pick = (cfg && cfg.prog) || (routine && routine.prog) || (m === 'reps' ? 'linear' : 'off')
  return allowed.includes(pick) ? pick : 'off'
}

// DEPOIS
// The policy in force for one exercise: its own override, else the routine's default, else
// nothing — an exercise with no rule keeps the weight its plan states (RF-6). Until
// 2026-09-10 reps inherited 'linear' instead, so a routine that had just been created,
// imported or written by the coach was silently re-prescribed from history (last weight + a
// step, or a deload) and the planned weight never reached the screen. Opting in is now
// explicit: cfg.prog on the exercise, or `prog` on the routine.
export function policyFor(cfg, routine, mode) {
  const m = mode || modeOf(cfg || {})
  const allowed = POLICIES_FOR[m] || ['off']
  const pick = (cfg && cfg.prog) || (routine && routine.prog) || 'off'
  return allowed.includes(pick) ? pick : 'off'
}
```

> Consequência verificada nos dados reais: as 5 rotinas do usuário **já** têm `prog: "off"` explícito,
> então nada muda para elas; a mudança protege a rotina que o treinador vai entregar na semana seguinte.

### 4. `frontend/src/lib/progression.js` — import (linha 19) e `readSession` (linha 118)

```js
// ANTES (19)
import { modeOf, repStep } from './history.js'

// DEPOIS (19)
import { modeOf, repStep, repFloor } from './history.js'
```

```js
// ANTES (118)
  const goal = target.reps || 0

// DEPOIS
  // A plan may keep its reps as a range ('6-8'). Judging the session against the raw string
  // scored every session as a miss ("6-8" > 0 is false in JS), so a plan in a range was deloaded
  // after DELOAD_AFTER sessions (1 on Greyskull, 3 on Linear) despite being followed to the
  // letter. repFloor reads the bottom of the range — the same number buildSets seeds and shows.
  const goal = repFloor(target.reps)
```

### 5. `frontend/src/views/RoutineEdit.jsx` — linha 93

```jsx
// ANTES
      <SelectRow ... value={r.prog || 'linear'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })} ... />

// DEPOIS
      <SelectRow ... value={r.prog || 'off'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })} ... />
```

### 6. `frontend/src/sheets.jsx` — duas frases do sheet de peso (A11)

```jsx
// ANTES (884)
    <div className="muted small">{t('Confirm the weight you worked with — your highest becomes the default next time.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>

// DEPOIS
    <div className="muted small">{t('Confirm the weight you worked with — it is saved for this exercise and used when a routine prescribes no load.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>

// ANTES (880)
    } else toast(t('Tracked — next time starts at {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))

// DEPOIS
    } else toast(t('Tracked for this exercise: {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))
```

### 7. `frontend/src/lib/history.test.js` — 1 asserção trocada + 10 casos novos

**7.1 Trocar o caso "still prefers the confirmed working weight for reps sets" (373-376):**

```js
// ANTES
  it('still prefers the confirmed working weight for reps sets', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 50 })).toEqual([{ w: 75, r: 10, done: false }])
  })

// DEPOIS
  it('lets the plan win over the notebook and last time', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 50 })).toEqual([{ w: 50, r: 8, done: false }])
  })
```

**7.2 Casos novos (mesmo `describe('buildSets')`):**

```js
  it('keeps two routines on their own planned weight for the same exercise', () => {
    const cfg = (weight) => ({ id: LIFT, sets: 1, reps: 8, weight })
    expect(buildSets(emptyS, cfg(40))).toEqual([{ w: 40, r: 8, done: false }])
    expect(buildSets(emptyS, cfg(30))).toEqual([{ w: 30, r: 8, done: false }])
  })

  it('falls back to the notebook when the plan prescribes no weight', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 0 })).toEqual([{ w: 75, r: 8, done: false }])
  })

  it('falls back to last time when neither the plan nor the notebook has a weight', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 0 })).toEqual([{ w: 60, r: 8, done: false }])
  })

  it('leaves the weight at zero when nothing at all is known', () => {
    expect(buildSets(emptyS, { id: LIFT, sets: 1, reps: 8, weight: 0 }))
      .toEqual([{ w: 0, r: 8, done: false }])
  })

  it('takes the bottom of a rep range from the plan', () => {
    expect(buildSets(emptyS, { id: LIFT, sets: 2, reps: '6-8', weight: 45 }))
      .toEqual([{ w: 45, r: 6, done: false }, { w: 45, r: 6, done: false }])
  })

  it('never puts a non-numeric rep target into a set', () => {
    // Defensive: a state like this only comes from a hand-written or externally written plan
    // file, never from the app's own config sheet (which always stores a number).
    expect(buildSets(emptyS, { id: LIFT, sets: 1, reps: 'AMRAP', weight: 0 }))
      .toEqual([{ w: 0, r: 0, done: false }])
  })

  it('still takes last time reps when the plan target is not a number', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 12, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 'AMRAP', weight: 0 })).toEqual([{ w: 60, r: 12, done: false }])
  })

  it('keeps last time reps when the plan states none', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 12, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, weight: 0 })).toEqual([{ w: 60, r: 12, done: false }])
  })

  it('lets a timed set take its load from the plan but its duration from last time', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 15, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 20 }))
      .toEqual([{ sec: 70, w: 20, done: false }])
  })

  it('keeps last time load for a timed set whose plan states no load', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 15, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 1, sec: 45 }))
      .toEqual([{ sec: 70, w: 15, done: false }])
  })
```

**7.3 Três asserções para o helper novo** — adicionar `repFloor` à lista de imports do topo do arquivo
e um `describe` curto:

```js
describe('repFloor', () => {
  it('reads the bottom of a range, a plain number and anything unusable', () => {
    expect(repFloor('6-8')).toBe(6)
    expect(repFloor(8)).toBe(8)
    expect(repFloor('AMRAP')).toBe(0)
    expect(repFloor(undefined)).toBe(0)
    expect(repFloor(-5)).toBe(0)
  })
})
```

### 8. `frontend/src/lib/progression.test.js` — o `it` (73-76) + 1 caso em `readSession`

O título real do caso é `'keeps the app\'s long-standing behaviour as the default for reps work'` e
ele passa a ser falso: **trocar o título** e a expectativa.

```js
// ANTES (74-75)
  it('keeps the app\'s long-standing behaviour as the default for reps work', () => {
    expect(policyFor({ id: LIFT }, null, 'reps')).toBe('linear')

// DEPOIS
  it('defaults to no progression, so a plan keeps the weight it states', () => {
    expect(policyFor({ id: LIFT }, null, 'reps')).toBe('off')
```

```js
// NOVO — dentro de describe('readSession') (a partir da linha 26)
  it('judges a rep-range plan against the bottom of the range', () => {
    const RANGE = { sets: 2, reps: '6-8' }
    expect(readSession({ id: LIFT, target: RANGE, sets: [{ w: 45, r: 6, done: true }, { w: 45, r: 6, done: true }] }).ok).toBe(true)
    expect(readSession({ id: LIFT, target: RANGE, sets: [{ w: 45, r: 6, done: true }, { w: 45, r: 5, done: true }] }).ok).toBe(false)
  })
```

> As duas asserções juntas provam o piso: com o código antigo (`goal = '6-8'`) a primeira falharia
> (`'6-8' > 0` é falso em JS), e a segunda isola o "uma série abaixo do piso conta como falha".

## Comportamento Visual/UX

Nenhuma tela nova, nenhum botão novo. O que muda é **o número que aparece**.

**Antes** (caderno manda) — `0584 lever lateral raise` em qualquer rotina:

```
┌─ Upper C - Shoulder 3D ─────────────────────── 3/8 ─┐
│ ▓▓▓  lever lateral raise          3 × 6-8           │
│      ─────────────────────────────────────────      │
│  1   [ 45 ] kg    [ 6 ] reps    ○                   │
│  2   [ 45 ] kg    [ 6 ] reps    ○                   │
│  3   [ 45 ] kg    [ 6 ] reps    ○                   │
└─────────────────────────────────────────────────────┘
┌─ Pull C - Shoulder 3D ──────────────────────── 4/7 ─┐
│ ▓▓▓  lever lateral raise          3 × 6-8           │
│  1   [ 45 ] kg    [ 6 ] reps    ○   ← as três       │
│  2   [ 45 ] kg    [ 6 ] reps    ○     iguais        │
│  3   [ 45 ] kg    [ 6 ] reps    ○     (caderno)     │
└─────────────────────────────────────────────────────┘
```

**Depois** (rotina manda) — mesma pessoa, mesma semana:

```
┌─ Upper C - Shoulder 3D ─────────────────────── 3/8 ─┐
│ ▓▓▓  lever lateral raise          3 × 6-8           │
│  1   [ 45 ] kg    [ 6 ] reps    ○   ← o que a       │
│  2   [ 45 ] kg    [ 6 ] reps    ○     rotina diz    │
│  3   [ 45 ] kg    [ 6 ] reps    ○                   │
└─────────────────────────────────────────────────────┘
┌─ Push C - Shoulder 3D ──────────────────────── 2/7 ─┐
│ ▓▓▓  lever lateral raise          3 × 6-8           │
│  1   [ 40 ] kg    [ 6 ] reps    ○   ← prescrição    │
│  ...                                    da própria  │
└─────────────────────────────────────────────────────┘
┌─ Pull C - Shoulder 3D ──────────────────────── 4/7 ─┐
│ ▓▓▓  lever lateral raise          3 × 6-8           │
│  1   [ 30 ] kg    [ 6 ] reps    ○   ← rotina        │
│  ...                                                  │
└─────────────────────────────────────────────────────┘
```

**Linha de progressão** (abaixo do nome do exercício, só quando existe política decidindo algo):

```
ANTES   ⓘ Every rep last time — 2.5 kg more.        ← aparecia em rotina nova/importada
DEPOIS  (nada)                                       ← a rotina não pediu progressão
```

**Editor de rotina** (inalterado no visual, mas agora coerente):

```
┌─ Progression ───────────────────────────────────────┐
│  No automatic progression                        ›  │   ← é o que está valendo
│  Targets stay where you set them.                    │
└─────────────────────────────────────────────────────┘
```

**Rótulo "Last time"** (D3 — fica como está, é do exercício):

```
│  Last time (03/09): 25×8  ·  25×8                   │  ← pode vir de outra rotina, de propósito
```

**Exercício adicionado no meio do treino** (RF-9/A12): abre com o que você digitar no formulário;
sem peso digitado, com o caderno — não com a prescrição da rotina.

**Efeito nos dados reais** — 10 pontos de tela mudam, todos no sentido pedido:

| Exercício | Rotina | Antes | Depois |
|---|---|---|---|
| `0762` smith rear delt | Pull C | 25 | **20** |
| `0762` smith rear delt | Upper C | 25 | **40** |
| `0598` lever seated hip adduction | Legs 1 | 100 | **80** |
| `0598` lever seated hip adduction | Legs 2 | 100 | **75** |
| `immt53oq1ac2uhc` shoulder press máq. | Upper C | 114 | **112,5** |
| `0326` db incline rear lateral raise | Pull C | 9 | **8** |
| `0326` db incline rear lateral raise | Upper C | 9 | **8** |
| `0396` db seated lateral raise | Push C | 15 | **14** |
| `0396` db seated lateral raise | Pull C | 15 | **14** |
| `0396` db seated lateral raise | Upper C | 15 | **14** |

(`immt53oq1ac2uhc` no Push C **não** muda: o caderno lê 114 e a rotina prescreve 114.)

## Testes manuais (após `npm run build`)

1. No editor de rotina, definir `0584` = **30 no Pull C** e **40 no Push C** (hoje está **45 nas
   três**). Abrir **Upper C → mostra 45**, **Push C → 40**, **Pull C → 30**.
2. Registrar **30** nas 3 séries do Pull C e finalizar. Abrir **Upper C → mostra 45** (o 30 não
   contaminou a outra rotina).
3. Registrar **47,5** no Upper C e finalizar. Abrir **Upper C → mostra 45** (prescrição intacta), e a
   tela do exercício mostra **Best: 47,5 kg** (D6).
4. Abrir **Legs 1 → `0598` mostra 80** e **Legs 2 → mostra 75** (o caderno está em 100).
5. Numa rotina qualquer, zerar o peso prescrito de `0585` (caderno = 200): o treino mostra **200**.
6. Criar rotina nova, adicionar `0396` com peso prescrito **14** (caderno = 15): o treino mostra **14**
   e **nenhuma** linha de progressão aparece.
7. Na rotina nova, escolher **Linear progression**, adicionar `0584` com peso **45**, **reps 8**, e
   usar um exercício cujo **último treino registrou alvo 8** e bateu 8 reps em todas as séries: o
   treino mostra **47,5** (45 + 2,5) e a linha "Every rep last time — 2.5 kg more" aparece (RF-7).
8. Rotina com template `reps: "6-8"` (as do treinador) e **Linear** ligado: registrar **6 reps** (o
   piso) em todas as séries por 3 sessões → o peso **não cai** (nenhum deload) e nenhuma mensagem de
   "Missed reps … sessions running" aparece (RF-10).
9. `npm test` no `frontend`: `history.test.js` e `progression.test.js` verdes (inclui o novo
   `describe('repFloor')`).

## Rollout e reversão

- Implementar no repo do hermes, branch `emerson-custom`. Arquivos: 4 de código (`history.js`,
  `progression.js`, `RoutineEdit.jsx`, `sheets.jsx`) + 2 de teste.
- Build e deploy (caminho já documentado pelo Hermes):
  `cd frontend && npm run build` → `sudo docker compose build web && sudo docker compose up -d --force-recreate web`.
- Reversão: `git revert <commit>` — nenhum dado muda de forma, então não há migração a desfazer.
- Antes de testar no app: exportar backup (Settings → Export backup) ou `GET /api/data`.

## Fora de escopo (registrado)

- **Política `double` com template em faixa.** `nextPrescription` usa `cfg.reps` cru como topo da faixa
  (`const top = cfg.reps || last.goal || 10`) e `Math.min(bottom, "6-8")` resulta em `NaN`, que
  `applyPrescription` gravaria como reps da série. Continua fora **mesmo depois** da leitura de piso em
  `readSession` (RF-10 cobre `linear`, `greyskull` e `time`, não `double`): corrigir exige normalizar o
  template dentro de `nextPrescription`.
- **`checkState` não valida `weight`/`reps`** (`api/server.js:56-72`). Consequência agora explícita: um
  plano escrito por agente externo com `weight: "45 kg"` ou negativo cai **silenciosamente** na
  sugestão — no modo `reps`, no caderno; no modo `time`, no último treino (não há caderno para holds).
  Sem erro e sem aviso na tela.
- **API de rotinas** (BACKLOG-07) e **micro/meso via app** (BACKLOG-02) — bloqueados, não entram aqui.
- **Caderno por rotina** (opção B da BACKLOG-05) — descartado por decisão do usuário.

## Mudanças da v1 para a v2 (achados da revisão 1)

| Achado | O que mudou |
|---|---|
| F01 (bloqueante) | RF-1 explicita a precedência completa (template no `buildSets` → motor depois) e RF-7 diz que a política ligada decide o número final |
| F02 (bloqueante) | Novo **RF-9** (depois reconciliado em A12): exercício adicionado no meio do treino não herda a prescrição |
| F03 | **A1** corrigido: `Number()` só no peso; `cfg.sec` fica intocado |
| F04 | Guarda contra reps não numéricas (**A8**) |
| F05 | Novo **A11** + §6: as duas frases do sheet de peso corrigidas |
| F06 | **A7** + §4: `readSession` passa a ler o piso da faixa (era fora de escopo, virou escopo) |
| F07 | RF-2 ganhou a nota de que o caderno continua global e monotônico na rota do peso 0 |
| F08 | "Fora de escopo" agora descreve o sintoma do peso inválido de origem externa |
| F09 | Ramo `time` simplificado |
| F10 | **A10**: aceito não gravar `prog` no JSON |
| F11 | Caso de teste novo: `time` sem carga no plano mantém a carga do último treino |
| F12 | Testes manuais reescritos com número esperado em cada passo |
| F13 | Casos rotulados como estado de plano externo |
| F14 | **A2** ganhou a nota da interação `mode:'time'` + política `'time'` |
| F15 | Âncoras por conteúdo (a função `buildSets` vai de 172 a 209) |

## Mudanças da v2 para a v3 (achados da revisão 2)

| Achado | O que mudou |
|---|---|
| A1 | Caso de `readSession` reescrito: 2 séries, uma batendo o piso (ok) e uma abaixo (falha) |
| A2/A7 | **A13** + RF-2: "último treino **do mesmo modo**" documentado como deliberado (guarda contra contaminação entre modos, com o teste existente que a protege) — sem mudança de código |
| A3 | RF-9/A12 reconciliados com RF-7 (o motor continua opinando se a rotina tiver política ligada) |
| A4/A11 | `repFloor` (novo helper) centraliza a leitura e achata reps negativas a 0 |
| A5 | "Fora de escopo" separado por modo: `reps` cai no caderno, `time` no último treino |
| A6 | Rejeitada a mudança de código sugerida (usar `prev.w` sem exigir reps) — quebraria a guarda entre modos; virou **A13** |
| A8 | Frase do sheet reescrita para **não** prometer recorte de recorde (o Best também usa `topW`) |
| A9 | Verificado por grep: só `policyFor` e o rótulo do editor leem `prog` — registrado em **A5** |
| A10 | RF-10 restrito às políticas julgadas por sessão; `double` explicitamente fora |
| A12 | Passo 7 dos testes manuais ancorado em "último treino com alvo 8 registrado" |
| A13 | Âncora do ramo `time` agora diz para preservar `cardio` e `time` no lugar |
| A14 | Caso novo "leaves the weight at zero when nothing at all is known" (degrau final de RF-2) |
| A15 | **A7** detalha a contagem de deload por política (1 no Greyskull, 3 no Linear) |
| A16 | Título real do `it` verificado e a troca passou a ser obrigatória |
| A17 | `repFloor` elimina o regex duplicado; contagem de linhas corrigida |
| A18 | Tabela de efeito nos dados reais com uma linha por rotina |

## Próximo passo

`posso implementar seguindo esta spec` → 4 arquivos de código + 2 de teste, `npm test`, `npm run build`,
deploy no Pi.
