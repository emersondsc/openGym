# MESO — o mesociclo no openGym (o que é, onde mora e quem escreve)

> Documento permanente. Serve para **o usuário, o agente do Hermes e qualquer sessão futura**
> entenderem o mesociclo **como ele está implementado hoje**, sem reler a spec nem o código.
>
> - Contrato completo e decisões de produto: `docs/specs/spec_meso_no_app.md`
> - Desenho que originou a spec (objeto, biblioteca, protótipo da tela): `DESENHO_MESO.md`, no
>   espelho local do usuário
> - O micro (a semana publicada, que é outra coisa): `docs/MICRO.md`
> - A API de rotinas: `docs/ROTINAS_API.md`

Última conferência contra o código: **13/09/2026** — `emerson-custom`.
Suítes: `api/meso.test.js` (35 testes) e `frontend/src/lib/meso.test.js` + `meso-file.test.js`
(37 testes), rodando pelo alvo `test` da imagem da API e pelo `vitest` no frontend.

---

## 1. O que é (e o que não é)

Um **mesociclo** é o bloco de treino de 4 a 8 semanas: o que ele persegue, quantas semanas tem,
qual a fase de cada uma, e o que o coach registrou ao longo do caminho. Ele **não** é a semana: a
semana (rotinas + dias) é o **micro**, publicado separado, por `POST /api/plan/micro` (ver
`docs/MICRO.md`).

Quem escreve o quê:

| O que | Dono | Como |
|---|---|---|
| Biblioteca e ponteiro do ativo | **o app** (o usuário) | `update()` no store → `PUT /api/data` |
| Mesociclo publicado pelo agente | **o assistente** | `PUT /api/plan/meso` (rota própria, validada e auditada) |
| Ponteiro do ativo movido pelo agente | **o assistente** | `activate: "now"` no `PUT` ou `POST /api/plan/meso/:id/activate` |
| Semana e rotinas | **o assistente** | `POST /api/plan/micro` (BACKLOG-02) |

**A API é overwrite total.** `PUT /api/plan/meso` substitui o mesociclo daquele `id`, inteiro, sem
comparar com o que estava lá e sem nenhuma regra sobre quem escreveu. Quem coordena é o assistente,
lendo o mesociclo antes de escrever — isso é política dele, não da API.

---

## 2. O objeto

