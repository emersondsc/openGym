// api/micro.js — publicação da semana: N rotinas numa gravação só.
//
// Especificado em docs/specs/spec_publicacao_micro.md (v6); operação e nomenclatura em docs/MICRO.md.
// Par do lado agente: ~/.hermes/workout/scripts/opengym_writer.py (Api.publish_micro / `publish`).
//
// Sem política e sem autoria. Três regras definem este módulo (decisões do usuário 14/09/2026):
//   1) UPSERT POR ID: o id que já existe é atualizado no lugar (o ponteiro de dia continua valendo,
//      porque aponta para o id); id novo é criado. Substituir é a operação normal da semana — a
//      lista do app não cresce —, não uma exceção a autorizar.
//   2) DIA É DO USUÁRIO: `dias[]` é opcional e só vem quando ele autorizou a remarcação. Sem `dias`
//      o `dayPlan` não é tocado, e `week` NUNCA é escrito por esta rota.
//   3) A ASSINATURA DO AGENTE É OBRIGATÓRIA: `verified` tem de ser "signature" por fato, não pela
//      ausência de erro (o readActor devolve "claimed" quando não há header).
//
// Não escreve no socket: devolve {code, body} e quem responde é o server.js.
import fs from 'node:fs';
import path from 'node:path';
import {
  canon, sha256, parseIfMatch, checkIfMatch, withState, cleanupSg,
  validateExEntry, defaultExFields, stripCrossModeFields, loadCatalog, PROG_ALLOWED, CATALOG_PATH
} from './routines.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;        // igual ao PATTERNS do server.js
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MESO_RE = /^meso-\d{4}-\d{2}-\d{2}(-[a-z0-9]{1,8})?$/;   // mesmo formato do api/meso.js
const MAX_ROUTINES = 10, MAX_DIAS = 7, MAX_NAME = 60, MAX_EMOJI = 32;
const WINDOW_DAYS = 14;                        // A15: de hoje até hoje + 14
const TZ = 'America/Sao_Paulo';
const IDEM_FILE = 'micro-idem.json', IDEM_TTL_MS = 24 * 3600e3, IDEM_MAX = 200;

/** Data real do calendário, por round-trip — o `new Date('2026-02-30')` do V8 rola para 02/03 e
 *  passaria numa checagem de formato. Mesmo padrão do `api/meso.js` (achado M19). */
