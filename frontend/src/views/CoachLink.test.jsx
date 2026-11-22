import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

let mockGuest = false
vi.mock('../store/useStore.js', () => ({
  useStore: Object.assign(
    sel => sel({ isGuest: () => mockGuest }),
    { getState: () => ({ isGuest: () => mockGuest }) }
  )
}))
vi.mock('../store/useUI.js', () => ({
  useUI: Object.assign(sel => sel({ toast: () => {} }), {
    getState: () => ({ toast: () => {} })
  })
}))
vi.stubGlobal('navigator', { userAgent: '' })
vi.stubGlobal('window', {})

const { setLang } = await import('../lib/i18n.js')
const { default: CoachLink } = await import('./CoachLink.jsx')
const { default: Connect } = await import('./Connect.jsx')

afterAll(async () => {
  await setLang('en')
  vi.unstubAllGlobals()
})

describe('CoachLink e Connect — renderização PT-BR', () => {
  beforeEach(async () => {
    await setLang('pt')
    mockGuest = false
  })

  it('CoachLink renderiza sem erros no estado inicial', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CoachLink /></MemoryRouter>)
    expect(html).toContain('Treinador no chat')
  })

  it('Connect bloqueia modo demonstração e orienta login', () => {
    mockGuest = true
    const html = renderToStaticMarkup(<MemoryRouter><Connect /></MemoryRouter>)
    expect(html).toContain('É necessário entrar na conta')
    expect(html).toContain('O modo demonstração não pode autorizar um assistente')
  })
})
