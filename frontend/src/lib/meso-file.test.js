// frontend/src/lib/meso-file.test.js — arquivo de mesociclo: import (JSON/CSV) e export.
//
// O que esta suíte protege: o arquivo do usuário entra inteiro (campo desconhecido preservado), o
// que não tem núcleo é recusado COM NOME no resumo, e o CSV que o app exporta volta pelo próprio
// import com o mesmo núcleo — inclusive as semanas de 6 e 9 dias do mesociclo real.
import { describe, it, expect } from 'vitest'
import { parseMesoFile, parseRules, noteText, mesoToJSON, mesoToCSV, mesoFileName, MAX_FILE_BYTES } from './meso-file.js'
import { buildWeeks, spanDays } from './meso.js'

const t = (s, ...a) => String(s).replace(/\{(\d)\}/g, (_, i) => a[i])

const json = o => JSON.stringify(o)
const mesoBase = (over = {}) => ({
  id: 'meso-2026-09-15', name: 'Mesociclo 3', start: '2026-09-15', end: '2026-10-12',
  goal: 'objetivo', origin: 'user', weeks: buildWeeks('2026-09-15', 4), ...over
})

describe('parseMesoFile — JSON', () => {
  it('aceita um objeto, uma lista e { mesos: [] }', () => {
    const one = parseMesoFile(json(mesoBase()))
    expect(one.mesos.length).toBe(1)
    expect(one.errors).toEqual([])

    const two = parseMesoFile(json([mesoBase(), mesoBase({ id: 'meso-2026-10-13', start: '2026-10-13', weeks: buildWeeks('2026-10-13', 4) })]))
    expect(two.mesos.map(m => m.id)).toEqual(['meso-2026-09-15', 'meso-2026-10-13'])

    const wrapped = parseMesoFile(json({ mesos: [mesoBase()] }))
    expect(wrapped.mesos.length).toBe(1)
  })
  it('preserva campo desconhecido do mesociclo e da semana', () => {
    const p = parseMesoFile(json(mesoBase({
      cargas_prescritas: { 'Push Ter': 'Desenv 114' },
      weeks: [{ n: 1, start: '2026-09-15', end: '2026-09-21', phase: 'calibração', nota_do_coach: 'testando' }]
    })))
    expect(p.mesos[0].cargas_prescritas).toEqual({ 'Push Ter': 'Desenv 114' })
    expect(p.mesos[0].weeks[0].nota_do_coach).toBe('testando')
  })
  it('recusa os itens sem núcleo nomeando cada um, e importa os bons', () => {
    const p = parseMesoFile(json([
      mesoBase(),
      { name: 'sem data' },
      { start: '2026-09-15', end: '2026-09-21' },
      mesoBase({ id: 'meso-2026-10-13', start: '2026-10-13', weeks: buildWeeks('2026-10-13', 4) })
    ]))
    expect(p.mesos.length).toBe(2)
    expect(p.refused).toEqual([{ index: 2, name: 'sem data' }, { index: 3, name: null }])
    expect(p.errors).toContain('refused')
  })
  it('arquivo vazio e JSON inválido', () => {
    expect(parseMesoFile('').errors).toEqual(['empty'])
    expect(parseMesoFile('   ').errors).toEqual(['empty'])
    expect(parseMesoFile('{ isso não é json').errors).toEqual(['json'])
  })
  it('anota o que derivou', () => {
    const p = parseMesoFile(json({ name: 'Sem id nem semanas', start: '2026-09-15', end: '2026-10-12' }))
    expect(p.mesos[0].id).toBe('meso-2026-09-15')
    expect(p.notes.filter(n => n.kind === 'derived').map(n => n.field)).toEqual(expect.arrayContaining(['id', 'weeks']))
  })
})

