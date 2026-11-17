import { describe, it, expect, beforeEach } from 'vitest'
import {
  DIET_LOCAL_KEY,
  emptyDietStore,
  normalizeDietStore,
  sampleDietPlans,
  createDemoDietStore,
  loadLocalDiet,
  saveLocalDietPlan,
  activateLocalDietPlan,
  deleteLocalDietPlan,
  fetchDiet,
  putDietPlan,
  activateDietPlan,
  deleteDietPlan,
  makeDietId,
  formatRangeOrNumber,
  summarizeDietPlan
} from './diet.js'

function makeStorage() {
  const map = new Map()
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  }
}

describe('diet normalization and local fallback', () => {
  let storage

  beforeEach(() => {
    storage = makeStorage()
  })

  it('returns empty store for non-demo fresh storage and seeded store for demo', () => {
    const guestStore = loadLocalDiet(storage, { demo: false })
    expect(guestStore).toEqual(emptyDietStore())

    const demoStore = loadLocalDiet(storage, { demo: true })
    expect(demoStore).toMatchObject({
      rev: 1,
      activePlanId: 'diet-2026-11-14',
      prevPlanId: 'diet-2026-10-01'
    })
    expect(demoStore.plans).toHaveLength(2)
    expect(JSON.parse(storage.getItem(DIET_LOCAL_KEY)).activePlanId).toBe('diet-2026-11-14')
  })

  it('normalizes invalid payloads and clears dangling pointers', () => {
    expect(normalizeDietStore(null)).toEqual(emptyDietStore())
    expect(normalizeDietStore('bad')).toEqual(emptyDietStore())

    storage.setItem(DIET_LOCAL_KEY, '{not-valid-json')
    expect(loadLocalDiet(storage, { demo: false })).toEqual(emptyDietStore())

    storage.setItem(DIET_LOCAL_KEY, JSON.stringify({
      rev: 5,
      _ts: 123,
      activePlanId: 'missing-id',
      prevPlanId: 'also-missing',
      plans: [{ id: 'p1', name: 'Custom' }]
    }))
    const fixed = loadLocalDiet(storage, { demo: false })
    expect(fixed.activePlanId).toBe(null)
    expect(fixed.prevPlanId).toBe(null)
    expect(fixed.plans).toHaveLength(1)
  })

  it('saves, updates, activates, and deletes plans locally', () => {
    loadLocalDiet(storage, { demo: true })

    const created = saveLocalDietPlan({
      id: 'diet-bulk',
      name: 'Superávit Limpo',
      targets: { dailyKcal: 3000, macros: { proteinG: 165, carbsG: 370, fatG: 85 } }
    }, { activate: 'now', demo: false }, storage)

    expect(created.rev).toBe(2)
    expect(created.activePlanId).toBe('diet-bulk')
    expect(created.prevPlanId).toBe('diet-2026-11-14')
    expect(created.plans).toHaveLength(3)

    const updated = saveLocalDietPlan({
      id: 'diet-bulk',
      name: 'Superávit Limpo v2',
      targets: { dailyKcal: 3050, macros: { proteinG: 170, carbsG: 380, fatG: 85 } }
    }, { demo: false }, storage)
    expect(updated.rev).toBe(3)
    expect(updated.plans.find(p => p.id === 'diet-bulk').name).toBe('Superávit Limpo v2')
    expect(updated.activePlanId).toBe('diet-bulk')

    const switched = activateLocalDietPlan('diet-2026-10-01', storage, { demo: false })
    expect(switched.activePlanId).toBe('diet-2026-10-01')
    expect(switched.prevPlanId).toBe('diet-bulk')
    expect(switched.rev).toBe(4)

    const noop = activateLocalDietPlan('diet-2026-10-01', storage, { demo: false })
    expect(noop.rev).toBe(4)

    const afterDelete = deleteLocalDietPlan('diet-2026-10-01', storage, { demo: false })
    expect(afterDelete.activePlanId).toBe(null)
    expect(afterDelete.plans).toHaveLength(2)
    expect(afterDelete.rev).toBe(5)
  })

  it('rejects missing plan object or empty name', () => {
    expect(() => saveLocalDietPlan(null, {}, storage)).toThrow()
    expect(() => saveLocalDietPlan({ name: '   ' }, {}, storage)).toThrow()
  })
})

describe('/api/diet HTTP client helpers', () => {
  it('calls GET, PUT, POST activate and DELETE with If-Match headers', async () => {
    const calls = []
    const fakeCall = async (path, opts) => {
      calls.push({ path, opts })
      if (path === '/api/diet' && !opts) {
        return { rev: 3, activePlanId: 'p1', prevPlanId: 'missing', plans: [{ id: 'p1', name: 'Cut' }] }
      }
      return { ok: true, rev: 4 }
    }

    const fetched = await fetchDiet(fakeCall)
    expect(fetched).toMatchObject({ rev: 3, activePlanId: 'p1', prevPlanId: null })

    const plan = { id: 'p2', name: 'Manutenção' }
    await putDietPlan(plan, { activate: 'now', rev: 3 }, fakeCall)
    await activateDietPlan('plan/special id', 4, fakeCall)
    await deleteDietPlan('p2', 5, fakeCall)

    expect(calls[0]).toEqual({ path: '/api/diet', opts: undefined })
    expect(calls[1]).toEqual({
      path: '/api/diet',
      opts: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': '3' },
        body: JSON.stringify({ plan, activate: 'now' })
      }
    })
    expect(calls[2]).toEqual({
      path: '/api/diet/plan%2Fspecial%20id/activate',
      opts: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'If-Match': '4' },
        body: '{}'
      }
    })
    expect(calls[3]).toEqual({
      path: '/api/diet/p2',
      opts: {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'If-Match': '5' }
      }
    })
  })
})

describe('diet formatting & helpers', () => {
  it('generates valid API-safe diet IDs', () => {
    const id = makeDietId('Hipertrofia & Definição!', '2026-11-16')
    expect(id).toMatch(/^diet-2026-11-16-hipertrofia-definicao$/)
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)

    const fallback = makeDietId('!!!', 'invalid-date')
    expect(fallback).toMatch(/^diet-\d{4}-\d{2}-\d{2}-[a-z0-9]+$/)
  })

  it('formats range and scalar targets cleanly', () => {
    const samples = sampleDietPlans()
    expect(createDemoDietStore().plans).toHaveLength(2)

    expect(summarizeDietPlan(samples[0])).toEqual({
      kcal: '2200–2300 kcal',
      protein: '150g',
      carbs: '200g',
      fat: '70–75g',
      fiber: '30g',
      deficit: '400–500 kcal',
      mealCount: 4,
      macrosLine: '150g P · 200g C · 70–75g F',
      summaryLine: '2200–2300 kcal · 150g P · 200g C · 70–75g F'
    })

    expect(formatRangeOrNumber({ min: 2000, max: 2000 }, ' kcal')).toBe('2000 kcal')
    expect(summarizeDietPlan(null).summaryLine).toBe('')
    const s = summarizeDietPlan({
      targets: { dailyKcalMin: 2100, dailyKcalMax: 2200, macros: { proteinG: 140 } }
    })
    expect(s.kcal).toBe('2100–2200 kcal')
    expect(s.macrosLine).toBe('140g P')
  })
})
