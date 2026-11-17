// api/diet.test.js — suíte do plano de dieta por usuário (`node --test`).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'og-diet-test-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';

const D = await import('./diet.js');
const S = await import('./server.js');
const R = await import('./routines.js');

const UID = 'u1';
const UID2 = 'u2';

const planOk = (over = {}) => ({
  id: 'diet-2026-11-14',
  name: 'Emagrecimento com Controle de Insulina',
  referenceDate: '2026-11-14',
  goal: 'Perder gordura, definir o corpo e melhorar a saúde metabólica',
  origin: 'assistant',
  profile: { sex: 'male', age: 26, heightCm: 179, weightKg: 75, bmi: 23.4 },
  targets: {
    bmrKcal: 1745,
    tdeeKcal: 2700,
    dailyKcal: { min: 2200, max: 2300 },
    deficitKcal: { min: 400, max: 500 },
    weeklyDeficitKcal: { min: 2800, max: 3500 },
    expectedWeeklyLossKg: 0.4,
    macros: { proteinG: 150, carbsG: 200, fatG: { min: 70, max: 75 } }
  },
  meals: [
    {
      name: 'Café da manhã',
      kcal: 665,
      items: [
        { food: 'Aveia', amount: 100, unit: 'g' },
        { food: 'Ovos', amount: 2, unit: 'un' },
        { food: 'Requeijão light', amount: 30, unit: 'g' },
        '1 fruta (banana ou maçã)'
      ]
    },
    {
      name: 'Almoço',
      kcal: 720,
      items: [
        { food: 'Carne bovina magra ou frango', amount: 200, unit: 'g' },
        { food: 'Arroz cozido', amount: 100, unit: 'g' },
        { food: 'Cenoura', amount: 150, unit: 'g' },
        'Brócolis, abobrinha ou folhas à vontade (porção moderada)',
        { food: 'Azeite', amount: 1, unit: 'colher de sopa' }
      ]
    }
  ],
  rules: {
    'Estagnação 2-3 semanas': 'Reduzir 100 a 150 kcal/dia',
    'Perda > 0,7 kg/sem': 'Aumentar 100 a 150 kcal/dia'
  },
  executionTips: [
    'Coma primeiro a proteína e os vegetais, e depois o arroz.',
    'Pese-se algumas vezes por semana e calcule a média semanal.'
  ],
  ...over
});

const resetUser = (uid = UID) => {
  fs.rmSync(S.dietFile(uid), { force: true });
};

const harness = ({
  uid = UID,
  actor = { actor: 'agent=hermes; tool=diet_writer', verified: 'signature' },
  session = uid ? { id: uid } : null,
  body = {},
  raw = null
} = {}) => {
  const deps = {
    readSession: () => session,
    dietFile: S.dietFile,
    atomicWrite: S.atomicWrite,
    readRawBody: async () => (raw !== null ? raw : Buffer.from(JSON.stringify(body))),
    json: (res, code, obj) => { res.code = code; res.body = obj; },
    DATA: S.DATA,
    readActor: () => actor
  };
  const res = {};
  return { H: D.makeHandlers(deps), res };
};

