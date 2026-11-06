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
import { pathToFileURL } from 'node:url';
import * as catalog from './catalog.js';
import * as routines from './routines.js';
import * as meso from './meso.js';
import { checkMesos } from './meso.js';
import * as micro from './micro.js';
import * as proposals from './proposals.js';
import * as coachLink from './coach-link.js';
import * as coachAccess from './coach-access.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
// O catálogo é o arquivo do app (fonte única), NÃO um arquivo em DATA_DIR (/data, que só tem
// estado/segredo). O caminho e o leitor vivem em api/catalog.js; `OG_CATALOG` continua sendo o
// override sem rebuild.
const CATALOG_PATH = catalog.CATALOG_PATH;
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Dono das propostas do treinador. Sem esta variável as rotas respondem 404: é o desligamento.
const COACH_OWNER_UID = (process.env.COACH_OWNER_UID || '').trim();
// Gravação direta do treinador (spec_gravacao_direta_treinador.md). Sem a variável, tudo pede passkey.
const COACH_AUTO_APPLY = process.env.COACH_AUTO_APPLY === '1';
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
const publicUser = user => ({ id: user.id, name: user.name, admin: isAdmin(user),
  coachOwner: !!COACH_OWNER_UID && user.id === COACH_OWNER_UID });
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
// Para quem roda fora de uma requisição (timer, push em segundo plano): lá não existe o catch do
// servidor, e um disco cheio viraria exceção não tratada, que derruba o processo.
function saveDbQuiet() {
  try { saveDb(); return true; }
  catch (e) { console.error('db save failed', e.message); return false; }
}
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
  // Mesociclos: mesma régua tolerante do resto (teto e forma mínima), NUNCA a tabela inteira do
  // §6 da spec do meso. A tabela é da rota do assistente, onde a recusa é uma resposta; aqui um
  // 400 travaria treino, rotina e peso junto, e a escrita ficaria pendente para sempre.
  if (s.mesos !== undefined) {
    const bad = checkMesos(s.mesos);
    if (bad) return bad;
  }
  return null;
}
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}
// Para as rotas de /api/data: null é só "ainda não existe". Arquivo que existe e não dá para ler
// lança, porque tratá-lo como vazio faria o próximo PUT apagar o que ainda dá para restaurar.
function readStateStrict(uid) {
  let txt;
  try { txt = fs.readFileSync(stateFile(uid), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return JSON.parse(txt);
}
const stateCorrupt = (res, uid, e) => {
  console.error('[og-state] corrupt', uid, e.message);
  json(res, 500, { error: 'state corrupt', code: 'STATE_CORRUPT', hint: 'restore backup' });
};
// O carimbo "ativado pelo assistente" só entra com assinatura (mesma regra de api/meso.js). O app
// escreve mesociclo por aqui, então "user" passa, e o carimbo que já estava no disco é mantido.
function guardMesoStamps(state, cur, actor) {
  const before = new Map((cur?.mesos || []).map(m => [m.id, m]));
  for (const m of state.mesos || []) {
    if (m.activatedBy === 'assistant' && actor.verified !== 'signature'
        && before.get(m.id)?.activatedBy !== 'assistant') m.activatedBy = 'user';
  }
}

// Exportado para o teste (`node --test api/routines.test.js`) e para reuso futuro.
export { checkState, checkRoutineFields, readActor, agentKey, matchRoute, readRawBody, readBody,
         cleanPushSub, restSeconds, sameSiteWrite, saveDbQuiet, readStateStrict, guardMesoStamps,
         readSession, readState, stateFile, atomicWrite, VOLATILE, DATA, SECRET, CATALOG_PATH, server,
         ROUTINE_HANDLERS, meso, micro, livePresence };

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

// Só os serviços de push dos navegadores: `endpoint` vem do cliente e o servidor faz POST nele, então
// sem esta lista qualquer sessão mandaria o servidor falar com qualquer host. Devolve só os campos
// que o envio usa (o resto do objeto iria parar no db.json), ou null.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/
];
const MAX_SUBS_PER_USER = 10;
function cleanPushSub(sub) {
  const short = (v, n) => typeof v === 'string' && !!v && v.length <= n;
  if (!short(sub?.endpoint, 2048) || !short(sub?.keys?.p256dh, 256) || !short(sub?.keys?.auth, 256)) return null;
  let u;
  try { u = new URL(sub.endpoint); } catch { return null; }
  if (u.protocol !== 'https:' || u.port || !PUSH_HOSTS.some(re => re.test(u.hostname))) return null;
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

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
  if (dirty) saveDbQuiet();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
// null quando o cliente não mandou um número: sem isto a ausência virava um alerta em 1 s.
function restSeconds(v) {
  const sec = Math.round(+v);
  return sec >= 1 ? Math.min(3600, sec) : null;
}
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
    saveDbQuiet();
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
// `SameSite=Lax` trata os irmãos de edsc.fun como o mesmo site, e share.edsc.fun serve HTML público:
// um POST de lá levaria o cookie. Cliente sem navegador (o agente) não manda este cabeçalho.
function sameSiteWrite(req) {
  return req.method !== 'GET' && req.method !== 'HEAD' && req.headers['sec-fetch-site'] === 'same-site';
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

/* ---------- passkeys da conta ---------- */
const MAX_PASSKEYS = 10;
const credsOf = user => db.creds.filter(x => x.userId === user.id);
function checkAssertion(c, credential, cred, requireUserVerification = false) {
  return verifyAuthenticationResponse({
    response: credential,
    expectedChallenge: c.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification,
    credential: {
      id: cred.id,
      publicKey: b64uToBuf(cred.publicKey),
      counter: cred.counter,
      transports: cred.transports
    }
  });
}
// Mexer nas passkeys pede uma passkey da conta, não só o cookie: um cookie roubado não pode virar
// acesso permanente, porque "sair de todos os aparelhos" encerra sessões, não passkeys.
// Devolve null quando a prova vale, ou o texto do erro.
async function proveOwner(body, user) {
  const c = takeChallenge(body.cid);
  if (!c || c.reauth !== user.id) return 'challenge expired — try again';
  const cred = credsOf(user).find(x => x.id === body.credential?.id);
  if (!cred) return 'that passkey is not on this profile';
  let verification;
  try { verification = await checkAssertion(c, body.credential, cred); }
  catch (e) { return 'verification failed: ' + e.message; }
  if (!verification.verified) return 'not verified';
  cred.counter = verification.authenticationInfo.newCounter;
  cred.lastUsed = new Date().toISOString();
  return null;
}

// Prova própria para aprovar proposta: o desafio é preso à proposta e ao conteúdo visto, usa campo
// separado de `reauth` (não serve para mexer em passkeys) e exige biometria ou PIN.
async function proposalChallenge(user, proposalId, approvalHash) {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID, userVerification: 'required', allowCredentials: []
  });
  const cid = putChallenge({ challenge: options.challenge, proposalReauth: user.id, proposalId, approvalHash });
  return { cid, options };
}
// Ligação ao treinador do chat (spec_treinador_por_usuario.md): desafio próprio, com biometria ou PIN.
// Campo `linkReauth`: não serve para passkeys nem para propostas, e os desafios delas não servem aqui.
async function linkChallenge(user) {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID, userVerification: 'required', allowCredentials: []
  });
  const cid = putChallenge({ challenge: options.challenge, linkReauth: user.id });
  return { cid, options };
}
async function proveLink(body, user) {
  const c = takeChallenge(body.cid);
  if (!c || c.linkReauth !== user.id) return 'challenge expired — try again';
  const cred = credsOf(user).find(x => x.id === body.credential?.id);
  if (!cred) return 'that passkey is not on this profile';
  let verification;
  try { verification = await checkAssertion(c, body.credential, cred, true); }
  catch (e) { return 'verification failed: ' + e.message; }
  if (!verification.verified) return 'not verified';
  cred.counter = verification.authenticationInfo.newCounter;
  cred.lastUsed = new Date().toISOString();
  return null;
}
async function proveProposal(body, user, proposalId, approvalHash) {
  const c = takeChallenge(body.cid);
  if (!c || c.proposalReauth !== user.id || c.proposalId !== proposalId || c.approvalHash !== approvalHash) {
    return 'challenge expired — try again';
  }
  const cred = credsOf(user).find(x => x.id === body.credential?.id);
  if (!cred) return 'that passkey is not on this profile';
  let verification;
  try { verification = await checkAssertion(c, body.credential, cred, true); }
  catch (e) { return 'verification failed: ' + e.message; }
  if (!verification.verified) return 'not verified';
  cred.counter = verification.authenticationInfo.newCounter;
  cred.lastUsed = new Date().toISOString();
  return null;
}

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
  { method: 'DELETE', re: /^\/api\/routines\/([A-Za-z0-9_-]{1,64})$/, params: ['rid'], handler: 'deleteRoutine' },
  { method: 'POST',   re: /^\/api\/plan\/meso\/([A-Za-z0-9_-]{1,64})\/activate$/, params: ['mid'], handler: 'activateMeso' },
  { method: 'DELETE', re: /^\/api\/plan\/meso\/([A-Za-z0-9_-]{1,64})$/, params: ['mid'], handler: 'deleteMeso' },
  { method: 'GET',  re: /^\/api\/proposals\/(prop-[a-z0-9-]{1,40})$/, params: ['pid'], handler: 'getProposal' },
  { method: 'POST', re: /^\/api\/proposals\/(prop-[a-z0-9-]{1,40})\/challenge$/, params: ['pid'], handler: 'challengeProposal' },
  { method: 'POST', re: /^\/api\/proposals\/(prop-[a-z0-9-]{1,40})\/approve$/, params: ['pid'], handler: 'approveProposal' },
  { method: 'POST', re: /^\/api\/proposals\/(prop-[a-z0-9-]{1,40})\/reject$/, params: ['pid'], handler: 'rejectProposal' }
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
      json(res, 200, { analysis, progress, meta: { uid: user.id, generatedAt: Date.now(), n_sets: analysis.n_sets, n_sessions: analysis.n_sessions, period: analysis.period } }, { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie', 'Pragma': 'no-cache' });
    } catch (e) { console.error('[coach] build error', safeUid, e); json(res, 500, { error: 'server error' }); }
  },

  // Lista leve de rotinas + metadado de concorrência (rev/_ts). 404 quando não há estado: o
  // agente liga o canal novo ao receber 200 daqui (spec_api_rotinas RF-9).
  'GET /api/routines': (req, res) => ROUTINE_HANDLERS.list(req, res),

  // Trilha de auditoria: quem escreveu o quê. Dono vê o dele; admin vê qualquer uid.
  'GET /api/audit': (req, res) => ROUTINE_HANDLERS.audit(req, res),

  // Mesociclo: o app escreve pelo estado (PUT /api/data); estas rotas são do assistente e do
  // `dump` do escritor. Overwrite total, sem regra sobre quem escreve (spec_meso_no_app §RF-12).
  // O DELETE é a exceção que não tem corpo: o id vai no caminho (`PATTERNS`) e a base no If-Match.
  'PUT /api/plan/meso': (req, res) => ROUTINE_HANDLERS.putMeso(req, res),
  'GET /api/plan/meso': (req, res) => ROUTINE_HANDLERS.getMeso(req, res),
  // Publicação da semana: N rotinas numa escrita só, upsert por id, dia só com autorização do
  // usuário (docs/specs/spec_publicacao_micro.md v6). Mesmo mapa de handlers: o matchRoute procura
  // handler de padrão só em ROUTINE_HANDLERS.
  'POST /api/plan/micro': (req, res) => ROUTINE_HANDLERS.publishMicro(req, res),
  'GET /api/proposals': (req, res) => ROUTINE_HANDLERS.listProposals(req, res),
  'GET /api/coach-link': (req, res) => COACH_LINK.getLink(req, res),
  'POST /api/coach-link/challenge': (req, res) => COACH_LINK.challengeLink(req, res),
  'POST /api/coach-link/start': (req, res) => COACH_LINK.startLink(req, res),
  'POST /api/coach-link/unlink': (req, res) => COACH_LINK.unlink(req, res),
  'POST /api/coach-link/activate': (req, res) => COACH_LINK.activateLink(req, res),
  // Chamadas pelo Cloudflare Access no login do conector (spec_liberacao_pelo_app.md). Sem sessão:
  // a entrada vem assinada pelo time e a resposta sai assinada pela chave do app.
  'GET /api/coach-access/keys': (req, res) => COACH_ACCESS.keys(req, res),
  'POST /api/coach-access/evaluate': (req, res) => COACH_ACCESS.evaluate(req, res),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: publicUser(user) });
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
      transports: body.credential?.response?.transports || [],
      created: user.created
    });
    saveDb();
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
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
    try { verification = await checkAssertion(c, body.credential, cred); }
    catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    cred.lastUsed = new Date().toISOString();
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  // Passkeys da própria conta. Uma conta pode ter várias: cada aparelho guarda a sua.
  'GET /api/passkeys': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { passkeys: credsOf(user).map(c => ({
      id: c.id, name: c.name || null, created: c.created || null, lastUsed: c.lastUsed || null
    })) });
  },

  // Primeiro passo de adicionar ou remover: o desafio que uma passkey da conta tem de assinar.
  'POST /api/passkeys/reauth/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    // Lista vazia, como no login: citar a passkey com `transports: ['internal']` faria o browser do
    // PC esconder o QR Code, que é justamente o caminho de quem só tem passkey no celular. Quem
    // confere se ela é desta conta é o proveOwner.
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, reauth: user.id });
    json(res, 200, { cid, options });
  },

  'POST /api/passkeys/add/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const refused = await proveOwner(body, user);
    if (refused) return json(res, 400, { error: refused });
    saveDb();
    if (credsOf(user).length >= MAX_PASSKEYS) return json(res, 409, { error: 'too many passkeys', code: 'TOO_MANY_PASSKEYS' });
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(user.id), userName: user.name, userDisplayName: user.name,
      attestationType: 'none',
      // `platform`: o botão promete "neste aparelho". Sem isto o Windows oferece salvar no celular,
      // que já tem a passkey dele, e a pessoa não ganha nada no PC.
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: credsOf(user).map(c => ({ id: c.id }))
    });
    const cid = putChallenge({ challenge: options.challenge, addFor: user.id });
    json(res, 200, { cid, options });
  },

  'POST /api/passkeys/add': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || c.addFor !== user.id) return json(res, 400, { error: 'challenge expired — try again' });
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
    if (credsOf(user).length >= MAX_PASSKEYS) return json(res, 409, { error: 'too many passkeys', code: 'TOO_MANY_PASSKEYS' });
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || [],
      name: String(body.name || '').trim().slice(0, 40) || null,
      created: new Date().toISOString()
    });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/passkeys/remove': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const refused = await proveOwner(body, user);
    if (refused) return json(res, 400, { error: refused });
    saveDb();
    const mine = credsOf(user);
    if (!mine.some(c => c.id === body.id)) return json(res, 404, { error: 'no such passkey' });
    // Sem passkey ninguém entra de novo, e não existe recuperação.
    if (mine.length <= 1) return json(res, 409, { error: 'cannot remove the last passkey', code: 'LAST_PASSKEY' });
    db.creds = db.creds.filter(c => c.id !== body.id);
    saveDb();
    json(res, 200, { ok: true });
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
    let state;
    try { state = readStateStrict(user.id); }
    catch (e) { return stateCorrupt(res, user.id, e); }
    // `rev` injetado (0 para um estado nunca escrito pela versão nova): sem isto o cliente não
    // teria base para mandar If-Match no primeiro sync.
    if (state && typeof state === 'object') state.rev = Number.isInteger(state.rev) ? state.rev : 0;
    json(res, 200, { state });
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
    if (bad) {
      console.log(`[og-state] op=put-rejected uid=${user.id} reason=invalid`);
      return json(res, 400, { error: bad });
    }
    let cur;
    try { cur = readStateStrict(user.id); }
    catch (e) { return stateCorrupt(res, user.id, e); }
    const badEx = checkRoutineFields(body.state, cur);
    if (badEx) {
      console.log(`[og-state] op=put-rejected uid=${user.id} reason=invalid code=${badEx.code}`);
      return json(res, 400, { error: badEx.message, code: badEx.code, field: badEx.field,
                              allowed: badEx.allowed || null });
    }
    const actor = readActor(req, user.id, raw, req.method, '/api/data');
    if (actor.err) return json(res, 400, { error: 'actor signature invalid', code: actor.err });
    guardMesoStamps(body.state, cur, actor);
    // Token forte (igualdade) quando o cliente manda um; senão o guard por `_ts` de sempre, para
    // o PWA publicado seguir funcionando (spec_api_rotinas RF-5/RF-10).
    const curRev = (cur && Number.isInteger(cur.rev)) ? cur.rev : 0;
    const ifMatch = routines.parseIfMatch(req.headers['if-match']);
    if (ifMatch === 'BAD') {
      return json(res, 400, { error: 'malformed If-Match', code: 'IF_MATCH_MALFORMED' });
    }
    if (ifMatch !== null && ifMatch !== '*') {
      if (ifMatch !== String(curRev)) {
        // BACKLOG-09: escrita RECUSADA também fica no log — sem isto não dá para contar as
        // requisições por edição (o cliente antigo paga 409 e reenvia; o novo, não).
        console.log(`[og-state] op=put-rejected uid=${user.id} reason=stale ifMatch=${ifMatch} serverRev=${curRev}`);
        return json(res, 409, { error: 'stale base, re-pull and merge', code: 'STALE_STATE',
                                rev: curRev, serverTs: cur?._ts || 0 });
      }
    } else {
      const incoming = body.state._ts || 0;
      if (cur && incoming < (cur._ts || 0)) {
        console.log(`[og-state] op=put-rejected uid=${user.id} reason=clock ifMatch=none serverRev=${curRev}`);
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
      // BACKLOG-09: o registro passa a dizer se a escrita trouxe o token de concorrência.
      // `'none'` é o caso do cliente antigo (e é o que o critério de saída conta); um `rev` é o
      // valor que o cliente mandou. Sem este campo não havia como distinguir as duas versões.
      ifMatch: ifMatch === null ? 'none' : ifMatch,
      stateHash: routines.sha256(routines.canon(body.state)),
      beforeHash: cur ? routines.sha256(routines.canon(cur)) : null,
      action: 'put-state', at: new Date().toISOString()
    };
    routines.appendAudit(DATA, { otp: meta.etag, uid: user.id, ...meta });
    console.log(`[og-state] op=put uid=${user.id} actor=${meta.actor} verified=${meta.verified} `
      + `ifMatch=${meta.ifMatch} rev=${curRev}->${meta.rev}`);
    json(res, 200, { ok: true, ts: body.state._ts, rev: meta.rev, meta });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = cleanPushSub(body.subscription);
    if (!sub) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, ...sub, created: new Date().toISOString() });
    const mine = db.subs.filter(s => s.userId === user.id);
    if (mine.length > MAX_SUBS_PER_USER) {       // a mais antiga sai: aparelho trocado não avisa
      const drop = new Set(mine.slice(0, mine.length - MAX_SUBS_PER_USER));
      db.subs = db.subs.filter(s => !drop.has(s));
    }
    saveDb();
    json(res, 200, { ok: true });
  },

  // O aparelho pergunta se o servidor ainda tem a inscrição dele: um 410 do serviço de push apaga o
  // registro aqui, e o navegador continua achando que está inscrito.
  'POST /api/push/check': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    json(res, 200, { known: db.subs.some(s => s.userId === user.id && s.endpoint === body.endpoint) });
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
    const sec = restSeconds(body.seconds);
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
        // string = rotina em uso; null = treino livre; ausente = app antigo, que não sabe dizer
        routineId: typeof body.routineId === 'string' ? body.routineId.slice(0, 64) : body.routineId === null ? null : undefined,
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
    if (u.disabled) {
      presence.delete(u.id);   // drop them off "training now" at once
      COACH_LINK.removerUsuario(u.id);   // e do treinador do chat: lista do Cloudflare e ligação
    }
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
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor, CATALOG_PATH,
  isAdmin, livePresence
}));
// Mesociclo: MESMO mapa, porque o `matchRoute` procura handler de padrão só em ROUTINE_HANDLERS —
// registrar num mapa próprio deixaria a rota de ativação respondendo 404.
Object.assign(ROUTINE_HANDLERS, meso.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor
}));
// Publicação da semana: mesmo mapa (ver acima). Recebe o `livePresence` — o acessor com TTL, não o
// Map cru: a checagem de treino em andamento não pode ler entrada velha de até ~100 s (A17).
Object.assign(ROUTINE_HANDLERS, micro.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readRawBody, json, DATA, readActor, livePresence, CATALOG_PATH
}));

