// api/routines.test.js — suíte do servidor (sem dependência nova: `node --test`, Node 22).
//
//   node --test api/routines.test.js
//
// Cobre: validação de campo (incluindo a tolerância ao legado do estado real), merge por id,
// limpeza de superset, limpeza de week/dayPlan, token de concorrência (rev/If-Match), identidade
// do agente (claim × assinatura), chave do agente e trilha de auditoria.
// Especificado em docs/specs/spec_api_rotinas.md (v3).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

// DATA_DIR precisa existir antes de importar o server (ele lê/cria o secret no boot).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-api-test-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';

const R = await import('./routines.js');
const S = await import('./server.js');

const CATALOG = [
  { id: '0326', name: 'dumbbell incline rear lateral raise', bp: 'shoulders', eq: 'dumbbell', img: 'a.jpg', gif: 'a.gif' },
  { id: '0584', name: 'lever lateral raise', bp: 'shoulders', eq: 'leverage machine', img: 'b.jpg', gif: 'b.gif' },
  { id: '0585', name: 'lever leg extension', bp: 'upper legs', eq: 'leverage machine', img: 'c.jpg', gif: 'c.gif' },
  { id: '0001', name: '3/4 sit-up', bp: 'waist', eq: 'body weight', img: 'd.jpg', gif: 'd.gif' }
];
fs.writeFileSync(path.join(TMP, 'exercise_catalog.json'), JSON.stringify(CATALOG));
fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'Test' }], creds: [], subs: [], invites: [] }));
R.__resetCatalogCache();
const CATALOG_MAP = R.loadCatalog(path.join(TMP, 'exercise_catalog.json'));

const entry = (id, extra = {}) => ({ id, sets: 3, reps: '6-8', weight: 45, ...extra });

function routine(extra = {}) {
  return {
    id: 'r_upper', name: 'Upper C', emoji: '🔺', prog: 'off',
    ex: [entry('0326', { mode: 'normal', sg: 0, weight: 8 }), entry('0584', { mode: 'normal', sg: 0 })],
    ...extra
  };
}
function state(extra = {}) {
  return {
    _ts: 1789132746742, rev: 4, unit: 'kg',
    routines: [routine(), { id: 'r_leg1', name: 'Legs 1', prog: 'off', ex: [entry('0585', { weight: 200 })] }],
    workouts: [
      { id: 'w1', d: '2026-09-08', routineId: 'r_upper', entries: [{ id: '0326', sets: [{ w: 8, r: 8, done: true }] }] },
      { id: 'w2', d: '2026-09-06', routineId: 'r_pull', entries: [{ id: '0584', sets: [{ w: 45, r: 6, done: true }] }] }
    ],
    exWeights: { '0326': { w: 9 } }, customEx: [{ id: 'immt_custom', n: 'custom fly', bp: 'shoulders' }],
    week: { 4: 'r_upper' }, dayPlan: { '2026-09-15': 'r_upper' }, bodyweight: [], ...extra
  };
}
const custom = new Set(['immt_custom']);

/* ---------------------------------------------------------------- validação */

