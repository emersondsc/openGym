# Spec: Catálogo único de exercícios — v3 (final)

**Projeto:** openGym (fork `emerson-custom`) — `hermes:/mnt/drivebackup/apps/openGym/openGym`
**Stack:** frontend React 19 + Vite 8 (bundlado numa imagem nginx) · API Node 22 ESM sem framework · agente Hermes (Python 3.12) em `/home/pi/.hermes`
**Data:** 11/09/2026 · **Status:** v3 final — duas rodadas de revisão incorporadas (21 + 12 achados)
**Revisão 1:** 21 achados, 7 bloqueantes → `## Achados da revisão 1 (consolidação)`
**Revisão 2:** 12 achados, 1 bloqueante (uma justificativa minha, não o desenho) → `## Achados da revisão 2 (consolidação)`

---

## Contexto e Objetivo

A mesma lista de 1324 exercícios existe hoje em **seis lugares**, em dois formatos e com dois nomes de campo diferentes para a mesma coisa. Cada leitor lê uma cópia:

| # | Arquivo | Quem lê | Formato | Tamanho |
|---|---|---|---|---|
| 1 | `frontend/src/lib/exercises-data.js` | o app (todas as telas) | ESM, `export const EXDB=[…]` | 888.191 B |
| 2 | `api/exercise_catalog.json` | a API (`routines.js`, `coach.js`, `server.js`) | JSON | 259.429 B |
| 3 | `~/.hermes/skills/fitness/treino-coach/references/exercise_catalog.json` | o agente, por prosa da skill | JSON | 259.429 B |
| 4 | `~/.hermes/skills/fitness/treino-coach/references/catalog_summary.json` | **ninguém** | JSON | 669 B |
| 5 | `~/.hermes/workout/data/opengym_exmap.json` | `opengym_reader.py` (caminho legado) | JSON | 1324 × `{n,eq}` |
| 6 | `~/.hermes/profiles/treinador/skills/…/references/{exercise_catalog,catalog_summary}.json` | **ninguém** (profile que rodou ~40 min em 07/09) | JSON | idem 3 e 4 |

A prova de que isso dói já existe neste repositório: em 11/09 foram corrigidos **quatro nomes** com um caractere cirílico `в` colado antes do `°` (`0738`, `0739`, `0740`, `0742`) — e a correção teve de ser aplicada em **cinco arquivos** (commit `422002a`), porque não havia uma fonte. A origem das cópias também está provada por hash: `api/exercise_catalog.json` no commit `7b6a1bb` é **byte-idêntico** (`10d6d782c61b3107…`, 259.437 B) à extração que o agente fez do bundle do app em 29/08 — a API lê uma **cópia tirada do app**, não uma fonte.

**Objetivo:** passar a existir **um único arquivo** com a lista de exercícios, versionado no repositório, lido por todos os consumidores — app, API e agente — sem cópia intermediária, sem resumo derivado e sem espelho. Ninguém escreve nele em produção; o agente **só lê** para consultar.

**Decisões do usuário (11/09/2026):**
- O arquivo canônico é **`frontend/src/lib/exercises-data.json`** — o arquivo do app, no diretório do app. A API passa a ler o arquivo do app.
- O formato passa a ser **JSON puro**, e não `.js`: os dois leitores não-JavaScript (Node e Python) passam a usar o leitor nativo de cada linguagem, em vez de um parser caseiro de "JSON dentro de uma casca de JavaScript". Essa abordagem já foi tentada neste projeto — o script `opengym_export_exmap.mjs` faz `await import()` no `.js` — e o resultado dela foi a **cópia nº 5**.
- **Arquivo ausente ou ilegível = o servidor não sobe** (pergunta 1, resposta A).
- **A conferência do catálogo é manual**, não barra o build (pergunta 2, resposta A).
- **As cópias antigas vão para uma pasta de aposentados**, não são apagadas (pergunta 3, resposta A).

> **Não é escopo deste trabalho** melhorar, atualizar ou sincronizar a base de exercícios com o projeto original (`hasaneyldrm/exercises-dataset`). O conteúdo continua sendo o mesmo de hoje, byte a byte, exceto pelo envelope.

---

## Escopo

**Inclui**
1. Criar `frontend/src/lib/exercises-data.json` a partir do `.js` atual (1324 entradas, 10 campos, envelope removido).
2. Ajustar o import no app (`frontend/src/lib/exercises.js`) e o comentário de `scripts/build-instructions.mjs`.
3. Fazer a API ler o arquivo canônico: novo `api/catalog.js`, contexto de build da raiz no `docker-compose.yml`, `api/Dockerfile` com a árvore espelhada, `.dockerignore` novo na raiz.
4. Memoizar o catálogo no `api/coach.js` — hoje o arquivo é lido **duas vezes**, uma delas dentro de `rowsFromState()`, ou seja **uma vez por requisição** de análise.
5. Corrigir o nome do campo no `api/coach.js`: `e.name` → `e.n`.
6. Apontar `opengym_writer.py` e `verificar_prescricao.py` para o arquivo canônico; fazer `opengym_reader.py` ler o canônico em vez do mapa derivado.
7. Aposentar as cópias 2, 3, 4, 5, 6 e o gerador `opengym_export_exmap.mjs`.
8. Reescrever o trecho de catálogo da `treino-coach/SKILL.md`: caminho único, **somente leitura**, proibição explícita de copiar/espelhar/resumir, e o campo do nome passando a ser `n` em todas as menções ao dataset.
9. Novo `scripts/check-exercises.mjs` (verificação estrutural + de mídia) com `--fix` para o defeito de caractere homoglifo.
10. Fechar o BACKLOG-04 em `docs/backlog.md` e corrigir o nome do arquivo em `NOTICE.md`.

**Não inclui**
- Reescrever ou converter histórico de treino, unidades de peso, ou qualquer item da BACKLOG-01 (já entregue).
- Baixar mídia faltante, ou copiar `img/`/`gif/` para dentro de imagens Docker.
- Tirar a pasta `media/` (137 MB) do controle de versão. **Registrado como achado fora de escopo** — ver R-9.
- Fazer o agente **escrever** no catálogo (exercício custom continua sendo `S.customEx` no estado do usuário).
- Mexer no upstream: nenhum PR, nenhuma mudança no projeto original.
- Reescrever o texto de specs históricas (`docs/specs/*`) — são registro datado. Ganham nota de rodapé, e só onde o texto contém uma **receita operacional** ainda em uso.

---

## Decisões assumidas

Todas são detalhe de implementação: decidi sozinho e registro aqui para não ocupar o usuário.

- **A1 — O esquema canônico é o do app**, com `n` (nome curto), `mg`, `sm`, `st`, `img`, `gif`. O catálogo da API usava `name`; a API muda duas linhas e passa a ler `n`. *Rejeitado* emitir os dois campos (`n` **e** `name`): dois nomes para o mesmo dado é a mesma doença que esta spec cura.
- **A2 — JSON puro**, sem comentários e sem envelope. A documentação dos campos vive nesta spec e no cabeçalho de `scripts/check-exercises.mjs`.
- **A3 — A árvore dentro da imagem espelha o repositório**: `/app/api/…` para o servidor e `/app/frontend/src/lib/exercises-data.json` para o catálogo, com `WORKDIR /app/api`. Assim o caminho relativo `../frontend/src/lib/exercises-data.json` é o mesmo no Pi e dentro do container — não há um segundo caminho para ninguém decorar.
- **A4 — `OG_CATALOG` continua existindo** como override de ambiente. É o que permite aos testes apontarem um catálogo de fixture sem tocar no arquivo real.
- **A5 — Um leitor próprio no lado da API**: novo `api/catalog.js` com `CATALOG_PATH`, `CATALOG_EXPECTED`, `loadCatalog`, `catalogEq`, `__resetCatalogCache`. Motivo real (corrigido na revisão 1): `api/server.js` importa `coach.js` na **linha 12** e `routines.js` na **linha 14**; como módulos ESM são avaliados na ordem dos imports, um `coach.js → routines.js` seria avaliado **antes** de `routines.js` terminar de carregar, e o `coach.js` executaria `loadCatalog` num módulo ainda incompleto. `routines.js` **não** importa `coach.js` (conferido: zero ocorrências de `coach` no arquivo) — não há ciclo hoje, mas há dependência de ordem, e ela some com um terceiro módulo que só depende de `node:fs` e `node:path`. `api/routines.js` passa a **importar e re-exportar** essas funções (ver item 5 — só re-exportar quebraria `routines.js:427`, que chama `loadCatalog(catalogPath)` por nome local).
- **A6 — `CATALOG_EXPECTED = 1324` num só lugar** (`api/catalog.js`, exportado). O script de verificação importa essa constante em vez de repetir o número. O lado Python mantém a constante própria (`opengym_writer.py:54`) porque não há como compartilhar entre linguagens — duplicação conhecida e registrada em R-5.
- **A7 — Contagem divergente é aviso; arquivo ausente é fatal.** Arquivo ausente, ilegível, JSON inválido ou vazio → `process.exit(1)`. Contagem diferente de `CATALOG_EXPECTED` → aviso e o servidor sobe. Motivo: hoje `loadCatalog` engole o erro e devolve `null`, e nesse estado a API aceita exercício inexistente na validação de rotina *e* devolve o id numérico no lugar do nome na análise — as duas degradações são silenciosas. `spec_api_rotinas.md` (A12) já exigia "carregado uma vez, no boot, com falha alta". **Decisão do usuário (pergunta 1, resposta A).**
- **A8 — Contagem divergente não aborta.** A base pode legitimamente crescer (é o aviso do RF-7), e travar o boot por isso trocaria uma divergência cosmética por um serviço fora do ar. *Corrigido na revisão 2 (G01): a justificativa anterior dizia que "o boot do servidor nos testes vê 4 entradas e não 1324" — **é falso**.* A ordem real, medida, é: `routines.test.js:22` importa `routines.js`; `:23` importa `server.js`, o que avalia `coach.js` (que `server.js` importa na linha 12) e faz a primeira `loadCatalog(CATALOG_PATH)` — **o arquivo canônico real, com 1324**; só depois, em `:33-34`, o teste reseta o cache e carrega o fixture de 4 entradas. O que muda com o cache por caminho (A9) é que `checkRoutineFields` (`server.js:271`), que pede `CATALOG_PATH`, passa a **recarregar o canônico** em vez de receber o fixture de carona — comportamento mais correto, e o teste `CATALOG_UNKNOWN_EX` continua passando porque `zzz_ghost` não está em nenhum dos dois. **Por isso a suíte da API precisa ser rodada e conferida no item 20.13, e não presumida.**
- **A9 — A memoização é por caminho, não "primeira chamada vence".** `loadCatalog(p)` guarda o par `(p, mapa)`: chamar de novo com o **mesmo** caminho devolve o cache; chamar com **outro** caminho carrega aquele. Sem isso, o argumento de `routines.js:427` seria silenciosamente ignorado (achado F02 da revisão 1) e o `OG_CATALOG` dos testes perderia o efeito.
- **A10 — O `st` (as instruções em inglês, ~630 KB dos 888 KB) fica no arquivo canônico.** O app precisa dele como fallback (`frontend/src/lib/i18n.js:40`); a API e o agente ignoram. Sem ele não haveria fonte única.
- **A11 — `scripts/check-exercises.mjs` roda por linha de comando**, como o precedente `frontend/scripts/check-locales.mjs`. Não barra o build. **Decisão do usuário (pergunta 2, resposta A).**
- **A12 — A mídia é conferida contra `<raiz do repo>/media` por padrão.** Correção da revisão 1: eu havia escrito que essa pasta "não é a que serve o app" — **é falso**. Medido: `openGym/media/img` tem **1324** arquivos e `media/gif` tem **1324**, a mesma contagem de `/mnt/drivebackup/apps/openGym/media`, que é o volume montado no container `web`. O `--media <dir>` existe para conferir o volume do Pi explicitamente, não porque o default esteja errado.
- **A13 — `--fix` corrige exatamente uma classe de defeito**: caractere homoglifo cirílico/grego colado antes do `°` nos nomes. **Homoglifo em outra posição é erro fatal e não é corrigível automaticamente** — o script nomeia o id e diz "corrija à mão"; não há tentativa de adivinhar. `--fix` não reordena, não renomeia, não mexe em peso de campo e não baixa mídia. Sempre grava backup ao lado (`.bak.<timestamp>`).
- **A14 — O script separa avisos de erros.** Contagem divergente de `CATALOG_EXPECTED` é **aviso** e não afeta o código de saída (fecha F05: A7 diz que a base pode crescer, e o critério de aceite não pode contradizer isso). Problemas estruturais (JSON inválido, id repetido, campo ausente, mídia faltando, homoglifo) são **erros** e devolvem `1`.
- **A15 — O script confere sempre o caminho canônico.** Se `OG_CATALOG` estiver definido no ambiente, ele avisa em uma linha que ignora o override (o override é para testes, não para uma conferência do repositório) e segue com o caminho canônico. Descarta o risco de o script validar um arquivo e ler a contagem de outro (F03).
- **A16 — Nada é apagado de vez no Pi.** As cópias aposentadas vão para `/home/pi/.hermes/workout/_retired_catalogs_20260911/` preservando o caminho relativo. No repositório, `api/exercise_catalog.json` sai por `git rm`. **Decisão do usuário (pergunta 3, resposta A).**
- **A17 — A API continua publicando `503 CATALOG_UNAVAILABLE`** na escrita de rotina quando o catálogo não carregou (`api/routines.js:428`, intocado). Com A7 esse estado deixa de ser alcançável em produção, mas o caminho fica como rede de segurança.
- **A18 — O teste do catálogo canônico é um arquivo novo**, `api/catalog.test.js`, e **não chama `loadCatalog`** — lê o arquivo com `fs.readFileSync(CATALOG_PATH)` + `JSON.parse`. A segurança dele vem **disso**, não de isolamento: a ordem em que o `node --test` avalia arquivos de teste não é garantida, e o cache de `api/catalog.js` é compartilhado por todos os arquivos do mesmo processo. Como este teste nunca toca no cache, ele é correto sob qualquer ordem (fecha F10; reescrito após G05).
- **A28 — `catalogEq` passa a receber o caminho.** `catalogEq(id, catalogPath = CATALOG_PATH)` continua sendo um *peek* (não dispara carga), mas só enxerga o mapa quando `_loadedPath` é o caminho pedido — antes ele lia o mapa global, que é o do **último** caminho carregado. Hoje é código morto no repositório (`grep -n catalogEq api/*.js` só acha a definição), mas deixá-lo cego ao caminho seria reintroduzir a mesma classe de defeito que F02/F12 fecharam (fecha G02).
- **A29 — O segundo `SKILL.md` recebe a mesma correção.** Existe uma cópia morta em `~/.hermes/profiles/treinador/skills/fitness/treino-coach/SKILL.md` (conteúdo **diferente** do editado: 33.564 B de 07/09, contra 36.559 B de 11/09) que ainda manda ler `references/exercise_catalog.json` nas linhas 34 e 56 e usa `name` como campo em 8 linhas. O item 16 aposenta os catálogos **daquele** `references/`, mas deixaria a prosa velha apontando para o vazio. Decisão: depois das doze edições, **copiar o `SKILL.md` atualizado por cima da cópia do profile** — uma linha, e se o profile for revivido algum dia ele nasce correto (fecha G03).
- **A30 — `--media` sem valor é erro de uso** (`exit 2`), não um silencioso cair no default. O cabeçalho do script promete três códigos de saída; agora existem os três (fecha G06).
- **A19 — O `api/Dockerfile` copia `api/*.js` por glob**, não arquivo a arquivo, e remove os `*.test.js` depois. Motivo: foi um COPY arquivo a arquivo que quase derrubou a BACKLOG-01 com o `api/units.js` — nenhum teste pega isso, só o container. Com o glob, um módulo novo entra sozinho. Os testes não são executados na imagem (`CMD ["node","server.js"]`), então a remoção é limpeza, não requisito.
- **A20 — O `api/routines.fixtures.json` não entra na imagem**: ele só é lido por `api/routines.test.js`, que roda com o repositório montado. Nada em produção o usa.
- **A21 — A mensagem de erro `unknown exercise id … not in exercise_catalog.json`** (`api/routines.js:116`) passa a nomear o arquivo canônico. Não há teste que compare o **texto** dela (os testes comparam `code`), mas a mensagem mentiria sobre onde procurar.
- **A22 — O log de boot pode sair do `coach.js`, e tudo bem.** Como `server.js:12` importa `coach.js` antes de `routines.js`, a primeira chamada a `loadCatalog` acontece no topo do `coach.js` — é de lá que sai a linha `catalogo carregado: 1324 exercicios de …`. O bloco de boot do `server.js` continua existindo e agora é o guarda **fatal**: ele chama `loadCatalog` de novo (mesmo caminho, cache), e aborta se vier nulo.
- **A23 — O agente não precisa do nome do exercício no escritor.** `opengym_writer.py` usa do catálogo só chaves (`id`), `eq`, `img`, `gif` **e `mode`** (`:624`, `catalog.get(eid, {}).get("mode")`). `mode` não existe nem no catálogo velho nem no canônico (conferido: as 10 chaves são `id,n,bp,eq,tg,mg,sm,st,img,gif`), então o código sempre cai no default `"reps"` — comportamento idêntico antes e depois. Os nomes aparecem nos relatórios a partir da análise da API, não do catálogo. O `n` não precisa ser lido lá, e isso não é lacuna (fecha G12).

