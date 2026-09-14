# Spec: fonte única do protocolo de mutação (BACKLOG-12) — v3

> BACKLOG-12 (lacuna 4 da BACKLOG-08): o passo 6 da `treino-coach/SKILL.md` já é ponteiro
> para o `opengym_writer.py` desde 11/09/2026, mas `og_state_mutation.md` continua receita
> manual completa — e a `opengym-workout-pipeline/SKILL.md` ainda manda PUT manual como vigente.
> Investigação por 3 frentes em paralelo concluída em 12/09/2026; revisão da v1 por subagente
> (16 achados) verificada ponto a ponto contra os arquivos vivos — ver Apêndice.

## Contexto e Objetivo

Onde vive: skills do Hermes em `~/.hermes/skills/fitness/` (`treino-coach/SKILL.md`,
`opengym-workout-pipeline/SKILL.md` + `references/og_state_mutation.md`) e repo openGym
(`docs/specs/`, branch `emerson-custom`). Escritor canônico:
`~/.hermes/workout/scripts/opengym_writer.py` (spec `docs/specs/spec_escritor_rotinas.md` v3).

O que muda: `og_state_mutation.md` deixa de ser receita e vira ponteiro para o escritor
(com nota histórica e links de auditoria); a `opengym-workout-pipeline/SKILL.md` passa ao fluxo
do escritor em 4 pontos; a `treino-coach/SKILL.md` ganha path válido em 2 pontos (o diretório
`treino-coach/references/` está vazio — verificado em 12/09 — então "receita em
`references/og_state_mutation.md`" é path quebrado). Nada muda no app, no servidor nem no
escritor — é mudança doc-only.

Por que: a receita manual divergiu do escritor e diverge mais a cada evolução (congela `0585/0599`
incondicionalmente enquanto o escritor já tem `unit` por exercício; não conhece `--target-live`
do incidente de 11/09; não tem portão P2 de `prog`; o handshake "PWA fechado" foi furado em
10/09). Vale a versão que o agente leu por último — e ninguém percebe.

## Escopo

- Inclui:
  - Reescrever `references/og_state_mutation.md` como ponteiro + nota histórica + links de auditoria.
  - `opengym-workout-pipeline/SKILL.md`: parágrafo ROTINA SYNC, seção `Mutating state server-side`,
    entrada `References`, parentético do caminho de leitura, linha da fonte de verdade (§2.1–§2.5).
  - `treino-coach/SKILL.md`: bloco de persistência, nota do passo 6, fronteira L104/L106 (§3.1–§3.3).
  - Verificação por `grep` (5 testes executáveis abaixo).
- Não inclui:
  - Qualquer mudança no `opengym_writer.py`, no `verificar_prescricao.py`, no servidor ou no app.
  - Revalidar mecânica de pesos, catálogo ou `unit` por exercício.
  - Rodar o snapshot (o próximo das 06:00 leva os arquivos; ambos já são cobertos).
  - Apagar histórico: o conteúdo antigo fica no git (`hermes-snapshot`) + backups `.bak` datados.
  - `og_frontend_patches.md:100` (log de deploy datado de 2026-09-03, não receita — verificado),
    `og_data_model.md` (menciona ROTINA SYNC só de nome, sem prescrever fluxo — verificado),
    `treino-coach` L104/L106 (já delegam ao passo 6 — verificado), pipeline L112 (conceitual,
    sem receita — verificado).

## Decisões assumidas

- Ponteiro completo em vez de só carimbar "histórico" no topo mantendo a receita abaixo — receita
  copiável continua sendo lida e seguida; histórico fica no git + resumo no próprio arquivo.
- A `opengym-workout-pipeline/SKILL.md` entra no escopo — sem isso a fonte não é única.
- Sem preview HTML nem mock de UX — mudança doc-only, sem superfície visual no app.
- Prosa do arquivo novo segue allowlist/blocklist: pode dizer que a escrita vai ao servidor via
  script e que o cliente guarda cópia própria (o porquê do fechar/reabrir); NÃO pode conter
  `SECRET`, `HMAC`, `TOKEN`/`token`, `put.js`, `base64url`, `gymsid`, comandos com redirect para
  `state-` nem detalhes de forja — nada que reconstitua a receita à mão.
- Reversão primária por `.bak`, secundária pelo clone do snapshot; carimbo no arquivo novo invalida
  receitas anteriores a 11/09/2026 inclusive em memórias/caches.
- Nenhuma pergunta ao usuário nesta rodada: tudo o que a revisão levantou é detalhe de
  implementação sem efeito visível — decidido aqui e registrado nesta seção.

## Requisitos Funcionais

- RF-1. `og_state_mutation.md` declara a fonte única no topo e não contém nada da blocklist
  (teste T1).
- RF-2. `opengym-workout-pipeline/SKILL.md` descreve ROTINA SYNC como o fluxo de 3 comandos do
  escritor e nenhuma linha manda montar PUT à mão (testes T2/T3).
- RF-3. `treino-coach/SKILL.md` referencia passo 6/escritor com path válido; nenhuma linha manda
  receita via `references/og_state_mutation.md` (testes T2/T3/T4).
- RF-4. Toda menção restante a `og_state_mutation` nas skills é histórica (teste T4: cada linha
  contém `históri`).
- RF-5. Existe 1 backup `.bak` datado por arquivo editado, criado na execução (teste T5).

## Detalhe de Implementação (nível código)

> Backup antes de cada arquivo: `cp ARQ ARQ.bak.$(date +%Y%m%d-%H%M)`.
> Ordem (janela atômica — consumidores primeiro, receita por último): backups → §3 → §2 → §1 → T1..T5.
> Rollback por arquivo: `mv ARQ.bak.<data> ARQ` (primário) ou cópia do clone `/home/pi/hermes-snapshot`
> (secundário). Referências de linha são posição em 12/09/2026; a âncora citada é o que vale.

### 1. `~/.hermes/skills/fitness/opengym-workout-pipeline/references/og_state_mutation.md` — substituição integral

**ANTES:** receita manual completa (90 linhas: forja de sessão, `TOKEN` + `node /tmp/put.js`,
receita C SEM POLIA, live-edit, protocolo hardened).

**DEPOIS** (conteúdo integral, copiar como está; verificado sem blocklist — ver T1):
em zero ocorrências — conferido):

