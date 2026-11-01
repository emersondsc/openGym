// api/history-fix.js — correção de séries já registradas, proposta pelo treinador.
//
// Porta do recálculo de `applyWorkoutEdit` (frontend/src/lib/workout-edit.js): volume, recordes do
// treino, `topW` e melhor peso. `frontend/src/lib/history-fix-parity.test.js` compara as duas contas;
// ao mudar uma, mude a outra. Mesmo precedente de `api/units.js` e `api/coach.js`.
import { fromKg, normUnit, toKg, unitOfSet } from './units.js';

export const MAX_OPS = 50;
const FAIXAS = {
  w: v => Number.isFinite(v) && v >= 0 && v <= 1000,
  r: v => Number.isFinite(v) && v >= 0 && v <= 200,
  sec: v => Number.isInteger(v) && v >= 1 && v <= 3600,
  min: v => Number.isFinite(v) && v >= 1 && v <= 600,
  speed: v => Number.isFinite(v) && v >= 0 && v <= 40,
  rir: v => Number.isFinite(v) && v >= 0 && v <= 10,
  rpe: v => Number.isFinite(v) && v >= 1 && v <= 10,
  wUnit: v => v === 'kg' || v === 'lb'
};
const ANULAVEIS = new Set(['rir', 'rpe']);
const bad = (code, error) => ({ code, error, field: 'ops' });

export function acharEntrada(S, op) {
  const w = (S.workouts || []).find(x => x.id === op.workout_id);
  const e = (w?.entries || []).filter(x => x.id === op.exercise_id)[op.entry_index ?? 0];
  return { w, e, s: e?.sets?.[op.set_index] };
}

/** Devolve null ou {code, error}. `from` tem de ser o valor gravado, sem conversão de tipo. */
export function validarOps(S, ops) {
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) {
    return bad('HISTORY_BAD_OPS', `ops must have 1..${MAX_OPS} items`);
  }
  const vistos = new Set();
  for (const op of ops) {
    if (!op || typeof op !== 'object' || !Object.hasOwn(FAIXAS, op.field)) return bad('HISTORY_BAD_FIELD', `bad field "${op?.field}"`);
    if (!Number.isInteger(op.set_index) || op.set_index < 0) return bad('HISTORY_BAD_OPS', 'set_index must be an integer >= 0');
    const { s } = acharEntrada(S, op);
    if (!s) return bad('HISTORY_NOT_FOUND', `set not found in ${op.workout_id}`);
    if (!s.done) return bad('HISTORY_NOT_DONE', 'only completed sets can be fixed');
    const chave = `${op.workout_id}|${op.exercise_id}|${op.entry_index ?? 0}|${op.set_index}|${op.field}`;
    if (vistos.has(chave)) return bad('HISTORY_DUPLICATE', `duplicate op on ${op.field}`);
    vistos.add(chave);
    const to = op.to ?? null;
    const from = op.from ?? null;
    if ((s[op.field] ?? null) !== from) return bad('HISTORY_MISMATCH', `${op.field} is not the expected value`);
    if (to === from) return bad('HISTORY_NOOP', `${op.field} would not change`);
    if (to === null ? !ANULAVEIS.has(op.field) : !FAIXAS[op.field](to)) return bad('HISTORY_BAD_VALUE', `bad value for ${op.field}`);
  }
  return null;
}

const melhorDe = (S, exId) => {
  let w = 0, d = null, src = null;
  (S.workouts || []).forEach(x => x.entries.forEach(e => {
    if (e.id !== exId) return;
    e.sets.forEach(s => { if (s.done && s.w > w) { w = s.w; d = x.d; src = x.id; } });
    if (e.topW && e.topW > w) { w = e.topW; d = x.d; src = x.id; }
  }));
  return { w, d, src };
};
const maxFeito = e => Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0));

function volume(w, S) {
  const perfil = normUnit(S.unit);
  let kg = 0;
  w.entries.forEach(e => e.sets.forEach(s => {
    if (s.done) kg += toKg(s.w, unitOfSet(s, e, perfil)) * (s.r || 0);
  }));
  return fromKg(kg, perfil);
}

function recalcular(S, w, antes, tocados) {
  const antesPorId = new Map();
  antes.entries.forEach(e => { if (!antesPorId.has(e.id)) antesPorId.set(e.id, e); });
  for (const e of w.entries) {
    if (tocados.has(e.id)) e.topW = maxFeito(e) || null;
  }
  w.vol = volume(w, S);
  const outros = { ...S, workouts: (S.workouts || []).filter(x => x.id !== w.id) };
  w.prs = w.entries.filter(e => { const m = maxFeito(e); return m > 0 && m > melhorDe(outros, e.id).w; }).map(e => e.id);
  const exWeights = { ...(S.exWeights || {}) };
  for (const exId of new Set(w.entries.map(e => e.id))) {
    const e = w.entries.find(x => x.id === exId);
    const velho = antesPorId.get(exId);
    const oldMx = Math.max(0, ...((velho?.sets) || []).filter(s => s.done).map(s => s.w || 0), velho?.topW || 0);
    const mx = Math.max(maxFeito(e), e.topW || 0);
    const cur = exWeights[exId];
    if (mx > 0 && (!cur || mx > cur.w)) { exWeights[exId] = { w: mx, d: w.d, src: w.id }; continue; }
    if (!cur || mx >= cur.w) continue;
    if (!(cur.src ? cur.src === w.id : cur.w <= oldMx)) continue;
    const best = melhorDe(S, exId);
    if (best.w > 0) exWeights[exId] = { w: best.w, d: best.d, src: best.src };
    else delete exWeights[exId];
  }
  S.exWeights = exWeights;
}

/** Muta `S`. Chamar só depois de `validarOps`. */
export function applyHistoryFix(S, ops) {
  const porTreino = new Map();
  for (const op of ops) {
    if (!porTreino.has(op.workout_id)) porTreino.set(op.workout_id, []);
    porTreino.get(op.workout_id).push(op);
  }
  for (const [id, lista] of porTreino) {
    const w = S.workouts.find(x => x.id === id);
    const antes = JSON.parse(JSON.stringify(w));
    const tocados = new Set();
    for (const op of lista) {
      const { s } = acharEntrada(S, op);
      if ((op.to ?? null) === null) delete s[op.field]; else s[op.field] = op.to;
      tocados.add(op.exercise_id);
    }
    recalcular(S, w, antes, tocados);
  }
  return { _meta: { workouts: [...porTreino.keys()], ops: ops.length } };
}