describe('validateExEntry', () => {
  const ok = [
    { name: 'reps (app)', e: entry('0326', { mode: 'reps' }) },
    { name: 'time', e: { id: '0584', sets: 3, mode: 'time', sec: 45, weight: 0 } },
    { name: 'cardio', e: { id: '0584', sets: 1, mode: 'cardio', min: 20, speed: 8 } },
    { name: 'faixa de reps', e: entry('0584', { reps: '6-8' }) },
    { name: 'customEx do perfil', e: entry('immt_custom') }
  ];
  for (const c of ok) {
    test(`aceita ${c.name}`, () => {
      assert.equal(R.validateExEntry(c.e, { catalog: CATALOG_MAP, custom, where: 'ex' }), null);
    });
  }

  const wrong = [
    ['BAD_WEIGHT', { ...entry('0326'), weight: '45 kg' }],
    ['BAD_WEIGHT', { ...entry('0326'), weight: -5 }],
    ['BAD_WEIGHT', { ...entry('0326'), weight: true }],
    ['BAD_SETS', { ...entry('0326'), sets: 0 }],
    ['BAD_REPS', { ...entry('0326'), reps: '8-6' }],
    ['BAD_REPS', { ...entry('0326'), reps: 'AMRAP' }],
    ['CATALOG_UNKNOWN_EX', { ...entry('zzz_ghost') }],
    ['EX_ID_REQUIRED', { ...entry('0326'), id: '' }],
    ['BAD_MODE', { ...entry('0326'), mode: 'xyz' }],              // modo desconhecido
    // 'normal' NÃO entra aqui: ele é legado tolerado (o estado real inteiro é assim) e o que se
    // proíbe é INTRODUZI-LO num exercício novo — o caso tem teste próprio abaixo (isNewEntry).
    ['BAD_PROG', { ...entry('0326'), prog: 'turbo' }],
    ['BAD_REST', { ...entry('0326'), restSec: 10 }],
    ['SIDE_ON_TIME', { id: '0584', sets: 3, mode: 'time', sec: 30, side: true }],
    // BACKLOG-01: a unidade é 'kg' ou 'lb', exatamente. 'lbs'/'LB'/'lb ' cairiam em silêncio
    // na herança do perfil se a validação fosse tolerante, e o exercício voltaria a ser lido
    // em kg sem ninguém perceber.
    ['BAD_UNIT', { ...entry('0326'), unit: 'lbs' }],
    ['BAD_UNIT', { ...entry('0326'), unit: 'LB' }],
    ['BAD_UNIT', { ...entry('0326'), unit: 'lb ' }],
    ['BAD_UNIT', { ...entry('0326'), unit: 'pounds' }]
  ];
  for (const [code, e] of wrong) {
    test(`recusa com ${code}`, () => {
      const r = R.validateExEntry(e, { catalog: CATALOG_MAP, custom, where: 'ex.0326' });
      assert.equal(r?.code, code, JSON.stringify(r));
      assert.ok(r.field);
      assert.ok(r.message);
    });
  }

  // BACKLOG-01 / RF-7: o campo do erro carrega o id do exercício, como os outros.
  test('BAD_UNIT aponta o campo com o id do exercício', () => {
    const r = R.validateExEntry({ ...entry('0585'), unit: 'lbs' },
      { catalog: CATALOG_MAP, custom, where: 'ex.0585' });
    assert.equal(r.code, 'BAD_UNIT');
    assert.equal(r.field, 'ex.0585.unit');
    assert.deepEqual(r.allowed, ['kg', 'lb']);
  });

  // BACKLOG-01 / RF-4: ausente herda o perfil, e as duas unidades são aceitas.
  test('unit aceita kg, lb e ausente; recusa o resto', () => {
    const w = { catalog: CATALOG_MAP, custom, where: 'ex.0585' };
    assert.equal(R.validateExEntry(entry('0585', { weight: 200, unit: 'lb' }), w), null);
    assert.equal(R.validateExEntry(entry('0585', { weight: 200, unit: 'kg' }), w), null);
    assert.equal(R.validateExEntry(entry('0585', { weight: 200 }), w), null);
  });

  test('tolerância: mode "normal" e sg 0 onde JÁ ESTÃO (o estado real)', () => {
    assert.equal(R.validateExEntry(entry('0326', { mode: 'normal', sg: 0 }),
      { catalog: CATALOG_MAP, custom, where: 'ex', legacy: { mode: 'normal', sg: 0 } }), null);
  });
  test('tolerância: item novo no disco (legacy undefined) não recusa o sg 0 que já vinha', () => {
    assert.equal(R.validateExEntry(entry('0326', { mode: 'normal', sg: 0 }),
      { catalog: CATALOG_MAP, custom, where: 'ex', legacy: {} }), null);
  });
  test('tolerância: sec ausente em mode time legado NÃO é cobrado se o modo não mudou', () => {
    assert.equal(R.validateExEntry({ id: '0584', sets: 3, mode: 'time', weight: 0 },
      { catalog: CATALOG_MAP, custom, where: 'ex', legacy: { mode: 'time' }, modeChanged: false }), null);
    // troca de verdade para time (o item era reps) sem informar sec -> recusa
    assert.equal(R.validateExEntry({ id: '0584', sets: 3, mode: 'time', weight: 0 },
      { catalog: CATALOG_MAP, custom, where: 'ex', legacy: { mode: 'reps' }, modeChanged: true })?.code, 'MODE_TIME_NO_SEC');
  });
  test('modo "normal" num exercício NOVO da intenção é recusado (isNewEntry)', () => {
    assert.equal(R.validateExEntry(entry('0326', { mode: 'normal', sg: 0 }),
      { catalog: CATALOG_MAP, custom, where: 'ex', legacy: {}, isNewEntry: true })?.code, 'BAD_MODE');
    assert.equal(R.validateExEntry(entry('0326', { mode: 'normal', sg: 0 }),
      { catalog: CATALOG_MAP, custom, where: 'ex', legacy: {}, isNewEntry: true })?.field, 'ex.mode');
  });
  test('modo trocado de reps para time remove o campo do modo anterior', () => {
    const cur = routine();
    const err = R.mergeRoutine(cur, { ex: { '0326': { mode: 'time', sec: 40, weight: 10 } } }, CATALOG_MAP, custom);
    assert.equal(err, null);
    const e = cur.ex.find(x => x.id === '0326');
    assert.equal(e.mode, 'time');
    assert.equal(e.sec, 40);
    assert.equal(e.reps, undefined, 'reps do modo antigo não pode sobrar');
  });

  // BACKLOG-01 / RF-8: o merge parte de `{ ...target }`, então um `unit` que a intenção não
  // cita sobrevive. O escritor do Hermes depende exatamente disto para não apagar o campo.
  test('PATCH preserva o unit que a intenção não cita', () => {
    const cur = routine({ ex: [entry('0585', { weight: 200, unit: 'lb' })] });
    const err = R.mergeRoutine(cur, { ex: { '0585': { weight: 210 } } }, CATALOG_MAP, custom);
    assert.equal(err, null);
    assert.equal(cur.ex[0].unit, 'lb', 'a unidade não pode ser perdida no merge');
    assert.equal(cur.ex[0].weight, 210);
  });
  test('PATCH pode definir e limpar o unit', () => {
    const cur = routine({ ex: [entry('0585', { weight: 200 })] });
    assert.equal(R.mergeRoutine(cur, { ex: { '0585': { unit: 'lb' } } }, CATALOG_MAP, custom), null);
    assert.equal(cur.ex[0].unit, 'lb');
    assert.equal(R.mergeRoutine(cur, { ex: { '0585': { unit: 'kg' } } }, CATALOG_MAP, custom), null);
    assert.equal(cur.ex[0].unit, 'kg');
  });
});

