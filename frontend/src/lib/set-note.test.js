import { describe, it, expect } from 'vitest'
import { NOTE_MAX, noteLength, normalizeNote, withNote, hasNote } from './set-note.js'

describe('set-note', () => {
  it('tira os espaços das pontas', () => {
    expect(normalizeNote('  ombro doeu \n')).toBe('ombro doeu')
  })
  it('texto vazio ou só espaços vira null', () => {
    expect(normalizeNote('')).toBe(null)
    expect(normalizeNote('   \n ')).toBe(null)
    expect(normalizeNote(undefined)).toBe(null)
  })
  it('corta em NOTE_MAX pontos de código', () => {
    expect(noteLength(normalizeNote('a'.repeat(NOTE_MAX + 1)))).toBe(NOTE_MAX)
    expect(normalizeNote('a'.repeat(NOTE_MAX))).toBe('a'.repeat(NOTE_MAX))
  })
  it('um emoji conta como 1', () => {
    expect(noteLength('💪')).toBe(1)
    expect(noteLength(normalizeNote('💪'.repeat(NOTE_MAX + 5)))).toBe(NOTE_MAX)
  })
  it('quebras de linha no meio ficam', () => {
    expect(normalizeNote('a\nb')).toBe('a\nb')
  })
  it('withNote grava, troca e apaga sem mexer na série original', () => {
    const s = { w: 60, r: 8, done: true }
    const a = withNote(s, ' pegada aberta ')
    expect(a).toEqual({ w: 60, r: 8, done: true, note: 'pegada aberta' })
    expect(s).toEqual({ w: 60, r: 8, done: true })
    const b = withNote(a, '   ')
    expect('note' in b).toBe(false)
    expect(a.note).toBe('pegada aberta')
  })
  it('hasNote', () => {
    expect(hasNote({})).toBe(false)
    expect(hasNote({ note: '' })).toBe(false)
    expect(hasNote({ note: 'x' })).toBe(true)
    expect(hasNote(null)).toBe(false)
  })
})
