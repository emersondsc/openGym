// api/coach-access.js — a porta do conector do treinador, decidida pelo app.
// Especificado em docs/specs/spec_liberacao_pelo_app.md.
//
// O Cloudflare Access ("avaliação externa") manda aqui, a cada login no conector, um JWT assinado
// pelo time com o e-mail de quem entrou. Respondemos com outro JWT, assinado pela nossa chave e com
// o mesmo nonce, dizendo se o e-mail foi ativado no app. O servidor não guarda chave do Cloudflare:
// só a nossa, que só serve para assinar esta resposta.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const normEmail = e => String(e ?? '').trim().toLowerCase();
const RESPOSTA_S = 60;
const CERTS_MS = 10 * 60000;

/* ---------- lista de liberados: coach-links/state/allowed.json, escrita só pela API ---------- */

export const arquivoLiberados = dir => path.join(dir, 'state', 'allowed.json');

export function lerLiberados(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(arquivoLiberados(dir), 'utf8'));
    return Array.isArray(j.allowed) ? j.allowed.filter(a => a && typeof a.uid === 'string' && typeof a.email === 'string') : [];
  } catch { return []; }
}

export function gravarLiberados(dir, allowed) {
  const f = arquivoLiberados(dir);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, allowed }), { mode: 0o644 });
  fs.renameSync(tmp, f);
}

/* ---------- JWT RS256 sem dependência ---------- */

const b64u = b => Buffer.from(b).toString('base64url');
const json64 = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function assinar(payload, chave, kid) {
  const corpo = `${b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}`;
  return `${corpo}.${crypto.sign('RSA-SHA256', Buffer.from(corpo), chave).toString('base64url')}`;
}

/** Confere a assinatura com uma das chaves públicas (por kid) e a validade. Devolve o payload ou null. */
export function conferir(token, chaves, agoraS) {
  if (typeof token !== 'string' || token.length > 16384) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  let cab, payload;
  try { cab = json64(partes[0]); payload = json64(partes[1]); } catch { return null; }
  if (cab.alg !== 'RS256' || typeof cab.kid !== 'string') return null;
  const chave = chaves.get(cab.kid);
  if (!chave) return null;
  let ok = false;
  try { ok = crypto.verify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), chave, Buffer.from(partes[2], 'base64url')); }
  catch { return null; }
  if (!ok || !payload || typeof payload !== 'object') return null;
  if (typeof payload.exp !== 'number' || payload.exp < agoraS) return null;
  return payload;
}

/* ---------- nossa chave ---------- */

export function carregarChave(arquivo) {
  let pem;
  try { pem = fs.readFileSync(arquivo, 'utf8'); }
  catch {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    fs.writeFileSync(arquivo, pem, { mode: 0o600, flag: 'wx' });
  }
  const privada = crypto.createPrivateKey(pem);
  const publica = crypto.createPublicKey(privada);
  const kid = crypto.createHash('sha256').update(publica.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  return { privada, kid, jwks: { keys: [{ ...publica.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] } };
}

/* ---------- handlers ---------- */

export function makeHandlers(deps) {
  const { readBody, json } = deps;
  const dir = deps.dir || process.env.COACH_LINKS_DIR || '/coach-links';
  const time = deps.time || process.env.COACH_ACCESS_TEAM || '';
  const agora = deps.agora || Date.now;
  const chaveArq = deps.chaveArq || path.join(process.env.DATA_DIR || '/data', 'coach-access-key.pem');
  // Chaves do time: buscadas na hora do primeiro login e de novo quando aparece kid novo.
  const buscarCerts = deps.buscarCerts || (async () => {
    const r = await fetch(`https://${time}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`certs ${r.status}`);
    return r.json();
  });
  let nossa = null;
  const minha = () => (nossa ||= carregarChave(chaveArq));
  let certs = new Map(), certsEm = 0;

  async function chavesDoTime(kid) {
    if (certs.has(kid) && agora() - certsEm < CERTS_MS) return certs;
    if (agora() - certsEm < 30000 && certs.size) return certs;     // kid desconhecido: não martela o Cloudflare
    const j = await buscarCerts();
    const m = new Map();
    for (const k of j.keys || []) { try { m.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })); } catch { /* ignora */ } }
    certs = m; certsEm = agora();
    return certs;
  }

  async function keys(req, res) {
    json(res, 200, minha().jwks);
  }

  async function evaluate(req, res) {
    const body = await readBody(req);
    const token = body && body.token;
    let entrada = null;
    let kid = null;
    try { kid = json64(String(token).split('.')[0]).kid; } catch { /* token ilegivel: recusa, sem culpar as chaves */ }
    if (time && typeof token === 'string' && typeof kid === 'string') {
      try { entrada = conferir(token, await chavesDoTime(kid), Math.floor(agora() / 1000)); }
      catch (e) { console.error('[og-access] certs', e.message); }
    }
    const email = normEmail(entrada?.identity?.email ?? entrada?.email);
    const quem = entrada && email ? lerLiberados(dir).find(a => normEmail(a.email) === email) : null;
    const success = !!quem;
    console.log(`[og-access] op=eval ok=${success}${quem ? ` uid=${quem.uid}` : ''}${entrada ? '' : ' token=invalido'}`);
    const iat = Math.floor(agora() / 1000);
    const k = minha();
    json(res, 200, { token: assinar({ success, nonce: entrada?.nonce ?? null, iat, exp: iat + RESPOSTA_S }, k.privada, k.kid) });
  }

  return { keys, evaluate };
}