describe('defaultExFields / stripCrossModeFields', () => {
  test('reproduz defaultConfig (history.js:121-129)', () => {
    assert.deepEqual(R.defaultExFields('0584', 'reps', 'leverage machine'), { sets: 3, reps: 10, weight: 0, mode: 'reps' });
    assert.deepEqual(R.defaultExFields('0584', 'time', 'leverage machine'), { sets: 3, sec: 45, weight: 0, mode: 'time' });
    assert.deepEqual(R.defaultExFields('0584', 'cardio', 'leverage machine'), { sets: 1, min: 20, speed: 8 });
    assert.deepEqual(R.defaultExFields('0001', 'reps', 'body weight'), { sets: 3, reps: 10, weight: 0, mode: 'reps', bodyweight: true });
  });
});

describe('mergeRoutine', () => {
  test('merge por id preserva o que não foi citado e mantém a posição', () => {
    const cur = routine();
    const before = JSON.parse(JSON.stringify(cur));
    assert.equal(R.mergeRoutine(cur, { ex: { '0326': { weight: 10 } } }, CATALOG_MAP, custom), null);
    assert.equal(cur.ex[0].id, '0326');
    assert.equal(cur.ex[0].weight, 10);
    assert.equal(cur.ex[0].sets, before.ex[0].sets);       // não citado: preservado
    assert.equal(cur.ex[0].mode, before.ex[0].mode);       // legado preservado
    assert.equal(cur.ex[0].sg, before.ex[0].sg);
    assert.deepEqual(cur.ex[1], before.ex[1]);
  });
  test('id novo entra no fim com defaults do modo', () => {
    const cur = routine();
    assert.equal(R.mergeRoutine(cur, { ex: { '0001': { sets: 3 } } }, CATALOG_MAP, custom), null);
    const novo = cur.ex[cur.ex.length - 1];
    assert.equal(novo.id, '0001');
    assert.equal(novo.reps, 10);
    assert.equal(novo.bodyweight, true);
  });
  test('exRemoved de id ausente é erro (não adivinha)', () => {
    const cur = routine();
    const e = R.mergeRoutine(cur, { exRemoved: ['nao_existe'] }, CATALOG_MAP, custom);
    assert.equal(e.code, 'EX_NOT_IN_ROUTINE');
  });
  test('exRemoved limpa superset órfão (par quebrado perde o sg)', () => {
    const cur = routine();
    cur.ex[0].sg = 'sg1'; cur.ex[1].sg = 'sg1';
    assert.equal(R.mergeRoutine(cur, { exRemoved: ['0584'] }, CATALOG_MAP, custom), null);
    assert.equal(cur.ex.length, 1);
    assert.equal('sg' in cur.ex[0], false);
  });
  test('peso não numérico é recusado com BAD_WEIGHT e a rotina não muda', () => {
    const cur = routine();
    const before = JSON.stringify(cur);
    const e = R.mergeRoutine(cur, { ex: { '0326': { weight: '45 kg' } } }, CATALOG_MAP, custom);
    assert.equal(e.code, 'BAD_WEIGHT');
    assert.equal(JSON.stringify(cur), before);
  });
});