### Decisões assumidas vindas da revisão 1

- **A24 — `fileURLToPath` sai do import de `node:url` em `api/server.js`.** Ele é usado **só** na linha 20 (`path.dirname(fileURLToPath(import.meta.url))`), que sai nesta mudança. `pathToFileURL` continua (linha 779) e `path` continua (linhas 40, 44, 56, 87, 225, 390, 391, 392).
- **A25 — `.dockerignore` com barra inicial nas entradas de raiz** (`/data`, `/media`, `/docs`, `/website`, `/.env`, `/og.crt`, `/og.key`) para não haver dúvida sobre casar também um subdiretório homônimo lá dentro.
- **A26 — `docker-compose.yml`: o serviço `api` passa a buildar com contexto raiz**, e o `web` não muda. Consequência: os dois passam a compartilhar um único `.dockerignore` (R-1).
- **A27 — `image: ghcr.io/duartesantos8/opengym-api:latest` fica como está** no serviço `api`. É pré-existente e não nasce desta mudança (R-2).

---

## Requisitos Funcionais

**RF-1 — Existe exatamente um arquivo com a lista de exercícios no parque.**
O repositório contém `frontend/src/lib/exercises-data.json` e nenhum outro arquivo com a lista. No host `hermes`, depois da limpeza, não existe `exercise_catalog.json`, `catalog_summary.json` nem `opengym_exmap.json` fora do diretório de aposentados e do `_archive_2026-09-08/`. A string `exercise_catalog.json` sobrevive como **nome do fixture temporário** dentro de `api/routines.test.js` (escrito em `TMP` e passado por argumento) — isso é deliberado e não é uma lista de exercícios (fecha G09).
*Testável:* `find <repo> -name 'exercises-data.*'` → 1 resultado; `grep -rl "exercise_catalog" <repo> --exclude-dir=node_modules --exclude-dir=.git --exclude=og.key 2>/dev/null` → só os arquivos listados na tabela do item 11.

**RF-2 — O conteúdo é idêntico ao de hoje, campo a campo, com exceção do envelope.**
As 1324 entradas e os 10 campos (`id`, `n`, `bp`, `eq`, `tg`, `mg`, `sm`, `st`, `img`, `gif`) batem com o `.js` atual. Ordem preservada. Nenhum valor de `n`, `st`, `img` ou `gif` alterado.
*Testável:* script de comparação sobre o `.js` guardado em `/tmp` e o `.json` novo não encontra diferença além do envelope.

**RF-3 — O app funciona igual.**
`frontend/src/lib/exercises.js` importa o JSON; `EXDB`, `EXIDX`, `BODYPARTS`, `allExercises`, `imgSrc`, `gifSrc`, `isCardio`, `isBodyweightEq`, `exOr` mantêm assinatura e comportamento. `npx vitest run` verde (237 testes). `vite build` sem aviso novo. A tela Exercises continua dizendo "1324 exercises with animations".
*Testável:* suíte verde + o bundle `index-*.js` contém o nome de um exercício conhecido.

**RF-4 — A API lê o arquivo do app e diz isso no log.**
No boot, a linha `[og-routine] catalogo carregado: 1324 exercicios de /app/frontend/src/lib/exercises-data.json` aparece **exatamente uma vez** por processo.
*Testável:* `docker compose logs api | grep -c "catalogo carregado"` → 1.

**RF-5 — A análise devolve nome, não id.**
`GET /api/coach/analysis` devolve `prs[].ex` e as chaves de `progress` com o **nome** do exercício (de `n`), nunca `0585`.
*Testável:* nenhuma chave de `progress` na resposta casa com `^\d{4}$`.

**RF-6 — A API não lê o catálogo mais de uma vez por processo.**
`api/coach.js` deixa de ter qualquer `readFileSync` e deixa de importar `node:fs`, `node:path` e `node:url`. Com o arquivo crescendo de 259 KB para 888 KB, sem isso a análise pagaria ~888 KB de `JSON.parse` **por requisição**.
*Testável:* `grep -c readFileSync api/coach.js` → 0; `grep -c "from 'node:fs'" api/coach.js` → 0; duas requisições seguidas não reimprimem a linha de carga.

**RF-7 — O servidor não sobe com catálogo ausente ou ilegível.**
Arquivo ausente/ilegível/vazio → `process.exit(1)` com mensagem nomeando o caminho esperado e o arquivo canônico. Contagem diferente de `CATALOG_EXPECTED` → sobe com aviso.
*Testável:* renomear o arquivo e subir a API → exit ≠ 0 e a mensagem no log; injetar uma entrada e subir → sobe com aviso.

**RF-8 — O agente consulta, não copia.**
`opengym_writer.py`, `verificar_prescricao.py` e `opengym_reader.py` apontam para o arquivo canônico via `OPENGYM_CATALOG` (mesmo default nos três). Nenhum dos três gera, resume ou espelha o catálogo. As suítes Python seguem verdes (elas já usam catálogo de fixture via `OPENGYM_CATALOG`).
*Testável:* `python3 -m unittest test_escritor_rotinas test_verificar_prescricao` verde; `python3 opengym_writer.py doctor` imprime o caminho novo e `1324`.

**RF-9 — A skill não tem mais para onde mandar o agente copiar, e o campo do nome é `n`.**
Em `treino-coach/SKILL.md`: (a) toda menção operacional a `references/exercise_catalog.json` e a `catalog_summary.json` sai; (b) o caminho canônico aparece marcado **somente leitura**; (c) há regra explícita de que arquivo com nome de catálogo encontrado em `references/`, `profiles/`, `_archive/` ou `_retired_catalogs_*` é lixo de versão antiga e não deve ser lido; (d) **toda menção ao campo de nome do dataset passa a ser `n`**, nas linhas 25, 26, 28, 29, 32, 172 e 176; (e) exercício custom passa a ser registrado no **state** (`S.customEx`), não no catálogo (linhas 30 e 31); (f) a cópia morta do profile `treinador` recebe o mesmo arquivo (item 17.13).
*Testável:* nos **dois** arquivos, `grep -n "references/exercise_catalog\|catalog_summary"` → 0; no global, `grep -n "\bname\b"` devolve apenas a linha 2 (frontmatter `name: treino-coach`) e a linha 31 (pedir o nome ao usuário), e o laço das doze linhas do item 17 confirma cada edição.

**RF-10 — O script de verificação detecta e conserta o defeito real.**
`node scripts/check-exercises.mjs` confere: JSON válido; é array; `id` único com 4 dígitos; os 10 campos presentes em todas as entradas; `n` não vazio e sem caractere fora do Latin-1 básico; cada `img` e `gif` existe no diretório de mídia. Sai `0` quando não há **erro** (avisos não contam), nomeando id e campo quando há. `--fix` corrige homoglifo antes de `°`, faz backup e reescreve.
*Testável:* injetar `в°` no arquivo → sai `1` e nomeia o id; `--fix` → sai `0`. Adicionar uma 1325ª entrada → sai `0` com um aviso de contagem.

**RF-11 — A limpeza não deixa rastro.**
`api/exercise_catalog.json` não existe no repositório nem no HEAD. As **seis** entradas aposentadas do Pi estão em `/home/pi/.hermes/workout/_retired_catalogs_20260911/` com o caminho relativo preservado.
*Testável:* `git ls-files api/exercise_catalog.json` → vazio; `find /home/pi/.hermes/workout/_retired_catalogs_20260911 -type f | wc -l` → 6.

**RF-12 — O build de produção continua publicando os dois serviços, com contexto pequeno.**
`docker compose build api web` completa; `docker compose up -d` sobe os dois; `https://opengym.edsc.fun` responde 200; `/img/<arquivo>.jpg` e `/gif/<arquivo>.gif` respondem 200. E o contexto enviado ao daemon deixa de ser centenas de MB.
*Testável:* `curl -o /dev/null -s -w '%{http_code}'` nos três; a linha `Sending build context to Docker daemon` fica na casa dos **poucos MB** (hoje seriam ~484 MB: 197 MB de `node_modules`, 137 MB de `media/`, 128 MB de `.git`, 8,9 MB de `dist`).

---

## Detalhe de Implementação (nível código)

> Ordem: 1 → 2 → 3 (app ainda funciona) → 4…10 (API) → 11 (remoção) → 12 (script) → 13…16 (Hermes) → 17 (skill) → 18 (docs) → 19 (testes) → 20 (verificação).

### 1. `frontend/src/lib/exercises-data.js` → `frontend/src/lib/exercises-data.json`

O arquivo tem **1 linha**, 888.191 bytes (888.185 caracteres — os 6 `°` ocupam 2 bytes cada) e o conteúdo é literalmente `export const EXDB=[…];`, nada antes nem depois. A transformação é remover o envelope:

```bash
cd /mnt/drivebackup/apps/openGym/openGym

# 1) guarda o original para comparar no fim (RF-2)
cp frontend/src/lib/exercises-data.js /tmp/exercises-data.js.antes

# 2) remove o envelope e valida
python3 - <<'PY'
import json, re
src = open('frontend/src/lib/exercises-data.js', encoding='utf-8').read()
m = re.fullmatch(r'\s*export const EXDB\s*=\s*(\[.*\])\s*;?\s*', src, re.S)
assert m, 'envelope inesperado: o arquivo mudou de forma'
data = json.loads(m.group(1))
assert len(data) == 1324, len(data)
json.dump(data, open('frontend/src/lib/exercises-data.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('ok', len(data))
PY

# 3) troca o arquivo no git
git rm --cached frontend/src/lib/exercises-data.js
rm frontend/src/lib/exercises-data.js
git add frontend/src/lib/exercises-data.json
```

**ANTES** (primeiros 118 caracteres de 1 linha):
```js
export const EXDB=[{"id":"0001","n":"3/4 sit-up","bp":"waist","eq":"body weight","tg":"abs","mg":"hip flexors","sm":["hip flexors","lower back"],"st":["Lie flat on your back with your…
```

**DEPOIS** (primeiros 118 caracteres de 1 linha):
```json
[{"id":"0001","n":"3/4 sit-up","bp":"waist","eq":"body weight","tg":"abs","mg":"hip flexors","sm":["hip flexors","lower back"],"st":["Lie flat on your back with your…
```

- `ensure_ascii=False` mantém `°` como `°` (2 bytes UTF-8) e não como `\u00b0` — é o que torna o defeito de homoglifo visível a olho nu no diff, e é o que o `--fix` precisa enxergar.
- `separators=(',', ':')` mantém o arquivo em 1 linha, para o diff do git ser "1 linha alterada" e não 888 mil.
- **Não** formatar com indentação: o arquivo com quebra de linha fica ~1,2 MB sem ganho nenhum.
- O regex foi testado contra o arquivo real pela revisão 1: casa. Se o upstream reformatar o `.js`, o `assert` falha em vez de gerar lixo.

### 2. `frontend/src/lib/exercises.js` — linha 1

**ANTES**
```js
import { EXDB } from './exercises-data.js'
import { t } from './i18n.js'
```

**DEPOIS**
```js
import EXDB from './exercises-data.json'
import { t } from './i18n.js'
```

- Vite 8 e Vitest 4 têm import de JSON nativo (default export). Não há plugin a instalar e não há seção `test` no `vite.config.js` — o Vitest roda com os defaults, e JSON entra por eles.
- Import **default** e não nomeado: o Vite removeu named exports de JSON na v5.
- Único ponto de import do dataset: os 14 arquivos que usam a base passam por `exercises.js` (`store/useStore.js`, `sheets.jsx`, `components/Media.jsx`, `views/{RoutineEdit,Library,Workout,Stats}.jsx`, `lib/{progression,import-csv,plan-share,history,muscles}.js` e os testes `lib/{progression,history}.test.js`). Nenhum deles muda.

