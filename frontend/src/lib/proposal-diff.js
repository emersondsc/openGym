// Organiza a diferença que a API simulou. Função pura: toda folha sai exatamente uma vez, e o que
// não tiver visual próprio cai em `other`, para nada de um plano ficar invisível.
const CAMPO = { weight: 'Weight', sets: 'Sets', reps: 'Reps', restSec: 'Rest', unit: 'Unit', mode: 'Mode',
  name: 'Name', prog: 'Progression', w: 'Weight', r: 'Reps' }

const REGRAS = [
  [/^routines\.(\d+)\.ex\.(\d+)\.(.+)$/, m => ({ group: `routine:${m[1]}`, kind: 'routine', routine: +m[1], ex: +m[2], field: m[3] })],
  [/^routines\.(\d+)\.(.+)$/, m => ({ group: `routine:${m[1]}`, kind: 'routine', routine: +m[1], field: m[2] })],
  [/^dayPlan\.(.+)$/, m => ({ group: 'days', kind: 'days', day: m[1] })],
  [/^week\.(\d)$/, m => ({ group: 'days', kind: 'days', weekday: +m[1] })],
  [/^mesos\.(\d+)\.rules\.(.+)$/, m => ({ group: `rules:${m[1]}`, kind: 'rules', meso: +m[1], rule: m[2] })],
  [/^workouts\.(\d+)\.entries\.(\d+)\.sets\.(\d+)\.(.+)$/, m => ({ group: `workout:${m[1]}`, kind: 'workout', workout: +m[1], entry: +m[2], set: +m[3], field: m[4] })]
]

export function groupChanges(changes) {
  const groups = new Map()
  const other = []
  for (const c of changes) {
    const regra = REGRAS.map(([re, f]) => { const m = re.exec(c.path); return m && f(m) }).find(Boolean)
    if (!regra) { other.push(c); continue }
    if (!groups.has(regra.group)) groups.set(regra.group, { key: regra.group, kind: regra.kind, rows: [] })
    groups.get(regra.group).rows.push({ ...c, ...regra, label: CAMPO[regra.field] || regra.field || null })
  }
  return { groups: [...groups.values()], other }
}

const num = v => (typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v)
export const fmtValue = (v, empty) => {
  if (v === null || v === undefined || v === '') return empty
  if (typeof v === 'object') return JSON.stringify(v)
  return String(num(v))
}
