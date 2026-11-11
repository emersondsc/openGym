// api/proposals.js — propostas do treinador. Especificado em docs/specs/spec_propostas_treinador.md.
//
// O MCP só cria arquivos em `pending/`; nunca tem credencial do app. Toda escrita nasce aqui, depois
// de sessão do dono e prova de passkey presa ao conteúdo que ele viu. Este arquivo é copiado para
// `/opt/opengym-mcp/app-api/`: `projetar` e `avisos` valem nos dois lados, e a verificação de saúde
// do MCP avisa quando as cópias divergem.
import fs from 'node:fs';
import path from 'node:path';
import { applyHistoryFix, validarOps } from './history-fix.js';
import { MAX_MESO_BYTES, applyActivateMeso, applyDeleteMeso, applyPutMeso, mesoBytes, validateMesoBody } from './meso.js';
import { applyPublish, findConflicts, todaySP, validatePublish } from './micro.js';
import { applyRoutineDelete, applyRoutinePatch, canon, loadCatalog, mergeRoutine, readAudit, sha256,
         stateMeta, validateRoutineBody, withState } from './routines.js';

export const KINDS = ['week', 'routine_patch', 'routine_delete', 'mesocycle', 'mesocycle_action', 'history_fix'];
export const ID_RE = /^prop-[a-z0-9-]{1,40}$/;
export const LIMITES = { abertas: 20, bytes: 128 * 1024, title: 200, summary: 2000, reasons: 30, reason: 500, motivo: 500 };
export const SALTO_MAX = 0.15;
const RESTRICOES = ['hernia', 'joelho'];
const SNAPSHOTS_MAX = 10;
export const AUTO_MAX_24H = 10;
/** Tipos que podem entrar sem passkey. O resto sempre pede a passkey do dono no app. */
export const AUTO_KINDS = ['week', 'mesocycle'];
const SNAPSHOTS_DIAS = 30;

const CAMPOS_ROTINA = ['id', 'name', 'emoji', 'prog'];
const CAMPOS_EX = ['id', 'sets', 'reps', 'weight', 'mode', 'restSec', 'unit', 'sec', 'min', 'speed',
  'inc', 'repsMin', 'repsMax', 'side', 'sg', 'prog', 'targetRir'];
const CAMPOS_MESO = ['id', 'name', 'start', 'end', 'goal', 'origin', 'priorities', 'rules', 'weeks',
  'evidence', 'log', 'cargas_prescritas', 'estrutura_atual', 'status_semanas', 'fonte', 'criado_em',
  'atualizado_em'];
const MESO_SISTEMA = ['updatedAt', 'activatedAt', 'activatedBy'];
const CAMPOS_SET = ['done', 'w', 'wUnit', 'r', 'rir', 'rpe', 'min', 'speed', 'sec'];

const so = (o, c) => Object.fromEntries(c.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]));
const clone = o => JSON.parse(JSON.stringify(o));
const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** O que a proposta altera, só com campos que existem também na cópia filtrada do MCP. */
export function projetar(S, kind, plan) {
  const rotina = id => {
    const r = (S.routines || []).find(x => x.id === id);
    return r ? { ...so(r, CAMPOS_ROTINA), ex: (r.ex || []).map(e => so(e, CAMPOS_EX)) } : null;
  };
  const meso = id => {
    const m = (S.mesos || []).find(x => x.id === id);
    return m ? so(m, CAMPOS_MESO) : null;
  };
  if (kind === 'week') {
    const dias = (plan.routines || []).flatMap(r => r.dias || []);
    return { routines: (plan.routines || []).map(r => rotina(r.id)),
      days: dias.map(d => [d, S.dayPlan?.[d] ?? null]) };
  }
  if (kind === 'routine_patch' || kind === 'routine_delete') return { routine: rotina(plan.routine_id) };
  if (kind === 'mesocycle') return { meso: meso(plan.meso?.id), active: S.activeMeso ?? null };
  if (kind === 'mesocycle_action') return { meso: meso(plan.meso_id), active: S.activeMeso ?? null };
  if (kind === 'history_fix') {
    return { sets: (plan.ops || []).map(o => {
      const w = (S.workouts || []).find(x => x.id === o.workout_id);
      const e = (w?.entries || []).filter(x => x.id === o.exercise_id)[o.entry_index ?? 0];
      const s = e?.sets?.[o.set_index];
      return s ? so(s, CAMPOS_SET) : null;
    }) };
  }
  throw new Error(`bad kind: ${kind}`);
}
export const hashBase = (S, kind, plan) => sha256(canon(projetar(S, kind, plan)));