### 3. `scripts/build-instructions.mjs` — comentário do cabeçalho (linhas 1-6)

**ANTES**
```js
// Regenerates the per-language exercise instruction packs in frontend/src/instr/
// from the upstream dataset (hasaneyldrm/exercises-dataset). English stays inline
// in exercises-data.js; every other language ships as its own lazy-loaded pack.
```

**DEPOIS**
```js
// Regenerates the per-language exercise instruction packs in frontend/src/instr/
// from the upstream dataset (hasaneyldrm/exercises-dataset). English stays inline
// in exercises-data.json (o catálogo único, que a API e o agente também leem);
// every other language ships as its own lazy-loaded pack.
```

- Este script **lê** o dataset do upstream e **escreve** apenas em `frontend/src/instr/*.js` (9 idiomas). Nunca escreveu no catálogo — o comentário é que estava ambíguo.

### 4. `api/catalog.js` — **arquivo novo**

```js
// api/catalog.js — leitor único do catálogo de exercícios.
//
// FONTE ÚNICA: `frontend/src/lib/exercises-data.json`, o mesmo arquivo que o app carrega.
// Ninguém escreve nele em produção — a API e o agente Hermes só leem. O caminho é relativo
// a este arquivo (`../frontend/src/lib/...`) e a árvore dentro da imagem Docker espelha a do
// repositório de propósito (api/Dockerfile), então o mesmo caminho relativo vale no Pi e no
// container: não existe um segundo caminho para ninguém decorar.
//
// `OG_CATALOG` aponta para outro arquivo sem rebuild — é o que os testes usam.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Quantos exercícios a base tem hoje. Divergir não é erro — é aviso no boot (A7). */
export const CATALOG_EXPECTED = 1324;

/** Caminho canônico do catálogo. */
export const CATALOG_PATH = process.env.OG_CATALOG
  || path.join(API_DIR, '..', 'frontend', 'src', 'lib', 'exercises-data.json');

let _map = null;          // Map id → entrada, ou null quando indisponível
let _loadedPath = null;   // caminho a que `_map` corresponde (A9)

/**
 * Mapa id → entrada do catálogo. Memoizado POR CAMINHO: repetir o mesmo caminho devolve o
 * cache; passar outro caminho carrega aquele (é o que permite o fixture dos testes conviver
 * com o catálogo real no mesmo processo). `null` = indisponível.
 *
 * Aceita lista (formato canônico) ou objeto id → entrada, para não quebrar um `OG_CATALOG`
 * antigo apontando para um arquivo no formato do catálogo espelhado.
 */
export function loadCatalog(catalogPath = CATALOG_PATH) {
  if (_loadedPath === catalogPath) return _map;
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const map = new Map();
    if (Array.isArray(raw)) for (const c of raw) { if (c && c.id) map.set(c.id, c); }
    else for (const [id, v] of Object.entries(raw)) map.set(id, typeof v === 'object' ? v : {});
    _map = map;
    _loadedPath = catalogPath;
    console.log(`[og-routine] catalogo carregado: ${map.size} exercicios de ${catalogPath}`);
  } catch (e) {
    console.error('[og-routine] catalogo indisponivel:', catalogPath, e.message);
    _map = null;
    _loadedPath = catalogPath;
  }
  return _map;
}

/** Só para o teste: esquece o que estava memoizado. */
export function __resetCatalogCache() { _map = null; _loadedPath = null; }

/**
 * Equipamento declarado do exercício — usado na validação de rotina.
 * É um *peek*, não dispara carga, e só enxerga o mapa se ele for do caminho pedido (A28):
 * antes lia o mapa global, que é o do ÚLTIMO caminho carregado, e devolveria o equipamento
 * de outro catálogo sem avisar.
 */
export function catalogEq(id, catalogPath = CATALOG_PATH) {
  return (_loadedPath === catalogPath ? _map : null)?.get(id)?.eq || null;
}
```

- O texto do log é idêntico ao de hoje (`catalogo carregado: N exercicios de <caminho>`), porque é o que a verificação do RF-4 procura.
- A guarda deixa de ser `if (_checked) return _map` (que fazia "primeira chamada vence" e ignorava o argumento seguinte) e passa a ser `if (_loadedPath === catalogPath)`. Fecha F02 e F12.

### 5. `api/routines.js` — importar e re-exportar

**ANTES** (linhas 53-74)
```js
/** Mapa id → entrada do catálogo, carregado uma vez. null = indisponível (A12). */
/** Mapa id → entrada do catálogo, carregado uma vez de `catalogPath`. null = indisponível (A12). */
export function loadCatalog(catalogPath) {
  if (_catalogChecked) return _catalog;
  _catalogChecked = true;
  const f = catalogPath;
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const map = new Map();
    if (Array.isArray(raw)) for (const c of raw) { if (c && c.id) map.set(c.id, c); }
    else for (const [id, v] of Object.entries(raw)) map.set(id, typeof v === 'object' ? v : {});
    _catalog = map;
    console.log(`[og-routine] catalogo carregado: ${map.size} exercicios de ${f}`);
  } catch (e) {
    console.error('[og-routine] catalogo indisponivel:', f, e.message);
    _catalog = null;
  }
  return _catalog;
}
/** Só para o teste: permite carregar outro catálogo sem reiniciar o processo. */
export function __resetCatalogCache() { _catalog = null; _catalogChecked = false; }
export function catalogEq(id) { return _catalog?.get(id)?.eq || null; }
```

**DEPOIS**
```js
// O catálogo mora em api/catalog.js (leitor único, compartilhado com o coach.js).
// IMPORTAR e re-exportar, nessa ordem: `routines.js:427` chama `loadCatalog(catalogPath)` pelo
// nome local, e um `export { … } from './catalog.js'` NÃO cria binding local — só re-exportar
// daria ReferenceError em toda escrita de rotina.
import { loadCatalog, __resetCatalogCache, catalogEq } from './catalog.js';
export { loadCatalog, __resetCatalogCache, catalogEq };
export { CATALOG_PATH, CATALOG_EXPECTED } from './catalog.js';
```

E, no topo do arquivo, saem as variáveis que ficaram órfãs:
```js
// ANTES
let _catalog = null;
let _catalogChecked = false;
// DEPOIS
// (removido — vive em api/catalog.js)
```

- `api/routines.test.js` chama `R.__resetCatalogCache()` e `R.loadCatalog(path)` — continua idêntico.
- `api/routines.js:427` (`const catalog = loadCatalog(catalogPath)`) **não muda**: com o cache por caminho, o argumento injetado por `makeHandlers` continua tendo efeito.
- O comentário duplicado em duas linhas seguidas (resíduo de edição) sai junto.

### 6. `api/routines.js:116` — a mensagem de erro

**ANTES**
```js
    return bad('CATALOG_UNKNOWN_EX', 'id',
      `unknown exercise id "${e.id}" — not in exercise_catalog.json nor in this profile's customEx`);
```

**DEPOIS**
```js
    return bad('CATALOG_UNKNOWN_EX', 'id',
      `unknown exercise id "${e.id}" — not in the exercise catalog (frontend/src/lib/exercises-data.json) `
      + `nor in this profile's customEx`);
```

- `api/routines.js:428` (o `503 CATALOG_UNAVAILABLE`) fica **como está** (A17).

### 7. `api/server.js` — imports, caminho e verificação de boot

**ANTES** (linha 13 e linhas 18-20)
```js
import { pathToFileURL, fileURLToPath } from 'node:url';
...
// O catálogo vive ao lado do server.js (é o COPY do Dockerfile), NÃO em DATA_DIR (/data, que só
// tem estado/segredo). `OG_CATALOG` permite apontar para outro arquivo sem rebuild.
const CATALOG_PATH = process.env.OG_CATALOG || path.join(path.dirname(fileURLToPath(import.meta.url)), 'exercise_catalog.json');
```

**DEPOIS**
```js
import { pathToFileURL } from 'node:url';
...
// O catálogo é o arquivo do app (fonte única), NÃO um arquivo em DATA_DIR (/data, que só tem
// estado/segredo). O caminho e o leitor vivem em api/catalog.js; `OG_CATALOG` continua sendo o
// override sem rebuild.
const CATALOG_PATH = catalog.CATALOG_PATH;
```

- `fileURLToPath` sai porque era usado **só** na linha 20 (conferido: `grep -n fileURLToPath api/server.js` → só 13 e 20). `pathToFileURL` fica (linha 779) e `path` fica (linhas 40, 44, 56, 87, 225, 390, 391, 392). Fecha F01.
- `CATALOG_PATH` continua sendo exportado na linha 84 para o teste — a forma `const CATALOG_PATH = catalog.CATALOG_PATH;` preserva o export.

E o import do módulo novo, junto do `routines`:
```js
// ANTES
import * as routines from './routines.js';
// DEPOIS
import * as catalog from './catalog.js';
import * as routines from './routines.js';
```

**Boot check — ANTES** (linhas 757-763)
```js
// Carrega o catálogo já no boot: se o arquivo não estiver onde devia, o erro aparece no log na
// hora (em vez de virar um 503 misterioso na primeira escrita de rotina).
{
  const cat = routines.loadCatalog(CATALOG_PATH);
  if (!cat) console.error('[og-routine] ATENCAO: catalogo ausente — escrita de rotina respondera 503');
}
```

**DEPOIS**
```js
// Carrega o catálogo já no boot. Ausente ou ilegível = o servidor NÃO sobe: com o catálogo nulo
// a validação de rotina aceita id inexistente e a análise devolve o id no lugar do nome, as duas
// em silêncio. Contagem diferente do esperado é aviso, não erro: a base pode legitimamente
// crescer, e travar o boot por isso seria pior do que a divergência (A7).
//
// A primeira carga normalmente já aconteceu no import do coach.js (que vem antes deste módulo,
// linha 12) — a mesma chamada aqui só reaproveita o cache pelo caminho (A9, A22).
{
  const cat = catalog.loadCatalog(CATALOG_PATH);
  if (!cat) {
    console.error(`[og-routine] FATAL: catalogo ausente/ilegivel em ${CATALOG_PATH}`);
    console.error('[og-routine] o arquivo canonico e frontend/src/lib/exercises-data.json');
    process.exit(1);
  }
  if (cat.size !== catalog.CATALOG_EXPECTED) {
    console.warn(`[og-routine] AVISO: catalogo com ${cat.size} exercicios `
      + `(esperado ${catalog.CATALOG_EXPECTED}) — confira o arquivo canonico`);
  }
}
```

- `api/server.js:271` (`checkRoutineFields`) chama `routines.loadCatalog(CATALOG_PATH)` — **não muda** (re-exportado).

### 8. `api/coach.js` — leitor único, campo `n`, fim da leitura por requisição

**ANTES** (linhas 3-13)
```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normUnit, kgFactor, unitOfSet } from './units.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let catalogMap = {};
try{
  const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'exercise_catalog.json'), 'utf8'));
  for(const e of cat) catalogMap[e.id]=e.name;
}catch(e){ console.error('[coach] catalog load failed', e.message); }
```

**DEPOIS**
```js
import { normUnit, kgFactor, unitOfSet } from './units.js';
import { loadCatalog, CATALOG_PATH } from './catalog.js';

// O catálogo é lido UMA vez por processo, do arquivo do app (A5, RF-6). Antes este arquivo fazia
// dois JSON.parse: um aqui no topo e outro dentro de rowsFromState() — ou seja, um por requisição
// de análise. Com o catálogo passando de 259 KB para 888 KB, manter aquilo seria pagar a leitura
// inteira a cada GET /api/coach/analysis.
// É daqui que sai a linha "catalogo carregado" no boot: este módulo é importado por server.js
// antes de routines.js (A22).
const catalogEntries = loadCatalog(CATALOG_PATH) || new Map();
const catalogMap = {};
for (const [id, e] of catalogEntries) catalogMap[id] = e.n;   // o campo do nome é `n`, não `name`
```

**ANTES** (linhas 30-43, dentro de `rowsFromState`)
```js
  const exmap = {};
  // catálogo base (1324 exercícios) — exId → nome, eq padrão; customEx sobrescreve
  for(const [id,name] of Object.entries(catalogMap)) exmap[id]={n:name, eq:''};
  // eq real vem do catálogo completo quando precisar, mas para lastro basta customEx; para nome, catálogo já basta
  // sobrescreve com customEx (nome original preservado)
  for(const c of (state.customEx || [])){
    if(c.id) exmap[c.id] = { n: c.n || c.id, eq: c.eq || 'custom' };
  }
  // completa eq para itens do catálogo (para isBw) — re-lê catálogo com eq se disponível
  try{
    const cat2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'exercise_catalog.json'), 'utf8'));
    for(const e of cat2){ if(exmap[e.id]) exmap[e.id].eq = e.eq || exmap[e.id].eq; }
  }catch{}
```

**DEPOIS**
```js
  const exmap = {};
  // catálogo base (1324 exercícios) — exId → nome e equipamento, já memoizado no topo do módulo
  for(const [id, e] of catalogEntries) exmap[id] = { n: e.n, eq: e.eq || '' };
  // customEx sobrescreve (nome original preservado)
  for(const c of (state.customEx || [])){
    if(c.id) exmap[c.id] = { n: c.n || c.id, eq: c.eq || 'custom' };
  }
```

- `fs`, `path`, `fileURLToPath`, `__dirname` e `__filename` saem todos do arquivo (F21).
- `catalogMap` continua existindo porque `buildAnalysis` monta `progress` a partir dele; só muda a origem.
- O `catch{}` vazio do bloco antigo sumia com qualquer erro de leitura **a cada requisição**. Ele sai inteiro: quem trata indisponibilidade agora é o boot do `server.js` (RF-7).

### 9. `api/Dockerfile`

**ANTES**
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js coach.js routines.js units.js exercise_catalog.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
```

**DEPOIS**
```dockerfile
FROM node:22-alpine
# A árvore dentro da imagem espelha a do repositório: /app/api (o servidor) e
# /app/frontend/src/lib (o catálogo único). Assim `../frontend/src/lib/exercises-data.json`,
# que é como api/catalog.js resolve o caminho, vale igual no Pi e aqui dentro (A3).
# O contexto de build é a RAIZ do repositório (ver docker-compose.yml) — os COPY abaixo
# começam todos com `api/`.
WORKDIR /app/api
COPY api/package.json api/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
# Glob, não lista de nomes: foi um COPY arquivo a arquivo que quase derrubou a BACKLOG-01 com o
# `units.js` que faltava no image, e nem teste nem build local pegam isso. Os *.test.js viajam
# junto por causa do glob e são removidos na linha seguinte (A19) — nada em produção os usa.
COPY api/*.js ./
RUN rm -f ./*.test.js
COPY frontend/src/lib/exercises-data.json /app/frontend/src/lib/exercises-data.json
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
```

