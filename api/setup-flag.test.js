// api/setup-flag.test.js — pré-início (configuração inicial de conta nova): o marcador setupPending no db.json.
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
process.env.SETUP_ENABLED = ' 0 ';
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

describe('pré-início desligado pela flag SETUP_ENABLED', () => {
  test('conta nova não fica pendente no /api/me, mas o marcador continua gravado', async () => {
    const r = await signUp('Flag');
    assert.equal((await call('/api/me', r.cookie)).data.user.setupPending, false);
    const disk = JSON.parse(fs.readFileSync(path.join(TMP, 'db.json'), 'utf8')).users.find(u => u.id === r.id);
    assert.equal(disk.setupPending, true);
  });
});
