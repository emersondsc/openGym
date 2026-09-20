# Spec: editar um treino já finalizado — v3

> **Pedido do usuário (25/09/2026):** *"eu quero uma capacidade de editar uma rotina completamente… podemos fazer isso no card do Recent workouts, o usuário clica em uma rotina e abre a opção de deletar ou editar. Aí a partir da edição teremos que montar uma tela intuitiva para o usuário fazer."*
> **Repo/branch:** `emersondsc/openGym`, `emerson-custom`. Frontend React 19 + Vite (`frontend/`), API Node sem framework (`api/server.js`), servido pelo nginx do container `opengym-web-1` (porta 8081).
> **Base medida (25/09/2026), na VPS `/mnt/drivebackup/apps/openGym/openGym`, HEAD `3fcbab5`, árvore limpa:** `frontend/src/sheets.jsx` 1350 linhas · `frontend/src/views/Workout.jsx` 426 · `frontend/src/views/Stats.jsx` 332 · `frontend/src/views/History.jsx` 16 · `frontend/src/store/useStore.js` 363 · `frontend/src/store/useUI.js` 131 · `frontend/src/components/TabBar.jsx` 42 · `frontend/src/lib/history.js` 300 · `frontend/src/lib/onerm.js` 82 · `frontend/src/components/ui.jsx` 296 · `frontend/src/index.css` 928 · `frontend/src/App.jsx` 100 · `frontend/src/locales/pt.js` 45.129 bytes · 11 arquivos `lib/*.test.js`.
> **Estado hoje:** um treino finalizado é **somente leitura** na UI. O detalhe (`WorkoutDetail`, `sheets.jsx:806-822`) mostra as séries e oferece **só** `Delete workout`. Não existe rota, tela, nem função de edição; a única escrita em `S.workouts` depois do fim do treino é o filtro que remove o treino apagado (`sheets.jsx:820`).
> **Revisão 1 (contra o código real, 25/09/2026): 26 achados, 7 bloqueantes — todos aplicados na v2.** A tabela está no anexo. Os bloqueantes eram: forma da série nova (`defaultConfig` não é série), `isoOf` fora do import de `sheets.jsx`, `target` ausente em treino antigo, `exWeights` vindo do servidor na mescla, o ramo "adota tudo" do `pullState`, a ordem do array desfeita pela mescla e a troca de exercício podendo duplicar id.
> **Revisão 2 (25/09/2026): 9 achados de regressão + 12 novos — todos aplicados nesta v3.** Os que importam: o voltar do navegador não era coberto por `beforeunload` (R1), o `exWeights` recalculado era revertido na mescla quando o melhor peso passava a ser de outro treino ou a chave era apagada (R2), a mescla reordenava o histórico mesmo sem mudança de dia, contradizendo a própria decisão A12 (R3), a edição apagava o nome gravado por `deleteCustomEx` nas entradas (N1), o `Sets & reps` podia trocar o modo e deixar as séries com a forma errada (N2 — resolvido tirando o botão do escopo, decisão U5 de 25/09/2026: o alvo do treino é somente leitura nesta tela), e a marca de edição, compartilhada entre abas pelo `localStorage`, deixava uma aba velha reverter a edição (N3).

---

## Contexto e Objetivo

Um treino finalizado é o **registro** do que aconteceu, e dele saem cinco coisas derivadas: o volume do treino (`w.vol`), os recordes de peso que ele bateu (`w.prs`), o melhor peso registrado de cada exercício (`S.exWeights`, usado quando a rotina não prescreve carga), os gráficos do Stats (volume semanal, curva por exercício, mapa de calor, sequência de semanas) e a **análise do coach** (`api/coach.js:101`, `buildAnalysis(state)` — o laço que varre `state.workouts` na ordem do array está em `:42` —, lida pelo assistente para planejar a próxima semana).

Hoje, um número digitado errado (o caso real: `160×8 · 200×8 · 160×6` no lugar de `160×8 · 200×8 · 200×6`) é **permanente**: ou se convive com ele, ou se apaga o treino inteiro (perdendo data, hora, duração e as outras séries) e se registra de novo — o que ainda joga o treino para a data de hoje. O erro contamina a curva daquele exercício e a prescrição seguinte.

**Objetivo:** dar ao usuário uma tela para corrigir um treino já finalizado — números, séries, exercícios e o dia — com os derivados recalculados na mesma escrita, sem nunca tocar na rotina (que é o plano, não o registro).

---

## Escopo

**Inclui**
- botão `Edit workout` no detalhe do treino, ao lado do `Delete workout`, valendo nos três caminhos que abrem esse detalhe: card **Recent workouts** (Stats), tela **History** e o **calendário/mapa de calor**;
- rota e tela novas de edição, em tela cheia, com rascunho (nada muda no histórico antes de salvar);
- edição de: nome do treino, dia do treino, peso/reps (ou duração/velocidade/segundos, conforme o modo) de cada série, esforço (RIR/RPE) quando o perfil registra, marcação de série (a série desmarcada deixa de contar), adicionar série, remover série, trocar exercício, remover exercício, mover exercício para cima/baixo e a unidade do exercício (kg/lb);
- adicionar um exercício que não foi registrado;
- confirmação ao sair com mudanças pendentes em todos os caminhos que dá para interceptar (barra de baixo, seta de voltar, recarregar e fechar a página) e **rascunho que não se perde** no voltar do navegador/celular, que o `HashRouter` não permite bloquear (ver §6.3);
- recálculo, na mesma escrita: `vol`, `prs`, `exWeights` dos exercícios afetados e a ordem de `S.workouts` quando o dia muda;
- proteção do resultado contra o conflito de sincronização (`409`, a mescla da releitura ao voltar, e o ramo que adota o servidor inteiro);
- proveniência do melhor peso por exercício (`exWeights[].src`), gravada daqui para a frente por quem registra o peso;
- strings novas em `pt.js`;
- testes unitários da lógica pura (arquivo novo) e roteiro de verificação manual.

**Não inclui (explícito)**
- editar o treino **em andamento** (`S.active`) — a tela de treino continua sendo a única forma, e ela já permite tudo isso durante a sessão;
- editar o peso corporal do dia (`w.bw`) nem a duração (`w.start`/`w.end` continuam sendo o carimbo do treino, apenas reancorados no dia novo);
- escrever na rotina de origem, no `S.week` ou no `S.dayPlan` — editar histórico **nunca** muda o plano;
- criar um treino do zero pela tela nova (o caminho para isso é começar e finalizar um treino);
- **editar o alvo (a prescrição) de um treino finalizado** — decisão U5. O alvo é a fotografia do que a rotina pedia, e o app julga a sessão contra ele para decidir a carga da próxima vez; quem quer mexer em progressão mexe na rotina. Consequência: se o alvo gravado estiver errado (uma sessão julgada como perdida sem ter sido), o conserto é na rotina, não aqui;
- juntar ou dividir treinos, mover séries entre exercícios, e ter o mesmo exercício duas vezes no mesmo treino (o app assume id único por treino em toda a leitura — a tela nova **bloqueia** a duplicata em vez de criar uma);
- reescrever histórico antigo em massa (importação/CSV/migração de unidade continuam como estão);
- a análise do coach no servidor: ela é derivada de `state.workouts` e passa a refletir a edição sozinha na próxima leitura — **exceto a data**, que a análise monta de `w.start` renderizado em `America/Sao_Paulo` (`api/coach.js:83`) enquanto a edição reancora o relógio local do aparelho. Fora desse fuso, mudar o dia deixa a data da análise como estava (limitação conhecida, registrada em Riscos R14; trocar a análise para ler `w.d` é item próprio, não entra aqui);

---

## Decisões do usuário

| # | Decisão | Data | O que muda para ele |
|---|---|---|---|
| U1 | **Edição completa, incluindo o dia do treino** | 25/09/2026 | Dá para consertar desde um número digitado errado até um treino registrado no dia errado, sem apagar e refazer |
| U2 | **Correção recalcula tudo, inclusive o recorde** | 25/09/2026 | Se a correção derruba um recorde, o troféu sai daquele treino e o melhor peso do exercício acompanha — o número errado não volta a valer na próxima prescrição |
| U3 | **Editar aparece nos três lugares que abrem o treino** | 25/09/2026 | Chegar no treino pelo card de recentes, pelo histórico ou pelo calendário leva à mesma tela de edição |
| U4 | **Sair com mudanças pendentes avisa em qualquer caminho** | 25/09/2026 | Barra de baixo, voltar do navegador/celular e recarregar a página também perguntam antes de descartar |
| U5 | **O botão `Sets & reps` sai do escopo** | 25/09/2026 | A tela de edição não mexe na prescrição (o alvo) do treino. O alvo é a fotografia do que a rotina pedia, e o app julga a sessão contra ele para decidir a carga da próxima vez — editar isso por engano fazia o app **subir a carga** de um treino que na verdade foi cumprido abaixo do alvo. Corrigir número, série, exercício e dia continua igual |

---

## Decisões assumidas

Detalhe de implementação, decidido por mim porque não muda o que o usuário vê — exceto onde está dito o contrário.

