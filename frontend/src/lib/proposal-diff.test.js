import { describe, it, expect } from 'vitest'
import { groupChanges, fmtValue } from './proposal-diff.js'

const c = path => ({ path, before: 1, after: 2 })

describe('groupChanges', () => {
  it('coloca cada folha exatamente uma vez', () => {
    const changes = ['routines.0.ex.1.weight', 'routines.0.name', 'routines.1.ex.0.sets', 'dayPlan.2026-11-13', 'week.3',
      'mesos.0.rules.Hernia', 'mesos.0.goal', 'workouts.4.entries.0.sets.2.w', 'workouts.4.vol', 'exWeights.0584.w', 'mesoPrev'].map(c)
    const { groups, other } = groupChanges(changes)
    const vistos = [...groups.flatMap(g => g.rows.map(r => r.path)), ...other.map(o => o.path)]
    expect([...vistos].sort()).toEqual(changes.map(x => x.path).sort())
    expect(new Set(vistos).size).toBe(changes.length)
  })
  it('agrupa por rotina e dias, e manda o resto para outros campos', () => {
    const { groups, other } = groupChanges([c('routines.0.ex.1.weight'), c('routines.0.ex.2.sets'), c('dayPlan.2026-11-13'), c('mesoPrev')])
    expect(groups.map(g => g.kind)).toEqual(['routine', 'days'])
    expect(groups[0].rows[0].label).toBe('Weight')
    expect(other.map(o => o.path)).toEqual(['mesoPrev'])
  })
  it('agrupa diffs de dieta (plans.* e activePlanId) com rotulos legiveis', () => {
    const changes = [
      'activePlanId',
      'plans.0.targets.dailyKcal.min',
      'plans.0.targets.macros.proteinG',
      'plans.0.meals.1.kcal',
      'plans.0.meals.1.items.0.amount',
      'plans.0.rules.Estagnação 2-3 semanas'
    ].map(c)
    const { groups, other } = groupChanges(changes)
    expect(other).toEqual([])
    expect(groups.map(g => g.kind)).toEqual(['dietActive', 'diet', 'dietMeal', 'dietRules'])
    expect(groups[0].rows[0].label).toBe('Active diet plan')
    expect(groups[1].rows.map(r => r.label)).toEqual(['Daily kcal (min)', 'Protein (g)'])
    expect(groups[2].rows.map(r => r.label)).toEqual(['Calories (kcal)', 'Amount'])
    expect(groups[3].rows[0].rule).toBe('Estagnação 2-3 semanas')
  })
})

describe('fmtValue', () => {
  it('mostra vazio, numero com virgula e objeto como texto', () => {
    expect(fmtValue(null, '-')).toBe('-')
    expect(fmtValue(47.4, '-')).toBe('47,4')
    expect(fmtValue('12-20', '-')).toBe('12-20')
    expect(fmtValue({ a: 1 }, '-')).toBe('{"a":1}')
  })
})
