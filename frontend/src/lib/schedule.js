// Pure helpers for weekly schedules, multi-routine days, and loop rotation.
import { loadOfRoutine } from './muscles.js'

export const WEEK_MON_FIRST = [1, 2, 3, 4, 5, 6, 0]

/** Normalize a day entry (string, string[], object{ids}, 'rest', nullish) to routine id list. */
export function dayIdsOf(val) {
  if (!val || val === 'rest') return []
  if (typeof val === 'string') return [val]
  if (Array.isArray(val)) return val.filter(x => typeof x === 'string' && x && x !== 'rest')
  if (typeof val === 'object' && Array.isArray(val.ids)) {
    return val.ids.filter(x => typeof x === 'string' && x && x !== 'rest')
  }
  return []
}

/** Encode selected routine ids back into S.week[d]: single id stays a plain string for compatibility. */
export function encodeDayIds(ids) {
  const seen = new Set()
  const out = []
  for (const id of ids || []) {
    if (typeof id !== 'string' || !id || id === 'rest' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  if (!out.length) return undefined
  return out.length === 1 ? out[0] : out
}

export function dayModeOf(S, day) {
  return S?.weekMode?.[day] === 'separate' ? 'separate' : 'together'
}

export function scheduleModeOf(S) {
  return S?.scheduleMode === 'rotation' ? 'rotation' : 'fixed'
}

/** Normalize S.rotation entries to [{ id, rid, done }], dropping deleted routines (keeping 'rest'). */
export function rotationItemsOf(S) {
  const valid = new Set((S?.routines || []).map(r => r.id))
  const raw = Array.isArray(S?.rotation) ? S.rotation : []
  const out = []
  raw.forEach((item, i) => {
    if (typeof item === 'string') {
      if (item === 'rest' || valid.has(item)) out.push({ id: `rot-${i}`, rid: item, done: false })
      return
    }
    if (item && typeof item === 'object') {
      const rid = item.rid
      if (rid === 'rest' || valid.has(rid)) {
        out.push({ id: item.id || `rot-${i}`, rid, done: !!item.done })
      }
    }
  })
  return out
}

export function rotationProgress(S) {
  const items = rotationItemsOf(S)
  const total = items.length
  const doneCount = items.filter(x => x.done).length
  const firstUndone = items.findIndex(x => !x.done)
  const nextIdx = total ? (firstUndone >= 0 ? firstUndone : 0) : -1
  return { items, nextIdx, doneCount, total }
}

/** Map each routineId -> sorted weekday indices (Monday first) where it is scheduled. */
export function routineDaysMap(S) {
  const map = {}
  for (const d of WEEK_MON_FIRST) {
    for (const rid of dayIdsOf(S?.week?.[d])) {
      if (!map[rid]) map[rid] = []
      map[rid].push(d)
    }
  }
  return map
}

/** Fixed-day assignments whose routines are NOT already inside the rotation loop. */
export function fixedExtraDays(S) {
  const valid = new Set((S?.routines || []).map(r => r.id))
  const inLoop = new Set(rotationItemsOf(S).map(x => x.rid).filter(rid => rid !== 'rest'))
  const out = []
  for (const d of WEEK_MON_FIRST) {
    const ids = dayIdsOf(S?.week?.[d]).filter(id => valid.has(id) && !inLoop.has(id))
    if (ids.length) out.push({ d, ids })
  }
  return out
}

/**
 * Resolve effective routine IDs for an ISO date, respecting dayPlan overrides,
 * rotation loop ("Also on fixed days" + "Up next" for today), and multi-routine fixed days.
 */
export function effectiveRoutineIdsForDate(S, iso, todayIso) {
  const valid = new Set((S?.routines || []).map(r => r.id))
  const ov = S?.dayPlan?.[iso]
  if (ov === 'rest') return []
  const ovIds = dayIdsOf(ov).filter(id => valid.has(id))
  if (ovIds.length) return ovIds

  const wd = new Date(iso + 'T12:00:00').getDay()
  if (scheduleModeOf(S) === 'rotation') {
    const inLoop = new Set(rotationItemsOf(S).map(x => x.rid).filter(rid => rid !== 'rest'))
    const fixedExtras = dayIdsOf(S?.week?.[wd]).filter(id => valid.has(id) && !inLoop.has(id))
    if (fixedExtras.length) return fixedExtras
    if (!todayIso || iso === todayIso) {
      const { items, nextIdx } = rotationProgress(S)
      const next = nextIdx >= 0 ? items[nextIdx] : null
      if (next && next.rid !== 'rest' && valid.has(next.rid)) return [next.rid]
    }
    return []
  }

  return dayIdsOf(S?.week?.[wd]).filter(id => valid.has(id))
}

/** Sum muscle load across one or more routines for mini BodyMap previews. */
export function combinedLoadOfRoutines(routines) {
  const total = {}
  for (const r of routines || []) {
    const load = loadOfRoutine(r)
    for (const k in load) total[k] = (total[k] || 0) + load[k]
  }
  return total
}

/**
 * Advance S.rotation when a workout finishes.
 * Marks the next matching undone slot (or wraps to a new round if all were done).
 */
export function advanceRotationOnFinish(S, routineIds) {
  if (!S || scheduleModeOf(S) !== 'rotation' || !Array.isArray(S.rotation) || !S.rotation.length) return
  const ids = (Array.isArray(routineIds) ? routineIds : [routineIds]).filter(Boolean)
  if (!ids.length) return

  // If the current round was already complete, start a fresh round before marking.
  if (S.rotation.every(x => x && x.done)) {
    S.rotation.forEach(x => { if (x && typeof x === 'object') x.done = false })
  }
  for (const rid of ids) {
    const slot = S.rotation.find(x => x && !x.done && x.rid === rid)
    if (slot) slot.done = true
  }
}

/** Remove all references to a deleted routine across week, weekMode, dayPlan, and rotation. */
export function sweepRoutineFromSchedule(S, rid) {
  if (!S || !rid) return
  if (S.week) {
    for (const k of Object.keys(S.week)) {
      const next = encodeDayIds(dayIdsOf(S.week[k]).filter(id => id !== rid))
      if (next === undefined) {
        delete S.week[k]
        if (S.weekMode) delete S.weekMode[k]
      } else {
        S.week[k] = next
        if (typeof next === 'string' && S.weekMode) delete S.weekMode[k]
      }
    }
  }
  if (S.dayPlan) {
    for (const k of Object.keys(S.dayPlan)) {
      if (S.dayPlan[k] === rid) delete S.dayPlan[k]
      else if (Array.isArray(S.dayPlan[k])) {
        const next = encodeDayIds(dayIdsOf(S.dayPlan[k]).filter(id => id !== rid))
        if (next === undefined) delete S.dayPlan[k]
        else S.dayPlan[k] = next
      }
    }
  }
  if (Array.isArray(S.rotation)) {
    S.rotation = S.rotation.filter(x => (typeof x === 'string' ? x !== rid : x?.rid !== rid))
  }
}
