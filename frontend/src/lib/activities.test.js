// lib/activities.test.js — corridas (docs/specs/spec_corrida.md, DIP §4-5).
import { describe, it, expect } from 'vitest'
import {
  readActivity, runsOf, runsOn, runDays, historyItems, withRun, removeRun, mergeActivities,
  parseKm, parseDuration, fmtDuration, fmtPace, paceOf, validateRun,
} from './activities.js'
import { sanitizeActivities } from '../../../api/activities.js'

const fields = (over = {}) => ({ d: '2026-11-21', km: 5.2, sec: 1721, place: 'outdoor', ...over })
const stored = (over = {}) => ({ d: '2026-11-21', sport: 'run', km: 5.2, sec: 1721, min: 29, place: 'outdoor', src: 'manual', _ts: 100, ...over })

describe('ida e volta e remoção', () => {
  it('withRun → runsOf preserva os campos do fork', () => {
    const { map, id } = withRun({}, null, fields({ elev: 48, hrAvg: 152, hrMax: 178, rpe: 7, note: 'ok' }), 100)
    const [r] = runsOf({ activities: map })
    expect(r).toMatchObject({ id, sec: 1721, place: 'outdoor', elev: 48, hrAvg: 152, hrMax: 178, rpe: 7, note: 'ok', min: 29 })
  })
  it('removeRun grava só { deleted, _ts }, e readActivity devolve null', () => {
    const map = removeRun({ m1: stored() }, 'm1', 200)
    expect(map.m1).toEqual({ deleted: true, _ts: 200 })
    expect(readActivity(map.m1)).toBeNull()
    expect(runsOf({ activities: map })).toEqual([])
  })
})

describe('withRun', () => {
  it('sobre um id excluído devolve um id novo', () => {
    const { map, id } = withRun({ m1: { deleted: true, _ts: 1 } }, 'm1', fields(), 100)
    expect(id).not.toBe('m1')
    expect(map.m1).toEqual({ deleted: true, _ts: 1 })
    expect(map[id].km).toBe(5.2)
  })
  it('substitui a entrada: uma edição sem hrAvg tira o campo', () => {
    const { map } = withRun({ m1: stored({ hrAvg: 150 }) }, 'm1', fields({ hrAvg: '' }), 300)
    expect(map.m1.hrAvg).toBeUndefined()
    expect(map.m1._ts).toBe(300)
  })
  it('grava elev na esteira e não grava id na entrada', () => {
    const { map, id } = withRun({}, null, fields({ place: 'treadmill', elev: 30 }), 1)
    expect(map[id].elev).toBe(30)
    expect(map[id].id).toBeUndefined()
  })
})

describe('readActivity (só forma)', () => {
  it('ignora outro esporte e aceita data futura', () => {
    expect(readActivity(stored({ sport: 'ride' }))).toBeNull()
    expect(readActivity(stored({ d: '2999-01-01' }))).not.toBeNull()
  })
  it('sem place devolve outdoor, tira hrAvg errado e recalcula min', () => {
    const a = readActivity(stored({ place: undefined, hrAvg: 'x', min: 3 }))
    expect(a.place).toBe('outdoor')
    expect(a.hrAvg).toBeUndefined()
    expect(a.min).toBe(29)
  })
  it('runsOn e runDays', () => {
    const S = { activities: { a: stored({ d: '2026-11-20' }), b: stored() } }
    expect(runsOn(S, '2026-11-21').map(r => r.id)).toEqual(['b'])
    expect([...runDays(S)].sort()).toEqual(['2026-11-20', '2026-11-21'])
  })
})

describe('mergeActivities', () => {
  it('uma corrida só local sobrevive', () => {
    expect(mergeActivities({}, { m1: stored() }).m1.km).toBe(5.2)
  })
  it('uma entrada local inválida é descartada', () => {
    expect(mergeActivities({}, { m1: stored({ km: 0 }) })).toEqual({})
  })
  it('opcional de tipo errado volta sem o campo', () => {
    expect(mergeActivities({}, { m1: stored({ hrAvg: 'x' }) }).m1.hrAvg).toBeUndefined()
  })
  it('entre duas ativas vence o _ts maior; no empate, o servidor', () => {
    expect(mergeActivities({ m1: stored({ km: 5, _ts: 1 }) }, { m1: stored({ km: 6, _ts: 2 }) }).m1.km).toBe(6)
    expect(mergeActivities({ m1: stored({ km: 5, _ts: 2 }) }, { m1: stored({ km: 6, _ts: 2 }) }).m1.km).toBe(5)
  })
  it('a remoção vence uma edição com _ts maior (relógio adiantado)', () => {
    expect(mergeActivities({ m1: { deleted: true, _ts: 1 } }, { m1: stored({ _ts: 999 }) }).m1).toEqual({ deleted: true, _ts: 1 })
    expect(mergeActivities({ m1: stored({ _ts: 999 }) }, { m1: { deleted: true, _ts: 1 } }).m1.deleted).toBe(true)
  })
  it('entre duas remoções fica o _ts maior', () => {
    expect(mergeActivities({ m1: { deleted: true, _ts: 1 } }, { m1: { deleted: true, _ts: 5 } }).m1._ts).toBe(5)
  })
  it('undefined dos dois lados não quebra', () => {
    expect(mergeActivities(undefined, undefined)).toEqual({})
    expect(mergeActivities(undefined, { m1: stored() }).m1).toBeTruthy()
  })
  it('converge com a limpeza do servidor', () => {
    const merged = mergeActivities({ a: { deleted: true, _ts: 3, x: 1 } }, { b: stored({ place: 'x', hrAvg: 'y', km: 5.123, foo: 1 }), c: stored({ km: 0 }) })
    const r = sanitizeActivities(merged, {}, 1)
    expect(r.dropped).toBe(0)
    expect(r.fields).toEqual([])
    expect(r.map).toEqual(merged)
  })
})

