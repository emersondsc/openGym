// api/hardening.test.js — os achados da revisão de 30/10/2026: número da semana, lista de hosts do
// push, escrita vinda de site irmão, URL inválida, treino vivo no DELETE, admin por ADMIN_UIDS e a
// regra única de modo na publicação.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-hardening-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';

const S = await import('./server.js');
const R = await import('./routines.js');
const M = await import('./micro.js');
const { buildAnalysis } = await import('./coach.js');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const weekOf = d => buildAnalysis({ workouts: [{
  start: Date.parse(d + 'T15:00:00Z'), end: Date.parse(d + 'T16:00:00Z'),
  entries: [{ id: 'x', sets: [{ w: 10, r: 5 }] }]
}] }).analysis.weeks[0].week;

describe('número da semana', () => {
  test('anos com a primeira quinta em 7/jan', () => {
    assert.equal(weekOf('2027-01-07'), '2027-S01');
    assert.equal(weekOf('2027-06-16'), '2027-S24');
    assert.equal(weekOf('2027-12-30'), '2027-S52');
    assert.equal(weekOf('2021-01-07'), '2021-S01');
  });
  test('outros anos seguem iguais', () => {
    assert.equal(weekOf('2026-10-29'), '2026-S44');
    assert.equal(weekOf('2026-01-01'), '2026-S01');
    assert.equal(weekOf('2025-12-31'), '2026-S01');
  });
});

