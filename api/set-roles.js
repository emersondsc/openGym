// Papeis por serie e classes contabeis (docs/designs/design_roles_serie.md).
// Modulo puro: compartilhado entre openGym/api, frontend/src/lib e opengym-mcp/app-api.

export const BASE_CLASSES = ['prep', 'standard', 'intensified'];
export const NATIVE_SET_ROLES = ['work', 'backoff', 'warmup', 'feeder', 'pap'];
export const BASE_CLASS_OF_NATIVE = Object.freeze({
  work: 'standard',
  backoff: 'standard',
  warmup: 'prep',
  feeder: 'prep',
  pap: 'prep'
});
export const ROLE_NAME_KEY = Object.freeze({
  work: 'Working',
  backoff: 'Back-off',
  warmup: 'Warm-up',
  feeder: 'Feeder',
  pap: 'PAP'
});

export const CUSTOM_ROLE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_ACTIVE_CUSTOM_ROLES = 30;
export const MAX_TOTAL_CUSTOM_ROLES = 100;
export const MAX_ROLE_NAME = 32;
const MAX_SETS = 20;
const MAX_WEIGHT = 1000;
const MAX_REPS = 100;
const SET_REP_RANGE_RE = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/;
const SET_RIR_RANGE_RE = /^\s*(\d(?:\.5)?)\s*-\s*(\d(?:\.5)?)\s*$/;

const rirNumOk = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 4 && Math.round(n * 2) === n * 2;
const checkTargetRir = v => {
  if (typeof v === 'number') return rirNumOk(v);
  const m = typeof v === 'string' ? SET_RIR_RANGE_RE.exec(v) : null;
  return !!m && rirNumOk(+m[1]) && rirNumOk(+m[2]) && +m[1] < +m[2];
};
const cleanTargetRir = v => {
  if (typeof v === 'number') return v;
  const m = SET_RIR_RANGE_RE.exec(String(v));
  return m ? `${+m[1]}-${+m[2]}` : v;
};

export function isValidSetReps(v) {
  if (Number.isInteger(v)) return v >= 1 && v <= MAX_REPS;
  if (typeof v !== 'string') return false;
  const m = SET_REP_RANGE_RE.exec(v);
  return !!m && +m[1] >= 1 && +m[1] <= +m[2] && +m[2] <= MAX_REPS;
}

export function normSetReps(v) {
  if (Number.isInteger(v)) return v;
  if (typeof v !== 'string') return v;
  const m = SET_REP_RANGE_RE.exec(v);
  if (!m) return v;
  const a = +m[1], b = +m[2];
  return a === b ? a : `${a}-${b}`;
}

export function resolveRoleClass(role, customRoles = []) {
  if (!role || role === 'work') return 'standard';
  if (Object.hasOwn(BASE_CLASS_OF_NATIVE, role)) return BASE_CLASS_OF_NATIVE[role];
  const found = Array.isArray(customRoles) ? customRoles.find(c => c && c.id === role) : null;
  return found && BASE_CLASSES.includes(found.baseClass) ? found.baseClass : 'standard';
}

export function resolveRoleName(role, customRoles = [], tr = x => x) {
  if (!role || role === 'work') return tr(ROLE_NAME_KEY.work);
  if (Object.hasOwn(ROLE_NAME_KEY, role)) return tr(ROLE_NAME_KEY[role]);
  const found = Array.isArray(customRoles) ? customRoles.find(c => c && c.id === role && typeof c.name === 'string' && c.name) : null;
  return found ? found.name : tr(ROLE_NAME_KEY.work);
}

export function goalSignature(st) {
  const role = st?.role && st.role !== 'work' ? st.role : 'work';
  const weight = st?.weight != null ? Number(st.weight) : null;
  const reps = st?.reps != null ? normSetReps(st.reps) : null;
  const targetRir = st?.targetRir != null ? String(cleanTargetRir(st.targetRir)) : null;
  return JSON.stringify([role, weight, reps, targetRir]);
}

