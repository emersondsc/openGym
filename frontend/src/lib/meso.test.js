// frontend/src/lib/meso.test.js — modelo do mesociclo (datas, derivações, cortes e mescla).
//
// O que esta suíte protege, em uma frase: o app nunca deve gravar no estado um mesociclo que a API
// recusaria (um 400 no PUT /api/data deixaria treino, rotina e peso presos), e nada do arquivo do
// usuário pode ser reescrito em silêncio.
import { describe, it, expect } from 'vitest'
import {
  LIMITS, addDays, spanDays, realISO, mesoBytes, todayInMeso, phaseFor, buildWeeks, weeksFromRange,
  shiftWeeks, resolveWeeks, normalizeMeso, extrasOf, weekAt, mesoState, activateMesoState,
  mergeMesos, fixMesoPointers, pickMeso
} from './meso.js'

const M = (over = {}) => ({
  id: 'meso-2026-09-02', name: 'Meso 2', start: '2026-09-02', end: '2026-09-30',
  origin: 'assistant', weeks: buildWeeks('2026-09-02', 4), ...over
})

describe('datas e fuso', () => {
  it('addDays e spanDays contam em UTC, sem escorregar de dia', () => {
    expect(addDays('2026-09-02', 5)).toBe('2026-09-07')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(spanDays('2026-09-02', '2026-09-07')).toBe(6)      // a S1 real tem 6 dias
    expect(spanDays('2026-09-22', '2026-09-30')).toBe(9)      // a S4 real tem 9
  })
  it('realISO recusa data que não existe no calendário', () => {
    expect(realISO('2026-02-30')).toBe(false)
    expect(realISO('2026-13-01')).toBe(false)
    expect(realISO('2026-02-28')).toBe(true)
    expect(realISO('02/09/2026')).toBe(false)
  })
  it('todayInMeso devolve AAAA-MM-DD no fuso do mesociclo, não no do aparelho', () => {
    const iso = todayInMeso()
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(iso).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  })
})

describe('semanas', () => {
  it('fase padrão: primeira calibração, última deload, o resto progressão', () => {
    expect(phaseFor(1, 4)).toBe('calibração')
    expect(phaseFor(2, 4)).toBe('progressão')
    expect(phaseFor(4, 4)).toBe('deload')
    expect(phaseFor(1, 1)).toBe('calibração')     // uma semana só é as duas pontas
  })
  it('buildWeeks faz 4 semanas de 7 dias', () => {
    const w = buildWeeks('2026-09-15', 4)
    expect(w.map(x => [x.start, x.end])).toEqual([
      ['2026-09-15', '2026-09-21'], ['2026-09-22', '2026-09-28'],
      ['2026-09-29', '2026-10-05'], ['2026-10-06', '2026-10-12']
    ])
    expect(w.every(x => spanDays(x.start, x.end) === 7)).toBe(true)
  })
  it('weeksFromRange: 6 dias viram 1 semana; 9 dias viram 2 (a última com 2 dias)', () => {
    const a = weeksFromRange('2026-09-02', '2026-09-07')
    expect(a.length).toBe(1)
    expect([a[0].start, a[0].end, spanDays(a[0].start, a[0].end)]).toEqual(['2026-09-02', '2026-09-07', 6])

    const b = weeksFromRange('2026-09-22', '2026-09-30')
    expect(b.length).toBe(2)
    expect([b[0].start, b[0].end]).toEqual(['2026-09-22', '2026-09-28'])
    expect([b[1].start, b[1].end, spanDays(b[1].start, b[1].end)]).toEqual(['2026-09-29', '2026-09-30', 2])
  })
  it('weeksFromRange devolve [] para intervalo absurdo (sem ano inteiro de mesociclo)', () => {
    expect(weeksFromRange('2026-09-01', '2027-12-31')).toEqual([])
    expect(weeksFromRange('2026-09-10', '2026-09-01')).toEqual([])
  })
  it('resolveWeeks respeita o que veio e deriva só o que falta', () => {
    const w = resolveWeeks({ start: '2026-09-02', weeks: [{ n: 2, phase: 'progressão' }, { n: 1, start: '2026-09-02', end: '2026-09-07' }] })
    expect(w.map(x => x.n)).toEqual([1, 2])              // ordena
    expect(w[0].phase).toBe('calibração')                // derivada pela posição
    expect(w[1].start).toBe('2026-09-09')                // derivada do start + 7
  })
  it('shiftWeeks move as datas e preserva o que o coach escreveu', () => {
    const weeks = [{ n: 1, start: '2026-09-02', end: '2026-09-07', phase: 'calibração', plan: 'p', log: 'l', extra: 'x' }]
    const s = shiftWeeks(weeks, 7)
    expect([s[0].start, s[0].end]).toEqual(['2026-09-09', '2026-09-14'])
    expect([s[0].plan, s[0].log, s[0].phase, s[0].extra]).toEqual(['p', 'l', 'calibração', 'x'])
  })
  it('weekAt acerta as bordas da semana', () => {
    const m = M()                                          // semanas de 7 dias a partir de 02/09
    expect(weekAt(m, '2026-09-02').n).toBe(1)
    expect(weekAt(m, '2026-09-08').n).toBe(1)
    expect(weekAt(m, '2026-09-09').n).toBe(2)
    expect(weekAt(m, '2026-10-01')).toBe(null)
  })
})

