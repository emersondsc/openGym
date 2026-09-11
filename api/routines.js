// api/routines.js — operações POR ROTINA do openGym: validação de campo, merge por id,
// limpeza de referências e trilha de auditoria.
//
// Especificado em docs/specs/spec_api_rotinas.md (v3). O par do lado agente é
// ~/.hermes/workout/scripts/opengym_writer.py — as regras de FORMA são as mesmas nos dois lados;
// a POLÍTICA de treino (faixa 6-8 do mesociclo, alta > 10%) fica no portão P1 do Hermes.
//
// Este módulo NÃO escreve no socket: devolve {code, body} e quem responde é o server.js.
// Ele precisa de server.js para: readSession, readState, stateFile, readRawBody, atomicWrite,
// DATA, SECRET (ver os imports em server.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROG_ALLOWED = ['off', 'linear', 'greyskull', 'double', 'time'];
export const MODE_ALLOWED = ['reps', 'time', 'cardio'];
const MODE_LEGACY = ['normal'];   // escrito por uma versão anterior do agente; modeOf lê como reps
const REP_RANGE = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/;
const MAX_SETS = 20, MAX_WEIGHT = 1000, MAX_REPS = 100, MAX_SEC = 3600;
const AUDIT_MAX_LINES = 5000;     // rotação: mantém as últimas N linhas

let _catalog = null;              // cache do boot (A12)
let _catalogChecked = false;

/* ---------------------------------------------------------------- helpers de estado */

export function canon(obj) {
  return JSON.stringify(obj, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v));
}
export function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex'); }

export function stateMeta(S) {
  return {
    rev: Number.isInteger(S?.rev) ? S.rev : 0,
    _ts: S?._ts || null,
    etag: crypto.randomUUID()
  };
}

/** null (ausente/vazio) | '*' | string de dígitos | 'BAD' (formato inválido). Nunca número. */
export function parseIfMatch(h) {
  if (h === undefined || h === null) return null;
  const v = String(h).trim();
  if (v === '') return null;
  if (v === '*') return '*';
  const bare = v.replace(/^"|"$/g, '').trim();
  return /^\d+$/.test(bare) ? bare : 'BAD';
}

/** Mapa id → entrada do catálogo, carregado uma vez. null = indisponível (A12). */
/** Mapa id → entrada do catálogo, carregado uma vez de `catalogPath`. null = indisponível (A12). */
export function loadCatalog(catalogPath) {
  if (_catalogChecked) return _catalog;
  _catalogChecked = true;
  const f = catalogPath;
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const map = new Map();
    if (Array.isArray(raw)) for (const c of raw) { if (c && c.id) map.set(c.id, c); }
    else for (const [id, v] of Object.entries(raw)) map.set(id, typeof v === 'object' ? v : {});
    _catalog = map;
    console.log(`[og-routine] catalogo carregado: ${map.size} exercicios de ${f}`);
  } catch (e) {
    console.error('[og-routine] catalogo indisponivel:', f, e.message);
    _catalog = null;
  }
  return _catalog;
}
/** Só para o teste: permite carregar outro catálogo sem reiniciar o processo. */
export function __resetCatalogCache() { _catalog = null; _catalogChecked = false; }
export function catalogEq(id) { return _catalog?.get(id)?.eq || null; }

/** Reproduz defaultConfig de frontend/src/lib/history.js:121-129. */
export function defaultExFields(eid, mode, eq) {
  const bw = eq === 'body weight' ? { bodyweight: true } : {};
  if (mode === 'cardio') return { sets: 1, min: 20, speed: 8 };
  if (mode === 'time') return { sets: 3, sec: 45, weight: 0, mode: 'time', ...bw };
  return { sets: 3, reps: 10, weight: 0, mode: 'reps', ...bw };
}

/** Trocar de modo remove os campos do modo anterior (espelha exConfigSheet, sheets.jsx:512-523). */
export function stripCrossModeFields(e, mode) {
  const o = { ...e };
  if (mode === 'time') { delete o.reps; delete o.min; delete o.speed; delete o.repsMin; delete o.repsMax; }
  else if (mode === 'cardio') { for (const k of ['reps', 'sec', 'repsMin', 'repsMax', 'prog', 'inc']) delete o[k]; }
  else { delete o.sec; delete o.min; delete o.speed; }
  return o;
}

