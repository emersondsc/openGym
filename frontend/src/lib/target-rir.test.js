// spec_meta_de_hoje: RIR alvo, rótulos do card "Meta de hoje" e faixa de reps.
import { describe, it, expect } from 'vitest'
import { parseTargetRir, isValidTargetRir, normTargetRir, targetEffortLabel, repsLabel, repsRange } from './history.js'
import CASES from '../../../api/target-rir.cases.json'

describe('RIR alvo: mesmos casos da API (D17)', () => {
  for (const [v, norm] of CASES.valid) {
    it(`aceita ${JSON.stringify(v)} → ${JSON.stringify(norm)}`, () => {
      expect(isValidTargetRir(v)).toBe(true)
      expect(normTargetRir(v)).toEqual(norm)
    })
  }
  for (const v of CASES.invalid) {
    it(`recusa ${JSON.stringify(v)}`, () => {
      expect(isValidTargetRir(v)).toBe(false)
      expect(normTargetRir(v)).toBeUndefined()
    })
  }
  it('faixa vira par', () => expect(parseTargetRir('1-2')).toEqual([1, 2]))
})

describe('targetEffortLabel', () => {
  it('RIR', () => {
    expect(targetEffortLabel(2, 'rir')).toBe('RIR 2')
    expect(targetEffortLabel('1-2', 'rir')).toBe('RIR 1–2')
  })
  it('RPE = 10 − RIR', () => {
    expect(targetEffortLabel(2, 'rpe')).toBe('RPE 8')
    expect(targetEffortLabel('1-2', 'rpe')).toBe('RPE 8–9')
  })
  it('perfil sem escala mostra RIR', () => expect(targetEffortLabel(2, 'none')).toBe('RIR 2'))
  it('sem alvo', () => expect(targetEffortLabel(undefined, 'rir')).toBeNull())
})

describe('repsLabel e repsRange', () => {
  it('faixa do treinador', () => {
    expect(repsLabel({ reps: '8-12' })).toBe('8–12')
    expect(repsRange('8-12')).toEqual([8, 12])
  })
  it('número', () => {
    expect(repsLabel({ reps: 10 })).toBe('10')
    expect(repsRange(10)).toBeNull()
  })
  it('progressão dupla', () => expect(repsLabel({ reps: 12, repsMin: 8 })).toBe('8–12'))
  it('vazio', () => expect(repsLabel({ reps: 'x' })).toBeNull())
})