- **Rascunho com Salvar/Cancelar, em vez de escrita a cada toque** (como faz o editor de rotina). Efeito visível: **nada no histórico muda até o check do cabeçalho**; sair com mudanças pendentes pergunta antes (U4). É o que permite recalcular os derivados **uma vez**, no fim, em vez de a cada tecla.
- **A tela é uma rota nova (`/history/w/:id`), não uma folha.** Efeito visível: ocupa a tela inteira, tem voltar no cabeçalho, e a aba **Stats** continua acesa na barra de baixo (`TabBar.jsx:15-16` compara o primeiro segmento do caminho).
- **A edição é oferecida como dois botões explícitos no detalhe** (`Edit workout` e `Delete workout`), não como um menu de opções. Efeito visível: um toque em vez de dois; a ordem põe o destrutivo por último.
- **Salvar volta para onde o usuário estava** — `nav(-1)` quando existe entrada anterior no histórico do navegador, `/history` quando não existe (entrada direta por link ou recarregamento).
- **Trocar exercício mantém as séries** quando o tipo de série é o mesmo (`reps`↔`reps`, `time`↔`time`, `cardio`↔`cardio`): o caso real é ter registrado o exercício errado com os números certos. Quando o tipo muda, as séries são **recriadas pelo `buildSets` no padrão do exercício novo, desmarcadas**, com aviso.
- **Trocar ou adicionar um exercício que já está no treino é bloqueado** no próprio seletor (ele não aparece na lista). O app inteiro assume um id por treino (`entries.find(e => e.id === exId)`), e permitir duplicata envenenaria `topW`, `exWeights` e os recordes.
- **`topW` (o peso de trabalho confirmado no fim do exercício) só é recalculado nos exercícios cujas séries foram mexidas** — vira a maior série marcada daquele exercício, ou deixa de existir se não houver série com carga. "Mexida" é comparada **campo a campo**, não por JSON (a ordem das chaves muda quando um valor é apagado e redigitado).
- **Um exercício cujas séries ficaram todas desmarcadas sai do treino ao salvar** — a mesma regra do fim do treino (`doFinishWorkout` filtra `e.sets.some(s => s.done)`).
- **O melhor peso de um exercício que saiu do treino é recalculado a partir do histórico** (não fica congelado num valor que não existe mais). Efeito visível: a próxima sugestão de carga daquele exercício acompanha a correção.
- **`exWeights[].src` passa a registrar de qual treino veio o melhor peso** (escrito por quem registra o peso: fim do treino, confirmação de peso de trabalho e importação). Sem ele não dá para saber se um valor guardado veio do treino que está sendo corrigido — e `d` não serve: a confirmação de peso grava a data da confirmação, não a do treino. **Dados antigos não têm `src`** e caem numa regra conservadora (só desce quando o valor guardado é exatamente o que aquele treino registrava).
- **A unidade do exercício (kg/lb) é editável e não converte o número** — a regra que o app já fixou na BACKLOG-01 (`200` continua `200`). Está aqui porque é exatamente o acidente que o backlog registrou: um número de mostrador em libras lido como kg.
- **Data futura é recusada** com aviso: um treino que ainda não aconteceu entraria no mapa de calor e na semana corrente.
- **Mudar o dia reancora a HORA LOCAL, não soma milissegundos.** Um delta em ms atravessa horário de verão valendo 23h ou 25h, e um treino registrado 00:30 voltaria para o dia anterior.
- **A reordenação de `S.workouts` só acontece quando o dia muda.** O resto do histórico pode ter chegado em outra ordem (CSV, escrita do assistente) e reordenar o que ninguém tocou mudaria qual sessão o app lê como "a última" de exercícios sem relação com a edição.
- **Nome vazio não é salvo**: ao salvar, um nome em branco cai para o nome da rotina de origem ou `Freestyle` (o padrão da tela de treino).
- **O rascunho é guardado em `sessionStorage` e volta se a tela for reaberta.** Efeito visível: usar o **voltar do navegador/celular** não perde nada — ao reabrir o treino, o que você digitou ainda está lá, com um aviso na tela. É o único caminho que o `HashRouter` não deixa bloquear (o app usa a API declarativa de rotas, sem bloqueador de navegação); todos os outros perguntam antes.
- **A marca de edição recente guarda um carimbo do conteúdo e a lista de exercícios mexidos.** Sem o carimbo, uma segunda aba aberta (que lê a mesma marca do `localStorage` mas tem o próprio store) venceria a mescla com a cópia velha dela e reverteria a edição no servidor.
- **Apagar um treino recalcula o melhor peso dos exercícios dele** — inclusive pelo botão do detalhe, que já existia. Sem isso o `src` fica apontando para um treino que não existe e aquele exercício nunca mais tem o melhor peso corrigido para baixo.
- **Trocar exercício carrega só o que é número** (`sets`, `reps`, `weight`, `sec`, `min`, `speed`); peso corporal, unidade e regra de progressão passam a ser do exercício novo — são propriedades do exercício, não do número.
- **O alvo (a prescrição que o treino carrega) é somente leitura nesta tela.** O app decide a carga da próxima vez julgando cada sessão passada contra o alvo gravado nela: mexer no alvo de um treino antigo muda o julgamento e, com ele, a sugestão seguinte. Deixar isso a um toque de distância numa tela de correção de registro é um convite a "fazer o treino parecer cumprido" e receber mais carga. Quem quiser mexer na progressão mexe na **rotina**, que é onde ela mora.
- **O seletor de exercícios do treino em andamento também passa a excluir o que já está na sessão**: o app assume um id por treino em toda a leitura, e isso já era possível de violar durante o treino.
- **O seletor de dia é um calendário do próprio app** (reusa `.cal-grid`/`.cal-d`), não um `<input type="date">`: o app não tem `color-scheme` declarado, e o controle nativo apareceria com o visual claro do sistema no meio de uma tela escura.
- **Um treino com nenhuma série marcada não pode ser salvo** — o app avisa e aponta o `Delete workout` da própria tela.
- **Nome novo de arquivo `lib/workout-edit.js`** para a lógica pura, em vez de engordar `lib/history.js`: é o que deixa o recálculo testável sem React, no padrão do projeto (11 arquivos `lib/*.test.js`).

---

## Requisitos Funcionais

**RF-1.** O detalhe de um treino finalizado passa a mostrar `Edit workout` acima de `Delete workout`, e o botão leva para a tela de edição daquele treino. Vale para os três caminhos que abrem o detalhe (card de recentes, History, calendário/mapa de calor), porque os três abrem a mesma folha.

**RF-2.** A tela de edição vive na rota `/history/w/:id`, em tela cheia, com: voltar à esquerda, nome do treino editável no centro, check de salvar à direita (na cor de destaque). Um id que não existe mais redireciona para `/history`.

**RF-3.** A tela edita uma **cópia** do treino. Nenhuma escrita acontece em `S.workouts` antes do check de salvar. Sair com mudanças pendentes pede confirmação (`Discard changes?`) na seta de voltar, em qualquer aba da barra de baixo e ao recarregar/fechar a página. No **voltar do navegador/celular**, que o `HashRouter` não permite bloquear, o rascunho é preservado em `sessionStorage` e volta quando a tela for reaberta — nada se perde sem confirmação. Confirmando o descarte, o treino fica exatamente como estava.

**RF-4.** A linha `Date` mostra o dia atual do treino e abre o seletor de dia. O seletor oferece `Today`, `Yesterday`, um calendário de mês com navegação, e recusa dias futuros. Quando o dia muda, `d`, `start` e `end` são reancorados juntos, **preservando a hora local e a duração** (um `end` ausente continua ausente), e a tela mostra de qual dia o treino veio.

**RF-5.** Cada exercício do treino mostra as séries com os mesmos controles da tela de treino (stepper de `+/-` e campo digitável) para peso e reps — ou duração e velocidade no cardio, segundos e peso no modo tempo — mais o esforço (RIR/RPE) quando o perfil registra esforço, e a marcação de cada série. Editar um número escreve no rascunho, não no histórico.

**RF-6.** Cada exercício oferece: `Add set`, remover **uma série específica** (o `×` da própria linha, desabilitado quando é a única série), `Swap exercise`, mover para cima/baixo e `Remove exercise`. O seletor de exercícios de `Swap exercise` **não oferece** os exercícios que já estão no treino. O alvo do exercício (a prescrição que a sessão carrega) **não é editável** nesta tela (U5).

**RF-7.** `Add exercise` no fim da tela abre o seletor de exercícios e, em seguida, a folha de configuração. O exercício entra no fim, com as séries montadas pelo `buildSets` (a mesma forma da tela de treino) e **desmarcadas** — o usuário digita o que fez e marca. O seletor não oferece os exercícios que já estão no treino.

**RF-8.** A unidade de um exercício (`kg`/`lb`) é editável no próprio bloco e **não converte os números**: muda só como eles são lidos (volume, rótulos e gráficos). Num treino antigo, sem `target`, a escolha **cria** o `target` em vez de quebrar.

**RF-9.** Salvar recalcula, na mesma escrita: `w.vol` (volume do treino), `w.prs` (recordes daquele treino, julgados contra o histórico **sem** ele), `S.exWeights` de todos os exercícios que estavam no treino ou entraram nele (subindo, descendo ou saindo conforme o caso) e, **quando o dia mudou**, a ordem de `S.workouts` por data (desempate pela hora de início).

**RF-10.** Exercícios cujas séries ficaram todas desmarcadas saem do treino ao salvar. Se **nenhuma** série do treino ficar marcada, o app recusa salvar com um aviso e não escreve nada.

**RF-11.** Editar um treino não escreve em `S.routines`, `S.week` nem `S.dayPlan`, não toca em `S.active` e **não modifica o estado recebido** (a função de recálculo é pura).

**RF-12.** A edição não pode ser descartada em silêncio por um conflito de sincronização. Enquanto a marca de edição recente estiver válida **e o conteúdo local for o editado** (a marca guarda um carimbo do conteúdo, para outra aba não vencer com a cópia velha dela), valem estas quatro regras: (a) no `409`, a versão editada daquele treino vence a cópia do servidor; (b) a releitura ao voltar **não** pode adotar o estado do servidor inteiro; (c) o `exWeights` dos exercícios **mexidos** vence, inclusive quando o recálculo apagou a chave ou apontou o melhor peso para outro treino; (d) um treino **apagado** recentemente não volta do servidor. Fora da janela, a regra atual continua: o servidor vence por id (é o que preserva o que o assistente escreveu).

**RF-15.** Apagar um treino — pela tela de edição ou pelo `Delete workout` do detalhe, que já existia — recalcula o melhor peso registrado dos exercícios daquele treino, para o `src` não ficar apontando para um treino que não existe mais.

**RF-13.** O nome do treino é editável e aparece nas listas (card de recentes, History, calendário) depois de salvar. Nome vazio cai para o nome da rotina de origem ou `Freestyle`.

**RF-14.** As strings novas têm tradução em `pt.js`, sem repetir chave que já existe; os outros idiomas caem no inglês, como já acontece com strings novas do app.

---

## Detalhe de Implementação (nível código)

### 1. `frontend/src/lib/history.js` — o melhor peso com data, origem e exclusão

`bestWeightFor` (linhas 170-179) varre o histórico inteiro e devolve só o número. A edição precisa de três coisas que ele não dá: a **data** e o **treino de origem** daquele melhor peso (para reescrever `exWeights`), e a possibilidade de **excluir o próprio treino editado** do julgamento (senão o número antigo, ainda gravado nele, vence a correção).

**1.1 `bestWeightFor` → `bestEntryFor` + delegado (linhas 170-179):**

```js
// ANTES
export function bestWeightFor(S, exId) {
  let best = 0
  S.workouts.forEach(w => w.entries.forEach(e => {
    if (e.id === exId) {
      e.sets.forEach(s => { if (s.done && s.w > best) best = s.w })
      if (e.topW && e.topW > best) best = e.topW
    }
  }))
  return best
}
```

```js
// DEPOIS
// O melhor peso de um exercício em todo o histórico, com a data e o TREINO de onde ele veio.
// `topW` entra: é o peso de trabalho que o usuário confirmou no fim do exercício, e pode ser
// maior que a maior série registrada. `exclude` existe para a edição de um treino — os
// recordes daquele treino têm de ser julgados contra o histórico SEM ele, senão o número
// antigo, ainda gravado nele, venceria a correção.
export function bestEntryFor(S, exId, exclude) {
  let w = 0, d = null, src = null
  ;(S.workouts || []).forEach(x => {
    if (exclude && x.id === exclude) return
    x.entries.forEach(e => {
      if (e.id !== exId) return
      e.sets.forEach(s => { if (s.done && s.w > w) { w = s.w; d = x.d; src = x.id } })
      if (e.topW && e.topW > w) { w = e.topW; d = x.d; src = x.id }
    })
  })
  return { w, d, src }
}
export function bestWeightFor(S, exId, exclude) { return bestEntryFor(S, exId, exclude).w }
```

**Chamadores (inventário correto — são cinco, em quatro arquivos):** `sheets.jsx:307` (peso inicial do `OneRM`), `sheets.jsx:914` (`prevBest` do `TopWeight`), `sheets.jsx:1008` (a regra de PR do `doFinishWorkout`), `Workout.jsx:113` (`best` do bloco de exercício) e `Library.jsx:43`. O terceiro parâmetro é opcional, então **nenhum deles muda**. A regra de PR de `sheets.jsx:1008` é a **referência** de `w.prs`: o recálculo da edição tem de reproduzir exatamente o mesmo critério (maior série marcada com carga, comparada ao melhor do histórico).

