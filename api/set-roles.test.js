import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from './routines.js';
import * as M from './micro.js';
import * as P from './proposals.js';
import * as SR from './set-roles.js';
import { checkState } from './server.js';

const catalog = new Map([
  ['0001', { id: '0001', eq: 'barbell', tg: 'pectorals', bp: 'chest' }],
  ['0585', { id: '0585', eq: 'leverage machine', tg: 'quads', bp: 'upper legs' }]
]);

const customRoles = [
  { id: 'cr_drop', name: 'Drop-set', baseClass: 'intensified' },
  { id: 'cr_top', name: 'Top Set', baseClass: 'standard' },
  { id: 'cr_ramp', name: 'Rampa', baseClass: 'prep' },
  { id: 'cr_del', name: 'Antigo', baseClass: 'prep', deleted: true }
];

test('set-roles: todos os codigos de erro de validateSetTargets e stripCrossModeFields', () => {
  const base = { id: '0001', sets: 2, reps: 8, weight: 100, mode: 'reps' };
  const err = (patch, cr = customRoles) => R.validateExEntry({ ...base, ...patch }, { catalog, customRoles: cr });

  assert.equal(err({ mode: 'time', sec: 45, setTargets: [{ weight: 0, reps: 8 }] }).code, 'SET_TARGETS_REPS_ONLY');
  assert.equal(err({ setTargets: [] }).code, 'BAD_SET_TARGETS');
  assert.equal(err({ setTargets: [{ weight: 100, reps: 8 }] }).code, 'BAD_SET_TARGETS'); // length !== sets (2)
  assert.equal(err({ setTargets: [{ role: 'bad role!', reps: 8 }, { reps: 8 }] }).code, 'BAD_SET_TARGET_ROLE');
  assert.equal(err({ setTargets: [{ role: 'cr_missing', reps: 8 }, { reps: 8 }] }).code, 'UNKNOWN_SET_ROLE');
  assert.equal(err({ setTargets: [{ role: 'cr_del', reps: 8 }, { reps: 8 }] }).code, 'UNKNOWN_SET_ROLE');
  assert.equal(err({ setTargets: [{ weight: -1, reps: 8 }, { reps: 8 }] }).code, 'BAD_SET_TARGET_WEIGHT');
  assert.equal(err({ setTargets: [{ weight: 50, reps: '12-8' }, { reps: 8 }] }).code, 'BAD_SET_TARGET_REPS');
  assert.equal(err({ setTargets: [{ role: 'warmup', weight: 50, reps: 8, targetRir: 2 }, { reps: 8 }] }).code, 'BAD_PREP_TARGET_RIR');
  assert.equal(err({ setTargets: [{ role: 'cr_ramp', weight: 50, reps: 8, targetRir: 1 }, { reps: 8 }] }).code, 'BAD_PREP_TARGET_RIR');
  assert.equal(err({ setTargets: [{ role: 'pap', weight: 110, reps: 2, goal: true }, { reps: 8 }] }).code, 'BAD_PREP_GOAL');
  assert.equal(err({ setTargets: [{ weight: 100, reps: 8, targetRir: 5 }, { reps: 8 }] }).code, 'BAD_TARGET_RIR');
  assert.equal(err({
    setTargets: [
      { role: 'cr_top', weight: 120, reps: 5, targetRir: 1, goal: true },
      { role: 'backoff', weight: 90, reps: '8-12', targetRir: 2, goal: true }
    ]
  }).code, 'CONFLICTING_GOAL_SIGNATURES');

  // stripCrossModeFields remove setTargets ao trocar para time/cardio
  const strippedTime = R.stripCrossModeFields({ ...base, setTargets: [{ weight: 100, reps: 8 }] }, 'time');
  assert.equal(strippedTime.setTargets, undefined);
  const strippedCardio = R.stripCrossModeFields({ ...base, setTargets: [{ weight: 100, reps: 8 }] }, 'cardio');
  assert.equal(strippedCardio.setTargets, undefined);
});

test('set-roles: normSetTargetsEntry mantem e.sets === setTargets.length e espelha apenas assinatura do Goal', () => {
  const entry = {
    id: '0001',
    sets: 4,
    mode: 'reps',
    weight: 0,
    reps: 10,
    setTargets: [
      { role: 'warmup', weight: 50, reps: 8 },
      { role: 'pap', weight: 190, reps: 2 },
      { role: 'cr_top', weight: 180, reps: ' 8 - 12 ', targetRir: '1 - 2', goal: true },
      { role: 'backoff', weight: 145, reps: '12-15', targetRir: 2, goal: false }
    ]
  };
  SR.normSetTargetsEntry(entry, customRoles);
  assert.equal(entry.sets, 4);
  assert.equal(entry.setTargets.length, 4);
  assert.equal(entry.weight, 180);
  assert.equal(entry.reps, '8-12');
  assert.equal(entry.targetRir, '1-2');
  assert.equal(entry.setTargets[3].goal, undefined);

  // Colapsa para plano se todas forem 'work' identicas
  const uniform = {
    id: '0001',
    sets: 2,
    mode: 'reps',
    setTargets: [
      { role: 'work', weight: 100, reps: '8-8', targetRir: 2, goal: true },
      { weight: 100, reps: 8, targetRir: 2, goal: true }
    ]
  };
  SR.normSetTargetsEntry(uniform, customRoles);
  assert.equal(uniform.setTargets, undefined);
  assert.equal(uniform.sets, 2);
  assert.equal(uniform.reps, 8);
  assert.equal(uniform.weight, 100);
  assert.equal(uniform.targetRir, 2);
});

