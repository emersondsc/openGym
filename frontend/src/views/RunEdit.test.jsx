import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

let mockS = {}
const useStoreMock = Object.assign(sel => sel({ S: mockS, user: null, update: () => {} }), {
  getState: () => ({ S: mockS, user: null, update: () => {} }),
})
vi.mock('../store/useStore.js', () => ({
  useStore: useStoreMock,
  isValidRest: () => true,
}))
vi.mock('../store/useUI.js', () => ({
  useUI: Object.assign(
    sel => sel({ toast: () => {}, openSheet: () => {}, closeAll: () => {}, setLeaveGuard: () => {} }),
    { getState: () => ({ toast: () => {}, openSheet: () => {}, closeAll: () => {}, setLeaveGuard: () => {} }) }
  ),
}))

const { setLang } = await import('../lib/i18n.js')
const { todayISO } = await import('../lib/format.js')
const { default: RunEdit, formatKmInput, yesterdayISO, rpeEffortKey } = await import('./RunEdit.jsx')

const baseState = (over = {}) => ({
  unit: 'kg', body: 'male', bodyweight: [], routines: [], week: {}, dayPlan: {},
  workouts: [], active: null, activities: {}, hiddenCards: { home: {}, stats: {} },
  exWeights: {}, customSetRoles: [], ...over,
})

const renderRoute = entry => renderToStaticMarkup(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/run/new" element={<RunEdit />} />
      <Route path="/run/:id" element={<RunEdit />} />
    </Routes>
  </MemoryRouter>
)

afterAll(async () => {
  await setLang('en')
})

describe('RunEdit — helpers e tela dedicada', () => {
  beforeEach(async () => {
    await setLang('pt')
    mockS = baseState()
  })

  it('formatKmInput preserva até 2 casas decimais no idioma ativo', async () => {
    await setLang('pt')
    expect(formatKmInput(5.25)).toBe('5,25')
    expect(formatKmInput(21.1)).toBe('21,1')
    expect(formatKmInput(5)).toBe('5')

    await setLang('en')
    expect(formatKmInput(5.25)).toBe('5.25')
  })

  it('yesterdayISO volta exatamente 1 dia e rpeEffortKey cobre faixas 1–10', () => {
    expect(yesterdayISO('2026-03-01')).toBe('2026-02-28')
    expect(rpeEffortKey(1)).toBe('Very easy')
    expect(rpeEffortKey(4)).toBe('Easy')
    expect(rpeEffortKey(6)).toBe('Moderate')
    expect(rpeEffortKey(8)).toBe('Hard effort')
    expect(rpeEffortKey(10)).toBe('Max effort')
  })

  it('renderiza criação (/run/new) com ritmo hero, chips de data, presets e mais detalhes recolhido', () => {
    const html = renderRoute('/run/new')
    expect(html).toContain('Registrar corrida')
    expect(html).toContain('Ritmo')
    expect(html).toContain('Informe distância e tempo para ver seu ritmo')
    expect(html).toContain('Ao ar livre')
    expect(html).toContain('Esteira')
    expect(html).toContain('Hoje')
    expect(html).toContain('Ontem')
    expect(html).toContain('Outra data')
    expect(html).toContain('Distância')
    expect(html).toContain('Tempo em movimento')
    expect(html).toContain('3 km')
    expect(html).toContain('5 km')
    expect(html).toContain('10 km')
    expect(html).toContain('21,1 km')
    expect(html).toContain('Mais detalhes')
    expect(html).toContain('Elevação, FC, esforço e nota')
    expect(html).toContain('0685-oLrKqDH.gif')
    expect(html).not.toContain('FC média')
  })

  it('pré-seleciona outra data quando aberto com ?day=AAAA-MM-DD', () => {
    const html = renderRoute('/run/new?day=2026-11-18')
    expect(html).toContain('18 de nov.')
    expect(html).not.toContain('>Outra data<')
  })

  it('renderiza edição (/run/:id) com ritmo calculado, 2 casas decimais e detalhes expandidos', () => {
    mockS = baseState({
      activities: {
        r1: {
          d: todayISO(), sport: 'run', km: 5.25, sec: 1721, min: 29,
          place: 'outdoor', elev: 48, hrAvg: 152, hrMax: 178, rpe: 7, note: 'Ritmo bom',
          src: 'manual', _ts: 100,
        },
      },
    })
    const html = renderRoute('/run/r1')
    expect(html).toContain('Editar corrida')
    expect(html).toContain('5:28')
    expect(html).toContain('value="5,25"')
    expect(html).toContain('value="28:41"')
    expect(html).toContain('FC média')
    expect(html).toContain('FC máxima')
    expect(html).toContain('Ganho de elevação')
    expect(html).toContain('Esforço percebido')
    expect(html).toContain('7/10 · Forte')
    expect(html).toContain('Ritmo bom')
    expect(html).toContain('Excluir')
  })

  it('mantém ganho de elevação disponível quando a corrida é na esteira', () => {
    mockS = baseState({
      activities: {
        r2: {
          d: todayISO(), sport: 'run', km: 3, sec: 1200, min: 20,
          place: 'treadmill', elev: 120, hrAvg: 145, src: 'manual', _ts: 100,
        },
      },
    })
    const html = renderRoute('/run/r2')
    expect(html).toContain('Esteira')
    expect(html).toContain('0684-y5p0H8a.gif')
    expect(html).toContain('FC média')
    expect(html).toContain('Ganho de elevação')
    expect(html).toContain('value="120"')
  })
})
