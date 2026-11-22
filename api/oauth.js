// api/oauth.js — OAuth 2.1 para o conector MCP (RFC 8414, RFC 7591, CIMD, PKCE S256, RFC 9207, RFC 7009).
// Emite tokens `ogt_` (e refresh tokens rotativos `ogr_`) cujo hash SHA-256 é espelhado em
// `coach-links/state/oauth-tokens.json` para que o `opengym-mcp` valide e revogue sem chamada HTTP.
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';

export const CLIENTS_MAX = 300;
export const TOKENS_PER_USER_MAX = 10;
export const REQUEST_TTL_MS = 10 * 60000;
export const CODE_TTL_MS = 10 * 60000;
export const ACCESS_TTL_MS = 24 * 3600000;
export const FALLBACK_ACCESS_TTL_MS = 90 * 86400000;
export const CONNECTION_TTL_MS = 365 * 86400000;
export const REFRESH_GRACE_MS = 60000;
const CLIENT_IDLE_MS = 90 * 86400000;

export const TOKEN_PREFIX = 'ogt_';
export const REFRESH_PREFIX = 'ogr_';
const GRANTS = ['authorization_code', 'refresh_token'];
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

const rnd = n => crypto.randomBytes(n).toString('base64url');
const b64sha = v => crypto.createHash('sha256').update(v).digest('base64url');
export const tokenSha = v => crypto.createHash('sha256').update('opengym-token:' + v).digest('hex');
export const refreshSha = v => crypto.createHash('sha256').update('opengym-refresh:' + v).digest('hex');

export function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

const cleanName = (v, fallback) => String(v || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 60) || fallback;

/* ---------- Metadados RFC 8414 ---------- */

export function authServerMetadata(issuer) {
  const base = String(issuer || '').replace(/\/+$/, '');
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['coach:read', 'offline_access'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true
  };
}

/* ---------- Redirects e clientes ---------- */

export function redirectOk(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.hash || u.username || u.password || String(raw).length > 500) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && LOOPBACK.includes(u.hostname);
}

function sameRedirect(registered, asked) {
  if (registered === asked) return true;
  try {
    const a = new URL(registered), b = new URL(asked);
    return a.protocol === 'http:' && LOOPBACK.includes(a.hostname)
      && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search && b.protocol === 'http:';
  } catch { return false; }
}

export function assistantOf(redirect, name = '') {
  let host = '';
  try { host = new URL(redirect).hostname.toLowerCase(); } catch { /* sem url */ }
  const under = d => host === d || host.endsWith('.' + d);
  if (under('claude.ai') || under('claude.com') || under('anthropic.com')) return 'claude';
  if (under('chatgpt.com') || under('openai.com')) return 'chatgpt';
  if (under('gemini.google.com') || under('google.com') || under('googleusercontent.com')) return 'gemini';
  if (LOOPBACK.includes(host) || LOOPBACK.includes('[' + host + ']')) {
    if (/claude/i.test(name)) return 'claude';
    if (/chatgpt|codex|openai/i.test(name)) return 'chatgpt';
    if (/gemini/i.test(name)) return 'gemini';
  }
  return 'other';
}

export function registerClient(db, body, now = Date.now()) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter(u => typeof u === 'string') : [];
  if (!uris.length || uris.length > 5 || !uris.every(redirectOk)) {
    return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'redirect_uris: 1-5 https addresses (or http on localhost)' } };
  }
  const name = cleanName(body?.client_name, 'MCP client');
  const grants = Array.isArray(body?.grant_types) ? GRANTS.filter(g => body.grant_types.includes(g)) : ['authorization_code'];
  if (!grants.includes('authorization_code')) grants.unshift('authorization_code');
  db.oauthClients = (db.oauthClients || []).filter(c => c && now - (c.used || c.created) < CLIENT_IDLE_MS);
  if (db.oauthClients.length >= CLIENTS_MAX) db.oauthClients.sort((a, b) => (a.used || a.created) - (b.used || b.created)).shift();
  const client = { id: 'ogc_' + rnd(18), name, redirects: uris, grants, created: now, used: null };
  db.oauthClients.push(client);
  return {
    status: 201,
    body: {
      client_id: client.id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: grants,
      response_types: ['code']
    }
  };
}

