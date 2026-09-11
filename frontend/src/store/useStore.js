import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { adoptServerRoutines, rememberBase, readBase, ifMatchFor } from '../lib/plan-merge.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, globalRestSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  confirmTopWeight: false,
  reminder: { on: false, time: '08:00', tz: null }, effort: null
}
const clone = o => JSON.parse(JSON.stringify(o))
// Um aviso de "o plano foi atualizado" por sessão de sync (evita repetir a cada 409).
const NO_TOAST_KEY = 'gym_coach_notice_shown'

export const isValidRest = n => typeof n === 'number' && Number.isInteger(n) && n>=30 && n<=300

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw){
      const parsed = JSON.parse(raw)
      const state = Object.assign(clone(DEF), parsed)
      // Migração S.restSec -> S.globalRestSec (1x)
      if(state.globalRestSec == null && isValidRest(state.restSec)){
        state.globalRestSec = state.restSec
      }
      if('restSec' in state && state.globalRestSec !== undefined){
        state.restSec = state.globalRestSec
      }
      if(!isValidRest(state.globalRestSec)) state.globalRestSec = 90
      // Limpeza por-rotina
      ;(state.routines||[]).forEach(r=>{
        ;(r.ex||[]).forEach(ex=>{
          if('restSec' in ex && !isValidRest(ex.restSec)){
            console.warn('[restSec] limpeza: removido invalido', r.id, ex.id, ex.restSec)
            delete ex.restSec
          }
        })
      })
      // Limpeza active se houver
      if(state.active?.entries){
        state.active.entries.forEach(e=>{
          if('restSec' in e && !isValidRest(e.restSec)) delete e.restSec
        })
      }
      return state
    }
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

// Envio do estado com o token de concorrência: o servidor compara a base por IGUALDADE
// (spec_api_rotinas RF-5). Sem `rev` (primeiro sync de um perfil nunca escrito pela versão
// nova) não se manda header — o servidor usa o guard por relógio de sempre.
const sendState = (state, base) => api('/api/data', {
  method: 'PUT',
  headers: base == null ? undefined : { 'If-Match': String(base) },
  body: JSON.stringify({ state })
})

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null

  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      try { localStorage.setItem('gym_dirty', '1') } catch { /* */ }
      get().pushState()
    }
  })

  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,

    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      const sanitized = JSON.parse(JSON.stringify(get().S))
      sanitized.routines?.forEach(r=> r.ex?.forEach(ex=>{ if('restSec' in ex && !isValidRest(ex.restSec)) delete ex.restSec }))
      if(sanitized.active?.entries) sanitized.active.entries.forEach(e=>{ if('restSec' in e && !isValidRest(e.restSec)) delete e.restSec })
      if(!isValidRest(sanitized.globalRestSec)) sanitized.globalRestSec = 90
      const send = (base = ifMatchFor(sanitized)) => sendState(sanitized, base)
      try { await send(); localStorage.removeItem('gym_dirty'); try{ const {clearCoachCache}=await import('../lib/coach.js'); clearCoachCache(); }catch{} }
      catch (e) {
        localStorage.setItem('gym_dirty', '1')
        if (e && e.status === 401) { get().setUser(null); return }
        if (e && e.status === 409) {
          try {
            const { state: srv } = await api('/api/data')
            if (srv) {
              if(srv.routines) srv.routines.forEach(r=> r.ex?.forEach(ex=>{ if('restSec' in ex && !isValidRest(ex.restSec)) delete ex.restSec }))
              if(!isValidRest(srv.globalRestSec) && srv.globalRestSec!=null) delete srv.globalRestSec
              const S = get().S
              const byId = new Map()
              ;(srv.workouts || []).forEach(w => byId.set(w.id, w))
              ;(S.workouts || []).forEach(w => { if (!byId.has(w.id)) byId.set(w.id, w) })
              const merged = Object.assign(clone(DEF), srv)      // routines/week/dayPlan do SERVIDOR
              merged.workouts = [...byId.values()]
              if (S.active) merged.active = S.active
              const adopted = adoptServerRoutines(srv.routines || [], S.routines || [], readBase())
              merged.routines = adopted.routines
              merged._ts = Math.max(Date.now(), srv._ts || 0) + 1
              merged.rev = Number.isInteger(srv.rev) ? srv.rev : merged.rev
              persist(merged, false)
              rememberBase(adopted.routines)
              try{ const {clearCoachCache}=await import('../lib/coach.js'); clearCoachCache(); }catch{}
              // Reenvia o MERGED (não o `sanitized` do topo, que é o estado velho) com a base
              // que acabou de ser lida.
              await sendState(merged, merged.rev)
              localStorage.removeItem('gym_dirty')
              if (adopted.changed && !localStorage.getItem(NO_TOAST_KEY)) {
                try { const { useUI } = await import('./useUI.js')
                  useUI.getState().toast(t('Plan updated by the coach — your own edits were kept.'))
                } catch { /* */ }
                localStorage.setItem(NO_TOAST_KEY, '1')      // um aviso por sessão de sync
              }
              try{ const {clearCoachCache}=await import('../lib/coach.js'); clearCoachCache(); }catch{}
            }
          } catch { /* stays dirty, heals on next boot */ }
        }
      }
    },
    async pullState() {
      try {
        const { state } = await api('/api/data')
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        if (state) {
          if(state.routines) state.routines.forEach(r=> r.ex?.forEach(ex=>{ if('restSec' in ex && !isValidRest(ex.restSec)) delete ex.restSec }))
          if(!isValidRest(state.globalRestSec) && state.globalRestSec!=null) delete state.globalRestSec
          if(state.active?.entries) state.active.entries.forEach(e=>{ if('restSec' in e && !isValidRest(e.restSec)) delete e.restSec })
        }
        if (state && (!hasData(S) || ((state._ts || 0) >= (S._ts || 0) && !dirty))) {
          const active = S.active
          const next = Object.assign(clone(DEF), state)
          if (active) next.active = active
          persist(next, false)
          rememberBase(next.routines)
          try{ const {clearCoachCache}=await import('../lib/coach.js'); clearCoachCache(); }catch{}
        } else if (hasData(S)) {
          if (state && (state._ts || 0) > (S._ts || 0)) {
            const byId = new Map()
            ;(state.workouts || []).forEach(w => byId.set(w.id, w))
            ;(S.workouts || []).forEach(w => { if (!byId.has(w.id)) byId.set(w.id, w) })
            const merged = Object.assign(clone(DEF), state)
            merged.workouts = [...byId.values()]
            if (S.active) merged.active = S.active
            merged._ts = Date.now()
            persist(merged, false)
            rememberBase(merged.routines)
            try{ const {clearCoachCache}=await import('../lib/coach.js'); clearCoachCache(); }catch{}
          }
          // Sem push aqui de propósito: abrir o app NÃO é uma edição. Empurrar o estado inteiro
          // só porque o app abriu é o que deixava uma cópia velha vencer a corrida do relógio
          // (BACKLOG-09). Se o servidor estiver atrás, a próxima edição real empurra (com If-Match).
        }
      } catch (e) { /* offline — keep local */ }
    },

    async signOut() {
      try { await get().pushState(); await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { /* */ }
      clearLocalSession()
    },

    async signOutAll() {
      await get().pushState()
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    async boot() {
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          nativeSave(S)
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }
// Reexportados para quem já importava do store (e para o teste): a implementação vive em
// ../lib/plan-merge.js, que não depende de DOM.
export { adoptServerRoutines, rememberBase, readBase, ifMatchFor }
