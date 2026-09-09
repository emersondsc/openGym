# Spec: Descanso por exercício por rotina (Rest por exercício) — v4 detalhada a nível de código

## Contexto e Objetivo

O openGym hoje tem descanso global (`S.globalRestSec = 90s` em `store/useStore.js:10`) e um `chip ⏱` por exercício em `Workout.jsx:62 RestChip` que altera apenas `ActiveEntry.restSec` (`S.active.entries[idx].restSec`). Ao finalizar, vai para `workouts[]` mas nunca para `S.routines[].ex[].restSec`. Na próxima vez que inicia a mesma rotina (`sheets.jsx:828 beginWorkout`), o tempo volta ao global — perde-se.

Objetivo: permitir determinar o descanso de cada exercício durante o treino e reutilizá-lo na próxima vez que fizer **aquela mesma rotina**, com edição também em `RoutineEdit.jsx`. Freestyle (sem `routineId`) mantém comportamento atual (só na sessão).

Onde vive: `/mnt/drivebackup/apps/openGym/openGym` (branch `emerson-custom`), frontend React Vite.

## Escopo

- Inclui: persistência `restSec` por-rotina (`S.routines[].ex[].restSec?: number` inteiro 30-300), edição durante treino (duplo write `active` + `routines` atômico) e em `RoutineEdit` (mesmo componente `<RestChip>`), seed em `beginWorkout` validado, fallback canônico, validação 3 camadas, toast PT com debounce, sync `PUT /api/data` last-write-wins.
- Não inclui: `S.exRest` global, sugestão automática 150s para compostos, custom além de `60/90/120/150/180`+Default, mudança em `S.globalRestSec` via Settings.

## Requisitos Funcionais

RF-1 a RF-9 idênticos à v3 — com ordem canônica `entry.restSec ?? cfgRest ?? S.globalRestSec ?? 90`, validação 30-300 inclusive, Default = `delete`, Freestyle só `active`, sync last-write-wins.

## Detalhe de Implementação (nível código)

> Esta seção destrincha **arquivo a arquivo, função a função**, com código exato para o implementador não precisar supor.

### 1. `frontend/src/store/useStore.js`

**1.1 `DEF` (linha 9-10):**
```js
// ANTES:
export const DEF = { unit:'kg', restSec:90, ... }
// DEPOIS:
export const DEF = { unit:'kg', globalRestSec:90, restSec:90, ... } // restSec mantido temporariamente como alias para compat, será migrado no loadState
```

**1.2 Helper `isValidRest(n)` (novo, após `clone`):**
```js
export const isValidRest = n => typeof n === 'number' && Number.isInteger(n) && n>=30 && n<=300
```

**1.3 `loadState()` (linha ~24):** migrar `S.restSec` → `S.globalRestSec`, limpar `routines[].ex[].restSec` inválido e `active.entries[].restSec` inválido com `delete` + `console.warn`, fallback `90` se inválido.

**1.4 Sanitização pre-PUT em `pushState()`:** clonar `S`, deletar `restSec` inválido antes de `api('/api/data')`.

### 2. `frontend/src/sheets.jsx` — `beginWorkout` (linha 828)

Copiar `cfg.restSec` validado para `entry.restSec` só se `isValidRest(cfg.restSec)`, senão `entry.restSec` fica `undefined` (força fallback `S.globalRestSec`).

### 3. `frontend/src/views/Workout.jsx` — `RestChip` (linha 61)

`effective = entry.restSec ?? cfgRest ?? S.globalRestSec ?? 90` onde `cfgRest = S.routines.find(r=>r.id===S.active?.routineId)?.ex.find(x=>x.id===entry.id)?.restSec`. `custom = entry.restSec!=null || cfgRest!=null`. Sheet com presets `60/90/120/150/180` + `Padrão da rotina (90s)` + subtítulo `Usa o tempo da rotina`, `check` em `effective===v`. `onChange` valida `isValidRest`, faz transação única `set(s=>{ s.active.entries[idx].restSec=v; if(routineId) cfg.restSec=v })`, toast com debounce 900ms.

Disparo: `const cfgRest2 = S.routines.find(... )?.ex.find(... )?.restSec; const secToStart = e.restSec ?? cfgRest2 ?? S.globalRestSec ?? 90; startRest(secToStart)`.

### 4. `frontend/src/views/RoutineEdit.jsx`

Mesmo `<RestChip>` por linha `ex`: `value={cfgRest ?? S.globalRestSec}`, `custom = cfgRest!=null`, ao tap grava só em `S.routines`.

### 5. `frontend/src/locales/pt.js` e `en.js`

Adicionar `Use the routine rest setting` / `Usa o tempo da rotina`, `Rest saved for {0} — {1}s` / `Descanso salvo para {0} — {1}s`, `Rest reset to default` / `Descanso redefinido para padrão`, `Rest must be between 30 and 300s` / `Descanso deve ser entre 30 e 300s`.