/** Porta 1:1 de frontend/src/lib/history.js:145-149. */
export function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg;
  });
}

/* ---------------------------------------------------------------- validação de campo */

const num = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Valida UMA entrada de exercício. Devolve null (ok) ou {code, field, message, allowed?}.
 * opt: { catalog: Map|null, custom: Set, where: 'ex.0326', legacy: {mode, sg}, modeChanged: bool }
 */
export function validateExEntry(e, opt = {}) {
  const { catalog, custom = new Set(), where = 'ex' } = opt;
  const lg = opt.legacy || {};
  const bad = (code, field, message, allowed) => ({ code, field: `${where}.${field}`, message, allowed });
  if (!e || typeof e !== 'object' || Array.isArray(e)) return bad('BAD_EX', 'ex', 'ex entry must be an object');
  if (typeof e.id !== 'string' || !e.id) return bad('EX_ID_REQUIRED', 'id', 'ex.id required');
  if (catalog && !catalog.has(e.id) && !custom.has(e.id)) {
    return bad('CATALOG_UNKNOWN_EX', 'id',
      `unknown exercise id "${e.id}" — not in exercise_catalog.json nor in this profile's customEx`);
  }
  if (!(Number.isInteger(e.sets) && e.sets >= 1 && e.sets <= MAX_SETS)) {
    return bad('BAD_SETS', 'sets', `sets must be an integer 1..${MAX_SETS}`, [1, MAX_SETS]);
  }
  // 'normal' e sg 0/'' sao LEGADO do estado real (100% dos templates, medido 11/09/2026):
  // aceitos onde ja existem — inclusive num exercicio novo no payload, que veio de um estado
  // antigo do cliente — e recusados apenas onde sao INTRODUZIDOS (opt.isNewEntry, ou valor
  // diferente do que ja estava).
  const notIntroduced = (v, lgv) => lgv === undefined || v === lgv;
  if (e.mode !== undefined && !MODE_ALLOWED.includes(e.mode)) {
    const legacySame = MODE_LEGACY.includes(e.mode) && e.mode === lg.mode;
    const carriesLegacy = MODE_LEGACY.includes(e.mode) && notIntroduced(e.mode, lg.mode) && !opt.isNewEntry;
    if (!legacySame && !carriesLegacy) {
      return bad('BAD_MODE', 'mode', `mode must be one of ${MODE_ALLOWED.join('|')}`
        + (MODE_LEGACY.includes(e.mode) ? ' ("normal" is legacy: only where it already is)' : ''));
    }
  }
  if (e.weight !== undefined && !(num(e.weight) && e.weight >= 0 && e.weight <= MAX_WEIGHT)) {
    return bad('BAD_WEIGHT', 'weight', `weight must be a number 0..${MAX_WEIGHT}`);
  }
  if (e.reps !== undefined) {
    const okNum = Number.isInteger(e.reps) && e.reps >= 1 && e.reps <= MAX_REPS;
    const m = typeof e.reps === 'string' ? REP_RANGE.exec(e.reps) : null;
    const okRange = m && +m[1] >= 1 && +m[1] <= +m[2] && +m[2] <= MAX_REPS;
    if (!okNum && !okRange) {
      return bad('BAD_REPS', 'reps', `reps must be an integer 1..${MAX_REPS} or a range "A-B" (A<=B)`);
    }
  }
  if (e.sec !== undefined && !(Number.isInteger(e.sec) && e.sec >= 1 && e.sec <= MAX_SEC)) {
    return bad('BAD_SEC', 'sec', `sec must be an integer 1..${MAX_SEC}`);
  }
  if (e.min !== undefined && !(Number.isInteger(e.min) && e.min >= 1 && e.min <= 600)) {
    return bad('BAD_MIN', 'min', 'min must be an integer 1..600');
  }
  if (e.speed !== undefined && !(num(e.speed) && e.speed >= 0 && e.speed <= 40)) {
    return bad('BAD_SPEED', 'speed', 'speed must be a number 0..40');
  }
  for (const f of ['bodyweight', 'side']) {
    if (e[f] !== undefined && typeof e[f] !== 'boolean') return bad('BAD_FLAG', f, `${f} must be a boolean`);
  }
  if (e.inc !== undefined && !(num(e.inc) && e.inc >= 0)) {
    return bad('BAD_FIELD', 'inc', 'inc must be a number >= 0');
  }
  for (const f of ['repsMin', 'repsMax']) {
    if (e[f] !== undefined && !(Number.isInteger(e[f]) && e[f] >= 1)) {
      return bad('BAD_FIELD', f, `${f} must be an integer >= 1`);
    }
  }
  if (e.prog !== undefined && !PROG_ALLOWED.includes(e.prog)) {
    return bad('BAD_PROG', 'prog', `prog must be one of ${PROG_ALLOWED.join('|')}`, PROG_ALLOWED);
  }
  if (e.sg !== undefined) {
    const legacySame = (e.sg === 0 || e.sg === '') && notIntroduced(e.sg, lg.sg) && !opt.isNewEntry;
    if (!legacySame && !(typeof e.sg === 'string' && e.sg)) {
      return bad('BAD_SG', 'sg', 'sg must be a non-empty string (0/"" are legacy: only where they already are)');
    }
  }
  if (e.restSec !== undefined && !(Number.isInteger(e.restSec) && e.restSec >= 30 && e.restSec <= 300)) {
    return bad('BAD_REST', 'restSec', 'restSec must be an integer 30..300');   // = isValidRest (useStore.js:19)
  }
  const mode = e.mode === 'normal' ? 'reps' : (e.mode || 'reps');
  if (mode === 'time' && opt.modeChanged && e.sec === undefined) {
    return bad('MODE_TIME_NO_SEC', 'sec', 'mode "time" requires sec');
  }
  if (mode === 'cardio' && opt.modeChanged && (e.min === undefined || e.speed === undefined)) {
    return bad('MODE_CARDIO_INCOMPLETE', 'min', 'mode "cardio" requires min and speed');
  }
  if (e.side === true && mode === 'time') return bad('SIDE_ON_TIME', 'side', 'side only applies to reps work');
  return null;
}