export const clientOf = (db, id) => (db.oauthClients || []).find(c => c && c.id === id) || null;

/* ---------- Client ID Metadata Documents (CIMD) + proteção SSRF ---------- */

export function isCimdId(id) {
  if (typeof id !== 'string' || id.length > 500 || !id.startsWith('https://')) return false;
  try {
    const u = new URL(id);
    return u.protocol === 'https:' && u.pathname.length > 1 && !u.hash && !u.username && !u.password
      && !u.hostname.startsWith('[') && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) && !/(^|\.)localhost$/i.test(u.hostname);
  } catch { return false; }
}

export function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  const low = ip.toLowerCase();
  if (low === '::' || low === '::1') return true;
  if (low.startsWith('fc') || low.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(low)) return true;
  return false;
}

export function publicLookup() {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs }];
      if (!list.length || list.some(a => isPrivateIp(a.address))) {
        return cb(Object.assign(new Error('private address blocked'), { code: 'EACCES' }));
      }
      if (options?.all) return cb(null, list);
      cb(null, list[0].address, list[0].family || (net.isIPv6(list[0].address) ? 6 : 4));
    });
  };
}

export function cimdClient(id, doc) {
  if (!doc || typeof doc !== 'object' || doc.client_id !== id) {
    return { ok: false, error: 'the client metadata document does not name itself as its client_id' };
  }
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(u => typeof u === 'string') : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectOk)) {
    return { ok: false, error: 'the client metadata document lists no usable redirect_uris' };
  }
  const methods = Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported : null;
  const method = doc.token_endpoint_auth_method || 'none';
  if (method !== 'none' && !(methods && methods.includes('none'))) {
    return { ok: false, error: 'only public clients (token_endpoint_auth_method none) are supported' };
  }
  const grants = Array.isArray(doc.grant_types) ? GRANTS.filter(g => doc.grant_types.includes(g)) : ['authorization_code'];
  let name = cleanName(doc.client_name, '');
  if (!name) { try { name = new URL(id).hostname; } catch { name = 'MCP client'; } }
  return { ok: true, client: { id, name, redirects: uris, grants, cimd: true } };
}

const cimdCache = new Map();
const CIMD_TTL_MS = 3600000;

export async function resolveCimd(id, { fetchDoc, lookup, now = Date.now() } = {}) {
  if (!isCimdId(id)) return { ok: false, error: 'not a client metadata document address' };
  const hit = cimdCache.get(id);
  if (hit && now - hit.at < CIMD_TTL_MS) return hit.r;
  let doc;
  try { doc = await (fetchDoc || (u => getJson(u, lookup)))(id); }
  catch (e) { return { ok: false, error: 'the client metadata document could not be fetched: ' + (e?.message || e) }; }
  const r = cimdClient(id, doc);
  if (cimdCache.size > 200) cimdCache.delete(cimdCache.keys().next().value);
  cimdCache.set(id, { r, at: now });
  return r;
}
export const _clearCimdCache = () => cimdCache.clear();

function getJson(url, lookup) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'openGym' }, timeout: 5000, ...(lookup ? { lookup } : {}) }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let size = 0;
      const chunks = [];
      res.on('data', d => {
        size += d.length;
        if (size > 5120) { req.destroy(new Error('larger than 5 KB')); return; }
        chunks.push(d);
      });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('not JSON')); } });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

/* ---------- Authorize e consentimento ---------- */

export function resourceOk(asked, expected) {
  if (!asked || !expected) return true;
  const norm = s => String(s).replace(/\/+$/, '').toLowerCase();
  return norm(asked) === norm(expected);
}

