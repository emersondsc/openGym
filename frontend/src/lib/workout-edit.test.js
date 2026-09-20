// frontend/src/lib/workout-edit.test.js — edição de um treino finalizado (spec_editar_treino_finalizado.md).
//
// O que este arquivo protege: o recálculo dos derivados na MESMA escrita (volume, recordes,
// melhor peso por exercício, ordem por data) e a mescla que impede um conflito de sync de
// descartar a edição em silêncio. Tudo aqui é função pura — nenhum React, nenhum store.
import { describe, it, expect } from 'vitest'
import {
  applyWorkoutEdit, removeWorkout, shiftWorkoutDate, sortWorkouts, setShape,
  mergeWorkouts, mergeExWeights, sigOf, freshMark, LOCAL_WIN_MS
} from './workout-edit.js'
import { bestEntryFor } from './history.js'

const clone = o => JSON.parse(JSON.stringify(o))
// at(mês, dia, hora, minuto) — hora local, para os casos de mudança de dia e de ordem.
const at = (mo, day, hour, min = 0) => new Date(2026, mo - 1, day, hour, min).getTime()

/* Histórico mínimo: dois treinos com o mesmo exercício (bench) e um segundo exercício no treino
   editado (squat), para os casos de remoção e de "mexido". */
const st = () => ({
  unit: 'kg',
  exWeights: {},
  routines: [],
  workouts: [
    {
      id: 'w1', d: '2026-09-05', name: 'Upper A', start: at(9, 5, 10), end: at(9, 5, 11),
      entries: [{ id: 'bench', target: { mode: 'reps', reps: 8 }, sets: [{ w: 100, r: 8, done: true }, { w: 100, r: 8, done: true }] }]
    },
    {
      id: 'w2', d: '2026-09-12', name: 'Push C', start: at(9, 12, 10), end: at(9, 12, 11),
      prs: ['bench'],
      entries: [
        { id: 'bench', topW: null, target: { mode: 'reps', reps: 8 }, sets: [{ w: 100, r: 8, done: true }, { w: 110, r: 6, done: true }] },
        { id: 'squat', topW: 60, target: { mode: 'reps', reps: 5 }, sets: [{ w: 60, r: 5, done: true }] }
      ]
    }
  ]
})
const draftOf = (S, id) => clone(S.workouts.find(w => w.id === id))
const volOf = w => w.entries.reduce((a, e) => a + e.sets.filter(s => s.done).reduce((b, s) => b + (s.w || 0) * (s.r || 0), 0), 0)

describe('applyWorkoutEdit — recálculo dos derivados', () => {
  it('1. corrigir o peso de uma série recalcula o volume do treino', () => {
    const S = st(), d = draftOf(S, 'w2')
    d.entries[0].sets[1].w = 120
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.workout.vol).toBe(100 * 8 + 120 * 6 + 60 * 5)
    expect(r.workout.vol).toBe(volOf(r.workout))
  })

  it('2. correção para baixo que derruba o recorde tira o exercício de w.prs', () => {
    const S = st(), d = draftOf(S, 'w2')
    expect(S.workouts[1].prs).toEqual(['bench'])
    d.entries[0].sets[1].w = 100
    // `squat` continua recorde: não há sessão anterior dele no histórico, e o app trata a
    // primeira sessão com carga como recorde (mesma regra do doFinishWorkout).
    expect(applyWorkoutEdit(S, 'w2', d).workout.prs).toEqual(['squat'])
  })

  it('3. correção para cima que passa do histórico põe o exercício em w.prs', () => {
    const S = st(), d = draftOf(S, 'w2')
    d.entries[0].sets[1].w = 130
    expect(applyWorkoutEdit(S, 'w2', d).workout.prs).toEqual(['bench', 'squat'])
  })

  it('4. série desmarcada sai do volume e do recorde, mas continua no array do treino', () => {
    const S = st(), d = draftOf(S, 'w2')
    d.entries[0].sets[1].done = false
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.workout.vol).toBe(100 * 8 + 60 * 5)
    expect(r.workout.entries[0].sets).toHaveLength(2)
    expect(r.workout.entries[0].sets[1].done).toBe(false)
  })

  it('5. exercício com todas as séries desmarcadas sai de entries ao salvar', () => {
    const S = st(), d = draftOf(S, 'w2')
    d.entries[1].sets.forEach(s => { s.done = false })
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.workout.entries.map(e => e.id)).toEqual(['bench'])
  })

  it('6. nenhuma série marcada em nenhum exercício devolve null', () => {
    const S = st(), d = draftOf(S, 'w2')
    d.entries.forEach(e => e.sets.forEach(s => { s.done = false }))
    expect(applyWorkoutEdit(S, 'w2', d)).toBeNull()
  })

  it('17. treino inexistente devolve null', () => {
    const S = st()
    expect(applyWorkoutEdit(S, 'nao-existe', draftOf(S, 'w2'))).toBeNull()
  })
})

