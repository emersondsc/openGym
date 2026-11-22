import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

let mockS = {}
const useStoreMock = Object.assign(sel => sel({ S: mockS, user: null, update: () => {} }), {
  getState: () => ({ S: mockS, user: null, update: () => {} }),
})
vi.mock('../store/useStore.js', () => ({
  useStore: useStoreMock,
  isValidRest: () => true,
}))
vi.mock('../store/useDiet.js', () => ({
  useDiet: () => ({ store: { plans: [], activePlanId: null }, load: async () => {}, activatePlan: async () => ({}) }),
}))
vi.mock('../store/useUI.js', () => ({
  useUI: Object.assign(sel => sel({ toast: () => {}, openSheet: () => {} }), {
    getState: () => ({ toast: () => {}, openSheet: () => {} }),
  }),
}))

const { setLang } = await import('../lib/i18n.js')
const { default: Plan } = await import('./Plan.jsx')

const renderPlan = () => renderToStaticMarkup(<MemoryRouter><Plan /></MemoryRouter>)

afterAll(async () => {
  await setLang('en')
})

describe('Plan view', () => {
  beforeEach(async () => {
    await setLang('pt')
    mockS = {
      body: 'male',
      routines: [
        { id: 'r1', name: 'Push Day', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3 }] },
        { id: 'r2', name: 'Pull Day', emoji: 'pullup', ex: [{ id: '0027', sets: 3 }] },
      ],
      week: { 1: ['r1', 'r2'] },
      weekMode: { 1: 'together' },
      scheduleMode: 'fixed',
      rotation: [],
      mesos: [],
      activeMeso: null,
    }
  })

  it('defaults to Routines on the left and omits Coach and Weekly muscle volume', () => {
    const html = renderPlan()
    expect(html).toContain('Rotinas')
    expect(html).toContain('Cronograma')
    expect(html.indexOf('Rotinas')).toBeLessThan(html.indexOf('Cronograma'))
    expect(html).toContain('Editar')
    expect(html).toContain('Nova rotina')
    expect(html).toContain('Push Day')
    expect(html).toContain('1 exercício · Se')
    expect(html).not.toContain('Coach')
    expect(html).not.toContain('Weekly muscle volume')
    expect(html).not.toContain('Volume muscular semanal')
  })

  it('renders Schedule tab (Fixed Week and Rotation) with Mesocycle and Diet when selected', () => {
    const prevStorage = globalThis.localStorage
    globalThis.localStorage = { getItem: k => (k === 'gym_plan_tab_v2' ? 'schedule' : null) }
    try {
      const fixedHtml = renderPlan()
      expect(fixedHtml).toContain('Como você treina')
      expect(fixedHtml).toContain('Semana fixa')
      expect(fixedHtml).toContain('Push Day + Pull Day')
      expect(fixedHtml).toContain('Dia de descanso')
      expect(fixedHtml).toContain('Mesociclo')
      expect(fixedHtml).toContain('Dieta')

      mockS.scheduleMode = 'rotation'
      mockS.rotation = [{ id: 's1', rid: 'r1', done: false }]
      mockS.week = { 1: 'r1', 3: 'r2' }
      const rotHtml = renderPlan()
      expect(rotHtml).toContain('A sequência')
      expect(rotHtml).toContain('Próxima')
      expect(rotHtml).toContain('0 de 1 concluídas neste ciclo.')
      expect(rotHtml).toContain('Também em dias fixos')
      expect(rotHtml).toContain('Pull Day')
    } finally {
      globalThis.localStorage = prevStorage
    }
  })
})
