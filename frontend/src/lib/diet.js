// frontend/src/lib/diet.js — cliente HTTP (/api/diet), helpers puros e fallback local (guest/demo).
// Os planos de dieta ficam isolados de state-<uid>.json em DATA_DIR/diet-<uid>.json.
import { api } from './api.js'
import { DEMO } from './demo.js'

export const DIET_LOCAL_KEY = 'gym_diet_v1'
export const emptyDietStore = () => ({ rev: 0, _ts: null, activePlanId: null, prevPlanId: null, plans: [] })

const clone = v => JSON.parse(JSON.stringify(v))

const memoryFallback = (() => {
  let buf = null
  return {
    getItem: k => (k === DIET_LOCAL_KEY ? buf : null),
    setItem: (k, v) => { if (k === DIET_LOCAL_KEY) buf = String(v) },
    removeItem: k => { if (k === DIET_LOCAL_KEY) buf = null }
  }
})()

function resolveStorage(storage) {
  if (storage) return storage
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage
  } catch { /* private mode / restricted storage */ }
  return memoryFallback
}

export function fixDietPointers(store) {
  const plans = Array.isArray(store.plans) ? store.plans : []
  const ids = new Set(plans.map(p => p.id))
  if (store.activePlanId && !ids.has(store.activePlanId)) store.activePlanId = null
  if (store.prevPlanId && !ids.has(store.prevPlanId)) store.prevPlanId = null
  return store
}

export function normalizeDietStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyDietStore()
  return fixDietPointers({
    rev: Number.isInteger(raw.rev) ? raw.rev : 0,
    _ts: raw._ts ?? null,
    activePlanId: typeof raw.activePlanId === 'string' ? raw.activePlanId : null,
    prevPlanId: typeof raw.prevPlanId === 'string' ? raw.prevPlanId : null,
    plans: Array.isArray(raw.plans) ? raw.plans : []
  })
}

