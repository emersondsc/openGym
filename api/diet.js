// api/diet.js — armazenamento por usuário de planos de dieta: validação de forma,
// biblioteca por id, ativação, remoção e controle de concorrência (If-Match + rev).
//
// Os planos vivem em DATA_DIR/diet-<uid>.json (isolados de state-<uid>.json para que
// sincronizações de treino via PUT /api/data nunca sobrescrevam a dieta).
//
// Regra de contrato (mesmo padrão de api/meso.js): a API valida FORMA e limites, nunca
// política nutricional, e preserva campos extras desconhecidos em qualquer nível.
import fs from 'node:fs';
import { appendAudit, canon, checkIfMatch, parseIfMatch, sha256, stateMeta } from './routines.js';

export const DIET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_DIET_BYTES = 64 * 1024;
export const MAX_DIET_PLANS = 40;
export const MAX_MEALS = 20;
export const MAX_MEAL_ITEMS = 50;
export const MAX_RULES = 40;
export const MAX_LOG = 200;
export const MAX_TIPS = 30;
export const MAX_MARKDOWN_CHARS = 32000;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDate = s => {
  if (!ISO.test(String(s || ''))) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const tooLong = (v, n) => typeof v === 'string' && v.trim().length > n;
const isFinNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isNumOrRange = (v, min, max) => {
  if (isFinNum(v, min, max)) return true;
  if (!isObj(v)) return false;
  return isFinNum(v.min, min, max) && isFinNum(v.max, min, max) && v.min <= v.max;
};

/** Tamanho em bytes do objeto como será gravado. */
export const dietBytes = p => Buffer.byteLength(JSON.stringify(p), 'utf8');

function validateStringOrList(v, code, field, maxStr, maxList, maxItem) {
  if (v == null) return null;
  if (typeof v === 'string') {
    if (v.length > maxStr) return { error: `${field} must be <= ${maxStr} chars`, code, field };
    return null;
  }
  if (Array.isArray(v)) {
    if (v.length > maxList) return { error: `${field} must have <= ${maxList} items`, code, field };
    for (const item of v) {
      if (typeof item !== 'string' || !item.trim() || item.length > maxItem) {
        return { error: `${field} items must be non-empty strings <= ${maxItem} chars`, code, field };
      }
    }
    return null;
  }
  return { error: `${field} must be a string or list of strings`, code, field };
}

/**
 * Valida a forma do plano de dieta. Devolve null quando passa, ou { error, code, field }.
 * Campos desconhecidos são preservados em qualquer nível.
 */
export function validateDietBody(plan) {
  if (!isObj(plan)) {
    return { error: 'plan required', code: 'DIET_REQUIRED', field: 'plan' };
  }
  if (!DIET_ID_RE.test(String(plan.id || ''))) {
    return { error: 'id must match ^[A-Za-z0-9_-]{1,64}$', code: 'BAD_DIET_ID', field: 'id' };
  }
  if (!plan.name || typeof plan.name !== 'string' || !plan.name.trim()) {
    return { error: 'name required', code: 'BAD_DIET_NAME', field: 'name' };
  }
  if (tooLong(plan.name, 120)) {
    return { error: 'name must be <= 120 chars', code: 'BAD_DIET_NAME', field: 'name' };
  }
  if (plan.goal != null && (typeof plan.goal !== 'string' || tooLong(plan.goal, 400))) {
    return { error: 'goal must be a string <= 400 chars', code: 'BAD_DIET_GOAL', field: 'goal' };
  }
  if (plan.referenceDate != null && !realDate(plan.referenceDate)) {
    return { error: 'referenceDate must be a real ISO date', code: 'BAD_DIET_DATE', field: 'referenceDate' };
  }
  if (plan.start != null && !realDate(plan.start)) {
    return { error: 'start must be a real ISO date', code: 'BAD_DIET_START', field: 'start' };
  }
  if (plan.end != null && (!realDate(plan.end) || (plan.start != null && plan.end < plan.start))) {
    return { error: 'end must be a real ISO date >= start', code: 'BAD_DIET_END', field: 'end' };
  }
  if (plan.origin != null && plan.origin !== 'user' && plan.origin !== 'assistant') {
    return { error: 'origin must be user or assistant', code: 'BAD_DIET_ORIGIN', field: 'origin' };
  }

  if (plan.profile != null) {
    if (!isObj(plan.profile)) {
      return { error: 'profile must be an object', code: 'BAD_DIET_PROFILE', field: 'profile' };
    }
    const p = plan.profile;
    if (p.sex != null && (typeof p.sex !== 'string' || p.sex.trim().length > 40)) {
      return { error: 'profile.sex must be a string <= 40 chars', code: 'BAD_DIET_PROFILE', field: 'profile' };
    }
    if (p.age != null && !(typeof p.age === 'number' && Number.isFinite(p.age) && p.age > 0 && p.age <= 150)) {
      return { error: 'profile.age must be > 0 and <= 150', code: 'BAD_DIET_PROFILE', field: 'profile' };
    }
    if (p.heightCm != null && !(typeof p.heightCm === 'number' && Number.isFinite(p.heightCm) && p.heightCm > 0 && p.heightCm <= 300)) {
      return { error: 'profile.heightCm must be > 0 and <= 300', code: 'BAD_DIET_PROFILE', field: 'profile' };
    }
    if (p.weightKg != null && !(typeof p.weightKg === 'number' && Number.isFinite(p.weightKg) && p.weightKg > 0 && p.weightKg <= 500)) {
      return { error: 'profile.weightKg must be > 0 and <= 500', code: 'BAD_DIET_PROFILE', field: 'profile' };
    }
    if (p.bmi != null && !(typeof p.bmi === 'number' && Number.isFinite(p.bmi) && p.bmi > 0 && p.bmi <= 150)) {
      return { error: 'profile.bmi must be > 0 and <= 150', code: 'BAD_DIET_PROFILE', field: 'profile' };
    }
  }

  if (plan.targets != null) {
    if (!isObj(plan.targets)) {
      return { error: 'targets must be an object', code: 'BAD_DIET_TARGETS', field: 'targets' };
    }
    const t = plan.targets;
    for (const k of ['bmrKcal', 'tdeeKcal', 'dailyKcal', 'deficitKcal', 'weeklyDeficitKcal']) {
      if (t[k] != null && !isNumOrRange(t[k], 0, 50000)) {
        return { error: `targets.${k} must be a number or {min,max} in 0..50000`, code: 'BAD_DIET_TARGETS', field: 'targets' };
      }
    }
    for (const k of ['dailyKcalMin', 'dailyKcalMax', 'deficitKcalMin', 'deficitKcalMax']) {
      if (t[k] != null && !isFinNum(t[k], 0, 50000)) {
        return { error: `targets.${k} must be a number 0..50000`, code: 'BAD_DIET_TARGETS', field: 'targets' };
      }
    }
    if (t.dailyKcalMin != null && t.dailyKcalMax != null && t.dailyKcalMin > t.dailyKcalMax) {
      return { error: 'targets.dailyKcalMin must be <= dailyKcalMax', code: 'BAD_DIET_TARGETS', field: 'targets' };
    }
    if (t.deficitKcalMin != null && t.deficitKcalMax != null && t.deficitKcalMin > t.deficitKcalMax) {
      return { error: 'targets.deficitKcalMin must be <= deficitKcalMax', code: 'BAD_DIET_TARGETS', field: 'targets' };
    }
    if (t.expectedWeeklyLossKg != null && !isNumOrRange(t.expectedWeeklyLossKg, 0, 20)) {
      return { error: 'targets.expectedWeeklyLossKg must be 0..20', code: 'BAD_DIET_TARGETS', field: 'targets' };
    }
    if (t.macros != null) {
      if (!isObj(t.macros)) {
        return { error: 'targets.macros must be an object', code: 'BAD_DIET_MACROS', field: 'targets' };
      }
      for (const mk of ['proteinG', 'carbsG', 'fatG', 'fiberG']) {
        if (t.macros[mk] != null && !isNumOrRange(t.macros[mk], 0, 2000)) {
          return { error: `targets.macros.${mk} must be 0..2000`, code: 'BAD_DIET_MACROS', field: 'targets' };
        }
      }
    }
  }

  if (plan.meals != null) {
    if (!Array.isArray(plan.meals) || plan.meals.length > MAX_MEALS) {
      return { error: `meals must be an array of <= ${MAX_MEALS} items`, code: 'BAD_DIET_MEALS', field: 'meals' };
    }
    for (const m of plan.meals) {
      if (!isObj(m)) {
        return { error: 'meal must be an object', code: 'BAD_DIET_MEAL', field: 'meals' };
      }
      if (m.id != null && !DIET_ID_RE.test(String(m.id))) {
        return { error: 'meal.id must match ^[A-Za-z0-9_-]{1,64}$', code: 'BAD_DIET_MEAL', field: 'meals' };
      }
      if (!m.name || typeof m.name !== 'string' || !m.name.trim() || m.name.trim().length > 80) {
        return { error: 'meal.name must be 1..80 chars', code: 'BAD_DIET_MEAL', field: 'meals' };
      }
      if (m.kcal != null && !isNumOrRange(m.kcal, 0, 20000)) {
        return { error: 'meal.kcal must be 0..20000', code: 'BAD_DIET_MEAL', field: 'meals' };
      }
      if (m.time != null && (typeof m.time !== 'string' || m.time.trim().length > 20)) {
        return { error: 'meal.time must be <= 20 chars', code: 'BAD_DIET_MEAL', field: 'meals' };
      }
      if (m.notes != null && (typeof m.notes !== 'string' || m.notes.length > 1000)) {
        return { error: 'meal.notes must be <= 1000 chars', code: 'BAD_DIET_MEAL', field: 'meals' };
      }
      if (m.items != null) {
        if (!Array.isArray(m.items) || m.items.length > MAX_MEAL_ITEMS) {
          return { error: `meal.items must be an array of <= ${MAX_MEAL_ITEMS}`, code: 'BAD_DIET_MEAL_ITEMS', field: 'meals' };
        }
        for (const it of m.items) {
          if (typeof it === 'string') {
            if (!it.trim() || it.length > 300) {
              return { error: 'meal item string must be 1..300 chars', code: 'BAD_DIET_MEAL_ITEMS', field: 'meals' };
            }
          } else if (isObj(it)) {
            const label = it.food ?? it.name;
            if (!label || typeof label !== 'string' || !label.trim() || label.trim().length > 160) {
              return { error: 'meal item food/name must be 1..160 chars', code: 'BAD_DIET_MEAL_ITEMS', field: 'meals' };
            }
            if (it.amount != null && !isFinNum(it.amount, 0, 100000)) {
              return { error: 'meal item amount must be >= 0', code: 'BAD_DIET_MEAL_ITEMS', field: 'meals' };
            }
            if (it.unit != null && (typeof it.unit !== 'string' || it.unit.trim().length > 40)) {
              return { error: 'meal item unit must be <= 40 chars', code: 'BAD_DIET_MEAL_ITEMS', field: 'meals' };
            }
            for (const nk of ['kcal', 'proteinG', 'carbsG', 'fatG']) {
              if (it[nk] != null && !isFinNum(it[nk], 0, 20000)) {
                return { error: `meal item ${nk} must be >= 0`, code: 'BAD_DIET_MEAL_ITEMS', field: 'meals' };
              }
            }
            if (it.note != null && (typeof it.note !== 'string' || it.note.length > 400)) {
              return { error: 'meal item note must be <= 400 chars', code: 'BAD_DIET_MEAL_ITEMS', field: 'meals' };
            }
          } else {
            return { error: 'meal item must be a string or object', code: 'BAD_DIET_MEAL_ITEMS', field: 'meals' };
          }
        }
      }
    }
  }

  if (plan.rules != null) {
    if (!isObj(plan.rules)) {
      return { error: 'rules must be a map', code: 'BAD_DIET_RULES', field: 'rules' };
    }
    const keys = Object.keys(plan.rules);
    if (keys.length > MAX_RULES) {
      return { error: `too many rules (max ${MAX_RULES})`, code: 'BAD_DIET_RULES', field: 'rules' };
    }
    for (const k of keys) {
      if (!k.trim() || k.length > 60 || String(plan.rules[k]).length > 600) {
        return { error: 'rule label or value too long', code: 'BAD_DIET_RULES', field: 'rules' };
      }
    }
  }

  const badNotes = validateStringOrList(plan.notes, 'BAD_DIET_NOTES', 'notes', 4000, MAX_TIPS, 500);
  if (badNotes) return badNotes;

  const badTips = validateStringOrList(plan.executionTips, 'BAD_DIET_TIPS', 'executionTips', 4000, MAX_TIPS, 500);
  if (badTips) return badTips;

  if (plan.markdown != null && (typeof plan.markdown !== 'string' || plan.markdown.length > MAX_MARKDOWN_CHARS)) {
    return { error: `markdown must be a string <= ${MAX_MARKDOWN_CHARS} chars`, code: 'BAD_DIET_MARKDOWN', field: 'markdown' };
  }

  if (plan.log != null && (!Array.isArray(plan.log) || plan.log.length > MAX_LOG)) {
    return { error: `log must be a list of <= ${MAX_LOG} entries`, code: 'BAD_DIET_LOG', field: 'log' };
  }

  if (dietBytes(plan) > MAX_DIET_BYTES) {
    return { error: 'plan too large', code: 'DIET_TOO_BIG', field: 'plan' };
  }

  return null;
}

/* ---------------------------------------------------------------- leitura/escrita em disco */

const emptyDietStore = () => ({ rev: 0, _ts: null, activePlanId: null, prevPlanId: null, plans: [] });
const hasSafeUid = uid => !!String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * Lê DATA_DIR/diet-<uid>.json.
 * ENOENT -> loja vazia (rev 0); arquivo corrompido -> lança para não sobrescrever.
 */
export function readDietStrict(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return emptyDietStore(); throw e; }
  if (!txt.trim()) throw new SyntaxError('empty diet file');
  const parsed = JSON.parse(txt);
  if (!isObj(parsed) || (parsed.plans != null && !Array.isArray(parsed.plans))) {
    throw new SyntaxError('corrupt diet schema');
  }
  return {
    rev: Number.isInteger(parsed.rev) ? parsed.rev : 0,
    _ts: parsed._ts ?? null,
    activePlanId: typeof parsed.activePlanId === 'string' ? parsed.activePlanId : null,
    prevPlanId: typeof parsed.prevPlanId === 'string' ? parsed.prevPlanId : null,
    plans: Array.isArray(parsed.plans) ? parsed.plans : []
  };
}

