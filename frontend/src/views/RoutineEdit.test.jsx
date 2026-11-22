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
  useUI: Object.assign(sel => sel({ toast: () => {}, openSheet: () => {} }), {
    getState: () => ({ toast: () => {}, openSheet: () => {} }),
  }),
}))

const { setLang } = await import('../lib/i18n.js')
const { default: RoutineEdit } = await import('./RoutineEdit.jsx')

const renderRoutine = (id = 'r1') => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/plan/r/${id}`]}>
    <Routes>
      <Route path="/plan/r/:id" element={<RoutineEdit />} />
    </Routes>
  </MemoryRouter>
)

afterAll(async () => {
  await setLang('en')
})

describe('RoutineEdit view', () => {
  beforeEach(async () => {
    await setLang('pt')
    mockS = {
      unit: 'kg',
      globalRestSec: 90,
      body: 'male',
      customSetRoles: [],
      routines: [
        {
          id: 'r1',
          name: 'Leg Day',
          emoji: 'legs',
          folder: 'Hipertrofia',
          fav: true,
          ex: [
            { id: '0043', sets: 4, reps: 8 },
            { id: '0602', sets: 3, reps: '8-12', weight: 160 },
          ],
        },
      ],
      week: {},
      dayPlan: {},
    }
  })

  it('renders header with favourite button, Folder row, Exercises header, BodyMap and footer actions', () => {
    const html = renderRoutine('r1')
    expect(html).toContain('Leg Day')
    expect(html).toContain('Remover dos favoritos')
    expect(html).toContain('Pasta')
    expect(html).toContain('Hipertrofia')
    expect(html).toContain('Exercícios')
    expect(html).toContain('Adicionar exercício')
    expect(html).toContain('O que esta sessão trabalha')
    expect(html).toContain('Copiar rotina')
    expect(html).toContain('Enviar para um amigo')
    expect(html).toContain('Imprimir / Salvar como PDF')
    expect(html).toContain('Excluir rotina')
    expect(html).not.toContain('Linear progression')
    expect(html).not.toContain('Deload routine')
  })
})