/** Campos que o Claude não vê seguem iguais: só copia chave ausente no plano e fora do que ele vê. */
export function preservarOcultos(S, kind, plan) {
  const out = clone(plan);
  if (kind === 'week') {
    for (const r of out.routines || []) {
      const prev = (S.routines || []).find(x => x.id === r.id);
      for (const e of r.ex || []) {
        const p = (prev?.ex || []).find(x => x.id === e.id);
        for (const k of Object.keys(p || {})) if (!CAMPOS_EX.includes(k) && e[k] === undefined) e[k] = p[k];
      }
    }
  }
  if (kind === 'mesocycle' && out.meso) {
    const prev = (S.mesos || []).find(m => m.id === out.meso.id);
    for (const k of Object.keys(prev || {})) {
      if (![...CAMPOS_MESO, ...MESO_SISTEMA].includes(k) && out.meso[k] === undefined) out.meso[k] = prev[k];
    }
  }
  return out;
}

/** Avisos de treino, recalculados sobre o estado atual. A tela confia nestes, não no arquivo. */
export function avisos(S, kind, plan) {
  const lista = [];
  const salto = (rid, ex) => {
    const atual = (S.routines || []).find(r => r.id === rid)?.ex?.find(e => e.id === ex.id);
    if (!(atual?.weight > 0 && ex.weight > 0) || (ex.unit ?? atual.unit) !== atual.unit) return;
    const s = ex.weight / atual.weight - 1;
    if (Math.abs(s) > SALTO_MAX) {
      lista.push({ code: 'WEIGHT_JUMP', field: `${rid}.${ex.id}`, pct: Math.round(s * 100), from: atual.weight, to: ex.weight });
    }
  };
  if (kind === 'week') for (const r of plan.routines || []) for (const ex of r.ex || []) salto(r.id, ex);
  if (kind === 'routine_patch') {
    for (const [id, ex] of Object.entries(plan.patch?.ex || {})) salto(plan.routine_id, { ...ex, id });
  }
  if (kind === 'mesocycle' && plan.meso) {
    if ((S.mesos || []).some(m => m.id === plan.meso.id)) lista.push({ code: 'MESO_OVERWRITE', field: 'id' });
    const ativo = (S.mesos || []).find(m => m.id === S.activeMeso);
    const novas = Object.keys(plan.meso.rules ?? {}).map(semAcento);
    for (const r of RESTRICOES) {
      const tinha = Object.keys(ativo?.rules ?? {}).some(k => semAcento(k).includes(r));
      if (tinha && !novas.some(k => k.includes(r))) lista.push({ code: 'RESTRICTION_DROPPED', field: r });
    }
  }
  return lista;
}

/** Forma do plano por tipo. Devolve null ou {code, error, field}. */
export function validarPlano(S, kind, plan, catalog) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { code: 'BAD_PLAN', error: 'plan must be an object' };
  if (Object.hasOwn(plan, 'autorizar')) return { code: 'BAD_PLAN', error: 'autorizar is decided on approval', field: 'autorizar' };
  const custom = new Set((S.customEx || []).map(c => c.id));
  const existe = id => (S.routines || []).some(r => r.id === id);
  const temMeso = id => (S.mesos || []).some(m => m.id === id);
  if (kind === 'week') return validatePublish(plan, catalog, custom, todaySP(), S.routines || []);
  if (kind === 'routine_patch') {
    if (!existe(plan.routine_id)) return { code: 'ROUTINE_NOT_FOUND', error: 'routine not found', field: 'routine_id' };
    const ruim = validateRoutineBody(plan.patch);
    if (ruim) return ruim;
    const cur = clone((S.routines || []).find(r => r.id === plan.routine_id));
    return mergeRoutine(cur, plan.patch, catalog, custom);
  }
  if (kind === 'routine_delete') {
    return existe(plan.routine_id) ? null : { code: 'ROUTINE_NOT_FOUND', error: 'routine not found', field: 'routine_id' };
  }
  if (kind === 'mesocycle') {
    const ruim = validateMesoBody(plan.meso);
    if (ruim) return ruim;
    if (mesoBytes(plan.meso) > MAX_MESO_BYTES) return { code: 'MESO_TOO_BIG', error: 'meso too large', field: 'meso' };
    if (!['now', 'none'].includes(plan.activate)) return { code: 'BAD_ACTIVATE', error: 'activate must be now or none', field: 'activate' };
    return null;
  }
  if (kind === 'mesocycle_action') {
    if (!['activate', 'delete'].includes(plan.action)) return { code: 'BAD_ACTION', error: 'action must be activate or delete', field: 'action' };
    return temMeso(plan.meso_id) ? null : { code: 'MESO_NOT_FOUND', error: 'mesocycle not found', field: 'meso_id' };
  }
  if (kind === 'history_fix') return validarOps(S, plan.ops);
  return { code: 'BAD_KIND', error: 'unknown kind', field: 'kind' };
}