describe('applyWorkoutEdit — dia', () => {
  it('7. mudar o dia reordena o histórico e reancora a hora local, mantendo a duração', () => {
    const S = st(), d = draftOf(S, 'w2')
    const dur = d.end - d.start
    const sh = shiftWorkoutDate(d, '2026-09-01')
    Object.assign(d, sh)
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.workouts.map(w => w.id)).toEqual(['w2', 'w1'])
    const s = new Date(r.workout.start)
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes()]).toEqual([2026, 8, 1, 10, 0])
    expect(r.workout.end - r.workout.start).toBe(dur)
  })

  it('8. editar sem mudar o dia NÃO reordena um histórico que estava fora de ordem', () => {
    const S = st()
    S.workouts.reverse()                       // fora de ordem de propósito
    const d = draftOf(S, 'w2')
    d.entries[0].sets[0].w = 105
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.workouts.map(w => w.id)).toEqual(['w2', 'w1'])
  })

  it('19. shiftWorkoutDate não inventa `end` quando ele falta', () => {
    const S = st(), d = draftOf(S, 'w2')
    delete d.end
    const out = shiftWorkoutDate(d, '2026-09-01')
    expect(out.end).toBeUndefined()
    expect(new Date(out.start).getDate()).toBe(1)
  })
})

describe('applyWorkoutEdit — melhor peso por exercício (exWeights)', () => {
  it('9. sobe quando a correção passa do valor guardado, e grava o treino de origem', () => {
    const S = st(), d = draftOf(S, 'w2')
    d.entries[0].sets[1].w = 130
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.exWeights.bench).toEqual({ w: 130, d: '2026-09-12', src: 'w2' })
  })

  it('10. desce quando o valor guardado veio deste treino', () => {
    const S = st()
    S.exWeights = { bench: { w: 110, d: '2026-09-12', src: 'w2' } }
    const d = draftOf(S, 'w2')
    d.entries[0].sets[1].w = 100
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.exWeights.bench).toEqual({ w: 100, d: '2026-09-05', src: 'w1' })
  })

  it('11. NÃO desce quando o valor guardado veio de outro treino', () => {
    const S = st()
    S.exWeights = { bench: { w: 150, d: '2026-08-01', src: 'w0' } }
    const d = draftOf(S, 'w2')
    d.entries[0].sets[1].w = 100
    expect(applyWorkoutEdit(S, 'w2', d).exWeights.bench).toEqual({ w: 150, d: '2026-08-01', src: 'w0' })
  })

  it('12. NÃO desce em dado antigo sem `src` quando o guardado é maior que este treino registrava', () => {
    const S = st()
    S.exWeights = { bench: { w: 140, d: '2026-08-01' } }
    const d = draftOf(S, 'w2')
    d.entries[0].sets[1].w = 100
    expect(applyWorkoutEdit(S, 'w2', d).exWeights.bench).toEqual({ w: 140, d: '2026-08-01' })
  })

  it('13. exercício removido do treino tem o exWeights recalculado (ou apagado)', () => {
    const S = st()
    S.exWeights = { squat: { w: 60, d: '2026-09-12', src: 'w2' } }
    const d = draftOf(S, 'w2')
    d.entries.splice(1, 1)                     // squat sai do treino
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.exWeights.squat).toBeUndefined()
    expect(r.touchedEx).toContain('squat')
  })

  it('21. removeWorkout recalcula o exWeights dos exercícios do treino apagado', () => {
    const S = st()
    S.exWeights = { bench: { w: 110, d: '2026-09-12', src: 'w2' }, squat: { w: 60, d: '2026-09-12', src: 'w2' } }
    const r = removeWorkout(S, 'w2')
    expect(r.workouts.map(w => w.id)).toEqual(['w1'])
    expect(r.exWeights.bench).toEqual({ w: 100, d: '2026-09-05', src: 'w1' })
    expect(r.exWeights.squat).toBeUndefined()
  })

  it('21b. removeWorkout não mexe no melhor peso que veio de outro treino', () => {
    const S = st()
    S.exWeights = { bench: { w: 150, d: '2026-08-01', src: 'w0' } }
    expect(removeWorkout(S, 'w2').exWeights.bench).toEqual({ w: 150, d: '2026-08-01', src: 'w0' })
  })
})