describe('sweepRoutineRefs / cleanupSg / parseIfMatch / stateMeta', () => {
  test('sweep limpa week e dayPlan, preserva workouts[] e conta órfãos', () => {
    const s = state();
    const r = R.sweepRoutineRefs(s, 'r_upper');
    assert.deepEqual(r, { weekCleaned: 1, dayPlanCleaned: 1, orphanWorkouts: 1 });
    assert.equal(s.week['4'], undefined);
    assert.equal(s.dayPlan['2026-09-15'], undefined);
    assert.equal(s.workouts.length, 2);
    assert.equal(s.workouts[0].routineId, 'r_upper');    // histórico é registro, não ponteiro
  });
  test('parseIfMatch nunca devolve número e marca formato inválido', () => {
    assert.equal(R.parseIfMatch(undefined), null);
    assert.equal(R.parseIfMatch(''), null);
    assert.equal(R.parseIfMatch('*'), '*');
    assert.equal(R.parseIfMatch('7'), '7');
    assert.equal(R.parseIfMatch('"7"'), '7');
    assert.equal(R.parseIfMatch('"7'), '7');    // uma aspa só é normalizada (tolerância)
    assert.equal(R.parseIfMatch('"7 '), '7');
    assert.equal(R.parseIfMatch('abc'), 'BAD');
    assert.equal(R.parseIfMatch('7a'), 'BAD');
  });
  test('stateMeta normaliza rev ausente para 0', () => {
    assert.equal(R.stateMeta({}).rev, 0);
    assert.equal(R.stateMeta({ rev: 7 }).rev, 7);
    assert.equal(R.stateMeta(undefined).rev, 0);
  });
});

/* ---------------------------------------------------------------- validação no PUT */