export function validateCustomSetRoles(list) {
  if (list === undefined) return null;
  if (!Array.isArray(list)) return 'customSetRoles must be an array';
  if (list.length > MAX_TOTAL_CUSTOM_ROLES) return `customSetRoles exceeds limit of ${MAX_TOTAL_CUSTOM_ROLES}`;
  const seen = new Set();
  let active = 0;
  for (const r of list) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return 'customSetRole must be an object';
    if (typeof r.id !== 'string' || !CUSTOM_ROLE_ID_RE.test(r.id) || NATIVE_SET_ROLES.includes(r.id)) {
      return 'customSetRole.id invalid or collides with native role';
    }
    if (seen.has(r.id)) return `duplicate customSetRole id "${r.id}"`;
    seen.add(r.id);
    if (typeof r.name !== 'string' || !r.name.trim() || [...r.name.trim()].length > MAX_ROLE_NAME) {
      return `customSetRole.name must be 1..${MAX_ROLE_NAME} chars`;
    }
    if (!BASE_CLASSES.includes(r.baseClass)) return 'customSetRole.baseClass must be prep|standard|intensified';
    if (r.deleted !== undefined && typeof r.deleted !== 'boolean') return 'customSetRole.deleted must be boolean';
    if (!r.deleted) active++;
  }
  if (active > MAX_ACTIVE_CUSTOM_ROLES) return `active customSetRoles exceeds limit of ${MAX_ACTIVE_CUSTOM_ROLES}`;
  return null;
}

export function validateSetTargets(e, customRoles = [], opt = {}) {
  if (e.setTargets === undefined) return null;
  const { where = 'ex', strictRoles = false, isValidTargetRir = checkTargetRir } = opt;
  const bad = (code, field, message) => ({ code, field: `${where}.${field}`, message });
  const mode = e.mode === 'normal' ? 'reps' : (e.mode || 'reps');
  if (mode !== 'reps') return bad('SET_TARGETS_REPS_ONLY', 'setTargets', 'setTargets is only valid for mode "reps"');
  if (!Array.isArray(e.setTargets) || e.setTargets.length < 1 || e.setTargets.length > MAX_SETS) {
    return bad('BAD_SET_TARGETS', 'setTargets', `setTargets must be an array of 1..${MAX_SETS} items`);
  }
  if (e.sets !== undefined && e.setTargets.length !== e.sets) {
    return bad('BAD_SET_TARGETS', 'setTargets', 'setTargets length must match sets');
  }
  let goalSig = null;
  for (let i = 0; i < e.setTargets.length; i++) {
    const st = e.setTargets[i];
    if (!st || typeof st !== 'object' || Array.isArray(st)) {
      return bad('BAD_SET_TARGETS', `setTargets[${i}]`, 'setTarget item must be an object');
    }
    if (st.role !== undefined && st.role !== null && st.role !== 'work') {
      if (typeof st.role !== 'string' || !CUSTOM_ROLE_ID_RE.test(st.role)) {
        return bad('BAD_SET_TARGET_ROLE', `setTargets[${i}].role`, 'invalid role identifier');
      }
      if (strictRoles && !NATIVE_SET_ROLES.includes(st.role)) {
        const activeCustom = Array.isArray(customRoles) && customRoles.some(c => c && c.id === st.role && !c.deleted);
        if (!activeCustom) {
          return bad('UNKNOWN_SET_ROLE', `setTargets[${i}].role`, `unknown or deleted custom role "${st.role}"`);
        }
      }
    }
    if (st.weight !== undefined && st.weight !== null) {
      if (typeof st.weight !== 'number' || !Number.isFinite(st.weight) || st.weight < 0 || st.weight > MAX_WEIGHT) {
        return bad('BAD_SET_TARGET_WEIGHT', `setTargets[${i}].weight`, `weight must be 0..${MAX_WEIGHT}`);
      }
    }
    if (st.reps !== undefined && st.reps !== null && !isValidSetReps(st.reps)) {
      return bad('BAD_SET_TARGET_REPS', `setTargets[${i}].reps`, `reps must be integer 1..${MAX_REPS} or range "A-B"`);
    }
    const cls = resolveRoleClass(st.role, customRoles);
    if (st.targetRir !== undefined && st.targetRir !== null) {
      if (cls === 'prep') {
        return bad('BAD_PREP_TARGET_RIR', `setTargets[${i}].targetRir`, 'prep sets cannot declare targetRir');
      }
      if (!isValidTargetRir(st.targetRir)) {
        return bad('BAD_TARGET_RIR', `setTargets[${i}].targetRir`, 'targetRir must be 0..4 in steps of 0.5, or "A-B"');
      }
    }
    if (st.goal !== undefined && typeof st.goal !== 'boolean') {
      return bad('BAD_SET_TARGETS', `setTargets[${i}].goal`, 'goal must be a boolean');
    }
    if (st.goal === true) {
      if (cls === 'prep') {
        return bad('BAD_PREP_GOAL', `setTargets[${i}].goal`, 'prep sets cannot be marked as Goal');
      }
      const sig = goalSignature(st);
      if (goalSig === null) goalSig = sig;
      else if (sig !== goalSig) {
        return bad('CONFLICTING_GOAL_SIGNATURES', 'setTargets', 'all Goal sets must share the same signature');
      }
    }
  }
  return null;
}

