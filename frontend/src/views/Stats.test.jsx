// Stats.jsx — corridas aparecem no bloco "Treinos recentes" e no total de "Todos N".
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
vi.mock('../store/useUI.js', () => ({
  useUI: Object.assign(sel => sel({ toast: () => {}, openSheet: () => {} }), {
    getState: () => ({ toast: () => {}, openSheet: () => {} }),
  }),
}))

const { setLang } = await import('../lib/i18n.js')
const { todayISO } = await import('../lib/format.js')
const { default: Stats } = await import('./Stats.jsx')
const { default: History } = await import('./History.jsx')

const baseState = (over = {}) => ({
  unit: 'kg', body: 'male', bodyweight: [], routines: [], workouts: [], activities: {},
  targetW: null, effort: null, exWeights: {}, customSetRoles: [], ...over,
})
const renderStats = () => renderToStaticMarkup(<MemoryRouter><Stats /></MemoryRouter>)
const renderHistory = () => renderToStaticMarkup(<MemoryRouter><History /></MemoryRouter>)

const workout = (id, d, start = 1000) => ({
  id, d, start, end: start + 1800000, routineId: null, name: `Treino ${id}`,
  entries: [], vol: 500, prs: [],
})
const run = (d, km = 5.2, sec = 1721, _ts = 100) => ({
  d, sport: 'run', km, sec, min: Math.round(sec / 60), place: 'outdoor', src: 'manual', _ts,
})

afterAll(async () => {
  await setLang('en')
})

describe('Stats — Treinos recentes com corridas', () => {
  beforeEach(async () => {
    await setLang('pt')
    mockS = baseState()
  })

  it('mostra corridas junto aos treinos no bloco Treinos recentes e no total, limitado a 6', () => {
    mockS = baseState({
      workouts: [1, 2, 3, 4, 5, 6].map(i => workout(`w${i}`, `2026-11-1${i}`)),
      activities: { r1: run('2026-11-21', 5.2, 1721) },
    })
    const html = renderStats()
    expect(html).toContain('Treinos recentes')
    expect(html).toContain('Todos 7')
    expect(html).toContain('Corrida')
    expect(html).toContain('5,2 km')
    expect(html).toContain('Treino w6')
    expect(html).not.toContain('Treino w1')
    expect(html.indexOf('Corrida')).toBeLessThan(html.indexOf('Treino w6'))
  })

  it('mantém a mesma ordem do Histórico no mesmo dia (treino antes de corrida)', () => {
    mockS = baseState({
      workouts: [workout('w1', '2026-11-21')],
      activities: { r1: run('2026-11-21', 5.2, 1721) },
    })
    const statsHtml = renderStats()
    const histList = renderHistory().slice(renderHistory().indexOf('<div class="list"'))
    expect(statsHtml.indexOf('<div class="tt">Treino w1</div>')).toBeLessThan(statsHtml.indexOf('<div class="tt">Corrida</div>'))
    expect(histList.indexOf('<div class="tt">Treino w1</div>')).toBeLessThan(histList.indexOf('<div class="tt">Corrida</div>'))
  })

  it('mostra Treinos recentes mesmo quando há só corridas e nenhum treino', () => {
    mockS = baseState({
      activities: { r1: run('2026-11-21', 3.0, 1200) },
    })
    const html = renderStats()
    expect(html).toContain('Treinos recentes')
    expect(html).toContain('Todos 1')
    expect(html).toContain('Corrida')
    expect(html).toContain('3 km')
  })

  it('oculta Treinos recentes quando não há treinos nem corridas (ou só corrida excluída)', () => {
    mockS = baseState({
      activities: { r1: { deleted: true, _ts: 10 } },
    })
    const html = renderStats()
    expect(html).not.toContain('Treinos recentes')
  })

  it('oculta cards individuais de Stats e ajusta o grid quando só Peso ou Exercício fica visível', () => {
    mockS = baseState({
      workouts: [workout('w1', '2026-11-21')],
      activities: { r1: run('2026-11-21') },
      hiddenCards: { home: {}, stats: { heatmap: true, recent: true, coach: true, muscles: true, weight: true } },
    })
    const html = renderStats()
    expect(html).not.toContain('Atividade — últimos 12 meses')
    expect(html).not.toContain('Treinos recentes')
    expect(html).not.toContain('Seu progresso')
    expect(html).not.toContain('Equilíbrio muscular')
    expect(html).not.toContain('Peso corporal')
    expect(html).toContain('Progresso por exercício')
    expect(html).not.toContain('class="cols"')
  })

  it('mostra aviso e botão de restaurar quando todos os cards de Stats estão ocultos', () => {
    mockS = baseState({
      hiddenCards: { home: {}, stats: { heatmap: true, recent: true, coach: true, muscles: true, effort: true, weight: true, exercise: true } },
    })
    const html = renderStats()
    expect(html).toContain('Todos os cards de Estatísticas estão ocultos.')
    expect(html).toContain('Mostrar todos os cards')
  })

  it('pinta o quadrado do mapa de atividades para dia com corrida e combina treino + corrida', () => {
    const today = todayISO()
    mockS = baseState({
      activities: { r1: run(today, 5.2, 1721) },
    })
    const runOnlyHtml = renderStats()
    expect(runOnlyHtml).toMatch(new RegExp(`class="hm-c l[1-4] today" title="${today} · 1 corrida · 29 min · 5,2 km"`))

    mockS = baseState({
      workouts: [workout('w1', today)],
      activities: { r1: run(today, 5.2, 1721) },
    })
    const bothHtml = renderStats()
    expect(bothHtml).toContain(`${today} · 1 treino · 1 corrida · 59 min · 500 kg · 5,2 km`)
  })
})
