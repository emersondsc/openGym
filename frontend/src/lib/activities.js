// Portado do openGym v1.4.5 (`frontend/src/lib/activities.js`, 2026-11-06), reduzido à corrida.
// Campos do fork: sec, place, elev, hrAvg, hrMax, rpe, deleted. `at` não é gravado.
// Ao portar de novo, manter esses campos e os testes de ida e volta e de remoção.
//
// Spec: docs/specs/spec_corrida.md. Uma corrida é uma Atividade: um registro de um dia, sem séries,
// separado dos treinos. Guardada em S.activities, um mapa por id:
//
//   { d: 'AAAA-MM-DD', sport: 'run', km, sec, min, place: 'outdoor'|'treadmill',
//     elev?, hrAvg?, hrMax?, rpe?, note?, src: 'manual', _ts }
//   { deleted: true, _ts }                                    ← corrida excluída
//
// `readActivity` confere só a FORMA (os mesmos critérios de api/activities.js). Os limites do
// produto (km ≤ 300, FC, elevação...) valem só no formulário (`validateRun`): mudar um limite
// nunca apaga corridas no merge.
import { NOTE_MAX } from './notes.js'
import { fmtNum, todayISO, uid } from './format.js'

export const PLACES = ['outdoor', 'treadmill']
export const LIMITS = { kmMax: 300, secMin: 60, secMax: 86400, hrMin: 30, hrMax: 250, elevMax: 10000, rpeMin: 1, rpeMax: 10 }
export const PACE_WARN = [120, 1200]                  // segundos por km: 2:00 a 20:00
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
const OPT_NUM = ['elev', 'hrAvg', 'hrMax', 'rpe']

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const isNum = v => typeof v === 'number' && Number.isFinite(v)
const empty = v => v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))
export const round2 = v => Math.round(v * 100) / 100

/** Uma entrada gravada, limpa, ou null (excluída, outro esporte ou sem a forma de uma corrida). */
export function readActivity(e) {
  if (!isObj(e) || e.deleted === true || e.sport !== 'run') return null
  if (typeof e.d !== 'string' || !ISO_RE.test(e.d)) return null
  const km = isNum(e.km) ? round2(e.km) : NaN
  if (!(km > 0) || !Number.isInteger(e.sec) || e.sec <= 0) return null
  const out = { d: e.d, sport: 'run', km, sec: e.sec, min: Math.max(1, Math.round(e.sec / 60)) }
  out.place = PLACES.includes(e.place) ? e.place : 'outdoor'
  for (const k of OPT_NUM) if (isNum(e[k])) out[k] = e[k]
  if (typeof e.note === 'string') out.note = [...e.note].slice(0, NOTE_MAX).join('')
  out.src = typeof e.src === 'string' ? e.src : 'manual'
  return out
}

/** As corridas, da mais recente para a mais antiga (d, depois _ts). */
export function runsOf(S) {
  const map = isObj(S?.activities) ? S.activities : {}
  const out = []
  for (const [id, e] of Object.entries(map)) {
    const a = readActivity(e)
    if (a) out.push({ id, ...a, _ts: Number(e._ts) || 0 })
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b._ts - a._ts))
}
export const runsOn = (S, iso) => runsOf(S).filter(r => r.d === iso)
export const runDays = S => new Set(runsOf(S).map(r => r.d))

/** Grava ou edita: a entrada nova SUBSTITUI a antiga. Devolve { map, id }. */
export function withRun(map, id, fields, now = Date.now()) {
  const base = isObj(map) ? map : {}
  const useId = !id || base[id]?.deleted === true ? 'm' + uid() : id
  const e = { d: fields.d, sport: 'run', km: round2(fields.km), sec: fields.sec,
    min: Math.max(1, Math.round(fields.sec / 60)), place: PLACES.includes(fields.place) ? fields.place : 'outdoor' }
  for (const k of OPT_NUM) {
    if (k === 'elev' && e.place === 'treadmill') continue
    if (!empty(fields[k])) e[k] = fields[k]
  }
  if (!empty(fields.note)) {
    const n = String(fields.note).trim()
    if (n) e.note = [...n].slice(0, NOTE_MAX).join('')
  }
  e.src = 'manual'
  e._ts = now
  return { map: { ...base, [useId]: e }, id: useId }
}