```markdown
# Mutação de estado do openGym — FONTE ÚNICA: `opengym_writer.py` (este arquivo é histórico)

> **Não execute nenhuma receita manual a partir deste arquivo.** Desde 11/09/2026 a única
> forma suportada de escrever o estado (`S.routines[]`, `S.week`, `S.dayPlan`) é
> `~/.hermes/workout/scripts/opengym_writer.py`, no fluxo de 3 comandos:
> `dump --uid <UID> --routine <RID>` → escrever a intenção JSON (§2 da spec)
> → `plan --uid <UID> --intent i.json` (ensaio + portão P1)
> → `apply --uid <UID> --intent i.json --yes`.
> Passo a passo vigente: **passo 6 ROTINA SYNC de `skills/fitness/treino-coach/SKILL.md`**,
> detalhado em **`docs/specs/spec_escritor_rotinas.md` v3** (repo openGym).
> Toda receita de mutação anterior a 11/09/2026 é inválida — inclusive em memórias, caches e
> transcrições antigas; vale este arquivo. O conteúdo original completo está no git
> (repo privado `hermes-snapshot`, histórico de `skills/fitness/opengym-workout-pipeline/`).

## Por que a receita manual foi aposentada (divergências medidas em 12/09/2026)

- Congela peso de `0585`/`0599` incondicionalmente; o escritor já trata `unit: kg|lb` por
  exercício (BACKLOG-01) e a trava cai ao declarar `unit`.
- Não conhece `--target-live` (trava pós-incidente de 11/09/2026, escrita de ensaio atingiu produção).
- Não tem portão P2 (`prog` fora de `off` reprovado) nem ensaio do que a TELA vai mostrar.
- O handshake "PWA fechado confirmado" foi furado em 10/09/2026 (recibo em `reports/sync_log.md`);
  a proteção real é a trava de concorrência (BACKLOG-09).

## Mecanismo em poucas linhas (resumo, não receita)

A escrita vai ao servidor por um script que autentica, valida, escreve uma rotina por vez e
verifica depois; o app guarda cópia própria e um cliente desatualizado pode desfazer a escrita
ao sincronizar — depois de todo `apply`, pedir ao usuário fechar/reabrir o app. O que continua
proibido: editar o arquivo de estado direto no disco (o próximo sincronismo do cliente reverte).

## Onde está a verdade agora (auditoria)

- Escritor: `~/.hermes/workout/scripts/opengym_writer.py` (+ testes `test_escritor_rotinas.py`).
- Spec: `docs/specs/spec_escritor_rotinas.md` v3 (repo openGym, branch `emerson-custom`).
- Portão P1: `~/.hermes/workout/scripts/verificar_prescricao.py` (+ `test_verificar_prescricao.py`).
- Mecânica de pesos: `~/.hermes/workout/MECANICA_PESOS.md`.
- Recibos: `~/.hermes/workout/reports/sync_log.md`.
```