**1.2 Os quatro lugares que gravam `exWeights` em produção ganham `src` (o treino de origem) — e o comparador de datas passa a ser um só:**

```js
// sheets.jsx:1026 — doFinishWorkout
// ANTES
      if (mx > 0) { const cur = s.exWeights[e.id]; if (!cur || mx > cur.w) s.exWeights[e.id] = { w: mx, d: w.d } }
// DEPOIS
      if (mx > 0) { const cur = s.exWeights[e.id]; if (!cur || mx > cur.w) s.exWeights[e.id] = { w: mx, d: w.d, src: w.id } }
```

```js
// sheets.jsx:934-935 — TopWeight (a confirmação de peso de trabalho)
// ANTES
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = { w: Math.max(n, cur ? cur.w : 0), d: todayISO() }
// DEPOIS
      // `src` só aponta para esta sessão quando o valor É desta sessão: se o antigo continua
      // sendo o melhor, ele fica inteiro, com a origem dele.
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = !cur || n >= cur.w
        ? { w: n, d: todayISO(), src: s.active.id }
        : cur
```

```js
// Workout.jsx:332-333 — o caminho silencioso (confirmTopWeight desligado)
// ANTES
                const cur = s.exWeights[e.id]
                s.exWeights[e.id] = { w: Math.max(maxSet, cur ? cur.w : 0), d: todayISO() }
// DEPOIS
                const cur = s.exWeights[e.id]
                if (!cur || maxSet > cur.w) s.exWeights[e.id] = { w: maxSet, d: todayISO(), src: s.active.id }
```

```js
// lib/import-csv.js:523
// ANTES
    if (mx > 0) { const cur = S.exWeights[e.id]; if (!cur || w.d >= cur.d) S.exWeights[e.id] = { w: mx, d: w.d } }
// DEPOIS
    if (mx > 0) { const cur = S.exWeights[e.id]; if (!cur || w.d >= cur.d) S.exWeights[e.id] = { w: mx, d: w.d, src: w.id } }
```

```js
// lib/import-csv.js:520 — o mesmo comparador de datas, para haver um só no app
// ANTES
  S.workouts = [...S.workouts, ...fresh].sort((a, b) => (a.d < b.d ? -1 : 1))
// DEPOIS
  S.workouts = sortWorkouts([...S.workouts, ...fresh])
```

Com `import { sortWorkouts } from './workout-edit.js'` no topo de `import-csv.js` (não há ciclo: `workout-edit.js` importa só `history.js`, que não importa store nem import).

**Quinto lugar, fora de produção:** o seed de demonstração (`lib/demoSeed.js:125`) também grava `exWeights` sem `src`. É dado de demonstração, e a regra conservadora de §2 cobre (nunca desce sem prova) — não vale tocar no seed.

### 2. `frontend/src/lib/workout-edit.js` — arquivo novo (lógica pura)

```js
// Edição de um treino JÁ FINALIZADO. Um treino é um registro, e o que ele alimenta é
// derivado: volume, recordes, o melhor peso de cada exercício e a ordem cronológica do
// histórico. Corrigir um número tem de recalcular tudo isso na MESMA escrita, ou o gráfico
// e a próxima prescrição passam a mentir. Estas funções são puras de propósito: quem escreve
// no store é a tela, e o comportamento fica testável sem React.
import { bestEntryFor, workoutVolume, repFloor } from './history.js'

const clone = o => JSON.parse(JSON.stringify(o))

// Chave ausente em vez de null — a mesma regra do resto do app (só o que foi registrado).
const cleanSet = s => {
  const o = {}
  for (const k in s) if (s[k] !== null && s[k] !== undefined) o[k] = s[k]
  return o
}

// A forma da SÉRIE não é a forma da CONFIGURAÇÃO: `defaultConfig` devolve
// {sets, reps, weight, mode} — o que a rotina prescreve —, enquanto a série gravada é
// {w, r, done}, {sec, w, done} ou {min, speed, done}. Espalhar a configuração dentro da série
// grava chaves que nada lê e deixa a linha em branco.
//
// A série nova nasce da ÚLTIMA série quando existe e da prescrição do exercício quando não
// existe — a mesma ideia do `addSet` da tela de treino (Workout.jsx:279-285), com uma diferença
// de propósito: lá o modo reps começa em 0 mesmo com carga prescrita (`w: l ? l.w : 0`), e aqui
// começa na carga da prescrição, que é o número que o usuário acabou de ver na sessão.
// `wUnit` viaja junto: é o override de unidade por série que `unitOfSet` lê (units.js:34), e uma
// série acrescentada ao lado de um override tem de continuar sendo lida na mesma unidade.
export const setShape = (mode, prev, cfg = {}) => {
  const carry = prev && prev.wUnit != null ? { wUnit: prev.wUnit } : {}
  if (mode === 'cardio') return { min: prev ? prev.min : (cfg.min || 20), speed: prev ? prev.speed : (cfg.speed || 8), done: false, ...carry }
  if (mode === 'time') return { sec: prev ? prev.sec : (cfg.sec || 45), w: prev ? (prev.w || 0) : (cfg.weight || 0), done: false, ...carry }
  return { w: prev ? (prev.w || 0) : (cfg.weight || 0), r: prev ? (prev.r || 0) : (repFloor(cfg.reps) || 10), done: false, ...carry }
}

// Compara séries CAMPO A CAMPO. `JSON.stringify` depende da ORDEM das chaves, e editar um valor
// (apagar e redigitar) reordena o objeto: um exercício intocado passaria a contar como "mexido"
// e perderia o `topW` confirmado à mão.
const SET_FIELDS = ['w', 'r', 'sec', 'min', 'speed', 'rir', 'rpe', 'wUnit', 'done']
const sameSets = (a, b) =>
  a.length === b.length &&
  a.every((s, i) => SET_FIELDS.every(f => (s[f] ?? null) === (b[i][f] ?? null)))

// O dia mudou: a HORA LOCAL do treino continua a mesma. Somar o delta em milissegundos parece
// equivalente e não é — atravessar um horário de verão vale 23h ou 25h, e um treino registrado
// 00:30 voltaria para o dia anterior. A data é reconstruída campo a campo (setFullYear aplica
// ano, mês e dia de uma vez, então não há estouro de dia 31 para mês de 30).
const sameLocalTimeOn = (ms, iso) => {
  const d = new Date(ms)
  const [y, m, day] = iso.split('-').map(Number)
  d.setFullYear(y, m - 1, day)
  return d.getTime()
}
export function shiftWorkoutDate(w, iso) {
  const out = { ...w, d: iso }
  if (Number.isFinite(w.start)) out.start = sameLocalTimeOn(w.start, iso)
  if (Number.isFinite(w.end)) out.end = sameLocalTimeOn(w.end, iso)   // `end` pode faltar
  return out
}

// Ordem por data, com desempate pela HORA de início. `a.d < b.d ? -1 : 1` nunca devolve 0: o
// `sort` não tem como saber que dois treinos do mesmo dia são "iguais", e a ordem relativa
// deles fica por conta do algoritmo — e é essa ordem que `lastEntryFor` (de trás para frente,
// parando na primeira ocorrência) e `sessionsFor` (para a frente, acumulando, com o mais
// recente no fim) leem como cronologia.
export const sortWorkouts = ws => [...ws].sort((a, b) =>
  a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0))

// Aplica o rascunho sobre o histórico. Devolve `null` quando não há nada a salvar (treino
// inexistente ou nenhuma série marcada) — quem chama avisa e não escreve nada.
export function applyWorkoutEdit(S, id, draft) {
  const before = (S.workouts || []).find(w => w.id === id)
  if (!before) return null

  // Exercícios cujas séries foram mexidas: só eles têm o peso de trabalho recalculado. Um
  // exercício intocado mantém o `topW` confirmado na hora do treino, que pode ser maior que
  // qualquer série registrada.
  //
  // O mapa guarda a PRIMEIRA ocorrência de cada id, como o `entries.find` que o resto do app
  // usa — com id repetido (dado antigo, criado antes de o seletor excluir o que já está na
  // sessão), ficar com a última faria `topW` e `exWeights` saírem da entrada errada.
  const beforeById = new Map()
  before.entries.forEach(e => { if (!beforeById.has(e.id)) beforeById.set(e.id, e) })
  const touched = new Set()
  draft.entries.forEach(e => {
    const b = beforeById.get(e.id)
    if (!b || !sameSets(b.sets, e.sets)) touched.add(e.id)
  })

  const entries = draft.entries
    .filter(e => e.sets.some(s => s.done))
    .map(e => {
      const b = beforeById.get(e.id)
      return {
        // O resto da entrada é PRESERVADO: `deleteCustomEx` (sheets.jsx:416) carimba `e.n` no
        // histórico para o treino antigo continuar legível, e remontar do zero apagaria o nome
        // (o detalhe passaria a mostrar o id cru, em definitivo).
        ...(b || {}),
        id: e.id,
        sets: e.sets.map(cleanSet),
        topW: touched.has(e.id)
          ? (Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0)) || null)
          : (e.topW ?? null),
        target: e.target || null
      }
    })
  if (!entries.length) return null

  const w = {
    ...clone(before),
    name: draft.name, d: draft.d, start: draft.start, end: draft.end, entries
  }
  w.vol = workoutVolume(w, S)

  // Recorde é do treino, não do exercício: `prs` é a lista dos exercícios em que ESTE treino
  // passou de tudo o que veio antes. Mesmo critério do `doFinishWorkout` (sheets.jsx:1008),
  // com o próprio treino fora do julgamento.
  const others = { ...S, workouts: (S.workouts || []).filter(x => x.id !== id) }
  w.prs = entries
    .filter(e => {
      const mx = Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0))
      return mx > 0 && mx > bestEntryFor(others, e.id).w
    })
    .map(e => e.id)

  // Reordena SÓ quando o dia mudou: o resto do histórico pode ter chegado em outra ordem, e
  // reordenar o que ninguém tocou mudaria a "última sessão" de exercícios alheios à edição.
  const list = (S.workouts || []).map(x => (x.id === id ? w : x))
  const workouts = draft.d === before.d ? list : sortWorkouts(list)

  // Melhor peso registrado por exercício (`exWeights`): é o que o app usa quando a rotina não
  // prescreve carga. Percorre a UNIÃO do que havia e do que ficou — um exercício removido, ou
  // com todas as séries desmarcadas, não pode continuar segurando um peso que não existe mais.
  const exWeights = { ...(S.exWeights || {}) }
  const ids = new Set([...before.entries.map(e => e.id), ...entries.map(e => e.id)])
  ids.forEach(exId => {
    const e = entries.find(x => x.id === exId)
    const oldE = beforeById.get(exId)
    const oldMx = Math.max(0, ...((oldE && oldE.sets) || []).filter(s => s.done).map(s => s.w || 0), (oldE && oldE.topW) || 0)
    const mx = e ? Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0), e.topW || 0) : 0
    const cur = exWeights[exId]
    if (mx > 0 && (!cur || mx > cur.w)) { exWeights[exId] = { w: mx, d: w.d, src: id }; return }
    // Desce só quando o valor guardado PODIA ter vindo deste treino. `src` responde isso com
    // exatidão; nos dados antigos, que não têm `src`, a prova é o valor guardado ser exatamente
    // o que este treino registrava — um peso confirmado à mão acima de tudo o que foi
    // registrado fica de fora, e é o que se quer.
    if (!cur || mx >= cur.w) return
    const fromHere = cur.src ? cur.src === id : cur.w <= oldMx
    if (!fromHere) return
    const best = bestEntryFor({ ...S, workouts }, exId)
    if (best.w > 0) exWeights[exId] = { w: best.w, d: best.d, src: best.src }
    else delete exWeights[exId]
  })

  return { workout: w, workouts, exWeights, touchedEx: [...ids] }
}

// Apagar um treino também mexe no melhor peso registrado dos exercícios dele: com `src` no jogo,
// deixar a chave como está apontaria para um treino que não existe mais, e aquele exercício
// nunca mais teria o melhor peso corrigido para baixo. Vale para os DOIS caminhos de apagar (a
// tela de edição e o `Delete workout` do detalhe, que já existia).
export function removeWorkout(S, id) {
  const w = (S.workouts || []).find(x => x.id === id)
  if (!w) return null
  const workouts = (S.workouts || []).filter(x => x.id !== id)
  const exWeights = { ...(S.exWeights || {}) }
  w.entries.forEach(e => {
    const cur = exWeights[e.id]
    if (!cur) return
    if (cur.src && cur.src !== id) return          // o melhor peso é de outro treino: fica
    const best = bestEntryFor({ ...S, workouts }, e.id)
    if (best.w > 0) exWeights[e.id] = { w: best.w, d: best.d, src: best.src }
    else delete exWeights[e.id]
  })
  return { workouts, exWeights, touchedEx: w.entries.map(e => e.id) }
}
```

