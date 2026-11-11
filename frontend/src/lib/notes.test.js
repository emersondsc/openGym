import { describe, it, expect } from 'vitest'
import { NOTE_MAX, noteLength, normalizeNote, notesOf, applyNote, withoutNote } from './notes.js'

describe('normalizeNote', () => {
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
})

const base = () => ({
  routines: [{ id: 'leg', ex: [{ id: 'hack', sets: 3 }, { id: 'leg-press', sets: 3, note: 'pés altos' }] }],
  active: { routineId: 'leg', entries: [{ id: 'hack', sets: [] }] },
})

describe('applyNote', () => {
  it('exercício: cria exNotes quando falta, grava e apaga a chave', () => {
    const S = base()
    expect(applyNote(S, { exId: 'hack' }, 'exercise', ' banco 4 ')).toBe(true)
    expect(S.exNotes).toEqual({ hack: 'banco 4' })
    applyNote(S, { exId: 'hack' }, 'exercise', '  ')
    expect(S.exNotes).toEqual({})
  })
  it('rotina: grava no exercício da rotina e apaga a chave', () => {
    const S = base()
    applyNote(S, { exId: 'hack', routineId: 'leg' }, 'routine', 'pés altos')
    expect(S.routines[0].ex[0]).toEqual({ id: 'hack', sets: 3, note: 'pés altos' })
    applyNote(S, { exId: 'hack', routineId: 'leg' }, 'routine', '')
    expect('note' in S.routines[0].ex[0]).toBe(false)
  })
  it('rotina que não existe mais não quebra e devolve false', () => {
    const S = base()
    expect(applyNote(S, { exId: 'hack', routineId: 'sumiu' }, 'routine', 'x')).toBe(false)
    expect(applyNote(S, { exId: 'hack', routineId: null }, 'routine', 'x')).toBe(false)
  })
  it('treino: grava no próprio exercício do treino', () => {
    const S = base()
    const entry = S.active.entries[0]
    applyNote(S, { exId: 'hack', entry }, 'workout', 'máquina 2 ocupada')
    expect(entry.note).toBe('máquina 2 ocupada')
    applyNote(S, { exId: 'hack', entry }, 'workout', '')
    expect('note' in entry).toBe(false)
  })
  it('corta em NOTE_MAX', () => {
    const S = base()
    applyNote(S, { exId: 'hack' }, 'exercise', 'a'.repeat(NOTE_MAX + 10))
    expect(noteLength(S.exNotes.hack)).toBe(NOTE_MAX)
  })
})

describe('notesOf', () => {
  it('lê os três tipos', () => {
    const S = { ...base(), exNotes: { 'leg-press': 'banco 4' } }
    expect(notesOf(S, { exId: 'leg-press', routineId: 'leg', entry: { note: 'hoje' } }))
      .toEqual({ exercise: 'banco 4', routine: 'pés altos', workout: 'hoje' })
  })
  it('sem rotina, sem exNotes e sem entry devolve null nos três', () => {
    expect(notesOf({ routines: [] }, { exId: 'x', routineId: null }))
      .toEqual({ exercise: null, routine: null, workout: null })
  })
  it('string vazia conta como sem nota', () => {
    expect(notesOf({ exNotes: { x: '' } }, { exId: 'x', entry: { note: '' } }).workout).toBe(null)
  })
})

describe('withoutNote', () => {
  it('tira só a nota, sem mexer no original', () => {
    const cfg = { id: 'hack', sets: 3, note: 'pés altos' }
    expect(withoutNote(cfg)).toEqual({ id: 'hack', sets: 3 })
    expect(cfg.note).toBe('pés altos')
  })
})
