import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as A from './coach-access.js';

// Um "time do Cloudflare" falso: par de chaves próprio e certs no formato JWKS.
const time = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const intruso = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERTS = { keys: [{ ...time.publicKey.export({ format: 'jwk' }), kid: 'kid-time', alg: 'RS256' }] };

function ambiente({ team = 'time.cloudflareaccess.com' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-'));
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  A.gravarLiberados(dir, [{ uid: 'maria', email: 'maria@ex.com', enabled_at: '2026-11-06T12:00:00Z' }]);
  const t = Date.parse('2026-11-06T12:00:00Z');
  let buscas = 0;
  const chaveArq = path.join(dir, 'chave.pem');
  const h = A.makeHandlers({
    dir, time: team, agora: () => t, chaveArq, buscarCerts: async () => { buscas++; return CERTS; },
    readBody: async req => req.body ?? {}, json: (res, code, body) => { res.code = code; res.body = body; }
  });
  const chama = async (fn, body) => { const res = {}; await h[fn]({ body }, res); return res; };
  const entrada = (claims, chave = time.privateKey, kid = 'kid-time') =>
    A.assinar({ nonce: 'n-123', exp: t / 1000 + 300, identity: { email: 'Maria@Ex.com' }, ...claims }, chave, kid);
  /** Avalia e confere a resposta com a chave pública que /keys publica, como o Cloudflare faz. */
  const avaliar = async token => {
    const jwks = (await chama('keys')).body;
    const nossas = new Map(jwks.keys.map(k => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
    const r = await chama('evaluate', { token });
    assert.equal(r.code, 200);
    const p = A.conferir(r.body.token, nossas, t / 1000);
    assert.ok(p, 'a resposta tem de ser assinada pela chave publicada');
    return p;
  };
  return { dir, t, h, chama, entrada, avaliar, chaveArq, buscas: () => buscas };
}

test('e-mail ativado no app passa, com o nonce de volta e validade curta', async () => {
  const e = ambiente();
  const p = await e.avaliar(e.entrada({}));
  assert.equal(p.success, true);
  assert.equal(p.nonce, 'n-123');
  assert.equal(p.exp - p.iat, 60);
});

test('e-mail que ninguem ativou nao passa', async () => {
  const e = ambiente();
  assert.equal((await e.avaliar(e.entrada({ identity: { email: 'outro@ex.com' } }))).success, false);
  assert.equal((await e.avaliar(e.entrada({ identity: {} }))).success, false);
});

test('token falso, vencido ou sem time configurado nao passa', async () => {
  const e = ambiente();
  const falso = await e.avaliar(e.entrada({}, intruso.privateKey));
  assert.deepEqual([falso.success, falso.nonce], [false, null]);
  assert.equal((await e.avaliar(e.entrada({ exp: e.t / 1000 - 1 }))).success, false);
  assert.equal((await e.avaliar(e.entrada({}, time.privateKey, 'kid-outro'))).success, false);
  assert.equal((await e.avaliar('lixo')).success, false);
  assert.equal((await e.avaliar(undefined)).success, false);
  const sem = ambiente({ team: '' });
  assert.equal((await sem.avaliar(sem.entrada({}))).success, false);
});

test('chave do app: criada uma vez com 0600 e reaproveitada; certs ficam em cache', async () => {
  const e = ambiente();
  const kid1 = (await e.chama('keys')).body.keys[0].kid;
  assert.equal(fs.statSync(e.chaveArq).mode & 0o777, 0o600);
  assert.equal(A.carregarChave(e.chaveArq).kid, kid1);
  assert.equal((await e.chama('keys')).body.keys[0].d, undefined, 'nunca publica a parte privada');
  await e.avaliar(e.entrada({}));
  await e.avaliar(e.entrada({}));
  assert.equal(e.buscas(), 1);
});

test('lista ilegivel vale como vazia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-'));
  fs.mkdirSync(path.join(dir, 'state'));
  assert.deepEqual(A.lerLiberados(dir), []);
  fs.writeFileSync(A.arquivoLiberados(dir), '{quebrado');
  assert.deepEqual(A.lerLiberados(dir), []);
  A.gravarLiberados(dir, [{ uid: 'a', email: 'a@b.co' }, { uid: 1 }]);
  assert.deepEqual(A.lerLiberados(dir).map(a => a.uid), ['a']);
  assert.equal(fs.statSync(A.arquivoLiberados(dir)).mode & 0o777, 0o644);
});
