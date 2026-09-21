// Formatting + date helpers (ported from the vanilla app, unit taken from the store where needed).
import { dateLocale, t } from './i18n.js'
export const todayISO = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
export const isoOf = d =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

export const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDate(iso, long) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(dateLocale(), long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' })
}
export function fmtDur(ms) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'
}
// Imported history has no clock — an unknown duration is left out rather than shown as "0 min".
export const durPart = ms => (ms >= 60000 ? [fmtDur(ms)] : [])
// Numbers follow the UI language, like the dates above — a hardcoded locale put Swiss
// apostrophes ("7'535 kg") in front of every user, in every language.
export const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString(dateLocale())
// Volume stays in the profile's unit throughout: the old shorthand turned anything over
// 10 000 into "t", which is wrong for a pound profile and made one list mix "18.8t" with
// "7'535 kg" — two numbers you can't compare at a glance.
export const fmtVol = (v, unit) => fmtNum(v) + ' ' + unit
// Plural forms are not automatic when the English string is the key.
export const exCount = n => t(n === 1 ? '{0} exercise' : '{0} exercises', n)

export function weekKey(d) {
  const dt = new Date(d + 'T12:00:00')
  const day = (dt.getDay() + 6) % 7
  dt.setDate(dt.getDate() - day + 3)
  const jan4 = new Date(dt.getFullYear(), 0, 4)
  const week = 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  return dt.getFullYear() + '-' + week
}

export const localTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
export const ACCENTS = { lime: '#30d158', sky: '#0a84ff', orange: '#ff9f0a', violet: '#bf5af2', pink: '#ff375f', red: '#ff453a', teal: '#40c8e0', gold: '#ffd60a' }

// Um estilo e um visual inteiro - cor, forma, tipografia e densidade -, nao uma cor. O mapa e a
// unica lista de estilos que existe: a folha de Settings e o CSS leem daqui, entao acrescentar
// Grind, Pulse ou Sage e uma entrada aqui e um bloco :root[data-skin="..."] no index.css.
//
//   mode       fixa o modo do estilo (Paper e claro por natureza); null = obedece ao Theme
//   ownAccent  o estilo traz a propria cor; o Accent color do usuario nao pinta nada nele
//   chrome     cor da barra do navegador (<meta name="theme-color">) por modo
//   subtitle   descricao curta, mostrada na folha de escolha
//   note       o que a secao Appearance diz quando este estilo esconde controles (null = nada)
//
// subtitle e note sao chaves de traducao: o ingles e a chave (lib/i18n.js) e quem traduz e a
// tela (t(sk.subtitle)). O mapa nao guarda texto ja traduzido para nao depender do idioma.
// Todo estilo com `mode` ou `ownAccent` precisa de `note` - ha teste para isso.
export const SKINS = {
  classic: {
    label: 'Classic', mode: null, ownAccent: false,
    subtitle: 'The look openGym has always had.',
    note: null,
    chrome: { dark: '#000000', light: '#f2f2f7' },
  },
  paper: {
    label: 'Paper', mode: 'light', ownAccent: true,
    subtitle: 'Warm paper, serifs and print rules.',
    note: 'Paper brings its own colours and light mode, so those controls are hidden.',
    chrome: { light: '#f4f0e6' },
  },
}

export const skinOf = k => SKINS[k] || SKINS.classic

// O que vai para o <html>, resolvido sem DOM (e o que o teste cobre). `accent: null` significa
// "o estilo manda na cor" - quem escreve o atributo e que decide remover `data-accent`.
export function resolveSkin(skin, theme, accent) {
  const sk = skinOf(skin)
  const mode = sk.mode || (theme === 'light' ? 'light' : 'dark')
  return {
    skin: SKINS[skin] ? skin : 'classic',
    mode,
    accent: sk.ownAccent ? null : (ACCENTS[accent] ? accent : 'lime'),
    chrome: sk.chrome[mode] || (mode === 'light' ? '#f2f2f7' : '#000000'),
  }
}