const realDate = iso => DATE_RE.test(String(iso || '')) && (() => {
  const d = new Date(iso + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
})();
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** `getDay()` do JS: domingo = 0. É a chave de `S.week` (que esta rota só lê). */
const weekdayOf = iso => String(new Date(iso + 'T12:00:00').getDay());
/** Hoje em São Paulo, sem depender do TZ do container. Exportado para o teste. */
export function todaySP() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const g = t => p.find(x => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export { addDays };

/** Todas as datas declaradas, achatadas: [{date, routineId}]. */
export function datesOf(body) {
  const out = [];
  for (const r of (body && body.routines) || []) for (const d of r.dias || []) out.push({ date: d, routineId: r.id });
  return out;
}

/* ---------------------------------------------------------------- idempotência (A3/RF-3) */

function readIdem(dir) {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, IDEM_FILE), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
/** Grava com modo 0600 direto (o `atomicWrite` injetado é (file, content), sem modo — M20). */
function writeIdem(dir, rec) {
  const now = Date.now();
  const keep = readIdem(dir).filter(x => x && now - (x.at || 0) < IDEM_TTL_MS && x.key !== rec.key);
  keep.push(rec);
  const f = path.join(dir, IDEM_FILE), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(keep.slice(-IDEM_MAX)), { mode: 0o600 });
  fs.renameSync(tmp, f);          // falha aqui é propagada: a resposta diz que a chave não ficou
}
/** null | {replay} | {mismatch:true} — TTL aplicada na LEITURA, dono da chave conferido. */
export function idemLookup(dir, key, bodyHash, uid) {
  const rec = readIdem(dir).find(x => x.key === key);
  if (!rec) return null;
  if (Date.now() - (rec.at || 0) > IDEM_TTL_MS) return null;
  if (rec.bodyHash !== bodyHash || rec.uid !== uid) return { mismatch: true };
  return { replay: rec };
}
/** As rotinas publicadas ainda existem E continuam iguais ao que esta publicação gravou?
 *  Compara **por rotina** (A3/M11): o stateHash inclui rev/_ts e mudaria a cada treino do app. */
export function stillIntact(S, ids, hashes) {
  const lista = ids || [];
  if (!S || typeof S !== 'object') return false;
  const atuais = (S.routines || []).filter(r => lista.includes(r.id));
  if (atuais.length !== lista.length) return false;
  if (!hashes) return true;
  return atuais.every(r => hashes[r.id] === sha256(canon(r)));
}

/* ---------------------------------------------------------------- validação (RF-5..RF-9) */

/**
 * Forma da publicação. `ex` é ARRAY aqui (substituição total) — o `validateRoutineBody` do
 * routines.js é o validador do PATCH (merge, `ex` chaveado por id) e recusaria este payload (B1).
 * O legado do estado vivo (`mode:"normal"`, `sg:0`) é aceito e normalizado (A5d).
 */
export function validatePublish(body, catalog, custom, hoje) {
  const bad = (code, field, message, allowed) => ({ error: message, code, field, ...(allowed ? { allowed } : {}) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('BAD_BODY', null, 'body must be an object');
  if (typeof body.meso_id !== 'string' || !MESO_RE.test(body.meso_id)) {
    return bad('BAD_MESO_ID', 'meso_id', 'meso_id must look like meso-YYYY-MM-DD[-suffix]');
  }
  if (!Number.isInteger(body.semana) || body.semana < 1 || body.semana > 52) {
    return bad('BAD_SEMANA', 'semana', 'semana must be an integer 1..52');
  }
  if (body.report_id !== undefined && (typeof body.report_id !== 'string' || body.report_id.length > 120)) {
    return bad('BAD_BODY', 'report_id', 'report_id must be a string of at most 120 chars');
  }
  if (!Array.isArray(body.routines) || body.routines.length < 1 || body.routines.length > MAX_ROUTINES) {
    return bad('BAD_ROUTINES', 'routines', `routines must be an array of 1..${MAX_ROUTINES}`);
  }
  const ids = new Set();
  for (let i = 0; i < body.routines.length; i++) {
    const r = body.routines[i], where = `routines[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return bad('BAD_ROUTINE', where, `${where} must be an object`);
    if (typeof r.id !== 'string' || !ID_RE.test(r.id)) {
      return bad('BAD_ROUTINE_ID', `${where}.id`, `${where}.id must match ${ID_RE}`);
    }
    if (ids.has(r.id)) return bad('DUPLICATE_ROUTINE_ID', `${where}.id`, `duplicate id "${r.id}"`);
    ids.add(r.id);
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.trim().length > MAX_NAME) {
      return bad('BAD_NAME', `${where}.name`, `name must be 1..${MAX_NAME} chars`);
    }
    if (typeof r.emoji !== 'string' || !r.emoji || r.emoji.length > MAX_EMOJI) {
      return bad('BAD_EMOJI', `${where}.emoji`, `emoji must be 1..${MAX_EMOJI} chars`);
    }
    if (r.prog !== undefined && !PROG_ALLOWED.includes(r.prog)) {
      return bad('BAD_PROG', `${where}.prog`, `prog must be one of ${PROG_ALLOWED.join('|')}`, PROG_ALLOWED);
    }
    if (!Array.isArray(r.ex) || r.ex.length < 1) return bad('BAD_EX', `${where}.ex`, 'ex must be a non-empty array');
    const exIds = new Set();
    for (let j = 0; j < r.ex.length; j++) {
      const raw = r.ex[j], exWhere = `${where}.ex.${raw && raw.id ? raw.id : j}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !raw.id) {
        return bad('EX_ID_REQUIRED', `${where}.ex[${j}].id`, 'ex.id required');
      }
      if (exIds.has(raw.id)) return bad('DUPLICATE_EX', exWhere, `duplicate exercise "${raw.id}"`);
      exIds.add(raw.id);
      // Defaults do app antes de validar, com o modo efetivo e o `eq` do catálogo (M17).
      const meta = catalog ? (catalog.get(raw.id) || {}) : {};
      const mode = raw.mode === 'normal' ? 'reps' : (raw.mode || (meta.eq === 'cardio' ? 'cardio' : 'reps'));
      const filled = stripCrossModeFields({ ...defaultExFields(raw.id, mode, meta.eq), ...raw, id: raw.id, mode }, mode);
      // `sg: 0` e `sg: ""` são o marcador de "sem superset" do estado antigo: some antes de validar,
      // senão `isNewEntry` os leria como legado INTRODUZIDO e recusaria (A5d).
      if (filled.sg === 0 || filled.sg === '') delete filled.sg;
      const v = validateExEntry(filled, { catalog, custom, where: exWhere, modeChanged: true, isNewEntry: true });
      if (v) return { ...v, error: v.message };
    }
    if (r.dias !== undefined) {
      if (!Array.isArray(r.dias) || r.dias.length > MAX_DIAS) {
        return bad('BAD_DATE', `${where}.dias`, `dias must be an array of at most ${MAX_DIAS}`);
      }
      for (const d of r.dias) {
        if (!realDate(d)) return bad('BAD_DATE', `${where}.dias`, `"${d}" must be a real calendar date YYYY-MM-DD`);
      }
    }
  }
  // Janela (A15): uma régua só, absoluta. Data repetida é recusa; o resto é conflito (RF-11).
  const datas = datesOf(body);
  const seen = new Set();
  for (const { date } of datas) {
    if (seen.has(date)) return bad('DUPLICATE_DATE', 'routines[].dias', `date "${date}" appears twice`);
    seen.add(date);
    if (date < hoje) return bad('DATE_IN_PAST', 'routines[].dias', `date "${date}" is in the past (today is ${hoje})`);
    if (date > addDays(hoje, WINDOW_DAYS)) {
      return bad('WINDOW_TOO_FAR', 'routines[].dias',
        `date "${date}" is more than ${WINDOW_DAYS} days ahead (max ${addDays(hoje, WINDOW_DAYS)})`);
    }
  }
  const az = body.autorizar;
  if (az !== undefined) {
    if (!az || typeof az !== 'object' || Array.isArray(az)) {
      return bad('BAD_AUTORIZAR', 'autorizar', 'autorizar must be an object');
    }
    for (const d of az.datas || []) {
      if (!realDate(d)) return bad('BAD_AUTORIZAR', 'autorizar.datas', `"${d}" must be a real calendar date YYYY-MM-DD`);
      if (!seen.has(d)) {
        return bad('BAD_AUTORIZAR', 'autorizar.datas', `"${d}" is not one of this payload's declared dates`);
      }
    }
  }
  return null;
}

/**
 * Materializa a rotina publicada: substituição total, com os defaults do app, o legado normalizado
 * (A5d) e o `prog` preservado quando o payload não declara (A5b). Campos desconhecidos no nível da
 * rotina que já existia são preservados — nada do usuário é jogado fora por não estar no schema.
 */
export function materializeRoutine(r, catalog, prev) {
  const prevEx = new Map((((prev || {}).ex) || []).map(e => [e.id, e]));
  const ex = r.ex.map(raw => {
    const meta = catalog ? (catalog.get(raw.id) || {}) : {};
    const before = prevEx.get(raw.id) || {};
    const declared = raw.mode;
    const mode = declared === 'normal' ? 'reps'
      : declared || (before.mode === 'normal' ? 'reps' : null) || before.mode
        || (meta.eq === 'cardio' ? 'cardio' : 'reps');
    const merged = stripCrossModeFields({ ...defaultExFields(raw.id, mode, meta.eq), ...raw, id: raw.id, mode }, mode);
    if (merged.sg === 0) delete merged.sg;                     // marcador de legado, sem significado
    return merged;
  });
  cleanupSg(ex);
  const out = { ...(prev || {}), id: r.id, name: String(r.name).trim(), emoji: String(r.emoji), ex };
  if (r.prog !== undefined) out.prog = r.prog;
  else if (prev && prev.prog !== undefined) out.prog = prev.prog;
  else out.prog = 'off';
  return out;
}

/**
 * Conflito de data (RF-11). A resolução é a do app: `dayPlan[data] ?? week[weekday(data)]` — olhar
 * só o `dayPlan` deixaria a faixa da semana ser sobrescrita sem autorização (M14).
 */
export function findConflicts(S, body) {
  const auth = new Set(((body.autorizar || {}).datas) || []);
  const dayPlan = S.dayPlan || {}, week = S.week || {};
  const trained = new Set((S.workouts || []).map(w => w.d).filter(Boolean));
  const datas = [];
  for (const { date, routineId } of datesOf(body)) {
    const doDay = dayPlan[date] !== undefined;
    const cur = doDay ? dayPlan[date] : week[weekdayOf(date)];
    const occupied = (cur !== undefined && cur !== routineId) || trained.has(date);
    if (occupied && !auth.has(date)) {
      datas.push({
        date, current: cur === undefined ? null : cur,
        kind: cur === undefined ? 'free' : (cur === 'rest' ? 'rest' : 'routine'),
        from: doDay ? 'dayPlan' : 'week', trained: trained.has(date), wanted: routineId
      });
    }
  }
  return { datas };
}

/* ---------------------------------------------------------------- handler */

export function makeHandlers(deps) {
  const { readSession, readState, json, readActor, readRawBody, DATA, livePresence } = deps;
  const catalogPath = deps.CATALOG_PATH || CATALOG_PATH;

  async function publishMicro(req, res) {
    const raw = await readRawBody(req).catch(() => null);
    if (raw === null) return json(res, 400, { error: 'body too large or unreadable' });

    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in', code: 'UNAUTH' });

    // RF-2/A4: a assinatura tem de ser provada. Sem header o readActor devolve "claimed" sem err.
    const actor = readActor(req, user.id, raw, req.method, '/api/plan/micro');
    if (actor.err) return json(res, 400, { error: 'actor signature invalid', code: actor.err });
    if (actor.verified !== 'signature') {
      return json(res, 401, { error: 'agent signature required', code: 'ACTOR_SIGNATURE_REQUIRED' });
    }

    let body;
    try { body = raw.length ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad json', code: 'BAD_JSON' }); }

    // RF-3: chave de idempotência obrigatória, e a conferência vem ANTES do If-Match (A11) — um
    // retry depois de resposta perdida traz o rev velho e tem de receber replay, não 409.
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (!key) return json(res, 400, { error: 'Idempotency-Key required', code: 'IDEMPOTENCY_REQUIRED' });
    if (key.length > 128) return json(res, 400, { error: 'Idempotency-Key too long', code: 'IDEMPOTENCY_KEY_TOO_LONG' });
    // O hash é do corpo RECEBIDO, byte a byte: o cliente manda exatamente os bytes canônicos que
    // hasheou, então os dois lados chegam ao mesmo número sem depender de canonicalização.
    const bodyHash = sha256(raw);
    const hit = idemLookup(DATA, key, bodyHash, user.id);
    if (hit && hit.mismatch) {
      return json(res, 409, { error: 'Idempotency-Key reused with another body or profile', code: 'IDEMPOTENCY_MISMATCH' });
    }
    if (hit && hit.replay) {
      const S = readState(user.id) || {};
      const meta = { ...hit.replay.meta, rev: hit.replay.rev };
      return json(res, 200, {
        ok: true, replayed: true, rev: hit.replay.rev, currentRev: (S.rev ?? null),
        intact: stillIntact(S, hit.replay.routines, hit.replay.routineHashes), meta
      });
    }

    // RF-4/A18: o wildcard é conferido AQUI — o checkIfMatch do routines.js aceita `*`.
    const ifMatch = parseIfMatch(req.headers['if-match']);
    if (ifMatch === '*') {
      return json(res, 412, { error: 'If-Match: * is not allowed here', code: 'IF_MATCH_WILDCARD' });
    }
    const S0 = readState(user.id);
    if (!S0 || typeof S0 !== 'object') {
      return json(res, 409, { error: 'no state for this profile', code: 'NO_STATE' });
    }
    const pre = checkIfMatch(S0, ifMatch);
    if (pre) return json(res, pre.code, pre.body);

    const catalog = loadCatalog(catalogPath);
    if (!catalog) return json(res, 503, { error: 'exercise catalog unavailable', code: 'CATALOG_UNAVAILABLE' });
    const custom = new Set((S0.customEx || []).map(c => c.id));
    const hoje = todaySP();

    const bad = validatePublish(body, catalog, custom, hoje);
    if (bad) return json(res, 400, bad);

    const { datas } = findConflicts(S0, body);
    if (datas.length) {
      return json(res, 409, {
        error: 'the declared dates collide with what is already there', code: 'PLAN_CONFLICT', datas,
        hint: 'decide with the user, then retry with autorizar.datas'
      });
    }

    // RF-17/A17: com treino vivo no perfil a publicação espera (o apply do escritor faz o mesmo).
    if (typeof livePresence === 'function' && livePresence(user.id)) {
      return json(res, 409, { error: 'a workout is in progress on a device', code: 'WORKOUT_IN_PROGRESS' });
    }

    const trained = new Set((S0.workouts || []).map(w => w.d).filter(Boolean));
    const r = withState(deps, user.id,
      { ifMatch, actor, action: 'publish-micro', uid: user.id, dropActive: false },
      S => {
        const list = Array.isArray(S.routines) ? S.routines : (S.routines = []);
        const criadas = [], trocadas = [], progAntes = {}, progDepois = {};
        for (const pub of body.routines) {
          const i = list.findIndex(x => x.id === pub.id);
          const mat = materializeRoutine(pub, catalog, i >= 0 ? list[i] : null);
          if (i < 0) { list.push(mat); criadas.push(pub.id); } else {
            progAntes[pub.id] = list[i].prog ?? null;
            list[i] = mat;
            trocadas.push(pub.id);
            progDepois[pub.id] = mat.prog ?? null;
          }
        }
        // RF-10: só `dayPlan`, e só para as datas declaradas; `week` nunca é tocado.
        const dayPlan = S.dayPlan || (S.dayPlan = {});
        const declaradas = datesOf(body);
        for (const { date, routineId } of declaradas) dayPlan[date] = routineId;
        const applied = Object.fromEntries(declaradas.map(d => [d.date, dayPlan[d.date]]));
        return {
          _meta: {
            meso_id: body.meso_id, semana: body.semana, report_id: body.report_id ?? null,
            ifMatch: String(ifMatch), idemKey: key,
            routines: body.routines.map(x => x.id), criadas, trocadas, progAntes, progDepois,
            datas: declaradas.map(d => d.date), dayPlan: applied,
            trained: declaradas.filter(d => trained.has(d.date)).map(d => d.date)
          }
        };
      });

    if (r.code !== 200) return json(res, r.code, r.body);

    // A chave só é registrada depois da escrita (a janela está em Riscos). O hash por rotina é
    // lido do estado recém-gravado, que é o que o replay vai comparar.
    const ids = body.routines.map(x => x.id);
    const S1 = readState(user.id) || {};
    const routineHashes = Object.fromEntries(ids.map(id =>
      [id, sha256(canon((S1.routines || []).find(x => x.id === id) || null))]));
    try {
      writeIdem(DATA, { key, bodyHash, uid: user.id, rev: r.body.rev, at: Date.now(), routines: ids, routineHashes, meta: r.body.meta });
    } catch (e) {
      console.error('[og-micro] idem write failed', e.message);
      r.body.meta.idemStored = false;           // a resposta diz que a chave não ficou
    }

    const m = r.body.meta;
    console.log(`[og-micro] op=publish-micro uid=${user.id} meso=${body.meso_id} semana=${body.semana} `
      + `criadas=${m.criadas.length} trocadas=${m.trocadas.length} datas=${m.datas.length} `
      + `rev=${m.revBefore}->${m.revAfter}`);
    const created = m.criadas.length === body.routines.length;
    return json(res, created ? 201 : 200, r.body);
  }

  return { publishMicro };
}
