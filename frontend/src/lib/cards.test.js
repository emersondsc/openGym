import { describe, it, expect } from 'vitest'
import {
  HOME_CARDS, STATS_CARDS, isCardHidden, withCardHidden, clearHiddenCards,
  visibleCardsFor, countHidden,
} from './cards.js'

describe('cards preferences', () => {
  it('isCardHidden tolera estado ausente ou malformado', () => {
    expect(isCardHidden(null, 'home', 'streak')).toBe(false)
    expect(isCardHidden({}, 'home', 'streak')).toBe(false)
    expect(isCardHidden({ hiddenCards: null }, 'stats', 'weight')).toBe(false)
    expect(isCardHidden({ hiddenCards: { home: { streak: true } } }, 'home', 'streak')).toBe(true)
    expect(isCardHidden({ hiddenCards: { home: { exercise: true } } }, 'stats', 'exercise')).toBe(false)
  })

  it('withCardHidden alterna por tela de forma imutável e ignora id inválido', () => {
    const a = withCardHidden(undefined, 'home', 'streak', true)
    expect(a).toEqual({ home: { streak: true }, stats: {} })

    const b = withCardHidden(a, 'stats', 'weight', true)
    expect(b).toEqual({ home: { streak: true }, stats: { weight: true } })
    expect(a.stats).toEqual({})

    const c = withCardHidden(b, 'home', 'streak', false)
    expect(c).toEqual({ home: {}, stats: { weight: true } })

    expect(withCardHidden(c, 'home', 'unknown', true)).toEqual(c)
    expect(withCardHidden(c, 'other', 'streak', true)).toEqual(c)
  })

  it('clearHiddenCards limpa uma tela ou todas', () => {
    const start = { home: { streak: true, volume: true }, stats: { weight: true } }
    expect(clearHiddenCards(start, 'home')).toEqual({ home: {}, stats: { weight: true } })
    expect(clearHiddenCards(start)).toEqual({ home: {}, stats: {} })
  })

  it('visibleCardsFor inclui cards condicionais quando aplicáveis ou quando já ocultos', () => {
    const base = { routines: [{ id: 'r1' }], hiddenCards: { home: {}, stats: {} } }
    expect(visibleCardsFor(base, null, 'home', false).map(c => c.id)).toEqual(['streak', 'volume', 'exercise'])
    expect(visibleCardsFor({ routines: [], hiddenCards: {} }, { coachOwner: true }, 'home', false).map(c => c.id))
      .toEqual(['welcome', 'streak', 'volume', 'proposals', 'exercise'])

    const withHidden = { routines: [{ id: 'r1' }], hiddenCards: { home: { welcome: true }, stats: { effort: true } } }
    expect(visibleCardsFor(withHidden, null, 'home', false).map(c => c.id)).toContain('welcome')
    expect(visibleCardsFor(withHidden, null, 'stats', false).map(c => c.id)).toContain('effort')
    expect(visibleCardsFor(base, null, 'stats', false).map(c => c.id)).not.toContain('effort')
    expect(visibleCardsFor(base, null, 'stats', true).map(c => c.id)).toEqual(STATS_CARDS.map(c => c.id))
    expect(HOME_CARDS.some(c => c.id === 'week')).toBe(false)
  })

  it('countHidden conta apenas os cards na lista visível', () => {
    const S = { hiddenCards: { stats: { heatmap: true, weight: true } } }
    expect(countHidden(S, 'stats')).toBe(2)
    expect(countHidden(S, 'home')).toBe(0)
  })
})
