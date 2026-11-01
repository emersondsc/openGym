import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistoryFix, validarOps } from './history-fix.js';

const base = () => ({ unit: 'kg', exWeights: { a: { w: 474, d: '2025-12-29', src: 'w2' } }, workouts: [
  { id: 'w1', d: '2025-12-01', entries: [{ id: 'a', topW: 45, sets: [{ w: 45, r: 5, done: true }] }], vol: 225, prs: ['a'] },
  { id: 'w2', d: '2025-12-29', entries: [{ id: 'a', topW: 474, sets: [{ w: 474, r: 5, done: true, rir: 1 }, { w: 40, r: 8, done: true }, { w: 1, r: 1, done: false }] }], vol: 2690, prs: ['a'] }
] });
const op = (extra = {}) => ({ workout_id: 'w2', exercise_id: 'a', set_index: 0, field: 'w', from: 474, to: 47.4, ...extra });
const codigo = (S, ops) => validarOps(S, ops)?.code ?? null;

test('corrige e recalcula volume, topW, recorde e melhor peso', () => {
  const S = base();
  assert.equal(validarOps(S, [op()]), null);
  applyHistoryFix(S, [op()]);
  const w = S.workouts[1];
  assert.equal(w.entries[0].sets[0].w, 47.4);
  assert.equal(w.entries[0].topW, 47.4);
  assert.equal(w.vol, 557);
  assert.deepEqual(w.prs, ['a']);
  assert.deepEqual(S.exWeights.a, { w: 47.4, d: '2025-12-29', src: 'w2' });
});
test('recusa valor divergente, tipo diferente e sem mudanca', () => {
  const S = base();
  assert.equal(codigo(S, [op({ from: 50 })]), 'HISTORY_MISMATCH');
  assert.equal(codigo(S, [op({ from: '474' })]), 'HISTORY_MISMATCH');
  assert.equal(codigo(S, [op({ to: 474 })]), 'HISTORY_NOOP');
});
test('faixas, campo proibido, duplicata e serie inexistente', () => {
  const S = base();
  assert.equal(codigo(S, [op({ to: 5000 })]), 'HISTORY_BAD_VALUE');
  assert.equal(codigo(S, [op({ field: 'done', from: true, to: false })]), 'HISTORY_BAD_FIELD');
  assert.equal(codigo(S, [op(), op()]), 'HISTORY_DUPLICATE');
  assert.equal(codigo(S, [op({ set_index: 9 })]), 'HISTORY_NOT_FOUND');
  assert.equal(codigo(S, [op({ set_index: 2, from: 1, to: 2 })]), 'HISTORY_NOT_DONE');
  assert.equal(codigo(S, []), 'HISTORY_BAD_OPS');
});
test('so rir e rpe aceitam remover; ausente equivale a nulo', () => {
  const S = base();
  assert.equal(codigo(S, [op({ to: null })]), 'HISTORY_BAD_VALUE');
  assert.equal(codigo(S, [op({ field: 'rir', from: 1, to: null })]), null);
  applyHistoryFix(S, [op({ field: 'rir', from: 1, to: null })]);
  assert.equal('rir' in S.workouts[1].entries[0].sets[0], false);
  assert.equal(codigo(S, [op({ set_index: 1, field: 'rpe', from: null, to: 8 })]), null);
});
test('volume respeita libras em perfil kg', () => {
  const S = base();
  S.workouts[1].entries[0].target = { unit: 'lb' };
  applyHistoryFix(S, [op({ to: 100 })]);
  assert.equal(S.workouts[1].vol, Math.round(((100 * 5 + 40 * 8) * 0.45359237) * 10) / 10);
});