describe('checkRoutineFields (PUT /api/data)', () => {
  test('estado REAL (mode normal, sg 0) passa — é o cliente publicado', () => {
    const cur = state();
    const incoming = JSON.parse(JSON.stringify(cur));
    incoming.routines[0].ex[0].weight = 9;
    assert.equal(S.checkRoutineFields(incoming, cur), null);
  });
  test('weight "45 kg" é recusado com BAD_WEIGHT', () => {
    const cur = state();
    const incoming = JSON.parse(JSON.stringify(cur));
    incoming.routines[0].ex[0].weight = '45 kg';
    assert.equal(S.checkRoutineFields(incoming, cur)?.code, 'BAD_WEIGHT');
  });
  test('id fantasma é recusado com CATALOG_UNKNOWN_EX', () => {
    const cur = state();
    const incoming = JSON.parse(JSON.stringify(cur));
    incoming.routines[0].ex.push({ id: 'zzz_ghost', sets: 3, reps: '6-8', weight: 10 });
    assert.equal(S.checkRoutineFields(incoming, cur)?.code, 'CATALOG_UNKNOWN_EX');
  });
  test('customEx do DISCO conta mesmo se o payload não o mandar', () => {
    const cur = state();
    const incoming = JSON.parse(JSON.stringify(cur));
    incoming.customEx = [];
    assert.equal(S.checkRoutineFields(incoming, cur), null);
  });
});

/* ---------------------------------------------------------------- identidade */

describe('readActor', () => {
  const uid = 'u1';
  const body = '{"a":1}';
  const sign = (actor, t, key) => {
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const canon = `${t}\nPUT\n/api/data\n${uid}\n${hash}`;
    return `t=${t}; v1=${crypto.createHmac('sha256', key).update(canon).digest('hex')}`;
  };
  const req = headers => ({ headers });

  test('sem header: actor null e verified none (é o PWA antigo)', () => {
    assert.deepEqual(S.readActor(req({}), uid, body, 'PUT', '/api/data'), { actor: null, verified: 'none' });
  });
  test('header sem assinatura: é ALEGAÇÃO, não identidade', () => {
    const a = S.readActor(req({ 'x-og-actor': 'agent=hermes; tool=opengym_writer' }), uid, body, 'PUT', '/api/data');
    assert.equal(a.actor, 'hermes');
    assert.equal(a.verified, 'claimed');
  });
  test('assinatura válida: verified signature', () => {
    const key = S.agentKey();
    const t = Math.floor(Date.now() / 1000);
    const a = S.readActor(req({ 'x-og-actor': 'agent=hermes', 'x-og-actor-sig': sign('hermes', t, key) }),
      uid, body, 'PUT', '/api/data');
    assert.equal(a.verified, 'signature');
  });
  test('relógio fora de ±300s e corpo alterado: BAD_ACTOR_SIG', () => {
    const key = S.agentKey();
    const old = Math.floor(Date.now() / 1000) - 4000;
    assert.equal(S.readActor(req({ 'x-og-actor': 'agent=hermes', 'x-og-actor-sig': sign('hermes', old, key) }),
      uid, body, 'PUT', '/api/data').err, 'BAD_ACTOR_SIG');
    const t = Math.floor(Date.now() / 1000);
    assert.equal(S.readActor(req({ 'x-og-actor': 'agent=hermes', 'x-og-actor-sig': sign('hermes', t, key) }),
      uid, '{"a":2}', 'PUT', '/api/data').err, 'BAD_ACTOR_SIG');
  });
  test('nome de ator absurdo vira unknown (não quebra)', () => {
    assert.equal(S.readActor(req({ 'x-og-actor': 'agent=   ' }), uid, body, 'PUT', '/api/data').actor, 'unknown');
  });
  test('agent.key é criado com 64 hex e regenerado se corrompido', () => {
    const k1 = S.agentKey();
    assert.match(k1, /^[0-9a-f]{64}$/);
    const f = path.join(TMP, 'agent.key');
    assert.equal(fs.readFileSync(f, 'utf8').trim(), k1);
    fs.writeFileSync(f, 'lixo');
    assert.match(S.agentKey(), /^[0-9a-f]{64}$/);
  });
});

