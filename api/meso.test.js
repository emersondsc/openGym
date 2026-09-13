// api/meso.test.js — suíte do mesociclo (`node --test`, Node 22).
//
//   docker build --target test -f api/Dockerfile .        # como o deploy roda
//   node --test api/meso.test.js                          # se houver node no PATH
//
// Cobre o núcleo (a tabela do §6 da spec_meso_no_app), os tetos do `checkState`, e os handlers
// de ponta a ponta SEM HTTP: o `makeHandlers` recebe tudo por injeção, então dá para passar uma
// sessão de mentira e um corpo em memória e exercitar as mesmas decisões que a rota toma
// (If-Match antes da forma, 201/200, ativação, preservação de campo desconhecido, auditoria).
//
// A verificação por HTTP contra o servidor de verdade (cookie de sessão, nginx, container) é a
// do script de deploy — mesmo critério do api/routines.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-meso-test-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';

const M = await import('./meso.js');
const S = await import('./server.js');

const UID = 'u1';
const STATE = path.join(TMP, 'state-' + UID + '.json');

const week = (n, extra = {}) => ({ n, start: `2026-09-0${n}`, end: `2026-09-0${n}`, phase: 'progressão', ...extra });

/** Mesociclo mínimo válido, com os campos que o teste quer mexer. */
const mesoOk = (over = {}) => ({
  id: 'meso-2026-09-01',
  name: 'Mesociclo 3',
  start: '2026-09-01',
  end: '2026-09-07',
  weeks: [week(1)],
  ...over
});

const writeState = (state = {}) => fs.writeFileSync(STATE, JSON.stringify({
  rev: 3, routines: [], week: {}, dayPlan: {}, workouts: [], customEx: [], mesos: [], ...state
}));

/** Deps injetadas: sessão fixa, corpo em memória, `json` que só anota a resposta. */
const harness = ({ actor = { actor: 'agent=hermes; tool=opengym_writer', verified: 'signature' },
                   session = { id: UID }, body = {}, headers = { 'if-match': '3' }, raw = null } = {}) => {
  const deps = {
    readSession: () => session,
    readState: S.readState,
    stateFile: S.stateFile,
    atomicWrite: S.atomicWrite,
    readRawBody: async () => (raw !== null ? raw : Buffer.from(JSON.stringify(body))),
    json: (res, code, obj) => { res.code = code; res.body = obj; },
    DATA: S.DATA,
    readActor: () => actor
  };
  const res = {};
  return { H: M.makeHandlers(deps), res };
};