/** Exclui: a chave fica, só com a marca e o carimbo. */
export function removeRun(map, id, now = Date.now()) {
  return { ...(isObj(map) ? map : {}), [id]: { deleted: true, _ts: now } }
}

// Cada lado do merge na forma normalizada: o que o servidor descartaria some aqui também.
function normalize(map) {
  const out = {}
  if (!isObj(map)) return out
  for (const [id, e] of Object.entries(map)) {
    if (!isObj(e)) continue
    const ts = Number(e._ts) || 0
    if (e.deleted === true) { out[id] = { deleted: true, _ts: ts }; continue }
    const a = readActivity(e)
    if (a) out[id] = { ...a, _ts: ts }
  }
  return out
}

/** Merge por id. Remoção sempre vence; entre duas ativas, _ts maior (empate: servidor). */
export function mergeActivities(srv, local) {
  const s = normalize(srv), l = normalize(local)
  const out = { ...s }
  for (const [id, b] of Object.entries(l)) {
    const a = s[id]
    if (!a) { out[id] = b; continue }
    if (a.deleted && b.deleted) out[id] = b._ts > a._ts ? b : a
    else if (a.deleted) out[id] = a
    else if (b.deleted) out[id] = b
    else out[id] = b._ts > a._ts ? b : a
  }
  return out
}

/** "5,2" ou "5.2" → 5.2. Qualquer outra coisa → null. */
export function parseKm(text) {
  const s = String(text ?? '').trim()
  if (!/^\d+([.,]\d+)?$/.test(s)) return null
  return Number(s.replace(',', '.'))
}

/** "28" (minutos), "28:41" ou "1:02:05" → segundos. Qualquer outra coisa → null. */
export function parseDuration(text) {
  const s = String(text ?? '').trim()
  let m
  if ((m = /^(\d+)$/.exec(s))) return Number(m[1]) * 60
  if ((m = /^(\d+):(\d{2})$/.exec(s))) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null
  if ((m = /^(\d+):(\d{2}):(\d{2})$/.exec(s))) {
    return Number(m[2]) < 60 && Number(m[3]) < 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
  }
  return null
}

const pad2 = n => String(n).padStart(2, '0')
export function fmtDuration(sec) {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`
}
export const paceOf = (km, sec) => sec / km
export function fmtPace(secPerKm) {
  const s = Math.round(secPerKm)
  return `${Math.floor(s / 60)}:${pad2(s % 60)}/km`
}
export const fmtKm = km => fmtNum(km) + ' km'

/** Erros (chaves de i18n por campo) e avisos (lista de chaves) do formulário. */
export function validateRun(f, today = todayISO()) {
  const errors = {}
  const warnings = []
  const km = f.km == null || Number.isNaN(f.km) ? null : round2(f.km)
  if (!f.d) errors.d = 'Required'
  else if (f.d > today) errors.d = 'Date in the future'
  if (km == null) errors.km = 'Required'
  else if (!(km > 0 && km <= LIMITS.kmMax)) errors.km = 'Distance must be between 0 and 300 km'
  if (f.sec == null || Number.isNaN(f.sec)) errors.sec = 'Required'
  else if (f.sec < LIMITS.secMin || f.sec > LIMITS.secMax) errors.sec = 'Time must be between 1:00 and 24:00:00'
  for (const k of ['hrAvg', 'hrMax']) {
    if (!empty(f[k]) && !(f[k] >= LIMITS.hrMin && f[k] <= LIMITS.hrMax)) errors[k] = 'Heart rate must be between 30 and 250'
  }
  if (!errors.hrAvg && !errors.hrMax && !empty(f.hrAvg) && !empty(f.hrMax) && f.hrMax < f.hrAvg) errors.hrMax = 'Max heart rate is below average'
  if (!empty(f.elev) && f.place !== 'treadmill' && !(f.elev >= 0 && f.elev <= LIMITS.elevMax)) errors.elev = 'Elevation must be between 0 and 10,000 m'
  if (!empty(f.rpe) && !(Number.isInteger(f.rpe) && f.rpe >= LIMITS.rpeMin && f.rpe <= LIMITS.rpeMax)) errors.rpe = 'Effort must be 1 to 10'
  if (!errors.km && !errors.sec) {
    const p = paceOf(km, f.sec)
    if (p < PACE_WARN[0] || p > PACE_WARN[1]) warnings.push('Unusual pace, check distance and time')
  }
  return { errors, warnings }
}
