import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

let mockS = { gifSize: 'full', gifSizeChosen: true }
vi.mock('../store/useStore.js', () => ({
  useStore: sel => sel({ S: mockS, update: () => {} })
}))

const { default: Media, Thumb } = await import('./Media.jsx')
const { EXIDX } = await import('../lib/exercises.js')
const { musclesOf } = await import('../lib/muscles.js')

describe('Media & Thumb com catálogo 5632 (.webp / .mp4)', () => {
  beforeEach(() => {
    mockS = { gifSize: 'full', gifSizeChosen: true }
  })

  it('renderiza <video> para animações .mp4 e <img> .webp para Thumb', () => {
    const ex = EXIDX['10189']
    expect(ex).toBeTruthy()
    expect(ex.img).toBe('10189.webp')
    expect(ex.gif).toBe('10189.mp4')

    const mediaHtml = renderToStaticMarkup(<Media ex={ex} />)
    expect(mediaHtml).toContain('<video')
    expect(mediaHtml).toContain('src="exercise-media/clip/10189.mp4"')
    expect(mediaHtml).toContain('loop=""')
    expect(mediaHtml).toContain('playsInline=""')

    const thumbHtml = renderToStaticMarkup(<Thumb ex={ex} />)
    expect(thumbHtml).toContain('<img')
    expect(thumbHtml).toContain('src="exercise-media/still/10189.webp"')
  })

  it('mantém fallback para <img> quando gif for .gif', () => {
    const html = renderToStaticMarkup(<Media ex={{ id: 'c1', n: 'Custom', img: 'a.jpg', gif: 'a.gif' }} />)
    expect(html).toContain('<img')
    expect(html).toContain('src="exercise-media/clip/a.gif"')
  })

  it('mapeia novos alvos e full body em musclesOf', () => {
    expect(musclesOf({ tg: 'front delts', sm: [] })).toEqual({ deltoids: 1 })
    expect(musclesOf({ tg: 'side delts', sm: [] })).toEqual({ deltoids: 1 })
    expect(musclesOf({ tg: 'rear delts', sm: [] })).toEqual({ deltoids: 1 })
    const fb = musclesOf({ bp: 'full body', tg: 'cardiovascular system', sm: [] })
    expect(Object.keys(fb).length).toBeGreaterThan(0)
  })
})