export function withDietState(deps, uid, opts, fn) {
  const { dietFile, atomicWrite, DATA } = deps;
  if (!hasSafeUid(uid)) {
    return { code: 400, body: { error: 'bad uid', code: 'BAD_UID' } };
  }
  const file = dietFile(uid);
  let D0;
  try { D0 = readDietStrict(file); }
  catch (e) {
    console.error('[og-diet] corrupt', uid, e.message);
    return { code: 500, body: { error: 'diet state corrupt', code: 'DIET_CORRUPT', hint: 'restore backup' } };
  }
  const pre = checkIfMatch(D0, opts.ifMatch);
  if (pre) return pre;
  const cur = stateMeta(D0);
  const beforeHash = sha256(canon(D0));
  const work = JSON.parse(JSON.stringify(D0));
  let out;
  try { out = fn(work, { cur, uid, ...opts }); }
  catch (e) {
    console.error('withDietState fn threw', opts.action, e);
    return { code: 500, body: { error: 'server error' } };
  }
  if (out && out.error) {
    return { code: out.code_http || 400, body: { ...out, field: out.field || null } };
  }
  work.rev = cur.rev + 1;
  work._ts = Date.now();
  atomicWrite(file, JSON.stringify(work));
  const meta = {
    rev: work.rev, revBefore: cur.rev, revAfter: work.rev, etag: cur.etag,
    actor: opts.actor.actor, verified: opts.actor.verified,
    stateHash: sha256(canon(work)), beforeHash, action: opts.action,
    at: new Date().toISOString(), ...((out && out._meta) || {})
  };
  appendAudit(DATA, { otp: meta.etag, uid, scope: 'diet', ...meta });
  return { code: 200, body: { ok: true, rev: work.rev, meta } };
}