### 3. `frontend/src/views/WorkoutEdit.jsx` — arquivo novo (a tela)

```jsx
// Edição de um treino JÁ FINALIZADO. A tela edita um rascunho: nada no histórico muda até o
// check do cabeçalho, e sair sem salvar descarta (perguntando antes, em qualquer caminho). A
// escrita é uma só, e quem recalcula o que é derivado é lib/workout-edit.js. Aqui mora a
// edição e a aparência.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import {
  modeOf, isBw, repStep, defaultConfig, buildSets,
  EFFORT, effortOf, stepEffort, capEffort
} from '../lib/history.js'
import { applyWorkoutEdit, removeWorkout, shiftWorkoutDate, setShape } from '../lib/workout-edit.js'
import { normUnit } from '../lib/units.js'
import { exercisePicker, exConfigSheet, confirmSheet, workoutDateSheet, workoutUnitSheet } from '../sheets.jsx'
import { Button, Check, NumberField, Row } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { Thumb } from '../components/Media.jsx'

const clone = o => JSON.parse(JSON.stringify(o))

/* O rascunho mora no `sessionStorage`, não só no estado do componente. O app usa `HashRouter`
   com a API declarativa de rotas, e nessa combinação não existe bloqueador de navegação: o
   voltar do navegador/celular desmonta a tela antes de qualquer pergunta, e um rascunho só em
   memória sumiria ali. Com a cópia guardada, voltar não perde nada — a tela reabre com o que
   foi digitado e avisa (U4/RF-3). `sessionStorage` (e não `localStorage`) porque o rascunho vale
   para esta aba e esta sessão: fechar o navegador é desistir da edição. */
const DRAFT_KEY = id => 'gym_edit_draft_' + id
const readDraft = id => {
  try { const v = JSON.parse(sessionStorage.getItem(DRAFT_KEY(id)) || 'null'); return v && v.d ? v : null } catch { return null }
}
const writeDraft = (id, d) => { try { sessionStorage.setItem(DRAFT_KEY(id), JSON.stringify(d)) } catch { /* modo privado */ } }
const clearDraft = id => { try { sessionStorage.removeItem(DRAFT_KEY(id)) } catch { /* */ } }
```

O bloco de exercício (mesma grade da tela de treino, com a coluna do `×` e sem o que só faz sentido durante a sessão — descanso, "última vez", prescrição, cronômetro de série):

```jsx
function EditBlock({ entry, S, isFirst, isLast, onField, onToggle, onAddSet, onRemoveSet, onMove, onSwap, onRemove, onUnit }) {
  const ex = exOr(entry.id)
  const cfg = { ...(entry.target || {}), id: entry.id }     // treino antigo pode não ter `target`
  const mode = modeOf(cfg)
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const unit = normUnit(cfg.unit != null ? cfg.unit : S.unit)
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', unit) : t('Weight ({0})', unit) }
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : (bw && !added) ? repCol : loadCol
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? ((bw && !added) ? null : loadCol)
      : (bw && !added) ? null : repCol
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null

  const bump = (s, i, col, dir) => {
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label="Decrease" onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} /></span>
      <button aria-label="Increase" onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
    </div>
  )

  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="row" style={{ gap: 10, marginBottom: 8 }}>
      <Thumb ex={ex} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 17, textTransform: 'capitalize' }}>{ex.n}</div>
        <div className="small dim">{t('{0} sets', entry.sets.length)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button className="iconbtn mini" disabled={isFirst} aria-label="Move up" onClick={() => onMove(-1)}><Icon name="chevronUp" /></button>
        <button className="iconbtn mini" disabled={isLast} aria-label="Move down" onClick={() => onMove(1)}><Icon name="chevronDown" /></button>
      </div>
    </div>

    <div className={'sethead' + (col3 ? ' eff3' : '')}>
      <span className="n-sp" /><span className="w-sp">{col1.hd}</span>
      {col2 && <span className="r-sp">{col2.hd}</span>}
      {col3 && <span className="eff-sp">{col3.hd}</span>}
      <span className="ck-sp" /><span className="rm-sp" />
    </div>
    {entry.sets.map((s, i) => <div key={i} className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
      <div className="n">{i + 1}</div>
      {cell(s, i, col1, 'w')}
      {col2 && cell(s, i, col2, 'r')}
      {col3 && cell(s, i, col3, 'eff')}
      <Check checked={s.done} onChange={() => onToggle(i)} />
      {/* O × por série é o que a tela de treino não tem: lá a série acabou de ser feita e
          "Remove set" tira a última; aqui você está corrigindo um registro, e a série errada
          pode ser a do meio. Com uma série só ele fica desabilitado — um treino não pode
          ficar sem nenhuma. */}
      <button className="iconbtn rm-sp" disabled={entry.sets.length <= 1} aria-label={t('Remove this set')}
        style={{ opacity: entry.sets.length <= 1 ? .32 : 1 }} onClick={() => onRemoveSet(i)}><Icon name="xmark" /></button>
    </div>)}
    <div style={{ height: 8 }} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      <Button size="sm" variant="ghost" icon="shuffle" onClick={onSwap}>{t('Swap exercise')}</Button>
      {!cardio && <Button size="sm" variant="ghost" icon="scale" onClick={onUnit}>{unit}</Button>}
      <Button size="sm" variant="ghost" icon="trash" style={{ color: 'var(--red)' }} onClick={onRemove}>{t('Remove exercise')}</Button>
    </div>
  </div>
}
```

E o corpo da tela:

