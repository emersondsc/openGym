// api/coach-link.js — liga a identidade do Cloudflare Access (`sub`) a um usuário do app.
// Especificado em docs/specs/spec_treinador_por_usuario.md.
//
// A pessoa gera um código no app, com passkey, e o informa ao treinador no chat. O MCP não tem
// credencial do app: só grava o pedido em `requests/` e lê `state/`. Quem confere o código e grava a
// ligação é esta API. `state/links.json` é a fonte da verdade de "quem é quem" para o MCP.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sem I, L, O, 0 e 1
export const CODIGO_LEN = 8;
export const CODIGO_MS = 10 * 60000;
export const TENTATIVAS_HORA = 5;
export const PEDIDO_MS = 2 * 60000;
const REQ_RE = /^(req-[a-z0-9-]{1,40})\.json$/;
const SUB_RE = /^[A-Za-z0-9._:|@-]{1,200}$/;
const MAX_PEDIDO = 4096;

export const normCodigo = c => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatarCodigo = c => `${c.slice(0, 4)}-${c.slice(4)}`;
export const normEmail = e => String(e ?? '').trim().toLowerCase();

/** Código sem viés: descarta bytes acima do maior múltiplo do alfabeto. */
export function gerarCodigo(rand = crypto.randomBytes) {
  const teto = 256 - (256 % ALFABETO.length);
  let out = '';
  while (out.length < CODIGO_LEN) {
    for (const b of rand(16)) if (b < teto && out.length < CODIGO_LEN) out += ALFABETO[b % ALFABETO.length];
  }
  return out;
}

export function lerLinks(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'links.json'), 'utf8'));
    return Array.isArray(j.links) ? j.links : [];
  } catch { return []; }
}

function gravarJson(f, dados) {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados), { mode: 0o644 });
  fs.renameSync(tmp, f);
}
const gravarLinks = (dir, links) => gravarJson(path.join(dir, 'state', 'links.json'), { version: 1, links });

