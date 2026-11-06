import { describe, expect, it } from 'vitest'
import { cardItems, savedFromChat } from './proposal-card.js'

const agora = Date.parse('2026-11-06T12:00:00Z')
const p = (id, status, extra = {}) => ({ id, status, title: id, ...extra })

describe('cartão de propostas', () => {
  it('mostra abertas e as gravadas pelo chat nos últimos 3 dias', () => {
    const lista = [
      p('aberta', 'pending'),
      p('auto-nova', 'applied', { mode: 'auto', decided_at: '2026-11-06T10:00:00Z' }),
      p('auto-velha', 'applied', { mode: 'auto', decided_at: '2026-11-02T10:00:00Z' }),
      p('passkey', 'applied', { mode: 'passkey', decided_at: '2026-11-06T10:00:00Z' }),
      p('recusada', 'rejected')
    ]
    expect(cardItems(lista, agora).map(x => x.id)).toEqual(['aberta', 'auto-nova'])
  })
  it('sem nada aberto nem recente, o cartão some', () => {
    expect(cardItems([p('x', 'expired')], agora)).toEqual([])
    expect(cardItems(null, agora)).toEqual([])
  })
  it('só aplicada com mode auto conta como gravada pelo chat', () => {
    expect(savedFromChat(p('a', 'applied', { mode: 'auto' }))).toBe(true)
    expect(savedFromChat(p('a', 'applied', { mode: 'passkey' }))).toBe(false)
    expect(savedFromChat(p('a', 'pending', { mode: 'auto' }))).toBe(false)
  })
})