/**
 * Gravação direta (spec_gravacao_direta_treinador.md): só criar entra sem passkey. Pura e sem disco,
 * para o MCP prever o mesmo resultado. `autoHoje` = gravações diretas nas últimas 24 h.
 * Devolve {modo: 'auto'} ou {modo: 'passkey', motivo}.
 */
export function modoDe(S, p, { ligado = true, autoHoje = 0 } = {}) {
  const passkey = motivo => ({ modo: 'passkey', motivo });
  if (!ligado) return passkey('AUTO_OFF');
  if (!AUTO_KINDS.includes(p.kind)) return passkey('KIND_NEEDS_PASSKEY');
  const av = avisos(S, p.kind, p.plan);
  if (p.kind === 'week') {
    if (findConflicts(S, p.plan).datas.length) return passkey('REPLACES_DAYS');
    if (av.some(w => w.code === 'WEIGHT_JUMP' && w.pct > 0)) return passkey('WEIGHT_JUMP');
  }
  if (p.kind === 'mesocycle') {
    if (av.some(w => w.code === 'MESO_OVERWRITE')) return passkey('MESO_OVERWRITE');
    if (av.some(w => w.code === 'RESTRICTION_DROPPED')) return passkey('RESTRICTION_DROPPED');
  }
  if (autoHoje >= AUTO_MAX_24H) return passkey('AUTO_LIMIT');
  return { modo: 'auto' };
}

/**
 * A chave da gravação direta fica visível ao MCP em `decisions/auto-apply.json`, que ele só lê: assim
 * ele não promete "entra sozinha" quando a API está com a chave desligada.
 */
export const ARQ_POLITICA = 'auto-apply.json';
export function gravarPolitica(dir, ligado) {
  const f = path.join(dir, 'decisions', ARQ_POLITICA);
  if (!ligado) { fs.rmSync(f, { force: true }); return; }
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ on: true, max_24h: AUTO_MAX_24H, kinds: AUTO_KINDS }), { mode: 0o644 });
  fs.renameSync(tmp, f);
}
export function lerPolitica(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'decisions', ARQ_POLITICA), 'utf8')).on === true; } catch { return false; }
}

/** Quantas propostas foram gravadas direto nas últimas 24 h, pelas decisões em disco. */
export function contarAuto(dir, agora = Date.now()) {
  let nomes = [];
  try { nomes = fs.readdirSync(path.join(dir, 'decisions')); } catch { return 0; }
  let n = 0;
  for (const nome of nomes) {
    if (!/^prop-[a-z0-9-]{1,40}\.json$/.test(nome)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, 'decisions', nome), 'utf8'));
      if (d.mode === 'auto' && agora - Date.parse(d.at) < 86400000) n++;
    } catch { /* ilegivel nao conta */ }
  }
  return n;
}

const acaoDe = (kind, plan) => ({
  week: 'publish-micro', routine_patch: 'patch-routine', routine_delete: 'delete-routine', mesocycle: 'put-meso',
  mesocycle_action: plan.action === 'delete' ? 'delete-meso' : 'activate-meso', history_fix: 'history-fix'
})[kind];

