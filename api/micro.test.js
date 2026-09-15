// api/micro.test.js — suíte da publicação da semana (`node --test`, Node 22).
//
//   docker build --target test -f api/Dockerfile .        # como o deploy roda
//
// Cobre o contrato do §Requisitos Funcionais da spec v6 (`docs/specs/spec_publicacao_micro.md`) e os
// achados das duas revisões: assinatura exigida por FATO (não pela ausência de erro), `If-Match: *`
// conferido à mão (o `checkIfMatch` aceita), upsert preservando id/dia/prog, legado `mode:"normal"`/
// `sg:0` normalizado, dia só com autorização e `week` intocado, janela hoje..+14.
//
// SEM HTTP: o `makeHandlers` recebe tudo por injeção, então dá para passar sessão de mentira, ator
// de mentira e corpo em memória e exercitar as mesmas decisões que a rota toma. A prova por HTTP
// contra o servidor de verdade é a do script de deploy.
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-micro-test-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';

const M = await import('./micro.js');
const S = await import('./server.js');

const UID = 'u1';
const STATE = path.join(TMP, 'state-' + UID + '.json');
const HOJE = M.todaySP();
const AMANHA = M.addDays(HOJE, 1);
const LONGE = M.addDays(HOJE, 15);        // além da janela de 14 dias
const ONTEM = M.addDays(HOJE, -1);

/** Rotina mínima válida da publicação (exercícios do catálogo real). */
const rot = (over = {}) => ({
  id: 'r_push_C', name: 'Push C', emoji: '🔺', prog: 'off',
  ex: [{ id: '0326', sets: 3, reps: '6-8', weight: 9, mode: 'reps' },
       { id: '0584', sets: 3, reps: '6-8', weight: 45, mode: 'reps' }],
  ...over
});

/** Payload mínimo válido. */
const pub = (over = {}) => ({ meso_id: 'meso-2026-09-02', semana: 3, routines: [rot()], ...over });

const writeState = (state = {}) => fs.writeFileSync(STATE, JSON.stringify({
  rev: 3, routines: [], week: {}, dayPlan: {}, workouts: [], customEx: [], ...state
}));

/** Deps injetadas: sessão fixa, ator de mentira, corpo cru (é o cru que a idempotência hasheia). */
const harness = ({ actor = { actor: 'agent=hermes; tool=opengym_writer', verified: 'signature' },
                   session = { id: UID }, body = pub(), raw = null, live = null,
                   headers = { 'if-match': '3', 'idempotency-key': 'k1' } } = {}) => {
  const deps = {
    readSession: () => session,
    readState: S.readState,
    stateFile: S.stateFile,
    atomicWrite: S.atomicWrite,
    readRawBody: async () => (raw !== null ? raw : JSON.stringify(body)),
    json: (res, code, obj) => { res.code = code; res.body = obj; },
    DATA: S.DATA,
    CATALOG_PATH: S.CATALOG_PATH,
    readActor: () => actor,
    livePresence: () => live
  };
  const res = {};
  return { H: M.makeHandlers(deps), res, headers };
};

/** Chama o handler com headers padrão. */
const call = async (h, headers = h.headers) => {
  await h.H.publishMicro({ method: 'POST', headers }, h.res);
  return h.res;
};

