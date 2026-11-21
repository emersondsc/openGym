import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

let mockS = {}
let mockUser = null
const useStoreMock = Object.assign(sel => sel({ S: mockS, user: mockUser, update: () => {} }), {
  getState: () => ({ S: mockS, user: mockUser, update: () => {} }),
})
vi.mock('../store/useStore.js', () => ({
  useStore: useStoreMock,
  isValidRest: () => true,
  DEF: { reminder: { on: false, time: '08:00', tz: null } },
  hasData: () => false,
}))
vi.mock('../store/useUI.js', () => ({
  useUI: Object.assign(sel => sel({ toast: () => {}, openSheet: () => {} }), {
    getState: () => ({ toast: () => {}, openSheet: () => {} }),
  }),
}))

const { setLang } = await import('../lib/i18n.js')
const { todayISO } = await import('../lib/format.js')
const { default: Home } = await import('./Home.jsx')

const baseState = (over = {}) => ({
  unit: 'kg', body: 'male', bodyweight: [], routines: [], week: {}, dayPlan: {},
  workouts: [], active: null, activities: {}, hiddenCards: { home: {}, stats: {} },
  exWeights: {}, customSetRoles: [], ...over,
})
const renderHome = () => renderToStaticMarkup(<MemoryRouter><Home /></MemoryRouter>)

afterAll(async () => {
  await setLang('en')
})

describe('Home — esconder cards', () => {
  beforeEach(async () => {
    await setLang('pt')
    mockUser = null
    mockS = baseState()
  })

  it('mostra botões de ocultar nos cards ocultáveis e mantém card Hoje/Semana sempre visível', () => {
    const html = renderHome()
    expect(html).toContain('Hoje')
    expect(html).toContain('Ocultar Bem-vindo!')
    expect(html).toContain('Ocultar Sequência semanal')
    expect(html).toContain('Ocultar Volume semanal')
    expect(html).toContain('Ocultar Progresso por exercício')
  })

  it('oculta os cards marcados em hiddenCards.home sem esconder o card Hoje/Semana', () => {
    mockS = baseState({
      hiddenCards: {
        home: { welcome: true, streak: true, volume: true, exercise: true },
        stats: {},
      },
    })
    const html = renderHome()
    expect(html).toContain('Hoje')
    expect(html).not.toContain('Bem-vindo!')
    expect(html).not.toContain('sequência de 0 semanas')
    expect(html).not.toContain('Volume semanal')
    expect(html).not.toContain('Progresso por exercício')
    expect(html).toContain('Registrar corrida')
  })

  it('mostra atalho de corrida na Home com gif de corrida, km da semana ou resumo da última corrida', () => {
    const emptyHtml = renderHome()
    expect(emptyHtml).toContain('Ao ar livre ou esteira')
    expect(emptyHtml).toContain('exercise-media/clip/0685.mp4')

    mockS = baseState({
      activities: {
        r1: { d: todayISO(), sport: 'run', km: 5.2, sec: 1721, min: 29, place: 'outdoor', src: 'manual', _ts: 100 },
      },
    })
    const withWeekRun = renderHome()
    expect(withWeekRun).toContain('Registrar corrida')
    expect(withWeekRun).toContain('5,2 km esta semana')

    mockS = baseState({
      activities: {
        r2: { d: '2020-01-10', sport: 'run', km: 10, sec: 3000, min: 50, place: 'treadmill', src: 'manual', _ts: 100 },
      },
    })
    const withOldRun = renderHome()
    expect(withOldRun).toContain('Última: 10 km · 5:00/km')
  })
})