```jsx
export default function WorkoutEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const setLeaveGuard = useUI(s => s.setLeaveGuard)
  const w = S.workouts.find(x => x.id === id)
  // Um rascunho guardado tem prioridade sobre o histórico: é o que faz o voltar do navegador
  // não perder nada (ver DRAFT_KEY acima).
  const stored = readDraft(id)
  const [draft, setDraft] = useState(() => stored || (w ? clone(w) : null))
  const dirty = useRef(!!stored)
  const [restored, setRestored] = useState(!!stored)

  useEffect(() => { if (!w) nav('/history') }, [!!w])
  useEffect(() => { if (restored) { toast(t('Unsaved changes from before are still here.')); setRestored(false) } }, [restored])

  // Sair com mudanças pendentes pergunta antes. A barra de baixo é renderizada fora das rotas e
  // levaria o rascunho embora em silêncio; o `beforeunload` cobre recarregar e fechar. O voltar
  // do navegador NÃO dá para bloquear com `HashRouter` + rotas declarativas (o app não tem
  // bloqueador de navegação) — quem cobre esse caminho é o rascunho guardado, que devolve o que
  // foi digitado quando a tela reabre.
  useEffect(() => {
    setLeaveGuard(to => {
      if (!dirty.current || to.startsWith('/history/w/')) return true
      confirmSheet({
        title: t('Discard changes?'), message: t('The workout keeps what it had before you started editing.'),
        confirmText: t('Discard'), danger: true,
        onConfirm: () => { dirty.current = false; clearDraft(id); nav(to) }
      })
      return false
    })
    const beforeUnload = e => { if (dirty.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { setLeaveGuard(null); window.removeEventListener('beforeunload', beforeUnload) }
  }, [])

  if (!w || !draft) return null

  const mut = fn => {
    dirty.current = true
    setDraft(d => { const c = clone(d); fn(c); writeDraft(id, c); return c })
  }
  const mutEntry = (i, fn) => mut(d => fn(d.entries[i]))
  // Volta para onde o usuário estava; sem entrada anterior (link direto, recarregamento) cai na
  // lista do histórico, que é onde o treino sempre existe.
  const leave = () => (window.history.state && window.history.state.idx > 0 ? nav(-1) : nav('/history'))
  const back = () => {
    if (!dirty.current) { leave(); return }
    confirmSheet({
      title: t('Discard changes?'), message: t('The workout keeps what it had before you started editing.'),
      confirmText: t('Discard'), danger: true,
      onConfirm: () => { dirty.current = false; clearDraft(id); leave() }
    })
  }

  const save = () => {
    if (!draft.entries.some(e => e.sets.some(s => s.done))) {
      toast(t('A workout with no sets logged cannot be saved — delete it instead.'))
      return
    }
    // Leitura FRESCA do estado (não o `S` do render): entre o render e o clique pode ter entrado
    // uma releitura do assistente, e nem o nome da rotina nem as séries montadas podem sair de
    // um estado velho.
    const live = useStore.getState().S
    const name = draft.name.trim() || (live.routines.find(r => r.id === w.routineId) || {}).name || t('Freestyle')
    const moved = draft.d !== w.d
    let failed = false, touchedEx = []
    // Recalcula DENTRO do updater: é o estado no instante da escrita que é corrigido, e o
    // resultado substitui `workouts`/`exWeights` a partir dele.
    update(s => {
      const res = applyWorkoutEdit(s, id, { ...draft, name })
      if (!res) { failed = true; return }
      s.workouts = res.workouts
      s.exWeights = res.exWeights
      touchedEx = res.touchedEx
    })
    if (failed) { toast(t('Nothing to save')); return }
    clearDraft(id)
    // RF-12: o conflito não pode descartar esta edição. A marca leva os exercícios mexidos (o
    // recálculo do melhor peso tem de vencer junto) e se o dia mudou (só aí a mescla reordena).
    useStore.getState().markLocalWin(id, { ex: touchedEx, moved })
    toast(t('Workout updated'))
    leave()
  }

  const setDate = iso => {
    if (iso > todayISO()) { toast(t('A workout cannot be dated in the future')); return }
    mut(d => { const sh = shiftWorkoutDate(d, iso); d.d = sh.d; d.start = sh.start; d.end = sh.end })
  }

  const usedIds = (skip = -1) => draft.entries.filter((_, j) => j !== skip).map(e => e.id)
  // `cleanupSg` saiu daqui de propósito: entradas de treino FINALIZADO nunca têm `sg` (o
  // `doFinishWorkout` grava só `{id, sets, topW, target}`), então limpar superset no rascunho
  // era código morto.
  const removeEx = i => mut(d => { d.entries.splice(i, 1) })
  const moveEx = (i, dir) => mut(d => {
    const j = i + dir
    if (j < 0 || j >= d.entries.length) return
    ;[d.entries[i], d.entries[j]] = [d.entries[j], d.entries[i]]
  })

  // Trocar exercício: o que é NÚMERO vem junto, o que é do EXERCÍCIO não. `bodyweight`, `unit` e
  // a progressão (`prog`/`inc`/`repsMax`) vivem no `target` e descrevem o exercício antigo —
  // carregá-los para uma barra fixa deixaria "Added (kg)" e o passo de progressão da máquina.
  const NUMERIC = ['mode', 'sets', 'reps', 'weight', 'sec', 'min', 'speed']
  const swapEx = i => exercisePicker(ex => mut(d => {
    const e = d.entries[i]
    const sameKind = modeOf({ ...(e.target || {}), id: e.id }) === modeOf({ id: ex.id })
    const carried = Object.fromEntries(NUMERIC.filter(k => (e.target || {})[k] != null).map(k => [k, e.target[k]]))
    e.id = ex.id
    e.target = { ...defaultConfig(ex.id), ...carried, id: ex.id }
    if (!sameKind) {
      // Tipo diferente: carregar segundos para dentro de um exercício de reps daria um registro
      // sem sentido — as séries nascem de novo pelo `buildSets`, desmarcadas.
      e.sets = buildSets(useStore.getState().S, e.target)
      toast(t('The new exercise uses another kind of set — the sets were rebuilt.'))
    }
  }), usedIds(i))

  const addEx = () => exercisePicker(ex => exConfigSheet(ex, null, cfg => mut(d => {
    const full = { ...cfg, id: ex.id }
    d.entries.push({ id: ex.id, target: { ...cfg }, sets: buildSets(useStore.getState().S, full) })
  }), null, S.routines.find(r => r.id === w.routineId)), usedIds())

  // O ALVO do exercício (a prescrição que a sessão carrega) não é editável aqui — decisão U5. O
  // app julga cada sessão passada contra o alvo gravado nela para decidir a carga da próxima
  // vez (`readSession` → `sessionsFor` → `nextPrescription`), então mexer no alvo de um treino
  // antigo muda a sugestão seguinte. A folha `exConfigSheet` continua sendo usada para o que ela
  // faz de certo nesta tela: configurar um exercício que está ENTRANDO no treino (`addEx`).

  const del = () => confirmSheet({
    title: t('Delete workout?'), message: t('This removes it from your history for good.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      // Apagar mexe no melhor peso dos exercícios do treino (RF-15) e é marcado como a edição —
      // sem isso um 409 traria o treino de volta do servidor (RF-12d).
      let touchedEx = []
      update(s => {
        const res = removeWorkout(s, id)
        if (!res) return
        s.workouts = res.workouts
        s.exWeights = res.exWeights
        touchedEx = res.touchedEx
      })
      clearDraft(id)
      useStore.getState().markLocalWin(id, { ex: touchedEx, deleted: true })
      toast(t('Workout deleted'))
      dirty.current = false
      nav('/history')
    }
  })

  const ticked = draft.entries.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={draft.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => mut(d => { d.name = e.target.value })} />
      </div>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Save')} onClick={save}><Icon name="check" /></button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <Row icon="calendar" iconTint="var(--blue)" title={t('Date')} value={fmtDate(draft.d, true)}
        accessory="chevron" onClick={() => workoutDateSheet(draft.d, setDate)} />
    </div>
    {draft.d !== w.d && <div className="small dim" style={{ margin: '-10px 2px 16px' }}>
      {t('Was {0} — the workout moves to the new day, keeping the time and duration.', fmtDate(w.d, true))}
    </div>}

    {draft.entries.length
      ? draft.entries.map((e, i) => <EditBlock key={i} entry={e} S={S}
          isFirst={i === 0} isLast={i === draft.entries.length - 1}
          onField={(k, f, v) => mutEntry(i, en => { if (v == null) delete en.sets[k][f]; else en.sets[k][f] = v })}
          onToggle={k => mutEntry(i, en => { en.sets[k].done = !en.sets[k].done })}
          onAddSet={() => mutEntry(i, en => en.sets.push(setShape(modeOf({ ...(en.target || {}), id: en.id }), en.sets[en.sets.length - 1], en.target || {})))}
          onRemoveSet={k => mutEntry(i, en => { if (en.sets.length > 1) en.sets.splice(k, 1) })}
          onMove={dir => moveEx(i, dir)}
          onSwap={() => swapEx(i)}
          onRemove={() => removeEx(i)}
          onUnit={() => workoutUnitSheet(e.target && e.target.unit != null ? e.target.unit : null, v => mutEntry(i, en => {
            // Treino antigo não tem `target`; a escolha de unidade CRIA o objeto em vez de quebrar.
            const t2 = { ...(en.target || {}), id: en.id }
            if (v == null) delete t2.unit; else t2.unit = v
            en.target = t2
          }))}
        />)
      : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises in this workout.')}</div>}

    <Button icon="plus" onClick={addEx}>{t('Add exercise')}</Button>
    <div style={{ height: 14 }} />
    <div className="small dim" style={{ textAlign: 'center', marginBottom: 14 }}>
      {t('{0} sets logged — saving recalculates the volume, the records and your best weight for the exercises you touched.', ticked)}
    </div>
    <Button variant="danger" icon="trash" onClick={del}>{t('Delete workout')}</Button>
    <div style={{ height: 40 }} />
  </div>
}
```

### 4. `frontend/src/sheets.jsx` — o botão no detalhe, o seletor de dia, a unidade e a exclusão no seletor

**4.1 `WorkoutDetail` (linhas 806-822) — `Edit workout` acima do `Delete`:**

```jsx
// ANTES (componente inteiro)
function WorkoutDetail({ w, close }) {
  const st = useStore(s => s.S)
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {w.entries.map((e, i) => {
      const ex = EXIDX[e.id]
      return <div key={i} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        {ex && <Thumb ex={ex} />}
        <div className="grow"><div className="tt capitalize" style={{ fontWeight: 600 }}>{ex ? ex.n : (e.n || e.id)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e.target, st)).join('  ·  ') || t('no sets')}</div></div>
      </div>
    })}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
```

```jsx
// DEPOIS (só o fim do componente muda; o resto fica igual)
    <Button variant="tinted" icon="pencil" onClick={() => { close(); nav('/history/w/' + w.id) }}>{t('Edit workout')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
```

`nav` já está importado em `sheets.jsx` (linha 9, `import { nav } from './lib/nav.js'`), usado por `beginWorkout` (linha 901).

**4.2 Import da linha 5 — falta `isoOf`:**

```js
// ANTES
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, uid, exCount, DAYN, MONTHS_LONG, ACCENTS } from './lib/format.js'
// DEPOIS
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, isoOf, uid, exCount, DAYN, MONTHS_LONG, ACCENTS } from './lib/format.js'
```

**4.3 `ExercisePicker` (linhas 433-478) — não oferecer o que já está no treino:**

```js
// ANTES
function ExercisePicker({ onPick, close }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
// DEPOIS
function ExercisePicker({ onPick, close, exclude }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const skip = new Set(exclude || [])          // já estão neste treino: id repetido envenena topW/exWeights
```

```js
// ANTES
  let base = all.filter(e =>
    (bp === '★' ? usage[e.id] : (!bp || e.bp === bp)) &&
    (!ql || e.n.toLowerCase().includes(ql) || e.tg.includes(ql) || e.eq.includes(ql) || (e.desc || '').toLowerCase().includes(ql)))
// DEPOIS
  let base = all.filter(e => !skip.has(e.id) &&
    (bp === '★' ? usage[e.id] : (!bp || e.bp === bp)) &&
    (!ql || e.n.toLowerCase().includes(ql) || e.tg.includes(ql) || e.eq.includes(ql) || (e.desc || '').toLowerCase().includes(ql)))
```

```js
// ANTES (linha 478)
export const exercisePicker = onPick => ui().openSheet(close => <ExercisePicker onPick={onPick} close={close} />)
// DEPOIS
export const exercisePicker = (onPick, exclude) => ui().openSheet(close => <ExercisePicker onPick={onPick} exclude={exclude} close={close} />)
```

Os **dois** chamadores atuais são `Workout.jsx:405` e `RoutineEdit.jsx:139` (o `AddToRoutine` de `sheets.jsx:362` e a biblioteca usam outro caminho). O da rotina continua igual — uma rotina pode ter o mesmo exercício duas vezes, isso é escolha de plano. O do **treino em andamento** passa a excluir o que já está na sessão, porque ali o id repetido já é um bug vivo (a leitura por id pega sempre a primeira entrada, e `topW`/`exWeights` sairiam da entrada errada):

```jsx
// ANTES (Workout.jsx:405, fim da linha)
    }), null, S.routines.find(r => r.id === A.routineId)))} icon="plus">{t('Add exercise')}</Button>
// DEPOIS
    }), null, S.routines.find(r => r.id === A.routineId)), S.active.entries.map(e => e.id))} icon="plus">{t('Add exercise')}</Button>
```

**4.4 `WorkoutDate` + `workoutDateSheet` (novo, junto do bloco do calendário):**

```jsx
/* Seletor do dia do treino. Calendário do próprio app, e não `<input type="date">`: o app não
   declara `color-scheme`, então o controle nativo apareceria com o visual claro do sistema no
   meio de uma tela escura. Dias futuros ficam desabilitados — um treino que ainda não
   aconteceu entraria no mapa de calor e na semana corrente. */
function WorkoutDate({ iso, onPick, close }) {
  const [cur, setCur] = useState(() => { const d = new Date(iso + 'T12:00:00'); d.setDate(1); return d })
  const [sel, setSel] = useState(iso)
  const y = cur.getFullYear(), mo = cur.getMonth()
  const today = todayISO()
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const dayIso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const future = dayIso > today
    cells.push(<button key={d} disabled={future}
      className={'cal-d' + (dayIso === sel ? ' has' : '') + (dayIso === today ? ' today' : '')}
      style={future ? { opacity: .3 } : null}
      onClick={() => setSel(dayIso)}><span>{d}</span><i /></button>)
  }
  const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d) }
  return <>
    <h3>{t('Workout date')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick the day this workout happened — today or earlier.')}</div>
    <div className="chips" style={{ marginBottom: 12 }}>
      <button className={'chip' + (sel === today ? ' on' : '')} onClick={() => setSel(today)}>{t('Today')}</button>
      <button className={'chip' + (sel === ago(1) ? ' on' : '')} onClick={() => setSel(ago(1))}>{t('Yesterday')}</button>
      <button className={'chip' + (sel === ago(2) ? ' on' : '')} onClick={() => setSel(ago(2))}>{t('{0} days ago', 2)}</button>
    </div>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label="Next month"><Icon name="chevronRight" /></button>
    </div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); onPick(sel) }}>{t('Save date')}</Button>
  </>
}
export const workoutDateSheet = (iso, onPick) => ui().openSheet(close => <WorkoutDate iso={iso} onPick={onPick} close={close} />)
```