function withQuery(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

export function startAuthorize(db, q, pending, now = Date.now(), opts = {}) {
  const client = opts.client || clientOf(db, q.get('client_id'));
  const redirect = q.get('redirect_uri') || (client && client.redirects.length === 1 ? client.redirects[0] : '');
  if (!client) return { ok: false, error: 'unknown client_id: register the client first' };
  if (!client.redirects.some(r => sameRedirect(r, redirect))) {
    return { ok: false, error: 'redirect_uri is not one this client registered' };
  }
  const back = (error, description) => ({
    ok: false, error: description,
    redirect: withQuery(redirect, { error, error_description: description, state: q.get('state') || undefined, iss: opts.issuer || undefined })
  });
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'response_type must be code');
  const challenge = q.get('code_challenge') || '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return back('invalid_request', 'PKCE with code_challenge_method S256 is required');
  }
  if (!resourceOk(q.get('resource'), opts.resource)) {
    return back('invalid_target', 'resource is not this openGym\'s MCP address');
  }
  for (const [k, v] of pending) if (now - v.at > REQUEST_TTL_MS) pending.delete(k);
  if (pending.size > 1000) pending.delete(pending.keys().next().value);
  const id = rnd(18);
  const words = String(q.get('scope') || '').split(/\s+/);
  const refresh = words.includes('offline_access') || (client.grants || []).includes('refresh_token');
  const request = {
    id, clientId: client.id, clientName: client.name, redirect, challenge, state: q.get('state') || null,
    resource: q.get('resource') || null, refresh, issuer: opts.issuer || null,
    assistant: assistantOf(client.cimd ? client.id : redirect, client.name), at: now
  };
  pending.set(id, request);
  return { ok: true, request };
}

export function describeRequest(pending, id, user, ownerUid, now = Date.now()) {
  const r = pending.get(id);
  if (!r || now - r.at > REQUEST_TTL_MS) return null;
  let host = '', loopback = false;
  try { const u = new URL(r.redirect); host = u.host; loopback = LOOPBACK.includes(u.hostname); } catch { /* validado no authorize */ }
  const owner = !!ownerUid && user.id === ownerUid;
  return {
    id, client: r.clientName, assistant: r.assistant, redirectHost: host, loopback,
    access: owner ? 'write' : 'read', userName: user.name
  };
}

function activeTokens(db, userById, now) {
  db.oauthTokens = (db.oauthTokens || []).filter(r => {
    if (!r || typeof r.h !== 'string' || typeof r.uid !== 'string') return false;
    if (r.exp && r.exp <= now) return false;
    const u = userById(r.uid);
    if (!u || u.disabled || (u.sv || 0) !== (r.sv || 0)) return false;
    return true;
  });
  return db.oauthTokens;
}

export function approve(pending, codes, id, user, db, { ownerUid = '', now = Date.now() } = {}) {
  const r = pending.get(id);
  if (!r || now - r.at > REQUEST_TTL_MS) {
    return { ok: false, status: 400, error: 'this sign-in has expired; start it again from the assistant' };
  }
  if (!user || user.disabled) return { ok: false, status: 403, error: 'account disabled' };
  pending.delete(id);

  db.oauthTokens = (db.oauthTokens || []).filter(t => t && !(t.exp && t.exp <= now) && (t.uid !== user.id || (t.sv || 0) === (user.sv || 0)));
  const mine = () => db.oauthTokens.filter(t => t.uid === user.id);
  while (mine().length >= TOKENS_PER_USER_MAX) {
    const oldest = mine().sort((a, b) => (a.used || a.created) - (b.used || b.created))[0];
    if (!oldest) break;
    db.oauthTokens = db.oauthTokens.filter(t => t !== oldest);
  }

  const owner = !!ownerUid && user.id === ownerUid;
  const access = owner ? 'write' : 'read';
  const accessToken = TOKEN_PREFIX + rnd(32);
  const refreshToken = r.refresh ? REFRESH_PREFIX + rnd(32) : null;
  const exp = now + CONNECTION_TTL_MS;
  const aexp = Math.min(now + (refreshToken ? ACCESS_TTL_MS : FALLBACK_ACCESS_TTL_MS), exp);
  const row = {
    id: 'tok_' + rnd(12),
    uid: user.id,
    name: r.clientName,
    assistant: r.assistant,
    client: r.clientId,
    owner,
    access,
    h: tokenSha(accessToken),
    rh: refreshToken ? refreshSha(refreshToken) : null,
    prh: null,
    rotated: 0,
    sv: user.sv || 0,
    created: now,
    used: null,
    aexp,
    exp
  };
  db.oauthTokens.push(row);

  for (const [k, v] of codes) if (now - v.at > CODE_TTL_MS) codes.delete(k);
  const code = rnd(32);
  const scope = access === 'write' ? 'coach:read coach:write' : 'coach:read';
  const expiresIn = Math.max(1, Math.round((aexp - now) / 1000));
  codes.set(code, {
    token: accessToken, refresh: refreshToken, scope, expiresIn,
    clientId: r.clientId, redirect: r.redirect, challenge: r.challenge, at: now
  });
  return {
    ok: true,
    row,
    redirect: withQuery(r.redirect, { code, state: r.state || undefined, iss: r.issuer || undefined })
  };
}

