// api/units.js — a unidade de um peso, do lado do servidor (BACKLOG-01).
//
// Cópia deliberada de `frontend/src/lib/units.js`: `api/` é um pacote separado (Dockerfile
// próprio) e não enxerga `frontend/src/`. Mesmo precedente de `api/coach.js` (matemática
// portada de process_workout.py) e de `api/routines.js` (`= isValidRest (useStore.js:19)`).
// Ao mudar uma das duas cópias, mude a outra — `api/coach.test.js` fixa os números.
export const LB_TO_KG = 0.45359237

export const normUnit = v => (String(v ?? '').trim().toLowerCase().startsWith('lb') ? 'lb' : 'kg')
export const isLb = v => normUnit(v) === 'lb'
export const kgFactor = v => (isLb(v) ? LB_TO_KG : 1)
export const toKg = (w, unit) => (Number(w) || 0) * kgFactor(unit)
export const fromKg = (kg, unit) => Math.round(((Number(kg) || 0) / kgFactor(unit)) * 10) / 10

// A unidade de uma série, na ordem canônica: override da série → prescrição da sessão → perfil.
export const unitOfSet = (s, entry, profileUnit) => normUnit(
  s && s.wUnit != null ? s.wUnit
    : entry && entry.target && entry.target.unit != null ? entry.target.unit
      : profileUnit)
