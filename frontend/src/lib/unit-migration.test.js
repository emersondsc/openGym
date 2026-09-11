// frontend/src/lib/unit-migration.test.js — a migração que marca as libras (BACKLOG-01, U1).
//
// Este é o único pedaço da mudança que reescreve o estado do usuário em silêncio, então ele é
// testado por comportamento (com um storage de verdade em memória), não por asserção sobre o
// texto do store. Os três riscos que estes testes fecham:
//   1. marcar a flag sem gravar o estado  → a migração se perde no próximo boot;
//   2. marcar a flag sem haver rotinas     → num aparelho novo ela nunca mais roda;
//   3. tocar em `workouts[]`               → o histórico antigo (que já está em kg) seria
//                                            reinterpretado, contra a decisão do usuário.
import { describe, it, expect, beforeEach } from 'vitest'
import { pinUnits, UNIT_PIN_KEY, STATE_KEY, LB_EXERCISES } from './unit-migration.js'

class MemStorage {
  constructor() { this.m = new Map(); this.setCalls = [] }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.setCalls.push(k); this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
  clear() { this.m.clear(); this.setCalls = [] }
}

const ex = (id, extra = {}) => ({ id, sets: 3, reps: '6-8', weight: 200, mode: 'normal', sg: 0, ...extra })
const state = () => ({
  unit: 'kg', _ts: 1789132746742,
  routines: [
    { id: 'r_leg1', name: 'Legs 1', ex: [ex('0585'), ex('0599'), ex('0739', { weight: 180 })] },
    { id: 'r_upper', name: 'Upper C', ex: [ex('0584', { weight: 45 })] }
  ],
  workouts: [
    { id: 'w1', d: '2026-09-06', entries: [{ id: '0585', sets: [{ w: 200, r: 8, done: true }] }] }
  ],
  exWeights: { '0585': { w: 200 } }, customEx: [], week: {}, dayPlan: {}, bodyweight: []
})

let store, st
beforeEach(() => { store = new MemStorage(); st = state() })

describe('pinUnits', () => {
  it('marca 0585 e 0599 em todas as rotinas e deixa o resto em paz', () => {
    expect(pinUnits(st, store, STATE_KEY)).toBeGreaterThan(0)
    expect(st.routines[0].ex[0].unit).toBe('lb')     // 0585 em Legs 1
    expect(st.routines[0].ex[1].unit).toBe('lb')     // 0599 em Legs 1
    expect(st.routines[0].ex[2].unit).toBeUndefined()  // 0739 não é máquina em libras
    expect(st.routines[1].ex[0].unit).toBeUndefined()  // 0584 também não
  })

  it('NÃO toca no histórico: `workouts[]` continua sem unidade (U1)', () => {
    pinUnits(st, store, STATE_KEY)
    expect(st.workouts[0].entries[0].sets[0].wUnit).toBeUndefined()
    expect(st.workouts[0].entries[0].target).toBeUndefined()
  })

  it('grava o estado antes de marcar a flag (senão a migração se perde)', () => {
    pinUnits(st, store, STATE_KEY)
    const gravado = JSON.parse(store.getItem(STATE_KEY))
    expect(gravado.routines[0].ex[0].unit).toBe('lb')
    expect(store.setCalls.indexOf(STATE_KEY)).toBeLessThan(store.setCalls.indexOf(UNIT_PIN_KEY))
  })

  it('roda uma vez só: a segunda chamada não faz nada e não regrava', () => {
    pinUnits(st, store, STATE_KEY)
    const chamadas = store.setCalls.length
    const st2 = state()
    expect(pinUnits(st2, store, STATE_KEY)).toBe(0)
    expect(st2.routines[0].ex[0].unit).toBeUndefined()   // não voltou a marcar
    expect(store.setCalls.length).toBe(chamadas)          // nem regravou
  })

  it('remover o `unit` à mão NÃO faz a migração voltar', () => {
    pinUnits(st, store, STATE_KEY)
    delete st.routines[0].ex[0].unit
    expect(pinUnits(st, store, STATE_KEY)).toBe(0)
    expect(st.routines[0].ex[0].unit).toBeUndefined()
  })

  it('sem rotinas não marca a flag — a migração espera o estado chegar do servidor', () => {
    const vazio = { unit: 'kg', routines: [], workouts: [] }
    expect(pinUnits(vazio, store, STATE_KEY)).toBe(0)
    expect(store.getItem(UNIT_PIN_KEY)).toBe(null)
    // o estado chega depois (pullState) e agora sim migra
    expect(pinUnits(st, store, STATE_KEY)).toBeGreaterThan(0)
    expect(st.routines[0].ex[0].unit).toBe('lb')
  })

  it('entrada que já tem unidade não é tocada nem contada', () => {
    st.routines[0].ex[0].unit = 'kg'          // escolha explícita do usuário
    pinUnits(st, store, STATE_KEY)
    expect(st.routines[0].ex[0].unit).toBe('kg')
    expect(st.routines[0].ex[1].unit).toBe('lb')
  })

  it('migra também o treino em andamento (sessão interrompida que volta depois)', () => {
    st.active = { id: 'a1', routineId: 'r_leg1', entries: [
      { id: '0585', target: { ...ex('0585') }, sets: [] },
      { id: '0739', target: { ...ex('0739') }, sets: [] }
    ] }
    pinUnits(st, store, STATE_KEY)
    expect(st.active.entries[0].target.unit).toBe('lb')
    expect(st.active.entries[1].target.unit).toBeUndefined()
  })

  it('entry sem target no active não quebra a migração', () => {
    st.active = { id: 'a1', entries: [{ id: '0585', sets: [] }] }
    expect(() => pinUnits(st, store, STATE_KEY)).not.toThrow()
    expect(st.routines[0].ex[0].unit).toBe('lb')
  })

  it('storage que explode não derruba o boot', () => {
    const quebrado = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(pinUnits(state(), quebrado, STATE_KEY)).toBe(0)
  })

  it('os ids marcados são exatamente os dois aparelhos de perna', () => {
    expect(LB_EXERCISES).toEqual(['0585', '0599'])
  })
})