export function deny(pending, id) {
  const r = pending.get(id);
  if (!r) return { ok: false, status: 400, error: 'this sign-in has expired' };
  pending.delete(id);
  return { ok: true, redirect: withQuery(r.redirect, { error: 'access_denied', state: r.state || undefined, iss: r.issuer || undefined }) };
}

/* ---------- Token endpoint e revogação ---------- */

export function basicClientId(header) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(header || '').trim());
  if (!m) return null;
  try {
    const s = Buffer.from(m[1], 'base64').toString('utf8');
    const i = s.indexOf(':');
    return decodeURIComponent(i < 0 ? s : s.slice(0, i)) || null;
  } catch { return null; }
}

export function exchange(codes, form, db, now = Date.now()) {
  const bad = (error, desc) => ({ status: 400, body: { error, error_description: desc } });
  if (form.get('grant_type') !== 'authorization_code') {
    return bad('unsupported_grant_type', 'only authorization_code and refresh_token');
  }
  const code = form.get('code') || '';
  const c = codes.get(code);
  codes.delete(code);
  if (!c || now - c.at > CODE_TTL_MS) return bad('invalid_grant', 'the code is unknown, used or expired');
  if (form.get('client_id') && form.get('client_id') !== c.clientId) {
    return bad('invalid_grant', 'the code was issued to another client');
  }
  if (form.get('redirect_uri') && !sameRedirect(c.redirect, form.get('redirect_uri'))) {
    return bad('invalid_grant', 'redirect_uri does not match');
  }
  const verifier = form.get('code_verifier') || '';
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || b64sha(verifier) !== c.challenge) {
    return bad('invalid_grant', 'code_verifier does not match the challenge');
  }
  const client = clientOf(db, c.clientId);
  if (client) client.used = now;
  return {
    status: 200,
    body: {
      access_token: c.token,
      token_type: 'Bearer',
      scope: c.scope,
      ...(c.expiresIn ? { expires_in: c.expiresIn } : {}),
      ...(c.refresh ? { refresh_token: c.refresh } : {})
    }
  };
}

export function refresh(db, form, userById, ownerUid = '', now = Date.now()) {
  const bad = (desc, changed = false) => ({ status: 400, body: { error: 'invalid_grant', error_description: desc }, changed });
  const value = form.get('refresh_token') || '';
  if (!value.startsWith(REFRESH_PREFIX) || value.length !== REFRESH_PREFIX.length + 43) {
    return bad('the refresh token is unknown');
  }
  const h = refreshSha(value);
  let row = null, stale = false;
  for (const r of db.oauthTokens || []) {
    if (!r) continue;
    if (sameHash(r.rh, h)) { row = r; stale = false; break; }
    if (sameHash(r.prh, h)) { row = r; stale = true; break; }
  }
  if (!row) return bad('the refresh token is unknown, used or revoked');
  if (form.get('client_id') && form.get('client_id') !== row.client) {
    return bad('the refresh token was issued to another client');
  }
  const ownerUser = userById(row.uid);
  if ((row.exp && row.exp <= now) || !ownerUser || ownerUser.disabled || (ownerUser.sv || 0) !== (row.sv || 0)) {
    return bad('the connection has ended; connect the assistant again');
  }
  if (stale && now - (row.rotated || 0) > REFRESH_GRACE_MS) {
    db.oauthTokens = db.oauthTokens.filter(r => r !== row);
    return bad('this refresh token was already used, so the connection was ended for safety; connect the assistant again', true);
  }
  const accessToken = TOKEN_PREFIX + rnd(32);
  const nextRefresh = REFRESH_PREFIX + rnd(32);
  const isOwner = !!ownerUid && ownerUser.id === ownerUid;
  row.owner = isOwner;
  row.access = isOwner ? 'write' : 'read';
  row.h = tokenSha(accessToken);
  row.prh = stale ? row.prh : row.rh;
  row.rh = refreshSha(nextRefresh);
  row.rotated = now;
  row.used = now;
  row.aexp = Math.min(now + ACCESS_TTL_MS, row.exp || Infinity);
  const client = clientOf(db, row.client);
  if (client) client.used = now;
  return {
    status: 200,
    changed: true,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      scope: row.access === 'write' ? 'coach:read coach:write' : 'coach:read',
      expires_in: Math.max(1, Math.round((row.aexp - now) / 1000)),
      refresh_token: nextRefresh
    }
  };
}

