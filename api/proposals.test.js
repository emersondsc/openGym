import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { todaySP } from './micro.js';
import * as P from './proposals.js';
import { sha256, canon } from './routines.js';

const catalog = new Map([['0584', { id: '0584', n: 'lateral', eq: 'leverage machine' }], ['0585', { id: '0585', n: 'ext', eq: 'leverage machine' }]]);
const OWNER = 'dono';
const addDias = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function ambiente(extra = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'prop-'));
  const dir = path.join(raiz, 'cp');
  for (const d of ['pending', 'decisions', 'snapshots']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const DATA = path.join(raiz, 'data');
  fs.mkdirSync(DATA);
  const stateFile = uid => path.join(DATA, `state-${uid}.json`);
  const estado = {
    rev: 7, _ts: 1, unit: 'kg', week: {}, dayPlan: {}, customEx: [], exWeights: {}, activeMeso: 'meso-2026-10-27', mesoPrev: null,
    routines: [{ id: 'r1', name: 'A', emoji: 'x', prog: 'off', extra: 1, ex: [{ id: '0584', sets: 3, reps: '12-20', weight: 40, mode: 'reps', bodyweight: true, restSec: 90 }] }],
    mesos: [{ id: 'meso-2026-10-27', name: 'M', start: '2026-10-27', weeks: [{ n: 1 }], rules: { 'Hérnia': 'x' }, segredoDoApp: 1, updatedAt: 't' }],
    workouts: [{ id: 'w1', d: '2026-01-01', start: 1, end: 2, vol: 500, prs: [], entries: [{ id: '0584', topW: 50, sets: [{ w: 50, r: 10, done: true, sec: 30 }] }] }]
  };
  const S = () => JSON.parse(fs.readFileSync(stateFile(OWNER), 'utf8'));
  fs.writeFileSync(stateFile(OWNER), JSON.stringify(estado));
  const saidas = [];
  let presenca = null;
  let provaOk = true;
  const deps = {
    readSession: req => req.user ?? null, readState: uid => JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')), stateFile,
    atomicWrite: (f, c) => fs.writeFileSync(f, c), readBody: async req => req.body ?? {}, DATA, dir, catalog,
    json: (res, code, body) => { res.code = code; res.body = body; saidas.push({ code, body }); },
    livePresence: () => presenca, ownerUid: OWNER, saveDb: () => {},
    proposalChallenge: async (u, id, hash) => ({ cid: 'c', options: { id, hash } }),
    proveProposal: async () => (provaOk ? null : 'nao'), ...extra
  };
  const h = P.makeHandlers(deps);
  const proposta = (kind, plan, resto = {}) => {
    const id = resto.id || `prop-${kind.replace('_', '-')}`;
    const p = { id, kind, plan, title: 'T', summary: 'S', reasons: ['r'], base_hash: P.hashBase(S(), kind, plan),
      created_at: '2026-11-01T10:00:00.000Z', expires_at: new Date(Date.now() + 864e5).toISOString(), created_by: 'c', ...resto };
    fs.writeFileSync(path.join(dir, 'pending', `${id}.json`), JSON.stringify(p));
    return p;
  };
  const chama = async (fn, params, body, user = { id: OWNER }) => { const res = {}; await h[fn]({ url: '/x', user, body }, res, params); return res; };
  const aprova = async id => {
    const g = await chama('getProposal', [id]);
    return chama('approveProposal', [id], { cid: 'c', credential: {}, approval_hash: g.body.approval_hash });
  };
  return { dir, DATA, S, proposta, chama, aprova, h, estado, stateFile, setPresenca: v => { presenca = v; }, setProva: v => { provaOk = v; } };
}
const semana = (peso = 42.5, extra = {}) => ({ meso_id: 'meso-2026-10-27', semana: 2, routines: [{ id: 'r1', name: 'A', emoji: 'x', ex: [{ id: '0584', sets: 3, reps: '12-20', weight: peso, restSec: 90 }], ...extra }] });
const auditoria = DATA => fs.readFileSync(path.join(DATA, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

test('sem dono configurado as rotas respondem 404 e outro usuario recebe 403', async () => {
  const e = ambiente({ ownerUid: '' });
  assert.equal((await e.chama('listProposals')).code, 404);
  const f = ambiente();
  for (const [fn, p] of [['listProposals'], ['getProposal', ['prop-x']], ['challengeProposal', ['prop-x']], ['approveProposal', ['prop-x']], ['rejectProposal', ['prop-x']]]) {
    assert.equal((await f.chama(fn, p, {}, { id: 'outro' })).code, 403, fn);
  }
  assert.equal((await f.chama('listProposals', [], {}, null)).code, 401);
});

test('makeHandlers nao exporta list, que quebraria GET /api/routines', () => {
  assert.equal('list' in ambiente().h, false);
});

test('semana aplica, preserva o que o Claude nao ve e audita', async () => {
  const e = ambiente();
  e.proposta('week', semana());
  const r = await e.aprova('prop-week');
  assert.equal(r.code, 200);
  const ex = e.S().routines[0].ex[0];
  assert.equal(ex.weight, 42.5);
  assert.equal(ex.bodyweight, true);
  assert.equal(e.S().routines[0].extra, 1);
  const a = auditoria(e.DATA).at(-1);
  assert.deepEqual([a.actor, a.verified, a.proposalId, a.action], ['claude', 'passkey', 'prop-week', 'publish-micro']);
  assert.equal((await e.chama('getProposal', ['prop-week'])).body.status, 'applied');
  assert.equal(fs.readdirSync(path.join(e.dir, 'snapshots')).length, 1);
});

test('sem prova de passkey nada e gravado', async () => {
  const e = ambiente();
  e.proposta('week', semana());
  e.setProva(false);
  const antes = JSON.stringify(e.S());
  assert.equal((await e.aprova('prop-week')).code, 400);
  assert.equal(JSON.stringify(e.S()), antes);
});

test('proposta alterada no disco depois do GET nao e aplicada', async () => {
  const e = ambiente();
  const p = e.proposta('week', semana());
  const g = await e.chama('getProposal', ['prop-week']);
  fs.writeFileSync(path.join(e.dir, 'pending', 'prop-week.json'), JSON.stringify({ ...p, plan: semana(99) }));
  const r = await e.chama('approveProposal', ['prop-week'], { approval_hash: g.body.approval_hash });
  assert.equal(r.code, 409);
  assert.equal(e.S().routines[0].ex[0].weight, 40);
});

test('mudanca no que a proposta altera a torna stale; salvar outra coisa nao', async () => {
  const e = ambiente();
  e.proposta('week', semana());
  const s = e.S();
  s.rev = 8; s.bodyweightQualquer = 1;
  fs.writeFileSync(e.stateFile(OWNER), JSON.stringify(s));
  assert.equal((await e.chama('getProposal', ['prop-week'])).body.status, 'pending');
  s.routines[0].ex[0].weight = 45;
  fs.writeFileSync(e.stateFile(OWNER), JSON.stringify(s));
  assert.equal((await e.chama('getProposal', ['prop-week'])).body.status, 'stale');
});

test('treino em andamento bloqueia, inclusive na aprovacao', async () => {
  const e = ambiente();
  e.proposta('week', semana());
  const g = await e.chama('getProposal', ['prop-week']);
  e.setPresenca({});
  assert.equal((await e.chama('getProposal', ['prop-week'])).body.blocked_reason, 'WORKOUT_IN_PROGRESS');
  const r = await e.chama('approveProposal', ['prop-week'], { approval_hash: g.body.approval_hash });
  assert.deepEqual([r.code, r.body.code], [409, 'WORKOUT_IN_PROGRESS']);
});

test('hash de aprovacao nao depende do relogio, em nenhum tipo', async () => {
  const e = ambiente();
  const casos = [['mesocycle', { meso: { id: 'meso-2026-12-01', name: 'N', start: '2026-12-01', weeks: [{ n: 1 }], rules: { Hernia: 'a' } }, activate: 'now' }],
    ['mesocycle_action', { meso_id: 'meso-2026-10-27', action: 'delete' }], ['week', semana()]];
  for (const [k, plan] of casos) {
    e.proposta(k, plan);
    const id = `prop-${k.replace('_', '-')}`;
    const a = (await e.chama('getProposal', [id])).body.approval_hash;
    const real = Date.now;
    Date.now = () => real() + 5000;
    const b = (await e.chama('getProposal', [id])).body.approval_hash;
    Date.now = real;
    assert.ok(a);
    assert.equal(a, b, k);
  }
});

test('mesociclo: preserva extras, carimba assistant e ativa', async () => {
  const e = ambiente();
  const meso = { id: 'meso-2026-10-27', name: 'Novo', start: '2026-10-27', weeks: [{ n: 1 }], rules: { 'Hérnia': 'x' } };
  e.proposta('mesocycle', { meso, activate: 'now' });
  assert.equal((await e.aprova('prop-mesocycle')).code, 200);
  const m = e.S().mesos[0];
  assert.deepEqual([m.name, m.segredoDoApp, m.activatedBy], ['Novo', 1, 'assistant']);
});

test('dia ocupado aparece, muda o hash e aprovar o autoriza; plano com autorizar e recusado', async () => {
  const e = ambiente();
  const hoje = addDias(todaySP(), 1);
  const s = e.S(); s.dayPlan = { [hoje]: 'outra' };
  fs.writeFileSync(e.stateFile(OWNER), JSON.stringify(s));
  e.proposta('week', semana(40, { dias: [hoje] }));
  const g = await e.chama('getProposal', ['prop-week']);
  assert.equal(g.body.dates_replaced[0].date, hoje);
  assert.equal((await e.aprova('prop-week')).code, 200);
  assert.equal(e.S().dayPlan[hoje], 'r1');
  const f = ambiente();
  f.proposta('week', { ...semana(), autorizar: { datas: [] } });
  assert.equal((await f.chama('getProposal', ['prop-week'])).body.blocked_reason, 'BAD_PLAN');
});

test('toda folha alterada aparece em changes, inclusive efeito colateral', async () => {
  const e = ambiente();
  const s = e.S(); s.week = { 3: 'r1' };
  fs.writeFileSync(e.stateFile(OWNER), JSON.stringify(s));
  e.proposta('routine_delete', { routine_id: 'r1' });
  const c = (await e.chama('getProposal', ['prop-routine-delete'])).body.changes.map(x => x.path);
  assert.ok(c.includes('week.3'));
  assert.ok(c.includes('routines.0.id'));
  assert.equal(c.includes('rev'), false);
});

test('duas decisoes geram uma so', async () => {
  const e = ambiente();
  e.proposta('week', semana());
  const g = await e.chama('getProposal', ['prop-week']);
  const [a, b] = await Promise.all(['x', 'y'].map(() => e.chama('approveProposal', ['prop-week'], { approval_hash: g.body.approval_hash })));
  assert.deepEqual([a.code, b.code].sort(), [200, 409]);
  assert.equal(auditoria(e.DATA).length, 1);
  assert.equal((await e.chama('rejectProposal', ['prop-week'], {})).code, 409);
});

test('recusa nao toca no estado e nao exige passkey', async () => {
  const e = ambiente();
  e.proposta('week', semana());
  const antes = JSON.stringify(e.S());
  e.setProva(false);
  assert.equal((await e.chama('rejectProposal', ['prop-week'], { reason: 'nao' })).code, 200);
  assert.equal(JSON.stringify(e.S()), antes);
  assert.equal((await e.chama('getProposal', ['prop-week'])).body.status, 'rejected');
});

test('arquivos ruins sao ignorados sem derrubar a lista', async () => {
  const e = ambiente();
  e.proposta('week', semana());
  const pend = path.join(e.dir, 'pending');
  fs.writeFileSync(path.join(pend, 'prop-ruim.json'), '{quebrado');
  fs.writeFileSync(path.join(pend, 'prop-outro.json'), JSON.stringify({ id: 'prop-nome-errado' }));
  fs.writeFileSync(path.join(pend, 'prop-grande.json'), 'x'.repeat(P.LIMITES.bytes + 1));
  fs.symlinkSync('/etc/passwd', path.join(pend, 'prop-link.json'));
  assert.deepEqual((await e.chama('listProposals')).body.proposals.map(p => p.id), ['prop-week']);
});

test('expirada e cancelada nao aplicam', async () => {
  const e = ambiente();
  e.proposta('week', semana(), { id: 'prop-velha', expires_at: '2020-01-01T00:00:00.000Z' });
  assert.equal((await e.chama('getProposal', ['prop-velha'])).body.status, 'expired');
  e.proposta('week', semana(), { id: 'prop-canc' });
  fs.writeFileSync(path.join(e.dir, 'pending', 'prop-canc.canceled'), '');
  assert.equal((await e.chama('approveProposal', ['prop-canc'], { approval_hash: 'x' })).code, 409);
});

test('data vencida fica bloqueada e proposta sem efeito tambem', async () => {
  const e = ambiente();
  e.proposta('week', semana(40, { dias: ['2020-01-01'] }), { id: 'prop-data' });
  assert.equal((await e.chama('getProposal', ['prop-data'])).body.blocked_reason, 'DATE_IN_PAST');
  e.proposta('mesocycle_action', { meso_id: 'meso-2026-10-27', action: 'activate' }, { id: 'prop-igual' });
  assert.equal((await e.chama('getProposal', ['prop-igual'])).body.blocked_reason, 'NO_CHANGES');
});

test('auditoria recupera a decisao se o arquivo faltar', async () => {
  const e = ambiente();
  e.proposta('week', semana());
  assert.equal((await e.aprova('prop-week')).code, 200);
  fs.rmSync(path.join(e.dir, 'decisions', 'prop-week.json'));
  assert.equal((await e.chama('getProposal', ['prop-week'])).body.status, 'applied');
  assert.ok(fs.existsSync(path.join(e.dir, 'decisions', 'prop-week.json')));
});

test('correcao de historico aplica, recalcula e audita', async () => {
  const e = ambiente();
  e.proposta('history_fix', { ops: [{ workout_id: 'w1', exercise_id: '0584', set_index: 0, field: 'w', from: 50, to: 45 }] });
  assert.equal((await e.aprova('prop-history-fix')).code, 200);
  const w = e.S().workouts[0];
  assert.deepEqual([w.entries[0].sets[0].w, w.vol, w.entries[0].topW], [45, 450, 45]);
  assert.equal(auditoria(e.DATA).at(-1).action, 'history-fix');
});

test('patch de rotina aplica pela mesma regra da rota', async () => {
  const e = ambiente();
  e.proposta('routine_patch', { routine_id: 'r1', patch: { ex: { '0584': { weight: 41 } } } });
  assert.equal((await e.aprova('prop-routine-patch')).code, 200);
  assert.equal(e.S().routines[0].ex[0].weight, 41);
});

test('avisos de salto e de restricao sao recalculados no servidor', () => {
  const { estado } = ambiente();
  assert.equal(P.avisos(estado, 'week', semana(60))[0].code, 'WEIGHT_JUMP');
  const m = { id: 'meso-2026-12-01', name: 'N', start: '2026-12-01', weeks: [{ n: 1 }], rules: {} };
  assert.equal(P.avisos(estado, 'mesocycle', { meso: m, activate: 'none' })[0].code, 'RESTRICTION_DROPPED');
});

test('diffFolhas nao perde folha nova nem removida', () => {
  const d = P.diffFolhas({ a: { b: 1 }, c: 1 }, { a: { b: 2 }, d: { e: 1 } });
  assert.deepEqual(d.map(x => x.path), ['a.b', 'c', 'd.e']);
});

test('hash usa so a projecao: campo oculto nao muda a base', () => {
  const { estado } = ambiente();
  const a = P.hashBase(estado, 'routine_delete', { routine_id: 'r1' });
  const b = P.hashBase({ ...estado, routines: estado.routines.map(r => ({ ...r, extra: 2, ex: r.ex.map(({ bodyweight, ...x }) => x) })) }, 'routine_delete', { routine_id: 'r1' });
  assert.equal(a, b);
  assert.ok(sha256(canon({})));
});
