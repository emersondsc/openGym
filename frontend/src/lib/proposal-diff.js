// Organiza a diferença que a API simulou. Função pura: toda folha sai exatamente uma vez, e o que
// não tiver visual próprio cai em `other`, para nada de um plano ficar invisível.
const CAMPO = {
  weight: 'Weight', sets: 'Sets', reps: 'Reps', restSec: 'Rest', unit: 'Unit', mode: 'Mode',
  name: 'Name', prog: 'Progression', w: 'Weight', r: 'Reps', role: 'Role', targetRir: 'Target RIR', goal: 'Goal',
  activePlanId: 'Active diet plan', goal: 'Goal', referenceDate: 'Reference date',
  dailyKcal: 'Daily kcal', 'dailyKcal.min': 'Daily kcal (min)', 'dailyKcal.max': 'Daily kcal (max)',
  dailyKcalMin: 'Daily kcal (min)', dailyKcalMax: 'Daily kcal (max)',
  deficitKcal: 'Deficit (kcal)', 'deficitKcal.min': 'Deficit (min)', 'deficitKcal.max': 'Deficit (max)',
  weeklyDeficitKcal: 'Weekly deficit (kcal)', 'weeklyDeficitKcal.min': 'Weekly deficit (min)', 'weeklyDeficitKcal.max': 'Weekly deficit (max)',
  expectedWeeklyLossKg: 'Expected weekly loss (kg)', bmrKcal: 'BMR (kcal)', tdeeKcal: 'TDEE (kcal)',
  proteinG: 'Protein (g)', 'proteinG.min': 'Protein min (g)', 'proteinG.max': 'Protein max (g)',
  carbsG: 'Carbs (g)', 'carbsG.min': 'Carbs min (g)', 'carbsG.max': 'Carbs max (g)',
  fatG: 'Fat (g)', 'fatG.min': 'Fat min (g)', 'fatG.max': 'Fat max (g)',
  fiberG: 'Fiber (g)', kcal: 'Calories (kcal)', time: 'Time', notes: 'Notes', note: 'Note',
  food: 'Food', amount: 'Amount', item: 'Item'
}

const planKey = raw => (/^\d+$/.test(raw) ? +raw : raw)

const REGRAS = [
  [/^routines\.(\d+)\.ex\.(\d+)\.setTargets\.(\d+)\.(.+)$/, m => ({ group: `routine:${m[1]}`, kind: 'routine', routine: +m[1], ex: +m[2], set: +m[3], field: m[4], setLabel: true })],
  [/^routines\.(\d+)\.ex\.(\d+)\.(.+)$/, m => ({ group: `routine:${m[1]}`, kind: 'routine', routine: +m[1], ex: +m[2], field: m[3] })],
  [/^routines\.(\d+)\.(.+)$/, m => ({ group: `routine:${m[1]}`, kind: 'routine', routine: +m[1], field: m[2] })],
  [/^dayPlan\.(.+)$/, m => ({ group: 'days', kind: 'days', day: m[1] })],
  [/^week\.(\d)$/, m => ({ group: 'days', kind: 'days', weekday: +m[1] })],
  [/^mesos\.(\d+)\.rules\.(.+)$/, m => ({ group: `rules:${m[1]}`, kind: 'rules', meso: +m[1], rule: m[2] })],
  [/^workouts\.(\d+)\.entries\.(\d+)\.sets\.(\d+)\.(.+)$/, m => ({ group: `workout:${m[1]}`, kind: 'workout', workout: +m[1], entry: +m[2], set: +m[3], field: m[4] })],
  [/^activePlanId$/, () => ({ group: 'dietActive', kind: 'dietActive', field: 'activePlanId' })],
  [/^plans\.([^.]+)\.rules\.(.+)$/, m => ({ group: `dietRules:${m[1]}`, kind: 'dietRules', plan: planKey(m[1]), rule: m[2] })],
  [/^plans\.([^.]+)\.meals\.(\d+)\.items\.(\d+)\.(.+)$/, m => ({ group: `dietMeal:${m[1]}:${m[2]}`, kind: 'dietMeal', plan: planKey(m[1]), meal: +m[2], item: +m[3], field: m[4] })],
  [/^plans\.([^.]+)\.meals\.(\d+)\.items\.(\d+)$/, m => ({ group: `dietMeal:${m[1]}:${m[2]}`, kind: 'dietMeal', plan: planKey(m[1]), meal: +m[2], item: +m[3], field: 'item' })],
  [/^plans\.([^.]+)\.meals\.(\d+)\.(.+)$/, m => ({ group: `dietMeal:${m[1]}:${m[2]}`, kind: 'dietMeal', plan: planKey(m[1]), meal: +m[2], field: m[3] })],
  [/^plans\.([^.]+)\.targets\.macros\.(.+)$/, m => ({ group: `diet:${m[1]}`, kind: 'diet', plan: planKey(m[1]), section: 'macros', field: m[2] })],
  [/^plans\.([^.]+)\.targets\.(.+)$/, m => ({ group: `diet:${m[1]}`, kind: 'diet', plan: planKey(m[1]), section: 'targets', field: m[2] })],
  [/^plans\.([^.]+)\.(.+)$/, m => ({ group: `diet:${m[1]}`, kind: 'diet', plan: planKey(m[1]), field: m[2] })]
]

export function groupChanges(changes) {
  const groups = new Map()
  const other = []
  for (const c of changes) {
    const regra = REGRAS.map(([re, f]) => { const m = re.exec(c.path); return m && f(m) }).find(Boolean)
    if (!regra) { other.push(c); continue }
    if (!groups.has(regra.group)) groups.set(regra.group, { key: regra.group, kind: regra.kind, rows: [] })
    const baseLabel = CAMPO[regra.field] || regra.field || null
    const label = regra.setLabel && baseLabel ? `Set ${regra.set + 1} · ${baseLabel}` : baseLabel
    groups.get(regra.group).rows.push({ ...c, ...regra, label })
  }
  return { groups: [...groups.values()], other }
}

const num = v => (typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v)
export const fmtValue = (v, empty) => {
  if (v === null || v === undefined || v === '') return empty
  if (typeof v === 'object') return JSON.stringify(v)
  return String(num(v))
}
