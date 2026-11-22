import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as O from './oauth.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-oauth-'));
const LINKS_DIR = path.join(TMP, 'coach-links');
fs.mkdirSync(path.join(LINKS_DIR, 'state'), { recursive: true });
process.env.DATA_DIR = TMP;
process.env.COACH_LINKS_DIR = LINKS_DIR;
process.env.MCP_RESOURCE = 'https://gym-mcp.edsc.fun/mcp';
process.env.PORT = '0';
delete process.env.RP_ID;
delete process.env.ORIGIN;
delete process.env.INVITE_ONLY;

const S = await import('./server.js');
const ORIGIN = 'http://localhost:8080';
const sha = b => crypto.createHash('sha256').update(b).digest();
const b64u = b => Buffer.from(b).toString('base64url');
const pkce = verifier => b64u(sha(verifier));

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
}

let baseUrl = '';
before(() => new Promise(resolve => {
  S.server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${S.server.address().port}`;
    resolve();
  });
}));
after(() => new Promise(resolve => {
  S.server.close(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    resolve();
  });
}));

async function signUp(name) {
  const key = new SoftKey();
  const r1 = await fetch(`${baseUrl}/api/register/options`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const o1 = await r1.json();
  const r2 = await fetch(`${baseUrl}/api/register/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cid: o1.cid, credential: key.create(o1.options) })
  });
  const cookie = r2.headers.get('set-cookie').split(';')[0];
  const { user } = await r2.json();
  return { user, cookie };
}