**4.5 `workoutUnitSheet` (novo) — a unidade do exercício no treino, sem tocar na rotina:**

```jsx
/* A folha de unidade do treino grava em `S.active` E na rotina de origem; aqui o alvo é o
   rascunho de um treino já finalizado, e a rotina não pode ser tocada (RF-11). O número não é
   convertido: `200` continua `200` — a regra da BACKLOG-01. */
function WorkoutUnit({ value, onPick, close }) {
  const [v, setV] = useState(value)
  return <>
    <h3>{t('Weight unit')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Changes how these numbers are read. The numbers themselves stay as they are.')}</div>
    <Segmented value={v || ''} onChange={setV}
      options={[{ value: '', label: t('Profile default') }, { value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); onPick(v || null) }}>{t('Save')}</Button>
  </>
}
export const workoutUnitSheet = (value, onPick) => ui().openSheet(close => <WorkoutUnit value={value} onPick={onPick} close={close} />)
```

### 5. `frontend/src/App.jsx` — a rota

```jsx
// ANTES
              <Route path="/history" element={<History />} />
// DEPOIS
              <Route path="/history" element={<History />} />
              <Route path="/history/w/:id" element={<WorkoutEdit />} />
```

Mais o import (`import WorkoutEdit from './views/WorkoutEdit.jsx'`) junto dos outros. O destaque da barra de baixo não muda: `TabBar` compara o **primeiro** segmento do caminho, então `/history/w/:id` mantém **Stats** aceso (`TabBar.jsx:15-16`).

### 6. Sair com mudanças pendentes: o guarda de navegação

**6.1 `frontend/src/store/useUI.js` — o guarda (novo, junto de `sheets`/`toast`):**
```js
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', locked }
  leaveGuard: null,    // fn(to) => boolean; a tela de edição registra a dela enquanto está montada
  setLeaveGuard(fn) { set({ leaveGuard: fn }) },
```

**6.2 `frontend/src/components/TabBar.jsx` (linhas 18-24) — consultar antes de navegar:**

```jsx
// ANTES
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
// DEPOIS
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
```

```jsx
// ANTES
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
// DEPOIS
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const guard = useUI(s => s.leaveGuard)
  if (!user && !isGuest) return null
```

```jsx
// ANTES
  const startWorkout = () => {
    if (!S.active) {
// DEPOIS
  const startWorkout = () => {
    if (guard && !guard('/workout')) return
    if (!S.active) {
```

```jsx
// ANTES
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
// DEPOIS
  // A barra é renderizada fora das rotas: sem consultar o guarda, tocar numa aba levaria
  // embora o rascunho da tela de edição sem perguntar nada.
  const go = to => { if (guard && !guard(to)) return; nav(to) }
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => go(to)}>
```

Os quatro trechos acima são as únicas mudanças do `TabBar.jsx`.

**6.3 O caminho que não dá para bloquear: o voltar do navegador/celular.**

O app usa `HashRouter` com a API declarativa de rotas (`App.jsx:99`, react-router-dom ^7.18.2). Nessa combinação **não existe bloqueador de navegação**: `useBlocker` exige um data router (`createHashRouter`), que o app não usa, e `beforeunload` não dispara em pop de histórico de SPA. Migrar o app para data router por causa desta tela seria trocar a fundação do roteamento por um detalhe de uma tela.

O que fecha o buraco então não é bloquear, é **não perder**: o rascunho é gravado em `sessionStorage` a cada mudança (`writeDraft`, §3) e a tela o restaura ao montar, avisando com um toast. Consequência para o usuário: usar o voltar do navegador sai da tela, e reabrir o treino devolve exatamente o que ele tinha digitado. Os caminhos que dão para interceptar — seta de voltar, barra de baixo, recarregar e fechar — continuam perguntando antes.

### 7. `frontend/src/store/useStore.js` — a edição não pode ser descartada por um conflito (RF-12)

Hoje a mescla por id deixa a cópia do **servidor** vencer — é o que preserva o que o assistente escreveu. Um treino editado tem o **mesmo id** de um que já está no servidor, então a edição sumiria em silêncio. São **três** caminhos a cobrir: o `409` do `pushState` (linha ~219), o ramo de mescla do `pullState` (linha ~283) e o ramo que **adota o servidor inteiro** (linha ~266).

**7.1 a marca, persistida, antes do `return {` do store (junto de `persist`/`adoptRev`):**

```js
// Um treino editado tem o MESMO id de um que já está no servidor, e a mescla por id deixa a
// cópia do servidor vencer (é o que preserva o que o assistente escreveu). Para uma edição
// recém-feita, isso descartaria o trabalho em silêncio. A marca vive no ARMAZENAMENTO LOCAL,
// não só em memória: o push sai 1,5 s depois de salvar, e um recarregar no meio (o caminho
// normal no celular) apagaria a marca antes de ela servir para alguma coisa. Ela expira
// sozinha — tempo suficiente para o push seguinte, curto demais para mascarar a edição de
// outro aparelho.
const LOCAL_WIN_KEY = 'gym_local_win'
const LOCAL_WIN_MS = 60000
const readLocalWin = () => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_WIN_KEY) || 'null')
    return v && v.id && Date.now() - v.at < LOCAL_WIN_MS ? v : null
  } catch { return null }
}
```

```js
// O carimbo do conteúdo: a marca vive no `localStorage` e é lida por TODAS as abas, mas cada
// aba tem o próprio store. Sem o carimbo, uma aba que nunca editou (com a cópia velha dela)
// aprovaria a mescla e o push seguinte reverteria a edição no servidor.
const sigOf = w => JSON.stringify([w.d, w.name, w.entries])

const localWinNow = () => {
  const w = get().localWin || readLocalWin()
  return w && Date.now() - w.at < LOCAL_WIN_MS ? w : null
}
// A cópia local só vence quando ela É a editada: mesmo id e mesmo carimbo da marca.
const keepLocal = x => { const lw = localWinNow(); return !!lw && x.id === lw.id && sigOf(x) === lw.sig }
const mergeWorkouts = (serverWs, localWs) => {
  const lw = localWinNow()
  const byId = new Map()
  // Treino apagado agora não volta do servidor enquanto a marca valer.
  ;(serverWs || []).forEach(w => { if (lw && lw.deleted && w.id === lw.id) return; byId.set(w.id, w) })
  ;(localWs || []).forEach(w => { if (!byId.has(w.id) || keepLocal(w)) byId.set(w.id, w) })
  const out = [...byId.values()]
  // A ordem do array É a cronologia que o app lê (`lastEntryFor` de trás para frente, parando na
  // primeira ocorrência; `sessionsFor` acumulando, com a mais recente no fim) — mas a mescla só
  // reordena quando a edição MEXEU no dia. Fora isso vale a ordem do servidor: o histórico pode
  // ter chegado em outra ordem, e reordenar o que ninguém tocou mudaria a "última sessão" de
  // exercícios sem relação com esta edição.
  return lw && lw.moved ? sortWorkouts(out) : out
}
// O `exWeights` é por EXERCÍCIO: a edição vence nos exercícios que ela MEXEU (a lista viaja na
// marca), inclusive quando o recálculo apagou a chave — que não pode ressuscitar do servidor.
const mergeExWeights = (serverEW, localEW) => {
  const out = { ...(serverEW || {}) }
  const lw = localWinNow()
  if (!lw) return out
  ;(lw.ex || []).forEach(exId => {
    if (localEW && localEW[exId]) out[exId] = localEW[exId]
    else delete out[exId]
  })
  return out
}
```

Com `import { sortWorkouts } from '../lib/workout-edit.js'` no topo do store.

**7.2 estado e ação:**

```js
// no estado inicial, junto de `S`
    localWin: null,          // { id, at } — treino editado agora; ver mergeWorkouts
// entre as ações
    markLocalWin(id, extra = {}) {
      const w = get().S.workouts.find(x => x.id === id)
      // `sig` é o carimbo do conteúdo editado (ver `sigOf`); numa exclusão não há conteúdo para
      // carimbar, e `deleted` é quem manda. `ex` são os exercícios mexidos, que vencem a mescla
      // do melhor peso; `moved` diz se o dia mudou, e é o único caso em que a mescla reordena.
      const mark = {
        id, at: Date.now(), ex: extra.ex || [], moved: !!extra.moved,
        deleted: !!extra.deleted, sig: w ? sigOf(w) : null
      }
      try { localStorage.setItem(LOCAL_WIN_KEY, JSON.stringify(mark)) } catch { /* modo privado: vale só nesta sessão */ }
      set({ localWin: mark })
    },
```

**7.3 os três pontos de mescla/adoção:**

```js
// ANTES (pushState, caminho do 409)
              const byId = new Map()
              ;(srv.workouts || []).forEach(w => byId.set(w.id, w))
              ;(S.workouts || []).forEach(w => { if (!byId.has(w.id)) byId.set(w.id, w) })
              const merged = Object.assign(clone(DEF), srv)
              merged.workouts = [...byId.values()]
// DEPOIS
              const merged = Object.assign(clone(DEF), srv)
              merged.workouts = mergeWorkouts(srv.workouts, S.workouts)
              merged.exWeights = mergeExWeights(srv.exWeights, S.exWeights)
```

```js
// ANTES (pullState, ramo de mescla)
          const byId = new Map()
          ;(state.workouts || []).forEach(w => byId.set(w.id, w))
          ;(S.workouts || []).forEach(w => { if (!byId.has(w.id)) byId.set(w.id, w) })
          const merged = Object.assign(clone(DEF), state)
          merged.workouts = [...byId.values()]
// DEPOIS
          const merged = Object.assign(clone(DEF), state)
          merged.workouts = mergeWorkouts(state.workouts, S.workouts)
          merged.exWeights = mergeExWeights(state.exWeights, S.exWeights)
```

```js
// ANTES (pullState, ramo que adota o servidor inteiro)
        if (state && (!hasData(S) || (serverMoved && !dirty))) {
// DEPOIS
        // Com uma edição recente na mão, adotar o estado inteiro apagaria exatamente o que o
        // usuário acabou de salvar — então este ramo cede lugar à mescla.
        if (state && !localWinNow() && (!hasData(S) || (serverMoved && !dirty))) {
```

**7.4 limpar a marca:** **não** no primeiro push bem-sucedido (era o erro da v1: o push sai 1,5 s depois de salvar e a janela de 60 s nunca valeria). A marca expira por tempo, e o único ponto que a limpa é a própria expiração — mais a limpeza no `clearLocalSession()` (sign out/reset), que já apaga as chaves locais:

```js
// ANTES (clearLocalSession, linhas 166-172)
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }
// DEPOIS
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(LOCAL_WIN_KEY)     // a marca não sobrevive a sair da conta nem a reset
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
    set({ localWin: null })                    // `persist` não mexe nela, e `localWinNow` prefere a memória
  }
```

### 8. `frontend/src/index.css` — a coluna do `×` (novo, junto das regras de `.setrow`)