describe('parsers e formatação', () => {
  it('parseDuration', () => {
    expect(parseDuration('28')).toBe(1680)
    expect(parseDuration('28:41')).toBe(1721)
    expect(parseDuration('1:02:05')).toBe(3725)
    expect(parseDuration(' 28:41 ')).toBe(1721)
    for (const bad of ['28:61', '28,5', '', '1:61:00', 'x', '2861', '16100', '1234567']) expect(parseDuration(bad)).toBeNull()
  })
  it('parseDuration aceita só números (teclado numérico do celular)', () => {
    expect(parseDuration('2841')).toBe(1721)
    expect(parseDuration('941')).toBe(581)
    expect(parseDuration('10205')).toBe(3725)
    expect(parseDuration('010205')).toBe(3725)
    expect(parseDuration('28.41')).toBe(1721)
    expect(parseDuration('28,41')).toBe(1721)
    expect(parseDuration('1.02.05')).toBe(3725)
  })
  it('parseKm', () => {
    expect(parseKm('5,2')).toBe(5.2)
    expect(parseKm('5.2')).toBe(5.2)
    for (const bad of ['5,2 km', '-3', '', '5.2.1']) expect(parseKm(bad)).toBeNull()
  })
  it('fmtPace e fmtDuration', () => {
    expect(fmtPace(paceOf(5.2, 1721))).toBe('5:31/km')
    expect(fmtPace(359.6)).toBe('6:00/km')
    expect(fmtDuration(3725)).toBe('1:02:05')
    expect(fmtDuration(1721)).toBe('28:41')
  })
})

describe('validateRun', () => {
  const today = '2026-11-21'
  const v = over => validateRun(fields(over), today)
  it('aceita uma corrida comum', () => {
    expect(v({})).toEqual({ errors: {}, warnings: [] })
  })
  it('fronteiras', () => {
    expect(v({ km: 300 }).errors.km).toBeUndefined()
    expect(v({ km: 300.01 }).errors.km).toBe('Distance must be between 0 and 300 km')
    expect(v({ km: 0.004 }).errors.km).toBe('Distance must be between 0 and 300 km')
    expect(v({ sec: 60, km: 0.3 }).errors.sec).toBeUndefined()
    expect(v({ sec: 59 }).errors.sec).toBe('Time must be between 1:00 and 24:00:00')
    expect(v({ hrAvg: 30 }).errors.hrAvg).toBeUndefined()
    expect(v({ hrAvg: 29 }).errors.hrAvg).toBe('Heart rate must be between 30 and 250')
    expect(v({ hrAvg: 160, hrMax: 150 }).errors.hrMax).toBe('Max heart rate is below average')
    expect(v({ rpe: 11 }).errors.rpe).toBe('Effort must be 1 to 10')
  })
  it('obrigatórios, data futura e aviso de ritmo', () => {
    expect(v({ km: null, sec: null, d: '' }).errors).toEqual({ d: 'Required', km: 'Required', sec: 'Required' })
    expect(v({ d: '2026-11-22' }).errors.d).toBe('Date in the future')
    expect(v({ km: 52 }).warnings).toEqual(['Unusual pace, check distance and time'])
  })
})

describe('historyItems', () => {
  const workout = (id, d, start = 100) => ({ id, d, start, end: start + 60000, name: id, entries: [], vol: 0, prs: [] })

  it('ordena treinos e corridas por data desc; no mesmo dia, treinos antes de corridas', () => {
    const S = {
      workouts: [
        workout('w1', '2026-11-18', 100),
        workout('w2', '2026-11-20', 100),
        workout('w3', '2026-11-20', 200),
      ],
      activities: {
        r1: stored({ d: '2026-11-19', _ts: 10 }),
        r2: stored({ d: '2026-11-20', _ts: 50 }),
        r3: stored({ d: '2026-11-20', _ts: 90 }),
        r4: stored({ d: '2026-11-21', _ts: 30 }),
        del: { deleted: true, _ts: 999 },
      },
    }
    expect(historyItems(S).map(it => it.k)).toEqual(['rr4', 'ww3', 'ww2', 'rr3', 'rr2', 'rr1', 'ww1'])
  })

  it('funciona só com corridas, sem treinos, ou com estado vazio', () => {
    expect(historyItems(null)).toEqual([])
    expect(historyItems({ workouts: [], activities: { r1: stored({ d: '2026-11-21' }) } }).map(it => it.k)).toEqual(['rr1'])
  })

  it('aceita lista pré-calculada de corridas', () => {
    const S = { workouts: [workout('w1', '2026-11-20')] }
    const runs = [{ id: 'r1', d: '2026-11-21', km: 5, sec: 1500, _ts: 1 }]
    expect(historyItems(S, runs).map(it => it.k)).toEqual(['rr1', 'ww1'])
  })
})
