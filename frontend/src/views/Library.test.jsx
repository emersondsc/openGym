import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const baseState = () => ({
  unit: 'kg', body: 'male', bodyweight: [], routines: [], week: {}, dayPlan: {},
  workouts: [], active: null, activities: {}, customEx: [], exWeights: {},
})

vi.mock('../store/useStore.js', () => ({
  useStore: Object.assign(sel => sel({ S: baseState(), user: null, update: () => {} }), {
    getState: () => ({ S: baseState(), user: null, update: () => {} }),
  }),
  isValidRest: () => true,
}))
vi.mock('../store/useUI.js', () => ({
  useUI: Object.assign(sel => sel({ toast: () => {}, openSheet: () => {} }), {
    getState: () => ({ toast: () => {}, openSheet: () => {} }),
  }),
}))

const { setLang } = await import('../lib/i18n.js')
const { default: Library } = await import('./Library.jsx')

afterAll(async () => {
  await setLang('en')
})

describe('Library — botão de adicionar ao plano', () => {
  beforeEach(async () => {
    await setLang('pt')
  })

  it('mostra apenas o símbolo de + nos botões das linhas de exercício', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Library /></MemoryRouter>)
    expect(html).toContain('aria-label="Adicionar ao meu plano"')
    expect(html).not.toContain('<span>Plano</span>')
  })
})