```css
/* a coluna do × por série existe só na tela de edição de um treino finalizado; o espaçador do
   cabeçalho precisa da MESMA largura, ou os rótulos saem de cima dos steppers */
.sethead .rm-sp{width:26px;flex:none}
.setrow .rm-sp{width:26px;height:26px;border-radius:7px;font-size:13px;flex:none;color:var(--red)}
.iconbtn.mini{width:28px;height:24px;border-radius:7px;font-size:12px}
```

### 9. `frontend/src/locales/pt.js` — strings novas (sem repetir o que já existe)

Já existem e são **reusadas sem tocar no arquivo**: `'Today'` (128), `'Add set'` (266), `'Add exercise'` (187), `'Remove exercise'` (200), `'Weight unit'` (364), `'Discard'` (113), `'Save'`, `'Back'`.

```js
  'Edit workout': 'Editar treino',
  'Workout updated': 'Treino atualizado',
  'Nothing to save': 'Nada para salvar',
  'Date': 'Data',
  'Workout date': 'Data do treino',
  'Pick the day this workout happened — today or earlier.': 'Escolha o dia em que o treino aconteceu — hoje ou antes.',
  'Save date': 'Salvar data',
  'Yesterday': 'Ontem',
  '{0} days ago': '{0} dias atrás',
  'Was {0} — the workout moves to the new day, keeping the time and duration.': 'Era {0} — o treino passa para o dia novo, mantendo a hora e a duração.',
  'A workout cannot be dated in the future': 'Um treino não pode ficar numa data futura',
  'A workout with no sets logged cannot be saved — delete it instead.': 'Um treino sem nenhuma série marcada não pode ser salvo — apague o treino.',
  'Discard changes?': 'Descartar as mudanças?',
  'The workout keeps what it had before you started editing.': 'O treino continua como estava antes de você começar a editar.',
  'Remove this set': 'Remover esta série',
  'Swap exercise': 'Trocar exercício',
  'No exercises in this workout.': 'Nenhum exercício neste treino.',
  'The new exercise uses another kind of set — the sets were rebuilt.': 'O exercício novo usa outro tipo de série — as séries foram refeitas.',
  'Changes how these numbers are read. The numbers themselves stay as they are.': 'Muda como esses números são lidos. Os números em si ficam como estão.',
  'Profile default': 'Padrão do perfil',
  '{0} sets logged — saving recalculates the volume, the records and your best weight for the exercises you touched.': '{0} séries marcadas — salvar recalcula o volume, os recordes e o seu melhor peso nos exercícios que você mexeu.',
  'Unsaved changes from before are still here.': 'As mudanças que você não salvou continuam aqui.',
```

### 10. Testes

**10.1 `frontend/src/lib/workout-edit.test.js` (novo, vitest — o padrão dos 11 arquivos `lib/*.test.js`):**

| # | Caso | O que prova |
|---|---|---|
| 1 | corrigir `160` → `200` numa série recalcula `vol` do treino | RF-9 |
| 2 | correção para baixo que derruba o recorde tira o exercício de `w.prs` | U2 / RF-9 |
| 3 | correção para cima que passa do histórico põe o exercício em `w.prs` | RF-9 |
| 4 | série desmarcada sai do volume e do recorde, mas continua no array do treino | RF-5 / RF-9 |
| 5 | exercício com todas as séries desmarcadas sai de `entries` ao salvar | RF-10 |
| 6 | nenhuma série marcada em nenhum exercício → `applyWorkoutEdit` devolve `null` | RF-10 |
| 7 | mudar o dia reordena `S.workouts` **e** reancora `start`/`end` mantendo a hora local e `end - start` | RF-4 / RF-9 |
| 8 | editar **sem** mudar o dia **não** reordena um histórico que estava fora de ordem | A12 |
| 9 | `exWeights` sobe quando a correção é maior que o valor guardado, e grava `src` do treino | RF-9 |
| 10 | `exWeights` desce quando `src` aponta para este treino | U2 |
| 11 | `exWeights` **não** desce quando `src` aponta para outro treino | U2 / RF-9 |
| 12 | `exWeights` **não** desce, em dado antigo sem `src`, quando o valor guardado é maior que tudo o que este treino registrava | A10 |
| 13 | exercício removido do treino tem o `exWeights` recalculado (ou apagado, se não há mais nada) | A9 |
| 14 | `topW` é recalculado só no exercício mexido; no intocado continua o confirmado | Decisão assumida |
| 15 | apagar e redigitar o mesmo valor **não** conta como "mexido" (comparação campo a campo) | A8 |
| 16 | `applyWorkoutEdit` **não muta** o `S` recebido (deep-equal antes/depois) e não devolve `routines`/`week`/`dayPlan` | RF-11 |
| 17 | treino inexistente devolve `null` | RF-2 |
| 18 | `setShape` devolve a forma real da série (`{w,r,done}` / `{sec,w,done}` / `{min,speed,done}`), sem `sets`/`mode`/`weight` | A1 |
| 19 | `shiftWorkoutDate` com `end` ausente não inventa duração | A24 |
| 20 | `sortWorkouts` desempata dois treinos do mesmo dia pela hora de início | A11 |
| 21 | `removeWorkout` recalcula (ou apaga) o `exWeights` dos exercícios do treino apagado e não toca no de outro treino | RF-15 |
| 22 | `setShape` semeia da prescrição: reps 5 → 5 (não 10); modo tempo com carga prescrita → a carga (não 0) | R4 |
| 23 | `setShape` copia o `wUnit` da série anterior | N10 |
| 24 | editar preserva campos extras da entrada (o `n` que `deleteCustomEx` carimba no histórico) | N1 |
| 25 | `mergeWorkouts` **não** reordena sem `moved` na marca, e reordena com `moved` | R3 |
| 26 | `mergeExWeights` deixa o local vencer nos exercícios da marca, **inclusive apagando** a chave | R2 |
| 27 | `mergeWorkouts` não traz de volta um treino marcado como `deleted` | N7 |
| 28 | `keepLocal` recusa uma cópia local com carimbo diferente (a aba que não editou) | N3 |

**10.2 Roteiro manual (no app, depois do deploy):**

1. Stats → card **Recent workouts** → tocar num treino → o detalhe mostra `Edit workout` e `Delete workout`.
2. `Edit workout` → a tela abre com o nome, a data e os exercícios; corrigir um peso e voltar **sem** salvar → confirmação → o treino está como antes.
3. Repetir, salvar → toast `Treino atualizado` → volta para a tela anterior; reabrir o treino pelo card e conferir o número novo, o volume novo e a ausência do troféu (se a correção derrubou o recorde).
4. Corrigir para baixo um peso que era recorde → o `PR` sai daquele treino no card de recentes.
5. Desmarcar a última série → o volume cai e o total de séries do treino cai; salvar mantém o treino na lista.
6. Desmarcar **todas** as séries → salvar avisa e não escreve nada.
7. `Add exercise` → escolher, configurar, digitar e marcar → salvar → o exercício aparece no detalhe e no mapa de corpo. Conferir que o exercício adicionado **não** aparece mais na lista do seletor.
8. `Remove exercise` no primeiro exercício → salvar → o detalhe não mostra mais ele, e a rotina de origem continua **igual** (conferir em `Plan`).
9. Mudar o dia para ontem → salvar → o treino sai do card de hoje e aparece no mapa de calor de ontem; a duração não muda.
10. Tentar uma data futura no seletor → os dias futuros estão apagados e não respondem.
11. Trocar o exercício de um bloco por outro de mesmo tipo → os números continuam; por outro de tipo diferente → as séries voltam ao padrão, desmarcadas, com aviso.
12. Com mudanças pendentes, tocar numa aba da barra de baixo → confirmação; cancelar mantém a tela; confirmar sai.
13. Com mudanças pendentes, recarregar a página → o navegador pede confirmação.
14. Com mudanças pendentes, usar o **voltar do navegador/celular** → a tela sai (não dá para bloquear); reabrir o treino pelo card mostra o que você tinha digitado, com o aviso de mudanças não salvas.
15. `Delete workout` na tela de edição → confirmação → volta para `/history` sem o treino, e o melhor peso do exercício daquele treino cai para o do treino anterior (conferir na curva do exercício no Stats).
16. Apagar um treino pelo `Delete workout` do detalhe (o que já existia) → mesmo efeito do anterior.
17. Com o app aberto, editar um treino e, antes de salvar, escrever no estado por outro caminho (assistente/outro aparelho) → salvar → a edição sobrevive, inclusive o melhor peso recalculado (RF-12).

---

## Comportamento Visual/UX

### Detalhe do treino (hoje × depois)

```
HOJE                                    DEPOIS
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ Push C - Shoulder 3D         │        │ Push C - Shoulder 3D         │
│ 12/09/2026 · 1:04:12 · 18    │        │ 12/09/2026 · 1:04:12 · 18    │
│ séries · 8.420 kg            │        │ séries · 8.420 kg            │
│                              │        │                              │
│ [img] Desenvolvimento        │        │ [img] Desenvolvimento        │
│       160×8 · 200×8 · 160×6  │        │       160×8 · 200×8 · 160×6  │
│                              │        │                              │
│ [img] Elevação lateral       │        │ [img] Elevação lateral       │
│       12 · 12 · 10           │        │       12 · 12 · 10           │
│                              │        │                              │
│ ┌──────────────────────────┐ │        │ ┌──────────────────────────┐ │
│ │      Delete workout      │ │        │ │  ✎  Edit workout         │ │  ← novo
│ └──────────────────────────┘ │        │ └──────────────────────────┘ │
└──────────────────────────────┘        │ ┌──────────────────────────┐ │
                                        │ │      Delete workout      │ │
                                        │ └──────────────────────────┘ │
                                        └──────────────────────────────┘
```

### A tela de edição

```
┌────────────────────────────────────────────────┐
│ ←   [ Push C - Shoulder 3D          ]      ✓   │  nome editável · ✓ salva
├────────────────────────────────────────────────┤
│  ▤  Date                          12/09/2026 › │  abre o seletor de dia
├────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────┐ │
│ │ [img] Desenvolvimento                 ⌃ ⌄  │ │  mover
│ │       3 séries                             │ │
│ │   #   Peso (kg)      Reps      ✓     ×     │ │
│ │   1   − 160 +        −  8 +    ☑     🗑    │ │  ← mesma linha da tela de treino
│ │   2   − 200 +        −  8 +    ☑     🗑    │ │     + um × por série
│ │   3   − 160 +        −  6 +    ☑     🗑    │ │
│ │  [ + Add set ] [ ⤨ Swap ] [ kg ]           │ │
│ │  [ 🗑 Remove exercise ]                    │ │
│ └────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────┐ │
│ │ [img] Elevação lateral                ⌃ ⌄  │ │
│ │   ...                                      │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│  [ + Add exercise ]                            │
│                                                │
│   18 séries marcadas — salvar recalcula o      │
│   volume, os recordes e o seu melhor peso      │
│                                                │
│  [ 🗑 Delete workout ]                         │
└────────────────────────────────────────────────┘
```

### Seletor de dia

