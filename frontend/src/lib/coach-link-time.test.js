import { describe, expect, it } from 'vitest'
import { coachStage, errorText, minutesLeft } from './coach-link-time.js'

describe('validade do código de ligação', () => {
  const agora = Date.parse('2026-11-06T12:00:00Z')
  it('arredonda para cima e nunca fica negativo', () => {
    expect(minutesLeft('2026-11-06T12:10:00Z', agora)).toBe(10)
    expect(minutesLeft('2026-11-06T12:00:30Z', agora)).toBe(1)
    expect(minutesLeft('2026-11-06T11:59:00Z', agora)).toBe(0)
  })
})

describe('passo da tela do treinador no chat', () => {
  const codigo = { code: 'K7M4-Q2XP' }
  it('convidado: ativar, depois código, depois ligado', () => {
    expect(coachStage(undefined, null)).toBe('loading')
    expect(coachStage(null, null)).toBe('activate')
    expect(coachStage({ linked: null, allowed: null, owner: false }, null)).toBe('activate')
    expect(coachStage({ linked: null, allowed: { email: 'a@b.co' }, owner: false }, codigo)).toBe('code')
    expect(coachStage({ linked: null, allowed: { email: 'a@b.co' }, owner: false }, null)).toBe('ready')
    expect(coachStage({ linked: { email: 'a@b.co' }, allowed: { email: 'a@b.co' } }, codigo)).toBe('linked')
  })
  it('o dono não precisa ativar e-mail', () => {
    expect(coachStage({ linked: null, allowed: null, owner: true }, null)).toBe('ready')
  })
})

describe('mensagens de erro da ativação', () => {
  const t = s => `pt:${s}`
  it('código conhecido vira texto traduzido; o resto usa a mensagem da API', () => {
    expect(errorText({ code: 'EMAIL_IN_USE' }, t)).toBe('pt:This e-mail is already used by another account.')
    expect(errorText({ message: 'boom' }, t)).toBe('boom')
    expect(errorText(null, t)).toBe('pt:Could not load')
  })
})
