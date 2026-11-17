// frontend/src/store/useDiet.js — estado reativo dos planos de dieta (/api/diet ou local em guest/demo).
import { create } from 'zustand'
import { useStore } from './useStore.js'
import { DEMO } from '../lib/demo.js'
import { t } from '../lib/i18n.js'
import {
  emptyDietStore,
  fetchDiet,
  putDietPlan,
  activateDietPlan,
  deleteDietPlan,
  loadLocalDiet,
  saveLocalDietPlan,
  activateLocalDietPlan,
  deleteLocalDietPlan,
  sampleDietPlans
} from '../lib/diet.js'

const isRemote = () => !!useStore.getState().user && !DEMO

export const useDiet = create((set, get) => ({
  store: emptyDietStore(),
  loaded: false,
  loading: false,
  error: null,
  mode: isRemote() ? 'api' : 'local',

  async load(force = false) {
    if (get().loading) return get().store
    if (get().loaded && !force && get().mode === (isRemote() ? 'api' : 'local')) {
      return get().store
    }
    if (!isRemote()) {
      const store = loadLocalDiet()
      set({ store, loaded: true, loading: false, error: null, mode: 'local' })
      return store
    }
    set({ loading: true, error: null, mode: 'api' })
    try {
      const store = await fetchDiet()
      set({ store, loaded: true, loading: false, error: null, mode: 'api' })
      return store
    } catch (e) {
      set({ loading: false, error: e.message || t('Could not load'), mode: 'api' })
      throw e
    }
  },

  async savePlan(plan, { activate = 'none' } = {}) {
    if (!isRemote()) {
      const store = saveLocalDietPlan(plan, { activate })
      set({ store, loaded: true, error: null, mode: 'local' })
      return store
    }
    if (!get().loaded) await get().load()
    try {
      await putDietPlan(plan, { activate, rev: get().store.rev })
      return await get().load(true)
    } catch (e) {
      if (e.status === 409 || e.status === 412 || e.code === 'STALE_STATE') {
        await get().load(true).catch(() => {})
        throw new Error(t('Diet changed elsewhere — refreshed, try again.'))
      }
      throw e
    }
  },

  async activatePlan(id) {
    if (!isRemote()) {
      const store = activateLocalDietPlan(id)
      set({ store, loaded: true, error: null, mode: 'local' })
      return store
    }
    if (!get().loaded) await get().load()
    try {
      await activateDietPlan(id, get().store.rev)
      return await get().load(true)
    } catch (e) {
      if (e.status === 409 || e.status === 412 || e.code === 'STALE_STATE') {
        await get().load(true).catch(() => {})
        throw new Error(t('Diet changed elsewhere — refreshed, try again.'))
      }
      throw e
    }
  },

  async deletePlan(id) {
    if (!isRemote()) {
      const store = deleteLocalDietPlan(id)
      set({ store, loaded: true, error: null, mode: 'local' })
      return store
    }
    if (!get().loaded) await get().load()
    try {
      await deleteDietPlan(id, get().store.rev)
      return await get().load(true)
    } catch (e) {
      if (e.status === 409 || e.status === 412 || e.code === 'STALE_STATE') {
        await get().load(true).catch(() => {})
        throw new Error(t('Diet changed elsewhere — refreshed, try again.'))
      }
      throw e
    }
  },

  async loadSamplePlans() {
    if (!get().loaded) await get().load().catch(() => {})
    const samples = sampleDietPlans()
    let current = get().store
    let added = 0
    for (const s of samples) {
      if ((current.plans || []).some(p => p.id === s.id)) continue
      const activate = !current.activePlanId && s.id === samples[0].id ? 'now' : 'none'
      current = await get().savePlan({ ...s, origin: 'user' }, { activate })
      added++
    }
    return { store: current, added }
  },

  reset() {
    set({ store: emptyDietStore(), loaded: false, loading: false, error: null, mode: isRemote() ? 'api' : 'local' })
  }
}))