- `api/routines.fixtures.json` **não** entra: só `routines.test.js` o lê, e o teste roda com o repositório montado (A20).
- `COPY` cria os diretórios-pai do destino sozinho — não precisa de `mkdir`.

### 10. `docker-compose.yml` e `.dockerignore`

**`docker-compose.yml`, serviço `api` — ANTES**
```yaml
  api:
    image: ghcr.io/duartesantos8/opengym-api:latest
    build: ./api
    restart: unless-stopped
```

**DEPOIS**
```yaml
  api:
    image: ghcr.io/duartesantos8/opengym-api:latest
    build:
      context: .                    # a raiz: o Dockerfile precisa ver frontend/src/lib/ também
      dockerfile: api/Dockerfile
    restart: unless-stopped
```

O serviço `web` **não muda** (já usa `context: .` com `dockerfile: Dockerfile`).

**`.dockerignore` — arquivo novo na raiz** (com barra inicial nas entradas de raiz, A25)
```
# Contexto de build é a RAIZ do repositório (serviços `api` e `web`).
# Sem este arquivo, cada build envia ~484 MB de contexto:
#   frontend/node_modules 197 MB · media 137 MB · .git 128 MB · frontend/dist 8,9 MB
.git
.gitignore
**/node_modules
/frontend/dist
/data
/media
/docs
/website
/assets
/.env
/og.crt
/og.key
/.DS_Store
```

- `**/node_modules` cobre `frontend/node_modules` e `api/node_modules`. Nada nos dois Dockerfiles precisa deles: os dois rodam `npm install`/`npm ci` dentro da imagem.
- **Efeito colateral no `web`, e é uma correção:** hoje o `Dockerfile` do web faz `RUN npm ci` (instala `/app/node_modules` **dentro** da imagem) e depois `COPY frontend/ ./`, que **sobrescreve** esse diretório com o `node_modules` do host. No Pi as duas arquiteturas coincidem, então normalmente não quebra — mas é a mesma classe de problema que o comentário do `Dockerfile` atribui ao QEMU ("npm installs are known to corrupt esbuild/rollup's platform-specific native binaries"). Com o ignore, o `node_modules` do host para de entrar na imagem.
- `/media` sai do contexto e são 137 MB (a pasta é versionada no git; ver R-9).
- `/data` contém `db.json`, `secret` e `vapid.json` versionados pelo upstream no commit `c42ba6b` (dados de desenvolvimento do autor original). Nada os copia, e mandá-los ao daemon é desnecessário.
- `/assets` (banner do README e capturas de tela) e `/website` não são copiados por nenhum Dockerfile — nenhum dos dois DOIs `COPY` os alcança (fecha G10).
- `/og.key` é `-rw------- root:root`. O ignore evita o envio; sem ele o segredo iria para o daemon. Coberto pelo critério de aceite 11 (F13).
- **Não** ignorar `frontend/`, `frontend/src/`, `web/`, `api/` nem `*.json` — são exatamente o que os dois builds copiam. Conferido contra os `COPY` reais dos dois Dockerfiles pela revisão 2: nenhuma entrada do ignore casa `frontend/package.json`, `frontend/`, `web/nginx.conf`, `api/…` ou `frontend/src/lib/exercises-data.json`.

### 11. `api/exercise_catalog.json` — remoção

```bash
cd /mnt/drivebackup/apps/openGym/openGym
git rm api/exercise_catalog.json
```

Onde o caminho antigo aparece hoje e o que acontece com cada um:

| Arquivo | Linha | Ação |
|---|---|---|
| `api/server.js` | 20 | Alterado no item 7 |
| `api/coach.js` | 11, 41 | Alterado no item 8 |
| `api/routines.js` | 116 | Alterado no item 6 (mensagem de erro) |
| `api/Dockerfile` | 6 | Alterado no item 9 |
| `api/routines.test.js` | 31, 34 | **Não muda** — escreve o próprio fixture em `TMP` sob o nome `exercise_catalog.json` e passa o caminho por argumento. **A string sobrevive de propósito** e não viola o RF-1: é nome de arquivo temporário dentro de `TMP`, não uma lista de exercícios (fecha G09) |
| `docs/backlog.md` | 56-59 | Fechado no item 18.2 |
| `docs/specs/spec_escritor_rotinas.md` | 281, 544, 550, 731 | Nota de rodapé (item 18.3) |
| `docs/specs/spec_api_rotinas.md` | 72, 169, 216, 354, 981, 986, 989, 1452 | Nota de rodapé (item 18.3) |
| `docs/specs/spec_micro_via_app_v5.md` | 546 | Nota de rodapé (item 18.3) |
| `docs/specs/spec_fonte_unica_openGym.md` | 25 | Nota de rodapé (item 18.3) |
| `docs/specs/spec_micro_meso_via_app.md` | 24 | Nota de rodapé (item 18.3) |
| `docs/specs/spec_catalogo_unico.md` | este arquivo | É a própria spec |
| `docs/specs/spec_unit_por_exercicio.md` | 1054, 1301, 1323 | **Não muda** — relato datado do que foi conferido em 11/09 |

### 12. `scripts/check-exercises.mjs` — **arquivo novo**

Segue o precedente de `frontend/scripts/check-locales.mjs` (Node puro, sem dependência, roda por linha de comando, comentário no topo explicando o invariante que protege). O precedente não importa nada de fora de si mesmo; este importa **uma** constante (`CATALOG_EXPECTED`) para não duplicar o número (A6).

```js
#!/usr/bin/env node
// Guarda o invariante do catálogo único: frontend/src/lib/exercises-data.json é a ÚNICA lista de
// exercícios do parque (app, API e agente leem este arquivo) e ela precisa estar sã.
//
//   node scripts/check-exercises.mjs [--media DIR] [--fix]
//
// O que confere:
//   1. é JSON válido e é uma lista;
//   2. todo `id` é único e tem 4 dígitos;
//   3. as 10 chaves existem em TODAS as entradas (id n bp eq tg mg sm st img gif);
//   4. `n` não é vazio e não tem caractere fora do Latin-1 básico — foi assim que um `в`
//      cirílico (U+0432) entrou em 4 nomes (`0738`, `0739`, `0740`, `0742`) e sobreviveu
//      porque nada olhava;
//   5. cada `img` e `gif` existe no diretório de mídia.
//
// Avisos (não afetam o código de saída): contagem diferente de CATALOG_EXPECTED.
// Erros (saída 1): tudo o mais, nomeando id e campo.
//
// `--fix` corrige só o defeito 4 quando o homoglifo está colado antes do `°`, com backup.
// Homoglifo em outra posição é erro fatal e NÃO é corrigível automaticamente (A13).
// Não reordena, não renomeia, não baixa mídia.
//
// Sai 0 quando não há erro, 1 quando há, 2 em erro de uso (argumento sem valor).
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG_EXPECTED } from '../api/catalog.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Esta conferência olha SEMPRE o arquivo canônico: `OG_CATALOG` é override de teste, não de repo.
const CATALOG = join(root, 'frontend', 'src', 'lib', 'exercises-data.json')
const FIELDS = ['id', 'n', 'bp', 'eq', 'tg', 'mg', 'sm', 'st', 'img', 'gif']
// Letras que se parecem com latinas e passaram despercebidas: cirílico e grego.
const HOMOGLYPH = /[\u0370-\u03ff\u0400-\u04ff]/
// Um OU MAIS homoglifos antes do °: uma correção manual apressada pode ter deixado `вв°`,
// e o --fix tem de conseguir limpar o que ele mesmo poderia ter deixado pela metade (G07).
const HOMOGLYPH_BEFORE_DEGREE = /[\u0370-\u03ff\u0400-\u04ff]+(?=°)/g

const args = process.argv.slice(2)
const flag = n => args.includes(n)
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const USAGE = 'uso: node scripts/check-exercises.mjs [--media DIR] [--fix]'
if (flag('--help')) { console.log(USAGE); process.exit(0) }
// Argumento que exige valor e veio sem ele é erro de uso, não um default silencioso (A30).
for (const n of ['--media']) {
  if (args.includes(n) && (!opt(n) || opt(n).startsWith('--'))) {
    console.error(`${n} exige um diretório\n${USAGE}`); process.exit(2)
  }
}
if (process.env.OG_CATALOG) {
  console.warn(`aviso: OG_CATALOG está definida (${process.env.OG_CATALOG}) — esta conferência `
    + 'ignora o override e olha o arquivo canônico.')
}

const mediaDir = opt('--media') || join(root, 'media')
const fix = flag('--fix')

let raw, data
try { raw = readFileSync(CATALOG, 'utf8') } catch (e) {
  console.error(`FALHA: não consegui ler ${CATALOG}: ${e.message}`); process.exit(1)
}
try { data = JSON.parse(raw) } catch (e) {
  console.error(`FALHA: ${CATALOG} não é JSON válido: ${e.message}`); process.exit(1)
}
if (!Array.isArray(data)) { console.error('FALHA: o catálogo precisa ser uma lista'); process.exit(1) }

const problems = []
const warnings = []
const seen = new Map()
const fixed = new Map()   // id → nome corrigido

for (const [i, e] of data.entries()) {
  const where = e && e.id ? e.id : `#${i}`
  if (!e || typeof e !== 'object' || Array.isArray(e)) { problems.push([where, 'entrada não é objeto', '']); continue }
  for (const f of FIELDS) if (!(f in e)) problems.push([where, `campo ausente: ${f}`, ''])
  if (!/^\d{4}$/.test(String(e.id ?? ''))) problems.push([where, `id fora do padrão 4 dígitos: ${JSON.stringify(e.id)}`, ''])
  if (seen.has(e.id)) problems.push([where, `id repetido (também em #${seen.get(e.id)})`, ''])
  else seen.set(e.id, i)

  if (typeof e.n !== 'string' || !e.n.trim()) problems.push([where, 'nome vazio', ''])
  else if (HOMOGLYPH.test(e.n)) {
    const cleaned = e.n.replace(HOMOGLYPH_BEFORE_DEGREE, '')
    if (cleaned !== e.n && !HOMOGLYPH.test(cleaned)) {
      if (fix) fixed.set(e.id, cleaned)
      else problems.push([where, `nome com homoglifo: ${JSON.stringify(e.n)}`, `sugerido: ${JSON.stringify(cleaned)}`])
    } else {
      // Não é o padrão conhecido (homoglifo antes do °) — não há como adivinhar o nome certo.
      problems.push([where, `nome com homoglifo fora do padrão antes do °: ${JSON.stringify(e.n)}`,
                     'NÃO corrigível automaticamente — corrija à mão'])
    }
  }

  for (const k of ['img', 'gif']) {
    // Campo ausente já é erro no laço de FIELDS; aqui o valor precisa ser string não vazia,
    // senão `img: null` passaria calado pelo `continue` (G08).
    if (typeof e[k] !== 'string' || !e[k]) {
      problems.push([where, `${k} vazio ou não é texto: ${JSON.stringify(e[k])}`, ''])
    } else if (!existsSync(join(mediaDir, k, e[k]))) {
      problems.push([where, `${k} não encontrado em ${join(mediaDir, k)}: ${e[k]}`, ''])
    }
  }
}

if (data.length !== CATALOG_EXPECTED) {
  warnings.push(`o catálogo tem ${data.length} exercícios; o esperado é ${CATALOG_EXPECTED} `
    + '(a base pode crescer — se cresceu de propósito, atualize CATALOG_EXPECTED em api/catalog.js)')
}

if (fix && fixed.size) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
  copyFileSync(CATALOG, `${CATALOG}.bak.${stamp}`)
  for (const e of data) if (fixed.has(e.id)) e.n = fixed.get(e.id)
  writeFileSync(CATALOG, JSON.stringify(data, null, 0), 'utf8')
  console.log(`--fix: ${fixed.size} nome(s) corrigido(s) — backup em ${CATALOG}.bak.${stamp}`)
  for (const [id, n] of fixed) console.log(`  ${id}: ${n}`)
}

for (const w of warnings) console.warn(`  aviso: ${w}`)
if (problems.length) {
  for (const [where, msg, hint] of problems) console.error(`  ${where}: ${msg}${hint ? ` — ${hint}` : ''}`)
  console.error(`\n${problems.length} problema(s) em ${CATALOG}`)
  process.exit(1)
}
console.log(`ok: ${data.length} exercícios, ${FIELDS.length} campos, mídia conferida em ${mediaDir}`)
```

Pontos que a implementação precisa respeitar:
- `--media` default é `<repo>/media`, que **é** um diretório completo (1324 img + 1324 gif, A12). No Pi, `--media /mnt/drivebackup/apps/openGym/media` confere o volume que o container `web` serve.
- O `HOMOGLYPH_BEFORE_DEGREE` é constante de módulo, compilado uma vez — não dentro do laço (F04), e casa um **ou mais** homoglifos (`в°` e `вв°`), para o `--fix` ser idempotente sobre um arquivo já tocado por correção manual (G07).
- `HOMOGLYPH.test` sem flag `g` é seguro para uso repetido (não tem `lastIndex`). A variante com `g` **não** pode ser usada em `.test()`, só em `.replace()`.
- `JSON.stringify(data, null, 0)` reescreve em 1 linha, igual ao arquivo gerado no item 1. Conferido pela revisão 2: o arquivo reescrito pelo `--fix` tem a mesma contagem de linhas (1), o mesmo tamanho por byte e nenhum newline final acrescentado.
- O `--fix` grava **depois** do laço de validação completo, sobre o `data` já parseado; nunca escreve um arquivo que não conseguiu ler.

### 13. Hermes — `opengym_writer.py`

**ANTES** (linha 53)
```python
CATALOG = Path(os.environ.get("OPENGYM_CATALOG", "/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json"))
```

**DEPOIS**
```python
# Fonte única do catálogo (somente leitura): o mesmo arquivo que o app e a API leem.
# NÃO copie, não espelhe, não gere resumo — ver treino-coach/SKILL.md.
CATALOG = Path(os.environ.get("OPENGYM_CATALOG", "/mnt/drivebackup/apps/openGym/openGym/frontend/src/lib/exercises-data.json"))
```

E a mensagem de contagem, que fica factualmente errada (linha 694):
**ANTES**
```python
        info(f"AVISO: catalogo com {len(out)} entradas (esperado {CATALOG_EXPECTED}). "
             f"Divergencia do que o servidor valida — confira o espelho do repo.")
