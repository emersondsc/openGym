// api/target-rir.test.js — RIR alvo por exercício da rotina (docs: spec_meta_de_hoje).
//
//   node --test api/target-rir.test.js
//
// Validação e normalização (casos compartilhados com o frontend), merge por id (PATCH) e a
// publicação da semana (proposta e publicação direta passam por materializeRoutine).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isValidTargetRir, normTargetRir, mergeRoutine, validateExEntry, stripCrossModeFields } from './routines.js';
import { materializeRoutine } from './micro.js';

const CASES = JSON.parse(fs.readFileSync(new URL('./target-rir.cases.json', import.meta.url)));

describe('validação e forma gravada', () => {
  for (const [v, norm] of CASES.valid) {
    test(`aceita ${JSON.stringify(v)} e grava ${JSON.stringify(norm)}`, () => {
      assert.equal(isValidTargetRir(v), true);
      assert.equal(normTargetRir(v), norm);
    });
  }
  for (const v of CASES.invalid) {
    test(`recusa ${JSON.stringify(v)}`, () => assert.equal(isValidTargetRir(v), false));
  }
  test('validateExEntry devolve BAD_TARGET_RIR', () => {
    const bad = validateExEntry({ id: '0739', sets: 3, reps: '8-12', weight: 180, mode: 'reps', targetRir: 9 },
      { catalog: null, custom: new Set() });
    assert.equal(bad?.code, 'BAD_TARGET_RIR');
  });
  test('null e ausente passam (null = apagar)', () => {
    for (const targetRir of [null, undefined]) {
      assert.equal(validateExEntry({ id: '0739', sets: 3, reps: 10, weight: 0, mode: 'reps', targetRir },
        { catalog: null, custom: new Set() }), null);
    }
  });
  test('trocar para tempo ou cardio apaga o campo', () => {
    assert.equal('targetRir' in stripCrossModeFields({ targetRir: 2 }, 'time'), false);
    assert.equal('targetRir' in stripCrossModeFields({ targetRir: 2 }, 'cardio'), false);
    assert.equal(stripCrossModeFields({ targetRir: 2 }, 'reps').targetRir, 2);
  });
});

describe('PATCH por id (mergeRoutine)', () => {
  const rotina = () => ({ id: 'r1', ex: [{ id: '0739', sets: 3, reps: '8-12', weight: 180, mode: 'reps', targetRir: 2 }] });
  test('grava normalizado', () => {
    const cur = rotina();
    assert.equal(mergeRoutine(cur, { ex: { '0739': { targetRir: ' 1 - 2 ' } } }, null, new Set()), null);
    assert.equal(cur.ex[0].targetRir, '1-2');
  });
  test('sem citar, mantém', () => {
    const cur = rotina();
    assert.equal(mergeRoutine(cur, { ex: { '0739': { weight: 190 } } }, null, new Set()), null);
    assert.equal(cur.ex[0].targetRir, 2);
  });
  test('null apaga', () => {
    const cur = rotina();
    assert.equal(mergeRoutine(cur, { ex: { '0739': { targetRir: null } } }, null, new Set()), null);
    assert.equal('targetRir' in cur.ex[0], false);
  });
  test('inválido é recusado e não grava', () => {
    const cur = rotina();
    const err = mergeRoutine(cur, { ex: { '0739': { targetRir: '3-1' } } }, null, new Set());
    assert.equal(err?.code, 'BAD_TARGET_RIR');
    assert.equal(cur.ex[0].targetRir, 2);
  });
});

describe('publicação da semana (materializeRoutine): U2', () => {
  const prev = { id: 'r1', name: 'Legs M', emoji: 'x',
    ex: [{ id: '0739', sets: 3, reps: '8-12', weight: 180, mode: 'reps', targetRir: 2 }] };
  const pub = ex => ({ id: 'r1', name: 'Legs M', emoji: 'x',
    ex: [{ id: '0739', sets: 3, reps: '8-12', weight: 180, mode: 'reps', ...ex }] });
  test('sem citar, o RIR alvo que estava fica', () => {
    assert.equal(materializeRoutine(pub({}), null, prev).ex[0].targetRir, 2);
  });
  test('valor novo substitui, normalizado', () => {
    assert.equal(materializeRoutine(pub({ targetRir: ' 1 - 2 ' }), null, prev).ex[0].targetRir, '1-2');
  });
  test('null apaga', () => {
    assert.equal('targetRir' in materializeRoutine(pub({ targetRir: null }), null, prev).ex[0], false);
  });
  test('virando tempo, o RIR alvo antigo não volta', () => {
    const r = materializeRoutine({ id: 'r1', name: 'Legs M', emoji: 'x',
      ex: [{ id: '0739', sets: 3, sec: 40, mode: 'time' }] }, null, prev);
    assert.equal('targetRir' in r.ex[0], false);
  });
  test('rotina nova, sem anterior: nada inventado', () => {
    assert.equal('targetRir' in materializeRoutine(pub({}), null, null).ex[0], false);
  });
});