### 2. `~/.hermes/skills/fitness/opengym-workout-pipeline/SKILL.md` — 4 blocos

**2.1 Parágrafo ROTINA SYNC (âncora: `**ROTINA SYNC (2026-09-08):** além de ler`). ANTES:** o texto
atual que manda `via **PUT \`/api/data\` com \`gymsid\` forjado** (receita em
\`references/og_state_mutation.md\`...)`. **DEPOIS:**

```markdown
- **ROTINA SYNC (fonte única desde 12/09/2026):** além de ler, o planner TAMBÉM escreve as rotinas template quando há microciclo novo — **somente** via `~/.hermes/workout/scripts/opengym_writer.py`, no fluxo `dump --uid <UID> --routine <RID>` → intenção JSON → `plan` (ensaio + portão P1) → `apply --yes` (1 escrita por rotina + verificação + recibo). A receita manual antiga (`references/og_state_mutation.md`) é histórico. Mapa `S.week`: `0`=Legs2, `2`=Push C, `3`=Legs1, `4`=Upper C, `6`=Pull C. Passo a passo vigente no `treino-coach` skill (FLUXO, passo 6 ROTINA SYNC). Após o `apply`, avisar o usuário pra fechar/reabrir o PWA.
```

**2.2 Seção `Mutating state server-side` (âncora: `## Mutating state server-side (2026-08-29)`).
ANTES:** o texto atual com `forged-\`gymsid\` PUT flow — full recipe...`. **DEPOIS:**

```markdown
## Mutating state server-side (fonte única desde 12/09/2026)
Direct file edit of `state-<uid>.json` is reverted by the PWA's next sync. All writes go
through `~/.hermes/workout/scripts/opengym_writer.py` (`dump` → `plan` → `apply --yes`) —
see `treino-coach` skill, passo 6 ROTINA SYNC. `references/og_state_mutation.md` is history only (histórico).
After any server-side mutation, tell the user to close/reopen the PWA before editing.
```

**2.3 Entrada `References` (âncora: `` `references/og_state_mutation.md` — **how to mutate ``).
ANTES:** `... — **how to mutate \`state-<uid>.json\` via \`PUT /api/data\`** with a forged \`gymsid\`
(SECRET + HMAC) — the only durable method; file-edit race explained.` **DEPOIS:**

```markdown
- `references/og_state_mutation.md` — **histórico** (receita manual aposentada em 12/09/2026; fonte vigente: `opengym_writer.py`, passo 6 da `treino-coach/SKILL.md`). Mantido para auditoria.
```

**2.4 Parentético do caminho de leitura (âncora: `**Fonte preferida (2026-09-09, spec v3):**`).
ANTES:** `(com `gymsid` forjado via `SECRET`/`HMAC`, mesmo de `og_state_mutation.md`, ...`.
**DEPOIS:** `(com `gymsid` forjado para leitura autenticada — mesmo mecanismo resumido em
`references/og_state_mutation.md` (histórico), ...` — troca só o trecho `mesmo de
`og_state_mutation.md``; a forja ali vale só para o `GET` (escrita é só via escritor, §2.1).
O resto do parágrafo (leitura via `GET /api/coach/analysis`, fallback HD) fica igual.

**2.5 Linha da fonte de verdade (âncora: `é fonte de verdade (fallback HD`). ANTES:** `` `GET
/api/coach/analysis` (`api/coach.js`) + `PUT /api/data` é fonte de verdade `` (no parágrafo do
Sheets descontinuado). **DEPOIS:** `` `GET /api/coach/analysis` (`api/coach.js`) + escrita via
`opengym_writer.py` (passo 6 ROTINA SYNC) é fonte de verdade `` — o transporte continua sendo o
PUT, mas a frase deixa de autorizar PUT à mão. Resto do parágrafo igual.

### 3. `~/.hermes/skills/fitness/treino-coach/SKILL.md` — 3 pontos

**3.1 Bloco de persistência (âncora: `**Estado das rotinas (persistência):**`). ANTES:** `(via
\`gymsid\` forjado, receita em \`references/og_state_mutation.md\`)`. **DEPOIS:** `(escrita só via
\`~/.hermes/workout/scripts/opengym_writer.py\`, passo 6 ROTINA SYNC abaixo)`. Resto do bloco igual.