```json
{
  "id": "meso-2026-09-02",
  "name": "Mesociclo 2 · Low Volume",
  "start": "2026-09-02",
  "end": "2026-09-30",
  "goal": "uma linha",
  "origin": "assistant",
  "priorities": { "lower": "glúteos", "upper": "deltoide lateral" },
  "rules": { "Reps alvo": "6-8", "Intensidade": "falha só em máquina guiada" },
  "weeks": [
    { "n": 1, "start": "2026-09-02", "end": "2026-09-07", "phase": "calibração", "log": "o que aconteceu" },
    { "n": 2, "start": "2026-09-08", "end": "2026-09-14", "phase": "progressão leve", "plan": "o planejado" }
  ],
  "evidence": "por que este mesociclo existe",
  "log": [ { "date": "2026-09-10", "text": "…" } ],
  "activatedBy": "assistant",
  "activatedAt": "2026-09-13T16:00:00Z",
  "updatedAt": "2026-09-13T16:00:00Z"
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `id` | sim | `^meso-\d{4}-\d{2}-\d{2}(-[a-z0-9]{1,8})?$` — a data é o início; o sufixo
  curto (`meso-2026-09-13-2`) existe para **dois mesociclos começarem no mesmo dia**, que é
  legítimo e antes sobrescrevia o primeiro |
| `name` | sim | 1..120 caracteres |
| `start` | sim | ISO `AAAA-MM-DD`, data real do calendário |
| `end` | sim no corpo | ≥ `start` |
| `weeks[]` | sim no corpo | 1..52; `n` **sequencial de 1 a N**; em ordem crescente; `start` ≤ `end` por semana; dentro de `start..end` do mesociclo |
| `phase` | não | ≤ 80 caracteres (o dado real tem 41) |
| `goal` | não | ≤ 400 caracteres |
| `origin` | não | `"user"` \| `"assistant"` |
| `priorities` | não | `{ lower?, upper? }`, texto livre |
| `rules` | não | ≤ 40 pares; rótulo ≤ 40 e valor ≤ 600 caracteres |
| `evidence` | não | texto livre |
| `log[]` | não | ≤ 200 itens `{ date, text }` |
| `activatedBy` / `activatedAt` | não | **escritos pela API**, nunca pelo corpo publicado |
| extras | não | qualquer chave desconhecida, em qualquer nível, **preservada como veio** |

**Nada é reescrito em silêncio.** O import (e o formulário) corta o que passa dos limites e **anota
o corte** no resumo; a API **recusa** com `400`. O app nunca grava no estado um mesociclo que a API
recusaria — um `400` no `PUT /api/data` deixaria a escrita pendente para sempre, e com ela treino,
rotina e peso.

**Teto:** 64 KB por mesociclo e 40 mesociclos na biblioteca (os dois valem no `PUT /api/data` e na
rota do assistente).

**Datas:** semana com `start`/`end` próprios porque elas não têm sempre 7 dias — a S1 do mesociclo
real tem 6 e a S4 tem 9. "Hoje", para decidir semana atual/terminado, é sempre
`America/Sao_Paulo` (`todayInMeso()`), não o fuso do aparelho.

---

## 3. As rotas

Todas exigem sessão do dono; a assinatura de agente (`X-OG-Actor` + `X-OG-Actor-Sig`) é opcional e,
quando vem, é **verificada** — é ela que faz `activatedBy` virar `"assistant"`.

### `PUT /api/plan/meso`

```json
{ "meso": { …o objeto acima… }, "activate": "none" }
```

- `If-Match: <rev lido>` **obrigatório** (`428` sem ele, `409 STALE_STATE` com base velha).
- Ordem das checagens: sessão → corpo → `If-Match` → forma → teto → gravação.
- `201` na criação, `200` na substituição. `meta`: `{ mesoId, created, activated, activate }`.
- `activate: "now"` move o ponteiro (`S.activeMeso`, guardando o anterior em `S.mesoPrev`) e carimba
  `activatedBy`/`activatedAt`. **Os dois carimbos nunca vêm do corpo**: a rota apaga o que veio e
  escreve o que ela mesma sabe.
- Recusas: `400 MESO_REQUIRED/BAD_MESO_ID/BAD_MESO_NAME/BAD_MESO_START/BAD_MESO_END/BAD_MESO_ORIGIN/
  BAD_MESO_GOAL/BAD_MESO_WEEKS/BAD_MESO_WEEK/BAD_MESO_WEEK_N/BAD_MESO_WEEK_DATE/BAD_MESO_WEEK_ORDER/
  BAD_MESO_WEEK_RANGE/BAD_MESO_PHASE/BAD_MESO_RULES/BAD_MESO_LOG/MESO_TOO_BIG` · `409 TOO_MANY_MESOS`
  · `409 NO_STATE` · `401 UNAUTH` · `428 IF_MATCH_REQUIRED` · `412`/`400` de `If-Match`.

### `GET /api/plan/meso`

`{ mesos, activeMeso, mesoPrev, rev, _ts }` — é o `dump` do escritor. `404 NO_STATE` sem estado.

### `POST /api/plan/meso/:id/activate`

Ativa o mesociclo (o atalho que só mexe no ponteiro). `409 MESO_NOT_FOUND` devolve `mesos: [ids]`.

**Não existe `Idempotency-Key` aqui**: o `PUT` é um upsert por `id`, idempotente por construção.

### Auditoria

Toda escrita entra no `audit.jsonl` (`action: put-meso` / `activate-meso`, com `uid`, `mesoId`,
`created`, `activated`, `actor`, `verified`, `rev` antes/depois) e sai uma linha no stdout:

```
[og-meso] op=put-meso uid=… meso=meso-2026-09-02 created=true activated=false rev=3->4
```

---

## 4. No app

- **Biblioteca e ponteiro:** `S.mesos[]`, `S.activeMeso`, `S.mesoPrev`. Nada é apagado: trocar de
  ativo só move o ponteiro, e "voltar ao anterior" é a mesma ativação.
- **Painel na aba Plan:** nome, `semana N de M` e a fase da semana atual. Mesociclo vencido continua
  ativo, marcado `terminado`, com a oferta do próximo (criar ou importar).
- **Tela do mesociclo** (`/plan/meso/:id`): trilha das semanas, o que foi planejado e registrado,
  objetivo, prioridades, regras (três + "ver todas"), evidência, histórico do coach e **extras** —
  cada seção só renderiza quando tem dado.
- **Lista** (folha "Mesocycles"): tocar **ativa**, o `>` abre a tela.
- **Import/export:** JSON (round-trip fiel, extras incluídos) e CSV (subconjunto declarado: leva
  semanas, objetivo, focos, evidência e regras; **não** leva `log[]`, carimbos de ativação nem
  extras do mesociclo). O import aceita um objeto, uma lista ou `{ "mesos": [...] }`, deriva o que
  falta (anotando), preserva campo desconhecido em qualquer nível, recusa item sem núcleo **pelo
  nome** e pergunta antes de substituir um `id` existente.
- **Visão crua** (`/plan/raw?id=<meso>`, no navegador `#/plan/raw…`): **só o mesociclo** — o JSON
  como o app guarda, só leitura, com copiar e compartilhar (o arquivo `<id>.json`, que o import
  aceita de volta). Os escopos de plano e de estado inteiro **foram retirados** (13/09/2026): o
  plano não é um objeto guardado e o estado inteiro é o backup, que vive em Settings. Ver
  `docs/specs/spec_visao_json_meso.md`.

### Onde as coisas moram

| O que | Caminho |
|---|---|
| Modelo e derivações | `frontend/src/lib/meso.js` |
| Import/export | `frontend/src/lib/meso-file.js` |
| Tela, lista, formulário, resumo do import | `frontend/src/views/MesoEdit.jsx`, `PlanRaw.jsx`, `sheets.jsx` |
| Validação e rotas | `api/meso.js`, `api/server.js` |
| Testes | `api/meso.test.js`, `frontend/src/lib/meso.test.js`, `meso-file.test.js` |

---

## 5. O que ainda não existe

- **O botão que gera a semana** (`Gerar micro S(n)`): o lugar está reservado no painel e na tela; a
  geração é o BACKLOG-02 (`docs/MICRO.md`).
- **Rotinas não pertencem a mesociclo**: o id (`r_push_S2_af8c`) não diz de onde veio, então a lista
  de rotinas não filtra por mesociclo.
- **A biblioteca não tem livro-caixa**: um mesociclo editado no app e também no servidor volta para
  a versão do servidor na próxima mescla (as rotinas têm; o mesociclo não, de propósito).
