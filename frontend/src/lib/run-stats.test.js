// lib/run-stats.test.js — contas do cartão "Corrida" (docs/specs/spec_corrida.md, DIP §7).
import { describe, it, expect } from 'vitest'
import { mondayOf, weeklyKm, thisWeekKm, longestRun, avgPaceLast, bestPace } from './run-stats.js'

// Em ordem de runsOf: da mais recente para a mais antiga.
const r = (d, km, sec, _ts = 0) => ({ d, km, sec, _ts })

describe('semana', () => {
  it('começa na segunda; o domingo fica na semana anterior', () => {
    expect(mondayOf('2026-11-23')).toBe('2026-11-23')   // segunda
    expect(mondayOf('2026-11-22')).toBe('2026-11-16')   // domingo
    expect(mondayOf('2026-11-21')).toBe('2026-11-16')   // sábado
  })
  it('8 semanas, algumas sem corrida', () => {
    const runs = [r('2026-11-21', 5, 1500), r('2026-11-17', 3.2, 1100), r('2026-10-05', 10, 3600)]
    const w = weeklyKm(runs, '2026-11-21')
    expect(w).toHaveLength(8)
    expect(w[7]).toEqual({ start: '2026-11-16', km: 8.2 })
    expect(w[0]).toEqual({ start: '2026-09-28', km: 0 })
    expect(w[1]).toEqual({ start: '2026-10-05', km: 10 })
    expect(w.filter(x => x.km === 0)).toHaveLength(6)
    expect(thisWeekKm(runs, '2026-11-21')).toBe(8.2)
  })
  it('a semana de 2026-12-28 a 2027-01-03 junta os dois anos', () => {
    const w = weeklyKm([r('2027-01-03', 4, 1400), r('2026-12-28', 6, 2000)], '2027-01-03', 1)
    expect(w).toEqual([{ start: '2026-12-28', km: 10 }])
  })
})

describe('cartão', () => {
  it('corrida mais longa: no empate, a mais recente', () => {
    const runs = [r('2026-11-21', 10, 3000), r('2026-11-10', 10, 2900), r('2026-11-01', 8, 2400)]
    expect(longestRun(runs).d).toBe('2026-11-21')
    expect(longestRun([])).toBeNull()
  })
  it('ritmo médio ponderado pela distância', () => {
    const runs = [r('2026-11-21', 5, 1500), r('2026-11-20', 10, 3600)]
    expect(avgPaceLast(runs)).toBe(5100 / 15)          // 340, não a média simples 330
    expect(avgPaceLast([])).toBeNull()
  })
  it('só as 5 mais recentes', () => {
    const runs = [1, 2, 3, 4, 5, 6].map(i => r('2026-11-2' + i, 1, i === 6 ? 9999 : 300))
    expect(avgPaceLast(runs)).toBe(300)
  })
  it('melhor ritmo: exatamente 5,00 e 10,00 km entram; sem corrida dá null; empate, a mais recente', () => {
    const runs = [r('2026-11-21', 5, 1500), r('2026-11-15', 10, 3000), r('2026-11-10', 4.9, 1000)]
    expect(bestPace(runs, 5).run.d).toBe('2026-11-21')  // 300 s/km empata com 10 km: vence a mais recente
    expect(bestPace(runs, 10)).toEqual({ pace: 300, run: runs[1] })
    expect(bestPace([r('2026-11-21', 4.99, 1000)], 5)).toBeNull()
  })
})
