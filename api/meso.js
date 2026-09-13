// api/meso.js — mesociclo: validação do núcleo, upsert e ativação.
//
// Regra que manda aqui (decisão do usuário 13/09/2026): a API valida FORMA, nunca conteúdo, e a
// operação é **overwrite total** — substitui o mesociclo daquele id, inteiro, sem comparar com o
// que estava lá e sem regra nenhuma sobre quem escreveu (quem coordena é o assistente, lendo antes
// de escrever; isso não é assunto desta API). Um arquivo mais rico que o nosso objeto entra
// inteiro: campo desconhecido é preservado em qualquer nível.
import { withState, parseIfMatch, checkIfMatch, stateMeta } from './routines.js';

export const MESO_ID_RE = /^meso-\d{4}-\d{2}-\d{2}$/;
export const MAX_MESO_BYTES = 64 * 1024;
export const MAX_MESOS = 40;
export const MAX_WEEKS = 52;
export const MAX_RULES = 40;
export const MAX_LOG = 200;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDate = s => {
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
/** Tamanho em bytes do objeto como ele vai ser gravado (usado aqui e no `checkState`). */
export const mesoBytes = m => Buffer.byteLength(JSON.stringify(m), 'utf8');
const tooLong = (v, n) => typeof v === 'string' && v.trim().length > n;

/**
 * Só o núcleo, com os limites da tabela do §6 da spec. Devolve null quando passa, ou
 * { error, code, field } — a forma que o `json(res, 400, …)` do server.js espera.
 */
export function validateMesoBody(meso) {
  if (!meso || typeof meso !== 'object' || Array.isArray(meso)) {
    return { error: 'meso required', code: 'MESO_REQUIRED', field: 'meso' };
  }
  if (!MESO_ID_RE.test(String(meso.id || ''))) {
    return { error: 'id must be meso-YYYY-MM-DD', code: 'BAD_MESO_ID', field: 'id' };
  }
  if (!meso.name || typeof meso.name !== 'string' || !meso.name.trim()) {
    return { error: 'name required', code: 'BAD_MESO_NAME', field: 'name' };
  }
  if (tooLong(meso.name, 120)) {
    return { error: 'name must be <= 120 chars', code: 'BAD_MESO_NAME', field: 'name' };
  }
  if (!ISO.test(String(meso.start || '')) || !realDate(meso.start)) {
    return { error: 'start must be a real ISO date', code: 'BAD_MESO_START', field: 'start' };
  }
  if (meso.end != null && (!ISO.test(String(meso.end)) || !realDate(meso.end) || meso.end < meso.start)) {
    return { error: 'end must be a date >= start', code: 'BAD_MESO_END', field: 'end' };
  }
  if (meso.origin != null && meso.origin !== 'user' && meso.origin !== 'assistant') {
    return { error: 'origin must be user or assistant', code: 'BAD_MESO_ORIGIN', field: 'origin' };
  }
  if (tooLong(meso.goal, 400)) {
    return { error: 'goal must be <= 400 chars', code: 'BAD_MESO_GOAL', field: 'goal' };
  }
  const weeks = meso.weeks;
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > MAX_WEEKS) {
    return { error: `weeks must be 1..${MAX_WEEKS}`, code: 'BAD_MESO_WEEKS', field: 'weeks' };
  }
  let prevEnd = null;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      return { error: 'week must be an object', code: 'BAD_MESO_WEEK', field: 'weeks' };
    }
    // `n` sequencial de 1 a N: é o que o servidor exige para o cliente não precisar ordenar nada.
    if (w.n !== i + 1) {
      return { error: 'week.n must run 1..N in order', code: 'BAD_MESO_WEEK_N', field: 'weeks' };
    }
    for (const k of ['start', 'end']) {
      if (w[k] != null && (!ISO.test(String(w[k])) || !realDate(w[k]))) {
        return { error: `week.${k} must be a real ISO date`, code: 'BAD_MESO_WEEK_DATE', field: 'weeks' };
      }
    }
    if (w.start != null && w.end != null && w.end < w.start) {
      return { error: 'week.end must be >= week.start', code: 'BAD_MESO_WEEK_DATE', field: 'weeks' };
    }
    if (prevEnd && w.start != null && w.start < prevEnd) {
      return { error: 'weeks must be in date order', code: 'BAD_MESO_WEEK_ORDER', field: 'weeks' };
    }
    if (w.start != null && w.start < meso.start) {
      return { error: 'week starts before the mesocycle', code: 'BAD_MESO_WEEK_RANGE', field: 'weeks' };
    }
    if (meso.end != null && w.end != null && w.end > meso.end) {
      return { error: 'week ends after the mesocycle', code: 'BAD_MESO_WEEK_RANGE', field: 'weeks' };
    }
    if (tooLong(w.phase, 80)) {
      return { error: 'week.phase must be <= 80 chars', code: 'BAD_MESO_PHASE', field: 'weeks' };
    }
    prevEnd = w.end || prevEnd;
  }
  const rules = meso.rules;
  if (rules != null) {
    if (typeof rules !== 'object' || Array.isArray(rules)) {
      return { error: 'rules must be a map', code: 'BAD_MESO_RULES', field: 'rules' };
    }
    const keys = Object.keys(rules);
    if (keys.length > MAX_RULES) {
      return { error: `too many rules (max ${MAX_RULES})`, code: 'BAD_MESO_RULES', field: 'rules' };
    }
    for (const k of keys) {
      if (!k.trim() || k.length > 40 || String(rules[k]).length > 600) {
        return { error: 'rule label or value too long', code: 'BAD_MESO_RULES', field: 'rules' };
      }
    }
  }
  if (meso.log != null && (!Array.isArray(meso.log) || meso.log.length > MAX_LOG)) {
    return { error: `log must be a list of <= ${MAX_LOG} entries`, code: 'BAD_MESO_LOG', field: 'log' };
  }
  return null;
}