/** Regras do corpo do PATCH no nível da rotina. */
export function validateRoutineBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'body must be an object', code: 'BAD_BODY' };
  }
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n || n.length > 60) return { error: 'name must be 1..60 chars', code: 'BAD_NAME', field: 'name' };
  }
  if (body.emoji !== undefined && (typeof body.emoji !== 'string' || !body.emoji)) {
    return { error: 'emoji must be a non-empty string', code: 'BAD_EMOJI', field: 'emoji' };
  }
  if (body.prog !== undefined && !PROG_ALLOWED.includes(body.prog)) {
    return { error: `prog must be one of ${PROG_ALLOWED.join('|')}`, code: 'BAD_PROG', field: 'prog',
             allowed: PROG_ALLOWED };
  }
  if (body.exRemoved !== undefined && !Array.isArray(body.exRemoved)) {
    return { error: 'exRemoved must be an array', code: 'BAD_EXREMOVE', field: 'exRemoved' };
  }  if (body.ex !== undefined && (body.ex === null || typeof body.ex !== 'object' || Array.isArray(body.ex))) {
    return { error: 'ex must be an object keyed by exercise id', code: 'BAD_EX', field: 'ex' };
  }
  return null;
}

/**
 * Aplica `body` sobre a rotina `cur` (MUTA cur). Devolve null ou {error, code, ...}.
 * O merge é SOBRE o item existente: o que a intenção não cita não muda (nem é normalizado).
 */