/** Aplica sobre `S`. `plan` já com ocultos preservados e dias autorizados. */
function aplicar(S, kind, plan, catalog, agora) {
  if (kind === 'week') {
    const trained = new Set((S.workouts || []).map(w => w.d).filter(Boolean));
    const r = applyPublish(S, plan, catalog);
    return { _meta: { meso_id: plan.meso_id, semana: plan.semana, report_id: plan.report_id ?? null,
      routines: plan.routines.map(x => x.id), criadas: r.criadas, trocadas: r.trocadas, progAntes: r.progAntes,
      progDepois: r.progDepois, datas: r.declaradas.map(d => d.date), dayPlan: r.applied,
      trained: r.declaradas.filter(d => trained.has(d.date)).map(d => d.date) } };
  }
  if (kind === 'routine_patch') return applyRoutinePatch(S, plan.routine_id, plan.patch, catalog);
  if (kind === 'routine_delete') return applyRoutineDelete(S, plan.routine_id, false);
  if (kind === 'mesocycle') return applyPutMeso(S, plan.meso, plan.activate, 'assistant', agora);
  if (kind === 'mesocycle_action') {
    return plan.action === 'delete' ? applyDeleteMeso(S, plan.meso_id) : applyActivateMeso(S, plan.meso_id, 'assistant', agora);
  }
  if (kind === 'history_fix') return applyHistoryFix(S, plan.ops);
  throw new Error(`bad kind: ${kind}`);
}

/** Uma entrada por folha do JSON que difere. */
export function diffFolhas(antes, depois, prefixo = '') {
  const folha = v => v === null || typeof v !== 'object';
  if (folha(antes) || folha(depois)) {
    if (antes === depois) return [];
    if (!folha(depois) && (antes === null || antes === undefined)) {
      return Object.keys(depois).sort().flatMap(k => diffFolhas(undefined, depois[k], juntar(prefixo, k)));
    }
    if (!folha(antes) && (depois === null || depois === undefined)) {
      return Object.keys(antes).sort().flatMap(k => diffFolhas(antes[k], undefined, juntar(prefixo, k)));
    }
    return [{ path: prefixo, before: antes ?? null, after: depois ?? null }];
  }
  const chaves = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].sort();
  return chaves.flatMap(k => diffFolhas(antes[k], depois[k], juntar(prefixo, k)));
}
const juntar = (p, k) => (p ? `${p}.${k}` : String(k));
const semVolatil = S => { const { rev, _ts, active, ...resto } = S; return resto; };

/** Efeito real, num clone e com o horário da proposta: o resultado não depende de quando é lido. */
export function simular(S, p, catalog) {
  const preservado = preservarOcultos(S, p.kind, p.plan);
  const ruim = validarPlano(S, p.kind, preservado, catalog);
  if (ruim) return { error: { code: ruim.code, message: ruim.error ?? ruim.message, field: ruim.field ?? null } };
  const conflitos = p.kind === 'week' ? findConflicts(S, preservado).datas : [];
  const plano = p.kind === 'week' ? { ...preservado, autorizar: { datas: conflitos.map(c => c.date) } } : preservado;
  const trabalho = clone(S);
  const r = aplicar(trabalho, p.kind, plano, catalog, p.created_at);
  if (r?.error) return { error: { code: r.code, message: r.error, field: r.field ?? null } };
  if (p.kind === 'mesocycle' && mesoBytes((trabalho.mesos || []).find(m => m.id === plano.meso.id)) > MAX_MESO_BYTES) {
    return { error: { code: 'MESO_TOO_BIG', message: 'meso too large', field: 'meso' } };
  }
  return { plano, changes: diffFolhas(semVolatil(S), semVolatil(trabalho)), dates_replaced: conflitos };
}

export const approvalHash = (p, base, changes, dates_replaced) => sha256(canon({
  id: p.id, kind: p.kind, plan: p.plan, title: p.title, summary: p.summary, reasons: p.reasons, base, changes, dates_replaced
}));

/** Lê um arquivo de `pending/` sem confiar nele. Devolve a proposta ou null. */
export function lerProposta(dir, id) {
  if (!ID_RE.test(id)) return null;
  const f = path.join(dir, 'pending', `${id}.json`);
  try {
    const st = fs.lstatSync(f);
    if (!st.isFile() || st.size > LIMITES.bytes) throw new Error('arquivo invalido');
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    const ok = p && p.id === id && KINDS.includes(p.kind) && p.plan && typeof p.plan === 'object'
      && typeof p.title === 'string' && p.title.length <= LIMITES.title
      && typeof p.summary === 'string' && p.summary.length <= LIMITES.summary
      && Array.isArray(p.reasons) && p.reasons.length <= LIMITES.reasons
      && p.reasons.every(r => typeof r === 'string' && r.length <= LIMITES.reason)
      && typeof p.base_hash === 'string' && typeof p.created_at === 'string' && typeof p.expires_at === 'string'
      && !Number.isNaN(Date.parse(p.created_at)) && !Number.isNaN(Date.parse(p.expires_at));
    if (!ok) throw new Error('forma invalida');
    return p;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[og-proposal] ignorada', id, e.message);
    return null;
  }
}