export function makeHandlers(deps) {
  const { readSession, readBody, json, linkChallenge, proveLink, saveDb, users } = deps;
  const ownerUid = deps.ownerUid || '';
  const dir = deps.dir || process.env.COACH_LINKS_DIR || '/coach-links';
  const agora = deps.agora || Date.now;
  const codigos = new Map();      // código -> {uid, exp}
  const falhas = new Map();       // sub -> [instantes das tentativas erradas]

  const sessao = (req, res) => {
    const user = readSession(req);
    if (!user) json(res, 401, { error: 'not signed in', code: 'UNAUTH' });
    return user;
  };
  const publico = l => (l ? { email: l.email, linked_at: l.linked_at, access: l.access } : null);

  async function getLink(req, res) {
    const user = sessao(req, res);
    if (!user) return;
    json(res, 200, { linked: publico(lerLinks(dir).find(l => l.uid === user.id)) });
  }

  async function challengeLink(req, res) {
    const user = sessao(req, res);
    if (!user) return;
    json(res, 200, await linkChallenge(user));
  }

  async function startLink(req, res) {
    const user = sessao(req, res);
    if (!user) return;
    const body = await readBody(req);
    const recusada = await proveLink(body, user);
    if (recusada) return json(res, 400, { error: recusada, code: 'PASSKEY_REFUSED' });
    saveDb();
    for (const [c, v] of codigos) if (v.uid === user.id) codigos.delete(c);   // um código vivo por pessoa
    let code;
    do { code = gerarCodigo(); } while (codigos.has(code));
    const exp = agora() + CODIGO_MS;
    codigos.set(code, { uid: user.id, exp });
    console.log(`[og-link] op=code uid=${user.id}`);
    json(res, 200, { code: formatarCodigo(code), expires_at: new Date(exp).toISOString() });
  }

  async function unlink(req, res) {
    const user = sessao(req, res);
    if (!user) return;
    for (const [c, v] of codigos) if (v.uid === user.id) codigos.delete(c);
    const links = lerLinks(dir);
    const resto = links.filter(l => l.uid !== user.id);
    if (resto.length !== links.length) gravarLinks(dir, resto);
    console.log(`[og-link] op=unlink uid=${user.id} had=${links.length - resto.length}`);
    json(res, 200, { ok: true });
  }

  /** Confere um pedido do MCP. Devolve o resultado que o MCP vai ler. */
  function processar(p) {
    const t = agora();
    if (!p || typeof p.sub !== 'string' || !SUB_RE.test(p.sub) || typeof p.email !== 'string' || p.email.length > 254
        || typeof p.code !== 'string' || p.code.length > 40 || Number.isNaN(Date.parse(p.at))) {
      return { ok: false, code: 'BAD_REQUEST' };
    }
    if (t - Date.parse(p.at) > PEDIDO_MS) return { ok: false, code: 'REQUEST_EXPIRED' };
    const recentes = (falhas.get(p.sub) || []).filter(x => t - x < 3600000);
    falhas.set(p.sub, recentes);
    if (recentes.length >= TENTATIVAS_HORA) return { ok: false, code: 'TOO_MANY_TRIES' };
    const falha = code => { recentes.push(t); return { ok: false, code }; };
    const codigo = normCodigo(p.code);
    const c = codigos.get(codigo);
    if (!c || c.exp < t) { codigos.delete(codigo); return falha('INVALID_CODE'); }
    const user = users().find(u => u.id === c.uid);
    if (!user || user.disabled) { codigos.delete(codigo); return falha('INVALID_CODE'); }
    const links = lerLinks(dir);
    if (links.some(l => l.sub === p.sub && l.uid !== user.id)) return { ok: false, code: 'LOGIN_ALREADY_LINKED' };
    if (links.some(l => l.uid === user.id && l.sub !== p.sub)) return { ok: false, code: 'ACCOUNT_ALREADY_LINKED' };
    codigos.delete(codigo);                                   // uso único
    const dono = !!ownerUid && user.id === ownerUid;
    const entrada = { sub: p.sub, email: normEmail(p.email), uid: user.id, name: user.name, owner: dono,
      access: dono ? 'write' : 'read', linked_at: new Date(t).toISOString() };
    gravarLinks(dir, [...links.filter(l => l.uid !== user.id), entrada]);
    console.log(`[og-link] op=link uid=${user.id} owner=${dono}`);
    return { ok: true, name: user.name, owner: dono, access: entrada.access };
  }

  /** Lê `requests/` e responde cada pedido novo em `state/results/`. Exportada para o teste. */
  function varrerPedidos() {
    let nomes = [];
    try { nomes = fs.readdirSync(path.join(dir, 'requests')); } catch { return 0; }
    const resultados = path.join(dir, 'state', 'results');
    let n = 0;
    for (const nome of nomes) {
      const m = REQ_RE.exec(nome);
      if (!m || fs.existsSync(path.join(resultados, `${m[1]}.json`))) continue;
      let p = null;
      try {
        const f = path.join(dir, 'requests', nome);
        const st = fs.lstatSync(f);
        if (st.isFile() && st.size <= MAX_PEDIDO) p = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch { /* pedido ilegivel: responde BAD_REQUEST */ }
      let r;
      try { r = processar(p); } catch (e) { console.error('[og-link] processar', e.message); r = { ok: false, code: 'SERVER_ERROR' }; }
      try { gravarJson(path.join(resultados, `${m[1]}.json`), r); n++; }
      catch (e) { console.error('[og-link] resultado', e.message); }
    }
    // Resultados velhos saem: o MCP lê o seu em segundos.
    try {
      for (const nome of fs.readdirSync(resultados)) {
        const f = path.join(resultados, nome);
        if (agora() - fs.statSync(f).mtimeMs > 3600000) fs.rmSync(f, { force: true });
      }
    } catch { /* sem pasta */ }
    return n;
  }

  return { getLink, challengeLink, startLink, unlink, varrerPedidos };
}