export function mergeRoutine(cur, body, catalog, custom) {
  if (body.exRemoved !== undefined) {
    for (const id of body.exRemoved) {
      const i = cur.ex.findIndex(e => e.id === id);
      if (i < 0) return { error: `exRemoved: "${id}" is not in routine ${cur.id}`, code: 'EX_NOT_IN_ROUTINE', field: 'exRemoved' };
      cur.ex.splice(i, 1);
    }
  }
  if (body.ex !== undefined) {
    for (const [eid, fields] of Object.entries(body.ex)) {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return { error: `ex.${eid} must be an object`, code: 'BAD_EX', field: `ex.${eid}` };
      }
      const target = cur.ex.find(e => e.id === eid);
      const meta = catalog ? (catalog.get(eid) || {}) : {};
      const declared = fields.mode;
      const mode = declared
        || (target && target.mode === 'normal' ? 'normal' : null)
        || target?.mode
        || (meta.eq === 'cardio' ? 'cardio' : 'reps');
      const effective = mode === 'normal' ? 'reps' : mode;
      const base = target ? { ...target } : defaultExFields(eid, effective, meta.eq);
      const merged = stripCrossModeFields({ ...base, ...fields, id: eid }, effective);
      const modeChanged = !target || ((declared ?? target.mode) !== target.mode);
      const bad = validateExEntry(merged, {
        catalog, custom, where: `ex.${eid}`,
        legacy: { mode: target?.mode, sg: target?.sg }, modeChanged, isNewEntry: !target
      });
      if (bad) return { ...bad, error: bad.message };
      if (target) {
        for (const k of Object.keys(target)) if (!(k in merged)) delete target[k];   // troca de modo
        Object.assign(target, merged, { id: eid });
      } else {
        cur.ex.push(merged);
      }
    }
  }
  cleanupSg(cur.ex);
  return null;
}

/** Remove a rotina de week/dayPlan. workouts[] fica INTACTO (histórico é registro, não ponteiro). */
export function sweepRoutineRefs(S, rid) {
  let weekCleaned = 0, dayPlanCleaned = 0;
  for (const k of Object.keys(S.week || {})) if (S.week[k] === rid) { delete S.week[k]; weekCleaned++; }
  for (const k of Object.keys(S.dayPlan || {})) if (S.dayPlan[k] === rid) { delete S.dayPlan[k]; dayPlanCleaned++; }
  const orphanWorkouts = (S.workouts || []).filter(w => w.routineId === rid).length;
  return { weekCleaned, dayPlanCleaned, orphanWorkouts };
}

/* ---------------------------------------------------------------- auditoria */

export function appendAudit(dir, rec) {
  const f = path.join(dir, 'audit.jsonl');
  let prev = null;
  try {
    const lines = fs.readFileSync(f, 'utf8').trimEnd().split('\n').filter(Boolean);
    if (lines.length) prev = JSON.parse(lines[lines.length - 1]).h;
  } catch { /* primeiro registro */ }
  const line = JSON.stringify({ ...rec, prev, h: sha256((prev || '') + JSON.stringify(rec)) });
  try {
    fs.appendFileSync(f, line + '\n', { mode: 0o600 });
    const all = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    if (all.length > AUDIT_MAX_LINES) {
      const keep = all.slice(-AUDIT_MAX_LINES).join('\n') + '\n';
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, keep);
      fs.renameSync(tmp, f);
    }
  } catch (e) {
    console.error('[og-routine] audit write failed', e.message);
  }
}

/** Filtro por rec.uid (o arquivo é global: todos os perfis no mesmo .jsonl). */
export function readAudit(dir, uidFilter, limit) {
  const f = path.join(dir, 'audit.jsonl');
  let lines = [];
  try { lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); }
  catch { return { entries: [], chainIntact: true }; }
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      const rec = JSON.parse(lines[i]);
      if (!uidFilter || rec.uid === uidFilter) entries.push(rec);
    } catch { /* linha corrompida: ignora */ }
  }
  let first = null;
  try { first = JSON.parse(lines[0]); } catch { /* */ }
  // prev não-nulo na primeira linha = houve corte/rotação: a cadeia não é contínua.
  return { entries, chainIntact: !(first && first.prev) };
}

/* ---------------------------------------------------------------- núcleo de escrita */

/**
 * Pré-condição de concorrência, checada ANTES de qualquer coisa cara (como carregar o catálogo):
 * um 428/400/409 tem de ser 428/400/409, não 503. Devolve null ou {code, body}.
 */