describe('normalizeMeso', () => {
  it('recusa o que não tem núcleo', () => {
    expect(normalizeMeso(null)).toBe(null)
    expect(normalizeMeso([])).toBe(null)
    expect(normalizeMeso({ name: 'x', start: '2026-09-01' })).toBe(null)              // sem semanas nem end
    expect(normalizeMeso({ start: '2026-09-01', end: '2026-09-07' })).toBe(null)      // sem nome
    expect(normalizeMeso({ name: 'x', start: '2026-02-30', end: '2026-03-07' })).toBe(null)
    expect(normalizeMeso({ name: 'x', start: '2026-09-01', end: '2026-08-01' })).toBe(null)
  })
  it('deriva id, end e semanas, anotando cada derivação', () => {
    const notes = []
    const m = normalizeMeso({ name: 'Meso novo', start: '2026-09-15', end: '2026-10-12' }, notes)
    expect(m.id).toBe('meso-2026-09-15')
    expect(m.end).toBe('2026-10-12')
    expect(m.weeks.length).toBe(4)
    expect(m.origin).toBe('user')
    expect(notes.map(n => n.field)).toEqual(expect.arrayContaining(['id', 'weeks']))
  })
  it('renumera as semanas 1..N, porque a API exige sequência', () => {
    const m = normalizeMeso({ name: 'x', start: '2026-09-01', end: '2026-09-21', weeks: [{ n: 5, start: '2026-09-01', end: '2026-09-07' }, { n: 9, start: '2026-09-08', end: '2026-09-14' }] })
    expect(m.weeks.map(w => w.n)).toEqual([1, 2])
  })
  it('descarta semana com data incoerente em vez de gravar algo que a API recusa', () => {
    const m = normalizeMeso({ name: 'x', start: '2026-09-01', end: '2026-09-14', weeks: [{ n: 1, start: '2026-09-08', end: '2026-09-01' }, { n: 2, start: '2026-09-08', end: '2026-09-14' }] })
    expect(m.weeks.length).toBe(1)
    expect(m.weeks[0].n).toBe(1)
  })
  it('corta o que passa do limite e ANOTA o corte', () => {
    const notes = []
    const m = normalizeMeso({
      name: 'n'.repeat(200), start: '2026-09-01', end: '2026-09-07', goal: 'g'.repeat(500),
      rules: { ['k'.repeat(60)]: 'v'.repeat(900) },
      weeks: [{ n: 1, start: '2026-09-01', end: '2026-09-07', phase: 'p'.repeat(120) }],
      log: Array.from({ length: 250 }, () => ({ date: '2026-09-01', text: 'x' }))
    }, notes)
    expect(m.name.length).toBe(LIMITS.name)
    expect(m.goal.length).toBe(LIMITS.goal)
    expect(m.weeks[0].phase.length).toBe(LIMITS.phase)
    expect(m.log.length).toBe(LIMITS.log)
    expect(Object.keys(m.rules).length).toBe(1)
    expect(Object.keys(m.rules)[0].length).toBe(LIMITS.ruleKey)
    expect(notes.filter(n => n.kind === 'cut').length).toBeGreaterThanOrEqual(5)
  })
  it('preserva campo desconhecido em qualquer nível (é o que faz o arquivo rico sobreviver)', () => {
    const m = normalizeMeso({
      name: 'x', start: '2026-09-01', end: '2026-09-07',
      cargas_prescritas: { 'Push Ter': 'Desenv 114' },
      weeks: [{ n: 1, start: '2026-09-01', end: '2026-09-07', nota_do_coach: 'testando' }]
    })
    expect(m.cargas_prescritas).toEqual({ 'Push Ter': 'Desenv 114' })
    expect(m.weeks[0].nota_do_coach).toBe('testando')
  })
  it('o resultado sempre cabe nos limites, mesmo vindo de um arquivo absurdo', () => {
    // 52 semanas (o teto) e 60 regras: sai cortado, nunca recusado.
    const m = normalizeMeso({ name: 'x', start: '2026-09-01', end: '2027-08-30', rules: Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['r' + i, 'v'])) })
    expect(m.weeks.length).toBe(LIMITS.weeks)
    expect(Object.keys(m.rules).length).toBe(LIMITS.rules)
    expect(mesoBytes(m)).toBeLessThan(LIMITS.meso)
  })
  it('intervalo absurdo (mais de um ano) é recusado, não cortado', () => {
    expect(normalizeMeso({ name: 'x', start: '2026-09-01', end: '2030-01-01' })).toBe(null)
    expect(normalizeMeso({ name: 'x', start: '2026-09-01', end: '2026-08-01' })).toBe(null)
  })
})

