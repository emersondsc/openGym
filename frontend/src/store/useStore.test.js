// frontend/src/store/useStore.test.js — sync do estado: token de concorrência e adoção (BACKLOG-07/09).
//
// O que este arquivo protege (spec_api_rotinas.md §4.12/§4.13):
//  1. adoptServerRoutines: o que o usuário editou neste aparelho vence; o que veio do servidor é adotado.
//  2. a base local (readBase/rememberBase) é o que torna essa distinção possível.
//  3. ifMatchFor: o token só existe quando há `rev` — cliente antigo continua sem header.
//  4. invariantes do CAMINHO de sync (If-Match com a base lida, reenvio do estado ADOTADO no 409,
//     e o fim do push mecânico no boot). Esses três pontos são o coração da correção do
//     BACKLOG-09, e são verificados no texto do store: ele mexe em `document` e não roda em teste
//     sem jsdom (o projeto não tem jsdom nas devDependencies).
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { adoptServerRoutines, rememberBase, readBase, ifMatchFor } from '../lib/plan-merge.js'

class MemStorage {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
  clear() { this.m.clear() }
}
globalThis.localStorage = new MemStorage()

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useStore.js'), 'utf8')
const R = (id, weight) => ({ id, name: id, prog: 'off', ex: [{ id: '0326', sets: 2, weight }] })

describe('adoptServerRoutines', () => {
  it('rotina igual à base: fica a versão do SERVIDOR (foi o assistente que mudou)', () => {
    const base = { r1: R('r1', 8) }
    const { routines, changed } = adoptServerRoutines([R('r1', 10)], [R('r1', 8)], base)
    expect(routines).toEqual([R('r1', 10)])
    expect(changed).toBe(false)
  })

  it('rotina que o usuário editou aqui: fica a versão DELE (decisão de 11/09/2026)', () => {
    const base = { r1: R('r1', 8) }
    const { routines, changed } = adoptServerRoutines([R('r1', 10)], [R('r1', 12)], base)
    expect(routines).toEqual([R('r1', 12)])
    expect(changed).toBe(true)
  })

  it('rotina criada neste aparelho é mantida mesmo sem base', () => {
    const { routines } = adoptServerRoutines([R('r1', 8)], [R('r1', 8), R('nova', 20)], {})
    expect(routines.map(r => r.id).sort()).toEqual(['nova', 'r1'])
  })

  it('rotina que estava na base e sumiu do servidor NÃO ressuscita', () => {
    const base = { apagada: R('apagada', 10) }
    expect(adoptServerRoutines([], [R('apagada', 10)], base).routines).toEqual([])
  })

  it('rotina que só existe aqui e não tem base é mantida (criada neste aparelho, não se joga fora)', () => {
    expect(adoptServerRoutines([], [R('nova', 10)], {}).routines.map(r => r.id)).toEqual(['nova'])
  })

  it('rotina que existia na base e sumiu do servidor, sem edição local, também não volta', () => {
    const base = { sumiu: R('sumiu', 10) }
    const { routines } = adoptServerRoutines([R('r1', 8)], [R('r1', 8), R('sumiu', 10)], base)
    expect(routines.map(r => r.id)).toEqual(['r1'])
  })

  it('mistura: adota o que veio, mantém o que é meu, aceita rotina nova dos dois lados', () => {
    const base = { r1: R('r1', 8), r2: R('r2', 40) }
    const local = [R('r1', 8), R('r2', 45), R('minha', 15)]
    const srv = [R('r1', 10), R('r2', 40), R('r3', 30)]
    const byId = Object.fromEntries(adoptServerRoutines(srv, local, base).routines.map(r => [r.id, r]))
    expect(byId.r1.ex[0].weight).toBe(10)      // não toquei: adota o servidor
    expect(byId.r2.ex[0].weight).toBe(45)      // eu editei: fica o meu
    expect(byId.r3).toBeTruthy()               // rotina nova do servidor entra
    expect(byId.minha).toBeTruthy()            // minha rotina nova fica
  })
})

describe('base local e token', () => {
  beforeEach(() => localStorage.clear())

  it('rememberBase/readBase fazem round-trip indexado por id', () => {
    rememberBase([R('r1', 8), R('r2', 40)])
    const base = readBase()
    expect(Object.keys(base).sort()).toEqual(['r1', 'r2'])
    expect(base.r1.ex[0].weight).toBe(8)
  })

  it('sem base gravada devolve objeto vazio (primeiro uso depois do deploy)', () => {
    expect(readBase()).toEqual({})
  })

  it('ifMatchFor: string com rev inteiro, null sem rev', () => {
    expect(ifMatchFor({ rev: 7 })).toBe('7')
    expect(ifMatchFor({ rev: 0 })).toBe('0')
    expect(ifMatchFor({})).toBe(null)
    expect(ifMatchFor({ rev: '7' })).toBe(null)
    expect(ifMatchFor(null)).toBe(null)
  })
})

describe('invariantes do caminho de sync (no texto do store)', () => {
  it('o PUT manda If-Match com a base lida', () => {
    expect(SRC).toMatch(/headers: base == null \? undefined : \{ 'If-Match': String\(base\) \}/)
    expect(SRC).toMatch(/const send = \(base = ifMatchFor\(sanitized\)\) => sendState\(sanitized, base\)/)
  })

  it('no 409 reenvia o estado ADOTADO com a base nova (não o payload velho)', () => {
    expect(SRC).toMatch(/await sendState\(merged, merged\.rev\)/)
    expect(SRC).toMatch(/merged\.routines = adopted\.routines/)
    expect(SRC).toMatch(/adoptServerRoutines\(srv\.routines \|\| \[\], S\.routines \|\| \[\], readBase\(\)\)/)
  })

  it('o boot não empurra o estado: abrir o app não é edição', () => {
    const pull = SRC.slice(SRC.indexOf('async pullState()'))
    const bloco = pull.slice(pull.indexOf('} else if (hasData(S))'), pull.indexOf('async signOut()'))
    expect(bloco.length).toBeGreaterThan(50)                     // o recorte existe
    expect(bloco).not.toMatch(/await get\(\)\.pushState\(\)/)
  })

  it('a base é lembrada nos dois caminhos de pull e no 409', () => {
    expect((SRC.match(/rememberBase\(/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('o aviso aparece quando a versão do servidor foi adotada', () => {
    expect(SRC).toMatch(/adopted\.changed && !localStorage\.getItem\(NO_TOAST_KEY\)/)
    expect(SRC).toMatch(/Plan updated by the coach/)
  })

  // BACKLOG-01: a migração em si é testada por comportamento em lib/unit-migration.test.js;
  // aqui só se prende o fio — o boot tem de chamá-la, e com a chave do estado.
  it('o boot chama a migração da unidade passando a chave do estado', () => {
    expect(SRC).toMatch(/import \{ pinUnits \} from '\.\.\/lib\/unit-migration\.js'/)
    expect(SRC).toMatch(/pinUnits\(state, localStorage, KEY\)/)
  })
})