function lerDecisao(dir, id) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'decisions', `${id}.json`), 'utf8')); }
  catch { return null; }
}

/** Publicação atômica: só a primeira decisão ganha. Devolve false se já existia. */
function gravarDecisao(dir, id, dados) {
  const final = path.join(dir, 'decisions', `${id}.json`);
  const tmp = `${final}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados), { mode: 0o644 });
  try { fs.linkSync(tmp, final); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  finally { fs.rmSync(tmp, { force: true }); }
}

function gravarSnapshot(dir, id, S) {
  const pasta = path.join(dir, 'snapshots');
  fs.writeFileSync(path.join(pasta, `${id}.json`), JSON.stringify(S), { mode: 0o600 });
  const agora = Date.now();
  const todos = fs.readdirSync(pasta).map(n => ({ f: path.join(pasta, n), t: fs.statSync(path.join(pasta, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  todos.forEach((s, i) => {
    if (i >= SNAPSHOTS_MAX || agora - s.t > SNAPSHOTS_DIAS * 86400000) fs.rmSync(s.f, { force: true });
  });
}

export function makeHandlers(deps) {
  const { readSession, readState, readBody, json, DATA, livePresence, ownerUid, proposalChallenge, proveProposal, saveDb } = deps;
  const autoApply = !!deps.autoApply;
  const dir = deps.dir || process.env.PROPOSALS_DIR || '/coach-proposals';
  const catalogo = () => deps.catalog || loadCatalog(deps.CATALOG_PATH);

  /** Sessão do dono, ou responde o erro. Sem dono configurado, as rotas não existem. */
  function dono(req, res) {
    if (!ownerUid) { json(res, 404, { error: 'not found' }); return null; }
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in', code: 'UNAUTH' }); return null; }
    if (user.id !== ownerUid) { json(res, 403, { error: 'forbidden' }); return null; }
    return user;
  }

  /** Estado, seguindo a precedência da spec. A auditoria só é lida quando a base não confere. */
  function avaliar(S, p, audit) {
    const d = lerDecisao(dir, p.id);
    if (d) return { status: d.status, decision: d };
    if (fs.existsSync(path.join(dir, 'pending', `${p.id}.canceled`))) return { status: 'canceled' };
    if (Date.now() > Date.parse(p.expires_at)) return { status: 'expired' };
    const base = hashBase(S, p.kind, p.plan);
    if (base !== p.base_hash) {
      const rec = audit().find(r => r.proposalId === p.id);
      if (rec) {
        const dados = { status: 'applied', rev: rec.rev, at: rec.at, result_hash: null, recovered: true };
        try { gravarDecisao(dir, p.id, dados); } catch (e) { console.error('[og-proposal] decisao', e.message); }
        return { status: 'applied', decision: dados };
      }
      return { status: 'stale', base };
    }
    const sim = simular(S, p, catalogo());
    if (sim.error) return { status: 'blocked', blocked_reason: sim.error.code, blocked_message: sim.error.message, base };
    if (!sim.changes.length) return { status: 'blocked', blocked_reason: 'NO_CHANGES', blocked_message: 'nothing would change', base, sim };
    if (livePresence?.(ownerUid)) return { status: 'blocked', blocked_reason: 'WORKOUT_IN_PROGRESS', blocked_message: 'a workout is in progress', base, sim };
    return { status: 'pending', base, sim };
  }

  const leitorAuditoria = () => {
    let cache = null;
    return () => (cache ??= readAudit(DATA, ownerUid, 500).entries);
  };
  const resumo = (p, a) => ({ id: p.id, kind: p.kind, title: p.title, created_at: p.created_at, expires_at: p.expires_at,
    status: a.status, blocked_reason: a.blocked_reason ?? null, mode: a.decision?.mode ?? null, decided_at: a.decision?.at ?? null });

  /**
   * A escrita de uma proposta já avaliada como `pending`, igual para passkey e gravação direta.
   * Síncrona do começo ao fim: nada intercala com outra decisão nem com um PUT do app.
   */
  function aplicarProposta(p, S, a, modo) {
    gravarSnapshot(dir, p.id, S);
    const agora = new Date().toISOString();
    const catalog = catalogo();
    const r = withState(deps, ownerUid, {
      ifMatch: String(stateMeta(S).rev), actor: { actor: 'claude', verified: modo }, action: acaoDe(p.kind, p.plan),
      uid: ownerUid, dropActive: p.kind === 'routine_delete'
    }, work => {
      const out = aplicar(work, p.kind, a.sim.plano, catalog, agora);
      return out?.error ? out : { _meta: { ...(out?._meta || {}), proposalId: p.id } };
    });
    if (r.code !== 200) return r;
    const S1 = readState(ownerUid) || {};
    const decisao = { status: 'applied', mode: modo, rev: r.body.rev, at: agora, result_hash: hashBase(S1, p.kind, p.plan) };
    try {
      if (!gravarDecisao(dir, p.id, decisao)) console.error('[og-proposal] decisao ja existia', p.id);
    } catch (e) { console.error('[og-proposal] decisao', p.id, e.message); }   // a auditoria recupera
    console.log(`[og-proposal] op=${modo === 'auto' ? 'auto-apply' : 'approve'} id=${p.id} kind=${p.kind} rev=${r.body.meta.revBefore}->${r.body.meta.revAfter}`);
    return r;
  }

  /**
   * Gravação direta: aplica o que `modoDe` libera. Chamada pelo relógio e pelo `fs.watch` do
   * server.js e pelo teste. Devolve os ids aplicados.
   */
  const descartadas = new Map();   // id -> rev em que a proposta já foi vista como "passkey"
  function varrerAutomaticas() {
    if (!ownerUid || !autoApply) return [];
    let nomes = [];
    try { nomes = fs.readdirSync(path.join(dir, 'pending')); } catch { return []; }
    const props = nomes.map(n => /^(prop-[a-z0-9-]{1,40})\.json$/.exec(n)?.[1]).filter(Boolean)
      .filter(id => !lerDecisao(dir, id)).map(id => lerProposta(dir, id))
      .filter(p => p && AUTO_KINDS.includes(p.kind)).sort((x, y) => x.created_at.localeCompare(y.created_at));
    const feitas = [];
    for (const p of props) {
      const S = readState(ownerUid);
      if (!S) return feitas;
      if (descartadas.get(p.id) === S.rev) continue;
      try {
        const a = avaliar(S, p, leitorAuditoria());
        if (a.status !== 'pending') {
          if (a.blocked_reason !== 'WORKOUT_IN_PROGRESS') descartadas.set(p.id, S.rev);
          continue;
        }
        const m = modoDe(S, p, { autoHoje: contarAuto(dir) });
        if (m.modo !== 'auto') {
          if (m.motivo !== 'AUTO_LIMIT') descartadas.set(p.id, S.rev);
          continue;
        }
        const r = aplicarProposta(p, S, a, 'auto');
        if (r.code === 200) feitas.push(p.id);
        else console.error('[og-proposal] auto-apply recusado', p.id, r.code, r.body?.code);
      } catch (e) { console.error('[og-proposal] auto-apply', p.id, e.message); }
    }
    return feitas;
  }

  async function listProposals(req, res) {
    if (!dono(req, res)) return;
    const S = readState(ownerUid) || {};
    const todas = new URL(req.url, 'http://x').searchParams.get('all') === '1';
    let nomes = [];
    try { nomes = fs.readdirSync(path.join(dir, 'pending')); } catch { /* sem pasta: sem propostas */ }
    const audit = leitorAuditoria();
    const itens = [];
    for (const n of nomes) {
      const m = /^(prop-[a-z0-9-]{1,40})\.json$/.exec(n);
      const p = m && lerProposta(dir, m[1]);
      if (!p) continue;
      try {
        const a = avaliar(S, p, audit);
        if (todas || ['pending', 'stale', 'blocked'].includes(a.status)) itens.push(resumo(p, a));
      } catch (e) { console.error('[og-proposal] avaliar', p.id, e.message); }
    }
    itens.sort((a, b) => b.created_at.localeCompare(a.created_at));
    json(res, 200, { proposals: itens });
  }

  async function getProposal(req, res, params) {
    if (!dono(req, res)) return;
    const p = lerProposta(dir, params[0]);
    if (!p) return json(res, 404, { error: 'proposal not found', code: 'PROPOSAL_NOT_FOUND' });
    const S = readState(ownerUid) || {};
    const a = avaliar(S, p, leitorAuditoria());
    const { plan, ...meta } = p;
    const sim = a.sim;
    json(res, 200, { ...meta, status: a.status, blocked_reason: a.blocked_reason ?? null, blocked_message: a.blocked_message ?? null,
      decision: a.decision ?? null, changes: sim?.changes ?? [], dates_replaced: sim?.dates_replaced ?? [],
      warnings: avisos(S, p.kind, p.plan), mode: a.decision?.mode ?? null,
      approval_hash: sim ? approvalHash(p, a.base, sim.changes, sim.dates_replaced) : null });
  }

  async function challengeProposal(req, res, params) {
    const user = dono(req, res);
    if (!user) return;
    const body = await readBody(req);
    const p = lerProposta(dir, params[0]);
    if (!p) return json(res, 404, { error: 'proposal not found', code: 'PROPOSAL_NOT_FOUND' });
    const a = avaliar(readState(ownerUid) || {}, p, leitorAuditoria());
    if (a.status !== 'pending') return json(res, 409, { error: 'proposal cannot be approved', code: a.blocked_reason || 'PROPOSAL_NOT_PENDING', status: a.status });
    if (approvalHash(p, a.base, a.sim.changes, a.sim.dates_replaced) !== body.approval_hash) {
      return json(res, 409, { error: 'proposal changed', code: 'PROPOSAL_CHANGED' });
    }
    json(res, 200, await proposalChallenge(user, p.id, body.approval_hash));
  }

  async function approveProposal(req, res, params) {
    const user = dono(req, res);
    if (!user) return;
    const body = await readBody(req);
    const id = params[0];
    const hash = String(body.approval_hash || '');
    const recusada = await proveProposal(body, user, id, hash);
    if (recusada) return json(res, 400, { error: recusada, code: 'PASSKEY_REFUSED' });
    saveDb();
    // Daqui até a decisão não há `await`: nada intercala com um PUT do app.
    const p = lerProposta(dir, id);
    if (!p) return json(res, 404, { error: 'proposal not found', code: 'PROPOSAL_NOT_FOUND' });
    const S = readState(ownerUid);
    if (!S) return json(res, 409, { error: 'no state for this profile', code: 'NO_STATE' });
    const a = avaliar(S, p, leitorAuditoria());
    if (['applied', 'rejected'].includes(a.status)) return json(res, 409, { error: 'already decided', code: 'PROPOSAL_DECIDED', status: a.status });
    if (a.status !== 'pending') {
      return json(res, 409, { error: a.blocked_message || 'proposal cannot be approved', code: a.blocked_reason || `PROPOSAL_${a.status.toUpperCase()}`, status: a.status });
    }
    if (approvalHash(p, a.base, a.sim.changes, a.sim.dates_replaced) !== hash) {
      return json(res, 409, { error: 'proposal changed', code: 'PROPOSAL_CHANGED' });
    }
    const r = aplicarProposta(p, S, a, 'passkey');
    if (r.code !== 200) return json(res, r.code, r.body);
    json(res, 200, { ok: true, rev: r.body.rev });
  }

  async function rejectProposal(req, res, params) {
    if (!dono(req, res)) return;
    const body = await readBody(req);
    const p = lerProposta(dir, params[0]);
    if (!p) return json(res, 404, { error: 'proposal not found', code: 'PROPOSAL_NOT_FOUND' });
    const dados = { status: 'rejected', at: new Date().toISOString(), reason: String(body.reason || '').slice(0, LIMITES.motivo) };
    if (lerDecisao(dir, p.id) || !gravarDecisao(dir, p.id, dados)) return json(res, 409, { error: 'already decided', code: 'PROPOSAL_DECIDED' });
    json(res, 200, { ok: true });
  }

  return { listProposals, getProposal, challengeProposal, approveProposal, rejectProposal, varrerAutomaticas };
}
