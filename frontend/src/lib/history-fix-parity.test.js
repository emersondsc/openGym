// A correção de histórico roda no servidor (api/history-fix.js), porque nenhuma escrita de proposta
// pode acontecer sem passkey. A conta tem de ser a mesma do `applyWorkoutEdit`.
import { describe, it, expect } from 'vitest'
import { applyHistoryFix, validarOps } from '../../../api/history-fix.js'
import { applyWorkoutEdit } from './workout-edit.js'

const clone = o => JSON.parse(JSON.stringify(o))
const estado = unit => ({ unit, exWeights: { a: { w: 474, d: '2025-12-29', src: 'w2' }, b: { w: 60, d: '2025-12-01' } }, workouts: [
  { id: 'w1', d: '2025-12-01', start: 1, end: 2, name: 'A', entries: [{ id: 'a', topW: 45, sets: [{ w: 45, r: 5, done: true }] }, { id: 'b', topW: 60, sets: [{ w: 60, r: 8, done: true }] }], vol: 0, prs: [] },
  { id: 'w2', d: '2025-12-29', start: 3, end: 4, name: 'B', entries: [{ id: 'a', topW: 474, target: { unit: 'lb' }, sets: [{ w: 474, r: 5, done: true, rir: 1 }, { w: 40, r: 8, done: true }] }, { id: 'b', topW: 50, sets: [{ w: 50, r: 10, done: true, wUnit: 'lb' }] }], vol: 0, prs: [] }
] })

const CASOS = [
  [{ workout_id: 'w2', exercise_id: 'a', set_index: 0, field: 'w', from: 474, to: 47.4 }],
  [{ workout_id: 'w2', exercise_id: 'a', set_index: 1, field: 'r', from: 8, to: 10 }],
  [{ workout_id: 'w1', exercise_id: 'b', set_index: 0, field: 'w', from: 60, to: 80 }],
  [{ workout_id: 'w2', exercise_id: 'b', set_index: 0, field: 'wUnit', from: 'lb', to: 'kg' }]
]

describe.each(['kg', 'lb'])('paridade em perfil %s', unit => {
  it.each(CASOS.map((c, i) => [i, c]))('caso %i', (_, ops) => {
    const servidor = estado(unit)
    expect(validarOps(servidor, ops)).toBe(null)
    applyHistoryFix(servidor, ops)

    const app = estado(unit)
    const op = ops[0]
    const w = clone(app.workouts.find(x => x.id === op.workout_id))
    w.entries.find(e => e.id === op.exercise_id).sets[op.set_index][op.field] = op.to
    const r = applyWorkoutEdit(app, op.workout_id, w)

    const s = servidor.workouts.find(x => x.id === op.workout_id)
    expect(s.vol).toBe(r.workout.vol)
    expect(s.prs).toEqual(r.workout.prs)
    expect(s.entries.map(e => e.topW)).toEqual(r.workout.entries.map(e => e.topW))
    expect(servidor.exWeights).toEqual(r.exWeights)
  })
})
