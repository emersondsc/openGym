// api/coach.test.js — a unidade é do exercício, não do perfil (BACKLOG-01).
//
//   node --test api/coach.test.js
//
// Especificado em docs/specs/spec_unit_por_exercicio.md (RF-1, RF-2, RF-3). O que estes testes
// fixam: a conversão é POR SÉRIE, na ordem `wUnit` → `target.unit` → `S.unit`, e um estado sem
// `unit` em lugar nenhum produz exatamente os números de antes desta mudança.
//
// Os exercícios são `customEx` de propósito: assim o teste não depende do catálogo real (1324
// itens) nem de um id continuar existindo lá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsFromState, buildAnalysis } from './coach.js';

// A = a prescrição da rotina, copiada para o `target` da sessão (`target: { ...cfg }`).
// B = prescrição sem unidade nenhuma: herda o perfil.
// C = alvo em libra com UMA série marcada em kg: o `wUnit` da série vence o `target`.
// `start`/`end` numéricos são obrigatórios: sem eles a sessão colapsa numa chave NaN.
const S = (unit, ex) => ({
  unit, customEx: [{ id: 'A', n: 'A lift' }, { id: 'B', n: 'B lift' }, { id: 'C', n: 'C lift' }],
  workouts: [{
    start: 1757500000000, end: 1757503600000, name: 'T',
    entries: [
      { id: 'A', target: ex, sets: [{ w: 100, r: 5, done: true }] },
      { id: 'B', sets: [{ w: 100, r: 5, done: true }] },
      { id: 'C', target: { unit: 'lb' }, sets: [{ w: 100, r: 5, done: true, wUnit: 'kg' }] }
    ]
  }]
});

test('perfil kg, exercício em lb: converte por série', () => {
  const rows = rowsFromState(S('kg', { unit: 'lb' }));
  assert.equal(rows[0].weight_kg, '45.36');   // A: 100 lb
  assert.equal(rows[0]._unit, 'lb');
  assert.equal(rows[1].weight_kg, '100');     // B: herda o perfil
  assert.equal(rows[1]._unit, 'kg');
  assert.equal(rows[2].weight_kg, '100');     // C: o wUnit da série vence o target em lb
  assert.equal(rows[2]._unit, 'kg');
});

test('sem unit em lugar nenhum, o comportamento é o de hoje', () => {
  const rows = rowsFromState(S('kg', {}));
  assert.equal(rows[0].weight_kg, '100');
  assert.equal(rows[1].weight_kg, '100');
  assert.equal(rows[0]._unit, 'kg');
});

test('perfil lb: converte o que não tem unidade própria', () => {
  const rows = rowsFromState(S('lb', {}));
  assert.equal(rows[0].weight_kg, '45.36');
  assert.equal(rows[0]._unit, 'lb');
  assert.equal(rows[1]._unit, 'lb');
  assert.equal(rows[2].weight_kg, '100');     // o wUnit kg continua vencendo
});

test('perfil lb, exercício com unit kg: o alvo explícito vence o perfil', () => {
  const rows = rowsFromState(S('lb', { unit: 'kg' }));
  assert.equal(rows[0].weight_kg, '100');
  assert.equal(rows[0]._unit, 'kg');
  assert.equal(rows[1].weight_kg, '45.36');   // B segue o perfil
  assert.equal(rows[1]._unit, 'lb');
});

test('tolerância: "lbs" e "LB" são lidos como libra na análise', () => {
  // A validação do servidor recusa essas formas (RF-7), mas a leitura é tolerante de
  // propósito: um estado antigo ou escrito à mão não pode virar kg em silêncio.
  assert.equal(rowsFromState(S('kg', { unit: 'lbs' }))[0].weight_kg, '45.36');
  assert.equal(rowsFromState(S('kg', { unit: 'LB' }))[0].weight_kg, '45.36');
});

test('RF-3: e1RM e tonnage saem separados e corretos por exercício', () => {
  const { progress } = buildAnalysis(S('kg', { unit: 'lb' }));
  const a = progress['A lift'][0];
  const b = progress['B lift'][0];
  const c = progress['C lift'][0];
  assert.equal(a.wmax, 45.36);            // 100 lb, não 100 kg
  assert.equal(a.tonnage, 227);           // 45,359237 kg × 5 reps
  assert.equal(a.e1rm, 53);               // 45,359237 × (1 + 5/30)
  assert.equal(b.wmax, 100);              // 100 kg, intocado
  assert.equal(b.tonnage, 500);
  assert.equal(b.e1rm, 117);
  assert.equal(c.wmax, 100);              // a série com wUnit kg não vira 45,36
  assert.equal(c.e1rm, 117);              // 100 kg × (1 + 5/30)
  assert.ok(a.e1rm < b.e1rm, 'o exercício em libras não pode parecer mais pesado que o em kg');
});