// Propostas do treinador: mesmo mapa. Os nomes não podem colidir com `list` das rotinas.
Object.assign(ROUTINE_HANDLERS, proposals.makeHandlers({
  readSession, readState, stateFile, atomicWrite, readBody, json, DATA, livePresence, CATALOG_PATH,
  ownerUid: COACH_OWNER_UID, proposalChallenge, proveProposal, saveDb, autoApply: COACH_AUTO_APPLY
}));

// Ligação ao treinador do chat: rotas no mapa exato acima, chamadas só depois do boot.
const COACH_LINK = coachLink.makeHandlers({
  readSession, readBody, json, linkChallenge, proveLink, saveDb, users: () => db.users, ownerUid: COACH_OWNER_UID
});
const COACH_ACCESS = coachAccess.makeHandlers({ readBody, json, chaveArq: path.join(DATA, 'coach-access-key.pem') });

// Carrega o catálogo já no boot. Ausente ou ilegível = o servidor NÃO sobe: com o catálogo nulo
// a validação de rotina aceita id inexistente e a análise devolve o id no lugar do nome, as duas
// em silêncio. Contagem diferente do esperado é aviso, não erro: a base pode legitimamente
// crescer, e travar o boot por isso seria pior do que a divergência.
//
// A primeira carga normalmente já aconteceu no import do coach.js (que vem antes deste módulo,
// linha 12) — a mesma chamada aqui só reaproveita o cache pelo caminho.
{
  const cat = catalog.loadCatalog(CATALOG_PATH);
  if (!cat) {
    console.error(`[og-routine] FATAL: catalogo ausente/ilegivel em ${CATALOG_PATH}`);
    console.error('[og-routine] o arquivo canonico e frontend/src/lib/exercises-data.json');
    process.exit(1);
  }
  if (cat.size !== catalog.CATALOG_EXPECTED) {
    console.warn(`[og-routine] AVISO: catalogo com ${cat.size} exercicios `
      + `(esperado ${catalog.CATALOG_EXPECTED}) — confira o arquivo canonico`);
  }
}