before(() => { writeState(); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

/* ---------------------------------------------------------------- núcleo */

describe('validateMesoBody (a tabela do §6)', () => {
  test('mesociclo mínimo passa', () => {
    assert.equal(M.validateMesoBody(mesoOk()), null);
  });
  test('sem meso', () => {
    assert.equal(M.validateMesoBody(null)?.code, 'MESO_REQUIRED');
    assert.equal(M.validateMesoBody([])?.code, 'MESO_REQUIRED');
  });
  test('id fora do formato', () => {
    assert.equal(M.validateMesoBody(mesoOk({ id: 'meso3' }))?.code, 'BAD_MESO_ID');
    assert.equal(M.validateMesoBody(mesoOk({ id: 'meso-26-09-01' }))?.code, 'BAD_MESO_ID');
  });
  test('nome vazio e nome com 121 caracteres', () => {
    assert.equal(M.validateMesoBody(mesoOk({ name: '   ' }))?.code, 'BAD_MESO_NAME');
    assert.equal(M.validateMesoBody(mesoOk({ name: 'a'.repeat(121) }))?.code, 'BAD_MESO_NAME');
    assert.equal(M.validateMesoBody(mesoOk({ name: 'a'.repeat(120) })), null);
  });
  test('data que não existe no calendário', () => {
    assert.equal(M.validateMesoBody(mesoOk({ start: '2026-02-30' }))?.code, 'BAD_MESO_START');
    assert.equal(M.validateMesoBody(mesoOk({ start: '2026-13-01' }))?.code, 'BAD_MESO_START');
    assert.equal(M.validateMesoBody(mesoOk({ start: '01/09/2026' }))?.code, 'BAD_MESO_START');
  });
  test('end antes de start', () => {
    assert.equal(M.validateMesoBody(mesoOk({ end: '2026-08-31' }))?.code, 'BAD_MESO_END');
  });
  test('origin fora do conjunto', () => {
    assert.equal(M.validateMesoBody(mesoOk({ origin: 'coach' }))?.code, 'BAD_MESO_ORIGIN');
    assert.equal(M.validateMesoBody(mesoOk({ origin: 'assistant' })), null);
  });
  test('goal com 401 caracteres', () => {
    assert.equal(M.validateMesoBody(mesoOk({ goal: 'g'.repeat(401) }))?.code, 'BAD_MESO_GOAL');
    assert.equal(M.validateMesoBody(mesoOk({ goal: 'g'.repeat(400) })), null);
  });
  test('semanas: vazio, 53 itens, n fora de ordem e n repetido', () => {
    assert.equal(M.validateMesoBody(mesoOk({ weeks: [] }))?.code, 'BAD_MESO_WEEKS');
    assert.equal(M.validateMesoBody(mesoOk({ weeks: Array.from({ length: 53 }, (_, i) => week(i + 1)) }))?.code, 'BAD_MESO_WEEKS');
    assert.equal(M.validateMesoBody(mesoOk({ weeks: [{ n: 2, start: '2026-09-01', end: '2026-09-02' }] }))?.code, 'BAD_MESO_WEEK_N');
    assert.equal(M.validateMesoBody(mesoOk({ weeks: [week(1), week(1, { start: '2026-09-02', end: '2026-09-08' })] }))?.code, 'BAD_MESO_WEEK_N');
  });
  test('semana com fim antes do início, fora do mesociclo e fora de ordem', () => {
    assert.equal(M.validateMesoBody(mesoOk({ weeks: [{ n: 1, start: '2026-09-05', end: '2026-09-02' }] }))?.code, 'BAD_MESO_WEEK_DATE');
    assert.equal(M.validateMesoBody(mesoOk({ weeks: [{ n: 1, start: '2026-08-30', end: '2026-09-02' }] }))?.code, 'BAD_MESO_WEEK_RANGE');
    assert.equal(M.validateMesoBody(mesoOk({ end: '2026-09-10', weeks: [{ n: 1, start: '2026-09-01', end: '2026-09-11' }] }))?.code, 'BAD_MESO_WEEK_RANGE');
    assert.equal(M.validateMesoBody(mesoOk({
      end: '2026-09-20',
      weeks: [{ n: 1, start: '2026-09-08', end: '2026-09-14' }, { n: 2, start: '2026-09-01', end: '2026-09-07' }]
    }))?.code, 'BAD_MESO_WEEK_ORDER');
  });
  test('fase com 81 caracteres (o dado real tem 41)', () => {
    assert.equal(M.validateMesoBody(mesoOk({ weeks: [week(1, { phase: 'p'.repeat(81) })] }))?.code, 'BAD_MESO_PHASE');
    assert.equal(M.validateMesoBody(mesoOk({ weeks: [week(1, { phase: 'progressão leve (+2,5% só se fechar tudo)' })] })), null);
  });
  test('regras: não-mapa, 41 itens, rótulo longo e valor longo', () => {
    assert.equal(M.validateMesoBody(mesoOk({ rules: [] }))?.code, 'BAD_MESO_RULES');
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => ['r' + i, 'v']));
    assert.equal(M.validateMesoBody(mesoOk({ rules: many }))?.code, 'BAD_MESO_RULES');
    assert.equal(M.validateMesoBody(mesoOk({ rules: { ['k'.repeat(41)]: 'v' } }))?.code, 'BAD_MESO_RULES');
    assert.equal(M.validateMesoBody(mesoOk({ rules: { 'Reps alvo': 'v'.repeat(601) } }))?.code, 'BAD_MESO_RULES');
    assert.equal(M.validateMesoBody(mesoOk({ rules: { 'Reps alvo': '6-8' } })), null);
  });
  test('log: não-lista e 201 itens', () => {
    assert.equal(M.validateMesoBody(mesoOk({ log: 'nada' }))?.code, 'BAD_MESO_LOG');
    assert.equal(M.validateMesoBody(mesoOk({ log: Array.from({ length: 201 }, () => ({ date: '2026-09-01', text: 'x' })) }))?.code, 'BAD_MESO_LOG');
  });
  test('campo desconhecido não é recusado (o objeto é preservado como veio)', () => {
    const rich = mesoOk({
      cargas_prescritas: { 'Push Ter': 'Desenv 114' },
      weeks: [week(1, { nota_do_coach: 'testando execução' })]
    });
    assert.equal(M.validateMesoBody(rich), null);
  });
});