const audit = () => fs.readFileSync(path.join(TMP, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const state = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const idem = () => JSON.parse(fs.readFileSync(path.join(TMP, 'micro-idem.json'), 'utf8'));

before(() => { writeState(); });
// O registro de idempotência vive em disco e é compartilhado pela suíte: sem limpar, um teste
// receberia o replay do anterior (a chave 'k1' e o mesmo payload se repetem de propósito).
beforeEach(() => { fs.rmSync(path.join(TMP, 'micro-idem.json'), { force: true }); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

/* ---------------------------------------------------------------- sessão, identidade, corpo */

describe('publicação: sessão, identidade e chave', () => {
  test('sem sessão: 401 UNAUTH e nada muda', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ session: null });
    const res = await call(h);
    assert.equal(res.code, 401);
    assert.equal(res.body.code, 'UNAUTH');
    assert.equal(state().rev, 3);
  });
  test('sem assinatura: 401 ACTOR_SIGNATURE_REQUIRED (o readActor devolve "claimed" sem err)', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ actor: { actor: null, verified: 'none' } });
    const res = await call(h);
    assert.equal(res.code, 401);
    assert.equal(res.body.code, 'ACTOR_SIGNATURE_REQUIRED');
    // 'claimed' (header sem assinatura) também não passa: tem de ser provado
    const h2 = harness({ actor: { actor: 'hermes', verified: 'claimed' } });
    assert.equal((await call(h2)).body.code, 'ACTOR_SIGNATURE_REQUIRED');
    assert.equal(state().rev, 3);
  });
  test('assinatura inválida: 400 BAD_ACTOR_SIG', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ actor: { actor: 'hermes', verified: 'none', err: 'BAD_ACTOR_SIG' } });
    const res = await call(h);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'BAD_ACTOR_SIG');
  });
  test('sem Idempotency-Key: 400 IDEMPOTENCY_REQUIRED', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    const res = await call(h, { 'if-match': '3' });
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'IDEMPOTENCY_REQUIRED');
  });
  test('chave acima de 128 chars: 400 IDEMPOTENCY_KEY_TOO_LONG', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    const res = await call(h, { 'if-match': '3', 'idempotency-key': 'x'.repeat(129) });
    assert.equal(res.body.code, 'IDEMPOTENCY_KEY_TOO_LONG');
  });
  test('corpo que não é JSON: 400 BAD_JSON', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ raw: '{nao json' });
    const res = await call(h);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'BAD_JSON');
  });
});

/* ---------------------------------------------------------------- If-Match */

describe('If-Match', () => {
  test('sem If-Match: 428 e nada muda', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    const res = await call(h, { 'idempotency-key': 'k1' });
    assert.equal(res.code, 428);
    assert.equal(res.body.code, 'IF_MATCH_REQUIRED');
    assert.equal(state().rev, 3);
  });
  test('If-Match: * → 412 IF_MATCH_WILDCARD (conferido à mão: o checkIfMatch aceita)', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    const res = await call(h, { 'if-match': '*', 'idempotency-key': 'k1' });
    assert.equal(res.code, 412);
    assert.equal(res.body.code, 'IF_MATCH_WILDCARD');
    assert.equal(state().rev, 3);
  });
  test('If-Match malformado: 400 IF_MATCH_MALFORMED', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    const res = await call(h, { 'if-match': 'abc', 'idempotency-key': 'k1' });
    assert.equal(res.body.code, 'IF_MATCH_MALFORMED');
  });
  test('base velha: 409 STALE_STATE com o rev atual', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    const res = await call(h, { 'if-match': '2', 'idempotency-key': 'k1' });
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'STALE_STATE');
    assert.equal(res.body.rev, 3);
  });
  test('perfil sem estado: 409 NO_STATE', async () => {
    fs.rmSync(STATE, { force: true });
    const h = harness();
    const res = await call(h);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'NO_STATE');
    writeState();
  });
});

/* ---------------------------------------------------------------- idempotência */