**3.2 Nota do passo 6 (âncora: `continua em `references/og_state_mutation.md` apenas como histórico`).
ANTES:** `continua em `references/og_state_mutation.md` apenas como histórico do mecanismo (sessão
forjada por HMAC do SECRET).` **DEPOIS:** `continua em
`skills/fitness/opengym-workout-pipeline/references/og_state_mutation.md` apenas como histórico
do mecanismo.` — corrige o path quebrado (`treino-coach/references/` está vazio) e remove o
detalhe de forja (está na blocklist do arquivo histórico, não aqui).

**3.3 Fronteira TREINADOR/PLANILHEIRO (âncoras: `SINCRONIZA routines template via PUT` e
`sincronizar `routines[]` template via PUT`). ANTES (2 linhas): `... via PUT` (passo 6 ROTINA
SYNC — única escrita permitida)` e `... via PUT` (passo 6 ROTINA SYNC).` **DEPOIS:** trocar
`via PUT` por `via passo 6 ROTINA SYNC (escritor)` nas duas, mantendo o resto — o verbo PUT ali,
mesmo apontando ao passo 6, consagra o transporte como se fosse o método.

### 4. Testes manuais (T1..T5 — copiar e rodar; todos saem 0)

```bash
OG=~/.hermes/skills/fitness/opengym-workout-pipeline/references/og_state_mutation.md
PL=~/.hermes/skills/fitness/opengym-workout-pipeline/SKILL.md
TC=~/.hermes/skills/fitness/treino-coach/SKILL.md
# T1 — receita morta no og (blocklist; vazio = OK):
grep -rEi 'put[.]js|base64url|secret|hmac|token|gymsid|echo[[:space:]]*>.*state-' "$OG" && exit 1 || echo T1-OK
# T2 — ponteiro presente nos 3 arquivos:
for f in "$OG" "$PL" "$TC"; do grep -c 'opengym_writer[.]py' "$f" || exit 1; done && echo T2-OK
# T3 — PUT manual morto nos 2 SKILLs (vazio = OK):
grep -rEn 'PUT .*/api/data.*forjad|receita em .references/og_state_mutation' "$PL" "$TC" && exit 1 || echo T3-OK
# T4 — menção restante é só histórica (vazio após filtro = OK):
grep -rn 'og_state_mutation' ~/.hermes/skills/fitness --include='*.md' --exclude='*.bak*' --exclude='og_state_mutation.md' | grep -vi 'históri' && exit 1 || echo T4-OK
# T5 — 1 backup datado por editado:
ls "$OG".bak.* "$PL".bak.* "$TC".bak.* && echo T5-OK
```

Notas de execução: T1 usa `grep -rEi` (case-insensitive; sem barras — classe [.] em vez de ponto com escape, sem fronteira de palavra: blocklist propositalmente ampla). T4 exclui `.bak` como cinturão extra (com `--include='*.md'` o `.bak` já cai fora) e filtra com -i (cobre `Histórico` com maiúscula). Inventário aceito de menções a PUT como transporte (T3 não cobre, de propósito): §3.1 DEPOIS e GET autenticado nas linhas de leitura — nenhum ensina PUT à mão.
`putXjs`; barra dupla procuraria barra literal e quebraria o teste). T4 exclui `.bak` como
cinturão extra (com `--include='*.md'` o `.bak` já cai fora) e filtra com `-i` (cobre
`Histórico` com maiúscula). Inventário aceito de menções a PUT como transporte (T3 não cobre,
de propósito): §3.1 DEPOIS (`GET/PUT https://...`, escrita qualificada) e `GET` autenticado nas
linhas de leitura — nenhum deles ensina PUT à mão.

## Rollout e reversão

- Ordem: backups `.bak` datados dos 3 arquivos → §3 → §2 (blocos 2.1→2.5) → §1 → T1..T5.
  Consumidores primeiro, receita por último: em nenhum momento um ponteiro aponta para conteúdo
  que não existe mais. `done` = T1..T5 verdes.
- Reversão primária por arquivo (`mv ARQ.bak.<data> ARQ`), secundária pelo clone
  `/home/pi/hermes-snapshot`. Sem efeito no app/servidor em nenhum cenário (doc-only).
