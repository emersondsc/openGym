import { describe, expect, it } from 'vitest'
import { minutesLeft } from './coach-link-time.js'

describe('validade do código de ligação', () => {
  const agora = Date.parse('2026-11-06T12:00:00Z')
  it('arredonda para cima e nunca fica negativo', () => {
    expect(minutesLeft('2026-11-06T12:10:00Z', agora)).toBe(10)
    expect(minutesLeft('2026-11-06T12:00:30Z', agora)).toBe(1)
    expect(minutesLeft('2026-11-06T11:59:00Z', agora)).toBe(0)
  })
})