```
┌────────────────────────────────────────┐
│ Workout date                           │
│ Pick the day this workout happened —   │
│ today or earlier.                      │
│  ( Today ) ( Yesterday ) ( 2 days ago )│
│  ‹        September 2026           ›   │
│  Mo Tu We Th Fr Sa Su                  │
│  .. 1  2  3  4  5  6                   │
│  7  8  9 10 11 [12] 13                 │   ← dia do treino: acc-soft
│ 14 15 16 17 18 19 20                   │   ← hoje: anel de destaque
│ 21 22 23 24 25 26 27                   │   ← futuro: apagado, não responde
│ 28 29 30 ·  ·  ·  ·                    │
│  [        Save date        ]           │
└────────────────────────────────────────┘
```

### Avisos (toasts e folhas)

| Ação | Mensagem |
|---|---|
| Salvar com sucesso | `Treino atualizado` |
| Nenhuma série marcada | `Um treino sem nenhuma série marcada não pode ser salvo — apague o treino.` |
| Data futura escolhida | `Um treino não pode ficar numa data futura` |
| Troca por exercício de outro tipo | `O exercício novo usa outro tipo de série — as séries foram refeitas.` |
| Sair com mudanças (qualquer caminho) | folha: `Descartar as mudanças?` / `O treino continua como estava antes de você começar a editar.` |

---

## Riscos e casos de borda

| # | Caso | Tratamento |
|---|---|---|
| R1 | Edição salva enquanto outro aparelho/assistente escreve | RF-12: dentro de 60 s, o treino editado (e o `exWeights` dele) vence por id, e a releitura não adota o servidor inteiro; fora disso, o servidor vence (regra atual) |
| R2 | Treino apagado em outra aba com a tela de edição aberta | `w` some do store → `useEffect` redireciona para `/history`; nada é escrito |
| R3 | Exercício que não existe mais no catálogo (`exOr` devolve um stub) | A tela mostra o que `exOr` devolver (nome do `id`), como o editor de rotina já faz |
| R4 | Treino antigo sem `target` (anterior ao `plan`) | `modeOf` cai no grupo muscular; a folha de unidade **cria** o `target`; `buildSets` e `setLabel` já toleram a ausência |
| R5 | Mesmo exercício duas vezes no mesmo treino | Não é criado pela tela nova (seletor exclui o que já está lá) e o app já assume id único em toda a leitura |
| R6 | Treino de cardio/tempo sem peso | `topW` fica `null`; `exWeights` não é tocado (`mx <= 0`) |
| R7 | Edição que zera o volume de um treino (todas as séries sem carga) | Volume 0 é legítimo (treino de peso corporal); o treino continua na lista |
| R8 | Data movida para uma semana já fechada | A sequência de semanas e o volume semanal se recalculam sozinhos (derivados de `w.d`) |
| R9 | Duas edições no mesmo treino em sequência | Cada salvar recalcula do zero a partir do estado atual; não há acúmulo |
| R10 | `S.workouts` sem o treino no momento do `applyWorkoutEdit` | Devolve `null`, a tela avisa e nada é escrito |
| R11 | Treino registrado de madrugada e mudança de horário de verão | A hora local é reancorada campo a campo (A13) |
| R12 | `end` ausente no treino (import antigo) | Só o que existe é deslocado; nenhuma duração é inventada (A24) |
| R13 | Duas abas abertas no mesmo aparelho | A marca de edição é compartilhada pelo `localStorage`, mas só vence a cópia local cujo **carimbo de conteúdo** bate com ela: a aba que não editou não reverte nada (N3) |
| R14 | Aparelho fora de `America/Sao_Paulo` | A análise do coach deriva a **data** de `w.start` renderizado em SP (`api/coach.js:83`), e a edição reancora o relógio local do aparelho. Fora desse fuso, mudar o dia pode deixar a data da análise como estava. Limitação conhecida e registrada em "Não inclui" |
| R15 | Treino antigo com o mesmo exercício duas vezes | A edição lê a **primeira** entrada, como o `entries.find` do resto do app; a tela nova não cria duplicata e o treino em andamento deixou de permitir (R5) |

---

## Anexo — achados da Revisão 1 (26, todos aplicados)

| ID | Sev. | Onde | Achado | Como ficou na v2 |
|---|---|---|---|---|
| A1 | bloqueante | §3 | Séries criadas espalhando `defaultConfig` (forma de configuração, não de série) | `setShape` (§2) para série nova; `buildSets` para exercício novo/trocado (§3) |
| A2 | bloqueante | §4.2 | `isoOf` não está no import de `sheets.jsx:5` | import corrigido (§4.2) |
| A3 | bloqueante | §3 | `onUnit` escrevia em `target` inexistente (treino antigo) | cria o `target` (§3, `onUnit`) |
| A4 | bloqueante | §6 | `exWeights` vinha do servidor na mescla | `mergeExWeights` nos dois ramos (§7.3) |
| A5 | bloqueante | §6.3 | Ramo "adota tudo" do `pullState` ignorava a marca | `!localWinNow()` na condição (§7.3) |
| A6 | bloqueante | §6.1 | Mescla mantinha a ordem do servidor e desfazia a reordenação | `mergeWorkouts` devolve `sortWorkouts(...)` (§7.1) |
| A7 | bloqueante | §3 | `swapEx` podia duplicar exercício no treino | `exercisePicker(onPick, exclude)` + `usedIds()` (§3, §4.3) |
| A8 | média | §2 | `touched` por `JSON.stringify` dependia da ordem das chaves | `sameSets` campo a campo (§2) |
| A9 | média | §2 | Exercício removido mantinha `exWeights` obsoleto | itera a união antes/depois (§2) |
| A10 | média | §2 | Proveniência inferida de `w`+`d` era falsa | `exWeights[].src` + regra conservadora para dado antigo (§1.2, §2) |
| A11 | média | §2 | `sortWorkouts` nunca devolvia 0 | desempate por `start` (§2) |
| A12 | média | §2 | Reordenava em toda gravação | reordena só quando o dia muda (§2) |
| A13 | média | §2 | Delta em ms atravessava horário de verão | `sameLocalTimeOn` reancora a hora local (§2) |
| A14 | média | §3 | Só a seta de voltar protegia o rascunho | guarda de navegação + `beforeunload` (§6, U4) |
| A15 | média | §3 | `nav(-1)` sem fallback; roteiro não observável | `leave()` com `history.state.idx` (§3) + roteiro 3 corrigido (§10.2) |
| A16 | média | §1 | "dois chamadores" — são cinco, em quatro arquivos | inventário corrigido (§1.1) |
| A17 | média | Decisões | Mecanismo de `sessionsFor` descrito errado | justificativa corrigida (§2, `sortWorkouts`) |
| A18 | média | §3 | Nome vazio salvo | fallback no `save` (§3) |
| A19 | média | §6 | Marca em memória, limpa no primeiro push | marca persistida, expira por tempo (§7.1, §7.4) |
| A20 | média | §3 | `S` do render usado na escrita | recálculo dentro do updater (§3, `save`) |
| A21 | média | §7 | Strings repetidas e `Date` sem tradução | bloco deduplicado (§9) |
| A22 | leve | topo | Linha citada (819 em vez de 820) | corrigida no cabeçalho |
| A23 | leve | §3 | `×` morto com uma série | desabilitado (§3) |
| A24 | leve | §2 | `end` ausente virava `null + delta` | só desloca o que existe (§2) |
| A25 | leve | §8.1 | Caso 12 vacuamente verdadeiro | caso 16 testa imutabilidade do `S` (§10.1) |
| A26 | leve | §3 | Coluna do `×` sem CSS | `.rm-sp` em `index.css` (§8) |

---

## Anexo — achados da Revisão 2 (9 de regressão + 12 novos, todos aplicados)

| ID | Sev. | Onde | Achado | Como ficou na v3 |
|---|---|---|---|---|
| R1 | bloqueante | §3, §6 | `beforeunload` não cobre o voltar do navegador num SPA com `HashRouter` (o app não tem bloqueador de navegação) | rascunho em `sessionStorage` + aviso ao reabrir (§3); §6.3 explica o porquê |
| R2 | bloqueante | §7.1 | O `exWeights` recalculado era revertido quando o melhor peso passava a ser de outro treino, e a chave apagada ressuscitava | a marca leva `ex` (exercícios mexidos) e `mergeExWeights` vence por exercício, inclusive apagando (§7.1) |
| R3 | bloqueante | §7.1, §7.3 | A mescla reordenava o histórico em todo conflito, contradizendo A12 | `mergeWorkouts` só reordena quando a marca tem `moved` (§7.1) |
| R4 | média | §2 | `setShape` fixava 10/20/8/45 em vez de semear da prescrição | recebe o `target` e semeia dele (§2) |
| R5 | média | §2, §4.3 | A premissa de id único já era falsa no treino em andamento | `applyWorkoutEdit` usa a primeira ocorrência (como o `entries.find`) e o `Workout.jsx:405` passa a excluir (§2, §4.3) |
| R6 | média | §3 | `addEx`/`swapEx`/`save` liam o `S` do render | passam a ler `useStore.getState().S` (§3) |
| R7 | média | §7.4 | `clearLocalSession` não zerava a marca em memória | `set({ localWin: null })` (§7.4) |
| R8 | média | §1.2 | O comparador de datas antigo seguia vivo em `import-csv.js:520` | passa a usar `sortWorkouts` (§1.2) |
| R9 | leve | §1.2 | O seed de demonstração também grava `exWeights` sem `src` | citado como quinto lugar, coberto pela regra conservadora (§1.2) |
| N1 | bloqueante | §2 | A edição descartava `e.n`, o nome que `deleteCustomEx` carimba no histórico | a entrada preserva os campos que já tinha (§2) |
| N2 | bloqueante | §3 | `Sets & reps` podia trocar o modo e deixar as séries na forma errada | **o botão saiu do escopo (U5)**: o alvo virou somente leitura na tela, e a folha `exConfigSheet` só é usada para configurar um exercício que está ENTRANDO no treino (§3, RF-6) |
| N3 | bloqueante | §7.1 | A marca compartilhada entre abas deixava uma aba velha reverter a edição | a marca carrega o carimbo do conteúdo e `keepLocal` compara (§7.1) |
| N4 | média | §3 | Trocar exercício levava `bodyweight`/`unit`/progressão do exercício antigo | só as chaves numéricas viajam; o resto vem do exercício novo (§3) |
| N5 | média | §4.3 | Inventário de chamadores do `exercisePicker` errado (são dois) | corrigido, com a mudança do `Workout.jsx:405` (§4.3) |
| N6 | média | §3, §2 | Apagar deixava `src` órfão e o melhor peso travado | `removeWorkout` recalcula nos dois caminhos de apagar (§2, RF-15) |
| N7 | média | §3, §7.1 | A exclusão não era protegida contra o `409` | a marca leva `deleted` e a mescla respeita (§3, §7.1) |
| N8 | média | Contexto, Riscos | A data da análise do coach vem de `w.start` em SP, não de `w.d` | documentado em "Não inclui" e em R14 |
| N9 | leve | §3 | `cleanupSg` no rascunho era código morto | removido, com o porquê (§3) |
| N10 | leve | §2 | `setShape` não copiava o override de unidade da série | copia `wUnit` (§2) |
| N11 | leve | §2 | `modeOf` importado sem uso em `workout-edit.js` | trocado por `repFloor` no import (§2) |
| N12 | leve | Contexto | Citação `api/coach.js:42` apontava a função errada | corrigida para `:101`, com `:42` como o laço (§Contexto) |
