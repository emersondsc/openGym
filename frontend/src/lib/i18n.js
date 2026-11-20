// Tiny dependency-free i18n. English source strings are the keys; PT-BR (default) is
// bundled statically so boot renders without FOUC, while the other locale packs and
// src/instr/ instruction packs remain lazy-loaded via import.meta.glob.
import { useSyncExternalStore } from 'react'
import ptDict from '../locales/pt.js'
import ptEx from '../ex/pt.js'

// UI languages. de/pt have no instruction pack upstream — instructions fall back to English.
export const LANGS = {
  pt: 'Português (Brasil)', en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文', ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
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

export async function setLang(l) {
  if (!LANGS[l]) l = 'pt'
  if (l === lang && version > 0) return
  lang = l
  if (l === 'pt') { dict = ptDict; exNames = ptEx; instr = null; notify(); return }
  if (l === 'en') { dict = {}; exNames = null; instr = null; notify(); return }
  exNames = null
  try {
    dict = (await localePacks['../locales/' + l + '.js']()).default
    instr = INSTR_LANGS.includes(l) ? (await instrPacks['../instr/' + l + '.js']()).default : null
  } catch (e) { dict = {}; instr = null }
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