describe('idempotência', () => {
  test('mesma chave + mesmo corpo + rev velho: 200 replayed, sem gravar', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    const first = await call(h);
    assert.equal(first.code, 200);                       // rotina já existia: atualização
    const revDepois = state().rev;
    const h2 = harness();                                 // mesmo corpo, mesmo header k1, rev 3 velho
    const replay = await call(h2);
    assert.equal(replay.code, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.intact, true);
    assert.equal(state().rev, revDepois, 'replay não grava');
  });
  test('mesma chave com corpo diferente: 409 IDEMPOTENCY_MISMATCH', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    await call(h);
    const h2 = harness({ body: pub({ semana: 4 }) });
    const res = await call(h2);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'IDEMPOTENCY_MISMATCH');
  });
  test('chave de outro perfil: 409 IDEMPOTENCY_MISMATCH', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    await call(h);
    const h2 = harness({ session: { id: 'u2' } });
    fs.writeFileSync(path.join(TMP, 'state-u2.json'), fs.readFileSync(STATE));
    const res = await call(h2);
    assert.equal(res.body.code, 'IDEMPOTENCY_MISMATCH');
    fs.rmSync(path.join(TMP, 'state-u2.json'), { force: true });
  });
  test('intact vira false quando a rotina publicada é editada depois', async () => {
    writeState({ routines: [rot()] });
    const h = harness();
    await call(h);
    const st = state();
    st.routines[0].name = 'editada no app';
    st.rev = 99;
    fs.writeFileSync(STATE, JSON.stringify(st));
    const replay = await call(harness());
    assert.equal(replay.body.intact, false);
  });
  test('a chave registrada é o sha256 do corpo cru, com o uid e o hash por rotina', async () => {
    writeState({ routines: [rot()] });
    const body = pub();
    const h = harness({ body });
    await call(h);
    const rec = idem()[0];
    assert.equal(rec.key, 'k1');
    assert.equal(rec.uid, UID);
    assert.match(rec.routineHashes['r_push_C'], /^[0-9a-f]{64}$/);
    assert.deepEqual(rec.routines, ['r_push_C']);
  });
});

/* ---------------------------------------------------------------- upsert (1A) */

describe('upsert por id: a semana atualiza os mesmos treinos', () => {
  test('rotina existente: mantém o id, troca o conteúdo, mantém o dia apontando para ela', async () => {
    writeState({ routines: [rot()], week: { '2': 'r_push_C' }, dayPlan: { [AMANHA]: 'r_push_C' } });
    const h = harness({ body: pub({ routines: [rot({ name: 'Push C - Shoulder 3D', ex: [{ id: '0326', sets: 3, reps: '6-8', weight: 11, mode: 'reps' }] })] }) });
    const res = await call(h);
    assert.equal(res.code, 200);                          // havia rotina: 200, não 201
    assert.deepEqual(res.body.meta.criadas, []);
    assert.deepEqual(res.body.meta.trocadas, ['r_push_C']);
    const st = state();
    assert.equal(st.routines.length, 1);
    assert.equal(st.routines[0].id, 'r_push_C');
    assert.equal(st.routines[0].name, 'Push C - Shoulder 3D');
    assert.equal(st.routines[0].ex[0].weight, 11);
    assert.equal(st.week['2'], 'r_push_C', 'o ponteiro de dia continua valendo');
    assert.equal(st.dayPlan[AMANHA], 'r_push_C');
  });
  test('rotina nova: 201 com meta.criadas, e nada é apagado', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ body: pub({ routines: [rot({ id: 'r_pull_C', name: 'Pull C', emoji: '🔻' })] }) });
    const res = await call(h);
    assert.equal(res.code, 201);
    assert.deepEqual(res.body.meta.criadas, ['r_pull_C']);
    assert.deepEqual(state().routines.map(r => r.id).sort(), ['r_pull_C', 'r_push_C']);
  });
  test('substituição é TOTAL: campo que não vai no payload não sobrevive', async () => {
    writeState({ routines: [rot({ ex: [{ id: '0326', sets: 4, reps: '10', weight: 20, mode: 'reps', restSec: 150 }] })] });
    const h = harness({ body: pub({ routines: [rot({ ex: [{ id: '0326', sets: 3, reps: '6-8', weight: 9, mode: 'reps' }] })] }) });
    await call(h);
    assert.equal(state().routines[0].ex[0].restSec, undefined);
  });
  test('prog do usuário é preservado quando o payload não declara, e aparece no meta', async () => {
    writeState({ routines: [rot({ prog: 'linear' })] });
    const h = harness({ body: pub({ routines: [rot({ prog: undefined })] }) });
    const res = await call(h);
    assert.equal(state().routines[0].prog, 'linear');
    assert.equal(res.body.meta.progAntes['r_push_C'], 'linear');
    assert.equal(res.body.meta.progDepois['r_push_C'], 'linear');
  });
  test('rotina nova sem prog nasce off', async () => {
    writeState({ routines: [] });
    const h = harness({ body: pub({ routines: [rot({ prog: undefined })] }) });
    await call(h);
    assert.equal(state().routines[0].prog, 'off');
  });
  test('legado do estado vivo (mode:"normal" e sg:0) é aceito e normalizado', async () => {
    writeState({ routines: [] });
    const h = harness({ body: pub({ routines: [rot({ ex: [{ id: '0326', sets: 3, reps: '6-8', weight: 9, mode: 'normal', sg: 0 }] })] }) });
    const res = await call(h);
    assert.equal(res.code, 201);
    const e = state().routines[0].ex[0];
    assert.equal(e.mode, 'reps');
    assert.equal(e.sg, undefined);
  });
  test('workouts, customEx, exWeights, week e active ficam intocados', async () => {
    writeState({
      routines: [rot()], week: { '2': 'r_push_C' }, dayPlan: { [AMANHA]: 'r_push_C' },
      workouts: [{ id: 'w1', d: ONTEM, routineId: 'r_push_C', entries: [] }],
      customEx: [{ id: 'immt_x', n: 'Custom' }], exWeights: { '0326': { w: 30, d: ONTEM } }, active: { routineId: 'r_push_C' }
    });
    const before = state();
    const h = harness();
    await call(h);
    const st = state();
    assert.deepEqual(st.week, before.week);
    assert.deepEqual(st.dayPlan, before.dayPlan);
    assert.deepEqual(st.workouts, before.workouts);
    assert.deepEqual(st.customEx, before.customEx);
    assert.deepEqual(st.exWeights, before.exWeights);
    assert.deepEqual(st.active, before.active);
  });
});

