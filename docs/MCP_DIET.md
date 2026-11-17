# Integração do MCP (`/opt/opengym-mcp`) com Dieta e Propostas

> [!NOTE]
> O repositório [`emersondsc/openGym`](https://github.com/emersondsc/openGym) contém a API (`api/`) e o frontend (`frontend/`). O servidor MCP (`/opt/opengym-mcp`) fica apenas na VPS Oracle e mantém uma cópia espelhada em `/opt/opengym-mcp/app-api/`.

## 1. O que mudou no `openGym`

1. **Armazenamento isolado (`api/diet.js`)**
   - Os planos de dieta ficam em `DATA_DIR/diet-<uid>.json` (`{ rev, _ts, activePlanId, prevPlanId, plans }`), separados de `state-<uid>.json`.
   - Rotas HTTP autenticadas da API:
     - `GET /api/diet`
     - `GET /api/diet/:did`
     - `PUT /api/diet` (`{ plan, activate: "now" | "none" }`, `If-Match`)
     - `POST /api/diet/:did/activate` (`If-Match`)
     - `DELETE /api/diet/:did` (`If-Match`)

2. **Propostas do treinador (`api/proposals.js`)**
   - `KINDS` agora inclui `'diet'` e `'diet_action'`.
   - `AUTO_KINDS` agora inclui `'diet'`:
     - Criar um **novo** `plan.id` em `kind: 'diet'` entra via gravação direta (`mode: 'auto'`) quando `COACH_AUTO_APPLY=1`.
     - Sobrescrever um `plan.id` já existente gera o aviso `DIET_OVERWRITE` e exige passkey no app (`mode: 'passkey'`).
     - `kind: 'diet_action'` (`activate` ou `delete`) sempre exige passkey no app (`KIND_NEEDS_PASSKEY`).
   - Todas as funções puras usadas pelo MCP aceitam o 4º argumento opcional `D` (loja de dieta lida de `diet-<uid>.json`):
     - `projetar(S, kind, plan, D)`
     - `hashBase(S, kind, plan, D)`
     - `avisos(S, kind, plan, D)`
     - `validarPlano(S, kind, plan, catalog, D)`
     - `simular(S, p, catalog, D)`
     - `modoDe(S, p, opts, D)`

---

## 2. Sincronizar `/opt/opengym-mcp/app-api/` na VPS

Como [`api/proposals.js`](../api/proposals.js) agora importa `./diet.js`, é obrigatório copiar **os dois arquivos** para `/opt/opengym-mcp/app-api/` após o deploy do `openGym`:

```bash
cd /mnt/drivebackup/apps/openGym/openGym
cp api/diet.js api/proposals.js /opt/opengym-mcp/app-api/

# Conferência rápida de import e kinds expostos:
node -e "import('/opt/opengym-mcp/app-api/proposals.js').then(m => console.log({ KINDS: m.KINDS, AUTO_KINDS: m.AUTO_KINDS }))"
```

---

## 3. Ferramenta `get_diet` no MCP (`/opt/opengym-mcp`)

Adicione a leitura segura de `DATA_DIR/diet-<uid>.json` (onde `<uid>` é o usuário vinculado ao token do MCP, sanitizado com `uid.replace(/[^a-zA-Z0-9_-]/g, '')`):

```js
import fs from 'node:fs';
import path from 'node:path';
import { readDietStrict } from './app-api/diet.js';

export function readUserDiet(dataDir, uid) {
  const safeUid = String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeUid) throw new Error('BAD_UID');
  return readDietStrict(path.join(dataDir, `diet-${safeUid}.json`));
}

// Handler sugerido para a tool MCP `get_diet`:
export async function handleGetDiet({ dataDir, uid }) {
  const D = readUserDiet(dataDir, uid);
  const activePlan = D.activePlanId
    ? (D.plans.find(p => p.id === D.activePlanId) || null)
    : null;
  return {
    rev: D.rev,
    _ts: D._ts,
    activePlanId: D.activePlanId,
    prevPlanId: D.prevPlanId,
    activePlan,
    plans: D.plans,
  };
}
```

---

## 4. Suporte a `diet` e `diet_action` em `propose_change`

Ao montar uma proposta com `kind: 'diet'` ou `kind: 'diet_action'` no MCP:

1. Leia `S` (`state-<uid>.json` — pode ser `{}` caso o usuário ainda não tenha histórico de treino) e `D` (`diet-<uid>.json`, via `readDietStrict`, que devolve loja vazia `rev: 0` se ainda não existir).
2. Passe `D` como último argumento para validar, simular, calcular `base_hash` e prever `modoDe`:

```js
import {
  KINDS,
  avisos,
  contarAuto,
  hashBase,
  lerPolitica,
  modoDe,
  simular,
  validarPlano,
} from './app-api/proposals.js';

export function buildDietProposal({
  id,          // /^prop-[a-z0-9-]{1,40}$/
  kind,        // 'diet' | 'diet_action'
  plan,        // { plan: {...}, activate: 'now'|'none' } ou { diet_id, action: 'activate'|'delete' }
  title,
  summary,
  reasons,
  S = {},
  D,           // resultado de readUserDiet(dataDir, uid)
  catalog,
  proposalsDir = '/coach-proposals',
  ttlHours = 72,
}) {
  if (!KINDS.includes(kind)) throw new Error(`bad kind: ${kind}`);

  const invalid = validarPlano(S, kind, plan, catalog, D);
  if (invalid) {
    throw Object.assign(new Error(invalid.error || invalid.code), { detail: invalid });
  }

  const now = Date.now();
  const created_at = new Date(now).toISOString();
  const expires_at = new Date(now + ttlHours * 3600 * 1000).toISOString();
  const base_hash = hashBase(S, kind, plan, D);
  const prop = {
    id,
    kind,
    plan,
    title,
    summary,
    reasons,
    base_hash,
    created_at,
    expires_at,
    created_by: 'claude',
  };

  const sim = simular(S, prop, catalog, D);
  if (sim.error) {
    throw Object.assign(new Error(sim.error.message || sim.error.code), { detail: sim.error });
  }
  if (!sim.changes.length) {
    throw Object.assign(new Error('nothing would change'), { detail: { code: 'NO_CHANGES' } });
  }

  const warnings = avisos(S, kind, plan, D);
  const modePrediction = modoDe(
    S,
    prop,
    { ligado: lerPolitica(proposalsDir), autoHoje: contarAuto(proposalsDir, now) },
    D
  );

  // Gravar `prop` atomicamente em `${proposalsDir}/pending/${id}.json`
  return { prop, sim, warnings, modePrediction };
}
```

### Exemplos de payload (`plan`)

- **Criar ou atualizar dieta (`kind: 'diet'`):**

```json
{
  "kind": "diet",
  "title": "Plano alimentar cutting — 2.000 kcal",
  "summary": "Déficit moderado (~500 kcal/dia) com ~170 g de proteína.",
  "reasons": [
    "Meta de déficit semanal sustentável sem perda de massa magra",
    "Distribuição de 4 refeições alinhada aos horários informados"
  ],
  "plan": {
    "plan": {
      "id": "cutting-2026-11",
      "name": "Cutting Moderado 2000 kcal",
      "goal": "Perda de gordura preservando força",
      "referenceDate": "2026-11-16",
      "origin": "assistant",
      "targets": {
        "dailyKcal": 2000,
        "deficitKcal": 500,
        "macros": { "proteinG": 170, "carbsG": 180, "fatG": 65, "fiberG": 30 }
      },
      "meals": [
        {
          "id": "cafe",
          "name": "Café da manhã",
          "time": "07:30",
          "kcal": 450,
          "items": [
            { "food": "Ovos inteiros", "amount": 3, "unit": "un" },
            { "food": "Pão integral", "amount": 2, "unit": "fatias" }
          ]
        }
      ],
      "rules": {
        "Hidratação": "Mínimo 3 L de água por dia"
      },
      "executionTips": [
        "Priorize a meta diária de proteína mesmo em dias fora da rotina."
      ]
    },
    "activate": "now"
  }
}
```

- **Ativar ou remover dieta existente (`kind: 'diet_action'`):**

```json
{
  "kind": "diet_action",
  "title": "Ativar plano de manutenção",
  "summary": "Alterna o plano ativo para cutting-manutencao.",
  "reasons": ["Meta de peso atingida"],
  "plan": {
    "diet_id": "cutting-manutencao",
    "action": "activate"
  }
}
```