describe('checkMesos (a régua tolerante do PUT /api/data)', () => {
  test('lista, teto de 40 e forma mínima', () => {
    assert.equal(M.checkMesos('nada'), 'mesos must be an array');
    assert.equal(M.checkMesos(Array.from({ length: 41 }, (_, i) => mesoOk({ id: 'meso-2026-09-' + String(i + 1).padStart(2, '0') }))), 'too many mesocycles');
    assert.equal(M.checkMesos([null]), 'mesocycle must be an object');
    assert.equal(M.checkMesos([{ id: 'x', weeks: [week(1)] }]), 'mesocycle.id must be meso-YYYY-MM-DD');
    assert.equal(M.checkMesos([{ id: 'meso-2026-09-01' }]), 'mesocycle.weeks required');
    assert.equal(M.checkMesos([{ ...mesoOk(), lixo: 'x'.repeat(70 * 1024) }]), 'mesocycle too large');
    assert.equal(M.checkMesos([mesoOk()]), null);
  });
  test('não valida a tabela inteira: um mesociclo feio mas com núcleo passa', () => {
    // É de propósito: um 400 aqui travaria treino, rotina e peso junto (a escrita ficaria presa).
    assert.equal(M.checkMesos([{ id: 'meso-2026-09-01', weeks: [{ n: 7 }], nome_errado: true }]), null);
  });
});

/* ---------------------------------------------------------------- handlers */

