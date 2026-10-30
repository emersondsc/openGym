// api/passkeys.test.js — várias passkeys por conta, de ponta a ponta pelo HTTP. O autenticador é de
// software: assina de verdade, então é a verificação real do @simplewebauthn/server que roda aqui.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-passkeys-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';
delete process.env.RP_ID;
delete process.env.ORIGIN;

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
const list = async cookie => (await call('/api/passkeys', cookie)).data.passkeys;

describe('passkeys da conta', () => {
  test('sem sessão, nada', async () => {
    assert.equal((await call('/api/passkeys')).status, 401);
    for (const u of ['reauth/options', 'add/options', 'add', 'remove']) {
      assert.equal((await call('/api/passkeys/' + u, null, {})).status, 401, u);
    }
  });

  test('a passkey nova entra na MESMA conta, e o login segue com as duas', async () => {
    const me = await signUp('Ana');
    const { key, options } = await add(me.cookie, me.key);
    assert.deepEqual(options.excludeCredentials.map(c => c.id), [b64u(me.key.id)]);
    const keys = await list(me.cookie);
    assert.equal(keys.length, 2);
    assert.equal(keys[1].name, 'Windows');
    assert.equal('publicKey' in keys[0], false);
    assert.equal((await login(key)).data.user.id, me.id);
    assert.equal((await login(me.key)).data.user.id, me.id);
  });

  test('só o cookie não basta para adicionar', async () => {
    const me = await signUp('Bia');
    assert.equal((await call('/api/passkeys/add/options', me.cookie, {})).status, 400);
    const { data } = await call('/api/passkeys/reauth/options', me.cookie, {});
    assert.equal((await call('/api/passkeys/add/options', me.cookie, { cid: data.cid })).status, 400);
    assert.equal((await list(me.cookie)).length, 1);
  });

  test('o desafio de prova não cria passkey, e cada desafio vale uma vez', async () => {
    const me = await signUp('Caio');
    const p = await proof(me.cookie, me.key);
    assert.equal((await call('/api/passkeys/add', me.cookie, { cid: p.cid, credential: new SoftKey().create({ challenge: 'x' }) })).status, 400);
    assert.equal((await call('/api/passkeys/add/options', me.cookie, p)).status, 400);
  });

  test('passkey de outra conta não prova nada', async () => {
    const a = await signUp('Dani'), b = await signUp('Edu');
    const { data } = await call('/api/passkeys/reauth/options', a.cookie, {});
    const r = await call('/api/passkeys/add/options', a.cookie, { cid: data.cid, credential: b.key.get(data.options) });
    assert.equal(r.status, 400);
  });

  test('desafio de um usuário não serve para outro', async () => {
    const a = await signUp('Fabi'), b = await signUp('Gui');
    const step = await call('/api/passkeys/add/options', a.cookie, await proof(a.cookie, a.key));
    const r = await call('/api/passkeys/add', b.cookie, { cid: step.data.cid, credential: new SoftKey().create(step.data.options) });
    assert.equal(r.status, 400);
    assert.equal((await list(b.cookie)).length, 1);
  });

  test('remove outra, recusa a última e a removida não entra mais', async () => {
    const me = await signUp('Hugo');
    const { key } = await add(me.cookie, me.key);
    const [first, second] = await list(me.cookie);
    assert.equal((await call('/api/passkeys/remove', me.cookie, { id: second.id })).status, 400);   // sem prova
    assert.equal((await call('/api/passkeys/remove', me.cookie, { ...(await proof(me.cookie, me.key)), id: second.id })).status, 200);
    assert.equal((await login(key)).status, 404);
    const last = await call('/api/passkeys/remove', me.cookie, { ...(await proof(me.cookie, me.key)), id: first.id });
    assert.equal(last.status, 409);
    assert.equal(last.data.code, 'LAST_PASSKEY');
    assert.equal((await login(me.key)).status, 200);
  });

  test('não remove passkey de outra conta', async () => {
    const a = await signUp('Iara'), b = await signUp('João');
    await add(a.cookie, a.key);
    const [theirs] = await list(b.cookie);
    assert.equal((await call('/api/passkeys/remove', a.cookie, { ...(await proof(a.cookie, a.key)), id: theirs.id })).status, 404);
    assert.equal((await list(b.cookie)).length, 1);
  });

  test('teto de 10 por conta', async () => {
    const me = await signUp('Kim');
    for (let i = 0; i < 9; i++) await add(me.cookie, me.key);
    assert.equal((await call('/api/passkeys/add/options', me.cookie, await proof(me.cookie, me.key))).data.code, 'TOO_MANY_PASSKEYS');
  });
});