describe('derivações da tela', () => {
  it('extrasOf separa o que o app não conhece', () => {
    expect(extrasOf({ id: 'x', name: 'y', weeks: [], cargas: 1, _privado: 2 }).map(([k]) => k)).toEqual(['cargas'])
  })
  it('mesoState nos três estados', () => {
    const m = M({ start: '2026-09-02', end: '2026-09-30' })
    expect(mesoState(m, '2026-09-01')).toBe('future')
    expect(mesoState(m, '2026-09-15')).toBe('current')
    expect(mesoState(m, '2026-10-01')).toBe('ended')
    expect(mesoState(null, '2026-09-15')).toBe(null)
  })
  it('activateMesoState guarda o anterior, carimba quem ativou e não repete', () => {
    const S = { mesos: [{ id: 'a' }, { id: 'b' }], activeMeso: 'a', mesoPrev: null }
    expect(activateMesoState(S, 'b', 'user')).toBe(true)
    expect([S.activeMeso, S.mesoPrev]).toEqual(['b', 'a'])
    expect(S.mesos[1].activatedBy).toBe('user')
    expect(S.mesos[1].activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(activateMesoState(S, 'b', 'user')).toBe(false)      // já é o ativo: não mexe em nada
    expect(activateMesoState(S, 'nao-existe')).toBe(false)
  })
})

describe('mescla e ponteiros', () => {
  it('mergeMesos: o servidor manda no que ele tem, o local-only sobrevive', () => {
    const srv = [{ id: 'a', name: 'do servidor' }, { id: 'b', name: 'do servidor' }]
    const local = [{ id: 'b', name: 'editado aqui' }, { id: 'c', name: 'criado aqui' }]
    const out = mergeMesos(srv, local)
    expect(out.map(m => [m.id, m.name])).toEqual([['a', 'do servidor'], ['b', 'do servidor'], ['c', 'criado aqui']])
  })
  it('fixMesoPointers zera ponteiro órfão', () => {
    const S = { mesos: [{ id: 'a' }], activeMeso: 'sumiu', mesoPrev: 'a' }
    fixMesoPointers(S)
    expect(S.activeMeso).toBe(null)
    expect(S.mesoPrev).toBe('a')
  })
  it('pickMeso: id manda, senão o ativo, senão o primeiro, senão nenhum', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(pickMeso(list, 'c', 'a').id).toBe('c')       // o id pedido vence
    expect(pickMeso(list, 'sumiu', 'b').id).toBe('b')   // id que não existe cai no ativo
    expect(pickMeso(list, null, null).id).toBe('a')     // sem id e sem ativo: o primeiro
    expect(pickMeso([], 'a', 'b')).toBe(null)
    expect(pickMeso(undefined, 'a', 'b')).toBe(null)
  })
})