```
**DEPOIS**
```python
        info(f"AVISO: catalogo com {len(out)} entradas (esperado {CATALOG_EXPECTED}). "
             f"Divergencia do que o servidor valida — confira o arquivo canonico do repo.")
```

`load_catalog()` (linhas 680-696) **não muda**: já aceita lista (`isinstance(raw, list)`), já indexa por `id`, e os únicos campos que ele usa são `eq`, `img`, `gif` e `mode` — os três primeiros existem no canônico com o mesmo nome, e `mode` nunca existiu em catálogo nenhum (o código já cai no default `"reps"`). `CATALOG_EXPECTED = 1324` continua na linha 54. O escritor não usa `n` e não precisa (A23).

### 14. Hermes — `verificar_prescricao.py`

**ANTES** (linha 46)
```python
CAT = os.environ.get("OPENGYM_CATALOG", "/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json")
```

**DEPOIS**
```python
CAT = os.environ.get("OPENGYM_CATALOG", "/mnt/drivebackup/apps/openGym/openGym/frontend/src/lib/exercises-data.json")
```

- Nada mais muda: na linha 120 o script faz `cat_ids = {c.get("id") for c in cat}` — só usa as **chaves**, e o canônico é uma lista de objetos com `id`, igual ao que ele já recebia. `--catalog` (linha 110) mantém o default.

### 15. Hermes — `opengym_reader.py` (fim do mapa derivado)

**ANTES** (linha 33 e linhas 54-62)
```python
EXMAP = os.environ.get("OPENGYM_EXMAP", "/home/pi/.hermes/workout/data/opengym_exmap.json")
...
def _load_exmap() -> dict:
    try:
        with open(EXMAP, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        print(f"AVISO: catálogo ausente/ilegível ({EXMAP}); exercícios sairão como id. "
              f"Rode opengym_export_exmap.mjs.\n")
        return {}
```

**DEPOIS**
```python
CATALOG = os.environ.get("OPENGYM_CATALOG", "/mnt/drivebackup/apps/openGym/openGym/frontend/src/lib/exercises-data.json")
...
def _load_exmap() -> dict:
    """id → {n, eq} a partir do catálogo único do repo — o MESMO arquivo que a API lê.

    Antes isto lia `opengym_exmap.json`, um mapa derivado que precisava ser regerado à mão
    por `opengym_export_exmap.mjs` a cada mudança do dataset, e que por isso envelhecia
    calado. O nome da função fica: ela é chamada em um lugar só (`rows_from_state`) e mudar
    o nome mexeria em `process_workout_legacy.py` sem ganho.
    """
    try:
        with open(CATALOG, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError) as e:
        print(f"AVISO: catálogo ausente/ilegível ({CATALOG}): {e}; exercícios sairão como id.\n")
        return {}
    return {c["id"]: {"n": c.get("n") or c["id"], "eq": c.get("eq") or ""}
            for c in raw if isinstance(c, dict) and c.get("id")}
```

- `rows_from_state` (linha 148) e `load_rows` (linha 210) **não mudam**: o consumidor consulta `meta.get("n")` e `meta.get("eq")`, exatamente o que o dicionário novo devolve.
- A mensagem de erro deixa de mandar rodar `opengym_export_exmap.mjs` — o script é aposentado no item 16.
- **Sem teste automatizado.** É caminho legado (só alcançado por `process_workout_legacy.py`), então a verificação é manual: ver o teste 11 da seção de testes manuais (fecha F15).

### 16. Hermes — aposentar as cópias (A16)

```bash
RETIRED=/home/pi/.hermes/workout/_retired_catalogs_20260911
mkdir -p "$RETIRED"
for f in \
  /home/pi/.hermes/skills/fitness/treino-coach/references/exercise_catalog.json \
  /home/pi/.hermes/skills/fitness/treino-coach/references/catalog_summary.json \
  /home/pi/.hermes/profiles/treinador/skills/fitness/treino-coach/references/exercise_catalog.json \
  /home/pi/.hermes/profiles/treinador/skills/fitness/treino-coach/references/catalog_summary.json \
  /home/pi/.hermes/workout/data/opengym_exmap.json \
  /home/pi/.hermes/workout/scripts/opengym_export_exmap.mjs \
; do
  [ -e "$f" ] || continue
  dest="$RETIRED/${f#/}"
  mkdir -p "$(dirname "$dest")"
  mv "$f" "$dest"
  echo "aposentado: $f"
done
```

São **6 arquivos** (4 JSON + 1 mapa derivado + 1 gerador). O que **não** é tocado, e por quê:
- `/home/pi/.hermes/workout/_archive_2026-09-08/root/exercise_catalog.json` — é um arquivo **de arquivo**, dentro de um diretório `_archive_` datado.
- `/home/pi/.hermes/skills/gmail-management/references/treinador-weekly-dispatch-20260831.md` — despacho datado, registro histórico.
- `~/.hermes/workout/scripts/*.bak.*` — backups do próprio escritor, gerados por ele.
- `__pycache__/opengym_writer.cpython-312.pyc` — cache do interpretador, regenerado.

O `SKILL.md` do profile `treinador` **não** entra nesta lista de aposentadoria: ele é corrigido no item 17.13 (A29).

Conferência (RF-1 e RF-11). **Rodar depois do item 11** — antes disso, `api/exercise_catalog.json` ainda existe e aparece na lista (fecha G11):
```bash
# no Pi: só o que sobrar fora do aposentado e do arquivo datado
find /home/pi/.hermes \
  \( -name 'exercise_catalog.json' -o -name 'catalog_summary.json' -o -name 'opengym_exmap.json' \) \
  | grep -v '_retired_catalogs_' | grep -v '_archive_'
# não pode devolver nada

# no repo: confirma que a remoção do item 11 aconteceu
cd /mnt/drivebackup/apps/openGym/openGym
find . -name 'exercise_catalog.json' -not -path './node_modules/*' -not -path './.git/*'
# não pode devolver nada
```

### 17. `treino-coach/SKILL.md` — um caminho só, somente leitura, e o campo é `n`

Backup antes de editar, como é praxe: `cp SKILL.md SKILL.md.bak.$(date +%Y%m%d-%H%M%S)`.
São **dez linhas** (21, 25, 26, 28, 29, 30, 31, 32, 44, 48) mais **duas** no meio do arquivo (172, 176). Esta é a parte mais importante da spec: foi a prosa da skill que mandou o agente extrair o catálogo do bundle e depois "proibir leitura de qualquer outro `exercise_catalog`" — o agente criou as cópias e depois passou a desconfiar delas.

**17.1 — Linha 21 (princípio). ANTES**
```
> **Princípio (decisão usuário 2026-09-02, atualizada 2026-09-09 fonte única):** do app openGym usamos **dataset de exercícios como fonte de verdade do catálogo + `GET https://opengym.edsc.fun/api/coach/analysis` como fonte única da análise** (substitui leitura direta de `state-*.json` no disco via `opengym_reader.py`). Não usamos templates de rotina, faixa de reps padrão do app, nem lógica de progressão do app.
```
**DEPOIS**
```
> **Princípio (decisão usuário 2026-09-02, atualizada 2026-09-09 fonte única e 2026-09-11 catálogo único):** do app openGym usamos **o catálogo de exercícios do repositório como fonte de verdade — um arquivo só, lido no lugar, nunca copiado — + `GET https://opengym.edsc.fun/api/coach/analysis` como fonte única da análise** (substitui leitura direta de `state-*.json` no disco via `opengym_reader.py`). Não usamos templates de rotina, faixa de reps padrão do app, nem lógica de progressão do app.
```

**17.2 — Linha 25 (arquivo fonte). ANTES**
```
- **Arquivo fonte do catálogo:** `~/.hermes/skills/fitness/treino-coach/references/exercise_catalog.json` (1324 exercícios, extraído de `assets/index-DylSoVef.js`) — espelhado em `/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json` para a API. Cada entrada: `{id, name (EN), bp, eq, tg, img, gif}`. `img/gif` em `/mnt/drivebackup/apps/openGym/media/{img,gif}` servidos por `opengym-web-1` em `/img/` e `/gif/`.
```
**DEPOIS**
```
- **Arquivo fonte do catálogo (SOMENTE LEITURA, um arquivo só):** `/mnt/drivebackup/apps/openGym/openGym/frontend/src/lib/exercises-data.json` — 1324 exercícios. **É o mesmo arquivo que o app e a API leem**; não existe outro e você não mantém cópia. Cada entrada: `{id, n (EN), bp, eq, tg, mg, sm, st, img, gif}` — **o nome está em `n`, não em `name`**. `img/gif` em `/mnt/drivebackup/apps/openGym/media/{img,gif}` servidos por `opengym-web-1` em `/img/` e `/gif/`.
- **Proibido:** copiar o catálogo para dentro de `~/.hermes` (nem `references/`, nem `workout/`, nem `profiles/`); gerar resumo, extrato ou índice dele; manter qualquer arquivo com nome parecido. Se aparecer um `exercise_catalog.json` em `references/`, `profiles/`, `_archive/` ou `_retired_catalogs_*`, é lixo de versão antiga: **não leia, não compare, não use como referência** — o único caminho válido é o acima. Correção no catálogo (nome errado, caractere estranho, mídia faltando) **não** é feita por você: relate e pare.
```

**17.3 — Linha 26. ANTES**
```
- **Uso:** resolver `id ↔ name` em inglês, validar `eq/tg/bp`, garantir `img/gif` existe, filtrar por equipamento permitido e por objetivo. É o **dicionário**, não o treinador.
```
**DEPOIS**
```
- **Uso:** resolver `id ↔ n` em inglês, validar `eq/tg/bp`, garantir `img/gif` existe, filtrar por equipamento permitido e por objetivo. É o **dicionário**, não o treinador.
```

**17.4 — Linha 28. ANTES**
```
- **Pensar em inglês:** o Treinador deve **raciocinar e planejar em inglês** para casar 1:1 com `name` do dataset (ex: `lever lateral raise`, `dumbbell incline rear lateral raise`, `smith rear delt row`). Comunicação com usuário continua em PT-BR, mas **plano/tabelas ficam em inglês** (decisão 2026-08-29: `pode montar o plano em ingles também`).
```
**DEPOIS**
```
- **Pensar em inglês:** o Treinador deve **raciocinar e planejar em inglês** para casar 1:1 com `n` do dataset (ex: `lever lateral raise`, `dumbbell incline rear lateral raise`, `smith rear delt row`). Comunicação com usuário continua em PT-BR, mas **plano/tabelas ficam em inglês** (decisão 2026-08-29: `pode montar o plano em ingles também`).
```

**17.5 — Linha 29 (um trecho). ANTES**
```
Avalia `eq/tg/bp + name EN` e, se dúvida, **pesquisa e se aperfeiçoa**
```
**DEPOIS**
```
Avalia `eq/tg/bp + n` (o nome em inglês) e, se dúvida, **pesquisa e se aperfeiçoa**
```

**17.6 — Linha 30 (final). ANTES**
```
Usuário pode fornecer imagem (você disse que pode fornecer) — nesse caso, salvar em `/mnt/drivebackup/apps/openGym/media/img/` + `gif/` e registrar no `exercise_catalog.json` com `id` custom.
```
**DEPOIS**
```
Usuário pode fornecer imagem (você disse que pode fornecer) — nesse caso, salvar em `/mnt/drivebackup/apps/openGym/media/img/` + `gif/` e registrar como exercício custom no **state do perfil** (`S.customEx`), pelo escritor de rotinas. O catálogo único **não** é editado por você.
```

**17.7 — Linha 31. ANTES**
```
- **Exercício custom a pedido (decisão 2026-09-02):** usuário pode pedir exercício específico mesmo fora do dataset — Treinador aceita, pede `name EN, eq, tg, bp, img/gif` (você fornece), valida hérnia reflexivamente, e adiciona como `id` custom `immt_*` com mídia real. Dataset continua fonte primária, mas não exclusiva quando usuário solicita explicitamente.
```
**DEPOIS**
```
- **Exercício custom a pedido (decisão 2026-09-02, atualizada 2026-09-11):** usuário pode pedir exercício específico mesmo fora do dataset — Treinador aceita, pede o nome em inglês, `eq`, `tg`, `bp` e `img/gif` (usuário fornece), valida hérnia reflexivamente, e adiciona como `id` custom `immt_*` com mídia real **no state do perfil (`S.customEx`)**, nunca no catálogo. O catálogo único é somente leitura para você. Dataset continua fonte primária, mas não exclusiva quando usuário solicita explicitamente.
```

**17.8 — Linha 32. ANTES**
```
- **Escolha guiada por objetivo:** ombro 3D → filtrar `tg=delts` ou `name` contém `lateral raise / rear delt / shoulder press`, priorizando `leverage machine` e `dumbbell` sentado.
```
**DEPOIS**
```
- **Escolha guiada por objetivo:** ombro 3D → filtrar `tg=delts` ou `n` contém `lateral raise / rear delt / shoulder press`, priorizando `leverage machine` e `dumbbell` sentado.
```

**17.9 — Linha 44. ANTES**
```
- **Dataset (verdade do catálogo):** `exercise_catalog.json` (read-only, 1324) — também espelhado em `/mnt/drivebackup/apps/openGym/openGym/api/exercise_catalog.json` para a API (`GET /api/coach/analysis` usa o mesmo catálogo).
```
**DEPOIS**
```
- **Dataset (verdade do catálogo):** `exercises-data.json` (read-only, 1324) em `/mnt/drivebackup/apps/openGym/openGym/frontend/src/lib/`. **Não há espelho:** a API lê este mesmo arquivo em `GET /api/coach/analysis`.
```

**17.10 — Linha 48. ANTES**
```
- **Path canônico (decisão #11a):** `DATASET_PATH=~/.hermes/skills/fitness/treino-coach/references/exercise_catalog.json` (fail-fast `count !=1324`).
```
**DEPOIS**
```
- **Path canônico (decisão #11a, atualizada 2026-09-11):** `DATASET_PATH=/mnt/drivebackup/apps/openGym/openGym/frontend/src/lib/exercises-data.json` (fail-fast `count !=1324`). **O campo do nome é `n`.**
```

**17.11 — Linha 172. ANTES**
```
- **Consultar o dataset primeiro:** filtrar `exercise_catalog.json` por `tg`/`eq`/`name` em inglês, respeitando filtro hérnia. **Só usar `id` com `img/gif` válido.** Se precisar de substituto (ex: sem polia → `cable` → `dumbbell`/`leverage machine`), buscar sinônimo no dataset em inglês (`dumbbell incline rear lateral raise` no lugar de cable).
```
**DEPOIS**
```
- **Consultar o dataset primeiro:** filtrar o arquivo do `DATASET_PATH` por `tg`/`eq`/`n` em inglês, respeitando filtro hérnia. **Só usar `id` com `img/gif` válido.** Se precisar de substituto (ex: sem polia → `cable` → `dumbbell`/`leverage machine`), buscar sinônimo no dataset em inglês (`dumbbell incline rear lateral raise` no lugar de cable).
```

**17.12 — Linha 176. ANTES**
```
- **Escrever o plano em inglês** (IDs + `name` do dataset), com notas de execução em PT-BR se necessário. Validar no final: todos os `id` têm `img` no dataset/Media.
```
**DEPOIS**
```
- **Escrever o plano em inglês** (IDs + `n` do dataset), com notas de execução em PT-BR se necessário. Validar no final: todos os `id` têm `img` no dataset/Media.
```

**Conferência (RF-9):**
```bash
SK=/home/pi/.hermes/skills/fitness/treino-coach/SKILL.md
SKP=/home/pi/.hermes/profiles/treinador/skills/fitness/treino-coach/SKILL.md
grep -n "references/exercise_catalog\|catalog_summary" "$SK"    # → 0 linhas
grep -n "references/exercise_catalog\|catalog_summary" "$SKP"   # → 0 linhas (item 17.13)
grep -n "\bname\b" "$SK"                                        # → só a linha 2 e a linha 31
# As doze linhas editadas, para provar que cada uma mudou:
for n in 21 25 26 28 29 30 31 32 44 48 172 176; do printf '%s: ' "$n"; sed -n "${n}p" "$SK" | cut -c1-90; done
```
As duas ocorrências de `name` que sobrevivem são legítimas: a linha 2 é o frontmatter (`name: treino-coach`) e a linha 31 fala de **pedir o nome ao usuário**, não do campo do dataset. Qualquer outra ocorrência ligada ao dataset é erro (fecha F17 e F18). A linha 44 (item 17.9) não contém a palavra `name`, então o `grep` acima não a cobre — é o laço das doze linhas que cobre (fecha G04).

**17.13 — O `SKILL.md` do profile `treinador` (A29).** Existe uma cópia morta com conteúdo **diferente** em `~/.hermes/profiles/treinador/skills/fitness/treino-coach/SKILL.md` (33.564 B, de 07/09), que ainda manda ler `references/exercise_catalog.json` (linhas 34 e 56) e usa `name` como campo do dataset em 8 linhas. O item 16 aposenta os catálogos daquele `references/`, o que deixaria a prosa apontando para o vazio. Depois das doze edições acima:
```bash
SKP_DIR=/home/pi/.hermes/profiles/treinador/skills/fitness/treino-coach
cp "$SKP_DIR/SKILL.md" "$SKP_DIR/SKILL.md.bak.$(date +%Y%m%d-%H%M%S)"
cp /home/pi/.hermes/skills/fitness/treino-coach/SKILL.md "$SKP_DIR/SKILL.md"
```
O profile está morto (rodou ~40 min em 07/09 e tem `sessions/` vazio), então sobrescrever a cópia velha com a atual não perde nada e garante que, se ele for revivido, nasça correto. É o caminho mais barato que elimina a última prosa velha do parque.

### 18. Documentos do repositório

**18.1 — `NOTICE.md` (linha 49). ANTES**
```
The exercise names, instructions (English in `frontend/src/lib/exercises-data.js`, other
```
**DEPOIS**
```
The exercise names, instructions (English in `frontend/src/lib/exercises-data.json`, other
```

**18.2 — `docs/backlog.md` — fechar o BACKLOG-04.** Mover a seção (linhas 56-60) para `## Concluídos`, como foi feito com o BACKLOG-01:
```markdown
## BACKLOG-04 — `exercise_catalog.json` dentro do repo

- **Status:** **RESOLVIDO em 11/09/2026** (commit `<hash>` na branch `emerson-custom`).
- **Resolução:** a lista de exercícios passou a ter **um arquivo só**, versionado e lido por todos: `frontend/src/lib/exercises-data.json` (1324 exercícios, 10 campos, o arquivo do app convertido para JSON puro). A API lê esse mesmo arquivo (`api/catalog.js` + `api/Dockerfile` com contexto da raiz + `.dockerignore` novo), o agente Hermes lê o mesmo caminho via `OPENGYM_CATALOG` e **não copia**. Foram aposentados `api/exercise_catalog.json`, as duas cópias em `~/.hermes/skills/.../references/`, o `catalog_summary.json`, o `opengym_exmap.json`, o gerador `opengym_export_exmap.mjs` e a cópia do profile `treinador`. O campo do nome é `n` (era `name` no catálogo espelhado). Novo `scripts/check-exercises.mjs` (com `--fix`) verifica estrutura, nomes e mídia. Spec: `docs/specs/spec_catalogo_unico.md`.
- **Aceite:** `GET /api/coach/analysis` valida `id` sem ler `/home/pi/...` — conferido pelo critério 3 da spec (a resposta não contém chave de `progress` com id de 4 dígitos) e pelo caminho que o log de boot imprime (critério 4). Nenhum outro arquivo com a lista é encontrado pelo `find` do critério 3.
```

**18.3 — Notas de rodapé nas specs históricas com receita operacional.** Em `docs/specs/spec_escritor_rotinas.md`, `spec_api_rotinas.md`, `spec_micro_via_app_v5.md`, `spec_fonte_unica_openGym.md` e `spec_micro_meso_via_app.md`, acrescentar no **fim** do arquivo (o texto antigo é registro datado):
```markdown
---

> **Atualização de 11/09/2026:** o catálogo de exercícios deixou de ser
> `api/exercise_catalog.json` (e de ter cópia em `~/.hermes/.../references/`). Agora existe **um
> arquivo só**, `frontend/src/lib/exercises-data.json`, lido pelo app, pela API e pelo agente. Onde
> este documento citar `exercise_catalog.json`, ou o campo `name`, leia o arquivo novo e o campo
> `n`. Ver `docs/specs/spec_catalogo_unico.md`.
```

### 19. Testes

**19.1 — `api/routines.test.js`: fixture no esquema canônico.**

**ANTES** (linhas 25-31)
```js
const CATALOG = [
  { id: '0326', name: 'dumbbell incline rear lateral raise', bp: 'shoulders', eq: 'dumbbell', img: 'a.jpg', gif: 'a.gif' },
  { id: '0584', name: 'lever lateral raise', bp: 'shoulders', eq: 'leverage machine', img: 'b.jpg', gif: 'b.gif' },
  { id: '0585', name: 'lever leg extension', bp: 'upper legs', eq: 'leverage machine', img: 'c.jpg', gif: 'c.gif' },
  { id: '0001', name: '3/4 sit-up', bp: 'waist', eq: 'body weight', img: 'd.jpg', gif: 'd.gif' }
];
```

**DEPOIS**
```js
// Mesmo esquema do catálogo canônico (frontend/src/lib/exercises-data.json): o nome é `n`.
// A consistência do fixture é conforto de leitura — ele NÃO amarra o arquivo real (os testes
// abaixo continuariam passando se o campo mudasse de novo). Quem amarra é api/catalog.test.js,
// que lê o arquivo de verdade.
const CATALOG = [
  { id: '0326', n: 'dumbbell incline rear lateral raise', bp: 'shoulders', eq: 'dumbbell', img: 'a.jpg', gif: 'a.gif' },
  { id: '0584', n: 'lever lateral raise', bp: 'shoulders', eq: 'leverage machine', img: 'b.jpg', gif: 'b.gif' },
  { id: '0585', n: 'lever leg extension', bp: 'upper legs', eq: 'leverage machine', img: 'c.jpg', gif: 'c.gif' },
  { id: '0001', n: '3/4 sit-up', bp: 'waist', eq: 'body weight', img: 'd.jpg', gif: 'd.gif' }
];
```

**19.2 — `api/catalog.test.js`: arquivo novo** (A18). Não chama `loadCatalog`, então não toca no cache que `routines.test.js` monta. A segurança vem **disso**, não do isolamento entre arquivos: a ordem em que o `node --test` avalia arquivos de teste não é garantida, e o cache de `api/catalog.js` é compartilhado por todos os arquivos do mesmo processo (fecha G05).

```js
// api/catalog.test.js — o arquivo canônico existe e tem a forma que a API espera.
//
//   node --test api/catalog.test.js
//
// Este teste lê o arquivo DIRETO, sem passar por loadCatalog(): o cache daquele módulo é
// compartilhado por todos os arquivos de teste do mesmo processo, e routines.test.js o aponta
// para um fixture de 4 entradas. A ordem entre arquivos não é garantida, então a única forma
// de ser correto sob qualquer ordem é não tocar no cache.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CATALOG_PATH, CATALOG_EXPECTED } from './catalog.js';

// O mesmo da lista canônica (docs/specs/spec_catalogo_unico.md, A1).
const FIELDS = ['id', 'n', 'bp', 'eq', 'tg', 'mg', 'sm', 'st', 'img', 'gif'];

describe('catálogo canônico', () => {
  test('o arquivo do app existe, é lista, e tem os campos que a API usa', () => {
    assert.ok(CATALOG_PATH.endsWith('frontend/src/lib/exercises-data.json'),
      `caminho inesperado: ${CATALOG_PATH}`);
    const data = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    assert.ok(Array.isArray(data), 'o catálogo precisa ser uma lista');
    assert.equal(data.length, CATALOG_EXPECTED);

    for (const e of data) {
      for (const f of FIELDS) assert.ok(f in e, `${e.id}: campo ausente ${f}`);
    }
    const ids = new Set(data.map(e => e.id));
    assert.equal(ids.size, data.length, 'há id repetido');
    for (const id of ids) assert.match(id, /^\d{4}$/);

    const le = data.find(e => e.id === '0001');
    assert.equal(typeof le.n, 'string');
    assert.ok(le.n.length > 0);
    assert.equal(typeof le.eq, 'string');
    assert.ok(le.img && le.gif);
  });
});
```

- A contagem 1324 vem de `CATALOG_EXPECTED`, não de um literal novo (A6).
- O `api/package.json` não tem script `test`; a suíte roda como `node --test` de dentro de `api/`. Nada muda nisso.

### 20. Testes manuais

1. **App não mudou.** `docker compose build web && docker compose up -d web` → abrir `https://opengym.edsc.fun`, entrar em Exercises: o subtítulo diz "1324 exercises with animations"; buscar "calf press" → o nome aparece com `°` e sem o `в`; abrir um exercício → GIF anima.
2. **API subiu com o catálogo.** `docker compose logs api | grep "catalogo carregado"` → **uma** linha, com `/app/frontend/src/lib/exercises-data.json` e `1324`.
3. **Análise com nome.** `curl -s -b <cookie> https://opengym.edsc.fun/api/coach/analysis | python3 -c "import json,sys; d=json.load(sys.stdin); print([k for k in d['progress'] if k.isdigit()])"` → lista vazia.
4. **Rotina grava.** Um `PATCH` pelo app não pode responder 503; conferir a linha `[og-routine] op=patch` no log do container.
5. **Fail-fast funciona.** `docker compose stop api`; renomear o JSON; `docker compose start api`; `docker compose logs api` → `FATAL: catalogo ausente/ilegivel`; `docker compose ps api` → não fica `Up`. Desfazer e conferir que sobe.
6. **Contagem divergente só avisa.** Acrescentar uma entrada falsa temporária ao JSON, reiniciar → `AVISO: catalogo com 1325 exercicios`; a API sobe e responde. Desfazer.
7. **Escritor do agente.** `python3 ~/.hermes/workout/scripts/opengym_writer.py doctor` → imprime o caminho novo e `1324`; `python3 ~/.hermes/workout/scripts/verificar_prescricao.py --help` → default novo.
8. **Mídia completa.** `node scripts/check-exercises.mjs --media /mnt/drivebackup/apps/openGym/media` → `ok: 1324 exercícios…`, exit 0.
9. **O script pega e conserta.** Copiar o JSON, injetar `в` antes de um `°` em dois nomes, rodar → exit 1 nomeando os dois ids; rodar com `--fix` → exit 0 e os nomes limpos; restaurar o original.
10. **Limpeza.** `find /home/pi/.hermes -name 'exercise_catalog.json' -not -path '*_retired*' -not -path '*_archive*'` → vazio. `find /home/pi/.hermes/workout/_retired_catalogs_20260911 -type f | wc -l` → 6.
11. **Leitor legado ainda lê.** `cd ~/.hermes/workout/scripts && python3 -c "from opengym_reader import _load_exmap as f; m=f(); print(len(m), m['0585'])"` → `1324 {'n': 'lever leg extension', 'eq': 'leverage machine'}`. E, se quiser exercitar o caminho inteiro: `python3 process_workout_legacy.py` com a API fora do ar (fecha F15).
12. **Datasets idênticos ao de antes.** Script do RF-2 sobre `/tmp/exercises-data.js.antes` e o `.json` novo → nenhuma diferença de conteúdo.
13. **Suítes.** Frontend `237`, API `75` + `api/catalog.test.js` (1), Python `30` + `10` — todas verdes. **A suíte da API é conferida, não presumida**: com o cache por caminho (A9), `checkRoutineFields` passa a resolver o catálogo canônico em vez de receber o fixture de carona nos testes (ver A8/G01). Se algum caso falhar, a causa provável é um id que só existe no fixture de 4 entradas.

---

## Comportamento Visual/UX

Esta mudança **não altera nenhuma tela do app**. É de bastidor: o que o usuário vê hoje (nomes, GIFs, telas) continua igual. O que muda é o que ele **deixa de ver** — um nome com lixo colado — e o que acontece quando o arquivo que alimenta tudo dá problema. As três superfícies abaixo são as que têm comportamento observável.

### UX-1 — Nome do exercício na tela (o defeito que já aconteceu)

O agente nomeia o exercício pelo catálogo; o app desenha `ex.n`. Antes da correção de 11/09, quatro exercícios apareciam com um `в` cirílico invisível colado antes do `°`:

```
╭──────────────────────────────────────────────╮
│  Exercises                      1324 with…   │
╰──────────────────────────────────────────────╯
  🔍 [ calf                                    ]

  ANTES (11/09, antes do commit 422002a)
  ┌────────────────────────────────────────────┐
  │ [GIF]  Sled 45в° calf press                │  ← o "в" está lá,
  │        calves · sled machine               │    invisível a olho nu
  └────────────────────────────────────────────┘
  ┌────────────────────────────────────────────┐
  │ [GIF]  Sled 45в° calf press                │
  │        calves · sled machine               │
  └────────────────────────────────────────────┘

  DEPOIS (e é o que a verificação nova impede de voltar)
  ┌────────────────────────────────────────────┐
  │ [GIF]  Sled 45° calf press                 │
  │        calves · sled machine               │
  └────────────────────────────────────────────┘
```

Se a verificação (RF-10) estivesse no lugar antes, ela teria barrado a entrada do defeito nomeando o arquivo, o id e a sugestão — em vez de o defeito aparecer em 5 arquivos e ser encontrado por acaso semanas depois.

### UX-2 — O que o operador vê ao rodar a verificação

```
$ node scripts/check-exercises.mjs --media /mnt/drivebackup/apps/openGym/media

  ── catálogo são ───────────────────────────────────────────────
  ok: 1324 exercícios, 10 campos, mídia conferida em /mnt/.../media      [exit 0]

  ── catálogo com um nome corrompido ────────────────────────────
  0738: nome com homoglifo: "sled 45в° calf press" — sugerido: "sled 45° calf press"
  0739: nome com homoglifo: "sled 45в° calf press" — sugerido: "sled 45° calf press"
  0740: nome com homoglifo: "sled 45в° one leg calf press" — sugerido: "sled 45° one leg calf press"
  0742: nome com homoglifo: "sled 45в° twin calf press" — sugerido: "sled 45° twin calf press"

  4 problema(s) em frontend/src/lib/exercises-data.json                 [exit 1]

$ node scripts/check-exercises.mjs --media /mnt/drivebackup/apps/openGym/media --fix
  --fix: 4 nome(s) corrigido(s) — backup em .../exercises-data.json.bak.2026091118130
    0738: sled 45° calf press
    0739: sled 45° calf press
    0740: sled 45° one leg calf press
    0742: sled 45° twin calf press
  ok: 1324 exercícios, 10 campos, mídia conferida em /mnt/.../media       [exit 0]

  ── catálogo com mídia faltando ────────────────────────────────
  1234: gif não encontrado em /mnt/.../media/gif: 1234-Ab3xY9z.gif
  5678: img não encontrado em /mnt/.../media/img: 5678-Qq7Ww2e.jpg

  2 problema(s) em frontend/src/lib/exercises-data.json                 [exit 1]
  # este caso o --fix NÃO resolve: a mídia tem de vir do dataset original.

  ── a base cresceu de propósito (aviso, não erro) ──────────────
  aviso: o catálogo tem 1325 exercícios; o esperado é 1324 (a base pode crescer
         — se cresceu de propósito, atualize CATALOG_EXPECTED em api/catalog.js)
  ok: 1325 exercícios, 10 campos, mídia conferida em /mnt/.../media       [exit 0]
```

### UX-3 — O que o operador vê quando o arquivo único some

Decisão do usuário (pergunta 1, resposta A): o servidor não sobe.

```
$ docker compose logs api
  [og-routine] catalogo indisponivel: /app/frontend/src/lib/exercises-data.json
               ENOENT: no such file or directory, open '/app/frontend/src/lib/exercises-data.json'
  [og-routine] FATAL: catalogo ausente/ilegivel em /app/frontend/src/lib/exercises-data.json
  [og-routine] o arquivo canonico e frontend/src/lib/exercises-data.json

$ docker compose ps api
  NAME            STATUS
  opengym-api-1   Restarting (1) 8 seconds ago      ← em loop, e o log diz por quê
```

O que o app faz nesse estado: abre normalmente (a tela é estática), mas nenhuma chamada de dados funciona. Nada é gravado errado nesse meio-tempo, que é o ponto da decisão.

Para comparação, o comportamento de **hoje** — que a mudança elimina:

```
$ docker compose logs api
  [og-routine] catalogo indisponivel: /app/exercise_catalog.json ENOENT…
  [og-routine] ATENCAO: catalogo ausente — escrita de rotina respondera 503
                                                       ← e o servidor sobe normalmente

$ curl -s -b <cookie> …/api/coach/analysis | head -c 200
  {"analysis":{"prs":[{"ex":"0585","e1rm":…              ← id no lugar do nome
```

---

## Critérios de Aceite

1. Existe **um** arquivo com a lista de exercícios no repositório: `frontend/src/lib/exercises-data.json`, com 1324 entradas e os 10 campos.
2. `api/exercise_catalog.json` não existe e nenhum arquivo do repositório aponta para ele. A única sobrevivência da string `exercise_catalog.json` é como nome do fixture em `TMP` dentro de `api/routines.test.js` (item 11), mais as specs históricas com nota de rodapé.
3. No host `hermes`, fora de `_retired_catalogs_20260911/` e de `_archive_2026-09-08/`, não existe nenhum `exercise_catalog.json`, `catalog_summary.json` nem `opengym_exmap.json` (**rodar depois do item 11**). E `GET /api/coach/analysis` não devolve nenhuma chave de `progress` que seja um id de 4 dígitos.
4. O log de boot da API tem **uma** linha `catalogo carregado: 1324 exercicios de …/frontend/src/lib/exercises-data.json`.
5. `node scripts/check-exercises.mjs --media /mnt/drivebackup/apps/openGym/media` sai 0 com 1324/1324 de `img` e `gif`; com um nome corrompido injetado, sai 1; com `--fix`, volta a 0. Com uma 1325ª entrada, sai **0** com aviso de contagem. Com `--media` sem valor, sai **2**.
6. Suítes verdes: frontend 237, API 75 + `api/catalog.test.js`, Python 30 + 10.
7. `docker compose build api web` completa; `https://opengym.edsc.fun` responde 200; um `/img/*.jpg` e um `/gif/*.gif` respondem 200.
8. Nos **dois** `SKILL.md` (o global e o do profile `treinador`, item 17.13): `grep -n "references/exercise_catalog\|catalog_summary"` → 0 linhas. No global, `grep -n "\bname\b"` → apenas as linhas 2 e 31, e o laço das doze linhas mostra cada uma editada.
9. Conteúdo do catálogo idêntico ao de antes da mudança, fora o envelope (comparação automatizada sobre o `/tmp/exercises-data.js.antes`).
10. `grep -c readFileSync api/coach.js` → 0 e `grep -c "from 'node:fs'" api/coach.js` → 0.
11. A linha `Sending build context to Docker daemon` de `docker compose build api web` fica na casa dos **poucos MB** (hoje seriam ~484 MB), provando que `.dockerignore` está em vigor e que `og.key`, `media/`, `.git` e `node_modules` não são enviados.
12. `find /home/pi/.hermes/workout/_retired_catalogs_20260911 -type f | wc -l` → **6**.

---

## Riscos

| ID | Risco | Mitigação |
|---|---|---|
| **R-1** | O contexto de build da raiz vale para **dois** serviços; o `.dockerignore` novo pode quebrar o build do `web` (que já usava a raiz, mas sem ignore e contando com o `node_modules` do host sendo copiado). | Buildar e subir **os dois**, e conferir página + `/img` + `/gif`. É o critério 7. Se o web quebrar, o suspeito nº 1 é o ignore. |
| **R-2** | `image: ghcr.io/duartesantos8/opengym-api:latest` continua no compose para o `api`: um `docker compose pull` traria a imagem **do projeto original**, que nunca teve catálogo nenhum e responderia 503 em toda escrita de rotina. | Pré-existente (não nasce desta spec) e registrado em A27. Se incomodar, trocar a linha `image:` por uma tag local. |
| **R-3** | Se o projeto original mexer no dataset, o arquivo renomeado aparece no merge como "apagado + criado". | Medido: zero merges até hoje e `main` de lá congelado em `c42ba6b` (03/08/2026) — o único commit que tocou o arquivo é esse. Risco registrado, não mitigado. |
| **R-4** | `process.exit(1)` no boot + `restart: unless-stopped` = container reiniciando em loop. | É o comportamento pedido (pergunta 1, resposta A); o log nomeia o arquivo. Se incomodar, trocar por `restart: on-failure:3` — decisão de operação, não de código. |
| **R-5** | A contagem 1324 aparece em dois lugares de linguagens diferentes (`api/catalog.js` e `opengym_writer.py:54`). | Assumido em A6. Se a base crescer, os dois avisam e nenhum quebra. |
| **R-6** | O agente pode achar uma cópia aposentada em `_retired_catalogs_20260911/` e usá-la. | A skill passa a proibir nomear, ler e comparar qualquer `exercise_catalog.json` fora do caminho canônico, citando o diretório de aposentados pelo nome (item 17.2). |
| **R-7** | `data/db.json`, `data/secret` e `data/vapid.json` estão versionados no repositório (commit `c42ba6b`, do projeto original) e o repositório é público. | São dados de desenvolvimento do autor original (usuário "Arvids" de 03/08), **não** o segredo de produção — conferido: o segredo de produção não é legível por `pi` e fica em `/mnt/drivebackup/apps/openGym/data`. Fora do escopo desta spec. O `.dockerignore` tira `/data` do contexto. |
| **R-8** | O `--fix` do script de verificação reescreve o arquivo canônico. | Só corrige homoglifo antes de `°`; nunca reordena nem renomeia; sempre faz backup ao lado antes de gravar (A13). O teste 9 confere em cópia. |
| **R-9** | **Achado fora de escopo:** o repositório carrega **137 MB de mídia versionada no git** (`media/` com 2.649 arquivos rastreados, 1324 img + 1324 gif) além dos 128 MB de `.git`. Todo clone, todo backup e todo push carregam isso, e a mesma mídia já existe em `/mnt/drivebackup/apps/openGym/media`. | Não é tocado aqui. O `.dockerignore` novo tira `/media` do contexto de build (ganho imediato de 137 MB por build). Decidir depois se a pasta deveria sair do git e passar a ser baixada pelo serviço `media` do compose, como o resto. |
| **R-10** | Os comandos de teste do frontend montam `frontend/node_modules` do host (197 MB) dentro do container. | Funciona porque o Pi e o container são ambos `linux/arm64` e o diretório já está instalado no host. Se um dia o `node_modules` do host sumir, o comando precisa de `npm ci` antes. |
| **R-11** | `grep -rl` recursivo no repositório esbarra em `og.key` (`-rw------- root:root`) e imprime "Permission denied". | Os comandos de conferência usam `--exclude=og.key` e `2>/dev/null`. Não é defeito a corrigir; é ruído a evitar. |

---

## Verificação (comandos)

Rodar sempre de dentro de containers — **não há node nem npm no Pi**.

```bash
cd /mnt/drivebackup/apps/openGym/openGym

# app (assume frontend/node_modules já instalado no host — R-10)
sudo docker run --rm -v "$PWD/frontend":/app -w /app node:22-alpine npx vitest run
sudo docker run --rm -v "$PWD/frontend":/app -w /app node:22-alpine npx vite build

# api — ATENÇÃO: o contexto agora é a RAIZ (o Dockerfile referencia api/ e frontend/)
sudo docker build -q -f api/Dockerfile -t og-api-test .
sudo docker run --rm -v og-api-nm:/app/node_modules -v "$PWD":/repo -w /repo/api \
  node:22-alpine sh -c 'ln -sf /app/node_modules node_modules && node --test'

# hermes
cd /home/pi/.hermes/workout/scripts && python3 -m unittest test_escritor_rotinas test_verificar_prescricao

# catálogo
cd /mnt/drivebackup/apps/openGym/openGym && \
  node scripts/check-exercises.mjs --media /mnt/drivebackup/apps/openGym/media

# containers + tamanho do contexto (critério 11)
sudo docker compose build api web 2>&1 | grep -i "Sending build context"
sudo docker compose up -d
sudo docker compose logs api | grep "catalogo carregado"
```

O volume nomeado `og-api-nm` existe desde a BACKLOG-01 e é o que dá `node_modules` à API (o repositório não tem). O `-f api/Dockerfile` com contexto `.` é a correção do item F08 da revisão 1: com `./api` como contexto, o build falha porque o Dockerfile passou a referenciar `frontend/`.

---

## Achados da revisão 1 (consolidação)

21 achados de um revisor adversarial (subagente com acesso ao repositório real). **7 bloqueantes**, todos corrigidos na v2. Onde o achado estava errado, digo por quê.

| ID | Sev. | O que era | Resolução na v2 |
|---|---|---|---|
| **F01** | bloqueante | `fileURLToPath` fica órfão em `api/server.js` (usado só na linha 20), e a spec se contradizia dizendo que ele "continua sendo usado". | **A24**: o import vira `import { pathToFileURL } from 'node:url';`. Conferido: `path` é usado em 8 linhas, `pathToFileURL` na 779. Item 7. |
| **F02** | bloqueante | A memoização `_checked` fazia "primeira chamada vence": o `coach.js` carrega primeiro e o argumento de quem chama depois é **silenciosamente ignorado**. A spec não dizia quem faz a carga inicial. | **A9**: memoização **por caminho** (`_loadedPath === catalogPath`). **A22**: documenta que a primeira carga sai do `coach.js` e que o boot do `server.js` só reaproveita. Itens 4 e 7. |
| **F03** | bloqueante | O script de verificação importava `api/catalog.js`, que respeita `OG_CATALOG`, mas usava um caminho próprio hardcoded — dois caminhos divergentes no mesmo processo. | **A15**: o script confere sempre o canônico e **avisa** se `OG_CATALOG` estiver definida. Item 12. |
| **F04** | bloqueante | Homoglifo **fora** da posição antes do `°` virava erro permanente e sem conserto. | **A13**: continua fatal (o nome está errado de verdade), mas a mensagem diz "NÃO corrigível automaticamente — corrija à mão". O regex virou constante de módulo, compilada uma vez. Item 12. |
| **F07** | bloqueante | `COPY` arquivo a arquivo continua frágil: `routines.fixtures.json` não entra, e um módulo novo esquecido repete o incidente do `units.js`. | **A19**: `COPY api/*.js ./` + `RUN rm -f ./*.test.js`. **A20**: o `fixtures.json` não é necessário na imagem. Item 9. |
| **F10** | bloqueante | O teste novo do catálogo era ambíguo e mexia no cache compartilhado com o fixture de `routines.test.js` — bomba de ordem. | **A18**: arquivo novo `api/catalog.test.js`, que lê o JSON direto com `readFileSync`, **sem chamar `loadCatalog`**. Item 19.2. |
| **F11** | bloqueante | `export { … } from './catalog.js'` **não cria binding local** — `routines.js:427` chama `loadCatalog(catalogPath)` pelo nome e daria `ReferenceError` em toda escrita de rotina. | `import` **e** `export` no item 5, com o motivo escrito no código. Erro real, não hipotético. |
| **F05** | média | Contagem divergente contava como problema → exit 1, contradizendo A7 e o critério de aceite 6. | **A14**: `warnings` separados de `problems`; aviso não afeta o código de saída. Critério 5 atualizado. |
| **F06** | média | A spec afirmava que o `media/` do repositório "não é o que serve o app". | **Errado, e a revisão mediu:** os dois têm 1324 img + 1324 gif. **A12** corrigido: o default está certo; `--media` é para conferir o volume do Pi explicitamente. Virou também o achado **R-9** (137 MB versionados). |
| **F08** | média | O comando de verificação da API ainda usava `./api` como contexto, que passa a falhar. | Corrigido para `sudo docker build -q -f api/Dockerfile -t og-api-test .` na seção Verificação. |
| **F09** | média | Os comandos do frontend assumem `frontend/node_modules` no host sem dizer. | **R-10** registra a premissa. |
| **F12** | média | O `catalogPath` injetado por `makeHandlers` ficaria vestigial. | Dissolvido por **A9**: com o cache por caminho, o parâmetro continua tendo efeito. |
| **F13** | média | Nada garantia que `og.key` não entrasse no contexto de build. | Critério de aceite **11**: tamanho do contexto na casa dos poucos MB. |
| **F14** | média | O log de contagem do escritor dizia "confira o espelho do repo", texto que passa a ser falso. O escritor também não usa `n`. | String corrigida no item 13; **A23** registra que o escritor não precisa do nome e que isso não é lacuna. |
| **F15** | média | A mudança do `opengym_reader.py` (caminho legado) não tinha teste nem verificação. | Teste manual **11**, com comando de uma linha que prova 1324 entradas e um nome conhecido. |
| **F21** | média | `fs`/`path` mortos em `coach.js` passariam por todos os critérios. | RF-6 e critério 10 ganharam `grep -c "from 'node:fs'" api/coach.js` → 0. |
| **F16** | leve | RF-11 dizia 5 arquivos aposentados; o item 16 lista 6. | RF-11, item 16 e critério 12 dizem **6**. |
| **F17** | leve | A linha 31 da skill continuava mandando registrar custom no catálogo, alinhada com a doença. | Itens 17.6 e 17.7: custom vai para `S.customEx` no state. |
| **F18** | leve | Mais quatro menções a `name` como campo do dataset (linhas 26, 28, 32, 176) que passariam pelo `grep` do RF-9. | RF-9 estendido; item 17 muda **doze** linhas; a conferência lista as duas ocorrências legítimas que sobram. |
| **F19** | leve | A justificativa de trocar o fixture estava invertida (o fixture não amarra nada). | Justificativa reescrita no item 19.1: quem amarra é `api/catalog.test.js`. |
| **F20** | leve | "Aceite (conferido)" no BACKLOG-04 sem comando correspondente. | Texto do item 18.2 aponta os critérios 3 e 4. |

**Achados da revisão que a spec não tinha e que entraram:** `api/routines.js:116` com a mensagem de erro citando `exercise_catalog.json` (**A21**, item 6); `grep -rl` esbarrando em `og.key` mode 600 (**R-11**); `api/package.json` sem script `test` (registrado no item 19.2); e a justificativa errada de A5 sobre "ciclo com `server.js`" — `routines.js` não importa `coach.js`; o problema real é **ordem de avaliação de módulos**, e A5 foi reescrito com o motivo correto.

**Achados que eu descartei sem mudar nada:** `env_file: .env` no compose (resolvido no host, não no build — o ignore não quebra); `.dockerignore` ignorando `docs`/`website`/`assets` (nenhum Dockerfile os copia); `CATALOG_EXPECTED` duplicado entre JS e Python (A6 já assume); `process.exit(1)` em loop (R-4, decisão de operação); `image: ghcr.io/...` (R-2, pré-existente); `build-instructions.mjs` escrevendo no catálogo (só escreve em `frontend/src/instr/`).

## Achados da revisão 2 (consolidação)

Segunda rodada adversarial, agora sobre a v2, com medição no repositório real (inclusive rodando o script da spec em container contra um fixture de 1324 entradas). **12 achados, 1 bloqueante** — e o bloqueante é uma **justificativa minha errada**, não o desenho. Veredito dos 7 bloqueantes da rodada 1: F01, F03, F07 e F11 **corrigidos e conferidos**; F02, F04 e F10 **corrigidos em parte**, com o que faltava virando G01, G02 e G07.

| ID | Sev. | O que era | Resolução na v3 |
|---|---|---|---|
| **G01** | bloqueante | **A8 estava factualmente errada.** Eu escrevi que "o boot do servidor nos testes vê 4 entradas e não 1324". A medição mostra o contrário: `routines.test.js:23` importa `server.js`, que avalia `coach.js` (linha 12) e faz a primeira `loadCatalog(CATALOG_PATH)` no **arquivo canônico real** — 1324. O reset e o fixture só vêm depois, em `:33-34`. | A8 reescrita com a ordem real, e registrado o efeito do cache por caminho: `checkRoutineFields` (`server.js:271`) passa a **recarregar o canônico** em vez de receber o fixture de carona — mais correto, e o teste `CATALOG_UNKNOWN_EX` segue passando. Item 20.13 passa a exigir a suíte da API **conferida**, não presumida. |
| **G02** | média | `catalogEq(id)` lia o mapa global, ou seja o do **último** caminho carregado — cego ao caminho que o `loadCatalog` passou a respeitar. Latente (código morto no repo), mas da mesma classe de F02/F12. | **A28**: `catalogEq(id, catalogPath = CATALOG_PATH)`, ainda um *peek*, mas só enxerga o mapa do caminho pedido. Item 4. |
| **G03** | média | **Existe um segundo `SKILL.md` que a spec não mencionava:** `~/.hermes/profiles/treinador/skills/fitness/treino-coach/SKILL.md`, conteúdo diferente (33.564 B de 07/09), ainda mandando ler `references/exercise_catalog.json` nas linhas 34 e 56 e usando `name` em 8 linhas. O item 16 aposentava os catálogos daquele `references/` e deixaria a prosa apontando para o vazio. | **A29** + item **17.13**: depois das doze edições, copiar o `SKILL.md` atualizado por cima da cópia do profile (com backup). RF-9 e critério 8 passam a conferir os **dois** arquivos. |
| **G04** | média | A linha 44 (item 17.9) não é coberta pelo `grep "\bname\b"` que a spec propõe — o critério não provava que ela mudou. | A conferência do item 17 ganhou um laço pelas **doze** linhas editadas, imprimindo cada uma. Critério 8 atualizado. |
| **G05** | média | A18 prometia que o teste novo era seguro "em nenhum modo de isolamento do `node --test`" — a justificativa certa é outra: ele é seguro porque **não chama `loadCatalog`**, e a ordem entre arquivos de teste não é garantida. | A18 e o comentário do item 19.2 reescritos com o motivo correto. |
| **G06** | leve | O cabeçalho do script prometia `exit 2` para erro de uso, e não existia nenhum `process.exit(2)`; `--media` sem valor caía no default em silêncio. | **A30**: `--media` sem valor (ou seguido de outra flag) sai **2** com a linha de uso. Critério 5 cobre. |
| **G07** | leve | O `--fix` só removia **um** homoglifo antes do `°`; `вв°` (resíduo de uma correção manual apressada) virava erro fatal que o próprio `--fix` poderia ter criado. | Regex passa a `[\u0370-\u03ff\u0400-\u04ff]+(?=°)` — um **ou mais**. O `--fix` fica idempotente. Item 12. |
| **G08** | leve | O item 5 do script pulava em silêncio `img`/`gif` que não fossem string não vazia, então `img: null` passava (o item 3 só acusa **chave** ausente). | O item 5 agora acusa valor vazio/não-texto como erro, alinhado ao item 3. Item 12. |
| **G09** | leve | RF-1 dizia que o `grep` devolve "só arquivos de documentação", mas a string sobrevive em `api/routines.test.js` como nome do fixture em `TMP`. | RF-1 e a tabela do item 11 dizem explicitamente que essa sobrevivência é deliberada e não viola o requisito. |
| **G10** | leve | `assets/` (banner e capturas) ficava dentro do contexto sem que nenhum Dockerfile o copiasse. | `/assets` entra no `.dockerignore`. Confirmação de que nenhuma entrada do ignore casa um `COPY` real foi feita pela própria revisão 2. |
| **G11** | leve | O `find` da conferência devolvia também `api/exercise_catalog.json` do repo, que só sai depois do item 11, enquanto a spec dizia "não pode devolver nada". | A conferência virou dois comandos, com a nota "rodar depois do item 11". Item 16 e critério 3. |
| **G12** | leve | A23 listava quatro campos do catálogo usados pelo escritor e omitia `mode`, citado logo abaixo. | A23 corrigida: `id`, `eq`, `img`, `gif` **e `mode`**, com a explicação de que `mode` não existe em catálogo nenhum e sempre cai no default `"reps"`. |

**Verificações da revisão 2 que passaram sem ressalva** (registradas porque sustentam o desenho): o script do item 12 roda de verdade em container e sai 0 num fixture de 1324 com mídia completa, sai 1 nomeando id/valor/sugestão com o defeito injetado, e `--fix` corrige, faz backup e a rodada seguinte sai 0; `node --test` descobre `api/catalog.test.js` tanto por caminho explícito quanto por descoberta, com `# pass 1 # fail 0`; a simulação da ordem de módulos do `server.js` (coach antes de routines) funciona com o `catalog.js` do item 4; `.dockerignore` não casa nenhum `COPY` dos dois Dockerfiles; os 6 arquivos do item 16 existem; e o `JSON.stringify` do `--fix` reescreve o arquivo em 1 linha sem newline final, coerente com o item 1.

---

## Implementado em 11/09/2026

Executado a partir desta spec na branch `emerson-custom`, sem commit nem push. **Tudo verde**, com quatro divergências em relação ao texto acima — registradas aqui porque nenhuma delas é cosmética.

### Números da verificação

| Frente | Resultado |
|---|---|
| Frontend (`npx vitest run`) | **237/237**, 9 arquivos |
| API (`node --test`) | **76/76** (75 anteriores + `api/catalog.test.js`) |
| Hermes (`python3 -m unittest`) | **40/40** (30 escritor + 10 portão) |
| `vite build` | limpo, bundle `assets/index-CxsFdXOc.js` |
| `check-exercises.mjs` | exit 0 no `media/` do repo **e** no volume do Pi; corrupto → 1; `--fix` → 0; idempotente; `--media` sem valor → 2; `OG_CATALOG` definida → aviso e segue |
| Boot da API | **uma** linha `catalogo carregado: 1324 exercicios de /app/frontend/src/lib/exercises-data.json`, nenhum `FATAL`/aviso |
| `GET /api/coach/analysis` | 200; `progress` com **62** exercícios, **zero** chaves numéricas; `0585` aparece como `lever leg extension` |
| Web | `/` 200 · `/img/0001-2gPfomN.jpg` 200 (6 KB) · `/gif/0001-2gPfomN.gif` 200 (92 KB) |
| Contexto de build | api **11,67 MB** (legacy builder) e web **1,01 MB** (BuildKit) — contra ~484 MB antes |
| Cópias aposentadas | **6**, e o `find` não acha nenhuma fora de `_retired_catalogs_20260911/` e `_archive_2026-09-08/` |
| `SKILL.md` (global e do profile) | 0 ocorrências de `references/exercise_catalog` e `catalog_summary` |

### Divergências entre a spec e o que foi implementado

**1. `catalogMap` no `api/coach.js` era código morto — removido.** A spec (A5, item 8) dizia que `catalogMap` continuaria existindo "porque `buildAnalysis` monta `progress` a partir dele". Medido: depois de `rowsFromState` passar a usar `catalogEntries` direto, `catalogMap` ficou **sem nenhum leitor** no arquivo (era usado só na linha que o item 8 substituiu). Em vez de manter um objeto com 1324 chaves construído a cada processo e nunca lido, ele foi removido junto com o `for` que o preenchia. Efeito visível: nenhum; efeito real: menos um objeto grande por processo.

**2. O comando de teste da API precisou de dois ajustes.** A seção "Verificação" da spec estava errada em dois pontos, e o erro só aparece rodando: (a) o ponto de montagem do volume mudou de `/app/node_modules` para **`/app/api/node_modules`**, porque o `WORKDIR` do `api/Dockerfile` passou a ser `/app/api`; (b) é preciso `rm -rf node_modules` antes do `ln -s`, porque a suíte roda com o repositório montado e havia um `api/node_modules` **residual no repo** (root, gitignored, com um symlink aninhado dentro) que fazia o `ln -sf` criar `node_modules/node_modules` e a suíte morrer com `ERR_MODULE_NOT_FOUND`. Comando que de fato funciona:
```bash
sudo docker run --rm -v og-api-nm:/app/api/node_modules -v "$PWD":/repo -w /repo/api \
  node:22-alpine sh -c 'rm -rf node_modules && ln -s /app/api/node_modules node_modules && node --test'
```
O `api/node_modules` residual foi removido do repo (`sudo rm -rf api/node_modules`) e continua no `.gitignore`.

**3. A conferência do RF-9 dá linhas 2 e 25, não 2 e 31.** A spec previa que as únicas ocorrências de `name` sobreviventes seriam o frontmatter (linha 2) e a linha 31. Medido: são a **linha 2** e a **linha 25**. A 31 saiu porque o texto foi reescrito para "pede o nome em inglês" (sem a palavra `name`), e a 25 sobrevive **de propósito** — ela é justamente a instrução nova que diz "o nome está em `n`, não em `name`". As duas são legítimas; a previsão da spec é que estava imprecisa.

**4. `opengym_writer.py doctor` exige `OPENGYM_UID`.** O comando do passo 7 dos testes manuais falha sem a variável, porque o disco tem mais de um perfil com estado e o script se recusa a escolher sozinho. A forma correta: `OPENGYM_UID=ZPJbmYUfHlfbAYzi python3 opengym_writer.py doctor` → `rotinas=6 workouts=300 customEx=23 exWeights=48`. Não é defeito desta mudança (o comportamento é anterior), mas o comando da spec estava incompleto.

### O que ficou fora, por decisão

- Nada foi commitado nem empurrado. O `git status` tem 19 caminhos (2 remoções, 5 novos, 12 modificados).
- A pasta `media/` (137 MB versionados) continua como estava — é o risco **R-9**, fora de escopo.
- O servidor de preview na porta 8765 segue no ar.