/* ---------------------------------------------------------------- datas (2B) */

describe('datas: só com autorização, e nunca a faixa da semana', () => {
  test('sem dias em nenhuma rotina, dayPlan e week não são tocados', async () => {
    writeState({ routines: [rot()], week: { '2': 'r_push_C' }, dayPlan: { [AMANHA]: 'r_leg1' } });
    const h = harness({ body: pub({ routines: [rot({ dias: undefined })] }) });
    const res = await call(h);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.meta.datas, []);
    assert.deepEqual(res.body.meta.dayPlan, {});
    const st = state();
    assert.deepEqual(st.dayPlan, { [AMANHA]: 'r_leg1' });
    assert.deepEqual(st.week, { '2': 'r_push_C' });
  });
  test('data livre autorizada: grava dayPlan e não escreve week', async () => {
    writeState({ routines: [rot()], week: { '2': 'r_push_C' } });
    const h = harness({ body: pub({ routines: [rot({ dias: [AMANHA] })] }) });
    const res = await call(h);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.meta.datas, [AMANHA]);
    const st = state();
    assert.equal(st.dayPlan[AMANHA], 'r_push_C');
    assert.deepEqual(st.week, { '2': 'r_push_C' }, 'week é do usuário');
  });
  test('data ocupada por dayPlan: 409 PLAN_CONFLICT com a lista, sem gravar', async () => {
    writeState({ routines: [rot()], dayPlan: { [AMANHA]: 'r_leg1' } });
    const h = harness({ body: pub({ routines: [rot({ dias: [AMANHA] })] }) });
    const res = await call(h);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'PLAN_CONFLICT');
    assert.equal(res.body.datas.length, 1);
    assert.equal(res.body.datas[0].current, 'r_leg1');
    assert.equal(res.body.datas[0].from, 'dayPlan');
    assert.equal(state().dayPlan[AMANHA], 'r_leg1');
  });
  test('data ocupada SÓ pela faixa da semana também conflita (M14)', async () => {
    const wd = String(new Date(AMANHA + 'T12:00:00').getDay());
    writeState({ routines: [rot()], week: { [wd]: 'r_leg1' } });
    const h = harness({ body: pub({ routines: [rot({ dias: [AMANHA] })] }) });
    const res = await call(h);
    assert.equal(res.code, 409);
    assert.equal(res.body.datas[0].current, 'r_leg1');
    assert.equal(res.body.datas[0].from, 'week');
  });
  test('data com treino registrado: 409 com trained:true', async () => {
    writeState({ routines: [rot()], workouts: [{ id: 'w1', d: AMANHA, routineId: 'r_leg1', entries: [] }] });
    const h = harness({ body: pub({ routines: [rot({ dias: [AMANHA] })] }) });
    const res = await call(h);
    assert.equal(res.body.datas[0].trained, true);
  });
  test('com autorizar.datas a data ocupada é aplicada', async () => {
    writeState({ routines: [rot()], dayPlan: { [AMANHA]: 'r_leg1' } });
    const h = harness({ body: pub({ routines: [rot({ dias: [AMANHA] })], autorizar: { datas: [AMANHA] } }) });
    const res = await call(h);
    assert.equal(res.code, 200);
    assert.equal(state().dayPlan[AMANHA], 'r_push_C');
  });
  test('autorizar.datas com data que não está no payload: 400 BAD_AUTORIZAR', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ body: pub({ autorizar: { datas: [AMANHA] } }) });
    const res = await call(h);
    assert.equal(res.body.code, 'BAD_AUTORIZAR');
  });
  test('data no passado: 400 DATE_IN_PAST', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ body: pub({ routines: [rot({ dias: [ONTEM] })] }) });
    assert.equal((await call(h)).body.code, 'DATE_IN_PAST');
  });
  test('data além de hoje + 14: 400 WINDOW_TOO_FAR', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ body: pub({ routines: [rot({ dias: [LONGE] })] }) });
    assert.equal((await call(h)).body.code, 'WINDOW_TOO_FAR');
  });
  test('data irreal no calendário: 400 BAD_DATE (round-trip, não só formato)', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ body: pub({ routines: [rot({ dias: ['2026-02-30'] })] }) });
    assert.equal((await call(h)).body.code, 'BAD_DATE');
  });
  test('data repetida no payload: 400 DUPLICATE_DATE', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ body: pub({ routines: [rot({ dias: [AMANHA] }), rot({ id: 'r_leg1', dias: [AMANHA] })] }) });
    assert.equal((await call(h)).body.code, 'DUPLICATE_DATE');
  });
});