export function checkIfMatch(S, ifMatch) {
  const cur = stateMeta(S);
  if (ifMatch === 'BAD') {
    return { code: 400, body: { error: 'malformed If-Match', code: 'IF_MATCH_MALFORMED' } };
  }
  if (ifMatch === null) {
    return { code: 428, body: { error: 'If-Match required', code: 'IF_MATCH_REQUIRED', rev: cur.rev } };
  }
  if (ifMatch !== '*' && ifMatch !== String(cur.rev)) {
    return { code: 409, body: { error: 'stale base', code: 'STALE_STATE', rev: cur.rev, _ts: cur._ts, etag: cur.etag } };
  }
  return null;
}

/**
 * Lê o estado, aplica `fn(work, ctx)`, grava UMA vez e audita.
 * fn devolve: null = ok | {error, code, code_http?, ...} = recusa | {_meta:{...}} = ok com extra.
 * options: { ifMatch, actor, action, uid, dropActive }
 * Devolve {code, body} — nunca grava em caso de erro.
 */
export function withState(deps, uid, opts, fn) {
  const { readState, stateFile, atomicWrite, DATA } = deps;
  const S0 = readState(uid);
  if (!S0 || typeof S0 !== 'object') {
    return { code: 409, body: { error: 'no state for this profile', code: 'NO_STATE' } };
  }
  const pre = checkIfMatch(S0, opts.ifMatch);
  if (pre) return pre;
  const cur = stateMeta(S0);
  const beforeHash = sha256(canon(S0));
  // Cópia de trabalho: o que é gravado é só o resultado de um fn que terminou sem erro.
  const work = JSON.parse(JSON.stringify(S0));
  let out;
  try { out = fn(work, { cur, uid, ...opts }); }
  catch (e) {
    console.error('withState fn threw', opts.action, e);
    return { code: 500, body: { error: 'server error' } };
  }
  if (out && out.error) {
    return { code: out.code_http || 400, body: { ...out, field: out.field || null } };
  }
  work.rev = cur.rev + 1;
  work._ts = Date.now();
  if (opts.dropActive) delete work.active;      // A18: só o DELETE (e o PUT, como hoje)
  atomicWrite(stateFile(uid), JSON.stringify(work));
  const meta = {
    rev: work.rev, revBefore: cur.rev, revAfter: work.rev, etag: crypto.randomUUID(),
    actor: opts.actor.actor, verified: opts.actor.verified,
    stateHash: sha256(canon(work)), beforeHash, action: opts.action,
    at: new Date().toISOString(), ...((out && out._meta) || {})
  };
  appendAudit(DATA, { otp: meta.etag, uid, ...meta });
  console.log(`[og-routine] op=${opts.action} uid=${uid} actor=${meta.actor} verified=${meta.verified} `
    + `rev=${cur.rev}->${meta.rev}`);
  return { code: 200, body: { ok: true, rev: work.rev, meta } };
}

/* ---------------------------------------------------------------- handlers */