describe('applyWorkoutEdit — o que NÃO muda', () => {
  it('14. topW é recalculado só no exercício mexido', () => {
    const S = st(), d = draftOf(S, 'w2')
    d.entries[0].sets[1].w = 120
    const r = applyWorkoutEdit(S, 'w2', d)
    expect(r.workout.entries[0].topW).toBe(120)   // mexido: vira a maior série marcada
    expect(r.workout.entries[1].topW).toBe(60)    // intocado: mantém o confirmado
  })

  it('15. apagar e redigitar o mesmo valor não conta como "mexido" (comparação campo a campo)', () => {
    const S = st()
    S.workouts[1].entries[0].topW = 130           // peso de trabalho confirmado à mão
    const d = draftOf(S, 'w2')
    // mesmas séries, chaves em outra ORDEM: é o que um delete + reatribuição produz
    d.entries[0].sets = [{ done: true, r: 8, w: 100 }, { done: true, r: 6, w: 110 }]
    expect(applyWorkoutEdit(S, 'w2', d).workout.entries[0].topW).toBe(130)
  })

  it('24. a entrada preserva os campos que já tinha (o `n` que o exercício custom deixa)', () => {
    const S = st()
    S.workouts[1].entries[0].n = 'Supino reto'
    const d = draftOf(S, 'w2')
    d.entries[0].sets[0].w = 105
    expect(applyWorkoutEdit(S, 'w2', d).workout.entries[0].n).toBe('Supino reto')
  })

  it('16. não muta o estado recebido e não devolve routines/week/dayPlan', () => {
    const S = st()
    const before = JSON.stringify(S)
    const r = applyWorkoutEdit(S, 'w2', draftOf(S, 'w2'))
    expect(JSON.stringify(S)).toBe(before)
    expect(r.routines).toBeUndefined()
    expect(r.week).toBeUndefined()
    expect(r.dayPlan).toBeUndefined()
  })
})

describe('setShape — a forma da série', () => {
  it('18. devolve a forma real de cada modo, sem chaves da configuração', () => {
    expect(setShape('reps', null, { reps: 8, weight: 40 })).toEqual({ w: 40, r: 8, done: false })
    expect(setShape('time', null, { sec: 45, weight: 10 })).toEqual({ sec: 45, w: 10, done: false })
    expect(setShape('cardio', null, { min: 20, speed: 8 })).toEqual({ min: 20, speed: 8, done: false })
    expect(Object.keys(setShape('reps', null, { reps: 8 }))).not.toContain('sets')
    expect(Object.keys(setShape('reps', null, { reps: 8 }))).not.toContain('mode')
  })

  it('22. semeia da prescrição quando não há série anterior', () => {
    expect(setShape('reps', null, { reps: 5 }).r).toBe(5)                 // e não 10
    expect(setShape('reps', null, { reps: '6-8' }).r).toBe(6)             // faixa: o piso
    expect(setShape('time', null, { sec: 90, weight: 40 }).w).toBe(40)    // e não 0
  })

  it('copia os números da última série quando ela existe', () => {
    const prev = { w: 82.5, r: 6, done: true }
    expect(setShape('reps', prev, { reps: 10 })).toEqual({ w: 82.5, r: 6, done: false })
  })

  it('23. carrega o override de unidade da série anterior', () => {
    const prev = { w: 200, r: 8, wUnit: 'lb', done: true }
    expect(setShape('reps', prev, {}).wUnit).toBe('lb')
    expect(setShape('reps', { w: 200, r: 8, done: true }, {}).wUnit).toBeUndefined()
  })
})