/* ---------------------------------------------------------------- mutações puras */

export function applyPutDiet(D, body, activate, stamp, agora) {
  const list = Array.isArray(D.plans) ? D.plans : (D.plans = []);
  const i = list.findIndex(p => p.id === body.id);
  if (i < 0 && list.length >= MAX_DIET_PLANS) {
    return { error: 'too many diet plans', code: 'TOO_MANY_DIET_PLANS', code_http: 409 };
  }
  const created = i < 0;
  const prev = created ? null : list[i];
  const { activatedBy, activatedAt, ...rest } = body;
  const plan = { ...rest, updatedAt: agora };
  if (activate === 'now') {
    plan.activatedAt = agora;
    plan.activatedBy = stamp;
  } else if (prev) {
    if (prev.activatedAt) plan.activatedAt = prev.activatedAt;
    if (prev.activatedBy) plan.activatedBy = prev.activatedBy;
  }
  if (created) list.push(plan); else list[i] = plan;
  const activated = activate === 'now' && D.activePlanId !== plan.id;
  if (activated) {
    D.prevPlanId = D.activePlanId || null;
    D.activePlanId = plan.id;
  }
  return { _meta: { dietId: plan.id, created, activated, activate } };
}

export function applyActivateDiet(D, did, stamp, agora) {
  const list = Array.isArray(D.plans) ? D.plans : [];
  const plan = list.find(p => p.id === did);
  if (!plan) {
    return {
      error: `diet plan "${did}" not found`, code: 'DIET_NOT_FOUND', code_http: 409,
      plans: list.map(p => p.id)
    };
  }
  if (D.activePlanId !== did) {
    D.prevPlanId = D.activePlanId || null;
    D.activePlanId = did;
    plan.activatedAt = agora;
    plan.activatedBy = stamp;
  }
  return { _meta: { dietId: did, activated: true } };
}