test('set-roles: validateCustomSetRoles e checkState com tombstones e unicidade', () => {
  assert.equal(checkState({ customSetRoles: customRoles }), null);
  assert.ok(checkState({ customSetRoles: [{ id: 'work', name: 'X', baseClass: 'standard' }] }));
  assert.ok(checkState({ customSetRoles: [{ id: 'cr_1', name: 'A', baseClass: 'standard' }, { id: 'cr_1', name: 'B', baseClass: 'prep' }] }));
  assert.ok(checkState({ customSetRoles: [{ id: 'cr_1', name: '   ', baseClass: 'standard' }] }));
  assert.ok(checkState({ customSetRoles: [{ id: 'cr_1', name: 'A', baseClass: 'invalid' }] }));

  // 30 ativos + 2 tombstones passam; 31 ativos falham
  const ok30 = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `cr_${i}`, name: `R${i}`, baseClass: 'standard' })),
    { id: 'cr_t1', name: 'Del1', baseClass: 'prep', deleted: true },
    { id: 'cr_t2', name: 'Del2', baseClass: 'prep', deleted: true }
  ];
  assert.equal(checkState({ customSetRoles: ok30 }), null);
  assert.ok(checkState({ customSetRoles: [...ok30, { id: 'cr_31', name: 'Over', baseClass: 'standard' }] }));

  // Sanitizador passivo corrige prep com targetRir, length mismatch e goals conflitantes sem erro
  const dirty = {
    id: '0001', sets: 2, mode: 'reps', weight: 0, reps: 8,
    setTargets: [
      { role: 'warmup', weight: 40, reps: 8, targetRir: 3, goal: true },
      { role: 'work', weight: 100, reps: '8-12', targetRir: 2, goal: true },
      { role: 'backoff', weight: 80, reps: 12, goal: true }
    ]
  };
  SR.sanitizeRoutineEntry(dirty, customRoles);
  assert.equal(dirty.sets, 2);
  assert.equal(dirty.setTargets.length, 2);
  assert.equal(dirty.setTargets[0].targetRir, undefined);
  assert.equal(dirty.setTargets[0].goal, undefined);
  assert.equal(dirty.setTargets[1].goal, true);
});

test('set-roles: micro materializeRoutine (regra U2, null clear) e proposals validarPlano/hashBase', () => {
  const prevRoutine = {
    id: 'r_upper', name: 'Upper', emoji: 'A', prog: 'off',
    ex: [{
      id: '0001', sets: 3, mode: 'reps', reps: '8-12', weight: 100, targetRir: 2,
      setTargets: [
        { role: 'warmup', weight: 50, reps: 8 },
        { weight: 100, reps: '8-12', targetRir: 2, goal: true },
        { weight: 100, reps: '8-12', targetRir: 2, goal: true }
      ]
    }]
  };

  // Republicar sem setTargets preserva setTargets existentes (U2)
  const matKeep = M.materializeRoutine({
    id: 'r_upper', name: 'Upper', emoji: 'A',
    ex: [{ id: '0001', weight: 102.5, reps: '8-12' }]
  }, catalog, prevRoutine, customRoles);
  assert.equal(matKeep.ex[0].sets, 3);
  assert.equal(matKeep.ex[0].setTargets.length, 3);
  assert.equal(matKeep.ex[0].setTargets[0].role, 'warmup');

  // Publicar com setTargets preservando targetRir interno quando omitido
  const matInnerU2 = M.materializeRoutine({
    id: 'r_upper', name: 'Upper', emoji: 'A',
    ex: [{
      id: '0001', sets: 3,
      setTargets: [
        { role: 'warmup', weight: 55, reps: 8 },
        { weight: 105, reps: '8-12', goal: true },
        { role: 'cr_drop', weight: 80, reps: 12, targetRir: 0 }
      ]
    }]
  }, catalog, prevRoutine, customRoles);
  assert.equal(matInnerU2.ex[0].setTargets[1].targetRir, 2); // herdado de prevSetTargets[1]
  assert.equal(matInnerU2.ex[0].setTargets[2].role, 'cr_drop');

  // Publicar com setTargets: null apaga
  const matClear = M.materializeRoutine({
    id: 'r_upper', name: 'Upper', emoji: 'A',
    ex: [{ id: '0001', sets: 3, reps: 10, weight: 90, setTargets: null }]
  }, catalog, prevRoutine, customRoles);
  assert.equal(matClear.ex[0].setTargets, undefined);

  // Proposal week + routine_patch passam e simulam sem erros
  const S = {
    unit: 'kg', customEx: [], customSetRoles: customRoles,
    routines: [prevRoutine], week: {}, dayPlan: {}, workouts: []
  };
  const patchPlan = {
    routine_id: 'r_upper',
    patch: {
      ex: {
        '0001': {
          sets: 3,
          setTargets: [
            { role: 'cr_ramp', weight: 60, reps: 6 },
            { role: 'cr_top', weight: 110, reps: '6-8', targetRir: 1, goal: true },
            { role: 'backoff', weight: 90, reps: '10-12', targetRir: 2 }
          ]
        }
      }
    }
  };
  assert.equal(P.validarPlano(S, 'routine_patch', patchPlan, catalog), null);
  const sim = P.simular(S, { id: 'prop-1', kind: 'routine_patch', plan: patchPlan, title: 't', summary: 's', reasons: [], base_hash: 'h', created_at: '2026-11-18T00:00:00Z', expires_at: '2026-11-25T00:00:00Z' }, catalog);
  assert.equal(sim.error, undefined);
  assert.ok(P.hashBase(S, 'routine_patch', patchPlan));
});
