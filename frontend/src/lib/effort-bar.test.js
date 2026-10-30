import { describe, it, expect } from 'vitest'
import { effortStops, nearestStop, EFFORT_START } from './history.js'

describe('barra de esforço', () => {
  it('RIR vai de 5 a 0, de meio em meio', () => {
    const s = effortStops('rir')
    expect(s).toHaveLength(11)
    expect([s[0], s[1], s[10]]).toEqual([5, 4.5, 0])
  })
  it('RPE vai de 6 a 10, de meio em meio', () => {
    const s = effortStops('rpe')
    expect(s).toHaveLength(9)
    expect([s[0], s[1], s[8]]).toEqual([6, 6.5, 10])
  })
  it('valor fora da barra cai na ponta, e o ponto de partida existe nas duas escalas', () => {
    expect(nearestStop(effortStops('rir'), 8)).toBe(5)
    expect(nearestStop(effortStops('rpe'), 3)).toBe(6)
    expect(effortStops('rir')).toContain(EFFORT_START.rir)
    expect(effortStops('rpe')).toContain(EFFORT_START.rpe)
  })
})