describe('sortWorkouts', () => {
  it('20. desempata dois treinos do mesmo dia pela hora de início', () => {
    const a = { id: 'a', d: '2026-09-12', start: at(9, 12, 18) }
    const b = { id: 'b', d: '2026-09-12', start: at(9, 12, 7) }
    const c = { id: 'c', d: '2026-09-10', start: at(9, 10, 20) }
    expect(sortWorkouts([a, b, c]).map(w => w.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('mescla com o servidor (RF-12)', () => {
  const localW = { id: 'w2', d: '2026-09-12', name: 'Push C', entries: [{ id: 'bench', sets: [{ w: 130, r: 6, done: true }] }] }
  const serverW = { id: 'w2', d: '2026-09-12', name: 'Push C', entries: [{ id: 'bench', sets: [{ w: 110, r: 6, done: true }] }] }
  const mark = (extra = {}, w = localW) => ({ id: 'w2', at: Date.now(), sig: sigOf(w), ex: ['bench'], moved: false, deleted: false, ...extra })

  it('25. sem `moved` a mescla mantém a ordem do servidor; com `moved`, reordena', () => {
    const server = [{ id: 'w1', d: '2026-09-05', start: 1 }, { id: 'w2', d: '2026-09-20', start: 2 }]
    const movedW = { ...localW, d: '2026-09-01' }
    const local = [movedW, { id: 'w1', d: '2026-09-05', start: 1 }]
    // sem `moved`: a ordem do servidor é preservada (mesmo com a cópia local vencendo por id)
    expect(mergeWorkouts(server, local, mark({}, movedW)).map(w => w.id)).toEqual(['w1', 'w2'])
    // com `moved`: a mescla reordena por data, e o treino que mudou de dia vai para o lugar dele
    expect(mergeWorkouts(server, local, mark({ moved: true }, movedW)).map(w => w.id)).toEqual(['w2', 'w1'])
  })

  it('28. uma cópia local com carimbo diferente NÃO vence (a aba que não editou)', () => {
    const stale = { ...localW, entries: [{ id: 'bench', sets: [{ w: 999, r: 6, done: true }] }] }
    const out = mergeWorkouts([serverW], [stale], mark())
    expect(out[0].entries[0].sets[0].w).toBe(110)
    expect(mergeWorkouts([serverW], [localW], mark())[0].entries[0].sets[0].w).toBe(130)
  })

  it('27. treino marcado como apagado não volta do servidor', () => {
    expect(mergeWorkouts([serverW], [], mark({ deleted: true }))).toEqual([])
    expect(mergeWorkouts([serverW], [], mark({ deleted: true, at: Date.now() - LOCAL_WIN_MS - 1 }))).toHaveLength(1)
  })

  it('26. mergeExWeights deixa o local vencer nos exercícios da marca, inclusive apagando a chave', () => {
    const srv = { bench: { w: 110, d: '2026-09-12', src: 'w2' }, squat: { w: 60, d: '2026-09-12', src: 'w2' }, row: { w: 70, d: '2026-09-01', src: 'w1' } }
    const loc = { bench: { w: 100, d: '2026-09-05', src: 'w1' }, row: { w: 70, d: '2026-09-01', src: 'w1' } }
    const out = mergeExWeights(srv, loc, mark({ ex: ['bench', 'squat'] }))
    expect(out.bench).toEqual({ w: 100, d: '2026-09-05', src: 'w1' })
    expect(out.squat).toBeUndefined()
    expect(out.row).toEqual({ w: 70, d: '2026-09-01', src: 'w1' })
    expect(mergeExWeights(srv, loc, null)).toEqual(srv)
  })

  it('marca vencida não vale nada', () => {
    expect(freshMark(mark({ at: Date.now() - LOCAL_WIN_MS - 1 }))).toBeNull()
    expect(freshMark(null)).toBeNull()
    expect(freshMark(mark()).id).toBe('w2')
  })
})

describe('bestEntryFor', () => {
  it('devolve peso, data e treino de origem, e respeita a exclusão', () => {
    const S = st()
    expect(bestEntryFor(S, 'bench')).toEqual({ w: 110, d: '2026-09-12', src: 'w2' })
    expect(bestEntryFor(S, 'bench', 'w2')).toEqual({ w: 100, d: '2026-09-05', src: 'w1' })
    expect(bestEntryFor(S, 'nao-existe')).toEqual({ w: 0, d: null, src: null })
  })
})
