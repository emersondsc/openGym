// api/notes.test.js — notas no PUT /api/data e na escrita do treinador
// (docs/specs/spec_tipos_de_nota.md).
//
//   node --test api/notes.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// DATA_DIR precisa existir antes de importar o server (ele lê/cria o secret no boot).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-note-test-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';
const S = await import('./server.js');
const R = await import('./routines.js');
const M = await import('./micro.js');
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

const ERR = 'note must be a string of at most 1000 characters';
const long = 'a'.repeat(1001);

// ---------- PUT /api/data: checkState ----------
const withEntry = (entryNote, setNote, where = 'workouts') => {
  const set = { w: 60, r: 8, done: true, ...(setNote === undefined ? {} : { note: setNote }) };
  const entries = [{ id: '0025', ...(entryNote === undefined ? {} : { note: entryNote }), sets: [{ w: 50, r: 10, done: true }, set] }];
  return where === 'active' ? { workouts: [], active: { entries } } : { workouts: [{ id: 'w1', d: '2026-11-11', entries }] };
};

test('estado sem nota passa', () => {
  assert.equal(S.checkState(withEntry()), null);
  assert.equal(S.checkState({}), null);
});

test('nota do treino: até 1000 passa, 1001 e não-string são recusadas, no histórico e no ativo', () => {
  for (const where of ['workouts', 'active']) {
    assert.equal(S.checkState(withEntry('a'.repeat(1000), undefined, where)), null);
    assert.equal(S.checkState(withEntry(long, undefined, where)), ERR);
    assert.equal(S.checkState(withEntry(42, undefined, where)), ERR);
  }
});

test('nota de série (cliente antigo) continua validada', () => {
  assert.equal(S.checkState(withEntry(undefined, 'ok')), null);
  assert.equal(S.checkState(withEntry(undefined, long)), ERR);
  assert.equal(S.checkState(withEntry(undefined, null)), ERR);
});

test('conta pontos de código: 1000 emojis passam, 1001 não', () => {
  assert.equal(S.checkState(withEntry('💪'.repeat(1000))), null);
  assert.equal(S.checkState(withEntry('💪'.repeat(1001))), ERR);
});

test('nota fixa do exercício (exNotes)', () => {
  assert.equal(S.checkState({ exNotes: {} }), null);
  assert.equal(S.checkState({ exNotes: { '0025': 'banco 4' } }), null);
  assert.equal(S.checkState({ exNotes: { '0025': long } }), ERR);
  assert.equal(S.checkState({ exNotes: { '0025': 7 } }), ERR);
  assert.equal(S.checkState({ exNotes: [] }), ERR);
  assert.equal(S.checkState({ exNotes: 'x' }), ERR);
});

test('nota fixa da rotina', () => {
  const st = note => ({ routines: [{ id: 'r1', ex: [{ id: '0025', sets: 3, ...(note === undefined ? {} : { note }) }] }] });
  assert.equal(S.checkState(st()), null);
  assert.equal(S.checkState(st('pés altos')), null);
  assert.equal(S.checkState(st(long)), ERR);
  assert.equal(S.checkState(st(false)), ERR);
});

test('estruturas malformadas não quebram a checagem', () => {
  assert.equal(S.checkState({ workouts: [null, { entries: [null, 3, { sets: [null, 3] }] }] }), null);
});

// ---------- escrita do treinador: PATCH da rotina (mergeRoutine) ----------
const rotina = () => ({ id: 'r1', name: 'Leg', emoji: '🦵', ex: [{ id: '0025', sets: 3, reps: 8, weight: 60, mode: 'reps', note: 'pés altos' }] });

test('PATCH preserva a nota fixa da rotina ao mudar outro campo', () => {
  const cur = rotina();
  assert.equal(R.mergeRoutine(cur, { ex: { '0025': { weight: 65 } } }, null, new Set()), null);
  assert.equal(cur.ex[0].weight, 65);
  assert.equal(cur.ex[0].note, 'pés altos');
});

test('PATCH: o treinador não muda nem apaga a nota; devolver a mesma passa', () => {
  const cur = rotina();
  const e = R.mergeRoutine(cur, { ex: { '0025': { note: 'outra' } } }, null, new Set());
  assert.equal(e.code, 'NOTE_READ_ONLY');
  assert.equal(cur.ex[0].note, 'pés altos');
  assert.equal(R.mergeRoutine(rotina(), { ex: { '0025': { note: null } } }, null, new Set()).code, 'NOTE_READ_ONLY');
  assert.equal(R.mergeRoutine(rotina(), { ex: { '0025': { note: 'pés altos', weight: 62.5 } } }, null, new Set()), null);
});

test('PATCH: exercício novo com nota é recusado', () => {
  const e = R.mergeRoutine(rotina(), { ex: { '0001': { sets: 3, note: 'x' } } }, null, new Set());
  assert.equal(e.code, 'NOTE_READ_ONLY');
});

// ---------- escrita do treinador: publicação da semana (micro) ----------
test('publicação reescreve a rotina e mantém a nota do exercício que já estava', () => {
  const prev = rotina();
  const out = M.materializeRoutine({ id: 'r1', name: 'Leg', emoji: '🦵', ex: [{ id: '0025', sets: 4, reps: 6 }, { id: '0001', sets: 3 }] }, null, prev);
  assert.equal(out.ex[0].note, 'pés altos');
  assert.equal(out.ex[0].sets, 4);
  assert.equal('note' in out.ex[1], false);
});

test('publicação: nota no payload nunca vence a que estava', () => {
  const out = M.materializeRoutine({ id: 'r1', name: 'Leg', emoji: '🦵', ex: [{ id: '0025', sets: 3, note: 'injetada' }] }, null, rotina());
  assert.equal(out.ex[0].note, 'pés altos');
  const nova = M.materializeRoutine({ id: 'r2', name: 'Push', emoji: '💪', ex: [{ id: '0025', sets: 3, note: 'injetada' }] }, null, null);
  assert.equal('note' in nova.ex[0], false);
});

test('publicação: validatePublish recusa nota diferente e aceita a mesma', () => {
  const body = note => ({ meso_id: 'meso-2026-11-02', semana: 2, routines: [{ id: 'r1', name: 'Leg', emoji: '🦵', ex: [{ id: '0025', sets: 3, ...(note === undefined ? {} : { note }) }] }] });
  const hoje = M.todaySP();
  assert.equal(M.validatePublish(body(), null, new Set(), hoje, [rotina()]), null);
  assert.equal(M.validatePublish(body('pés altos'), null, new Set(), hoje, [rotina()]), null);
  assert.equal(M.validatePublish(body('outra'), null, new Set(), hoje, [rotina()]).code, 'NOTE_READ_ONLY');
  assert.equal(M.validatePublish(body('x'), null, new Set(), hoje, []).code, 'NOTE_READ_ONLY');
});
