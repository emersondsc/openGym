// api/activities.test.js — limpeza de S.activities no PUT /api/data (docs/specs/spec_corrida.md §5).
//
//   node --test api/activities.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeActivities, ACT_MAX_ENTRIES } from './activities.js';

const NOW = 1732200000000;
const run = (over = {}) => ({ d: '2026-11-21', sport: 'run', km: 5.2, sec: 1721, min: 29, place: 'outdoor', src: 'manual', _ts: 100, ...over });
const clean = (incoming, current) => sanitizeActivities(incoming, current, NOW);

test('uma corrida válida passa intacta, sem log', () => {
  const r = clean({ m1: run({ hrAvg: 152, note: 'ok' }) });
  assert.deepEqual(r.map.m1, run({ hrAvg: 152, note: 'ok' }));
  assert.equal(r.dropped, 0);
  assert.deepEqual(r.fields, []);
});

test('descarta entradas sem a forma de uma corrida', () => {
  const r = clean({
    a1: run({ km: undefined }), a2: run({ km: 0 }), a3: run({ sec: 1.5 }),
    a4: run({ sport: 'ride' }), a5: run({ d: '21/11/2026' }), a6: run({ km: 0.004 }),
    ok: run(),
  });
  assert.deepEqual(Object.keys(r.map), ['ok']);
  assert.equal(r.dropped, 6);
});

test('id fora do padrão ou entrada que não é objeto é descartada', () => {
  const r = clean({ 'M-1': run(), m2: 'x', m3: run() });
  assert.deepEqual(Object.keys(r.map), ['m3']);
  assert.equal(r.dropped, 2);
});

test('corrige place, _ts, min, src e arredonda km', () => {
  const r = clean({ m1: run({ place: undefined, _ts: 'x', min: 3, src: 3, km: 5.123 }) });
  assert.equal(r.map.m1.place, 'outdoor');
  assert.equal(r.map.m1._ts, NOW);
  assert.equal(r.map.m1.min, 29);
  assert.equal(r.map.m1.src, 'manual');
  assert.equal(r.map.m1.km, 5.12);
  assert.deepEqual(r.fields, ['_ts', 'km', 'min', 'place', 'src']);
});

test('opcional de tipo errado sai; nota acima de 1000 pontos de código é cortada', () => {
  const longNote = '😀' + 'a'.repeat(1000);           // 1001 pontos de código
  const r = clean({ m1: run({ hrAvg: 'x', elev: 48, note: longNote }) });
  assert.equal(r.map.m1.hrAvg, undefined);
  assert.equal(r.map.m1.elev, 48);
  assert.equal([...r.map.m1.note].length, 1000);
  assert.deepEqual(r.fields, ['hrAvg', 'note']);
});

test('remoção vira só { deleted, _ts }; _ts inválido recebe agora', () => {
  const r = clean({ m1: { deleted: true, _ts: 200, hrAvg: 999, note: 'x' }, m2: { deleted: true, _ts: 'x' } });
  assert.deepEqual(r.map.m1, { deleted: true, _ts: 200 });
  assert.deepEqual(r.map.m2, { deleted: true, _ts: NOW });
});

test('chave desconhecida sai', () => {
  const r = clean({ m1: run({ foo: 1, id: 'm1' }) });
  assert.equal(r.map.m1.foo, undefined);
  assert.equal(r.map.m1.id, undefined);
  assert.deepEqual(r.fields, ['foo', 'id']);
});

test('incoming inválido ou acima do teto devolve current intacto', () => {
  const current = { m1: run() };
  assert.deepEqual(clean([run()], current), { map: current, dropped: 1, fields: [] });
  assert.deepEqual(clean('x', current), { map: current, dropped: 1, fields: [] });
  const big = {};
  for (let i = 0; i <= ACT_MAX_ENTRIES; i++) big['m' + i] = run();
  const r = clean(big, current);
  assert.equal(r.map, current);
  assert.equal(r.dropped, ACT_MAX_ENTRIES + 1);
});

test('incoming ausente devolve current (o servidor nunca grava sem a chave)', () => {
  const current = { m1: run() };
  assert.equal(clean(undefined, current).map, current);
  assert.deepEqual(clean(undefined, undefined).map, {});
});

test('um id gerado como o app gera passa na regex', () => {
  // mesma fórmula de frontend/src/lib/format.js (uid)
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const id = 'm' + uid();
  assert.deepEqual(Object.keys(clean({ [id]: run() }).map), [id]);
});

test('contagem: duas sem km e uma com hrAvg errado e chave foo', () => {
  const r = clean({ a: run({ km: undefined }), b: run({ km: undefined }), c: run({ hrAvg: 'x', foo: 1 }) });
  assert.equal(r.dropped, 2);
  assert.deepEqual(r.fields, ['foo', 'hrAvg']);
});

test('convergência: a saída limpa passada de novo não muda nada', () => {
  const first = clean({ m1: run({ place: undefined, hrAvg: 'x', km: 5.123 }), m2: { deleted: true, _ts: 5, x: 1 } });
  const second = clean(first.map);
  assert.deepEqual(second.map, first.map);
  assert.equal(second.dropped, 0);
  assert.deepEqual(second.fields, []);
});