### 6. Testes manuais

1. `RoutineEdit → Push C → Supino → chip 90 cinza → tap 120 → verde 120 → localStorage contém routines[0].ex[supino].restSec=120`.
2. `startFlow(Push C) → Supino chip já 120 verde` (seed).
3. Durante treino mudar Supino 120→150 → ambos 150, toast, próxima sessão vem 150.
4. Tap `Padrão da rotina` → ambos `delete`, chip volta cinza 90, próxima sessão 90.
5. `Freestyle` mudar chip não altera `routines`.
6. Injetar `restSec=5` via console → reload → `loadState` remove, chip 90, `console.warn`.

## Comportamento Visual/UX

### Estado do chip (Workout e RoutineEdit)

**Chip cinza (fallback) — sem custom:**
```
[tag cinza #2c2c2e, texto #8e8e93]  ⏱ 90s
```
- `cfgRest == null && entry.restSec == null`
- Usa `S.globalRestSec` (90s). Sem `acc`.
- Em `RoutineEdit` aparece ao lado do nome do exercício, antes de `sets/reps`.

**Chip verde (custom) — com rest por-rotina:**
```
[tag verde acc-soft #30d158 16%, texto #30d158]  ⏱ 120s
```
- `cfgRest=120` ou `entry.restSec=120`
- Fundo `var(--acc-soft)`, texto `var(--acc)`, `acc` indica “esse exercício tem tempo próprio”.

### Sheet `Rest time` (ao tocar no chip)

```
┌─────────────────────────────────┐
│ Rest time                       │
├─────────────────────────────────┤
│ 60s                      [ ]     │
│ 90s                      [✓] ← effective===90
│ 120s                     [ ]     │
│ 150s                     [ ]     │
│ 180s                     [ ]     │
├─────────────────────────────────┤
│ Padrão da rotina (90s)   [✓] ← quando cfgRest==null && entry==null
│ Usa o tempo da rotina           │
└─────────────────────────────────┘
```
- `lrow` com `check` verde `lrow-k` na linha selecionada.
- Tap fecha `close()` após gravar; falha de validação mantém sheet aberto com toast erro.

### Toast

```
┌─────────────────────────────────┐
│ Descanso salvo para Push C — 120s │  2000ms, debounce 900ms (sucesso)
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ Descanso redefinido para padrão   │  2000ms
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ Descanso deve ser entre 30 e 300s │  erro, nunca debounced, prioridade
└─────────────────────────────────┘
```

### Fluxo visual completo

**Durante treino — ExerciseBlock:**
```
┌─ Supino reto (barra) ─────────────┐
│ [peito] [barra] [Best: 80 kg]  [⏱ 120s verde] ← tap
│ Last time (22 ago): 60×8, 70×6      │
│ 3 sets: [60×8 ✓] [70×6 ✓] [70×5 ]   │
└───────────────────────────────────┘
```

**Fora do treino — RoutineEdit → Push C:**
```
Push C  [def: Linear]               [🗑]
─────────────────────────────────────
1. Supino reto (barra)
   3× 8-12  70kg   [⏱ 120s verde]  [⋯]
2. Desenvolvimento ombro
   3× 8-12  40kg   [⏱ 90s cinza]   [⋯]
─────────────────────────────────────
[+ Add exercise]
```

**Após mudar durante treino:**
- Chip na mesma linha muda instantaneamente cinza→verde (ou verde→cinza ao resetar).
- `RoutineEdit` aberto em outra aba reflete o novo valor sem reload (store compartilhada via `useStore`).

## Persistência e Dados

`S.globalRestSec:90`, `S.routines[].ex[].restSec?: integer 30-300`, `ActiveEntry.restSec?: integer`. `localStorage gym_state_v1` com limpeza no `load` e sanitização pre-PUT. Compat `S.restSec` legado migrado. `delete` para reset.

## Integração

`Workout.jsx`, `RoutineEdit.jsx`, `sheets.jsx`, `store/useStore.js`, `locales`.

## Casos de Borda

Rotina deletada, exercício removido/adicionado, valor inválido, freestyle, 409 last-write-wins, re-render, limpeza.

## Critérios de Aceite

- [ ] Durante treino `Push C` mudar Supino 90→120 grava ambos em `localStorage` e próximo `beginWorkout` reutiliza 120.
- [ ] `Padrão da rotina` remove ambos e volta a 90 cinza.
- [ ] `RoutineEdit` chip reflete e altera persiste para próximo treino.
- [ ] Freestyle não persiste em `routines`.
- [ ] Validação 30-300 com toast erro PT.
- [ ] `vite build` ≤2s e `docker compose build web` passam; app em `https://opengym.edsc.fun`.
- [ ] Toast PT exato com debounce.