describe('oauth unidade', () => {
  test('metadados e validacao de redirect/SSRF', () => {
    const meta = O.authServerMetadata('https://opengym.edsc.fun/');
    assert.equal(meta.issuer, 'https://opengym.edsc.fun');
    assert.equal(meta.authorization_endpoint, 'https://opengym.edsc.fun/api/oauth/authorize');
    assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
    assert.equal(meta.client_id_metadata_document_supported, true);

    assert.equal(O.redirectOk('https://claude.ai/api/mcp/auth_callback'), true);
    assert.equal(O.redirectOk('http://127.0.0.1:4321/cb'), true);
    assert.equal(O.redirectOk('http://localhost:3000/cb'), true);
    assert.equal(O.redirectOk('http://evil.example/cb'), false);
    assert.equal(O.redirectOk('https://claude.ai/cb#frag'), false);

    assert.equal(O.isPrivateIp('127.0.0.1'), true);
    assert.equal(O.isPrivateIp('10.0.0.5'), true);
    assert.equal(O.isPrivateIp('169.254.169.254'), true);
    assert.equal(O.isPrivateIp('192.168.1.1'), true);
    assert.equal(O.isPrivateIp('::1'), true);
    assert.equal(O.isPrivateIp('fc00::1'), true);
    assert.equal(O.isPrivateIp('1.1.1.1'), false);
  });

  test('CIMD e resolucao com cache', async () => {
    O._clearCimdCache();
    assert.equal(O.isCimdId('https://claude.ai/oauth/client.json'), true);
    assert.equal(O.isCimdId('https://127.0.0.1/client.json'), false);
    assert.equal(O.isCimdId('http://claude.ai/client.json'), false);

    let fetches = 0;
    const doc = {
      client_id: 'https://claude.ai/oauth/client.json',
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none'
    };
    const r1 = await O.resolveCimd(doc.client_id, { fetchDoc: async () => { fetches++; return doc; } });
    const r2 = await O.resolveCimd(doc.client_id, { fetchDoc: async () => { fetches++; return doc; } });
    assert.equal(r1.ok, true);
    assert.equal(r1.client.name, 'Claude');
    assert.equal(r2.ok, true);
    assert.equal(fetches, 1);

    // ChatGPT CIMD: declara token_endpoint_auth_method private_key_jwt mas inclui none em supported
    const gpt = O.cimdClient('https://chatgpt.com/oauth/client.json', {
      client_id: 'https://chatgpt.com/oauth/client.json',
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_methods_supported: ['none', 'private_key_jwt']
    });
    assert.equal(gpt.ok, true);
    assert.equal(gpt.client.name, 'ChatGPT');

    const semNone = O.cimdClient('https://outro.example/client.json', {
      client_id: 'https://outro.example/client.json',
      redirect_uris: ['https://outro.example/cb'],
      token_endpoint_auth_method: 'private_key_jwt'
    });
    assert.equal(semNone.ok, false);
  });

  test('convidado recebe apenas read e dono recebe write; limite de 10 evicta mais antigo', () => {
    const db = { oauthClients: [], oauthTokens: [] };
    const reg = O.registerClient(db, {
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token']
    });
    assert.equal(reg.status, 201);
    const pending = new Map();
    const codes = new Map();
    const verifier = 'v'.repeat(50);
    const convidado = { id: 'u-conv', name: 'Maria', sv: 0 };
    const dono = { id: 'u-dono', name: 'Emerson', sv: 0 };

    const auth1 = O.startAuthorize(db, new URLSearchParams({
      client_id: reg.body.client_id,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      code_challenge: pkce(verifier),
      code_challenge_method: 'S256',
      scope: 'coach:write offline_access',
      resource: 'https://gym-mcp.edsc.fun/mcp'
    }), pending, 1000, { issuer: 'https://opengym.edsc.fun', resource: 'https://gym-mcp.edsc.fun/mcp' });
    assert.equal(auth1.ok, true);
    assert.equal(O.describeRequest(pending, auth1.request.id, convidado, 'u-dono', 1000).access, 'read');
    const ap1 = O.approve(pending, codes, auth1.request.id, convidado, db, { ownerUid: 'u-dono', now: 1000 });
    assert.equal(ap1.ok, true);
    assert.equal(ap1.row.access, 'read');

    for (let i = 0; i < 12; i++) {
      const a = O.startAuthorize(db, new URLSearchParams({
        client_id: reg.body.client_id,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        response_type: 'code',
        code_challenge: pkce(verifier),
        code_challenge_method: 'S256'
      }), pending, 2000 + i, { issuer: 'https://opengym.edsc.fun', resource: 'https://gym-mcp.edsc.fun/mcp' });
      const ap = O.approve(pending, codes, a.request.id, dono, db, { ownerUid: 'u-dono', now: 2000 + i });
      assert.equal(ap.row.access, 'write');
    }
    assert.equal(db.oauthTokens.filter(t => t.uid === 'u-dono').length, O.TOKENS_PER_USER_MAX);
  });

  test('refresh rotativo, janela de graca e deteccao de reuso', () => {
    let t = 10000;
    const db = { oauthClients: [], oauthTokens: [] };
    const reg = O.registerClient(db, {
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token']
    });
    const pending = new Map();
    const codes = new Map();
    const verifier = 'a'.repeat(50);
    const user = { id: 'u1', name: 'Ana', sv: 0 };

    const auth = O.startAuthorize(db, new URLSearchParams({
      client_id: reg.body.client_id,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      code_challenge: pkce(verifier),
      code_challenge_method: 'S256',
      scope: 'offline_access'
    }), pending, t);
    const ap = O.approve(pending, codes, auth.request.id, user, db, { now: t });
    const code = new URL(ap.redirect).searchParams.get('code');

    const ex = O.exchange(codes, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: reg.body.client_id,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_verifier: verifier
    }), db, t);
    assert.equal(ex.status, 200);
    const r1 = ex.body.refresh_token;

    // Uso normal: gira o par
    t += 5000;
    const rf1 = O.refresh(db, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r1 }), () => user, '', t);
    assert.equal(rf1.status, 200);
    assert.notEqual(rf1.body.refresh_token, r1);
    const r2 = rf1.body.refresh_token;

    // Retry dentro da janela de graca (< 60s): devolve novo par sem derrubar
    t += 10000;
    const grace = O.refresh(db, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r1 }), () => user, '', t);
    assert.equal(grace.status, 200);
    const r3 = grace.body.refresh_token;

    // Replay de r1 fora da janela de graca (> 60s): encerra a conexao inteira
    t += O.REFRESH_GRACE_MS + 1000;
    const replay = O.refresh(db, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r1 }), () => user, '', t);
    assert.equal(replay.status, 400);
    assert.equal(replay.changed, true);
    assert.equal(db.oauthTokens.length, 0);
    const afterKill = O.refresh(db, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r3 }), () => user, '', t);
    assert.equal(afterKill.status, 400);
    assert.equal(Boolean(r2), true);
  });
});

