import { describe, it, expect } from 'vitest'
import { SKINS, skinOf, resolveSkin } from './format.js'

describe('resolveSkin', () => {
  it('classic obedece ao tema e mantem a cor escolhida', () => {
    expect(resolveSkin('classic', 'dark', 'teal')).toEqual({ skin: 'classic', mode: 'dark', accent: 'teal', chrome: '#000000' })
    expect(resolveSkin('classic', 'light', 'teal')).toEqual({ skin: 'classic', mode: 'light', accent: 'teal', chrome: '#f2f2f7' })
  })

  it('paper fixa o modo claro mesmo com theme dark e tira a cor do usuario', () => {
    expect(resolveSkin('paper', 'dark', 'teal')).toEqual({ skin: 'paper', mode: 'light', accent: null, chrome: '#f4f0e6' })
  })

  it('estilo desconhecido cai no classic', () => {
    expect(resolveSkin('grind', 'dark', 'teal')).toEqual(resolveSkin('classic', 'dark', 'teal'))
    expect(resolveSkin(undefined, 'dark', 'teal').skin).toBe('classic')
  })

  it('cor desconhecida cai no lime, como o applyPrefs fazia', () => {
    expect(resolveSkin('classic', 'dark', 'roxo').accent).toBe('lime')
  })

  it('todo estilo tem descricao, chrome do modo que fixa e nota quando esconde controle', () => {
    for (const [k, sk] of Object.entries(SKINS)) {
      expect(sk.subtitle, k).toBeTruthy()
      expect(sk.chrome[sk.mode || 'dark'], k).toBeTruthy()
      if (sk.mode || sk.ownAccent) expect(sk.note, k).toBeTruthy()
    }
    expect(skinOf('paper')).toBe(SKINS.paper)
  })
})