export function makeHandlers(deps) {
  const { readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor, catalogPath } = deps;

  async function list(req, res) {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const S = readState(user.id);
    // 404 (e não 200 com lista vazia): o agente liga o modo `patch` ao receber 200 daqui.
    if (!S || typeof S !== 'object') {
      return json(res, 404, { error: 'no state for this profile', code: 'NO_STATE' });
    }
    const routines = (S.routines || []).map(r => ({
      id: r.id, name: r.name || null, emoji: r.emoji || null, prog: r.prog || null,
      exCount: (r.ex || []).length, setsTotal: (r.ex || []).reduce((n, e) => n + (Number(e.sets) || 0), 0)
    }));
    const m = stateMeta(S);
    json(res, 200, { routines, rev: m.rev, _ts: m._ts, etag: m.etag });
  }

  async function audit(req, res) {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    const want = q.get('uid');
    const isAdmin = !!user.admin;
    if (want && want !== user.id && !isAdmin) return json(res, 403, { error: 'forbidden' });
    const limit = Math.max(1, Math.min(500, +(q.get('limit') || 50)));
    json(res, 200, readAudit(DATA, want && isAdmin ? want : user.id, limit));
  }

  async function patch(req, res, params) {
    const rid = params[0];
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const raw = await readRawBody(req);
    let body; try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json' }); }
    const actor = readActor(req, user.id, raw, req.method, '/api/routines/' + rid);
    if (actor.err) return json(res, 400, { error: 'actor signature invalid', code: actor.err });
    if (!actor.actor) return json(res, 400, { error: 'X-OG-Actor required on routine writes', code: 'ACTOR_REQUIRED' });
    const ifMatch = parseIfMatch(req.headers['if-match']);
    // Pré-condição antes de tudo: sem isto, um pedido sem If-Match num servidor sem catálogo
    // responderia 503 em vez de 428 (medido no deploy de 11/09/2026).
    const S0 = readState(user.id);
    if (!S0 || typeof S0 !== 'object') {
      return json(res, 409, { error: 'no state for this profile', code: 'NO_STATE' });
    }
    const pre = checkIfMatch(S0, ifMatch);
    if (pre) return json(res, pre.code, pre.body);
    const catalog = loadCatalog(catalogPath);
    if (!catalog) return json(res, 503, { error: 'exercise catalog unavailable', code: 'CATALOG_UNAVAILABLE' });
    const badBody = validateRoutineBody(body);
    if (badBody) return json(res, 400, badBody);
    const r = withState(deps, user.id,
      { ifMatch, actor, action: 'patch-routine', uid: user.id, dropActive: false },
      S => {
        const cur = (S.routines || []).find(x => x.id === rid);
        if (!cur) {
          return { error: `routine "${rid}" not found`, code: 'ROUTINE_NOT_FOUND', code_http: 404,
                   routines: (S.routines || []).map(x => x.id) };
        }
        // grava sempre o que veio declarado — inclusive prog 'off' (o editor faz o mesmo)
        if (body.name !== undefined) cur.name = String(body.name).trim();
        if (body.emoji !== undefined) cur.emoji = String(body.emoji).slice(0, 32);
        if (body.prog !== undefined) cur.prog = body.prog;
        const custom = new Set((S.customEx || []).map(c => c.id));
        const out = mergeRoutine(cur, body, catalog, custom);
        if (out) return out;
        return { _meta: { routines: [rid] } };
      });
    return json(res, r.code, r.body);
  }

  async function remove(req, res, params) {
    const rid = params[0];
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const raw = await readRawBody(req);
    const actor = readActor(req, user.id, raw, req.method, '/api/routines/' + rid);
    if (actor.err) return json(res, 400, { error: 'actor signature invalid', code: actor.err });
    if (!actor.actor) return json(res, 400, { error: 'X-OG-Actor required on routine writes', code: 'ACTOR_REQUIRED' });
    const force = new URL(req.url, 'http://x').searchParams.get('force') === '1';
    const ifMatch = parseIfMatch(req.headers['if-match']);
    const S0 = readState(user.id);
    if (!S0 || typeof S0 !== 'object') {
      return json(res, 409, { error: 'no state for this profile', code: 'NO_STATE' });
    }
    const pre = checkIfMatch(S0, ifMatch);
    if (pre) return json(res, pre.code, pre.body);
    const r = withState(deps, user.id,
      { ifMatch, actor, action: 'delete-routine', uid: user.id, dropActive: true },
      S => {
        const i = (S.routines || []).findIndex(x => x.id === rid);
        if (i < 0) return { error: `routine "${rid}" not found`, code: 'ROUTINE_NOT_FOUND', code_http: 404 };
        // S.active = {id, d, start, routineId, name, bw, cur, entries} — sheets.jsx:841
        if (S.active && S.active.routineId === rid && !force) {
          return { error: 'routine is in an in-progress workout on a device', code: 'ROUTINE_IN_USE',
                   code_http: 409, active: S.active.id };
        }
        S.routines.splice(i, 1);
        const swept = sweepRoutineRefs(S, rid);
        return { _meta: { routines: [rid], ...swept } };
      });
    return json(res, r.code, r.body);
  }

  // Os nomes casam com PATTERNS/ROUTINE_HANDLERS em server.js: `patchRoutine` e `deleteRoutine`.
  return { list, audit, patchRoutine: patch, deleteRoutine: remove };
}
