# Registro e Evolução de Corrida (Atividades portadas do openGym v1.4.5)

*   **Autor:** emersondsc
*   **Status:** Implementado no branch `feat/corrida`. Revisado pelo EGM em 2026-11-21 (estágios 5 a 9). Relatórios: `zoom_out_report_corrida.md`, `comprehension_report_corrida.md`, `critic_report_corrida.md`, `intermediate_zoom_out_report_corrida.md`, `implementation_readiness_report_corrida.md`. Resoluções: `goldfish_review_report_corrida.md` e `goldfish_review_report_corrida_s9.md`, todos na raiz do workspace
*   **Data:** 2026-11-21
*   **Contexto de origem:** `concepts_brief_corrida.md` e `contexto_corrida/FATOS.md`. Neste documento, "Qn", "decisão n" e "recomendação n" referem-se a esse brief.
*   **Termos:** "pace" é o termo técnico usado no texto (segundos por km). Na tela, o rótulo é **"Ritmo"**. FC = frequência cardíaca.

--------------------------------------------------------------------------------

## Overview

Este design adiciona ao fork do openGym (`emersondsc/openGym`, branch `emerson-custom`, v1.4.0) o registro manual de corridas e um cartão de evolução no Histórico.

A corrida é registrada depois de feita, como uma **Atividade**: um registro de um dia, sem séries, separado dos treinos de academia. O formato vem do openGym original ([DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym), v1.4.5), que criou as Atividades em 2026-11-06. Como o fork não tem histórico git em comum com o original, a parte necessária é portada à mão. Neste patch a corrida é a única atividade.

Quem vai usar é uma usuária da instância que corre, provavelmente com um relógio Garmin, e usa o openGym pelo navegador. A instância tem 7 usuários.

## The Problem

Hoje o openGym do fork só sabe registrar treino de academia. Uma corrida na rua não tem onde ficar. O mais perto disso é criar um exercício de cardio dentro de um treino, que guarda só tempo e velocidade. Com isso a corrida aparece como sessão de academia, não tem distância e não tem pace.

A usuária pediu para ver as corridas dela no openGym. As soluções prontas não servem para ela:

*   A integração Garmin do original é um app de relógio para musculação. Ela não importa corridas e só funciona nos apps nativos.
*   A leitura automática do Apple Health / Health Connect, por onde o Garmin manda as corridas para o original, também só existe nos apps nativos. Ela usa o navegador.
*   O formulário manual de Atividades do original guarda só esporte, minutos inteiros, data e nota. Sem distância e com minutos arredondados, não dá para calcular pace nem acompanhar evolução.

Então a solução precisa ser digitada à mão no navegador. Ela precisa ter os campos que uma corrida tem: distância, tempo em segundos e, se ela quiser, elevação, FC e esforço. Precisa também mostrar a evolução com números que vêm desses campos.

O maior risco é de produto, não técnico. O Garmin Connect já mostra tudo isso sem digitação, e ela pode parar de registrar depois de algumas corridas. O autor decidiu não consultá-la antes. O risco fica aceito e é medido depois do lançamento (Goal 9).

O maior risco técnico é perder dados. O merge de sincronização do fork só junta à mão as chaves que conhece. Uma chave nova (`activities`) fica com a versão do servidor quando há conflito, e com isso uma corrida salva no celular pode sumir. O formulário do original também descarta, ao salvar, qualquer campo que não conhece.

## Goals

1.  **Registrar uma corrida em menos de um minuto, pelo navegador** (cronometrado no CUJ 1 do teste manual). O formulário pede três campos obrigatórios: data (padrão hoje), distância (aceita vírgula, como `5,2`) e tempo em movimento (aceita `mm:ss` ou `h:mm:ss`). O ritmo aparece enquanto ela digita. Os opcionais (ganho de elevação, FC média, FC máxima, esforço percebido e nota) ficam em "Mais detalhes", fechado por padrão.
2.  **Marcar toda corrida com o selo "Esteira" ou "Ao ar livre".** No formulário, o padrão é "Ao ar livre".
3.  **Mostrar as corridas no Histórico e no calendário do mês**, com marca diferente da do treino de academia. Tocar numa corrida abre o detalhe, para editar ou excluir. O formulário também abre a partir de um dia do calendário que não esteja no futuro. A exceção é o dia com um único treino e nenhuma corrida, que continua abrindo o treino direto, como hoje.
4.  **Mostrar a evolução num cartão "Corrida" no Histórico:**
    *   km da semana atual;
    *   km de cada uma das últimas 8 semanas;
    *   corrida mais longa;
    *   ritmo médio das últimas 5 corridas;
    *   melhor ritmo entre as corridas de 5 km ou mais e, numa segunda linha, entre as de 10 km ou mais. Se não houver corrida com a distância, a linha diz "Ainda sem corrida de 5 km" (ou 10 km).
5.  **Separar corrida de musculação.** Só as corridas lançadas pelo formulário "Registrar corrida" entram no cartão de evolução. O cardio feito dentro de um treino (esteira etc.) continua funcionando como hoje, mas não conta na corrida. O cartão diz isso numa linha: "Só corridas lançadas aqui entram na evolução". Assim uma corrida feita como cardio no treino não conta junto com a mesma corrida lançada no formulário. Lançar a mesma corrida duas vezes no formulário não é detectado.
6.  **Não perder nenhuma corrida na sincronização.** Uma corrida salva num aparelho chega a todos os aparelhos da mesma conta, mesmo quando há conflito de revisão. Uma corrida apagada não volta. Clientes antigos (PWA em cache) não apagam corridas.
7.  **Recusar valores impossíveis com mensagem no app.** Exemplos: distância de 0 ou mais de 300 km, FC máxima menor que a média, data no futuro. O servidor confere só a forma dos dados (exceto data futura, que fica com o app) e descarta o que não serve sem travar a sincronização do resto (Technical Plan §5).
8.  **Textos em PT-BR e EN.**
9.  **Medida de sucesso:** semanas com ao menos uma corrida registrada, entre a 3ª e a 8ª semana depois do lançamento. O número sai do arquivo do perfil dela, sem precisar perguntar. A semana 1 é a semana ISO do deploy. Se forem 3 semanas ou menos das 6, o próximo passo é a importação (Alternativa M), e não mais telas.

## Non-Goals