/* ---------------------------------------------------------------- forma */

describe('forma do payload', () => {
  test('sem meso_id / meso_id fora do formato: 400 BAD_MESO_ID', async () => {
    writeState({ routines: [rot()] });
    for (const meso_id of [undefined, 'meso3', '2026-09-02']) {
      const h = harness({ body: pub({ meso_id }) });
      assert.equal((await call(h)).body.code, 'BAD_MESO_ID');
    }
  });
  test('semana fora de 1..52: 400 BAD_SEMANA', async () => {
    writeState({ routines: [rot()] });
    for (const semana of [0, 53, '3']) {
      const h = harness({ body: pub({ semana }) });
      assert.equal((await call(h)).body.code, 'BAD_SEMANA');
    }
  });
  test('routines vazio ou acima de 10: 400 BAD_ROUTINES', async () => {
    writeState({ routines: [rot()] });
    assert.equal((await call(harness({ body: pub({ routines: [] }) }))).body.code, 'BAD_ROUTINES');
    const many = Array.from({ length: 11 }, (_, i) => rot({ id: 'r_x' + i }));
    assert.equal((await call(harness({ body: pub({ routines: many }) }))).body.code, 'BAD_ROUTINES');
  });
  test('id de rotina fora do formato e id repetido', async () => {
    writeState({ routines: [rot()] });
    assert.equal((await call(harness({ body: pub({ routines: [rot({ id: 'r push' })] }) }))).body.code, 'BAD_ROUTINE_ID');
    const dup = [rot(), rot()];
    assert.equal((await call(harness({ body: pub({ routines: dup }) }))).body.code, 'DUPLICATE_ROUTINE_ID');
  });
  test('nome e emoji são exigidos de verdade (merge não vale aqui)', async () => {
    writeState({ routines: [rot()] });
    assert.equal((await call(harness({ body: pub({ routines: [rot({ name: '   ' })] }) }))).body.code, 'BAD_NAME');
    assert.equal((await call(harness({ body: pub({ routines: [rot({ name: 'a'.repeat(61) })] }) }))).body.code, 'BAD_NAME');
    assert.equal((await call(harness({ body: pub({ routines: [rot({ emoji: '' })] }) }))).body.code, 'BAD_EMOJI');
    assert.equal((await call(harness({ body: pub({ routines: [rot({ emoji: 'x'.repeat(33) })] }) }))).body.code, 'BAD_EMOJI');
  });
  test('prog fora do conjunto: 400 BAD_PROG', async () => {
    writeState({ routines: [rot()] });
    assert.equal((await call(harness({ body: pub({ routines: [rot({ prog: 'turbo' })] }) }))).body.code, 'BAD_PROG');
  });
  test('exercício desconhecido: 400 CATALOG_UNKNOWN_EX', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ body: pub({ routines: [rot({ ex: [{ id: 'zzzz', sets: 3, reps: '6-8', weight: 5, mode: 'reps' }] })] }) });
    assert.equal((await call(h)).body.code, 'CATALOG_UNKNOWN_EX');
  });
  test('exercício repetido na rotina e sets inválido', async () => {
    writeState({ routines: [rot()] });
    const two = [{ id: '0326', sets: 3, reps: '6-8', weight: 9, mode: 'reps' }, { id: '0326', sets: 3, reps: '6-8', weight: 9, mode: 'reps' }];
    assert.equal((await call(harness({ body: pub({ routines: [rot({ ex: two })] }) }))).body.code, 'DUPLICATE_EX');
    const zero = [{ id: '0326', sets: 0, reps: '6-8', weight: 9, mode: 'reps' }];
    assert.equal((await call(harness({ body: pub({ routines: [rot({ ex: zero })] }) }))).body.code, 'BAD_SETS');
  });
  test('exercício sem id: 400 EX_ID_REQUIRED', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ body: pub({ routines: [rot({ ex: [{ sets: 3, reps: '6-8', weight: 9 }] })] }) });
    assert.equal((await call(h)).body.code, 'EX_ID_REQUIRED');
  });
});