- Risco residual: sessão de agente antiga citando a receita de memória — mitigado pelo carimbo
  de invalidez no arquivo novo; sem ação adicional. Precedente conhecido sem carimbo próprio:
  `og_frontend_patches.md:100` (log de deploy datado de 2026-09-03 com PUT manual de `confirmTopWeight`)
  continua como está por ser log datado, não receita — aceito como risco residual explícito.

## Relação com outras specs + fora de escopo registrado

- `docs/specs/spec_escritor_rotinas.md` v3 (fonte declarada, inalterada) ·
  `docs/specs/spec_api_rotinas.md` · BACKLOG-02/09 (consomem o escritor) · BACKLOG-08 (lacuna 4).
- Fora de escopo registrado: política `double` com template em faixa e `checkState` sem validar
  `weight`/`reps` (herdado da BACKLOG-06, inalterado).

## Apêndice — revisões (v1: 16 achados; v2: 10 achados, todos verificados em bash)

| Achado | Veredito | Efeito na v2 |
|---|---|---|
| F01 âncora L46 errada / referenciar por heading | Procede em parte | Blocos por âncora citada; linhas como posição datada |
| F02 L104/L106 mandam PUT sem writer | Não procede — delegam ao passo 6 | Registrado em Não inclui, sem mudança |
| F03 L94/L112 PUT manual fora do escopo | Parcial — L94 é leitura, L112 conceitual | L94 ganha qualificador histórico (bloco 2.4); L112 sem mudança |
| F04 T3 falso-negativo | Procede | T3 com regex dos textos reais |
| F05 T2 subespecificado | Procede | T2 em loop por arquivo com falha |
| F06 T1 inexequível/insuficiente | Procede | T1 com path, flags, escape, blocklist; RF-1 alinhada |
| F07 T4 inexequível + `.bak` | Procede | T4 exato com excludes + filtro `históri` |
| F08 auditoria perde conteúdo | Procede | Seção de links de auditoria no DEPOIS |
| F09 allowlist/blocklist da prosa | Procede | Decisão + DEPOIS em conformidade (zero ocorrências) |
| F10 path quebrado treino-coach→og | Procede — `treino-coach/references/` vazio | Blocos 3.1/3.2 com path válido |
| F11 triângulo não fecha | Procede | 3 arquivos citam writer + spec v3 pinada |
| F12 ordem de rollout | Procede | Consumidores primeiro (§3→§2→§1) |
| F13 RF-4/RF-5 não mensuráveis | Procede | RFs = testes; T5 por existência de `.bak` |
| F14 `og_frontend_patches`/`og_data_model` escaparam | Não procede — log datado / menção nominal | Não inclui, com motivo |
| F15 tamanho prescrito / anti-padrão sem teste | Procede | Requisitos de conteúdo; anti-padrão em palavras |
| F16 | leve | Doc-only + reversão por `mv` + risco memória | Procede | Rollback secundário + carimbo de invalidez |

### 2ª revisão (v2 → v3, 10 achados — veredito após execução em bash em 12/09)

| Achado | Veredito | Efeito na v3 |
|---|---|---|
| R2-01/R2-02 escapes `\\.` quebram T1/T2 | Procede em espírito, causa trocada: a exibição duplica barras; o risco real é copiar do renderizado — eliminado com `[.]` sem barras | T1/T2 sem nenhuma barra; T1 executado verbatim do arquivo contra o `og` vivo: detecta (vermelho correto) |
| R2-03 `token` no DEPOIS viola blocklist | Procede — `token de concorrência` no texto novo | `trava de concorrência`; DEPOIS da v3 re-checado contra T1 |
| R2-04 `is history only` sem `históri` reprova T4 | Procede | `(histórico)` anexado |
| R2-05 T3 não enxerga PUTs sem `forjad` | Procede parcial — T3 caça receita, não transporte | L104/L106 e L112 qualificados (§3.3, §2.5); inventário aceito declarado nas notas |
| R2-06 F02 "não procede" excessivo (L104/L106) | Procede | F02 rebaixado a parcial; §3.3 incluído |
| R2-07 L112 autoriza PUT à mão | Procede | §2.5 incluído |
| R2-08 forja em L94 sem dizer que é só leitura | Procede | §2.4 explicita `GET` |
| R2-09 `frontend_patches:100` sem carimbo | Parcial — log datado, não receita | Risco residual explícito, sem tocar o arquivo |
| R2-10 T4 case-sensitive + exclude redundante | Procede | `-i`; nota corrigida |
