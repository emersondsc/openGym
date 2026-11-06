import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './coach-link.js';

function ambiente({ prova = () => null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-'));
  for (const d of ['requests', 'state/results']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  let t = Date.parse('2026-11-06T12:00:00Z');
  const users = [{ id: 'dono', name: 'Emerson' }, { id: 'maria', name: 'Maria' }, { id: 'off', name: 'X', disabled: true }];
  const h = L.makeHandlers({
    dir, ownerUid: 'dono', users: () => users, agora: () => t, saveDb: () => {},
    readSession: req => req.user ?? null, readBody: async req => req.body ?? {},
    json: (res, code, body) => { res.code = code; res.body = body; },
    linkChallenge: async u => ({ cid: 'c', options: { u: u.id } }), proveLink: async (b, u) => prova(b, u)
  });
  const chama = async (fn, user, body) => { const res = {}; await h[fn]({ user, body }, res); return res; };
  let n = 0;
  const pedir = (sub, code, extra = {}) => {
    const id = `req-t${n++}`;
    fs.writeFileSync(path.join(dir, 'requests', `${id}.json`), JSON.stringify({ sub, email: 'Pessoa@Ex.com ', code, at: new Date(t).toISOString(), ...extra }));
    h.varrerPedidos();
    return JSON.parse(fs.readFileSync(path.join(dir, 'state', 'results', `${id}.json`), 'utf8'));
  };
  const codigo = async uid => (await chama('startLink', { id: uid, name: uid })).body.code;
  return { dir, h, chama, pedir, codigo, avancar: ms => { t += ms; }, links: () => L.lerLinks(dir) };
}

test('codigo: alfabeto sem ambiguidade, 8 letras, formato XXXX-XXXX', () => {
  for (let i = 0; i < 200; i++) {
    const c = L.gerarCodigo();
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
  assert.equal(L.normCodigo(' k7m4-q2xp '), 'K7M4Q2XP');
  assert.equal(L.formatarCodigo('K7M4Q2XP'), 'K7M4-Q2XP');
});

test('sem sessao: 401 em todas as rotas', async () => {
  const e = ambiente();
  for (const fn of ['getLink', 'challengeLink', 'startLink', 'unlink']) assert.equal((await e.chama(fn, null)).code, 401, fn);
});

test('sem prova de passkey nao ha codigo', async () => {
  const e = ambiente({ prova: () => 'nao' });
  const r = await e.chama('startLink', { id: 'maria' });
  assert.deepEqual([r.code, r.body.code], [400, 'PASSKEY_REFUSED']);
});

test('liga com o codigo certo, grava sub e e-mail normalizado, papel por usuario', async () => {
  const e = ambiente();
  const r = e.pedir('sub-maria', (await e.codigo('maria')).toLowerCase());
  assert.deepEqual(r, { ok: true, name: 'Maria', owner: false, access: 'read' });
  const [l] = e.links();
  assert.deepEqual([l.sub, l.email, l.uid, l.owner, l.access], ['sub-maria', 'pessoa@ex.com', 'maria', false, 'read']);
  assert.equal(e.pedir('sub-dono', await e.codigo('dono')).access, 'write');
  assert.equal((await e.chama('getLink', { id: 'maria' })).body.linked.email, 'pessoa@ex.com');
  assert.equal(fs.statSync(path.join(e.dir, 'state', 'links.json')).mode & 0o777, 0o644);
});

test('codigo e de uso unico, expira e um novo invalida o anterior', async () => {
  const e = ambiente();
  const c = await e.codigo('maria');
  assert.equal(e.pedir('sub-a', c).ok, true);
  assert.equal(e.pedir('sub-a', c).code, 'INVALID_CODE');
  const velho = await e.codigo('dono');
  const novo = await e.codigo('dono');
  assert.equal(e.pedir('sub-b', velho).code, 'INVALID_CODE');
  e.avancar(L.CODIGO_MS + 1);
  assert.equal(e.pedir('sub-b', novo).code, 'INVALID_CODE');
});

test('um login liga a um usuario so, e um usuario a um login so', async () => {
  const e = ambiente();
  assert.equal(e.pedir('sub-a', await e.codigo('maria')).ok, true);
  assert.equal(e.pedir('sub-a', await e.codigo('dono')).code, 'LOGIN_ALREADY_LINKED');
  assert.equal(e.pedir('sub-b', await e.codigo('maria')).code, 'ACCOUNT_ALREADY_LINKED');
  assert.equal(e.links().length, 1);
});

test('desligar apaga a ligacao e o codigo vivo', async () => {
  const e = ambiente();
  e.pedir('sub-a', await e.codigo('maria'));
  const vivo = await e.codigo('maria');
  await e.chama('unlink', { id: 'maria' });
  assert.deepEqual(e.links(), []);
  assert.equal((await e.chama('getLink', { id: 'maria' })).body.linked, null);
  assert.equal(e.pedir('sub-a', vivo).code, 'INVALID_CODE');
});

test('cinco erros por hora travam a identidade, mesmo com o codigo certo', async () => {
  const e = ambiente();
  for (let i = 0; i < L.TENTATIVAS_HORA; i++) assert.equal(e.pedir('sub-x', 'AAAA-AAAA').code, 'INVALID_CODE');
  const c = await e.codigo('maria');
  assert.equal(e.pedir('sub-x', c).code, 'TOO_MANY_TRIES');
  e.avancar(3600001);
  assert.equal(e.pedir('sub-x', c).code, 'INVALID_CODE', 'o codigo expirou nesse tempo');
  assert.equal(e.pedir('sub-y', 'AAAA-AAAA').code, 'INVALID_CODE', 'outra identidade nao e afetada');
});

test('pedido malformado, velho ou de conta desativada nao liga', async () => {
  const e = ambiente();
  const c = await e.codigo('maria');
  assert.equal(e.pedir('sub com espaco', c).code, 'BAD_REQUEST');
  assert.equal(e.pedir('sub-a', c, { at: '2026-11-06T11:00:00Z' }).code, 'REQUEST_EXPIRED');
  assert.equal(e.pedir('sub-a', await e.codigo('off')).code, 'INVALID_CODE');
  fs.writeFileSync(path.join(e.dir, 'requests', 'req-lixo.json'), '{nao json');
  e.h.varrerPedidos();
  assert.equal(JSON.parse(fs.readFileSync(path.join(e.dir, 'state', 'results', 'req-lixo.json'), 'utf8')).code, 'BAD_REQUEST');
  assert.deepEqual(e.links(), []);
});