describe('inscrição de push', () => {
  const keys = { p256dh: 'p', auth: 'a' };
  test('aceita os serviços dos navegadores e devolve só o que o envio usa', () => {
    for (const host of ['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com',
                        'wns2-bn3p.notify.windows.com']) {
      const sub = S.cleanPushSub({ endpoint: `https://${host}/x`, keys: { ...keys, extra: 1 }, junk: 1 });
      assert.deepEqual(sub, { endpoint: `https://${host}/x`, keys });
    }
  });
  test('recusa host, porta, protocolo e tamanho', () => {
    for (const endpoint of ['https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x',
                            'https://fcm.googleapis.com:8443/x', 'http://fcm.googleapis.com/x',
                            'https://evilpush.apple.com/x', 'nada',
                            'https://fcm.googleapis.com/' + 'x'.repeat(3000)]) {
      assert.equal(S.cleanPushSub({ endpoint, keys }), null, endpoint);
    }
    assert.equal(S.cleanPushSub({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p' } }), null);
    assert.equal(S.cleanPushSub(undefined), null);
  });
});

test('saveDbQuiet: falha de disco não vira exceção', () => {
  const blocked = path.join(TMP, 'db.json.tmp');
  fs.mkdirSync(blocked);                         // writeFileSync no .tmp agora dá EISDIR
  assert.equal(S.saveDbQuiet(), false);
  fs.rmdirSync(blocked);
  assert.equal(S.saveDbQuiet(), true);
});

test('restSeconds: sem número não há alerta', () => {
  assert.equal(S.restSeconds(undefined), null);
  assert.equal(S.restSeconds('abc'), null);
  assert.equal(S.restSeconds(0), null);
  assert.equal(S.restSeconds(90), 90);
  assert.equal(S.restSeconds(99999), 3600);
});

test('sameSiteWrite: só escrita, e só de site irmão', () => {
  const r = (method, site) => ({ method, headers: site ? { 'sec-fetch-site': site } : {} });
  assert.equal(S.sameSiteWrite(r('POST', 'same-site')), true);
  assert.equal(S.sameSiteWrite(r('GET', 'same-site')), false);
  assert.equal(S.sameSiteWrite(r('POST', 'same-origin')), false);
  assert.equal(S.sameSiteWrite(r('POST')), false);          // o agente não manda o cabeçalho
});

test('URL que o parser recusa responde 400 e o processo continua de pé', async () => {
  await new Promise(ok => S.server.listen(0, '127.0.0.1', ok));
  const { port } = S.server.address();
  const raw = await new Promise((ok, no) => {
    const c = net.connect(port, '127.0.0.1', () => c.write('GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
    let out = '';
    c.on('data', d => { out += d; });
    c.on('end', () => ok(out));
    c.on('error', no);
  });
  await new Promise(ok => S.server.close(ok));
  assert.match(raw, /^HTTP\/1\.1 400/);
});

describe('handlers de rotina', () => {
  function setup(extra = {}) {
    const state = { rev: 3, routines: [{ id: 'a', ex: [] }] };
    const res = {};
    const H = R.makeHandlers({
      readSession: () => ({ id: 'u1' }), readState: () => JSON.parse(JSON.stringify(state)),
      stateFile: () => path.join(TMP, 'state-u1.json'), atomicWrite: () => {},
      readRawBody: async () => '', DATA: TMP,
      readActor: () => ({ actor: 'hermes', verified: 'signature' }),
      json: (_r, code, body) => { res.code = code; res.body = body; },
      ...extra
    });
    return { H, res };
  }
  const del = url => ({ method: 'DELETE', url, headers: { 'if-match': '3' } });

  test('treino vivo segura o DELETE, e ?force=1 passa', async () => {
    const { H, res } = setup({ livePresence: () => ({ name: 'A' }) });
    await H.deleteRoutine(del('/api/routines/a'), {}, ['a']);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'ROUTINE_IN_USE');
    await H.deleteRoutine(del('/api/routines/a?force=1'), {}, ['a']);
    assert.equal(res.code, 200);
  });
  test('sem treino vivo apaga', async () => {
    const { H, res } = setup({ livePresence: () => null });
    await H.deleteRoutine(del('/api/routines/a'), {}, ['a']);
    assert.equal(res.code, 200);
  });
  test('/api/audit: admin vem do isAdmin, e limit inválido cai no padrão', async () => {
    const req = q => ({ method: 'GET', url: '/api/audit' + q, headers: {} });
    const yes = setup({ isAdmin: () => true }), no = setup({ isAdmin: () => false });
    await yes.H.audit(req('?uid=outro'), {});
    assert.equal(yes.res.code, 200);
    await no.H.audit(req('?uid=outro'), {});
    assert.equal(no.res.code, 403);
    await yes.H.audit(req('?limit=abc'), {});
    assert.ok(yes.res.body.entries.length >= 1);
  });
});

describe('estado em /api/data', () => {
  const file = S.stateFile('corrompido');
  test('ausente é null; ilegível lança', () => {
    assert.equal(S.readStateStrict('corrompido'), null);
    fs.writeFileSync(file, '{ cortado');
    assert.throws(() => S.readStateStrict('corrompido'));
    fs.writeFileSync(file, '');
    assert.throws(() => S.readStateStrict('corrompido'));
    fs.rmSync(file);
  });
});

describe('carimbo do mesociclo no PUT geral', () => {
  const claimed = { verified: 'claimed' }, signed = { verified: 'signature' };
  const state = by => ({ mesos: [{ id: 'm', activatedBy: by }] });
  test('sem assinatura, "assistant" novo vira "user"', () => {
    const s = state('assistant');
    S.guardMesoStamps(s, { mesos: [] }, claimed);
    assert.equal(s.mesos[0].activatedBy, 'user');
  });
  test('o que já estava no disco, a assinatura e "user" passam', () => {
    const a = state('assistant'), b = state('assistant'), c = state('user');
    S.guardMesoStamps(a, state('assistant'), claimed);
    S.guardMesoStamps(b, null, signed);
    S.guardMesoStamps(c, null, claimed);
    assert.deepEqual([a, b, c].map(x => x.mesos[0].activatedBy), ['assistant', 'assistant', 'user']);
  });
});

test('PATCH em rotina sem `ex` funciona', () => {
  const cur = { id: 'a' };
  const out = R.mergeRoutine(cur, { ex: { '0326': { sets: 3 } } }, new Map([['0326', { eq: 'dumbbell' }]]), new Set());
  assert.equal(out, null);
  assert.equal(cur.ex.length, 1);
});

describe('DELETE com a rotina do treino vivo', () => {
  async function run(live) {
    const res = {};
    const H = R.makeHandlers({
      readSession: () => ({ id: 'u1' }), readState: () => ({ rev: 3, routines: [{ id: 'a', ex: [] }] }),
      stateFile: () => path.join(TMP, 'state-u1.json'), atomicWrite: () => {},
      readRawBody: async () => '', DATA: TMP, livePresence: () => live,
      readActor: () => ({ actor: 'hermes', verified: 'signature' }),
      json: (_r, code, body) => { res.code = code; res.body = body; }
    });
    await H.deleteRoutine({ method: 'DELETE', url: '/api/routines/a', headers: { 'if-match': '3' } }, {}, ['a']);
    return res.code;
  }
  test('segura só a rotina em uso', async () => {
    assert.equal(await run({ routineId: 'a' }), 409);
    assert.equal(await run({ routineId: 'b' }), 200);
    assert.equal(await run({ routineId: null }), 200);      // treino livre
    assert.equal(await run({ name: 'app antigo' }), 409);   // não sabe dizer: segura
  });
});

describe('auditoria', () => {
  const dirOf = () => fs.mkdtempSync(path.join(TMP, 'audit-'));
  const fileOf = d => path.join(d, 'audit.jsonl');
  test('encadeia passando por linha maior que o pedaço lido', () => {
    const d = dirOf();
    R.appendAudit(d, { uid: 'a', otp: '1', big: 'x'.repeat(70 * 1024) });
    R.appendAudit(d, { uid: 'a', otp: '2', big: 'é'.repeat(70 * 1024) });
    R.appendAudit(d, { uid: 'a', otp: '3' });
    const r = R.readAudit(d, 'a', 10);
    assert.equal(r.chainIntact, true);
    assert.equal(r.linksIntact, true);
  });
  test('adulterar uma linha ou quebrar um elo é detectado', () => {
    const d = dirOf();
    for (const otp of ['1', '2', '3']) R.appendAudit(d, { uid: 'a', otp });
    const lines = fs.readFileSync(fileOf(d), 'utf8').trim().split('\n');
    fs.writeFileSync(fileOf(d), lines[0] + '\n' + lines[1].replace('"otp":"2"', '"otp":"9"') + '\n' + lines[2] + '\n');
    assert.equal(R.readAudit(d, 'a', 10).linksIntact, false);
    fs.writeFileSync(fileOf(d), lines[0] + '\n' + lines[2] + '\n');
    assert.equal(R.readAudit(d, 'a', 10).linksIntact, false);
  });
  test('depois de cortar o começo, os elos seguem válidos e a cadeia não', () => {
    const d = dirOf();
    for (const otp of ['1', '2', '3']) R.appendAudit(d, { uid: 'a', otp });
    const lines = fs.readFileSync(fileOf(d), 'utf8').trim().split('\n');
    fs.writeFileSync(fileOf(d), lines.slice(1).join('\n') + '\n');
    const r = R.readAudit(d, 'a', 10);
    assert.equal(r.linksIntact, true);
    assert.equal(r.chainIntact, false);
  });
  test('rotação mantém 5000 linhas, inclusive com o arquivo trocado por fora', () => {
    const d = dirOf();
    R.appendAudit(d, { uid: 'a', otp: '0' });
    fs.writeFileSync(fileOf(d), Array.from({ length: 5000 }, (_, i) => JSON.stringify({ uid: 'a', i, h: 'h' + i })).join('\n') + '\n');
    R.appendAudit(d, { uid: 'a', otp: '1' });
    R.appendAudit(d, { uid: 'a', otp: '2' });
    assert.equal(fs.readFileSync(fileOf(d), 'utf8').trim().split('\n').length, 5000);
  });
});

describe('publicação: uma regra de modo só', () => {
  test('`autorizar.datas` que não é lista é 400, não exceção', () => {
    const b = { meso_id: 'meso-2026-10-27', semana: 1, autorizar: { datas: 5 },
                routines: [{ id: 'a', name: 'A', emoji: 'x', ex: [{ id: '0326', sets: 3 }] }] };
    const bad = M.validatePublish(b, new Map([['0326', {}]]), new Set(), '2026-10-30');
    assert.equal(bad.code, 'BAD_AUTORIZAR');
  });
  const catalog = new Map([['0326', { eq: 'dumbbell' }]]);
  const body = ex => ({ meso_id: 'meso-2026-10-27', semana: 1,
                        routines: [{ id: 'a', name: 'A', emoji: 'x', ex: [{ id: '0326', sets: 3, ...ex }] }] });
  test('sem `mode`, valida no modo que a entrada já tem', () => {
    const prev = [{ id: 'a', ex: [{ id: '0326', sets: 3, mode: 'time', sec: 45 }] }];
    const bad = M.validatePublish(body({ sec: 9999 }), catalog, new Set(), '2026-10-30', prev);
    assert.equal(bad.code, 'BAD_SEC');
    assert.equal(M.validatePublish(body({ sec: 60 }), catalog, new Set(), '2026-10-30', prev), null);
  });
  test('`sg` vazio não é gravado', () => {
    const r = M.materializeRoutine(body({ sg: '' }).routines[0], catalog, null);
    assert.equal('sg' in r.ex[0], false);
  });
});
