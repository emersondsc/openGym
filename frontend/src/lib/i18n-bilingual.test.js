import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { LANGS, INSTR_LANGS, effLang, setLang, getLang, dateLocale, t, exNameFor, instrFor, instrTranslated } from './i18n.js'
import { EXDB, EXIDX, exName, matchesExercise, compareExNames, normText } from './exercises.js'
import ptEx from '../ex/pt.js'
import ptLocale from '../locales/pt.js'
import ptInstr from '../instr/pt.js'

afterAll(async () => {
  await setLang('en')
})

describe('bilingual PT-BR default, migration, and coverage', () => {
  it('keeps all 12 languages with pt first and en second', () => {
    const keys = Object.keys(LANGS)
    expect(keys.length).toBe(12)
    expect(keys[0]).toBe('pt')
    expect(keys[1]).toBe('en')
    expect(LANGS.pt).toBe('Português (Brasil)')
  })

  it('resolves effLang with langChosen migration for legacy en states', () => {
    expect(effLang(null)).toBe('pt')
    expect(effLang({})).toBe('pt')
    expect(effLang({ lang: 'en' })).toBe('pt')
    expect(effLang({ lang: 'en', langChosen: false })).toBe('pt')
    expect(effLang({ lang: 'en', langChosen: true })).toBe('en')
    expect(effLang({ lang: 'pt', langChosen: true })).toBe('pt')
    expect(effLang({ lang: 'pt', langChosen: false })).toBe('pt')
    expect(effLang({ lang: 'es' })).toBe('es')
    expect(effLang({ lang: 'fr', langChosen: true })).toBe('fr')
    expect(effLang({ lang: 'xx' })).toBe('pt')
    expect(effLang({ lang: 'xx', langChosen: true })).toBe('pt')
  })

  it('sets PT-BR as DEF default in useStore.js', () => {
    const src = readFileSync(path.resolve('src/store/useStore.js'), 'utf8')
    expect(src).toMatch(/lang:\s*'pt'/)
    expect(src).toMatch(/langChosen:\s*false/)
  })

  it('switches cleanly between pt (PT-BR) and en with synchronous exercise and UI dictionaries', async () => {
    await setLang('pt')
    expect(getLang()).toBe('pt')
    expect(dateLocale()).toBe('pt-BR')
    expect(t('Home')).toBe('Início')
    expect(t('chest')).toBe('Peito')
    expect(t('custom')).toBe('Personalizado')
    expect(exNameFor('0025')).toBe(ptEx['0025'])
    expect(exName('0025')).toBe(ptEx['0025'])
    expect(exName('0025')).not.toBe(EXIDX['0025'].n)
    expect(exName({ id: 'c1', n: 'Meu supino', custom: true })).toBe('Meu supino')
    expect(INSTR_LANGS).toContain('pt')
    expect(INSTR_LANGS).toContain('en')
    expect(instrFor(EXIDX['0025'])).toEqual(ptInstr['0025'])
    expect(instrFor(EXIDX['0025'])).not.toEqual(EXIDX['0025'].st)
    expect(instrTranslated(EXIDX['0025'])).toBe(true)
    expect(instrFor(EXIDX['10189'])).toEqual(EXIDX['10189'].st)
    expect(instrTranslated(EXIDX['10189'])).toBe(false)

    await setLang('en')
    expect(getLang()).toBe('en')
    expect(dateLocale()).toBe('en-GB')
    expect(t('Home')).toBe('Home')
    expect(exNameFor('0025')).toBeNull()
    expect(exName('0025')).toBe(EXIDX['0025'].n)
    expect(instrFor(EXIDX['0025'])).toEqual(EXIDX['0025'].st)
  })

  it('searches bilingual & accent-insensitively and sorts using locale rules', async () => {
    await setLang('pt')
    const bench = EXIDX['0025']
    expect(matchesExercise(bench, 'supino')).toBe(true)
    expect(matchesExercise(bench, 'bench press')).toBe(true)
    expect(matchesExercise(bench, 'barra')).toBe(true)
    expect(matchesExercise(bench, 'barbell')).toBe(true)
    expect(matchesExercise(EXIDX['0382'], 'biceps')).toBe(true)
    expect(normText('Avanço Ágil')).toBe('avanco agil')
    expect(compareExNames({ id: '0001', n: 'a' }, { id: '0001', n: 'a' })).toBe(0)
  })

  it('covers 100% of exercises-data.json in ex/pt.js with PT-BR terminology', () => {
    const ids = EXDB.map(e => e.id).sort()
    expect(Object.keys(ptEx).sort()).toEqual(ids)
    for (const id of ids) {
      const val = ptEx[id]
      expect(typeof val).toBe('string')
      expect(val.trim().length).toBeGreaterThan(0)
      expect(val).not.toMatch(/\bhaltere\b|BOSU|gémeos|abdómen/)
    }
  })

  it('covers all 96 taxonomy terms in locales/pt.js without PT-PT leaks or placeholder mismatches', () => {
    const tax = new Set(['custom'])
    for (const e of EXDB) {
      tax.add(e.bp)
      tax.add(e.eq)
      if (e.tg) tax.add(e.tg)
      for (const s of e.sm || []) tax.add(s)
    }
    expect(tax.size).toBe(96)
    for (const k of tax) {
      expect(typeof ptLocale[k], k).toBe('string')
      expect(ptLocale[k][0]).toBe(ptLocale[k][0].toUpperCase())
    }
    const leakRe = /definições|ficheiro|introduz|\bregistar\b|\bregisto\b|registad|terminar sessão|iniciar sessão|palavra-passe|palavras-passe|telemóvel|ecrã|utilizador|descarregar|falhaste|\bpodes\b|\bqueres\b|\bescolhe |\bguardad[oa]\b|\bguardar\b|gémeos|abdómen|«|»|\btu\b|\bteu[s]?\b|\btua[s]?\b|em curso|planead[oa]|\bpartilhar\b|\bhaltere\b/i
    for (const [k, v] of Object.entries(ptLocale)) {
      const pk = (k.match(/\{\d+\}/g) || []).sort()
      const pv = (v.match(/\{\d+\}/g) || []).sort()
      expect(pv, k).toEqual(pk)
      expect(v, k).not.toMatch(leakRe)
    }
  })

  it('covers all 1324 base exercises in instr/pt.js with PT-BR imperatives and falls back cleanly on newer entries', () => {
    const ptIds = Object.keys(ptInstr).sort()
    expect(ptIds.length).toBe(1324)
    const byId = new Map(EXDB.map(e => [e.id, e]))
    let totalSteps = 0
    const leakRe = /\bhaltere\b|gémeos|abdómen|\banca[s]?\b|bola de estabilidade|barra EZ|máquina de alavanca|\bteu[s]?\b|\btua[s]?\b|\btu\b|«|»/i
    for (const id of ptIds) {
      const e = byId.get(id)
      expect(e, id).toBeTruthy()
      const stepsPt = ptInstr[id]
      expect(Array.isArray(stepsPt), id).toBe(true)
      expect(stepsPt.length, id).toBe(e.st.length)
      for (let i = 0; i < stepsPt.length; i++) {
        const s = stepsPt[i]
        expect(typeof s, `${id}:${i}`).toBe('string')
        expect(s.trim().length, `${id}:${i}`).toBeGreaterThan(0)
        expect(s, `${id}:${i}`).not.toMatch(/[\r\n]/)
        expect(s.toLowerCase(), `${id}:${i}`).not.toBe(e.st[i].toLowerCase())
        expect(s, `${id}:${i}`).not.toMatch(leakRe)
        expect(s, `${id}:${i}`).not.toMatch(/\bBOSU\b/)
        totalSteps++
      }
    }
    expect(totalSteps).toBe(7710)
    for (const e of EXDB) {
      expect(Array.isArray(e.st) && e.st.length > 0, e.id).toBe(true)
    }
  })
})