export function applyDeleteDiet(D, did) {
  const list = Array.isArray(D.plans) ? D.plans : (D.plans = []);
  const i = list.findIndex(p => p.id === did);
  if (i < 0) {
    return {
      error: `diet plan "${did}" not found`, code: 'DIET_NOT_FOUND', code_http: 404,
      plans: list.map(p => p.id)
    };
  }
  const wasActive = D.activePlanId === did;
  list.splice(i, 1);
  if (wasActive) D.activePlanId = null;
  if (D.prevPlanId === did) D.prevPlanId = null;
  return { _meta: { dietId: did, deleted: true, wasActive } };
}

/* ---------------------------------------------------------------- handlers HTTP */

export function makeHandlers(deps) {
  const { readSession, dietFile, json, readActor, readRawBody } = deps;

  async function open(req, pathname) {
    const raw = await readRawBody(req).catch(() => null);
    if (raw === null) return { code: 400, body: { error: 'body too large or unreadable' } };
    const user = readSession(req);
    if (!user) return { code: 401, body: { error: 'not signed in', code: 'UNAUTH' } };
    const actor = readActor(req, user.id, raw, req.method, pathname);
    if (actor.err) return { code: 400, body: { error: 'actor signature invalid', code: actor.err } };
    return { raw, user, actor };
  }

  function loadForRead(uid, res) {
    if (!hasSafeUid(uid)) {
      json(res, 400, { error: 'bad uid', code: 'BAD_UID' });
      return null;
    }
    try { return readDietStrict(dietFile(uid)); }
    catch (e) {
      console.error('[og-diet] corrupt', uid, e.message);
      json(res, 500, { error: 'diet state corrupt', code: 'DIET_CORRUPT', hint: 'restore backup' });
      return null;
    }
  }

  async function getDiet(req, res) {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in', code: 'UNAUTH' });
    const D = loadForRead(user.id, res);
    if (!D) return;
    const activePlan = D.activePlanId ? (D.plans.find(p => p.id === D.activePlanId) || null) : null;
    json(res, 200, {
      plans: D.plans,
      activePlanId: D.activePlanId,
      prevPlanId: D.prevPlanId,
      activePlan,
      rev: D.rev,
      _ts: D._ts
    });
  }

  async function getDietPlan(req, res, params) {
    const did = params[0];
    if (!DIET_ID_RE.test(String(did || ''))) {
      return json(res, 400, { error: 'id must match ^[A-Za-z0-9_-]{1,64}$', code: 'BAD_DIET_ID', field: 'id' });
    }
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in', code: 'UNAUTH' });
    const D = loadForRead(user.id, res);
    if (!D) return;
    const plan = D.plans.find(p => p.id === did);
    if (!plan) return json(res, 404, { error: `diet plan "${did}" not found`, code: 'DIET_NOT_FOUND' });
    json(res, 200, { plan, active: D.activePlanId === did, rev: D.rev, _ts: D._ts });
  }

  async function putDiet(req, res) {
    const o = await open(req, '/api/diet');
    if (o.code) return json(res, o.code, o.body);
    const { raw, user, actor } = o;
    let body;
    try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json' }); }

    const ifMatch = parseIfMatch(req.headers['if-match']);
    if (!hasSafeUid(user.id)) return json(res, 400, { error: 'bad uid', code: 'BAD_UID' });
    let D0;
    try { D0 = readDietStrict(dietFile(user.id)); }
    catch (e) {
      console.error('[og-diet] corrupt', user.id, e.message);
      return json(res, 500, { error: 'diet state corrupt', code: 'DIET_CORRUPT', hint: 'restore backup' });
    }
    const pre = checkIfMatch(D0, ifMatch);
    if (pre) return json(res, pre.code, pre.body);

    const bad = validateDietBody(body.plan);
    if (bad) return json(res, 400, bad);
    const activate = body.activate === 'now' ? 'now' : 'none';

    const r = withDietState(deps, user.id,
      { ifMatch, actor, action: 'put-diet', uid: user.id },
      D => applyPutDiet(D, body.plan, activate, actor.verified === 'signature' ? 'assistant' : 'user',
        new Date().toISOString()));

    if (r.code === 200) {
      const m = r.body.meta || {};
      console.log(`[og-diet] op=put-diet uid=${user.id} diet=${body.plan.id} created=${!!m.created} `
        + `activated=${!!m.activated} rev=${m.revBefore}->${m.revAfter}`);
    }
    const created = r.code === 200 && r.body && r.body.meta && r.body.meta.created;
    return json(res, created ? 201 : r.code, r.body);
  }

  async function activateDietPlan(req, res, params) {
    const did = params[0];
    if (!DIET_ID_RE.test(String(did || ''))) {
      return json(res, 400, { error: 'id must match ^[A-Za-z0-9_-]{1,64}$', code: 'BAD_DIET_ID', field: 'id' });
    }
    const o = await open(req, '/api/diet/' + did + '/activate');
    if (o.code) return json(res, o.code, o.body);
    const { user, actor } = o;
    const ifMatch = parseIfMatch(req.headers['if-match']);

    const r = withDietState(deps, user.id,
      { ifMatch, actor, action: 'activate-diet', uid: user.id },
      D => applyActivateDiet(D, did, actor.verified === 'signature' ? 'assistant' : 'user', new Date().toISOString()));

    if (r.code === 200) {
      console.log(`[og-diet] op=activate-diet uid=${user.id} diet=${did} `
        + `rev=${r.body.meta.revBefore}->${r.body.meta.revAfter}`);
    }
    return json(res, r.code, r.body);
  }

  async function deleteDietPlan(req, res, params) {
    const did = params[0];
    if (!DIET_ID_RE.test(String(did || ''))) {
      return json(res, 400, { error: 'id must match ^[A-Za-z0-9_-]{1,64}$', code: 'BAD_DIET_ID', field: 'id' });
    }
    const o = await open(req, '/api/diet/' + did);
    if (o.code) return json(res, o.code, o.body);
    const { user, actor } = o;

    const r = withDietState(deps, user.id,
      { ifMatch: parseIfMatch(req.headers['if-match']), actor, action: 'delete-diet', uid: user.id },
      D => applyDeleteDiet(D, did));

    if (r.code === 200) {
      console.log(`[og-diet] op=delete-diet uid=${user.id} diet=${did} `
        + `wasActive=${!!r.body.meta.wasActive} rev=${r.body.meta.revBefore}->${r.body.meta.revAfter}`);
    }
    return json(res, r.code, r.body);
  }

  return { getDiet, getDietPlan, putDiet, activateDietPlan, deleteDietPlan };
}