*   **Outras atividades além da corrida** (pedal, natação, caminhada, futebol etc.) e a lista de 14 esportes do original. O registro grava `sport: 'run'` para manter o formato compatível, mas a tela não mostra outros esportes. Um esporte novo vai exigir mudar também a limpeza do servidor, que hoje descarta `sport !== 'run'`.
*   **Importar corridas** do Garmin, Apple Health, Health Connect, arquivos `.fit`/`.gpx` ou CSV.
*   **Gravar a corrida ao vivo** com GPS ou cronômetro.
*   **Planejar corridas** como rotina, ou o programa corrida/caminhada do original.
*   **Mudanças no MCP e no coach.** O espelho (`espelho/filtra.py`) continua sem copiar `activities`, então o coach não vê as corridas neste patch.
*   **Ligar as corridas à recuperação muscular, ao streak semanal, às metas de cardio, ao resumo anual ("Wrapped"), aos relatórios ou à história do mês.**
*   **Parciais por km, cadência e métricas que só um sensor mede** (tempo de contato com o solo, oscilação vertical, Training Effect).
*   **Melhor tempo em 5 km / 10 km.** Sem parciais não há como saber esses tempos dentro de uma corrida mais longa. O cartão mostra o melhor ritmo no lugar.
*   **Tela própria de evolução e gráficos interativos.** A evolução começa como um cartão.
*   **Desfazer depois de excluir.** Excluir pede confirmação (Q17).
*   **Modo de cardio por distância dentro do treino** (#887 do original). A esteira do treino continua registrando tempo e velocidade.
*   **Contar o cardio do treino na evolução da corrida.** Rejeitado pelo autor (revisa a decisão 10 do brief); ver Alternativa H.

## Open Questions

### Decididas

*   **Q3. Formato dos campos de corrida.** Decidido pelo autor: campos soltos no nível de cima (`sec, place, elev?, hrAvg?, hrMax?, rpe?`), ao lado de `km` e `min`. Isso revisa a recomendação 13 do brief, que propunha um objeto `run`.
*   **Q13. Idiomas.** As traduções vão para `locales/pt.js`, porque o `i18n.js` do fork usa o texto em inglês como chave.
*   **Q15. Formato da remoção.** Decidido pelo autor: `deleted: true`, como em `customSetRoles`. Na revisão do design, o autor aceitou que a remoção descarte os outros campos e que `deleted: true` sempre vença o merge. A regressão de um `readActivity` portado sem conhecer `deleted` é pega por um teste específico (DIP §5).
*   Q1, Q2, Q4, Q5, Q6, Q8, Q11, Q14 e Q16 foram resolvidas no brief.

### Propostas aguardando o autor

Elas aparecem no Technical Plan §6 marcadas "(proposta)".

*   **Q7, esforço:** escala de 1 a 10, como o RPE que o fork já usa nas séries. Na tela aparecem só os números.
*   **Q9, ritmo médio:** ponderado pela distância das últimas 5 corridas (`Σsec ÷ Σkm`), e não a média simples dos paces.
*   **Q10, semana:** começa na segunda-feira, igual ao `Calendar` do fork.
*   **Q12, unidades:** sempre km e m, mesmo quando o perfil usa lb. O fork não segue a conversão para milhas do original.
*   **Q17, excluir:** pede confirmação com o `confirmSheet` que o fork já tem.
*   **Melhor ritmo por selo:** uma linha só para os dois selos, com o selo ao lado do valor.
*   **Elevação na esteira:** o campo fica escondido e não é gravado quando o selo é "Esteira". Não existe campo de inclinação.

## Critical User Journeys (CUJs)

### CUJ 1: Registrar uma corrida na rua

*   **Given**: ela está logada pelo navegador e correu 5,2 km em 28:41 (tempo em movimento, lido no Garmin).
*   **When**: no Histórico, ela toca em "Registrar corrida". Deixa a data em hoje e o selo em "Ao ar livre", digita `5,2` e `28:41`, abre "Mais detalhes", digita FC média 152, e salva.
*   **Then**: a corrida aparece no topo do Histórico e no dia de hoje do calendário, com a marca de corrida e a linha "5,2 km · 28:41 · 5:31/km · Ao ar livre". O cartão "Corrida" soma 5,2 km na semana. Depois da próxima sincronização, a corrida aparece também no outro aparelho dela.

### CUJ 2: Corrida na esteira da academia

*   **Given**: ela correu 3,0 km em 20:00 na esteira da academia.
*   **When**: ela toca em "Registrar corrida", escolhe o selo "Esteira", digita `3` e `20:00` e salva.
*   **Then**: a corrida aparece no Histórico com o selo "Esteira" e soma 3,0 km no cartão "Corrida". Se em vez disso ela tivesse registrado a esteira como cardio dentro do treino, o treino seria salvo como sempre e o cartão não mudaria. A linha "Só corridas lançadas aqui entram na evolução" explica a diferença.

### CUJ 3a: Corrigir uma corrida

*   **Given**: ela digitou `52` em vez de `5,2` km e salvou. O app aceitou, porque 52 km está dentro do limite de 300, e mostrou o aviso de ritmo fora do comum (0:33/km), sem recusar.
*   **When**: ela toca na corrida, corrige para `5,2` e salva.
*   **Then**: a linha passa a mostrar 5,2 km e o cartão é recalculado.

### CUJ 3b: Excluir uma corrida

*   **Given**: uma corrida registrada por engano.
*   **When**: ela toca na corrida, toca em Excluir e confirma.
*   **Then**: a corrida some de todos os aparelhos e não volta numa sincronização posterior, mesmo que outro aparelho tenha uma edição dela.

### CUJ 4: Conflito de sincronização

*   **Given**: o celular dela está sem rede, e ela registra uma corrida. Enquanto isso, o coach (um agente que altera rotinas pelo MCP, Technical Plan §1) muda uma rotina dela no servidor.
*   **When**: o celular volta à rede, o envio recebe 409 (revisão velha), e o app faz o merge.
*   **Then**: a rotina alterada pelo coach e a corrida nova ficam as duas no estado final. Nenhuma corrida se perde.

### CUJ 5: Ver a evolução

*   **Given**: ela registrou 12 corridas em 6 semanas, sendo 3 com 10 km ou mais.
*   **When**: ela abre o Histórico.
*   **Then**: o cartão "Corrida" mostra os km da semana, as 8 barras semanais (as semanas sem corrida aparecem com zero), a corrida mais longa, o ritmo médio das últimas 5 e as duas linhas de melhor ritmo (5 km ou mais e 10 km ou mais).

### CUJ 6: Data no futuro

*   **Given**: hoje é 21/11.
*   **When**: no formulário, ela escolhe 22/11.
*   **Then**: o campo mostra "Data no futuro" e Salvar fica desabilitado até ela corrigir.

## Technical Plan (Architecture)

Os nomes de arquivo abaixo foram conferidos no `emerson-custom` da VPS em 2026-11-21, em modo somente leitura.

### 1. Visão de componentes

```text
   NAVEGADOR (PWA)                                        SERVIDOR (VPS, opengym-api-1)
 ┌──────────────────────────────────────────────┐       ┌───────────────────────────────┐
 │ views/History.jsx                            │       │ api/server.js                 │
 │  ├─ RunCard (cartão "Corrida")  ◄─ run-stats │       │  PUT /api/data                │
 │  ├─ botão "Registrar corrida" ─► RunLog      │       │   └─ checkState(s)            │
 │  └─ lista: treinos + corridas por data       │       │   └─ sanitizeActivities ◄─────┼─ api/activities.js (novo)
 │ sheets.jsx › Calendar e dayOverrideSheet     │       │   └─ atomicWrite(estado)      │
 │  └─ marca de corrida, "Registrar corrida"    │       │  GET /api/data                │
 │                                              │  PUT  │                               │
 │ lib/activities.js (novo)                     │──────►│ data/<uid>.json               │
 │  readActivity · runsOf · withRun · removeRun │◄──────│  { …, activities: {…} }       │
 │  mergeActivities · validateRun               │  GET  └───────────────────────────────┘
 │ lib/run-stats.js (novo)                      │                 │ (sem mudança)
 │ store/useStore.js                            │                 ▼
 │  DEF.activities = {}                         │       espelho/filtra.py ── não copia
 │  pullState e 409: mergeActivities            │       `activities` (MCP fora do escopo)
 └──────────────────────────────────────────────┘
```

O que **não** muda: rotinas, treinos, o cardio dentro do treino e as rotas do MCP.

#### Outros escritores do estado

O arquivo do perfil não é escrito só pelo app. Cada componente abaixo foi lido no código e mantém `activities`, porque lê o estado inteiro antes de gravar ou não grava o estado:

| Componente | O que é | Como trata `activities` |
| --- | --- | --- |
| `api/routines.js` (`withState`) | rotas de rotina do servidor, usadas pelo MCP | lê o estado inteiro, altera a rotina e grava tudo de volta |
| `/opt/opengym-mcp/app-api/` | cópia de `api/routines.js` usada pelo MCP (o arquivo é idêntico, `diff -q` sem diferença) | o mesmo de `api/routines.js` |
| coach | um agente (Claude) que altera rotinas do usuário pelo MCP, por meio das rotas acima | não toca em `activities` |
| `opengym_writer.py` (hermes, `/home/pi/.hermes/workout/scripts/`) | script do agente que edita rotinas | faz `GET /api/data`, altera uma cópia e faz `PUT` do estado inteiro. A verificação por hash cobre as chaves fora do plano, `activities` inclusive |
| `espelho/filtra.py` (`/opt/opengym-mcp/espelho/`) | gera a cópia filtrada do estado que o MCP lê | copia só uma lista fixa de chaves, e `activities` não está nela |

### 2. Modelo de dados

Uma chave nova no estado do perfil, `S.activities`, um mapa por id:

```text
S.activities = {
  "m<uid>": {
    d:         "2026-11-21",     // dia local, AAAA-MM-DD; o app recusa data futura
    sport:     "run",            // só "run" neste patch
    km:        5.2,              // > 0 e ≤ 300, 2 casas
    sec:       1721,             // tempo em movimento, inteiro, 60 a 86.400
    min:       29,               // derivado: max(1, round(sec/60)); só para compatibilidade com o original
    place:     "outdoor",        // "outdoor" | "treadmill"
    elev?:     48,               // ganho de elevação em m, 0 a 10.000; só com place = "outdoor"
    hrAvg?:    152,              // bpm, 30 a 250
    hrMax?:    178,              // bpm, 30 a 250, ≥ hrAvg
    rpe?:      7,                // esforço percebido, inteiro de 1 a 10
    note?:     "…",              // até 1.000 pontos de código (NOTE_MAX de lib/notes.js)
    src:       "manual",
    _ts:       1732200000000     // ms da última mudança; decide o merge
  },
  "m<uid2>": { deleted: true, _ts: 1732300000000 }   // corrida apagada: só a marca e o carimbo
}
```

*   **Compatibilidade com o original:** `d, sport, km, min, note, src, _ts` têm o mesmo nome e significado do original. `sec, place, elev, hrAvg, hrMax, rpe` e `deleted` são do fork (Q3 e Q15).
*   **`at` não é gravado.** No original, `at` é a hora de início da sessão (`upstream_activities.js`, `at: start`), e a recuperação muscular calcula o fim com `at + min`. Este formulário não pede a hora de início, então o fork não grava `at`. A ordem de duas corridas no mesmo dia vem do `_ts`, como no original. Um porte futuro da recuperação não vai encontrar um `at` com outro significado.
*   **O pace nunca é guardado.** Ele é calculado como `sec / km` (segundos por km) na hora de mostrar.
*   **`min` sempre vem de `sec`.** Só `withRun` escreve `min`.
*   **Arredondamento antes da validação.** `km` é arredondado para 2 casas e só depois validado (0,004 km vira 0 e é recusado).
*   **Forma e limites.** A forma (tipos, `km` e `sec` > 0, `d` no formato ISO) vale no app e no servidor. Os limites do produto (`km ≤ 300`, `sec` de 60 a 86.400, FC, elevação, esforço, data futura) valem só no formulário (`validateRun`).
*   **Id:** `'m' + uid()` (`lib/format.js`), igual ao original. O `uid()` do fork gera base 36 minúscula (`Date.now().toString(36)` mais 5 caracteres aleatórios), por exemplo `mlq3x8k2abcde`, o que é compatível com a regex do §5.
*   **Tamanho:** cerca de 250 bytes por corrida e 40 bytes por remoção. Com 3 corridas por semana, são menos de 40 KB por ano por perfil.

### 3. Leitura, escrita e regras (`lib/activities.js`)

O arquivo é portado de ``contexto_corrida/upstream_activities.js`` só com o que a corrida usa. O comentário do topo do arquivo está no DIP §4. O ``upstream_cardio-goals.js`` não é portado, porque as metas de cardio estão fora do escopo.

*   **`readActivity(entry)`**: devolve o registro limpo ou `null`. Devolve `null` quando `deleted === true`, quando `sport !== 'run'` (decisão 9) ou quando `d`, `km` ou `sec` não têm a forma certa. Ele confere só a forma, não os limites do produto, para que mudar um limite nunca apague corridas no merge. Ele **mantém** os campos do fork. Dois testes detectam uma regressão: o de ida e volta (gravar, ler e comparar os campos) e o de remoção (`{ deleted: true, _ts }` vira `null`).
*   **`runsOf(S)`**: lista as corridas válidas, da mais recente para a mais antiga (por `d`, depois `_ts`).
*   **`withRun(map, id, fields)`**: grava ou edita. A entrada nova **substitui** a antiga. Calcula `min`, carimba `_ts = Date.now()` e descarta `elev` quando `place = 'treadmill'`. Não grava sobre um id apagado. Nesse caso, a corrida recebe um id novo, devolvido ao chamador.
*   **`removeRun(map, id)`**: grava `{ deleted: true, _ts: Date.now() }` e descarta os outros campos. A chave nunca é apagada.
*   **Entrada tolerante e formatação:** distância com vírgula ou ponto, tempo em `mm:ss`, `h:mm:ss` ou minutos soltos, ritmo mostrado como `5:31/km`.
*   **`validateRun(fields, today)`**: devolve os erros como chaves de i18n (texto em inglês, traduzidas em `locales/pt.js`), com os limites do §2. O app recusa `hrMax < hrAvg`. Ritmo fora de 2:00 a 20:00/km é só um **aviso**, nunca recusa.

### 4. Sincronização

#### Merge (`mergeActivities(srv, local)`)

O merge é por id e cobre todas as chaves dos dois lados. `undefined` conta como `{}`.

1.  **Antes de juntar**, cada lado passa pelo filtro: uma entrada ativa que `readActivity` devolve como `null` é descartada, e as outras são guardadas na forma normalizada que ele devolve. Assim o app nunca reenvia o que o servidor descartaria ou limparia (§5), e os dois convergem.
2.  **Se um dos lados tem `deleted: true`**, vence a remoção, qualquer que seja o `_ts`. É a mesma regra de `customSetRoles` (`design_roles_serie.md`: "`deleted: true` vence"). Com isso, um relógio de aparelho errado não ressuscita uma corrida apagada.
3.  **Se os dois estão ativos**, vence o `_ts` maior. No empate, vence a do servidor.
4.  **Se o id existe só de um lado** (e passou no filtro), a entrada fica.

O fork não tem um helper que sirva: `exNotes` é juntado com spread e `exWeights` com `mergeExWeights` (`lib/workout-edit.js`), e nenhum dos dois tem "remoção sempre vence" nem o filtro por `readActivity`. Por isso `mergeActivities` é uma função própria.

#### Onde entra

São os dois pontos de merge de `store/useStore.js`, com uma linha cada, ao lado de `mergeCustomSetRoles`:

*   a função `pullState`;
*   o tratamento de 409 em `pushState`.

Sem isso, uma corrida salva durante um conflito é perdida (CUJ 4).

#### Estado padrão

`DEF.activities = {}` garante que um perfil novo e um backup antigo importado tenham a chave.

#### Granularidade

O carimbo é por corrida, não por campo (Alternativa P). Se ela editar a FC num aparelho e a nota em outro antes de sincronizar, vale a edição com o `_ts` maior. Com relógios divergentes, pode não ser a última de fato. Isso foi aceito (Risks & Mitigations).

```text
 celular (offline)            servidor                 notebook
 ───────────────────          ─────────                ────────
 grava corrida m1 (_ts=100)
                              rev 41 (coach muda rotina)
 volta à rede: PUT If-Match:40
                       ◄───── 409 STALE_STATE
 GET /api/data (rev 41)
 merged = DEF + srv
 merged.activities = mergeActivities(srv.activities, local.activities)  → m1 fica
 PUT If-Match:41 ────────────► rev 42 { routines do coach, activities: { m1 } }
                                                       pull → m1 aparece
```

### 5. Limpeza no servidor (`api/activities.js`, chamada no `PUT /api/data`)

O servidor **limpa, não recusa** (decisão do autor na conferência com o brief, recomendação 18; ver Alternativa O). Ele confere a **forma** dos dados com os mesmos critérios de `readActivity`, mais o corte da nota. Os limites de cada campo ficam no app (`validateRun`), porque o app já descarta o inválido antes do merge (§4) (Alternativa S). O mecanismo segue o `sanitizeRoutineEntry`, que já limpa as rotinas no mesmo `PUT` antes de gravar.

*   **`activities` ausente:** o servidor copia `cur.activities` do arquivo para o estado gravado. Sem isso, um cliente que omitisse a chave apagaria as corridas, porque o `PUT` grava `body.state` inteiro.
*   **`activities` que não é objeto, é array ou tem mais de 5.000 entradas:** o servidor ignora o que chegou e mantém `cur.activities`. Nada é cortado, então uma remoção nunca se perde.
*   **Entrada com id fora de `^[a-z0-9]{1,40}$`, ou que não é objeto:** descartada.
*   **Entrada com `deleted: true`:** o servidor grava só `{ deleted: true, _ts }`. Se `_ts` não for numérico, usa `Date.now()`.
*   **Entrada ativa sem `d` no formato `AAAA-MM-DD`, com `sport !== 'run'`, ou com `km` ou `sec` que não são números > 0:** a entrada é descartada. São os mesmos casos em que `readActivity` devolve `null`.
*   **Entrada ativa com `place` ausente ou desconhecido:** o servidor grava `'outdoor'`, como `readActivity`. Com `_ts` não numérico, grava `Date.now()`.
*   **Entrada ativa com um opcional de tipo errado:** só o campo é removido, e a corrida fica. Exemplos: `elev`, `hrAvg`, `hrMax` ou `rpe` não numéricos, `note` que não é texto. Uma `note` acima de 1.000 pontos de código (`[...note].length`, o critério do `noteBad` em `api/server.js:124`) é cortada.
*   **Chaves fora da lista do §2:** removidas.
*   **Data futura:** o servidor não confere, porque o relógio do servidor e o fuso do aparelho podem divergir. Isso fica com o app.

Quando houver descarte ou remoção de campo, o servidor grava uma linha por `PUT` no log com `console.log`, no formato das outras linhas de `server.js`: `[og-state] op=activities-cleaned uid=… dropped=<n> fields=<lista>`. A linha nunca traz nota nem valores de FC. A resposta continua `200`.

Como o app aplica o mesmo filtro antes de enviar, um descarte aqui só acontece com um cliente com defeito, um cliente antigo ou um script. A entrada descartada não volta, porque o app também a descarta no próximo merge.

### 6. Interface

#### Histórico (`views/History.jsx`)

Hoje é uma tela de 16 linhas de código que lista só os treinos. Ela é aberta por um botão em `views/Stats.jsx` (rota `/history`). Passa a ter:

1.  um botão **"Registrar corrida"** no cabeçalho;
2.  o cartão **"Corrida"** (`components/RunCard.jsx`), que aparece só se existir ao menos uma corrida;
3.  uma lista única de **treinos e corridas por data**. No mesmo dia, as corridas vêm depois dos treinos. A linha da corrida (`RunRow`) usa o ícone `figureRun`, que já existe (`Icon.jsx:28`), e mostra "5,2 km · 28:41 · 5:31/km · Ao ar livre". Tocar abre o formulário em modo de edição.

O subtítulo passa a contar "N treinos · M corridas".

#### Formulário (`RunLog`, em `sheets.jsx`)

Fica em `sheets.jsx`, ao lado do `DayOverride` e do `WorkoutEdit`, para reaproveitar o seletor de data do fork (`WorkoutDate`, que já bloqueia dias futuros), o `confirmSheet`, o `update` e o `toast`. É adaptado de ``contexto_corrida/upstream_ActivitySheet.jsx``, sem a lista de esportes e sem os textos sobre músculos. Os campos:

*   data (padrão hoje, sem futuro);
*   selo Esteira / Ao ar livre;
*   distância;
*   tempo em movimento;
*   ritmo ao vivo;
*   "Mais detalhes", fechado: elevação (escondida na esteira), FC média, FC máxima, esforço e nota.

Os botões são Salvar e, na edição, Excluir (com confirmação, proposta Q17).

#### Calendário e dia (`sheets.jsx`, `Calendar` e `DayOverride`)

*   O dia com corrida ganha um ponto em `--blue`. O dia com treino e corrida mostra os dois pontos.
*   **Tocar num dia:**
    *   um treino só e nenhuma corrida: abre o detalhe do treino, como já acontece;
    *   vários treinos, ou ao menos uma corrida: abre a lista do dia, a mesma folha que o `Calendar` já abre para vários treinos (`WorkoutRow`), agora com as corridas (`RunRow`) depois dos treinos;
    *   nenhum treino e nenhuma corrida: abre o `DayOverride`, como já acontece.
*   O botão **"Registrar corrida neste dia"** aparece na lista do dia e no `DayOverride` só quando o dia não está no futuro (`iso <= todayISO()`). Ele abre o formulário com a data do dia.
*   **Caminhos até o formulário:**
    *   Stats → Histórico → Registrar corrida: 3 toques;
    *   Início → cartão do calendário → dia → Registrar corrida neste dia: 3 toques.

#### Cartão "Corrida" (`lib/run-stats.js` + `RunCard.jsx`)

A semana começa na segunda-feira, como o `Calendar` do fork (proposta Q10). O cartão mostra:

| Linha | Cálculo |
| --- | --- |
| km da semana | soma de `km` das corridas da semana atual |
| Últimas 8 semanas | 8 barras com a soma de `km` por semana. Uma semana sem corrida conta 0 |
| Corrida mais longa | maior `km`. No empate, a mais recente |
| Ritmo médio (últimas 5) | `Σsec ÷ Σkm` das 5 corridas mais recentes (proposta Q9) |
| Melhor ritmo · 5 km ou mais | menor `sec/km` entre as corridas com `km ≥ 5`, com data e selo (proposta: uma linha para os dois selos) |
| Melhor ritmo · 10 km ou mais | o mesmo, com `km ≥ 10` |

Abaixo da tabela, o cartão tem o rodapé "Só corridas lançadas aqui entram na evolução."

### 7. Idiomas

As chaves são o texto em inglês, como no resto do fork. As traduções vão para `frontend/src/locales/pt.js`, e as chaves que já existem lá são reaproveitadas (DIP §15). O plural é manual, como em `exCount`. Os outros 10 idiomas mostram o inglês. Glossário dos rótulos de tela em PT-BR:

| Onde | Rótulos |
| --- | --- |
| Geral | Corrida · Registrar corrida · Registrar corrida neste dia · Esteira · Ao ar livre |
| Formulário | Registrar corrida / Editar corrida (títulos) · Data · Distância · Tempo em movimento · Ritmo (/km) · Mais detalhes · Ganho de elevação · FC média · FC máxima · Esforço percebido · Nota · Salvar · Excluir · Excluir corrida? |
| Cartão | km da semana · Últimas 8 semanas · Corrida mais longa · Ritmo médio (últimas 5) · Melhor ritmo · 5 km ou mais · Melhor ritmo · 10 km ou mais · Ainda sem corrida de 5 km · Só corridas lançadas aqui entram na evolução. |
| Avisos | Corrida registrada · Salvo · Corrida excluída · Ritmo fora do comum, confira distância e tempo · Data no futuro · Obrigatório |

### 8. Lançamento e reversão

*   **Ordem de lançamento:**
    1.  Limpeza no servidor e `DEF`/merge no app, ainda sem tela.
    2.  As telas.
*   **Atualização dos PWAs:** trocar o nome do cache em `frontend/public/sw.js` (`opengym-rt-v1` para `opengym-rt-v2`). O `sw.js` já busca na rede primeiro tudo que não é mídia, então PWAs online carregam o código novo. A troca do nome faz o `activate` apagar o cache antigo (`keys.filter(k => k !== CACHE)`), e nenhum arquivo velho fica servido do cache.
*   **Reverter:** voltar o commit. O código antigo não conhece `activities`, mas mantém a chave, porque o pull faz `Object.assign(DEF, estado)` e o PUT envia o estado inteiro. As corridas ficam no arquivo e voltam a aparecer quando o patch for reaplicado.
*   **Depois do deploy:** conferir no `data/<uid>.json` do perfil de teste que `activities` foi gravado com os campos esperados.

## Alternatives Considered

### Alternativa A: Nova classe de rotina especializada em corrida

*   **Pros**: Usa a estrutura de rotina e treino que o app já tem, e a corrida poderia ser planejada antes.
*   **Cons**: Uma rotina descreve séries, reps e carga. Uma corrida se descreve por distância, tempo e pace. O mapa da semana aceita uma rotina por dia, o que conflita com quem corre no mesmo dia em que treina. Todas as análises de treino (volume, esforço, MCP) teriam de tratar dois formatos.
*   **Reason for Rejection**: Rejeitada pelo autor. O pedido é registrar uma corrida já feita, e o original já separa isso como Atividade, fora das rotinas.

### Alternativa B: Portar a integração Garmin do original

*   **Pros**: O código existe e está publicado na Connect IQ Store.
*   **Cons**: É um app de relógio que acompanha treinos de **musculação** e só funciona pelos apps nativos de iPhone e Android, que o fork não publica. Ele não importa corridas. O `docs/GARMIN.md` do original diz que o cardio é registrado no celular.
*   **Reason for Rejection**: Rejeitada pelo autor. Não resolve o pedido, e a usuária usa o navegador.

### Alternativa C: Ler as corridas do Apple Health ou do Health Connect

*   **Pros**: As corridas do Garmin chegariam sozinhas, sem digitação. É o que o original faz.
*   **Cons**: Só existe nos apps nativos. A web não tem acesso a esses dados.
*   **Reason for Rejection**: Rejeitada pelo autor. A usuária usa o navegador.

### Alternativa D: Portar as Atividades inteiras do original (mais de 30 arquivos)

*   **Pros**: Fica mais perto do original e traz os 14 esportes, a recuperação muscular, o streak e as metas de cardio.
*   **Cons**: A maior parte serve partes fora do escopo (Health nativo, recuperação, streak, metas, relatórios, Strava). Ela também depende de arquivos que o fork não tem (`distance.js`, `cardio-kind.js`, `sync-merge.js`). E como não há histórico git em comum, cada arquivo precisa ser portado à mão.
*   **Reason for Rejection**: Rejeitada pelo autor. Este patch traz só a corrida (decisão 9 do brief).

### Alternativa E: Modelo próprio só de corrida (`S.runs`), fora do formato de Atividades

*   **Pros**: É o código mais curto possível, sem campos de compatibilidade (`sport`, `min`).
*   **Cons**: O formato fica diferente do original. Outros esportes, ou um porte futuro, exigiriam migrar os dados.
*   **Reason for Rejection**: Rejeitada pelo autor. A base é Atividades (decisão 3 do brief), e manter `sport: 'run'` e `min` custa dois campos.

### Alternativa F: Campos de corrida num objeto separado (`run: { sec, place, … }`)

*   **Pros**: Um porte futuro do `readActivity` só precisaria manter uma chave. Não há risco de colisão com um campo que o original venha a criar com o mesmo nome.
*   **Cons**: As leituras e a validação ganham um nível a mais (`a.run?.sec`), e o fork não usa objetos aninhados nos registros do estado.
*   **Reason for Rejection**: Rejeitada pelo autor (Q3). Os campos ficam soltos no nível de cima. O risco de um porte futuro apagar os campos é pego pelo teste de ida e volta.

### Alternativa G: Remoção como entrada vazia com carimbo (`{ _ts }`), como no original

*   **Pros**: É o formato do original, então um porte futuro entende a remoção. Os dados pessoais saem do arquivo.
*   **Cons**: É diferente da convenção do fork (`deleted: true` em `customSetRoles`), e a regra "a remoção sempre vence" fica implícita (entrada vazia) em vez de explícita.
*   **Reason for Rejection**: Rejeitada pelo autor (Q15). Vale `deleted: true`, que segue a convenção do fork. Os dados pessoais também saem, porque a remoção descarta os outros campos.

### Alternativa H: Contar o cardio de corrida feito dentro do treino na evolução

*   **Pros**: Quem já registra a esteira no treino não precisaria lançar a corrida de novo.
*   **Cons**: A mesma corrida passa a ter dois lugares possíveis e pode contar duas vezes. O app também teria de adivinhar quais exercícios de cardio são corrida. E a distância viria de velocidade × tempo, porque o fork não tem cardio por distância.
*   **Reason for Rejection**: Rejeitada pelo autor no design. Isso revisa a decisão 10 do brief. Só as corridas do formulário entram no cartão.

### Alternativa I: Tirar do catálogo os exercícios de cardio de corrida

*   **Pros**: A separação entre musculação e corrida fica imposta pelo próprio app.
*   **Cons**: Afeta os 7 usuários. Rotinas e treinos antigos apontam para esses exercícios e teriam de ser migrados ou escondidos. Também tira a esteira como aquecimento.
*   **Reason for Rejection**: Rejeitada pelo autor. Não contar o cardio na evolução (Alternativa H) resolve a contagem dupla sem mexer no catálogo.

### Alternativa J: Melhor tempo de 5 km / 10 km por faixa de distância

*   **Pros**: Mostra um tempo, que é o número que corredores costumam acompanhar.
*   **Cons**: Sem parciais por km, só conta uma corrida cuja distância total caia numa faixa artificial (por exemplo, 5,00 a 5,30 km). Um 5 km rápido dentro de uma corrida de 10 km nunca aparece.
*   **Reason for Rejection**: Rejeitada pelo autor (Q8). O cartão mostra o melhor ritmo entre as corridas de 5 km ou mais e de 10 km ou mais.

### Alternativa K: Projetar o tempo de 5 km / 10 km a partir de outras corridas (pace × distância ou fórmula de Riegel)

*   **Pros**: Sempre tem um número para mostrar.
*   **Cons**: Mostra tempos que ela não correu. Favorece corridas longas e lentas e distorce as curtas e rápidas.
*   **Reason for Rejection**: Mostra tempos que ela não correu e distorce corridas curtas. Rejeitada pelos revisores do brief e não retomada pelo autor.

### Alternativa L: Guardar o pace no registro

*   **Pros**: A leitura fica um pouco mais simples.
*   **Cons**: O pace é derivado de distância e tempo. Guardado, ele fica errado quando um dos dois é editado.
*   **Reason for Rejection**: Um valor derivado guardado fica errado quando a distância ou o tempo são editados. O pace é calculado ao mostrar. O `min` é a exceção: o formato do original o exige, e só `withRun` o escreve, sempre a partir de `sec`.

### Alternativa M: Importar o CSV exportado do Garmin Connect web

*   **Pros**: Elimina a digitação. O CSV traz distância, tempo, pace, elevação e FC.
*   **Cons**: Precisa de um parser, de deduplicação (id calculado de data, hora e distância) e de uma tela de importação. É um patch próprio.
*   **Reason for Rejection**: Adiada pelo autor, não descartada. É o próximo passo se a medida de sucesso (Goal 9) mostrar que ela não digita as corridas.

### Alternativa N: Esperar o app irmão openRunning do original

*   **Pros**: Nenhum código no fork.
*   **Cons**: Não tem data. Como o fork não faz merge com o original, a integração viria só por outro porte manual.
*   **Reason for Rejection**: Sem data de lançamento, e qualquer integração exigiria outro porte manual. Rejeitada pelos revisores do brief.

### Alternativa O: O servidor recusa com 400 uma corrida inválida

*   **Pros**: Um registro inválido nunca chega ao arquivo, e quem envia fica sabendo.
*   **Cons**: O `PUT /api/data` envia o estado inteiro. Um 400 trava a gravação de treinos e rotinas até alguém corrigir o cliente.
*   **Reason for Rejection**: Rejeitada pelo autor na conferência com o brief (recomendação 18). Uma corrida ruim não pode travar a sincronização do resto.

### Alternativa P: Carimbo por campo em vez de por corrida

*   **Pros**: Edições de campos diferentes da mesma corrida em dois aparelhos não se sobrescrevem.
*   **Cons**: Dobra o tamanho do registro e o código do merge.
*   **Reason for Rejection**: O caso (a mesma corrida editada em dois aparelhos antes de sincronizar) é raro com uma pessoa só.

### Alternativa Q: Merge por id no servidor

*   **Pros**: Protegeria também contra clientes antigos e scripts que gravam o estado sem fazer merge.
*   **Cons**: O `PUT /api/data` é uma escrita do estado inteiro com `If-Match`. Juntar uma chave no servidor cria uma segunda política de merge, e o 409 já leva o app a juntar.
*   **Reason for Rejection**: Duas políticas de merge para a mesma chave são mais difíceis de manter do que o merge que já existe no app. A limpeza do §5 cobre o cliente com defeito.

### Alternativa R: Relógio lógico no lugar de `Date.now()`

*   **Pros**: A ordem das edições não dependeria do relógio dos aparelhos.
*   **Cons**: Exige um contador por registro, sincronizado entre aparelhos, que o fork não tem.
*   **Reason for Rejection**: Com `deleted: true` vencendo sempre (§4), o relógio só afeta duas edições da mesma corrida em aparelhos diferentes, um risco aceito.

### Alternativa S: Validação completa no servidor com arquivo de regras compartilhado (padrão `set-roles.js`)

*   **Pros**: O servidor rejeitaria qualquer valor fora dos limites, mesmo vindo de um script.
*   **Cons**: Os limites ficam em dois lugares e precisam de um teste de paridade, como `set-roles.js`.
*   **Reason for Rejection**: O app já descarta o inválido antes do merge (§4). Com 7 usuários, conferir a forma no servidor basta.

## Risks & Mitigations

| Risco | Mitigação | Situação |
| --- | --- | --- |
| A usuária para de registrar, porque o Garmin já mostra tudo | Formulário com 3 campos obrigatórios. Dois pontos de entrada (Histórico e dia do calendário). Medida de sucesso (Goal 9) e importação como próximo passo (Alternativa M) | aceito pelo autor e medido |
| Corrida perdida num conflito de sincronização | `mergeActivities` nos dois pontos de merge do `useStore.js` (§4) e teste de store | mitigado |
| Corrida descartada pela limpeza do servidor some sem aviso | O app e o servidor usam a mesma regra de forma (`readActivity`). O log `op=activities-cleaned` mostra o descarte | aceito: só acontece com um cliente com defeito, um PWA antigo ou um script |
| Relógio errado num aparelho decide entre duas edições da mesma corrida | `deleted: true` sempre vence, então remoções não dependem do relógio | aceito para edições concorrentes (Alternativas P e R) |
| Um porte futuro do `readActivity` apaga os campos soltos ou ignora `deleted` | Comentário no topo do arquivo e dois testes (ida e volta, remoção) | mitigado |
| Um cliente antigo ou com defeito omite `activities` | O servidor copia `cur.activities` (§5). Os PWAs antigos mantêm chaves desconhecidas (§8) | mitigado |
| Dados de saúde no arquivo do perfil | Só no arquivo do perfil e nos backups. Fora do MCP. A exclusão descarta os campos | mitigado |
| O botão "Registrar corrida" aparece para os 7 usuários | Não muda nada para quem não corre | aceito |
| Os testes do servidor não rodam na CI (o `deploy.yml` só testa o frontend) | `node --test api/*.test.js` como passo manual antes do push (Verification Plan) | aceito |
| O teste da store só confere o texto-fonte do `useStore.js` (o fork não tem jsdom) | O comportamento do merge é testado puro em `activities.test.js`, e o CUJ 4 é testado à mão com dois navegadores | aceito |

## Non-Functional Requirements

*   **Privacidade:**
    *   FC e notas são dados de saúde. Ficam só no arquivo do próprio perfil (`data/<uid>.json`) e nos backups que já existem.
    *   Não vão para o MCP: o `espelho/filtra.py` não copia `activities`.
    *   O log do servidor registra só as contagens e os nomes dos campos limpos, nunca o texto da nota nem valores de FC.
    *   Uma corrida apagada fica só como `{ deleted: true, _ts }`.
*   **Desempenho:** cerca de 250 bytes por corrida. As contas do cartão percorrem a lista de corridas uma vez por render, cerca de 150 corridas por ano.
*   **Lançamento e reversão:** sem feature flag (7 usuários). O cache do service worker passa a ser `opengym-rt-v2`. Reverter é voltar o commit (Technical Plan §8).

--------------------------------------------------------------------------------

## Additional Resources

*   `concepts_brief_corrida.md`: brief, decisões do autor e conferência do código (Q14).
*   `contexto_corrida/FATOS.md`, `upstream_activities.js`, `upstream_ActivitySheet.jsx`: o código do original usado como base.
*   `docs/designs/design_roles_serie.md` (workspace do autor): a convenção `deleted: true` de `customSetRoles`.
*   Original: [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym), `frontend/src/lib/activities.js` (v1.4.5) e `docs/GARMIN.md`.

## Future Improvements

*   **Importar o CSV do Garmin Connect** (Alternativa M), se a medida de sucesso mostrar que ela não digita as corridas.
*   **Corridas no MCP:** acrescentar `activities` à lista de `espelho/filtra.py` e criar ferramentas de leitura para o coach.
*   **Corrida na recuperação muscular e no streak**, como no original. Exige gravar a hora de início em `at`.
*   **Outros esportes**, aproveitando o `sport` que já é gravado. Exige mudar a limpeza do servidor.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Os caminhos são relativos à raiz do repositório do fork (`/mnt/drivebackup/apps/openGym/openGym`, branch `emerson-custom`), exceto onde está escrito outro caminho. Os nomes citados com arquivo e linha foram lidos no fork em 2026-11-21, em modo somente leitura. Não há código aqui, só contratos e regras.

### Target Files to Create/Modify

#### 1. `api/activities.js` (Create)

*   **Type / Scope**: módulo Node (ESM) do servidor, função pura.
*   **Proposed Changes**:
    *   Exporta `sanitizeActivities(incoming, current)`.
    *   **Retorno:** `{ map, dropped, fields }`:
        *   `map` é o mapa a gravar;
        *   `dropped` é o número de entradas descartadas;
        *   `fields` é a lista de nomes únicos dos campos removidos ou corrigidos, em ordem alfabética.
    *   **Regras (Technical Plan §5). Forma, com os mesmos critérios de `readActivity`, mais o corte da nota. Os limites do produto não entram aqui.**
        *   `incoming === undefined`: `map = current || {}`, sem log.
        *   `incoming` não é objeto, é array ou tem mais de 5.000 chaves: `map = current || {}`, sem cortar nada. `dropped` recebe o número de chaves recebidas, ou 1 se não for objeto.
        *   Chave fora de `^[a-z0-9]{1,40}$`, ou entrada que não é objeto: a entrada é descartada.
        *   Entrada com `deleted === true`: vira `{ deleted: true, _ts }`. Se `_ts` não for número finito > 0, usa `Date.now()`.
        *   **Entrada ativa: é descartada se**
            *   `d` não casa com `^\d{4}-\d{2}-\d{2}$`;
            *   `sport !== 'run'`;
            *   `km` arredondado para 2 casas não é um número finito > 0;
            *   `sec` não é inteiro > 0.
        *   **Entrada ativa: é corrigida e entra em `fields` quando**
            *   `place` está ausente ou fora de `['outdoor', 'treadmill']`: vira `'outdoor'`;
            *   `_ts` não é número finito > 0: vira `Date.now()`;
            *   `min` não é igual a `max(1, round(sec / 60))`: é recalculado;
            *   `src` não é string: vira `'manual'`.
        *   **Opcionais:** saem quando o tipo está errado.
            *   `elev`, `hrAvg`, `hrMax` e `rpe` precisam ser números finitos;
            *   `note` precisa ser string. Acima de 1.000 pontos de código (`[...note].length`, o critério de `noteBad` em `api/server.js:124`), é cortada em 1.000.
        *   **Chaves fora de `d, sport, km, sec, min, place, elev, hrAvg, hrMax, rpe, note, src, _ts`:** removidas.
    *   **Por quê:** hoje o `PUT /api/data` grava `activities` sem conferir (Q14). Os limites de cada campo ficam só no app (Alternativa S).

#### 2. `api/activities.test.js` (Create)

*   **Type / Scope**: teste do servidor (`node:test` + `assert`, como `api/notes.test.js`).
*   **Proposed Changes**:
    *   Descarte: uma entrada sem `km`, uma com `km: 0`, uma com `sec: 1.5`, uma com `sport: 'ride'` e uma com `d: '21/11/2026'`.
    *   Correção:
        *   sem `place` vira `'outdoor'`;
        *   `_ts: 'x'` vira número;
        *   `min` errado é recalculado;
        *   `src: 3` vira `'manual'`.
    *   Opcionais: `hrAvg: 'x'` sai, e uma `note` de 1.001 pontos de código (com um emoji) é cortada em 1.000.
    *   Uma remoção com campos extras vira só `{ deleted: true, _ts }`, e uma remoção com `_ts` inválido recebe `Date.now()`.
    *   Uma chave desconhecida `foo` sai.
    *   Array, string ou 5.001 chaves em `incoming` devolvem `current` intacto, com `dropped` igual ao número recebido.
    *   `incoming` ausente devolve `current`.
    *   Um id `'m' + uid()` gerado com o `uid()` de `frontend/src/lib/format.js` passa na regex.
    *   **Caso de contagem:** duas entradas sem `km`, mais uma com `hrAvg: 'x'` e a chave `foo`, devolvem `dropped === 2` e `fields` igual a `['foo', 'hrAvg']`.
    *   **Convergência:** um mapa produzido por `mergeActivities` (frontend, com uma cópia dos casos acima já normalizados) passado por `sanitizeActivities` volta com `dropped === 0` e `fields` vazio.

#### 3. `api/server.js` (Modify)

*   **Type / Scope**: servidor HTTP.
*   **Proposed Changes**:
    *   Importa `{ sanitizeActivities }` de `./activities.js`.
    *   No handler `'PUT /api/data'`, depois de `cur = readStateStrict(user.id)` (`readStateStrict` em `api/server.js:163`) e junto do laço que chama `sanitizeRoutineEntry` (`api/server.js:913`):
        *   atribui `const r = sanitizeActivities(body.state.activities, cur?.activities)`;
        *   atribui `body.state.activities = r.map`;
        *   se `r.dropped + r.fields.length > 0`, chama `console.log(\`[og-state] op=activities-cleaned uid=${user.id} dropped=${r.dropped} fields=${r.fields.join(',')}\`)`.
    *   O `checkState` não muda e a resposta continua `200`.
    *   **Por quê:** decisão do autor: limpar, não recusar (Alternativa O).

#### 4. `frontend/src/lib/activities.js` (Create)

*   **Type / Scope**: módulo do app (dados e formato), puro.
*   **Proposed Changes**:
    *   **Comentário no topo** (texto literal): "Portado do openGym v1.4.5 (`frontend/src/lib/activities.js`, 2026-11-06), reduzido à corrida. Campos do fork: sec, place, elev, hrAvg, hrMax, rpe, deleted. `at` não é gravado. Ao portar de novo, manter esses campos e os testes de ida e volta e de remoção."
    *   **Constantes:**
        *   `PLACES = ['outdoor', 'treadmill']`;
        *   `LIMITS = { kmMax: 300, secMin: 60, secMax: 86400, hrMin: 30, hrMax: 250, elevMax: 10000, rpeMin: 1, rpeMax: 10 }`;
        *   `PACE_WARN = [120, 1200]` (segundos por km);
        *   `NOTE_MAX` importado de `./notes.js` (`lib/notes.js:13`).
    *   **`readActivity(entry)`**, só forma:
        *   devolve `null` quando:
            *   a entrada não é objeto ou tem `deleted === true`;
            *   `sport !== 'run'`;
            *   `d` não casa com a regex ISO (sem comparar com hoje);
            *   `round2(km)` não é número finito > 0;
            *   `sec` não é inteiro > 0;
        *   se não, devolve `{ d, sport: 'run', km: round2(km), sec, min: max(1, round(sec / 60)), place, elev?, hrAvg?, hrMax?, rpe?, note?, src }`:
            *   `place` fora de `PLACES` vira `'outdoor'`;
            *   cada opcional que não é número finito (ou `note` que não é string) sai;
            *   `note` é cortada em `NOTE_MAX` pontos de código;
            *   `src` que não é string vira `'manual'`.
    *   **`runsOf(S)`**: lista `{ id, ...readActivity(e), _ts }` das entradas não nulas de `S.activities`, ordenada por `d` decrescente e depois `_ts` decrescente.
    *   **`runsOn(S, iso)`**: a saída de `runsOf` filtrada por `d === iso`.
    *   **`runDays(S)`**: um `Set` com os `d` de `runsOf`.
    *   **`withRun(map, id, fields, now = Date.now())`** devolve `{ map, id }`:
        *   `fields = { d, km: number, sec: number, place, elev?, hrAvg?, hrMax?, rpe?, note? }`, já convertidos pelo formulário;
        *   se `id` é nulo ou `map[id]?.deleted === true`, usa `id = 'm' + uid()` (`lib/format.js`);
        *   a entrada é montada só com as chaves de `fields`, mais `sport: 'run'`, `src: 'manual'`, `min = max(1, round(sec / 60))` e `_ts = now`, e **substitui** `map[id]`;
        *   opcionais `''`, `null`, `undefined` ou `NaN` não são gravados;
        *   `elev` não é gravado quando `place === 'treadmill'`;
        *   `id` nunca entra na entrada.
    *   **`removeRun(map, id, now = Date.now())`**: devolve um mapa novo com `map[id] = { deleted: true, _ts: now }`.
    *   **`mergeActivities(srv, local)`**: `undefined` conta como `{}`.
        *   **Normalização de cada lado:**
            *   uma entrada com `deleted: true` vira `{ deleted: true, _ts }`;
            *   uma entrada ativa vira `{ ...readActivity(e), _ts: e._ts }`;
            *   uma entrada ativa que `readActivity` devolve como `null` é descartada.
        *   **União das chaves:**
            *   se um dos lados está apagado, vence a remoção. Se os dois estão apagados, fica o `_ts` maior;
            *   se os dois estão ativos, vence o `_ts` maior. No empate, vence `srv`;
            *   uma chave que existe só de um lado fica.
    *   **`parseKm(text)`**:
        *   tira os espaços das pontas;
        *   aceita só dígitos com no máximo um separador (`,` ou `.`);
        *   devolve um número ou `null`. `'5,2 km'`, `'-3'`, `''` e `'5.2.1'` devolvem `null`.
    *   **`parseDuration(text)`**:
        *   tira os espaços das pontas;
        *   aceita `m` (minutos inteiros), `mm:ss` (com `ss` < 60) e `h:mm:ss` (com `mm` e `ss` < 60);
        *   devolve os segundos ou `null`. `'28,5'` e `'28:61'` devolvem `null`.
    *   **Formatação:**
        *   `fmtDuration(sec)`: `28:41`, ou `1:02:05` com uma hora ou mais;
        *   `paceOf(km, sec)`: `sec / km`;
        *   `fmtPace(secPerKm)`: arredonda para o segundo mais próximo, passando para o minuto seguinte quando dá 60, e mostra `m:ss/km`. Por exemplo, `330,96 s` mostra `5:31/km` e `359,6 s` mostra `6:00/km`;
        *   `fmtKm(km)`: `fmtNum(km) + ' km'` (`fmtNum` de `lib/format.js`, 1 casa).
    *   **`validateRun(fields, today = todayISO())`** devolve `{ errors, warnings }`:
        *   `errors` é um objeto `{ campo: chave de i18n }`, e `warnings` é uma lista de chaves de i18n. As chaves estão no item 15;
        *   `km` é arredondado para 2 casas antes de validar;
        *   **erros:**
            *   `d` vazio → `Required`; `d > today` → `Date in the future`;
            *   `km` nulo → `Required`; fora de `0 < km ≤ 300` → `Distance must be between 0 and 300 km`;
            *   `sec` nulo → `Required`; fora de 60 a 86.400 → `Time must be between 1:00 and 24:00:00`;
            *   `hrAvg` ou `hrMax` fora de 30 a 250 → `Heart rate must be between 30 and 250`;
            *   `hrMax < hrAvg` → `Max heart rate is below average` (no campo `hrMax`);
            *   `elev` fora de 0 a 10.000 → `Elevation must be between 0 and 10,000 m`;
            *   `rpe` fora de 1 a 10 inteiro → `Effort must be 1 to 10`;
        *   **aviso:** ritmo fora de `PACE_WARN` → `Unusual pace, check distance and time`.

#### 5. `frontend/src/lib/activities.test.js` (Create)

*   **Type / Scope**: teste unitário (vitest).
*   **Proposed Changes**:
    *   **Ida e volta:** `withRun` → `runsOf` preserva `sec, place, elev, hrAvg, hrMax, rpe` e `note`.
    *   **Remoção:** `removeRun` grava `{ deleted: true, _ts }`, e `readActivity` devolve `null` para essa entrada.
    *   **`withRun`:**
        *   sobre um id apagado, devolve um id novo;
        *   uma edição sem `hrAvg` tira o campo;
        *   `elev` não é gravado com esteira;
        *   `id` não aparece na entrada.
    *   **`readActivity`:**
        *   ignora `sport: 'ride'`;
        *   aceita `d` no futuro (o filtro é só de forma);
        *   sem `place` devolve `'outdoor'`;
        *   tira `hrAvg: 'x'`;
        *   recalcula `min`.
    *   **`mergeActivities`:**
        *   uma corrida só local sobrevive;
        *   uma entrada local inválida é descartada;
        *   uma entrada local com `hrAvg: 'x'` volta sem o campo;
        *   entre duas ativas, o `_ts` maior vence, e no empate vence `srv`;
        *   uma remoção vence uma edição com `_ts` maior (relógio adiantado);
        *   entre duas remoções, fica o `_ts` maior;
        *   `srv` ou `local` `undefined` não quebram.
    *   **Parsers:**
        *   `parseDuration`: `'28'` → 1680, `'28:41'` → 1721, `'1:02:05'` → 3725, `' 28:41 '` → 1721; `'28:61'`, `'28,5'` e `''` → `null`;
        *   `parseKm`: `'5,2'` → 5.2 e `'5.2'` → 5.2; `'5,2 km'`, `'-3'`, `''` e `'5.2.1'` → `null`.
    *   **Formatação:**
        *   `fmtPace(1721 / 5.2)` → `5:31/km`;
        *   `fmtPace(359.6)` → `6:00/km`;
        *   `fmtDuration(3725)` → `1:02:05`.
    *   **Validação:**
        *   os dois lados de cada fronteira (300 e 300,01 km; 60 e 59 s; 30 e 29 bpm; FC máxima menor que a média);
        *   a data futura com `today` fixo;
        *   o aviso de ritmo;
        *   `0,004 km` arredondado para 0 dá erro.

#### 6. `frontend/src/lib/run-stats.js` (Create)

*   **Type / Scope**: módulo de cálculo, puro.
*   **Proposed Changes**:
    *   `runs` é sempre a saída de `runsOf` (ordenada da mais recente para a mais antiga), e `today` é uma string ISO.
    *   **Semana:** a corrida é agrupada por `weekKey(d)` de `lib/format.js` (semana ISO, que começa na segunda). A segunda-feira da semana sai do mesmo cálculo de `weekKey` (`(getDay() + 6) % 7`) e é devolvida como ISO.
    *   **`weeklyKm(runs, today, n = 8)`**: `[{ start, km }]`, da semana mais antiga para a atual. `start` é a segunda-feira em ISO, e uma semana sem corrida tem `km: 0`.
    *   **`thisWeekKm(runs, today)`**: o último item de `weeklyKm`.
    *   **`longestRun(runs)`**: a corrida de maior `km`. No empate, a mais recente. Sem corridas, `null`.
    *   **`avgPaceLast(runs, n = 5)`**: `Σsec ÷ Σkm` das `n` primeiras de `runs`, ou `null`.
    *   **`bestPace(runs, minKm)`**: `{ pace, run }` com o menor `sec/km` entre as corridas com `km ≥ minKm`. No empate, a mais recente. Sem corrida qualificada, `null`.

#### 7. `frontend/src/lib/run-stats.test.js` (Create)

*   **Type / Scope**: teste unitário (vitest).
*   **Proposed Changes**:
    *   Um domingo cai na semana da segunda anterior.
    *   8 semanas, algumas sem corrida (`km: 0`).
    *   A semana de 2026-12-28 a 2027-01-03 junta as corridas dos dois anos.
    *   Empate na corrida mais longa: vence a mais recente.
    *   Ritmo médio ponderado: 5 km em 25:00 e 10 km em 60:00 dão `5100 / 15 = 340 s/km`, e não a média simples (330).
    *   `bestPace` com corridas de exatamente 5,00 km e 10,00 km, sem nenhuma corrida qualificada (`null`) e com empate.

#### 8. `frontend/src/store/useStore.js` (Modify)

*   **Type / Scope**: store (zustand) e sincronização.
*   **Proposed Changes**:
    *   Importa `mergeActivities` de `../lib/activities.js`.
    *   Acrescenta `activities: {}` ao `DEF`.
    *   Na função `pullState`, ao lado de `merged.customSetRoles = mergeCustomSetRoles(state.customSetRoles, S.customSetRoles)`, acrescenta `merged.activities = mergeActivities(state.activities, S.activities)`.
    *   No tratamento de 409 da função `pushState`, ao lado de `merged.customSetRoles = mergeCustomSetRoles(srv.customSetRoles, S.customSetRoles)`, acrescenta `merged.activities = mergeActivities(srv.activities, S.activities)`.
    *   **Por quê:** sem isso, a chave fica com a versão do servidor e uma corrida local se perde (CUJ 4).

#### 9. `frontend/src/store/useStore.test.js` (Modify)

*   **Type / Scope**: teste da store (vitest), no estilo que o arquivo já usa: ele confere o texto-fonte (`SRC`) com regex, porque o projeto não tem jsdom.
*   **Proposed Changes**:
    *   `expect(SRC).toMatch(/merged\.activities = mergeActivities\(srv\.activities, S\.activities\)/)`.
    *   No recorte de `pullState` (`SRC.slice(SRC.indexOf('async pullState('))`), `toMatch(/merged\.activities = mergeActivities\(state\.activities, S\.activities\)/)`.
    *   `expect(SRC).toMatch(/activities: \{\}/)` para o `DEF`.
    *   O comportamento do merge é testado em `activities.test.js` (item 5).

#### 10. `frontend/src/sheets.jsx` (Modify)

*   **Type / Scope**: folhas, formulário e calendário.
*   **Proposed Changes**:
    *   **`RunLog({ id, day, close })`**, um componente novo neste arquivo, ao lado de `DayOverride` e `WorkoutEdit`. Ele usa o que o arquivo já tem: `WorkoutDate`, `confirmSheet`, `update`, `toast` e `t`.
        *   **Título:** `t('Log a run')` para uma corrida nova, ou `t('Edit run')` na edição.
        *   **Campos:**
            *   data: com `WorkoutDate`, que já desabilita dias futuros. O padrão é `day`, ou `todayISO()`;
            *   selo: dois chips (`.chips` e `.chip`), `t('Outdoor')` (padrão) e `t('Treadmill')`;
            *   distância: texto com `inputmode="decimal"`;
            *   tempo em movimento: texto com placeholder `mm:ss`;
            *   embaixo, o ritmo ao vivo (`fmtPace`) e o aviso, quando houver.
        *   **Mais detalhes:** um botão `t('More details')` abre elevação (escondida na esteira), FC média, FC máxima, esforço (10 chips, de 1 a 10) e nota. Na edição, abre sozinho se a corrida tem algum desses campos.
        *   **Edição:** os campos vêm de `runsOf`. A distância aparece com `fmtNum(km)`, e o tempo com `fmtDuration(sec)`.
        *   **Erros:** o formulário converte os textos com `parseKm`/`parseDuration` e chama `validateRun`. O erro de um campo aparece embaixo dele, só depois que o campo perde o foco. Salvar fica desabilitado desde a abertura até não haver erro.
        *   **Salvar:** chama `update(s => { s.activities = withRun(s.activities, id, fields).map })`, depois `close()`, depois `toast(t('Run logged'))` numa corrida nova ou `toast(t('Saved'))` na edição.
        *   **Excluir** (só na edição): chama `confirmSheet({ title: t('Delete run?'), confirmText: t('Delete'), danger: true, onConfirm })`. O `onConfirm` aplica `removeRun` com `update`, depois `close()` e `toast(t('Run deleted'))`.
    *   **`runSheet(id = null, day = null)`**: exportado, abre `RunLog` com `ui().openSheet(close => <RunLog id={id} day={day} close={close} />)`.
    *   **`Calendar`:**
        *   calcula `runDays(st)`;
        *   **ponto:** o dia com corrida ganha `<i className="run" />` ao lado do ponto atual;
        *   **ao tocar num dia:**
            *   um treino só e nenhuma corrida: o comportamento atual (`workoutDetailSheet`);
            *   vários treinos, ou ao menos uma corrida: a folha de lista do dia que o `Calendar` já abre para vários treinos. Ela mostra os `WorkoutRow` e, depois deles, as `RunRow` de `runsOn(st, iso)`. Quando `iso <= todayISO()`, tem também o botão `t('Log a run on this day')`, que chama `runSheet(null, iso)`;
            *   nenhum treino e nenhuma corrida: o comportamento atual (`dayOverrideSheet`);
        *   **legenda:** ganha `t('Run')` com `--blue`.
    *   **`DayOverride`:** quando `iso <= todayISO()`, ganha no fim da lista o item `t('Log a run on this day')`, que fecha a folha e chama `runSheet(null, iso)`.

#### 11. `frontend/src/components/RunRow.jsx` (Create)

*   **Type / Scope**: componente React.
*   **Proposed Changes**:
    *   Exporta `RunRow({ run, showDate, onClick })`, no mesmo formato de `.item`/`.lrow-i` do `WorkoutRow`.
    *   O ícone é `figureRun`, que já existe em `Icon.jsx:28`, então `Icon.jsx` não muda. O título é `t('Run')`.
    *   O subtítulo é `fmtKm(km) · fmtDuration(sec) · fmtPace(paceOf(km, sec)) · t('Outdoor' | 'Treadmill')`, com `fmtDate(d)` na frente quando `showDate`.
    *   Elevação, FC, esforço e nota não aparecem na linha (decisão do autor que revisa a decisão 7 do brief). Eles aparecem no `RunLog`.

#### 12. `frontend/src/components/RunCard.jsx` (Create)

*   **Type / Scope**: componente React.
*   **Proposed Changes**:
    *   Não aparece se `runsOf(S)` está vazio.
    *   Exemplos renderizados, um por linha:

        | Linha | Exemplo |
        | --- | --- |
        | km da semana | "km da semana · 12,4 km" (ou "0 km") |
        | Últimas 8 semanas | 8 barras (`div`), com altura proporcional ao maior valor e rótulo da segunda-feira em `dd/mm` (por exemplo `17/11`) |
        | Corrida mais longa | "Corrida mais longa · 10,3 km · sáb., 15 de nov." (`fmtDate(d, true)`) |
        | Ritmo médio (últimas 5) | "Ritmo médio (últimas 5) · 5:42/km" |
        | Melhor ritmo · 5 km ou mais | "Melhor ritmo · 5 km ou mais · 5:12/km · 12/11 · Ao ar livre" (sem corrida: `t('No {0} km run yet', 5)`) |
        | Melhor ritmo · 10 km ou mais | o mesmo, com 10 km |

    *   O rodapé é `t('Only runs logged here count toward progress.')`.

#### 13. `frontend/src/views/History.jsx` (Modify)

*   **Type / Scope**: tela. Hoje tem 16 linhas de código e é aberta por um botão em `views/Stats.jsx` (rota `/history`).
*   **Proposed Changes**:
    *   **Cabeçalho:** um botão com o ícone `figureRun` e `aria-label={t('Log a run')}`, que chama `runSheet()` (de `../sheets.jsx`).
    *   **Subtítulo:** `t('{0} workouts', n)`, e, quando há corridas, `· ` mais `t(m === 1 ? '{0} run' : '{0} runs', m)`.
    *   **Acima da lista:** `<RunCard />`.
    *   **Lista:** uma lista única de treinos e corridas, por `d` decrescente. No mesmo dia, os treinos vêm primeiro (por `w.start` decrescente) e as corridas depois (por `_ts` decrescente). Tocar numa corrida chama `runSheet(id)`.
    *   **Estado vazio:** só aparece quando não há treinos nem corridas.

#### 14. `frontend/src/index.css` (Modify)

*   **Type / Scope**: estilos.
*   **Proposed Changes**:
    *   `.cal-d i.run { background: var(--blue) }`, com dois pontos lado a lado quando o dia tem treino e corrida.
    *   Barras do `RunCard`.
    *   Os chips do selo e do esforço usam `.chips` e `.chip`, que já existem (`index.css:129, 374`).

#### 15. `frontend/src/locales/pt.js` (Modify)

*   **Type / Scope**: tradução PT-BR. As chaves vão entre aspas duplas, como no resto do arquivo.
*   **Já existem e não são declaradas de novo:** `"Save": "Salvar"`, `"Saved": "Salvo"`, `"Delete": "Excluir"`, `"Note": "Nota"`, `"Date": "Data"`, `"Cancel": "Cancelar"`. O fork também já tem `"This week": "Esta semana"`, que **não** é usada aqui.
*   **Novas:**

    | Chave | PT-BR |
    | --- | --- |
    | Run | Corrida |
    | {0} run | {0} corrida |
    | {0} runs | {0} corridas |
    | Log a run | Registrar corrida |
    | Edit run | Editar corrida |
    | Log a run on this day | Registrar corrida neste dia |
    | Distance | Distância |
    | Moving time | Tempo em movimento |
    | Pace | Ritmo |
    | Outdoor | Ao ar livre |
    | Treadmill | Esteira |
    | More details | Mais detalhes |
    | Elevation gain | Ganho de elevação |
    | Avg HR | FC média |
    | Max HR | FC máxima |
    | Perceived effort | Esforço percebido |
    | km this week | km da semana |
    | Last 8 weeks | Últimas 8 semanas |
    | Longest run | Corrida mais longa |
    | Avg pace (last 5) | Ritmo médio (últimas 5) |
    | Best pace · {0} km or more | Melhor ritmo · {0} km ou mais |
    | No {0} km run yet | Ainda sem corrida de {0} km |
    | Only runs logged here count toward progress. | Só corridas lançadas aqui entram na evolução. |
    | Run logged | Corrida registrada |
    | Run deleted | Corrida excluída |
    | Delete run? | Excluir corrida? |
    | Required | Obrigatório |
    | Date in the future | Data no futuro |
    | Distance must be between 0 and 300 km | A distância precisa ficar entre 0 e 300 km |
    | Time must be between 1:00 and 24:00:00 | O tempo precisa ficar entre 1:00 e 24:00:00 |
    | Heart rate must be between 30 and 250 | A FC precisa ficar entre 30 e 250 |
    | Max heart rate is below average | A FC máxima está abaixo da média |
    | Elevation must be between 0 and 10,000 m | A elevação precisa ficar entre 0 e 10.000 m |
    | Effort must be 1 to 10 | O esforço vai de 1 a 10 |
    | Unusual pace, check distance and time | Ritmo fora do comum, confira distância e tempo |

*   Antes de declarar cada chave nova, conferir com `grep` que ela não existe em `pt.js`. O EN sai das próprias chaves, e os outros 10 idiomas mostram o inglês.

#### 16. `frontend/public/sw.js` (Modify)

*   **Type / Scope**: service worker.
*   **Proposed Changes**: troca `const CACHE = 'opengym-rt-v1'` por `'opengym-rt-v2'`. O `activate` apaga os caches com outro nome (`keys.filter(k => k !== CACHE).map(k => caches.delete(k))`), então o cache `v1` é removido.

#### 17. `/opt/opengym-mcp/espelho/test_filtra.py` (Modify, na VPS, no git de `/opt/opengym-mcp`)

*   **Type / Scope**: teste Python do espelho (`unittest`).
*   **Proposed Changes**: um caso que passa um estado com `activities` para `filtra.filtrar` e confere que a saída não tem essa chave. Não muda `filtra.py`.
*   **Versionamento:** um commit próprio no repositório git de `/opt/opengym-mcp`, separado dos commits do fork.
*   **Por quê:** a exclusão de `activities` do MCP passa a ser intencional e coberta por teste.

#### 18. `docs/specs/spec_corrida.md` (Create)

*   **Type / Scope**: documentação.
*   **Proposed Changes**: cópia do design final, no lugar onde o fork guarda as outras specs (`docs/specs/`).

### Ordem dos commits

1.  `api/activities.js`, o teste dele e `api/server.js`.
2.  `lib/activities.js`, o teste dele, o `useStore.js` com `DEF` e merge, e o teste da store.
3.  `lib/run-stats.js` e o teste dele.
4.  `sheets.jsx`, `RunRow.jsx`, `RunCard.jsx`, `History.jsx`, `index.css`, `pt.js` e `sw.js`.
5.  `docs/specs/spec_corrida.md`.
6.  No git de `/opt/opengym-mcp`, à parte: o teste do espelho.

Os passos 1 e 2 podem ir ao ar antes das telas, porque ninguém grava `activities` até o passo 4. A troca do cache (`sw.js`) vai junto com as telas.

### Verification Plan

*   **Compilation/Build**: `cd frontend && npm run build`, o mesmo passo da CI em `.github/workflows/deploy.yml`.
*   **Unit Tests**:
    *   `cd frontend && npm test` (vitest). Inclui `activities.test.js`, `run-stats.test.js`, `useStore.test.js` e o `i18n-bilingual.test.js` que já existe.
    *   Servidor: `node --test api/*.test.js`. O `api/package.json` não tem script de teste, e a CI só roda o frontend, então esse passo é manual antes do push.
    *   Espelho: `cd /opt/opengym-mcp/espelho && python3 -m unittest test_filtra`.
*   **Test Coverage Requirement**: cada função exportada de `lib/activities.js`, `lib/run-stats.js` e `api/activities.js` tem pelo menos um caso, e cada limite tem os dois lados da fronteira.
*   **E2E/Integration** (manual, no navegador, com um perfil de teste):
    1.  **CUJ 1:** registrar 5,2 km em 28:41. A linha mostra "5,2 km · 28:41 · 5:31/km · Ao ar livre", e o cartão mostra 5,2 km em "km da semana".
    2.  **CUJ 2:** registrar uma corrida com o selo Esteira e conferir que o campo de elevação some.
    3.  **CUJ 3a e 3b:** digitar 52 km, ver o aviso de ritmo, editar para 5,2 e depois excluir.
    4.  **CUJ 6:** no seletor de data, conferir que os dias futuros ficam desabilitados.
    5.  **CUJ 4:** com dois navegadores no mesmo perfil:
        *   registrar uma corrida offline no primeiro;
        *   mudar uma rotina no segundo;
        *   reconectar o primeiro navegador.

        As duas mudanças precisam ficar.
    6.  **CUJ 5:** com corridas em semanas diferentes, conferir as 8 barras e as duas linhas de melhor ritmo.
    7.  **Calendário:** conferir cada tipo de dia:
        *   um dia com um treino só, que abre o treino direto, sem o botão;
        *   um dia com vários treinos ou com corrida, que abre a lista com o botão;
        *   um dia vazio no passado, em que o `DayOverride` mostra "Registrar corrida neste dia";
        *   um dia vazio no futuro, em que o `DayOverride` fica sem o botão.
    8.  **Cronômetro (Goal 1):** do toque em "Registrar corrida" até o toast "Corrida registrada", com os dados do CUJ 1. Passa com menos de 60 s.
*   **Depois do deploy**:
    *   Na VPS, conferir em `data/<uid>.json` do perfil de teste que `activities` tem só as chaves do item 1 e que uma corrida excluída é só `{ deleted: true, _ts }`.
    *   Conferir no log que não houve `op=activities-cleaned`. Uma ocorrência indica um cliente com defeito, um PWA antigo ou um script (§5). Nesse caso, anotar o `uid` e o `fields=` e conferir a versão do app daquele aparelho antes de seguir.
*   **Medida de sucesso** (Goal 9):
    *   A semana 1 é a semana ISO do deploy.
    *   Na semana 8, contar no `data/<uid>.json` da usuária as semanas com ao menos uma corrida, entre a 3ª e a 8ª.
    *   Se forem 3 ou menos das 6, seguir para a Alternativa M.

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