export function sampleDietPlans() {
  return [
    {
      id: 'diet-2026-11-14',
      name: 'Emagrecimento com Controle de Insulina',
      referenceDate: '2026-11-14',
      goal: 'Perder gordura, definir o corpo e melhorar a saúde metabólica sem perda de massa magra.',
      origin: 'assistant',
      activatedBy: 'assistant',
      activatedAt: '2026-11-14T09:00:00.000Z',
      updatedAt: '2026-11-14T09:00:00.000Z',
      profile: { sex: 'male', age: 26, heightCm: 179, weightKg: 75, bmi: 23.4 },
      targets: {
        bmrKcal: 1745,
        tdeeKcal: 2700,
        dailyKcal: { min: 2200, max: 2300 },
        deficitKcal: { min: 400, max: 500 },
        weeklyDeficitKcal: { min: 2800, max: 3500 },
        expectedWeeklyLossKg: 0.4,
        macros: {
          proteinG: 150,
          carbsG: 200,
          fatG: { min: 70, max: 75 },
          fiberG: 30
        }
      },
      meals: [
        {
          id: 'cafe-manha',
          name: 'Café da manhã',
          time: '07:30',
          kcal: 560,
          items: [
            { food: 'Aveia em flocos', amount: 80, unit: 'g' },
            { food: 'Ovos inteiros', amount: 2, unit: 'un' },
            { food: 'Requeijão light', amount: 30, unit: 'g' },
            '1 fruta (banana ou maçã)'
          ],
          notes: 'Priorizar proteína e fibra logo cedo para segurar a glicemia.'
        },
        {
          id: 'almoco',
          name: 'Almoço',
          time: '12:30',
          kcal: 720,
          items: [
            { food: 'Carne bovina magra ou frango', amount: 200, unit: 'g' },
            { food: 'Arroz cozido', amount: 120, unit: 'g' },
            { food: 'Feijão cozido', amount: 80, unit: 'g' },
            { food: 'Cenoura ou legumes', amount: 150, unit: 'g' },
            'Brócolis, abobrinha ou folhas à vontade',
            { food: 'Azeite de oliva', amount: 1, unit: 'colher de sopa' }
          ],
          notes: 'Comer primeiro a proteína e os vegetais, e depois o arroz.'
        },
        {
          id: 'lanche-tarde',
          name: 'Lanche da tarde',
          time: '16:30',
          kcal: 360,
          items: [
            { food: 'Iogurte natural desnatado ou Skyr', amount: 170, unit: 'g' },
            { food: 'Whey protein', amount: 30, unit: 'g' },
            { food: 'Castanha-do-pará ou nozes', amount: 15, unit: 'g' },
            'Frutas vermelhas ou maçã'
          ],
          notes: 'Lanche pré-treino leve e com boa saciedade.'
        },
        {
          id: 'jantar',
          name: 'Jantar',
          time: '20:30',
          kcal: 610,
          items: [
            { food: 'Peito de frango ou peixe grelhado', amount: 200, unit: 'g' },
            { food: 'Batata-doce ou mandioca cozida', amount: 180, unit: 'g' },
            'Salada verde variada com limão',
            { food: 'Azeite de oliva', amount: 1, unit: 'colher de chá' }
          ],
          notes: 'Manter boa densidade proteica e carboidrato complexo controlado à noite.'
        }
      ],
      rules: {
        'Estagnação 2–3 semanas': 'Reduzir 100 a 150 kcal/dia (preferencialmente de carboidratos simples ou gorduras adicionadas).',
        'Perda > 0,7 kg/sem': 'Aumentar 100 a 150 kcal/dia para preservar força e massa magra.',
        'Proteína mínima': 'Manter pelo menos 1,8–2,0 g/kg (~135–150 g/dia) mesmo em dias de menor apetite.',
        'Hidratação e sono': 'Mínimo 35 ml/kg de água (~2,6 L/dia) e 7–8h de sono para sensibilidade à insulina.'
      },
      executionTips: [
        'Coma primeiro a proteína e os vegetais, e depois o arroz.',
        'Pese-se 3–4 vezes por semana em jejum e calcule a média semanal.',
        'Em dias de treino mais longo, concentre os carboidratos perto da sessão.'
      ]
    },
    {
      id: 'diet-2026-10-01',
      name: 'Manutenção Metabólica (2700 kcal)',
      referenceDate: '2026-10-01',
      goal: 'Sustentar peso corporal, rendimento nos treinos e recuperação entre ciclos.',
      origin: 'user',
      updatedAt: '2026-10-01T12:00:00.000Z',
      profile: { sex: 'male', age: 26, heightCm: 179, weightKg: 75, bmi: 23.4 },
      targets: {
        bmrKcal: 1745,
        tdeeKcal: 2700,
        dailyKcal: 2700,
        deficitKcal: 0,
        macros: {
          proteinG: 155,
          carbsG: 320,
          fatG: 80,
          fiberG: 32
        }
      },
      meals: [
        {
          id: 'cafe-manha-m',
          name: 'Café da manhã',
          time: '07:30',
          kcal: 680,
          items: [
            { food: 'Aveia em flocos', amount: 100, unit: 'g' },
            { food: 'Ovos inteiros', amount: 3, unit: 'un' },
            { food: 'Banana', amount: 1, unit: 'un' },
            { food: 'Pasta de amendoim', amount: 15, unit: 'g' }
          ]
        },
        {
          id: 'almoco-m',
          name: 'Almoço',
          time: '12:30',
          kcal: 840,
          items: [
            { food: 'Frango ou carne bovina', amount: 200, unit: 'g' },
            { food: 'Arroz cozido', amount: 220, unit: 'g' },
            { food: 'Feijão cozido', amount: 100, unit: 'g' },
            'Legumes e salada variados',
            { food: 'Azeite de oliva', amount: 1, unit: 'colher de sopa' }
          ]
        },
        {
          id: 'lanche-m',
          name: 'Lanche pré-treino',
          time: '16:30',
          kcal: 480,
          items: [
            { food: 'Pão integral', amount: 2, unit: 'fatias' },
            { food: 'Queijo cottage ou ricota', amount: 60, unit: 'g' },
            { food: 'Whey protein', amount: 30, unit: 'g' },
            '1 fruta'
          ]
        },
        {
          id: 'jantar-m',
          name: 'Jantar',
          time: '20:30',
          kcal: 700,
          items: [
            { food: 'Peixe ou frango grelhado', amount: 200, unit: 'g' },
            { food: 'Batata inglesa ou arroz', amount: 240, unit: 'g' },
            'Salada verde com azeite'
          ]
        }
      ],
      rules: {
        'Variação semanal > ±0,4 kg': 'Ajustar ±150 kcal/dia na média semanal de carboidratos.',
        'Treino duplo': 'Adicionar 1 fruta e 30g de aveia no pós-treino.'
      },
      executionTips: [
        'Manter consistência de horários nas refeições principais.'
      ]
    }
  ]
}

