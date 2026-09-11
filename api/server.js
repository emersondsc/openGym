/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import { buildAnalysis } from './coach.js';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as routines from './routines.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
// O catálogo vive ao lado do server.js (é o COPY do Dockerfile), NÃO em DATA_DIR (/data, que só
// tem estado/segredo). `OG_CATALOG` permite apontar para outro arquivo sem rebuild.
const CATALOG_PATH = process.env.OG_CATALOG || path.join(path.dirname(fileURLToPath(import.meta.url)), 'exercise_catalog.json');
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');

// Minimal shape guard for PUT /api/data (2026-09-08 sync incident: blind overwrite
// accepted ghost ids that only surfaced as 'Unknown exercise' days later). Deliberately
// loose — it rejects corruption, never legitimate client states.
function checkState(s) {
  if (Array.isArray(s)) return 'state must be an object';
  if (s.routines !== undefined) {
    if (!Array.isArray(s.routines)) return 'routines must be an array';
    for (const r of s.routines) {
      if (!r || typeof r !== 'object') return 'routine must be an object';
      if (r.ex !== undefined) {
        if (!Array.isArray(r.ex)) return 'routine.ex must be an array';
        for (const e of r.ex) {
          if (!e || typeof e.id !== 'string' || !e.id) return 'ex.id required';
          if (e.sets !== undefined && (typeof e.sets !== 'number' || !(e.sets >= 1))) return 'ex.sets must be >= 1';
        }
      }
    }
  }
  return null;
}
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

// Exportado para o teste (`node --test api/routines.test.js`) e para reuso futuro.
export { checkState, checkRoutineFields, readActor, agentKey, matchRoute, readRawBody, readBody,
         readSession, readState, stateFile, atomicWrite, VOLATILE, DATA, SECRET, CATALOG_PATH, server };

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder'
    });
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Chave do agente: derivada do SECRET e guardada em /data/agent.key (0600). Arquivo ausente,
// vazio, corrompido ou ilegível é regenerado — nunca derruba a requisição com 500.
function agentKey() {
  const f = path.join(DATA, 'agent.key');
  const valid = s => /^[0-9a-f]{64}$/.test(s || '');
  let cur = null;
  try { cur = fs.readFileSync(f, 'utf8').trim(); } catch { /* ausente ou ilegivel */ }
  if (valid(cur)) return cur;
  const k = crypto.createHmac('sha256', SECRET).update('opengym-agent-v1').digest('hex');
  try { fs.writeFileSync(f, k, { mode: 0o600 }); }
  catch (e) { console.error('agent.key write failed', e.message); }
  return k;
}

// Atribuição (spec_api_rotinas §4.4): sem assinatura o ator é uma ALEGAÇÃO
// (`verified: 'claimed'`), não uma identidade provada. O log diz isso em vez de fingir.
function readActor(req, uid, rawBody, method, pathname) {
  const raw = (req.headers['x-og-actor'] || '').toString().trim();
  const sig = (req.headers['x-og-actor-sig'] || '').toString().trim();
  if (!raw) return { actor: null, verified: 'none' };
  const m = /(?:^|;\s*)agent=([^;]{1,40})/.exec(raw);
  const actor = m && m[1].trim() ? m[1].trim() : 'unknown';
  if (!sig) return { actor, verified: 'claimed', header: raw };
  const s = /(?:^|;\s*)t=(\d{1,15});\s*v1=([0-9a-f]{64})/.exec(sig);
  if (!s) return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' };
  const t = +s[1];
  if (Math.abs(Date.now() / 1000 - t) > 300) return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' };
  let expect;
  try {
    const bodyHash = crypto.createHash('sha256').update(rawBody || '').digest('hex');
    expect = crypto.createHmac('sha256', agentKey())
      .update(`${t}\n${method}\n${pathname}\n${uid}\n${bodyHash}`).digest('hex');
  } catch (e) {
    console.error('agent key unavailable', e.message);
    return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' };
  }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(s[2], 'hex'), Buffer.from(expect, 'hex'))) {
      return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' };
    }
  } catch { return { err: 'BAD_ACTOR_SIG', actor, verified: 'none' } }
  return { actor, verified: 'signature', header: raw };
}