describe('parseMesoFile — CSV', () => {
  it('uma linha sem coluna de semana vira mesociclo magro com 4 semanas derivadas', () => {
    const csv = 'name,start,goal\nMesociclo 4,2026-10-13,Chegar a 8 reps limpas\n'
    const p = parseMesoFile(csv)
    expect(p.errors).toEqual([])
    expect(p.mesos[0].name).toBe('Mesociclo 4')
    expect(p.mesos[0].weeks.length).toBe(4)
    expect(p.mesos[0].id).toBe('meso-2026-10-13')
    expect(p.notes.some(n => n.kind === 'derived' && n.field === 'weeks')).toBe(true)
  })
  it('quatro linhas com as semanas, `;` como separador e vírgula dentro do campo entre aspas', () => {
    const csv = [
      'name;start;goal;week;phase;plan',
      'Mesociclo 4;2026-10-13;Força;1;calibração;',
      ';;;2;progressão;"Mantém, ou +2,5% se fechar tudo"',
      ';;;3;progressão;Última janela antes do deload',
      ';;;4;deload;"1-2 séries, e -10% de carga"'
    ].join('\n')
    const p = parseMesoFile(csv)
    expect(p.errors).toEqual([])
    const m = p.mesos[0]
    expect(m.weeks.length).toBe(4)
    expect(m.weeks[0].phase).toBe('calibração')
    expect(m.weeks[1].plan).toBe('Mantém, ou +2,5% se fechar tudo')
    expect(m.weeks[3].plan).toBe('1-2 séries, e -10% de carga')
    expect(p.notes.some(n => n.kind === 'format')).toBe(true)     // avisa que CSV é subconjunto
  })
  it('coluna desconhecida vira extra DA SEMANA, e as regras vêm da célula', () => {
    const csv = [
      'name,start,end,week,phase,rules,observacao',
      'Meso,2026-09-15,2026-10-12,1,calibração,"Reps alvo=6-8\nIntensidade=falha só em máquina",leve',
      ',,,2,progressão,,pesado'
    ].join('\n')
    const p = parseMesoFile(csv)
    const m = p.mesos[0]
    expect(m.rules).toEqual({ 'Reps alvo': '6-8', 'Intensidade': 'falha só em máquina' })
    expect(m.weeks[0].observacao).toBe('leve')
    expect(m.weeks[1].observacao).toBe('pesado')
    expect(p.notes.some(n => n.kind === 'extras' && n.fields.includes('observacao'))).toBe(true)
  })
  it('CSV sem cabeçalho reconhecível', () => {
    const p = parseMesoFile('a,b,c\n1,2,3\n')
    expect(p.errors).toContain('no-core')
    expect(p.mesos).toEqual([])
  })
  it('parseRules aceita os três separadores e ignora par sem `=`', () => {
    expect(parseRules('A=1\nB=2')).toEqual({ A: '1', B: '2' })
    expect(parseRules('A=1|B=2')).toEqual({ A: '1', B: '2' })
    expect(parseRules('A=1;B=2')).toEqual({ A: '1', B: '2' })
    expect(parseRules('sem igual=sim;lixo')).toEqual({ 'sem igual': 'sim' })
    expect(parseRules('A=valor=com=iguais')).toEqual({ A: 'valor=com=iguais' })
  })
})

describe('export', () => {
  it('mesoToJSON é indentado e devolve o objeto inteiro, extras incluídos', () => {
    const m = mesoBase({ cargas_prescritas: { x: 1 } })
    const back = JSON.parse(mesoToJSON(m))
    expect(back.cargas_prescritas).toEqual({ x: 1 })
    expect(mesoToJSON(m).split('\n').length).toBeGreaterThan(5)
  })
  it('CSV → import → mesmo núcleo, com as semanas de 6 e 9 dias preservadas', () => {
    const real = {
      id: 'meso-2026-09-02', name: 'Mesociclo 2 · Low Volume', start: '2026-09-02', end: '2026-09-30',
      goal: 'Low Volume', origin: 'assistant',
      priorities: { lower: 'glúteos', upper: 'deltoide lateral' },
      rules: { 'Reps alvo': '6-8' },
      weeks: [
        { n: 1, start: '2026-09-02', end: '2026-09-07', phase: 'calibração', log: 'S1 cumprida' },
        { n: 2, start: '2026-09-08', end: '2026-09-14', phase: 'progressão leve' },
        { n: 3, start: '2026-09-15', end: '2026-09-21', phase: 'progressão' },
        { n: 4, start: '2026-09-22', end: '2026-09-30', phase: 'deload' }
      ]
    }
    const back = parseMesoFile(mesoToCSV(real)).mesos[0]
    expect([back.name, back.start, back.end, back.id]).toEqual([real.name, real.start, real.end, real.id])
    expect(back.weeks.map(w => [w.start, w.end])).toEqual(real.weeks.map(w => [w.start, w.end]))
    expect(spanDays(back.weeks[0].start, back.weeks[0].end)).toBe(6)
    expect(spanDays(back.weeks[3].start, back.weeks[3].end)).toBe(9)
    expect(back.weeks[0].log).toBe('S1 cumprida')
    expect(back.rules).toEqual({ 'Reps alvo': '6-8' })
    expect(back.priorities).toEqual({ lower: 'glúteos', upper: 'deltoide lateral' })
  })
  it('nome do arquivo e teto de tamanho', () => {
    expect(mesoFileName({ id: 'meso-2026-09-15' }, 'json')).toBe('meso-2026-09-15.json')
    expect(MAX_FILE_BYTES).toBe(2 * 1024 * 1024)
  })
})

describe('noteText', () => {
  it('traduz cada tipo de nota para uma linha do resumo', () => {
    expect(noteText({ kind: 'derived', field: 'weeks', from: 'start..end' }, t)).toBe('weeks derived from start..end')
    expect(noteText({ kind: 'cut', field: 'name', to: 120 }, t)).toBe('name was trimmed to 120')
    expect(noteText({ kind: 'cut', field: 'phase', week: 3, to: 80 }, t)).toBe('phase (week 3) was trimmed to 80')
    expect(noteText({ kind: 'extras', fields: ['a', 'b'] }, t)).toBe('2 extra fields kept: a, b')
    expect(noteText({ kind: 'format', format: 'csv' }, t)).toBe('CSV carries no coach log and no extra fields')
    expect(noteText(null, t)).toBe('')
  })
})