before(() => { resetUser(UID); resetUser(UID2); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

/* ---------------------------------------------------------------- validação */

describe('validateDietBody', () => {
  test('plano mínimo e plano completo passam', () => {
    assert.equal(D.validateDietBody({ id: 'd1', name: 'Manutenção' }), null);
    assert.equal(D.validateDietBody(planOk()), null);
  });

  test('recusa ausente ou não-objeto', () => {
    assert.equal(D.validateDietBody(null)?.code, 'DIET_REQUIRED');
    assert.equal(D.validateDietBody([])?.code, 'DIET_REQUIRED');
  });

  test('recusa id inválido', () => {
    assert.equal(D.validateDietBody(planOk({ id: '' }))?.code, 'BAD_DIET_ID');
    assert.equal(D.validateDietBody(planOk({ id: '../evil' }))?.code, 'BAD_DIET_ID');
    assert.equal(D.validateDietBody(planOk({ id: 'a'.repeat(65) }))?.code, 'BAD_DIET_ID');
  });

  test('recusa nome vazio ou longo demais', () => {
    assert.equal(D.validateDietBody(planOk({ name: '   ' }))?.code, 'BAD_DIET_NAME');
    assert.equal(D.validateDietBody(planOk({ name: 'x'.repeat(121) }))?.code, 'BAD_DIET_NAME');
  });

  test('valida datas reais e ordem start <= end', () => {
    assert.equal(D.validateDietBody(planOk({ referenceDate: '2026-02-30' }))?.code, 'BAD_DIET_DATE');
    assert.equal(D.validateDietBody(planOk({ start: '14/11/2026' }))?.code, 'BAD_DIET_START');
    assert.equal(D.validateDietBody(planOk({ start: '2026-11-20', end: '2026-11-10' }))?.code, 'BAD_DIET_END');
    assert.equal(D.validateDietBody(planOk({ start: '2026-11-14', end: '2026-12-14' })), null);
  });

  test('valida origin, profile, targets e macros', () => {
    assert.equal(D.validateDietBody(planOk({ origin: 'coach' }))?.code, 'BAD_DIET_ORIGIN');
    assert.equal(D.validateDietBody(planOk({ profile: { age: -5 } }))?.code, 'BAD_DIET_PROFILE');
    assert.equal(D.validateDietBody(planOk({ targets: { dailyKcal: { min: 2500, max: 2000 } } }))?.code, 'BAD_DIET_TARGETS');
    assert.equal(D.validateDietBody(planOk({ targets: { macros: { proteinG: -1 } } }))?.code, 'BAD_DIET_MACROS');
  });

  test('valida meals e meal.items', () => {
    assert.equal(D.validateDietBody(planOk({ meals: 'nada' }))?.code, 'BAD_DIET_MEALS');
    assert.equal(D.validateDietBody(planOk({ meals: [{ name: '' }] }))?.code, 'BAD_DIET_MEAL');
    assert.equal(D.validateDietBody(planOk({ meals: [{ name: 'Almoço', items: [123] }] }))?.code, 'BAD_DIET_MEAL_ITEMS');
    assert.equal(D.validateDietBody(planOk({ meals: [{ name: 'Almoço', items: [{ amount: 100 }] }] }))?.code, 'BAD_DIET_MEAL_ITEMS');
  });

  test('valida rules, notes, executionTips, markdown, log e teto de tamanho', () => {
    assert.equal(D.validateDietBody(planOk({ rules: [] }))?.code, 'BAD_DIET_RULES');
    assert.equal(D.validateDietBody(planOk({ notes: 123 }))?.code, 'BAD_DIET_NOTES');
    assert.equal(D.validateDietBody(planOk({ executionTips: [''] }))?.code, 'BAD_DIET_TIPS');
    assert.equal(D.validateDietBody(planOk({ markdown: 'm'.repeat(D.MAX_MARKDOWN_CHARS + 1) }))?.code, 'BAD_DIET_MARKDOWN');
    assert.equal(D.validateDietBody(planOk({ log: 'x' }))?.code, 'BAD_DIET_LOG');
    assert.equal(D.validateDietBody(planOk({ extraBig: 'x'.repeat(70 * 1024) }))?.code, 'DIET_TOO_BIG');
  });

  test('preserva campos extras desconhecidos', () => {
    const rich = planOk({
      trainingContext: { weeklySessions: 4, capoeiraStart: '2026-11-16' },
      confirmedAnswers: { meatLunchG: 200, meatDinnerG: 200 }
    });
    assert.equal(D.validateDietBody(rich), null);
  });
});

/* ---------------------------------------------------------------- handlers */

describe('diet handlers e persistência por usuário', () => {
  test('sem sessão: 401 em todas as rotas', async () => {
    resetUser();
    const { H, res } = harness({ session: null, body: { plan: planOk() } });
    await H.getDiet({ method: 'GET' }, res);
    assert.equal(res.code, 401);
    await H.getDietPlan({ method: 'GET' }, res, ['diet-2026-11-14']);
    assert.equal(res.code, 401);
    await H.putDiet({ method: 'PUT', headers: { 'if-match': '0' } }, res);
    assert.equal(res.code, 401);
    await H.activateDietPlan({ method: 'POST', headers: { 'if-match': '0' } }, res, ['diet-2026-11-14']);
    assert.equal(res.code, 401);
    await H.deleteDietPlan({ method: 'DELETE', headers: { 'if-match': '0' } }, res, ['diet-2026-11-14']);
    assert.equal(res.code, 401);
  });

  test('GET /api/diet de usuário novo retorna loja vazia com rev 0', async () => {
    resetUser();
    const { H, res } = harness();
    await H.getDiet({ method: 'GET' }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, {
      plans: [],
      activePlanId: null,
      prevPlanId: null,
      activePlan: null,
      rev: 0,
      _ts: null
    });
  });

  test('PUT /api/diet sem If-Match retorna 428 mesmo com corpo inválido', async () => {
    resetUser();
    const { H, res } = harness({ body: { plan: { id: 'bad/id' } } });
    await H.putDiet({ method: 'PUT', headers: {} }, res);
    assert.equal(res.code, 428);
    assert.equal(res.body.code, 'IF_MATCH_REQUIRED');
  });

  test('assinatura de ator inválida retorna 400 BAD_ACTOR_SIG', async () => {
    resetUser();
    const { H, res } = harness({ actor: { err: 'BAD_ACTOR_SIG' }, body: { plan: planOk() } });
    await H.putDiet({ method: 'PUT', headers: { 'if-match': '0' } }, res);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, 'BAD_ACTOR_SIG');
  });

  test('cria, ativa, carimba e registra auditoria; não toca em state-<uid>.json', async () => {
    resetUser();
    const rich = planOk({
      activatedBy: 'assistant', // tentativa de spoof sem efeito se verified !== signature
      trainingContext: { weeklySessions: 4 }
    });
    const { H, res } = harness({
      actor: { actor: null, verified: 'none' },
      body: { plan: rich, activate: 'now' }
    });
    await H.putDiet({ method: 'PUT', headers: { 'if-match': '0' } }, res);
    assert.equal(res.code, 201);
    assert.equal(res.body.rev, 1);
    assert.equal(res.body.meta.created, true);
    assert.equal(res.body.meta.activated, true);

    assert.equal(fs.existsSync(S.stateFile(UID)), false);
    const saved = JSON.parse(fs.readFileSync(S.dietFile(UID), 'utf8'));
    assert.equal(saved.rev, 1);
    assert.equal(saved.activePlanId, 'diet-2026-11-14');
    assert.equal(saved.plans[0].activatedBy, 'user');
    assert.deepEqual(saved.plans[0].trainingContext, { weeklySessions: 4 });

    const audit = R.readAudit(S.DATA, UID, 10);
    assert.equal(audit.entries[0].scope, 'diet');
    assert.equal(audit.entries[0].action, 'put-diet');
    assert.equal(audit.entries[0].dietId, 'diet-2026-11-14');
  });

  test('base velha no If-Match retorna 409 STALE_STATE', async () => {
    const { H, res } = harness({ body: { plan: planOk({ name: 'Novo' }) } });
    await H.putDiet({ method: 'PUT', headers: { 'if-match': '0' } }, res);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, 'STALE_STATE');
    assert.equal(res.body.rev, 1);
  });

  test('substituição com rev atual retorna 200 e preserva ativação anterior', async () => {
    const { H, res } = harness({ body: { plan: planOk({ name: 'Emagrecimento v2' }) } });
    await H.putDiet({ method: 'PUT', headers: { 'if-match': '1' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.rev, 2);
    assert.equal(res.body.meta.created, false);
    const saved = JSON.parse(fs.readFileSync(S.dietFile(UID), 'utf8'));
    assert.equal(saved.plans.length, 1);
    assert.equal(saved.plans[0].name, 'Emagrecimento v2');
    assert.equal(saved.activePlanId, 'diet-2026-11-14');
    assert.equal(saved.plans[0].activatedBy, 'user');
  });

  test('isolamento entre usuários u1 e u2', async () => {
    resetUser(UID2);
    const h2 = harness({ uid: UID2, body: { plan: planOk({ id: 'diet-u2', name: 'Bulking' }), activate: 'now' } });
    await h2.H.putDiet({ method: 'PUT', headers: { 'if-match': '0' } }, h2.res);
    assert.equal(h2.res.code, 201);

    const h1 = harness({ uid: UID });
    await h1.H.getDiet({ method: 'GET' }, h1.res);
    assert.equal(h1.res.body.plans.length, 1);
    assert.equal(h1.res.body.plans[0].id, 'diet-2026-11-14');

    const h2Get = harness({ uid: UID2 });
    await h2Get.H.getDiet({ method: 'GET' }, h2Get.res);
    assert.equal(h2Get.res.body.plans.length, 1);
    assert.equal(h2Get.res.body.plans[0].id, 'diet-u2');
  });

  test('GET /:id, activate /:id/activate com assinatura assistant e DELETE /:id', async () => {
    // Adiciona segundo plano no u1
    const put2 = harness({ body: { plan: planOk({ id: 'diet-2026-12-01', name: 'Manutenção' }) } });
    await put2.H.putDiet({ method: 'PUT', headers: { 'if-match': '2' } }, put2.res);
    assert.equal(put2.res.code, 201);
    assert.equal(put2.res.body.rev, 3);

    // Ativa o segundo plano como assistente assinado
    const act = harness({ actor: { actor: 'hermes', verified: 'signature' } });
    await act.H.activateDietPlan({ method: 'POST', headers: { 'if-match': '3' } }, act.res, ['diet-2026-12-01']);
    assert.equal(act.res.code, 200);
    assert.equal(act.res.body.rev, 4);

    // GET individual
    const getOne = harness();
    await getOne.H.getDietPlan({ method: 'GET' }, getOne.res, ['diet-2026-12-01']);
    assert.equal(getOne.res.code, 200);
    assert.equal(getOne.res.body.active, true);
    assert.equal(getOne.res.body.plan.activatedBy, 'assistant');

    // GET inexistente
    const getMiss = harness();
    await getMiss.H.getDietPlan({ method: 'GET' }, getMiss.res, ['nao-existe']);
    assert.equal(getMiss.res.code, 404);
    assert.equal(getMiss.res.body.code, 'DIET_NOT_FOUND');

    // DELETE do ativo limpa activePlanId
    const del = harness();
    await del.H.deleteDietPlan({ method: 'DELETE', headers: { 'if-match': '4' } }, del.res, ['diet-2026-12-01']);
    assert.equal(del.res.code, 200);
    assert.equal(del.res.body.meta.wasActive, true);
    const afterDel = JSON.parse(fs.readFileSync(S.dietFile(UID), 'utf8'));
    assert.equal(afterDel.activePlanId, null);
    assert.equal(afterDel.plans.length, 1);

    // DELETE de id inexistente
    const delMiss = harness();
    await delMiss.H.deleteDietPlan({ method: 'DELETE', headers: { 'if-match': '5' } }, delMiss.res, ['nao-existe']);
    assert.equal(delMiss.res.code, 404);
  });

  test('arquivo corrompido devolve 500 DIET_CORRUPT e nunca sobrescreve como vazio', async () => {
    resetUser('ucorrupt');
    fs.writeFileSync(S.dietFile('ucorrupt'), '{broken json');
    const h = harness({ uid: 'ucorrupt', body: { plan: planOk() } });
    await h.H.getDiet({ method: 'GET' }, h.res);
    assert.equal(h.res.code, 500);
    assert.equal(h.res.body.code, 'DIET_CORRUPT');
    await h.H.putDiet({ method: 'PUT', headers: { 'if-match': '0' } }, h.res);
    assert.equal(h.res.code, 500);
    assert.equal(h.res.body.code, 'DIET_CORRUPT');
    assert.equal(fs.readFileSync(S.dietFile('ucorrupt'), 'utf8'), '{broken json');
    resetUser('ucorrupt');
  });

  test('roteamento HTTP real no server.js (/api/diet, /api/diet/:id, /api/diet/:id/activate)', async () => {
    assert.ok(S.matchRoute('GET', '/api/diet'));
    assert.ok(S.matchRoute('PUT', '/api/diet'));
    assert.ok(S.matchRoute('GET', '/api/diet/diet-2026-11-14'));
    assert.ok(S.matchRoute('POST', '/api/diet/diet-2026-11-14/activate'));
    assert.ok(S.matchRoute('DELETE', '/api/diet/diet-2026-11-14'));
    assert.equal(S.matchRoute('GET', '/api/diet/bad/path'), null);

    await new Promise(ok => S.server.listen(0, '127.0.0.1', ok));
    const { port } = S.server.address();
    const res = await new Promise((ok, no) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/diet', method: 'GET' }, r => {
        let data = '';
        r.on('data', c => { data += c; });
        r.on('end', () => ok({ status: r.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', no);
      req.end();
    });
    await new Promise(ok => S.server.close(ok));
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTH');
  });
});
