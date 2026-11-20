import { describe, it, expect } from 'vitest'
import { shellMode, initialDraft, applyDraft, summaryOf, finishSetup, STEPS } from './setup.js'

describe('pré-início: shellMode', () => {
  it('sem sessão e antes do boot: carregamento, não login', () => {
    expect(shellMode({ authed: false, ready: false, setupPending: false })).toBe('loading')
    expect(shellMode({ authed: false, ready: true, setupPending: false })).toBe('login')
  })
  it('pendente antes do boot: carregamento, nunca setup nem app', () => {
    expect(shellMode({ authed: true, ready: false, setupPending: true })).toBe('loading')
    expect(shellMode({ authed: true, ready: true, setupPending: true })).toBe('setup')
  })
  it('sem marcador: app, com ou sem ready', () => {
    expect(shellMode({ authed: true, ready: true, setupPending: false })).toBe('app')
    expect(shellMode({ authed: true, ready: false, setupPending: false })).toBe('app')
  })
})

describe('pré-início: rascunho', () => {
  it('a ordem das etapas é sexo, idioma, unidade, estilo', () => {
    expect(STEPS).toEqual(['body', 'lang', 'unit', 'skin'])
  })
  it('usa a escolha de idioma do login e normaliza valores estranhos', () => {
    expect(initialDraft({ lang: 'en', langChosen: true, body: 'x', unit: 'kg', skin: 'nope' }))
      .toEqual({ body: 'male', lang: 'en', unit: 'kg', skin: 'classic' })
    expect(initialDraft({ body: 'female', unit: 'lb', skin: 'paper' }))
      .toEqual({ body: 'female', lang: 'pt', unit: 'lb', skin: 'paper' })
  })
  it('applyDraft grava as escolhas e não toca em treinos', () => {
    const s = { workouts: [1], routines: [2], exWeights: { a: 1 }, skinIntro: false, langChosen: false }
    applyDraft(s, { body: 'female', lang: 'en', unit: 'lb', skin: 'paper' })
    expect(s).toEqual({ workouts: [1], routines: [2], exWeights: { a: 1 }, body: 'female', lang: 'en',
      langChosen: true, unit: 'lb', skin: 'paper', skinIntro: true })
  })
  it('summaryOf junta as 4 partes na ordem', () => {
    const out = summaryOf({ body: 'female', lang: 'en', unit: 'lb', skin: 'paper' })
    const parts = out.split(' · ')
    expect(parts.length).toBe(4)
    expect(parts[1]).toBe('English')
    expect(parts[3]).toBe('Paper')
  })
})

describe('pré-início: finishSetup', () => {
  const draft = { body: 'female', lang: 'en', unit: 'lb', skin: 'paper' }
  const deps = over => {
    const calls = []
    return {
      calls,
      update: (fn, push) => { calls.push(['update', push]); fn({}) },
      pushState: async () => { calls.push(['push']); return { ok: true } },
      api: async path => { calls.push(['api', path]); return { user: { id: 'u', setupPending: false } } },
      ...over,
    }
  }
  it('grava sem agendar envio, envia e só então limpa o marcador', async () => {
    const d = deps()
    const user = await finishSetup(d, draft)
    expect(user).toEqual({ id: 'u', setupPending: false })
    expect(d.calls).toEqual([['update', false], ['push'], ['api', '/api/me/setup-done']])
  })
  it('não chama o endpoint se o estado não foi enviado', async () => {
    const d = deps({ pushState: async () => ({ ok: false }) })
    await expect(finishSetup(d, draft)).rejects.toMatchObject({ step: 'state' })
    expect(d.calls.some(c => c[0] === 'api')).toBe(false)
  })
  it('falha no endpoint marca step marker, e a segunda tentativa termina', async () => {
    let n = 0
    const d = deps({ api: async () => { if (n++ === 0) throw new Error('HTTP 500'); return { user: { id: 'u' } } } })
    await expect(finishSetup(d, draft)).rejects.toMatchObject({ step: 'marker' })
    await expect(finishSetup(d, draft)).resolves.toEqual({ id: 'u' })
  })
})
