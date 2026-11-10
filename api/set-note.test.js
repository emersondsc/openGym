// api/set-note.test.js — nota por série no PUT /api/data (docs/specs/spec_nota_por_serie.md).
//
//   node --test api/set-note.test.js
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
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

const ERR = 'set note must be a string of at most 1000 characters';
const st = (note, where = 'workouts') => {
  const set = { w: 60, r: 8, done: true, ...(note === undefined ? {} : { note }) };
  const entries = [{ id: '0025', sets: [{ w: 50, r: 10, done: true }, set] }];
  return where === 'active' ? { workouts: [], active: { entries } } : { workouts: [{ id: 'w1', d: '2026-11-10', entries }] };
};

test('estado sem nota passa', () => {
  assert.equal(S.checkState(st(undefined)), null);
  assert.equal(S.checkState({}), null);
});

test('nota de até 1000 caracteres passa, 1001 é recusada', () => {
  assert.equal(S.checkState(st('a'.repeat(1000))), null);
  assert.equal(S.checkState(st('a'.repeat(1001))), ERR);
});

test('nota que não é string é recusada', () => {
  assert.equal(S.checkState(st(42)), ERR);
  assert.equal(S.checkState(st(null)), ERR);
});

test('conta pontos de código: 1000 emojis passam, 1001 não', () => {
  assert.equal(S.checkState(st('💪'.repeat(1000))), null);
  assert.equal(S.checkState(st('💪'.repeat(1001))), ERR);
});

test('a regra vale também para o treino ativo', () => {
  assert.equal(S.checkState(st('ok', 'active')), null);
  assert.equal(S.checkState(st('a'.repeat(1001), 'active')), ERR);
});

test('séries e treinos malformados não quebram a checagem', () => {
  assert.equal(S.checkState({ workouts: [null, { entries: [null, { sets: [null, 3] }] }] }), null);
});