export function createDemoDietStore() {
  const plans = sampleDietPlans()
  return {
    rev: 1,
    _ts: 1794646800000,
    activePlanId: plans[0].id,
    prevPlanId: plans[1].id,
    plans
  }
}

function writeLocal(store, storage) {
  const s = resolveStorage(storage)
  try {
    s.setItem(DIET_LOCAL_KEY, JSON.stringify(store))
  } catch { /* ignore quota / private mode */ }
  return store
}

export function loadLocalDiet(storage, { demo = DEMO } = {}) {
  const s = resolveStorage(storage)
  try {
    const raw = s.getItem(DIET_LOCAL_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.plans)) {
        return normalizeDietStore(parsed)
      }
    }
  } catch { /* ignore corrupt localStorage */ }
  if (demo) return writeLocal(createDemoDietStore(), s)
  return emptyDietStore()
}

export function saveLocalDietPlan(plan, { activate = 'none', demo = DEMO } = {}, storage) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('plan object required')
  }
  const name = String(plan.name || '').trim()
  if (!name) throw new Error('plan name required')

  const store = clone(loadLocalDiet(storage, { demo }))
  const now = new Date().toISOString()
  const id = String(plan.id || '').trim() || `diet-${now.slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`
  const idx = store.plans.findIndex(p => p.id === id)
  const prev = idx >= 0 ? store.plans[idx] : null

  const { activatedBy, activatedAt, ...rest } = plan
  const next = {
    ...rest,
    id,
    name,
    origin: plan.origin === 'assistant' ? 'assistant' : 'user',
    updatedAt: now
  }

  if (activate === 'now') {
    next.activatedBy = 'user'
    next.activatedAt = now
  } else if (prev) {
    if (prev.activatedBy) next.activatedBy = prev.activatedBy
    if (prev.activatedAt) next.activatedAt = prev.activatedAt
  }

  if (idx >= 0) store.plans[idx] = next
  else store.plans.push(next)

  if (activate === 'now' && store.activePlanId !== id) {
    store.prevPlanId = store.activePlanId || null
    store.activePlanId = id
  }

  store.rev = (store.rev || 0) + 1
  store._ts = Date.now()
  return writeLocal(fixDietPointers(store), storage)
}

export function activateLocalDietPlan(id, storage, { demo = DEMO } = {}) {
  const store = clone(loadLocalDiet(storage, { demo }))
  const plan = store.plans.find(p => p.id === id)
  if (!plan) return store
  if (store.activePlanId !== id) {
    store.prevPlanId = store.activePlanId || null
    store.activePlanId = id
    plan.activatedBy = 'user'
    plan.activatedAt = new Date().toISOString()
    store.rev = (store.rev || 0) + 1
    store._ts = Date.now()
    return writeLocal(store, storage)
  }
  return store
}