// Endurecimento do PUT: as MESMAS regras do PATCH, com o "antes" vindo do disco, para um cliente
// publicado (que manda mode:"normal" e sg:0) continuar passando. Sem catálogo, a checagem é
// pulada e a resposta marca `X-OG-Catalog: unavailable` — o app não pode parar de aceitar o
// próprio estado por causa de um arquivo de dados que falta.
function checkRoutineFields(state, cur) {
  const catalog = routines.loadCatalog(CATALOG_PATH);
  const custom = new Set([...(cur?.customEx || []), ...(state.customEx || [])].map(c => c.id));
  for (const r of state.routines || []) {
    const before = (cur?.routines || []).find(x => x.id === r.id) || {};
    for (const e of r.ex || []) {
      const b = (before.ex || []).find(x => x.id === e.id) || {};
      const bad = routines.validateExEntry(e, {
        catalog, custom, where: `ex.${e.id}`,
        legacy: { mode: b.mode, sg: b.sg },
        modeChanged: (e.mode ?? b.mode) !== b.mode
      });
      if (bad) return bad;
    }
  }
  return null;
}

// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
// `_ts` (carimbo do cliente) e `rev` (contador do servidor) mudam a cada escrita: não entram na
// comparação API x disco nem na prova de invariante (spec_escritor_rotinas §RF-11).
const VOLATILE = new Set(['_ts', 'rev']);
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
// Os BYTES crus: o hash da assinatura do ator tem de ser calculado sobre o que chegou.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
// Comportamento de antes (objeto; `{}` para corpo vazio). Um corpo inválido resolve `{}` em vez de
// rejeitar: as rotas que usam readBody leem campos com defaults, então o resultado é a mesma
// mensagem 400 que o try/catch antigo produzia em quem chamava.
async function readBody(req) {
  const raw = await readRawBody(req);
  try { return raw.length ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- routes ---------- */
// Path patterns (carregam :params, o que a tabela exata não consegue). A tabela exata continua
// sendo o caminho de todas as rotas que já existiam. url.pathname não traz querystring, que é
// como as rotas com ?id= já funcionam hoje.
const PATTERNS = [
  { method: 'PATCH',  re: /^\/api\/routines\/([A-Za-z0-9_-]{1,64})$/, params: ['rid'], handler: 'patchRoutine' },
  { method: 'DELETE', re: /^\/api\/routines\/([A-Za-z0-9_-]{1,64})$/, params: ['rid'], handler: 'deleteRoutine' }
];
// Preenchido depois de `R()`, porque os handlers de rotina precisam do roteador pronto.
const ROUTINE_HANDLERS = {};

function matchRoute(method, pathname) {
  for (const p of PATTERNS) {
    if (p.method !== method) continue;
    const m = p.re.exec(pathname);
    if (m && ROUTINE_HANDLERS[p.handler]) return { handler: ROUTINE_HANDLERS[p.handler], params: m.slice(1) };
  }
  const h = routes[method + ' ' + pathname];
  return h ? { handler: h, params: [] } : null;
}

const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  'GET /api/coach/analysis': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in', code: 'UNAUTH' }, { 'Cache-Control': 'private, no-store, max-age=0' });
    const rawUid = String(user.id || '');
    const safeUid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeUid) return json(res, 400, { error: 'bad uid', code: 'BAD_UID' });
    const p = path.resolve(DATA, 'state-' + safeUid + '.json');
    const rel = path.relative(path.resolve(DATA), p);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return json(res, 400, { error: 'bad uid', code: 'BAD_UID' });
    let state;
    try {
      const txt = fs.readFileSync(p, 'utf8');
      if (!txt.trim()) throw new SyntaxError('empty');
      state = JSON.parse(txt);
    } catch (e) {
      if (e.code === 'ENOENT') state = { workouts: [], routines: [], bodyweight: [], customEx: [], unit: 'kg' };
      else if (e instanceof SyntaxError) { console.error('[coach] corrupt', safeUid, e.message); return json(res, 500, { error: 'state corrupt', code: 'STATE_CORRUPT', hint: 'restore backup' }); }
      else { console.error('[coach] read error', safeUid, e); return json(res, 500, { error: 'server error' }); }
    }
    if (!state || typeof state !== 'object' || (state.workouts != null && !Array.isArray(state.workouts))) { console.error('[coach] corrupt schema', safeUid); return json(res, 500, { error: 'state corrupt', code: 'STATE_CORRUPT', hint: 'restore backup' }); }
    try {
      const { analysis, progress } = buildAnalysis(state);
      if (analysis.n_sets > 20000) return json(res, 200, { analysis, progress, meta: { uid: user.id, generatedAt: Date.now(), n_sets: analysis.n_sets, n_sessions: analysis.n_sessions, period: analysis.period, truncated: true, limitedTo: 20000 } }, { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie', 'Pragma': 'no-cache' });
      json(res, 200, { analysis, progress, meta: { uid: user.id, generatedAt: Date.now(), n_sets: analysis.n_sets, n_sessions: analysis.n_sessions, period: analysis.period } }, { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie', 'Pragma': 'no-cache' });
    } catch (e) { console.error('[coach] build error', safeUid, e); json(res, 500, { error: 'server error' }); }
  },

  // Lista leve de rotinas + metadado de concorrência (rev/_ts). 404 quando não há estado: o
  // agente liga o canal novo ao receber 200 daqui (spec_api_rotinas RF-9).
  'GET /api/routines': (req, res) => ROUTINE_HANDLERS.list(req, res),

  // Trilha de auditoria: quem escreveu o quê. Dono vê o dele; admin vê qualquer uid.
  'GET /api/audit': (req, res) => ROUTINE_HANDLERS.audit(req, res),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      // `rev` injetado (0 para um estado nunca escrito pela versão nova): sem isto o cliente não
      // teria base para mandar If-Match no primeiro sync.
      if (state && typeof state === 'object') state.rev = Number.isInteger(state.rev) ? state.rev : 0;
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    let raw;
    try { raw = await readRawBody(req); }
    catch (e) { return json(res, 400, { error: e.message === 'body too large' ? 'body too large' : 'bad json' }); }
    let body;
    try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json' }); }
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    const bad = checkState(body.state);
    if (bad) return json(res, 400, { error: bad });
    let cur = null;
    try { cur = readState(user.id); } catch { /* first write */ }
    const badEx = checkRoutineFields(body.state, cur);
    if (badEx) {
      return json(res, 400, { error: badEx.message, code: badEx.code, field: badEx.field,
                              allowed: badEx.allowed || null });
    }
    const actor = readActor(req, user.id, raw, req.method, '/api/data');
    if (actor.err) return json(res, 400, { error: 'actor signature invalid', code: actor.err });
    // Token forte (igualdade) quando o cliente manda um; senão o guard por `_ts` de sempre, para
    // o PWA publicado seguir funcionando (spec_api_rotinas RF-5/RF-10).
    const curRev = (cur && Number.isInteger(cur.rev)) ? cur.rev : 0;
    const ifMatch = routines.parseIfMatch(req.headers['if-match']);
    if (ifMatch === 'BAD') {
      return json(res, 400, { error: 'malformed If-Match', code: 'IF_MATCH_MALFORMED' });
    }
    if (ifMatch !== null && ifMatch !== '*') {
      if (ifMatch !== String(curRev)) {
        return json(res, 409, { error: 'stale base, re-pull and merge', code: 'STALE_STATE',
                                rev: curRev, serverTs: cur?._ts || 0 });
      }
    } else {
      const incoming = body.state._ts || 0;
      if (cur && incoming < (cur._ts || 0)) {
        return json(res, 409, { error: 'stale base, re-pull and merge', serverTs: cur._ts || 0, rev: curRev });
      }
    }
    body.state.rev = curRev + 1;           // o contador é do servidor
    body.state._ts = body.state._ts || Date.now();
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    const meta = {
      rev: body.state.rev, revBefore: curRev, revAfter: body.state.rev, etag: crypto.randomUUID(),
      actor: actor.actor || 'pwa-legacy', verified: actor.actor ? actor.verified : 'none',
      stateHash: routines.sha256(routines.canon(body.state)),
      beforeHash: cur ? routines.sha256(routines.canon(cur)) : null,
      action: 'put-state', at: new Date().toISOString()
    };
    routines.appendAudit(DATA, { otp: meta.etag, uid: user.id, ...meta });
    console.log(`[og-state] op=put uid=${user.id} actor=${meta.actor} verified=${meta.verified} `
      + `rev=${curRev}->${meta.rev}`);
    json(res, 200, { ok: true, ts: body.state._ts, rev: meta.rev, meta });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'openGym', body: 'Test notification ✅ — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    json(res, 200, { ok: true });
  }
};

// Handlers de rotina: recebem o roteador pronto (readSession/readState/atomicWrite) por injeção,
// para não haver import circular entre server.js e routines.js.
Object.assign(ROUTINE_HANDLERS, routines.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor, CATALOG_PATH
}));

// Carrega o catálogo já no boot: se o arquivo não estiver onde devia, o erro aparece no log na
// hora (em vez de virar um 503 misterioso na primeira escrita de rotina).
{
  const cat = routines.loadCatalog(CATALOG_PATH);
  if (!cat) console.error('[og-routine] ATENCAO: catalogo ausente — escrita de rotina respondera 503');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;     // usado só pelo catch abaixo
  const hit = matchRoute(req.method, url.pathname);
  if (!hit) return json(res, 404, { error: 'not found' });
  try { await hit.handler(req, res, hit.params); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
});

// Só escuta quando é o processo principal (`node server.js`, o que o CMD do Dockerfile faz).
// Importado por um teste, o módulo não abre porta nenhuma.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
}
