// Tiny dependency-free i18n. English source strings are the keys; PT-BR (default) is
// bundled statically so boot renders without FOUC, while the other locale packs and
// src/instr/ instruction packs remain lazy-loaded via import.meta.glob.
import { useSyncExternalStore } from 'react'
import ptDict from '../locales/pt.js'
import ptEx from '../ex/pt.js'

// UI languages. de has no instruction pack upstream — instructions fall back to English.
export const LANGS = {
  pt: 'Português (Brasil)', en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文', ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['pt', 'en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-BR',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')

let lang = 'en'
let dict = {}
let exNames = null          // { exId: translatedName } for PT-BR, null = dataset English
let instr = null            // { exId: [steps] } for the current language, null = English
let ptInstr = null          // lazy-loaded cache of src/instr/pt.js
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'
export const exNameFor = id => (exNames && exNames[id]) || null

// Resolve effective UI language from stored state: profiles saved before PT-BR became the
// default carry `lang: 'en'` without `langChosen: true`, so only an explicit choice keeps EN.
export function effLang(s) {
  if (!s) return 'pt'
  if (s.langChosen) return LANGS[s.lang] ? s.lang : 'pt'
  if (s.lang && s.lang !== 'en' && LANGS[s.lang]) return s.lang
  return 'pt'
}

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []
export const instrTranslated = ex => !!(instr && ex && instr[ex.id])

export async function setLang(l) {
  if (!LANGS[l]) l = 'pt'
  if (l === lang && version > 0) return
  lang = l
  if (l === 'pt') {
    dict = ptDict
    exNames = ptEx
    instr = ptInstr
    notify()
    if (!ptInstr) {
      try {
        const mod = await instrPacks['../instr/pt.js']()
        ptInstr = mod.default
        if (lang === 'pt') { instr = ptInstr; notify() }
      } catch (e) { /* keep English fallback */ }
    }
    return
  }
  if (l === 'en') { dict = {}; exNames = null; instr = null; notify(); return }
  exNames = null
  try {
    const nextDict = (await localePacks['../locales/' + l + '.js']()).default
    const nextInstr = INSTR_LANGS.includes(l) ? (await instrPacks['../instr/' + l + '.js']()).default : null
    if (lang !== l) return
    dict = nextDict
    instr = nextInstr
  } catch (e) { if (lang !== l) return; dict = {}; instr = null }
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