/* ---------------------------------------------------------------- auditoria */

describe('auditoria', () => {
  test('hash-chain encadeia e readAudit filtra por uid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-audit-'));
    R.appendAudit(dir, { uid: 'a', action: 'put-state', otp: '1' });
    R.appendAudit(dir, { uid: 'b', action: 'patch-routine', otp: '2' });
    R.appendAudit(dir, { uid: 'a', action: 'delete-routine', otp: '3' });
    const lines = fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines[0].prev, null);
    assert.equal(lines[1].prev, lines[0].h);
    assert.equal(lines[2].prev, lines[1].h);
    const { entries, chainIntact } = R.readAudit(dir, 'a', 10);
    assert.equal(chainIntact, true);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map(e => e.otp), ['3', '1']);   // mais recente primeiro
  });
  test('chainIntact false quando a primeira linha tem prev (houve corte)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-audit2-'));
    R.appendAudit(dir, { uid: 'a', action: 'x' });
    R.appendAudit(dir, { uid: 'a', action: 'y' });
    const f = path.join(dir, 'audit.jsonl');
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    fs.writeFileSync(f, lines[1] + '\n');                    // simula rotação/truncamento
    assert.equal(R.readAudit(dir, 'a', 10).chainIntact, false);
  });
});

/* ---------------------------------------------------------------- roteador */

describe('matchRoute', () => {
  test('rota exata continua funcionando', () => {
    const hit = S.matchRoute('GET', '/api/data');
    assert.ok(hit);
    assert.equal(typeof hit.handler, 'function');
    assert.deepEqual(hit.params, []);
  });
  test('matchRoute encontra os handlers de rotina (patchRoutine/deleteRoutine)', () => {
    for (const m of ['PATCH', 'DELETE']) {
      const hit = S.matchRoute(m, '/api/routines/r_upper_C_20260829');
      assert.ok(hit, `${m} deveria casar`);
      assert.equal(typeof hit.handler, 'function', `${m} sem handler registrado`);
      assert.deepEqual(hit.params, ['r_upper_C_20260829']);
    }
  });
  test('id com caractere inválido não casa (404, não execução)', () => {
    assert.equal(S.matchRoute('PATCH', '/api/routines/r%20upper'), null);
    assert.equal(S.matchRoute('GET', '/api/routines/r_upper'), null);   // GET /:id não existe
  });
});

/* ---------------------------------------------------------------- contrato com o cliente */

describe('contrato (fixtures)', () => {
  const fixtures = JSON.parse(fs.readFileSync(new URL('./routines.fixtures.json', import.meta.url), 'utf8'));
  for (const c of fixtures.accepted) {
    test(`aceito: ${c.label}`, () => {
      assert.equal(R.validateExEntry(c.entry, { catalog: CATALOG_MAP, custom, where: 'ex', legacy: c.legacy || {} }), null);
    });
  }
  for (const c of fixtures.rejected) {
    test(`recusado (${c.code}): ${c.label}`, () => {
      const r = R.validateExEntry(c.entry, { catalog: CATALOG_MAP, custom, where: 'ex', legacy: c.legacy || {} });
      assert.equal(r?.code, c.code);
    });
  }
  test('o que o cliente novo serializa passa pelo PUT', () => {
    for (const st of fixtures.states) assert.equal(S.checkRoutineFields(st.incoming, st.current), null);
  });
});

// Nota: a verificação por HTTP (rotas, sessão, If-Match, catálogo) é feita contra o servidor
// REAL pelo script de deploy (deploy-api.sh), com o mesmo cliente node:http. Um harness de
// servidor em processo dentro do `node --test` mostrou-se instável (a sessão não validava apenas
// nesse contexto), e o valor de testá-lo ali era menor do que o de testá-lo no container de
// produção — onde o defeito "catálogo procurado em /data" realmente apareceu.

after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