export function deleteLocalDietPlan(id, storage, { demo = DEMO } = {}) {
  const store = clone(loadLocalDiet(storage, { demo }))
  const idx = store.plans.findIndex(p => p.id === id)
  if (idx < 0) return store
  store.plans.splice(idx, 1)
  if (store.activePlanId === id) store.activePlanId = null
  if (store.prevPlanId === id) store.prevPlanId = null
  store.rev = (store.rev || 0) + 1
  store._ts = Date.now()
  return writeLocal(store, storage)
}

/* ---------------------------------------------------------------- cliente HTTP (/api/diet) */

export const fetchDiet = (call = api) =>
  call('/api/diet').then(normalizeDietStore)

export const putDietPlan = (plan, { activate = 'none', rev = 0 } = {}, call = api) =>
  call('/api/diet', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': String(rev ?? 0) },
    body: JSON.stringify({ plan, activate: activate === 'now' ? 'now' : 'none' })
  })

export const activateDietPlan = (id, rev = 0, call = api) =>
  call(`/api/diet/${encodeURIComponent(id)}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': String(rev ?? 0) },
    body: '{}'
  })

export const deleteDietPlan = (id, rev = 0, call = api) =>
  call(`/api/diet/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'If-Match': String(rev ?? 0) }
  })

/* ---------------------------------------------------------------- formatação e resumo */

export function makeDietId(name, referenceDate) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(referenceDate || ''))
    ? referenceDate
    : new Date().toISOString().slice(0, 10)
  const slug = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `diet-${day}-${slug || suffix}`.slice(0, 64)
}

export function formatRangeOrNumber(v, unit = '') {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.round(v * 10) / 10
    return unit ? `${n}${unit}` : String(n)
  }
  if (typeof v === 'object' && typeof v.min === 'number' && typeof v.max === 'number'
    && Number.isFinite(v.min) && Number.isFinite(v.max)) {
    const a = Math.round(v.min * 10) / 10
    const b = Math.round(v.max * 10) / 10
    const body = a === b ? String(a) : `${a}–${b}`
    return unit ? `${body}${unit}` : body
  }
  return null
}

export function summarizeDietPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return {
      kcal: null,
      protein: null,
      carbs: null,
      fat: null,
      fiber: null,
      deficit: null,
      mealCount: 0,
      macrosLine: '',
      summaryLine: ''
    }
  }
  const targets = plan.targets || {}
  const macros = targets.macros || {}
  const dailyRange = (targets.dailyKcalMin != null && targets.dailyKcalMax != null)
    ? { min: targets.dailyKcalMin, max: targets.dailyKcalMax }
    : targets.dailyKcal
  const deficitRange = (targets.deficitKcalMin != null && targets.deficitKcalMax != null)
    ? { min: targets.deficitKcalMin, max: targets.deficitKcalMax }
    : targets.deficitKcal

  const kcal = formatRangeOrNumber(dailyRange, ' kcal')
  const protein = formatRangeOrNumber(macros.proteinG, 'g')
  const carbs = formatRangeOrNumber(macros.carbsG, 'g')
  const fat = formatRangeOrNumber(macros.fatG, 'g')
  const fiber = formatRangeOrNumber(macros.fiberG, 'g')
  const deficit = formatRangeOrNumber(deficitRange, ' kcal')
  const mealCount = Array.isArray(plan.meals) ? plan.meals.length : 0

  const macroParts = [
    protein && `${protein} P`,
    carbs && `${carbs} C`,
    fat && `${fat} F`
  ].filter(Boolean)
  const macrosLine = macroParts.join(' · ')
  const summaryLine = [kcal, macrosLine].filter(Boolean).join(' · ')

  return { kcal, protein, carbs, fat, fiber, deficit, mealCount, macrosLine, summaryLine }
}
