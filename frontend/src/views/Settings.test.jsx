import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

let mockS = {}
const storeObj = () => ({
  S: mockS, user: null,
  update: () => {}, replaceState: () => {}, setUser: () => {},
  pullState: async () => {}, pushState: async () => {}, signOut: async () => {}, signOutAll: async () => {}, resetDemo: async () => {},
})
const useStoreMock = Object.assign(
  sel => (sel ? sel(storeObj()) : storeObj()),
  { getState: storeObj }
)
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
const { default: Settings } = await import('./Settings.jsx')

const baseState = (over = {}) => ({
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'pt', langChosen: true,
  theme: 'dark', accent: 'teal', skin: 'takt', body: 'male', targetW: null,
  bodyweight: [], routines: [{ id: 'r1', ex: [] }], week: {}, dayPlan: {},
  workouts: [], activities: {}, customSetRoles: [], hiddenCards: { home: {}, stats: {} },
  ...over,
})
const renderSettings = () => renderToStaticMarkup(<MemoryRouter><Settings /></MemoryRouter>)

afterAll(async () => {
  await setLang('en')
})

describe('Settings — seção Cards', () => {
  beforeEach(async () => {
    await setLang('pt')
    mockS = baseState()
  })

  it('mostra Todos visíveis quando nenhum card está oculto e oculta o atalho Mostrar todos os cards', () => {
    const html = renderSettings()
    expect(html).toContain('Cards')
    expect(html).toContain('Todos visíveis')
    expect(html).not.toContain('Mostrar todos os cards')
  })

  it('mostra contagem de cards ocultos por tela e opção Mostrar todos os cards', () => {
    mockS = baseState({
      hiddenCards: { home: { streak: true }, stats: { heatmap: true, weight: true } },
    })
    const html = renderSettings()
    expect(html).toContain('1 oculto')
    expect(html).toContain('2 ocultos')
    expect(html).toContain('Mostrar todos os cards')
  })
})