export function normSetTargetsEntry(e, customRoles = [], opt = {}) {
  const { isValidTargetRir = checkTargetRir, normTargetRir = cleanTargetRir } = opt;
  if (!e || typeof e !== 'object') return e;
  if (!Array.isArray(e.setTargets) || !e.setTargets.length) return e;
  const items = e.setTargets.map(raw => {
    const out = {};
    const role = raw?.role && raw.role !== 'work' ? raw.role : undefined;
    if (role) out.role = role;
    const cls = resolveRoleClass(role, customRoles);
    if (raw?.weight != null && Number.isFinite(Number(raw.weight))) out.weight = Number(raw.weight);
    if (raw?.reps != null && isValidSetReps(raw.reps)) out.reps = normSetReps(raw.reps);
    if (cls !== 'prep' && raw?.targetRir != null && isValidTargetRir(raw.targetRir)) {
      const n = normTargetRir(raw.targetRir);
      if (n !== undefined) out.targetRir = n;
    }
    if (cls !== 'prep' && raw?.goal === true) out.goal = true;
    return out;
  });

  // Compacta de volta para formato plano se todas forem 'work' identicas em carga/reps/targetRir.
  const firstSig = goalSignature({ ...items[0], role: 'work' });
  const allUniformWork = items.every(st => !st.role && goalSignature({ ...st, role: 'work' }) === firstSig);
  e.sets = items.length;
  if (allUniformWork) {
    delete e.setTargets;
    if (items[0].weight !== undefined) e.weight = items[0].weight;
    if (items[0].reps !== undefined) e.reps = items[0].reps;
    if (items[0].targetRir !== undefined) e.targetRir = items[0].targetRir;
    else delete e.targetRir;
    return e;
  }

  e.setTargets = items;
  const goalItem = items.find(st => st.goal === true);
  const stdItem = items.find(st => resolveRoleClass(st.role, customRoles) === 'standard');
  const model = goalItem || stdItem || items[0];
  if (model.weight !== undefined) e.weight = model.weight;
  if (model.reps !== undefined) e.reps = model.reps;
  if (model.targetRir !== undefined) e.targetRir = model.targetRir;
  else delete e.targetRir;
  return e;
}

export function sanitizeRoutineEntry(e, customRoles = [], opt = {}) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return;
  const mode = e.mode === 'normal' ? 'reps' : (e.mode || 'reps');
  if (mode !== 'reps') {
    delete e.setTargets;
    return;
  }
  if (!Array.isArray(e.setTargets)) return;
  if (!e.setTargets.length) {
    delete e.setTargets;
    return;
  }
  const sets = Number.isInteger(e.sets) && e.sets >= 1 && e.sets <= MAX_SETS ? e.sets : Math.min(MAX_SETS, e.setTargets.length);
  e.sets = sets;
  if (e.setTargets.length > sets) e.setTargets = e.setTargets.slice(0, sets);
  while (e.setTargets.length < sets) {
    const lastStd = [...e.setTargets].reverse().find(st => st && resolveRoleClass(st.role, customRoles) !== 'prep');
    e.setTargets.push(lastStd ? { ...lastStd } : { weight: e.weight ?? 0, reps: e.reps ?? 10 });
  }
  // Resolve goal conflicts passively keeping first signature
  let firstSig = null;
  for (const st of e.setTargets) {
    if (!st || typeof st !== 'object') continue;
    const cls = resolveRoleClass(st.role, customRoles);
    if (cls === 'prep') {
      delete st.targetRir;
      delete st.goal;
    } else if (st.goal === true) {
      const sig = goalSignature(st);
      if (firstSig === null) firstSig = sig;
      else if (sig !== firstSig) delete st.goal;
    }
  }
  normSetTargetsEntry(e, customRoles, opt);
}