describe('oauth fluxo HTTP integrado ao server.js', () => {
  test('register -> authorize -> approve -> token -> syncCoachState -> revoke/logoutAll', async () => {
    const { user, cookie } = await signUp('Lucas');

    const meta = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`).then(r => r.json());
    assert.equal(meta.token_endpoint.endsWith('/api/oauth/token'), true);

    const reg = await fetch(`${baseUrl}/api/oauth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], grant_types: ['authorization_code', 'refresh_token'] })
    }).then(r => r.json());

    const verifier = 'verifier-seguro-com-mais-de-43-caracteres-123456';
    const authRes = await fetch(`${baseUrl}/api/oauth/authorize?` + new URLSearchParams({
      client_id: reg.client_id,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      code_challenge: pkce(verifier),
      code_challenge_method: 'S256',
      state: 'st-1',
      scope: 'offline_access',
      resource: 'https://gym-mcp.edsc.fun/mcp'
    }), { redirect: 'manual' });
    assert.equal(authRes.status, 302);
    const loc = authRes.headers.get('location');
    const reqId = loc.split('/#/connect/')[1];
    assert.ok(reqId);

    // Sem sessao -> 401
    assert.equal((await fetch(`${baseUrl}/api/oauth/request?id=${reqId}`)).status, 401);

    // Com sessao -> descreve e aprova sem passkey
    const desc = await fetch(`${baseUrl}/api/oauth/request?id=${reqId}`, { headers: { Cookie: cookie } }).then(r => r.json());
    assert.equal(desc.client, 'Claude');
    assert.equal(desc.access, 'read');
    assert.equal(desc.userName, 'Lucas');

    const ap = await fetch(`${baseUrl}/api/oauth/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: reqId })
    }).then(r => r.json());
    const cb = new URL(ap.redirect);
    assert.equal(cb.searchParams.get('state'), 'st-1');
    const code = cb.searchParams.get('code');

    // Troca por access_token + refresh_token com PKCE errado falha; com certo passa
    const badEx = await fetch(`${baseUrl}/api/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: 'errado'.repeat(10) })
    });
    assert.equal(badEx.status, 400);

    // O codigo era de uso unico; faz outro para testar o fluxo completo
    const auth2 = await fetch(`${baseUrl}/api/oauth/authorize?` + new URLSearchParams({
      client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code', code_challenge: pkce(verifier), code_challenge_method: 'S256', scope: 'offline_access'
    }), { redirect: 'manual' });
    const req2 = auth2.headers.get('location').split('/#/connect/')[1];
    const ap2 = await fetch(`${baseUrl}/api/oauth/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: req2 })
    }).then(r => r.json());
    const code2 = new URL(ap2.redirect).searchParams.get('code');

    const tok = await fetch(`${baseUrl}/api/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code2, client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: verifier })
    }).then(r => r.json());
    assert.equal(tok.token_type, 'Bearer');
    assert.equal(tok.access_token.startsWith('ogt_'), true);
    assert.equal(tok.refresh_token.startsWith('ogr_'), true);

    // Arquivo sincronizado para o MCP e espelho
    const oauthFile = JSON.parse(fs.readFileSync(path.join(LINKS_DIR, 'state', 'oauth-tokens.json'), 'utf8'));
    assert.equal(oauthFile.tokens.some(t => t.uid === user.id && t.h === O.tokenSha(tok.access_token) && t.access === 'read'), true);
    const linksFile = JSON.parse(fs.readFileSync(path.join(LINKS_DIR, 'state', 'links.json'), 'utf8'));
    assert.equal(linksFile.links.some(l => l.uid === user.id && l.via === 'oauth'), true);

    // GET /api/coach-link lista as 2 conexoes (ap e ap2) e permite revogar uma individualmente
    const info = await fetch(`${baseUrl}/api/coach-link`, { headers: { Cookie: cookie } }).then(r => r.json());
    assert.equal(info.connectorUrl, 'https://gym-mcp.edsc.fun/mcp');
    assert.equal(info.oauthConnections.length, 2);

    const revOne = await fetch(`${baseUrl}/api/oauth/connections/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: info.oauthConnections[0].id })
    }).then(r => r.json());
    assert.equal(revOne.connections.length, 1);

    // Logout em todos os aparelhos revoga imediatamente no arquivo do MCP
    await fetch(`${baseUrl}/api/logout/all`, { method: 'POST', headers: { Cookie: cookie } });
    const afterLogout = JSON.parse(fs.readFileSync(path.join(LINKS_DIR, 'state', 'oauth-tokens.json'), 'utf8'));
    assert.equal(afterLogout.tokens.some(t => t.uid === user.id), false);
    const linksAfter = JSON.parse(fs.readFileSync(path.join(LINKS_DIR, 'state', 'links.json'), 'utf8'));
    assert.equal(linksAfter.links.some(l => l.uid === user.id), false);
  });
});
