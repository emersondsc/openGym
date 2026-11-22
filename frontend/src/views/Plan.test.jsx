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

  it('renders Schedule/Routines toggle, How you train, multi-routine days, Mesocycle and Diet without Coach or Weekly muscle volume', () => {
    const html = renderPlan()
    expect(html).toContain('Cronograma')
    expect(html).toContain('Rotinas')
    expect(html).toContain('Como você treina')
    expect(html).toContain('Semana fixa')
    expect(html).toContain('Rotação')
    expect(html).toContain('Push Day + Pull Day')
    expect(html).toContain('Dia de descanso')
    expect(html).toContain('Mesociclo')
    expect(html).toContain('Dieta')
    expect(html).not.toContain('Coach')
    expect(html).not.toContain('Weekly muscle volume')
    expect(html).not.toContain('Volume muscular semanal')
  })

  it('renders Rotation loop mode with progress and Also on fixed days', () => {
    mockS.scheduleMode = 'rotation'
    mockS.rotation = [{ id: 's1', rid: 'r1', done: false }]
    mockS.week = { 1: 'r1', 3: 'r2' }
    const html = renderPlan()
    expect(html).toContain('A sequência')
    expect(html).toContain('Próxima')
    expect(html).toContain('0 de 1 concluídas neste ciclo.')
    expect(html).toContain('Também em dias fixos')
    expect(html).toContain('Pull Day')
  })
})