/** Chamado pelo `checkState` do server.js: teto e forma mínima, nunca a tabela inteira. */
export function checkMesos(list) {
  if (!Array.isArray(list)) return 'mesos must be an array';
  if (list.length > MAX_MESOS) return 'too many mesocycles';
  for (const m of list) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return 'mesocycle must be an object';
    if (!MESO_ID_RE.test(String(m.id || ''))) return 'mesocycle.id must be meso-YYYY-MM-DD';
    if (!Array.isArray(m.weeks) || !m.weeks.length) return 'mesocycle.weeks required';
    if (mesoBytes(m) > MAX_MESO_BYTES) return 'mesocycle too large';
  }
  return null;
}

/* ---------------------------------------------------------------- handlers */

export function makeHandlers(deps) {
  const { readSession, readState, json, readActor, readRawBody } = deps;

  /**
   * Sessão obrigatória + assinatura de agente opcional, verificada quando presente. A ordem das
   * checagens é a do `patch` de rotina: sessão → corpo → If-Match → forma. Um corpo inválido sem
   * token tem de responder 428, não 400 — é o que faz o cliente reler em vez de "corrigir".
   */
  async function open(req, pathname) {
    const raw = await readRawBody(req).catch(() => null);
    if (raw === null) return { code: 400, body: { error: 'body too large or unreadable' } };
    const user = readSession(req);
    if (!user) return { code: 401, body: { error: 'not signed in', code: 'UNAUTH' } };
    const actor = readActor(req, user.id, raw, req.method, pathname);
    if (actor.err) return { code: 400, body: { error: 'actor signature invalid', code: actor.err } };
    return { raw, user, actor };
  }

  async function putMeso(req, res) {
    const o = await open(req, '/api/plan/meso');
    if (o.code) return json(res, o.code, o.body);
    const { raw, user, actor } = o;
    let body;
    try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json' }); }

    const ifMatch = parseIfMatch(req.headers['if-match']);
    const S0 = readState(user.id);
    if (!S0 || typeof S0 !== 'object') {
      return json(res, 409, { error: 'no state for this profile', code: 'NO_STATE' });
    }
    const pre = checkIfMatch(S0, ifMatch);
    if (pre) return json(res, pre.code, pre.body);

    const bad = validateMesoBody(body.meso);
    if (bad) return json(res, 400, bad);
    if (mesoBytes(body.meso) > MAX_MESO_BYTES) {
      return json(res, 400, { error: 'meso too large', code: 'MESO_TOO_BIG' });
    }
    const activate = body.activate === 'now' ? 'now' : 'none';

    const r = withState(deps, user.id,
      { ifMatch, actor, action: 'put-meso', uid: user.id, dropActive: false },
      S => {
        const list = Array.isArray(S.mesos) ? S.mesos : (S.mesos = []);
        const i = list.findIndex(m => m.id === body.meso.id);
        if (i < 0 && list.length >= MAX_MESOS) {
          return { error: 'too many mesocycles', code: 'TOO_MANY_MESOS', code_http: 409 };
        }
        const created = i < 0;
        const prev = created ? null : list[i];
        // Os carimbos de ativação NUNCA vêm do corpo: sem isto, qualquer sessão manda
        // `activatedBy: "assistant"` e a tela mostra "Ativado pelo assistente" sem assinatura.
        const { activatedBy, activatedAt, ...rest } = body.meso;
        const meso = { ...rest, updatedAt: new Date().toISOString() };
        if (activate === 'now') {
          // Republicar com `activate: "now"` o mesociclo que JÁ é o ativo não pode perder o
          // carimbo: o carimbo é reescrito sempre; o ponteiro só se move quando muda de verdade.
          meso.activatedAt = new Date().toISOString();
          meso.activatedBy = actor.verified === 'signature' ? 'assistant' : 'user';
        } else if (prev) {
          if (prev.activatedAt) meso.activatedAt = prev.activatedAt;   // substituir não desativa
          if (prev.activatedBy) meso.activatedBy = prev.activatedBy;
        }
        if (created) list.push(meso); else list[i] = meso;
        const activated = activate === 'now' && S.activeMeso !== meso.id;
        if (activated) {
          S.mesoPrev = S.activeMeso || null;
          S.activeMeso = meso.id;
        }
        return { _meta: { mesoId: meso.id, created, activated, activate } };
      });

    if (r.code === 200) {
      const m = r.body.meta || {};
      console.log(`[og-meso] op=put-meso uid=${user.id} meso=${body.meso.id} created=${!!m.created} `
        + `activated=${!!m.activated} rev=${m.revBefore}->${m.revAfter}`);
    }
    const created = r.code === 200 && r.body && r.body.meta && r.body.meta.created;
    return json(res, created ? 201 : r.code, r.body);
  }

  async function getMeso(req, res) {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in', code: 'UNAUTH' });
    const S = readState(user.id);
    if (!S || typeof S !== 'object') {
      return json(res, 404, { error: 'no state for this profile', code: 'NO_STATE' });
    }
    const m = stateMeta(S);
    json(res, 200, {
      mesos: S.mesos || [], activeMeso: S.activeMeso || null, mesoPrev: S.mesoPrev || null,
      rev: m.rev, _ts: m._ts
    });
  }

  async function activateMeso(req, res, params) {
    const mid = params[0];
    const o = await open(req, '/api/plan/meso/' + mid + '/activate');
    if (o.code) return json(res, o.code, o.body);
    const { user, actor } = o;
    const ifMatch = parseIfMatch(req.headers['if-match']);

    const r = withState(deps, user.id,
      { ifMatch, actor, action: 'activate-meso', uid: user.id, dropActive: false },
      S => {
        const list = Array.isArray(S.mesos) ? S.mesos : [];
        const meso = list.find(m => m.id === mid);
        if (!meso) {
          return { error: `mesocycle "${mid}" not found`, code: 'MESO_NOT_FOUND', code_http: 409,
                   mesos: list.map(m => m.id) };
        }
        if (S.activeMeso !== mid) {
          S.mesoPrev = S.activeMeso || null;
          S.activeMeso = mid;
          meso.activatedAt = new Date().toISOString();
          meso.activatedBy = actor.verified === 'signature' ? 'assistant' : 'user';
        }
        return { _meta: { mesoId: mid, activated: true } };
      });

    if (r.code === 200) {
      console.log(`[og-meso] op=activate-meso uid=${user.id} meso=${mid} `
        + `rev=${r.body.meta.revBefore}->${r.body.meta.revAfter}`);
    }
    return json(res, r.code, r.body);
  }

  return { putMeso, getMeso, activateMeso };
}
