// api/setup.test.js — pré-início (configuração inicial de conta nova): o marcador setupPending no db.json.
// Os helpers (SoftKey, call, signUp, login) são cópia dos de api/passkeys.test.js, que não os exporta.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-setup-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';
delete process.env.RP_ID;
delete process.env.ORIGIN;
delete process.env.INVITE_ONLY;
delete process.env.ADMIN_UIDS;
delete process.env.SETUP_ENABLED;
const S = await import('./server.js');
const ORIGIN = 'http://localhost:8080';
const sha = b => crypto.createHash('sha256').update(b).digest();
const b64u = b => Buffer.from(b).toString('base64url');

class SoftKey {
  constructor() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.priv = privateKey;
    this.jwk = publicKey.export({ format: 'jwk' });
    this.id = crypto.randomBytes(16);
    this.counter = 0;
  }
  clientData(type, challenge) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));
  }
  flagsAndCount(flags) {
    const n = Buffer.alloc(4);
    n.writeUInt32BE(++this.counter);
    return Buffer.concat([sha('localhost'), Buffer.from([flags]), n]);
  }
  create(options) {
    const cd = this.clientData('webauthn.create', options.challenge);
    const cose = Buffer.concat([Buffer.from('a50102032620012158' + '20', 'hex'), Buffer.from(this.jwk.x, 'base64url'),
                                Buffer.from('225820', 'hex'), Buffer.from(this.jwk.y, 'base64url')]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.id.length);
    const authData = Buffer.concat([this.flagsAndCount(0x45), Buffer.alloc(16), len, this.id, cose]);
    const size = Buffer.alloc(2);
    size.writeUInt16BE(authData.length);
    const att = Buffer.concat([Buffer.from('a3', 'hex'), Buffer.from([0x63]), Buffer.from('fmt'), Buffer.from([0x64]),
      Buffer.from('none'), Buffer.from([0x67]), Buffer.from('attStmt'), Buffer.from('a0', 'hex'), Buffer.from([0x68]),
      Buffer.from('authData'), Buffer.from('59', 'hex'), size, authData]);
    return { id: b64u(this.id), rawId: b64u(this.id), type: 'public-key', clientExtensionResults: {},
             response: { clientDataJSON: b64u(cd), attestationObject: b64u(att), transports: ['internal'] } };
  }
  get(options) {
    const cd = this.clientData('webauthn.get', options.challenge);
    const authData = this.flagsAndCount(0x05);
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha(cd)]), this.priv);
    return { id: b64u(this.id), rawId: b64u(this.id), type: 'public-key', clientExtensionResults: {},
             response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null } };
  }
}

let base;
before(async () => {
  await new Promise(ok => S.server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${S.server.address().port}`;
});
after(async () => {
  await new Promise(ok => S.server.close(ok));
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function call(url, cookie, body) {
  const r = await fetch(base + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function signUp(name) {
  const key = new SoftKey();
  const { data } = await call('/api/register/options', null, { name });
  const r = await call('/api/register/verify', null, { cid: data.cid, credential: key.create(data.options) });
  assert.equal(r.status, 200);
  return { key, cookie: r.cookie, id: r.data.user.id };
}
async function proof(cookie, key) {
  const { data } = await call('/api/passkeys/reauth/options', cookie, {});
  assert.deepEqual(data.options.allowCredentials ?? [], []);   // sem isso o PC não mostra o QR Code
  return { cid: data.cid, credential: key.get(data.options) };
}
async function add(cookie, proofKey, name = 'Windows') {
  const key = new SoftKey();
  const step = await call('/api/passkeys/add/options', cookie, await proof(cookie, proofKey));
  assert.equal(step.status, 200);
  const r = await call('/api/passkeys/add', cookie, { cid: step.data.cid, credential: key.create(step.data.options), name });
  assert.equal(r.status, 200);
  return { key, options: step.data.options };
}
async function login(key) {
  const { data } = await call('/api/login/options', null, {});
  return call('/api/login/verify', null, { cid: data.cid, credential: key.get(data.options) });
}

const me = async cookie => (await call('/api/me', cookie)).data.user;
const done = cookie => call('/api/me/setup-done', cookie, {});
const reset = (cookie, body) => call('/api/admin/user/setup-reset', cookie, body);
const diskUser = id => JSON.parse(fs.readFileSync(path.join(TMP, 'db.json'), 'utf8')).users.find(u => u.id === id);
const memUser = id => S.db.users.find(u => u.id === id);
async function putState(cookie) {
  const r = await fetch(base + '/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ state: { workouts: [], routines: [], _ts: Date.now() } })
  });
  return r.status;
}

describe('pré-início: marcador setupPending', () => {
  let fresh, old;
  before(async () => {
    fresh = await signUp('Fresh');
    old = await signUp('Old');
    // Formato de uma conta anterior ao deploy (sem o campo), e admin para o teste do reset.
    delete memUser(old.id).setupPending;
    memUser(old.id).admin = true;
  });

  test('cadastro novo começa pendente, na resposta e no /api/me', async () => {
    const r = await signUp('Nova');
    assert.equal((await me(r.cookie)).setupPending, true);
    assert.equal(diskUser(r.id).setupPending, true);
  });

  test('conta antiga, sem o campo, nunca fica pendente (G3)', async () => {
    assert.equal((await me(old.cookie)).setupPending, false);
  });

  test('PUT do estado (G3): não cria nem apaga setupPending, na memória e no disco', async () => {
    assert.equal(await putState(fresh.cookie), 200);
    assert.equal(await putState(old.cookie), 200);
    assert.equal(memUser(fresh.id).setupPending, true);
    assert.equal(diskUser(fresh.id).setupPending, true);
    assert.equal('setupPending' in memUser(old.id), false);
    assert.equal((await me(old.cookie)).setupPending, false);
  });

  test('setup-done sem sessão responde 401', async () => {
    assert.equal((await done(null)).status, 401);
  });

  test('setup-done limpa o marcador e é idempotente', async () => {
    const r = await signUp('Termina');
    const a = await done(r.cookie);
    assert.equal(a.status, 200);
    assert.equal(a.data.user.setupPending, false);
    assert.equal('setupPending' in diskUser(r.id), false);
    const b = await done(r.cookie);
    assert.equal(b.status, 200);
    assert.equal(b.data.user.setupPending, false);
    assert.equal((await me(r.cookie)).setupPending, false);
  });

  test('setup-reset: 403 sem admin, 400 sem id, 404 sem usuário, 200 grava', async () => {
    const r = await signUp('Reset');
    await done(r.cookie);
    assert.equal((await reset(fresh.cookie, { id: r.id })).status, 403);
    assert.equal((await reset(old.cookie, {})).status, 400);
    assert.equal((await reset(old.cookie, { id: 'nao-existe' })).status, 404);
    const ok = await reset(old.cookie, { id: r.id });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, { ok: true, id: r.id });
    assert.equal(diskUser(r.id).setupPending, true);
    assert.equal((await me(r.cookie)).setupPending, true);
  });

  test('a lista do admin mostra quem está pendente', async () => {
    const { data } = await call('/api/admin/users', old.cookie);
    assert.equal(data.users.find(u => u.id === fresh.id).setupPending, true);
    assert.equal(data.users.find(u => u.id === old.id).setupPending, false);
  });
});
