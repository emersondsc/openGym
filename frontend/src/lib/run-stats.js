// Contas do cartão "Corrida" (docs/specs/spec_corrida.md, Technical Plan §6 e DIP §6).
// `runs` é sempre a saída de runsOf (da mais recente para a mais antiga); datas são ISO locais.
// A semana começa na segunda, como o Calendar e o weekKey de lib/format.js.
import { isoOf } from './format.js'

/** A segunda-feira da semana de `iso`, em ISO. */
export function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return isoOf(d)
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}
const round2 = v => Math.round(v * 100) / 100

/** [{ start, km }] das `n` semanas até a de `today`, da mais antiga para a atual. */
export function weeklyKm(runs, today, n = 8) {
  const last = mondayOf(today)
  const weeks = []
  for (let i = n - 1; i >= 0; i--) weeks.push({ start: addDays(last, -7 * i), km: 0 })
  const idx = new Map(weeks.map((w, i) => [w.start, i]))
  for (const r of runs) {
    const i = idx.get(mondayOf(r.d))
    if (i !== undefined) weeks[i].km += r.km
  }
  for (const w of weeks) w.km = round2(w.km)
  return weeks
}

export const thisWeekKm = (runs, today) => weeklyKm(runs, today, 1)[0].km

/** A corrida de maior km; no empate, a mais recente (a primeira em `runs`). */
export function longestRun(runs) {
  let best = null
  for (const r of runs) if (!best || r.km > best.km) best = r
  return best
}

/** Σsec ÷ Σkm das `n` corridas mais recentes, ou null. */
export function avgPaceLast(runs, n = 5) {
  const xs = runs.slice(0, n)
  if (!xs.length) return null
  const km = xs.reduce((a, r) => a + r.km, 0)
  return xs.reduce((a, r) => a + r.sec, 0) / km
}

/** { pace, run } com o menor sec/km entre as corridas com km ≥ minKm; no empate, a mais recente. */
export function bestPace(runs, minKm) {
  let best = null
  for (const r of runs) {
    if (r.km < minKm) continue
    const pace = r.sec / r.km
    if (!best || pace < best.pace) best = { pace, run: r }
  }
  return best
}
