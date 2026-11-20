// Pré-início: as 4 escolhas de uma conta nova antes da primeira home (docs: design_pre_inicio).
// Funções puras — a tela (views/Setup.jsx) e a raiz (App.jsx) só ligam isto ao React.
import { effLang, LANGS, t } from './i18n.js'
import { SKINS } from './format.js'

// A ordem é decisão do dono: sexo, idioma, unidade, estilo.
export const STEPS = ['body', 'lang', 'unit', 'skin']

// O que o Shell mostra. Sem sessão e antes do boot terminar: a tela de carregamento de hoje.
// Pendente antes do boot terminar: carregamento também, para o rascunho nascer do estado do servidor.
export function shellMode({ authed, ready, setupPending }) {
  if (!authed) return ready ? 'login' : 'loading'
  if (setupPending) return ready ? 'setup' : 'loading'
  return 'app'
}

// Rascunho inicial a partir do estado atual (escolha de idioma do login, dados de convidado).
export function initialDraft(S) {
  return {
    body: S.body === 'female' ? 'female' : 'male',
    lang: effLang(S),
    unit: S.unit === 'lb' ? 'lb' : 'kg',
    skin: SKINS[S.skin] ? S.skin : 'classic',
  }
}

// Grava o rascunho no estado `s`, no lugar. skinIntro: a vitrine de estilos não reaparece depois.
export function applyDraft(s, d) {
  s.body = d.body
  s.lang = d.lang
  s.langChosen = true
  s.unit = d.unit
  s.skin = d.skin
  s.skinIntro = true
}

export function summaryOf(d) {
  return [
    t(d.body === 'female' ? 'Female' : 'Male'),
    LANGS[d.lang],
    t(d.unit === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)'),
    SKINS[d.skin].label,
  ].join(' · ')
}

// Gravação final em duas partes, em ordem: o estado no servidor, depois o fim do marcador.
// Pode ser chamada de novo depois de uma falha (os passos são idempotentes). Devolve o user novo.
export async function finishSetup({ update, pushState, api }, d) {
  update(s => applyDraft(s, d), false)
  const r = await pushState()
  if (!r || !r.ok) { const e = new Error('state not saved'); e.step = 'state'; throw e }
  try {
    const { user } = await api('/api/me/setup-done', { method: 'POST', body: '{}' })
    return user
  } catch (err) {
    err.step = 'marker'
    throw err
  }
}
