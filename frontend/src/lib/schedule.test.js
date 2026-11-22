import { describe, it, expect } from 'vitest'
import {
  dayIdsOf,
  encodeDayIds,
  dayModeOf,
  scheduleModeOf,
  rotationItemsOf,
  rotationProgress,
  routineDaysMap,
  fixedExtraDays,
  effectiveRoutineIdsForDate,
  advanceRotationOnFinish,
  sweepRoutineFromSchedule,
} from './schedule.js'

const mkState = (over = {}) => ({
  routines: [
    { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3 }] },
    { id: 'r2', name: 'Pull', ex: [{ id: '0027', sets: 3 }] },
    { id: 'r3', name: 'Legs', ex: [{ id: '0043', sets: 3 }] },
  ],
  week: { 1: 'r1', 3: 'r2', 5: 'r3' },
  weekMode: {},
  scheduleMode: 'fixed',
  rotation: [],
  dayPlan: {},
  ...over,
})

describe('schedule helpers', () => {
  it('normalizes and encodes single vs multi-routine days cleanly', () => {
    expect(dayIdsOf(undefined)).toEqual([])
    expect(dayIdsOf('rest')).toEqual([])
    expect(dayIdsOf('r1')).toEqual(['r1'])
    expect(dayIdsOf(['r1', 'r2'])).toEqual(['r1', 'r2'])

    expect(encodeDayIds([])).toBeUndefined()
    expect(encodeDayIds(['r1'])).toBe('r1')
    expect(encodeDayIds(['r1', 'r2', 'r1'])).toEqual(['r1', 'r2'])
  })

  it('resolves fixed week and dayPlan overrides including multi-routine days', () => {
    const s = mkState({ week: { 1: ['r1', 'r2'], 5: 'r3' }, weekMode: { 1: 'separate' } })
    expect(dayModeOf(s, 1)).toBe('separate')
    expect(dayModeOf(s, 5)).toBe('together')
    // 2026-11-23 is Monday
    expect(effectiveRoutineIdsForDate(s, '2026-11-23', '2026-11-23')).toEqual(['r1', 'r2'])
    // override with rest
    s.dayPlan['2026-11-23'] = 'rest'
    expect(effectiveRoutineIdsForDate(s, '2026-11-23', '2026-11-23')).toEqual([])
    // override with another routine
    s.dayPlan['2026-11-23'] = 'r3'
    expect(effectiveRoutineIdsForDate(s, '2026-11-23', '2026-11-23')).toEqual(['r3'])
  })

  it('tracks rotation progress, advances on finish, and keeps non-loop fixed days separate', () => {
    const s = mkState({
      scheduleMode: 'rotation',
      rotation: [
        { id: 'a', rid: 'r1', done: false },
        { id: 'b', rid: 'rest', done: false },
        { id: 'c', rid: 'r2', done: false },
      ],
    })
    expect(scheduleModeOf(s)).toBe('rotation')
    expect(rotationItemsOf(s).length).toBe(3)
    expect(rotationProgress(s).nextIdx).toBe(0)
    // Extra fixed day: Friday (r3) is not in loop; Monday (r1) and Wednesday (r2) are in loop
    expect(fixedExtraDays(s)).toEqual([{ d: 5, ids: ['r3'] }])

    // On Sunday 2026-11-22 (no fixed extra), today gets next in loop ('r1')
    expect(effectiveRoutineIdsForDate(s, '2026-11-22', '2026-11-22')).toEqual(['r1'])
    // On Friday 2026-11-27 (fixed extra r3), r3 takes priority
    expect(effectiveRoutineIdsForDate(s, '2026-11-27', '2026-11-27')).toEqual(['r3'])

    advanceRotationOnFinish(s, 'r1')
    expect(rotationProgress(s).doneCount).toBe(1)
    expect(rotationProgress(s).nextIdx).toBe(1)
    // Next slot is rest
    expect(effectiveRoutineIdsForDate(s, '2026-11-22', '2026-11-22')).toEqual([])
  })

  it('maps routine days and sweeps deleted routines across week and rotation', () => {
    const s = mkState({
      week: { 1: ['r1', 'r2'], 3: 'r2', 5: 'r3' },
      weekMode: { 1: 'separate' },
      rotation: [{ id: 'a', rid: 'r2', done: false }, { id: 'b', rid: 'r1', done: false }],
      dayPlan: { '2026-11-23': 'r2' },
    })
    expect(routineDaysMap(s)).toEqual({ r1: [1], r2: [1, 3], r3: [5] })

    sweepRoutineFromSchedule(s, 'r2')
    expect(s.week[1]).toBe('r1')
    expect(s.weekMode[1]).toBeUndefined()
    expect(s.week[3]).toBeUndefined()
    expect(s.dayPlan['2026-11-23']).toBeUndefined()
    expect(s.rotation.map(x => x.rid)).toEqual(['r1'])
  })
})