export function revokeByValue(db, value) {
  if (typeof value !== 'string' || !value) return false;
  let target = null;
  if (value.startsWith(REFRESH_PREFIX)) {
    const h = refreshSha(value);
    target = (db.oauthTokens || []).find(r => r && (sameHash(r.rh, h) || sameHash(r.prh, h))) || null;
  } else if (value.startsWith(TOKEN_PREFIX)) {
    const h = tokenSha(value);
    target = (db.oauthTokens || []).find(r => r && sameHash(r.h, h)) || null;
  }
  if (!target) return false;
  db.oauthTokens = (db.oauthTokens || []).filter(r => r !== target);
  return true;
}

export function revokeForUser(db, uid, tokenId = null) {
  const before = (db.oauthTokens || []).length;
  db.oauthTokens = (db.oauthTokens || []).filter(r => {
    if (!r || r.uid !== uid) return true;
    if (tokenId && r.id !== tokenId) return true;
    return false;
  });
  return before - db.oauthTokens.length;
}

export function listForUser(db, uid, now = Date.now()) {
  return (db.oauthTokens || [])
    .filter(r => r && r.uid === uid && !(r.exp && r.exp <= now))
    .map(r => ({
      id: r.id,
      name: r.name,
      assistant: r.assistant || 'other',
      access: r.access || 'read',
      created: r.created,
      used: r.used || null,
      exp: r.exp || null
    }))
    .sort((a, b) => (b.used || b.created) - (a.used || a.created));
}

/* ---------- Sincronização com `coach-links/state/` para o MCP e espelho ---------- */

function atomicJson(file, dados) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados), { mode: 0o644 });
  fs.renameSync(tmp, file);
}

/**
 * Grava `oauth-tokens.json` (hashes ativos para o `opengym-mcp` validar sem rede) e mantém
 * `links.json` atualizado para o `espelho/todos.py` gerar/limpar `coach-mirror/<uid>/`.
 */
export function syncCoachState(dir, db, userById, ownerUid = '', now = Date.now()) {
  const stateDir = path.join(dir, 'state');
  if (!fs.existsSync(stateDir)) return;
  const ativos = activeTokens(db, userById, now);
  const tokens = ativos.map(r => {
    const u = userById(r.uid);
    const owner = !!ownerUid && u.id === ownerUid;
    return {
      id: r.id,
      h: r.h,
      uid: u.id,
      name: u.name,
      owner,
      access: owner ? 'write' : 'read',
      aexp: r.aexp || r.exp || null,
      exp: r.exp || null
    };
  });
  atomicJson(path.join(stateDir, 'oauth-tokens.json'), { version: 1, tokens });

  const linksPath = path.join(stateDir, 'links.json');
  let links = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(linksPath, 'utf8'));
    if (Array.isArray(parsed.links)) links = parsed.links;
  } catch { /* sem links.json ainda */ }

  // Preserva vínculos antigos do Access (`sub`) enquanto houver transição e mantém um registro por uid OAuth.
  const preserved = links.filter(l => l && typeof l.sub === 'string' && typeof l.uid === 'string' && !l.via);
  const byUid = new Map();
  for (const r of ativos) {
    if (byUid.has(r.uid)) continue;
    const u = userById(r.uid);
    const owner = !!ownerUid && u.id === ownerUid;
    byUid.set(r.uid, {
      uid: u.id,
      name: u.name,
      owner,
      access: owner ? 'write' : 'read',
      linked_at: new Date(r.created || now).toISOString(),
      via: 'oauth'
    });
  }
  const merged = [...preserved];
  for (const [uid, entry] of byUid) {
    if (!preserved.some(l => l.uid === uid)) merged.push(entry);
  }
  atomicJson(linksPath, { version: 1, links: merged });
}