describe('putMeso', () => {
  test('sem sessão: 401', async () => {
    writeState();
    const { H, res } = harness({ session: null, body: { meso: mesoOk() } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 401);
  });
  test('assinatura inválida: 400', async () => {
    writeState();
    const { H, res } = harness({ actor: { err: 'BAD_ACTOR_SIG' }, body: { meso: mesoOk() } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'BAD_ACTOR_SIG');
  });
  test('sem If-Match: 428, mesmo com corpo inválido (a ordem importa)', async () => {
    writeState();
    const { H, res } = harness({ body: { meso: { id: 'lixo' } } });
    await H.putMeso({ method: 'PUT', headers: {} }, res);
    assert.equal(res.code, 428);
    assert.equal(res.body.code, 'IF_MATCH_REQUIRED');
  });
  test('base velha: 409 STALE_STATE', async () => {
    writeState({ rev: 9 });
    const { H, res } = harness({ body: { meso: mesoOk() } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'STALE_STATE');
    assert.equal(res.body.rev, 9);
  });
  test('perfil sem estado: 409 NO_STATE', async () => {
    fs.rmSync(STATE, { force: true });
    const { H, res } = harness({ body: { meso: mesoOk() } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'NO_STATE');
    writeState();
  });
  test('corpo inválido com If-Match certo: 400 com código e campo', async () => {
    writeState();
    const { H, res } = harness({ body: { meso: mesoOk({ id: 'meso3' }) } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'BAD_MESO_ID');
    assert.equal(res.body.field, 'id');
  });
  test('criação: 201, rev+1, e o mesociclo no estado', async () => {
    writeState();
    const { H, res } = harness({ body: { meso: mesoOk() } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 201);
    assert.equal(res.body.meta.created, true);
    assert.equal(res.body.meta.activated, false);
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    assert.equal(st.rev, 4);
    assert.equal(st.mesos.length, 1);
    assert.equal(st.mesos[0].id, 'meso-2026-09-01');
    assert.equal(st.activeMeso, undefined);
  });
  test('substituição: 200, overwrite total, sem duplicar', async () => {
    writeState({ mesos: [mesoOk()], activeMeso: 'meso-2026-09-01' });
    const { H, res } = harness({ body: { meso: mesoOk({ name: 'Renomeado' }) } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.meta.created, false);
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    assert.equal(st.mesos.length, 1);
    assert.equal(st.mesos[0].name, 'Renomeado');
    assert.equal(st.activeMeso, 'meso-2026-09-01', 'substituir não desativa');
  });
  test('campo desconhecido sobrevive ao PUT (no mesociclo, na semana e nas regras)', async () => {
    writeState();
    const rich = mesoOk({
      cargas_prescritas: { 'Push Ter': 'Desenv 114' },
      rules: { 'Reps alvo': '6-8' },
      weeks: [week(1, { nota_do_coach: 'testando execução' })]
    });
    const { H, res } = harness({ body: { meso: rich } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 201);
    const saved = JSON.parse(fs.readFileSync(STATE, 'utf8')).mesos[0];
    assert.deepEqual(saved.cargas_prescritas, { 'Push Ter': 'Desenv 114' });
    assert.equal(saved.weeks[0].nota_do_coach, 'testando execução');
    assert.deepEqual(saved.rules, { 'Reps alvo': '6-8' });
  });
  test('teto por mesociclo: 400 MESO_TOO_BIG', async () => {
    writeState();
    const { H, res } = harness({ body: { meso: mesoOk({ rules: { grande: 'x'.repeat(600) }, evidence: 'y'.repeat(70 * 1024) }) } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'MESO_TOO_BIG');
  });
  test('teto da biblioteca: 409 TOO_MANY_MESOS', async () => {
    const many = Array.from({ length: M.MAX_MESOS }, (_, i) =>
      mesoOk({ id: 'meso-2026-09-' + String(i + 1).padStart(2, '0') }));
    writeState({ mesos: many });
    const { H, res } = harness({ body: { meso: mesoOk({ id: 'meso-2027-01-01' }) } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'TOO_MANY_MESOS');
  });
  test('activate now com assinatura: carimba assistant e guarda o anterior', async () => {
    writeState({ mesos: [mesoOk({ id: 'meso-2026-08-01' })], activeMeso: 'meso-2026-08-01' });
    const { H, res } = harness({ body: { meso: mesoOk(), activate: 'now' } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    assert.equal(res.code, 201);
    assert.equal(res.body.meta.activated, true);
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    assert.equal(st.activeMeso, 'meso-2026-09-01');
    assert.equal(st.mesoPrev, 'meso-2026-08-01');
    const saved = st.mesos.find(m => m.id === 'meso-2026-09-01');
    assert.equal(saved.activatedBy, 'assistant');
    assert.ok(saved.activatedAt);
  });
  test('activate now sem assinatura: carimba user (o corpo não decide quem ativou)', async () => {
    writeState();
    const { H, res } = harness({ actor: { actor: null, verified: 'none' }, body: { meso: mesoOk({ activatedBy: 'assistant', activate: 'now' }), activate: 'now' } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    const saved = JSON.parse(fs.readFileSync(STATE, 'utf8')).mesos[0];
    assert.equal(saved.activatedBy, 'user');
  });
  test('republicar o mesociclo que já é o ativo não perde o carimbo', async () => {
    writeState();
    let { H, res } = harness({ body: { meso: mesoOk(), activate: 'now' } });
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    ({ H, res } = harness({ body: { meso: mesoOk({ name: 'Editado' }), activate: 'now' }, headers: { 'if-match': '4' } }));
    await H.putMeso({ method: 'PUT', headers: { 'if-match': '4' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.meta.activated, false, 'já era o ativo');
    const saved = JSON.parse(fs.readFileSync(STATE, 'utf8')).mesos[0];
    assert.equal(saved.activatedBy, 'assistant');
    assert.ok(saved.activatedAt, 'o carimbo continua lá');
  });
  test('auditoria e linha de log próprias', async () => {
    writeState();
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      const { H, res } = harness({ body: { meso: mesoOk() } });
      await H.putMeso({ method: 'PUT', headers: { 'if-match': '3' } }, res);
    } finally { console.log = orig; }
    assert.ok(lines.some(l => l.startsWith('[og-meso] op=put-meso')), 'linha [og-meso] no stdout');
    const audit = fs.readFileSync(path.join(TMP, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const last = audit[audit.length - 1];
    assert.equal(last.action, 'put-meso');
    assert.equal(last.uid, UID);
    assert.equal(last.mesoId, 'meso-2026-09-01');
    assert.equal(last.verified, 'signature');
  });
});

describe('activateMeso', () => {
  test('id inexistente: 409 MESO_NOT_FOUND com a lista', async () => {
    writeState({ mesos: [mesoOk()] });
    const { H, res } = harness({ body: {}, raw: Buffer.from('{}') });
    await H.activateMeso({ method: 'POST', headers: { 'if-match': '3' } }, res, ['meso-2026-01-01']);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'MESO_NOT_FOUND');
    assert.deepEqual(res.body.mesos, ['meso-2026-09-01']);
  });
  test('ativa, guarda o anterior e carimba quem ativou', async () => {
    writeState({ mesos: [mesoOk({ id: 'meso-2026-08-01' }), mesoOk()], activeMeso: 'meso-2026-08-01' });
    const { H, res } = harness({ body: {}, raw: Buffer.from('{}') });
    await H.activateMeso({ method: 'POST', headers: { 'if-match': '3' } }, res, ['meso-2026-09-01']);
    assert.equal(res.code, 200);
    assert.equal(res.body.meta.activated, true);
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    assert.equal(st.activeMeso, 'meso-2026-09-01');
    assert.equal(st.mesoPrev, 'meso-2026-08-01');
    assert.equal(st.mesos.find(m => m.id === 'meso-2026-09-01').activatedBy, 'assistant');
  });
  test('sem If-Match: 428 e nada muda', async () => {
    writeState({ mesos: [mesoOk()] });
    const { H, res } = harness({ body: {}, raw: Buffer.from('{}') });
    await H.activateMeso({ method: 'POST', headers: {} }, res, ['meso-2026-09-01']);
    assert.equal(res.code, 428);
    assert.equal(JSON.parse(fs.readFileSync(STATE, 'utf8')).activeMeso, undefined);
  });
});

describe('getMeso', () => {
  test('sem sessão: 401; sem estado: 404; com estado: biblioteca + ponteiros', async () => {
    let { H, res } = harness({ session: null });
    await H.getMeso({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 401);

    fs.rmSync(STATE, { force: true });
    ({ H, res } = harness());
    await H.getMeso({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 404);

    writeState({ mesos: [mesoOk()], activeMeso: 'meso-2026-09-01', mesoPrev: null });
    ({ H, res } = harness());
    await H.getMeso({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.mesos.length, 1);
    assert.equal(res.body.activeMeso, 'meso-2026-09-01');
    assert.equal(res.body.rev, 3);
  });
});