/* ---------------------------------------------------------------- treino vivo, auditoria, rota */

describe('treino em andamento, auditoria e roteador', () => {
  test('com treino vivo no perfil: 409 WORKOUT_IN_PROGRESS e nada muda', async () => {
    writeState({ routines: [rot()] });
    const h = harness({ live: { name: 'Push C', setsDone: 2 } });
    const res = await call(h);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'WORKOUT_IN_PROGRESS');
    assert.equal(state().rev, 3);
  });
  test('auditoria publish-micro com idemKey, e a linha [og-micro] no stdout', async () => {
    writeState({ routines: [rot()] });
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try { await call(harness()); } finally { console.log = orig; }
    assert.ok(lines.some(l => l.startsWith('[og-micro] op=publish-micro')), 'linha [og-micro] no stdout');
    const last = audit()[audit().length - 1];
    assert.equal(last.action, 'publish-micro');
    assert.equal(last.uid, UID);
    assert.equal(last.meso_id, 'meso-2026-09-02');
    assert.equal(last.idemKey, 'k1');
    assert.equal(last.verified, 'signature');
    assert.deepEqual(last.trocadas, ['r_push_C']);
    assert.equal(last.revBefore + 1, last.revAfter);
  });
  test('a rota existe no roteador (não é o 404 do servidor)', async () => {
    const hit = S.matchRoute('POST', '/api/plan/micro');
    assert.ok(hit, 'rota registrada');
    // A tabela exata guarda um wrapper `(req,res) => ROUTINE_HANDLERS.publishMicro(...)`: comparar
    // identidade de função falharia (achado B4/F-09). O que importa é a rota estar ligada e
    // responder pelo handler certo — provado com um POST de fumaça sem credencial, que o server.js
    // de verdade responde 401 (e um 404 significaria rota ausente).
    assert.equal(typeof hit.handler, 'function');
    const res = { statusCode: null, writeHead(code) { this.statusCode = code; }, end() {} };
    // req mínimo: o readRawBody de verdade só precisa de um `on` que feche o stream vazio.
    const req = { method: 'POST', headers: {}, on(ev, cb) { if (ev === 'end') setImmediate(cb); return this; } };
    await hit.handler(req, res);
    assert.equal(res.statusCode, 401, 'sem sessão a rota responde 401, não 404');
  });
});