const server = http.createServer(async (req, res) => {
  // Fora do try de baixo, um `//` viraria rejeição não tratada, e isso derruba o processo.
  let url;
  try { url = new URL(req.url, 'http://x'); }
  catch { return json(res, 400, { error: 'bad url' }); }
  const key = req.method + ' ' + url.pathname;     // usado só pelo catch abaixo
  const hit = matchRoute(req.method, url.pathname);
  if (!hit) return json(res, 404, { error: 'not found' });
  if (sameSiteWrite(req)) return json(res, 403, { error: 'same-site write refused', code: 'SAME_SITE' });
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
  if (COACH_AUTO_APPLY && COACH_OWNER_UID) {
    // Relógio de 3 s e aviso da pasta: o que chegar em `pending/` e puder entrar direto entra.
    const varrer = () => { try { ROUTINE_HANDLERS.varrerAutomaticas(); } catch (e) { console.error('[og-proposal] varrer', e.message); } };
    setInterval(varrer, 3000).unref();
    let tm = null;
    try {
      fs.watch(path.join(process.env.PROPOSALS_DIR || '/coach-proposals', 'pending'), () => {
        clearTimeout(tm); tm = setTimeout(varrer, 300);
      }).on('error', e => console.error('[og-proposal] watch', e.message));
    } catch (e) { console.error('[og-proposal] watch', e.message); }
    console.log('[og-proposal] gravacao direta ligada');
  }
  {
    // Pedidos de ligação do MCP: mesmo esquema das propostas, relógio e aviso da pasta.
    const varrer = () => { try { COACH_LINK.varrerPedidos(); } catch (e) { console.error('[og-link] varrer', e.message); } };
    setInterval(varrer, 2000).unref();
    let tm = null;
    try {
      fs.watch(path.join(process.env.COACH_LINKS_DIR || '/coach-links', 'requests'), () => {
        clearTimeout(tm); tm = setTimeout(varrer, 200);
      }).on('error', e => console.error('[og-link] watch', e.message));
    } catch (e) { console.error('[og-link] watch', e.message); }
  }
  if (COACH_OWNER_UID) {
    try { proposals.gravarPolitica(process.env.PROPOSALS_DIR || '/coach-proposals', COACH_AUTO_APPLY); }
    catch (e) { console.error('[og-proposal] politica', e.message); }
  }
}
