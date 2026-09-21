# Spec: escolher o estilo do app (Style) — Paper — v3

> **Pedido do usuário (20/09/2026):** *"eu quero implementar uma função nova no settings, quero permitir o usuário escolher o Style de app dele. Teremos todas esse como opções. hoje o app em Setting permite mudar a cor, e quero q ao mudarmos de 'Style' essa opção (div) de mudar de cor suma […] entendo q essa implementação requer muito trabalho então podemos fazer o seguinte, vamos criar a spec para adicionar esse opção de Style e colocar o estilo 'Paper' disponível."*
> **Repo/branch:** `emersondsc/openGym`, `emerson-custom`. Frontend React 19 + Vite (`frontend/`), CSS único em `frontend/src/index.css`, estado do usuário em `localStorage` + `PUT /api/data` (API Node sem framework em `api/server.js`).
> **Base medida (20/09/2026), na VPS `/mnt/drivebackup/apps/openGym/openGym`, HEAD `ebc9c44`, árvore limpa:** `frontend/src/views/Settings.jsx` 363 linhas · `frontend/src/store/useStore.js` 388 · `frontend/src/App.jsx` 102 · `frontend/src/index.css` 933 · `frontend/src/components/Icon.jsx` 153 · `frontend/src/components/ui.jsx` 296 · `frontend/src/lib/format.js` 47 · `frontend/src/lib/i18n.js` 56 · `frontend/src/locales/pt.js` 46.951 bytes · **13** arquivos de teste (12 em `frontend/src/lib/*.test.js` + `frontend/src/store/useStore.test.js`), vitest.
> **Estado hoje:** a aparência tem exatamente dois controles — **Theme** (Dark/Light, `Settings.jsx:150-158`) e **Accent color** (oito amostras, `Settings.jsx:167-176`) — dentro da seção *Appearance* (`Settings.jsx:149-177`), e os dois são aplicados por `applyPrefs(theme, accent)` (`App.jsx:33-39`), que escreve `data-theme` e `data-accent` no `<html>`. Todo o CSS do app lê variáveis (`--bg`, `--surface`, `--label`, `--acc`, `--r-card`, `--pad`, `--icon-stroke`, `--hair`), então uma aparência diferente **já é possível só com um bloco de CSS** — o que não existe é o conceito de "estilo" no estado, na tela nem no `<html>`.
> **Revisão 1 (v1 → v2): 22 achados — 1 bloqueante, 7 médios, 14 leves — todos aplicados na v2.** O bloqueante: o prefixo `:root[data-skin="paper"]` sobe a especificidade e matava o anel de foco de `.field` e o feedback de toque de `.item`. Tabela no anexo.
> **Extensão (21/09/2026):** os três estilos que esta spec deixava de fora — **Grind**, **Pulse** e **Sage** — foram implementados no commit `7f89cb5`, cada um com o seu bloco `:root[data-skin="..."]` e a sua entrada no `SKINS` (exatamente o caminho previsto em RF-11). O que esta spec diz sobre o Paper vale para eles: mesma mecânica, mesmas armadilhas de especificidade e de valor inline.
> **Revisão 2 (v2 → v3, só o delta): 11 achados — 0 bloqueante, 3 médios, 8 leves — todos aplicados nesta v3.** Os que mudaram o escopo: o ícone do rail neutro (`.lrow-i` com `background:var(--surface-3)` inline) fica **invisível** no Paper em 5 pontos e agora é corrigido com uma classe (S1); o selo de e1RM não pode simplesmente adotar `--on-acc`, porque em 4 acentos isso **reprova AA** num texto de 12px — passa a ter uma regra própria (S2); o grupo de raios da v2 cobria 8 dos ~17 raios fixos do app (S3); e mais 8 ajustes de precisão (S4–S11). Tabela no anexo.

---

## Contexto e Objetivo

Hoje o usuário escolhe **uma cor** e o app é sempre o mesmo app: mesma forma, mesma tipografia, mesmo canto. A proposta de identidade visual apresentada em 20/09/2026 mostrou quatro direções completas (Grind, Paper, Pulse, Sage), todas construídas sobre as variáveis que o app já tem — nenhuma delas exige tocar em componente.

**Objetivo:** transformar "aparência" em duas camadas. A camada de baixo é o **estilo** (um visual inteiro: cor, forma, tipografia, densidade), escolhido numa linha nova de Settings. A camada de cima são os ajustes finos que só fazem sentido enquanto o estilo não manda neles — hoje **Theme** e **Accent color**, que somem quando o estilo escolhido fixa o modo ou traz a própria cor. Nesta entrega entra **um** estilo novo, o **Paper** (papel quente, serifas, réguas de impressão, vinho no dado); o mecanismo fica pronto para receber Grind, Pulse e Sage sem nova estrutura.

**Por que o controle some em vez de ficar desabilitado:** escolher Paper e ainda ver oito amostras de cor que não pintam nada é pior que não ver nada — o usuário tocaria, nada aconteceria e ele concluiria que o app quebrou. O que a tela deve ao usuário é a explicação, não o controle morto (RF-5).

---

## Escopo

**Inclui**

- linha **Style** na seção *Appearance* de Settings, acima de **Theme**, abrindo uma folha com um item por estilo (nome + uma linha de descrição + `check` no atual);
- o estado `S.skin` (`'classic'` | `'paper'`), com default `'classic'`, gravado no `localStorage` e sincronizado no `PUT /api/data` como `theme` e `accent` já são;
- `data-skin` no `<html>`, escrito pelo mesmo `applyPrefs`;
- o bloco de CSS do estilo Paper no fim de `index.css` (tokens + regras de componente) — **bloco novo**; nenhuma regra existente é alterada;
- **uma** regra nova na parte não-skin do `index.css` (`.badge-acc{color:#000}`, §5.1) — ela existe para preservar exatamente o Classic de hoje e dar ao estilo um gancho para o texto do selo;
- **Theme** e **Accent color** escondidos quando o estilo ativo fixa o modo (`mode`) ou traz a própria cor (`ownAccent`) — no Paper, os dois;
- a nota de rodapé da seção, vinda do próprio estilo (campo `note`), explicando o que sumiu e por quê;
- o `theme-color` do navegador acompanhando o estilo;
- **correções de legibilidade que o Paper tornaria permanentes** (todas com o Classic preservado byte a byte):
  - o selo de e1RM em `views/Stats.jsx:168` ganha a classe `badge-acc` (§4.4);
  - o rail de ícone **neutro** (fundo `--surface-3`) em 5 pontos ganha a classe `flat` (§4.5);
  - 8 raios escritos inline no JSX passam a `var(--r-sm)` (§4.6);
- ícone novo `palette` no `Icon.jsx`;
- as quatro strings novas no `pt.js`.

**Não inclui**

- os estilos **Grind**, **Pulse** e **Sage** (o mecanismo fica pronto; cada um é um bloco de CSS + uma entrada no mapa, depois);
- um **Paper escuro**: por decisão do usuário (D1), o estilo manda no modo — Paper é claro e ponto;
- **traduzir para os outros dez idiomas**: o `pt.js` está especificado aqui; sem tradução o inglês aparece e nada quebra. É uma passada de tradução, não código;
- miniatura/preview visual de cada estilo na folha de escolha (só nome + descrição nesta entrega);
- **um** raio inline que fica de fora de propósito: o `.tag` de percentual em `views/Home.jsx:145` (`borderRadius: 99`, uma pílula) — convertê-lo mudaria a forma no Classic;
- mudar qualquer outro comportamento do app: nenhum outro arquivo JS lê o estilo (RF-9);
- tocar em `api/server.js`: `checkState` (`api/server.js:66-89`) é deliberadamente frouxo e deixa campo desconhecido passar;
- `manifest.json` e o `<meta name="theme-color">` **estático** do `index.html` (`#0c0e12`): o splash do PWA e a barra antes do primeiro render continuam escuros, como já acontece hoje no Light (ver Riscos);
- ícone do app, splash e nome do produto.

---

## Decisões do usuário

- **D1 — o estilo manda no modo (respondida em 20/09/2026).** Pergunta: *"o estilo Paper é claro por natureza; se a pessoa escolher Paper e depois tocar em Dark, o que acontece?"* Resposta: **A) o estilo manda** — escolhendo Paper o app fica claro e o controle de claro/escuro some junto com o de cor; voltando para Classic, os dois reaparecem como estavam. Consequência de projeto: o Paper **não** ganha variante escura nesta entrega, e o valor de `S.theme` fica guardado, intocado, para quando o usuário voltar ao Classic (RF-6).

## Decisões assumidas

Decididas por mim porque são detalhe de implementação ou consequência direta de D1 — nenhuma muda o que o usuário vê além do que já está descrito nos RF.

- **A1 — `S.skin` é o nome do campo**, com os valores `'classic'` e `'paper'`. Um mapa `SKINS` em `lib/format.js`, ao lado do `ACCENTS` que já vive lá, descreve cada estilo. Efeito visível: nenhum; é o que permite adicionar os outros três estilos depois sem mexer em tela.
- **A2 — o estilo é sincronizado com o perfil**, igual a `theme` e `accent`. Efeito visível: trocar o estilo no celular muda também no tablet, como já acontece com a cor.
- **A3 — o estilo ativo não apaga a cor escolhida.** `S.accent` continua no estado enquanto o Paper está ligado; voltando ao Classic, a cor anterior reaparece. Efeito visível: nada se perde por experimentar.
- **A4 — `data-accent` é removido do `<html>` quando o estilo traz a própria cor, e isso é obrigatório — não é preferência de estilo de código.** `:root[data-theme="light"][data-accent="lime"]{--on-acc:#000}` (`index.css:101-106`) tem especificidade **(0,3,0)** e vence `:root[data-skin="paper"]{…}` **(0,2,0)** independentemente da ordem no arquivo. Com o atributo presente, o texto creme dos botões do Paper viraria **preto** nos acentos lime/teal. Efeito visível: nenhum no uso normal; é o que impede o vinho de sair com texto preto.
- **A5 — o bloco do estilo vai no **fim** de `index.css`.** Isso resolve os empates de especificidade com as regras de tema claro (`:root[data-theme="light"] …`, todas (0,2,0) ou (1,2,0)) — mas **não** resolve tudo, e por isso o bloco **repete os estados interativos** que ele mesmo encobre (R1) e usa `#app` onde o app usa `#app` (R2). Ordem não é argumento contra especificidade.
- **A6 — o Paper aproveita o modo claro que já existe.** Como o modo efetivo vira `light`, todas as regras `:root[data-theme="light"]` continuam valendo (busca, folha, gráficos) e o bloco do Paper só refina o que é identidade. Efeito visível: nenhuma tela fica sem tratamento no estilo novo.
- **A7 — a resolução do que vai para o `<html>` é uma função pura** (`resolveSkin`, em `lib/format.js`) e `applyPrefs` só escreve no DOM. É o que permite testar a regra sem navegador (teste em §8).
- **A8 — o valor inválido de estilo nunca é corrigido no estado; o fallback acontece na tela e no DOM.** O `loadState` só avisa no console; quem resolve é `skinOf` (na tela) e `resolveSkin` (no `<html>`). Efeito visível: um backup vindo de uma versão futura (com `'grind'`) abre no visual de sempre, e a escolha gravada por uma versão mais nova não é apagada por uma aba velha.
- **A9 — o nome dos estilos não é traduzido** (`Classic`, `Paper` são nomes próprios, como os nomes de idioma na linha *Language*, que também não passam por `t()` — `Settings.jsx:106-107`). O que é traduzido é o rótulo da linha, as descrições e a nota do rodapé.
- **A10 — a seção ganha uma linha de rodapé em vez de um controle desabilitado.** Quando os controles somem, o rodapé diz por quê; a nota "synced with your profile" continua, na mesma linha, quando ela existe.
- **A11 — ícone novo `palette`** desenhado nas convenções do arquivo (24×24, área viva 3…21, só traço, pontas arredondadas). Alternativa mais barata, se o desenho não agradar: reusar `sparkles` (troca de uma palavra na linha do `SelectRow`).
- **A12 — o selo de e1RM ganha uma classe própria (`badge-acc`) em vez de trocar a cor inline.** A v2 adotava `var(--on-acc)` direto, e a revisão mostrou o custo: num texto de **12px/800** a régua do WCAG é 4,5:1, e `--on-acc` branco sobre sky/violet/pink/red dá 3,4–4,1:1 — reprovaria AA em quatro acentos que hoje passam (5,8–6,2:1 com o preto). Com a classe, o Classic fica **byte a byte** como está (regra base `color:#000`) e só o Paper pinta o texto com `--on-acc` (creme sobre vinho, 6,6:1). Efeito visível: nenhum no Classic; no Paper o selo fica legível.
- **A13 — a lista de treinos do Paper fica em uma coluna também no desktop.** O app vira grade de duas colunas em telas ≥1000px (`index.css:905`, dentro de `@media`), e uma linha com régua embaixo não se lê em duas colunas. Efeito visível: quem usa o app no computador vê a lista de treinos em coluna única quando o estilo é Paper.
- **A14 — 8 raios inline passam a `var(--r-sm)`.** Cinco deles valem exatamente 8px hoje, que é o `--r-sm` do Classic: a troca é invisível lá e vira 2px no Paper. Três valem 9px/7px (`Workout.jsx:33`, `RoutineEdit.jsx:116-117`) e mudam **1px** no Classic — imperceptível, e é o preço de não deixar quadrado-redondo convivendo. O `.tag` de `Home.jsx:145` (pílula de 99px) fica de fora: ali a mudança seria de forma, não de 1px.
- **A15 — os dois cards que já pedem `borderColor: var(--acc)` inline (`Workout.jsx:29`, `Admin.jsx:126`) ganham contorno de acento no Paper.** Hoje esse `borderColor` é inerte (o `.card` não tem `border`); a regra nova de contorno o acende. É a intenção que o código já declarava, e passa a valer só no estilo que usa contorno — no Classic os dois continuam sem contorno. Efeito visível: no Paper, o card do treino em andamento sai com contorno vinho em vez de `--sep`.
- **A16 — número não entra na serifa.** `.stat-v` fica de fora do grupo serifado (S9): a Georgia tem algarismos old-style, e os números de 26px do card *Effort* ficariam com alturas desiguais — o `tabular-nums` que o app herda não conserta, porque a Georgia não tem `tnum`. Números seguem na sans com algarismos tabulares, alinhados com o `.tile .v`, que é o mesmo desenho. Efeito visível: o estilo tem serifa em título e sans em número.
- **A17 — a folha ganha régua no topo no Paper** (S11). O comentário da v2 falava de "folha sem vidro fosco", mas o `backdrop-filter` que existe é o do `.mback` (o fundo escurecido), que continua; a régua de 1px em cima da folha é o que a identidade pede e o que o teste passa a conferir.

---

## Requisitos Funcionais

**RF-1.** A seção *Appearance* de Settings passa a ter, como primeiro item, uma linha **Style** (`icon="palette"`), que mostra o nome do estilo ativo e abre uma folha com uma opção por estilo do mapa, cada uma com nome e descrição, e `check` na ativa. Tocar numa opção fecha a folha e aplica o estilo.

**RF-2.** O estilo escolhido é gravado em `S.skin` e sobrevive a: recarregar a página, trocar de aba, fechar e reabrir o app, e entrar na mesma conta em outro aparelho (mesma via de `theme`/`accent`: `localStorage` + `PUT /api/data`, com o push de 1,5 s do `persist`).

**RF-3.** Com o estilo **Classic** ativo, a seção *Appearance* é a de hoje **mais a linha Style**: o `Segmented` Dark/Light e as oito amostras **Accent color** continuam lá, funcionando.

**RF-4.** Com o estilo **Paper** ativo: o `<html>` recebe `data-skin="paper"`; o modo efetivo é `light` **mesmo que `S.theme` seja `'dark'`**; a linha **Theme** e a linha **Accent color** não são renderizadas; a linha **Body diagram** continua.

**RF-5.** A seção *Appearance* mostra a **nota do estilo ativo** (campo `note` do mapa, traduzida) como rodapé sempre que esse campo existir; é a nota que diz o que o estilo fixa e por que aqueles controles estão escondidos. Todo estilo com `mode` ou `ownAccent` **tem** nota (garantido por teste, §8.1); o Classic não tem, e o rodapé volta a ser só a linha de sincronia.

**RF-6.** Voltar para o estilo **Classic** devolve a tela ao estado de RF-3 **com os valores anteriores**: `S.theme` e `S.accent` nunca são reescritos por causa da troca de estilo. Se o usuário estava em Dark + teal antes de escolher Paper, é Dark + teal que ele vê ao voltar.

**RF-7.** Um valor de estilo que não existe no mapa — vindo de um backup, de um `localStorage` editado à mão ou de um estado gravado por uma versão futura — resolve para `classic` **na tela e no `<html>`**, sem erro e sem tela quebrada. O valor cru **não** é corrigido no estado nem no `localStorage` (A8): o `loadState` apenas registra um aviso no console.

**RF-8.** O `content` do `<meta name="theme-color">` passa a sair do estilo ativo: no Classic, `#000000` no escuro e `#f2f2f7` no claro (como hoje); no Paper, `#f4f0e6`. O valor **estático** do `index.html` (`#0c0e12`) e o do `manifest.json` não são tocados (ver Riscos).

**RF-9.** Nenhum outro arquivo **JavaScript** lê `S.skin`. Os únicos que conhecem o conceito são `lib/format.js` (o mapa e a função pura), `App.jsx` (aplicar no `<html>`), `views/Settings.jsx` (a linha) e `store/useStore.js` (default e aviso na leitura) — mais o `index.css` (o bloco), o `Icon.jsx` (o ícone) e o `pt.js` (as strings), que são a pele em si.

**RF-10.** O estilo viaja com os dados: entra no **Export backup (JSON)** e volta no **Import backup**, e **Reset everything** devolve o app ao Classic (porque o reset recarrega o `DEF`).

**RF-11.** Adicionar um estilo novo depois (Grind, Pulse, Sage) não exige mexer em nenhum componente: é uma entrada no `SKINS` (com `label`, `mode`, `ownAccent`, `subtitle`, `note` e `chrome`) e um bloco `:root[data-skin="..."]` no CSS.

**RF-12.** A troca de estilo é imediata e sem recarregar: tocar na opção na folha fecha a folha e a tela inteira já está no estilo novo (mesmo caminho de `applyPrefs` que o Theme usa hoje).

**RF-13.** No estilo Paper, os controles continuam utilizáveis: o anel de foco dos campos de texto aparece, as linhas tocáveis das listas dão feedback de toque, e a hierarquia de tamanhos dos botões (`.btn`, `.btn.sm`, `.btn.xs`) não muda (R1, R21).

**RF-14.** No estilo Paper, nada fica ilegível: o ícone do rail **neutro** (fundo `--surface-3`) continua visível nos 5 pontos onde ele aparece, e o selo de e1RM continua legível — sem que nada disso mude no Classic (§4.4, §4.5).

---

## Detalhe de Implementação (nível código)

### 1. `frontend/src/lib/format.js` — o mapa dos estilos e a função pura

**1.1 — depois de `ACCENTS` (linha 47, hoje a última do arquivo), acrescentar:**

```js
// Um estilo é um visual inteiro — cor, forma, tipografia e densidade —, não uma cor. O mapa é a
// única lista de estilos que existe: a folha de Settings e o CSS leem daqui, então acrescentar
// Grind, Pulse ou Sage é uma entrada aqui e um bloco :root[data-skin="..."] no index.css.
//
//   mode       fixa o modo do estilo (Paper é claro por natureza); null = obedece ao Theme
//   ownAccent  o estilo traz a própria cor; o Accent color do usuário não pinta nada nele
//   chrome     cor da barra do navegador (<meta name="theme-color">) por modo
//   subtitle   descrição curta, mostrada na folha de escolha
//   note       o que a seção Appearance diz quando este estilo esconde controles (null = nada)
//
// subtitle e note são chaves de tradução: o inglês é a chave (lib/i18n.js) e quem traduz é a
// tela (t(sk.subtitle)). O mapa não guarda texto já traduzido para não depender do idioma.
// Todo estilo com `mode` ou `ownAccent` precisa de `note` — há teste para isso.
export const SKINS = {
  classic: {
    label: 'Classic', mode: null, ownAccent: false,
    subtitle: 'The look openGym has always had.',
    note: null,
    chrome: { dark: '#000000', light: '#f2f2f7' },
  },
  paper: {
    label: 'Paper', mode: 'light', ownAccent: true,
    subtitle: 'Warm paper, serifs and print rules.',
    note: 'Paper brings its own colours and light mode, so those controls are hidden.',
    chrome: { light: '#f4f0e6' },
  },
}

export const skinOf = k => SKINS[k] || SKINS.classic

// O que vai para o <html>, resolvido sem DOM (é o que o teste cobre). `accent: null` significa
// "o estilo manda na cor" — quem escreve o atributo é que decide remover `data-accent` (A4).
export function resolveSkin(skin, theme, accent) {
  const sk = skinOf(skin)
  const mode = sk.mode || (theme === 'light' ? 'light' : 'dark')
  return {
    skin: SKINS[skin] ? skin : 'classic',
    mode,
    accent: sk.ownAccent ? null : (ACCENTS[accent] ? accent : 'lime'),
    chrome: sk.chrome[mode] || (mode === 'light' ? '#f2f2f7' : '#000000'),
  }
}
```

> **Import circular: não há.** `format.js` já importa `{ dateLocale, t }` de `./i18n.js` na linha 2, e `i18n.js` só importa `react` — nenhum dos dois se importa de volta, e `SKINS`/`resolveSkin` não acrescentam dependência nenhuma.

### 2. `frontend/src/store/useStore.js` — default e aviso

**2.1 — `DEF` (linha 14-16), acrescentar `skin` junto de `theme`/`accent` (atenção ao `export`):**

```js
// ANTES
export const DEF = {
  unit: 'kg', restSec: 90, globalRestSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
```
```js
// DEPOIS
export const DEF = {
  unit: 'kg', restSec: 90, globalRestSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', skin: 'classic', body: 'male', targetW: null,
```

**2.2 — `loadState()` (função nas linhas 33-75), na linha 46.** O `Object.assign(clone(DEF), parsed)` já cobre o estado **sem** `skin` (recebe `'classic'` do `DEF`); o que falta é o valor **inválido**, que passaria adiante e só seria tratado na hora de pintar:

```js
// ANTES (linha 46)
      if(!isValidRest(state.globalRestSec)) state.globalRestSec = 90
```
```js
// DEPOIS
      if(!isValidRest(state.globalRestSec)) state.globalRestSec = 90
      // Estilo que não existe (backup de versão futura, JSON editado à mão) cai no Classic — mas o
      // valor cru NÃO é apagado daqui (A8): quem resolve é `skinOf` na tela e `resolveSkin` no
      // <html>, e sobrescrever aqui faria uma aba velha apagar a escolha de uma versão mais nova.
      if(state.skin != null && !SKINS[state.skin]) console.warn('[skin] desconhecido, usando classic:', state.skin)
```
com o import no topo (linha 3, junto do `localTZ` que já vem de lá):

```js
// ANTES
import { localTZ } from '../lib/format.js'
// DEPOIS
import { localTZ, SKINS } from '../lib/format.js'
```

**2.3 — nada mais muda no store.** Verificado no código: `persist()` (linha 109) grava o estado inteiro, então o `skin` entra sozinho; `pushState()` (222-228) manda o estado inteiro sanitizado e `checkState` (`api/server.js:66-89`) não tem whitelist; a mescla de 409 (247) e as duas pernas do `pullState` (297 e 309) usam `Object.assign(clone(DEF), <servidor>)` — o estilo vem do servidor quando existe e cai no `'classic'` do `DEF` quando não existe. É o mesmo comportamento de `theme`/`accent` hoje (última escrita vence), e não precisa de tratamento especial.

### 3. `frontend/src/App.jsx` — aplicar no elemento raiz

**3.1 — import (linha 6):**

```js
// ANTES
import { ACCENTS } from './lib/format.js'
// DEPOIS
import { resolveSkin } from './lib/format.js'
```
> `ACCENTS` deixa de ser usado neste arquivo (era só na linha 36); quem valida a cor agora é o `resolveSkin`. Nenhum outro uso fica órfão — `views/Settings.jsx:170` continua importando `ACCENTS` para as amostras.

**3.2 — `applyPrefs` (linha 33-39):**

```js
// ANTES
function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}
```
```js
// DEPOIS
function applyPrefs(theme, accent, skin) {
  const de = document.documentElement
  const r = resolveSkin(skin, theme, accent)
  de.dataset.skin = r.skin
  de.dataset.theme = r.mode
  // `null` = o estilo traz a própria cor. O atributo TEM de sair: com ele, o par
  // :root[data-theme="light"][data-accent="..."] (0,3,0) venceria o bloco do estilo (0,2,0)
  // e o texto creme dos botões sairia preto nos acentos lime/teal (A4).
  if (r.accent) de.dataset.accent = r.accent
  else delete de.dataset.accent
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = r.chrome
}
```

**3.3 — a chamada (linha 48):**

```js
// ANTES
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
// DEPOIS
  useEffect(() => { applyPrefs(S.theme, S.accent, S.skin) }, [S.theme, S.accent, S.skin])
```

### 4. `frontend/src/views/Settings.jsx` — a linha Style e o que some

**4.1 — import (linha 5):**

```js
// ANTES
import { ACCENTS, todayISO, localTZ } from '../lib/format.js'
// DEPOIS
import { ACCENTS, SKINS, skinOf, todayISO, localTZ } from '../lib/format.js'
```

**4.2 — dentro do componente, junto das outras derivadas (depois de `const wakeOK = wakeLockSupported()`, linha 25):**

```jsx
  // O estilo ativo decide o que a seção Appearance mostra. `skinOf` nunca devolve undefined —
  // um valor estranho vira o Classic, que é o que o applyPrefs também pinta (RF-7/A8).
  const skin = skinOf(S.skin)
  const skinNote = skin.note ? t(skin.note) : null
  // O rodapé da seção já dizia uma coisa (a sincronia com o perfil); a nota do estilo entra na
  // frente dela, na mesma linha, em vez de virar uma segunda linha cinza embaixo da lista.
  const appFooter = [skinNote, (DEMO || MOBILE) ? null : t('synced with your profile')].filter(Boolean).join(' ')
```

**4.3 — a seção *Appearance* (linha 149-177), inteira:**

```jsx
// ANTES
    <Section title={t('Appearance')} footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={S.theme === 'light' ? 'light' : 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Section>
```
```jsx
// DEPOIS
    <Section title={t('Appearance')} footer={appFooter || undefined}>
      {/* O estilo vem primeiro porque é a escolha que pode engolir as duas de baixo: um estilo
          que fixa o modo (Paper é claro) ou que traz a própria cor esconde o controle
          correspondente. Esconder é de propósito — um controle que não pinta nada faz o
          usuário concluir que o app quebrou (RF-4/RF-5). */}
      <SelectRow icon="palette" iconTint="var(--purple)" title={t('Style')}
        value={SKINS[S.skin] ? S.skin : 'classic'} sheetTitle={t('Style')}
        onChange={v => update(s => { s.skin = v })}
        options={Object.entries(SKINS).map(([k, sk]) => ({ value: k, label: sk.label, subtitle: t(sk.subtitle) }))} />
      {!skin.mode && <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={S.theme === 'light' ? 'light' : 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>}
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      {!skin.ownAccent && <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>}
    </Section>
```

> `SelectRow` já existe e faz exatamente o que a linha precisa (`components/ui.jsx:251-275`): renderiza uma `Row` com o valor atual à direita e abre uma folha com a lista, `check` no item ativo. Nada novo de componente nesta entrega.
> `ACCENTS` continua sendo importado porque as amostras continuam existindo no estilo Classic.

**4.4 — `frontend/src/views/Stats.jsx:168` (R4/S2), o selo de e1RM da análise do coach:**

```jsx
// ANTES
          <span style={{background:'var(--acc)',color:'#000',padding:'2px 8px',borderRadius:999,fontWeight:800,fontSize:12}}>{p.e1rm} kg</span>
```
```jsx
// DEPOIS
          <span className="badge-acc" style={{background:'var(--acc)',padding:'2px 8px',borderRadius:999,fontWeight:800,fontSize:12}}>{p.e1rm} kg</span>
```
e a regra base nova, junto das regras de badge (depois de `.pr`, `index.css:815-819`):

```css
/* Texto sobre o acento num selo pequeno. Existe como classe, e não inline, porque o estilo (skin)
   precisa poder trocar a cor: o preto é o certo nos acentos do Classic (5,8–6,2:1 num texto de
   12px), mas sobre o vinho do Paper ele dá 2,79:1 e quem manda ali é o --on-acc (6,6:1). */
.badge-acc{color:#000}
```

> É a única linha de JSX desta entrega fora de Settings e do §4.5, e o `borderRadius:999` fica como está de propósito: mudá-lo para um valor do estilo mudaria também o Classic (ver Riscos).

**4.5 — o rail de ícone neutro ganha a classe `flat` (S1).** Cinco pontos usam `.lrow-i` com `background: var(--surface-3)` inline — o ícone é `#fff` (`.lrow-i{color:#fff}`, `index.css:231`) e, sobre o `--surface-3` do Paper (`#e5dfd1`), fica **1,3:1: invisível**. A classe é o gancho para o estilo pintar o ícone; no Classic nada muda (não há regra base para `.flat`).

```jsx
// views/Home.jsx:93 — ANTES
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
// DEPOIS — o rail só é neutro quando não há treino em andamento nem rotina do dia
          <span className={'lrow-i' + (S.active || routine ? '' : ' flat')} style={{ background: S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
```

```jsx
// sheets.jsx:358, 786, 787 e 799 — ANTES
<span className="lrow-i" style={{ background: 'var(--surface-3)' }}>
// DEPOIS
<span className="lrow-i flat" style={{ background: 'var(--surface-3)' }}>
```

**4.6 — oito raios inline passam a `var(--r-sm)` (A14/S3).** Cinco valem 8px (o `--r-sm` do Classic, troca invisível); três valem 9px/7px e mudam 1px no Classic.

| arquivo:linha | ANTES | DEPOIS |
|---|---|---|
| `sheets.jsx:143` | `borderRadius: 8` | `borderRadius: 'var(--r-sm)'` |
| `sheets.jsx:947` | `borderRadius: 8` | `borderRadius: 'var(--r-sm)'` |
| `sheets.jsx:1186` | `borderRadius: 8` | `borderRadius: 'var(--r-sm)'` |
| `views/Admin.jsx:82` | `borderRadius: 8` | `borderRadius: 'var(--r-sm)'` |
| `views/RoutineEdit.jsx:114` | `borderRadius: 8` | `borderRadius: 'var(--r-sm)'` |
| `views/Workout.jsx:33` | `borderRadius: 9` | `borderRadius: 'var(--r-sm)'` (1px no Classic) |
| `views/RoutineEdit.jsx:116` | `borderRadius: 7` | `borderRadius: 'var(--r-sm)'` (1px no Classic) |
| `views/RoutineEdit.jsx:117` | `borderRadius: 7` | `borderRadius: 'var(--r-sm)'` (1px no Classic) |

> `views/Home.jsx:145` (`borderRadius: 99`, a pílula de percentual) fica de fora: ali a mudança seria de forma, não de 1px (está no "Não inclui").

### 5. `frontend/src/index.css` — a regra base nova e o bloco do Paper

**5.1 — a regra base (`.badge-acc`)** está em §4.4. Nenhuma outra regra existente é alterada.

**5.2 — o bloco do Paper (novo, no fim do arquivo).** Duas armadilhas que a v1 não via e que estão resolvidas aqui: (a) o prefixo `:root[data-skin="paper"]` **sobe a especificidade** de tudo que ele toca, então todo estado interativo que ele encobre é redeclarado dentro do bloco; (b) onde o app usa `#app`, o bloco também usa.

```css
/* ============================================================================
   SKINS — estilos de app inteiros (Settings › Appearance › Style)
   ----------------------------------------------------------------------------
   Um estilo não é uma cor: é forma, tipografia e densidade junto. O bloco fica
   no FIM do arquivo de propósito — as regras daqui empatam em especificidade com
   as do tema claro (:root[data-theme="light"] …) e é a ordem que decide o empate.

   Três regras de manutenção, aprendidas nas duas revisões desta spec:
   · `:root[data-skin="paper"] .x` é (0,3,0) e VENCE `.x:focus`/`.x:active` (0,2,0) —
     todo estado interativo que este bloco encobrir precisa ser redeclarado aqui;
   · onde o app usa id (`#app .list` na media query de desktop, (1,1,0)), o seletor
     daqui também precisa do id, senão a regra de desktop ganha;
   · onde o app escreve a cor/raio INLINE no JSX, nenhum seletor daqui alcança —
     nesses pontos a correção tem de ser uma classe (`.badge-acc`, `.lrow-i.flat`)
     ou um valor de variável no próprio JSX (§4.4–§4.6).

   Acrescentar Grind, Pulse ou Sage é um bloco como este e uma entrada no SKINS
   (lib/format.js). Nada mais.
   ========================================================================== */

/* ---- Paper — papel quente, serifa no título, régua de impressão no lugar da caixa ---- */
:root[data-skin="paper"]{
  --bg:#f4f0e6; --bg-el:#faf7f0; --surface:#fffdf8; --surface-2:#efeade; --surface-3:#e5dfd1;
  --label:#15130d; --label-2:rgba(21,19,13,.60); --label-3:rgba(21,19,13,.34); --label-4:rgba(21,19,13,.14);
  --sep:rgba(21,19,13,.17); --sep-op:rgba(21,19,13,.10);
  --acc:#9c2b2b; --acc-2:#7d1f1f; --on-acc:#fffdf8;
  --r-sm:2px; --r:3px; --r-lg:4px; --r-xl:6px; --r-card:3px;
  --pad:18px; --icon-stroke:1.6; --hair:1px;
}
/* Títulos em serifa, rótulo de seção em caixa-alta espaçada. A regra é essa e vale para a tela
   inteira: o que nomeia uma coisa é serifa; o que a classifica é rótulo. Número NÃO entra (A16):
   a Georgia tem algarismos old-style e o --stat-v de 26px ficaria com alturas desiguais. */
:root[data-skin="paper"] .hdr h1,
:root[data-skin="paper"] .card h2,
:root[data-skin="paper"] .sheet h3{font-family:Georgia,'Iowan Old Style','Times New Roman',serif;font-weight:600;letter-spacing:-.012em}
:root[data-skin="paper"] .card h2{font-size:15px;color:var(--label)}
:root[data-skin="paper"] .card h2 .dim,
:root[data-skin="paper"] .hdr .sub{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif}
:root[data-skin="paper"] .card h2 .dim{font-size:11px}
:root[data-skin="paper"] .hdr .sub{font-style:italic;font-size:14px}
:root[data-skin="paper"] h4.sec,
:root[data-skin="paper"] .sect-t{text-transform:uppercase;letter-spacing:.16em;font-size:10px;font-weight:600;color:var(--label-2)}
/* Caixa: contorno no lugar de sombra; a lista deixa de ser cartões soltos e vira linhas com régua. */
:root[data-skin="paper"] .card,
:root[data-skin="paper"] .sect-b,
:root[data-skin="paper"] .efftbl,
:root[data-skin="paper"] .tile{border:1px solid var(--sep)}
:root[data-skin="paper"] .list{gap:0}
/* com id de propósito: a media query de desktop do app (#app .list, (1,1,0)) vira grade de duas
   colunas e venceria o gap:0 — e uma linha com régua embaixo não se lê em duas colunas (A13) */
:root[data-skin="paper"] #app .list{display:flex;flex-direction:column;gap:0}
:root[data-skin="paper"] .item{background:transparent;border-radius:0;border-bottom:1px solid var(--sep);padding:11px 2px}
/* redeclarado: sem esta linha, o background:transparent de cima (0,3,0) mataria o :active do app */
:root[data-skin="paper"] .item:active{background:var(--surface-2)}
:root[data-skin="paper"] .item .tt{font-family:Georgia,'Iowan Old Style','Times New Roman',serif;font-size:16px}
:root[data-skin="paper"] .efftbl .hd{background:transparent;border-bottom:1px solid var(--sep)}
/* Controles: canto de 2px, segmented de contorno com o polegar em tinta. */
:root[data-skin="paper"] .btn{border-radius:2px}
:root[data-skin="paper"] .seg{border-radius:2px;background:transparent;box-shadow:inset 0 0 0 1px var(--sep)}
:root[data-skin="paper"] .seg-sel{background:var(--label);border-radius:1px;box-shadow:none}
:root[data-skin="paper"] .seg button.on{color:var(--surface);font-weight:600}
:root[data-skin="paper"] .chip{border-radius:2px;font-size:11.5px}
:root[data-skin="paper"] .tag{border-radius:2px}
:root[data-skin="paper"] .field,
:root[data-skin="paper"] .input,
:root[data-skin="paper"] .exnote{border-radius:var(--r);box-shadow:inset 0 0 0 1px var(--sep)}
/* redeclarado: o box-shadow de cima é (0,3,0) e engoliria o anel de foco do app (0,2,0) */
:root[data-skin="paper"] .field:focus,
:root[data-skin="paper"] .input:focus{box-shadow:inset 0 0 0 2px var(--acc)}
:root[data-skin="paper"] .sw{border-radius:2px}
:root[data-skin="paper"] .sw .knob{border-radius:1px}
/* Os raios que o app fixa fora das variáveis (R5/S3). Sem este grupo o estilo fica pela metade:
   o campo de busca ficaria 10px, o stepper 10px, a caixa de marcar redonda, o botão de ícone
   redondo, a amostra de cor redonda — cada um contradizendo o canto de 2px do resto. */
:root[data-skin="paper"] .iconbtn,
:root[data-skin="paper"] .iconbtn.mini,
:root[data-skin="paper"] .searchf .clear,
:root[data-skin="paper"] .chk,
:root[data-skin="paper"] .setrow .n,
:root[data-skin="paper"] .setrow .setgo,
:root[data-skin="paper"] .setrow .rm-sp,
:root[data-skin="paper"] .bw-pm,
:root[data-skin="paper"] .sld-knob{border-radius:3px}
:root[data-skin="paper"] .lrow-i,
:root[data-skin="paper"] .glyph-cell,
:root[data-skin="paper"] .wday,
:root[data-skin="paper"] .stp,
:root[data-skin="paper"] .timef,
:root[data-skin="paper"] .thumb{border-radius:var(--r-sm)}
:root[data-skin="paper"] .swatch,
:root[data-skin="paper"] .swatch.on::after{border-radius:2px}
:root[data-skin="paper"] .mchip{border-radius:2px}
:root[data-skin="paper"] .sld-track{border-radius:2px}
:root[data-skin="paper"] .pr{border-radius:2px}
:root[data-skin="paper"] #toast{border-radius:3px}
/* o rail neutro: o ícone é #fff por padrão e sumiria sobre o --surface-3 do papel (§4.5) */
:root[data-skin="paper"] .lrow-i.flat{color:var(--label-2)}
/* o selo de texto sobre o acento (§4.4) */
:root[data-skin="paper"] .badge-acc{color:var(--on-acc)}
/* Dado: barra de 3px sem ponta arredondada, célula de mapa quase quadrada. */
:root[data-skin="paper"] .mrow{padding:5px 0;border-bottom:1px solid var(--sep-op)}
:root[data-skin="paper"] .mrow .bar,
:root[data-skin="paper"] .mrow .bar i,
:root[data-skin="paper"] .wprog,
:root[data-skin="paper"] .wprog i{border-radius:0}
:root[data-skin="paper"] .mrow .bar{height:3px}
:root[data-skin="paper"] .hm-c{border-radius:1px}
:root[data-skin="paper"] .cal-d{border-radius:2px}
/* Barra de abas e folhas: sólidas, com régua, sem vidro fosco. */
:root[data-skin="paper"] #tabbar{background:var(--bg);border-top:1px solid var(--sep);backdrop-filter:none;-webkit-backdrop-filter:none}
:root[data-skin="paper"] #tabbar button{letter-spacing:.04em}
:root[data-skin="paper"] #tabbar button.start .cir,
:root[data-skin="paper"] #tabbar button.start.rec .cir::after{border-radius:3px}
:root[data-skin="paper"] .sheet{border-top:1px solid var(--sep)}
:root[data-skin="paper"] .sheet .grab{height:2px;border-radius:0}
:root[data-skin="paper"] .center{background:var(--surface)}
```

> **O que o bloco não toca, de propósito:** a paleta de status (`--blue`, `--red`, `--yellow`, `--orange`…). Ela é semântica, não marca — o amarelo do PR e o laranja do "não treinado" continuam os do modo claro, que é o que o usuário já vê hoje no Light. Trocar isso seria mudar o significado das cores junto com a pele.
> **O que herda sozinho:** busca (`:root[data-theme="light"] .searchf .field`), folha (`… .sheet{background:var(--bg)}`), mapa de calor, mapa muscular, gráficos e o timer do descanso — todos leem variáveis, e as variáveis já são as do Paper.
> **O que ficou fora por decisão:** `.thumb`/`.exmedia` continuam brancos (a mídia é foto de exercício, não papel — e já é assim no Light); o `.pr` do History continua amarelo (já é pouco contrastado no Light de hoje, não é regressão do Paper); o selo de e1RM mantém o raio de 999px (§4.4); o `.mback` mantém o `blur(2px)` (é o fundo escurecido da folha, não a folha — A17); e a pílula de `Home.jsx:145` fica como está.

### 6. `frontend/src/components/Icon.jsx` — o ícone `palette`

Acrescentar em `P`, junto dos ícones de interface, logo depois de `info` (**linha 120**; a 121 é o `}` que fecha o mapa):

```jsx
  // Paleta: a forma fechada com o vão do polegar e três pastilhas. Só traço, como o resto do
  // set — as pastilhas são círculos de contorno, não pontos cheios, para o ícone não ficar
  // mais pesado que os vizinhos na mesma linha de Settings.
  palette: <><path d="M12 3.6a8.4 8.4 0 0 0 0 16.8c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h1.5a3.3 3.3 0 0 0 3.3-3.3c0-3.9-3.4-7.4-7.6-7.4Z" /><circle cx="8.6" cy="11.4" r="1.1" /><circle cx="12" cy="8.4" r="1.1" /><circle cx="15.6" cy="11.4" r="1.1" /></>,
```

Conferência obrigatória ao implementar: renderizar a **18px** (o `font-size` de `.lrow-i`, `index.css:229`, numa caixa de 29×29) ao lado de `moon` e `figureStrength` na mesma seção, e confirmar que a área viva respeita 3…21 e que nenhum traço encosta na borda. A geometria foi traçada na revisão: o path fecha em (12, 3.6) e os extremos ficam em x 3,6…19,6 e y 3,6…20,4.
Se o desenho não agradar, a alternativa registrada em A11 é `sparkles` — troca de uma palavra na linha do `SelectRow`.

### 7. `frontend/src/locales/pt.js` — strings novas

Quatro strings de origem (inglês), no padrão do `lib/i18n.js` (a string inglesa é a chave e `t()` troca `{0}`, `{1}`… por argumentos):

| chave (inglês) | onde aparece |
|---|---|
| `Style` | título da linha e título da folha |
| `The look openGym has always had.` | descrição do Classic, na folha |
| `Warm paper, serifs and print rules.` | descrição do Paper, na folha |
| `Paper brings its own colours and light mode, so those controls are hidden.` | rodapé da seção, no estilo Paper |

`Classic` e `Paper` **não** entram nos pacotes (A9: são nomes próprios, como os nomes de idioma da linha *Language*). Nenhuma das quatro existe hoje em nenhum pacote (conferido — sem colisão).

Inserir no `pt.js` junto do bloco de Settings (perto da linha 374, onde estão `'Appearance'`, `'Theme'`, `'Accent color'`), no registro de português europeu do arquivo:

```js
  'Style': 'Estilo',
  'The look openGym has always had.': 'O visual de sempre do openGym.',
  'Warm paper, serifs and print rules.': 'Papel quente, serifas e réguas de impressão.',
  'Paper brings its own colours and light mode, so those controls are hidden.': 'O estilo Paper traz as suas próprias cores e o seu modo claro, por isso estes controlos estão escondidos.',
```

Os outros dez pacotes (`de`, `es`, `fr`, `hi`, `it`, `ko`, `pl`, `ru`, `tr`, `zh`) ficam para uma passada de tradução — está no "Não inclui" e nada quebra sem ela: a chave inglesa aparece no lugar.

### 8. Testes

**8.1 — arquivo novo `frontend/src/lib/skins.test.js`** (vitest, roda com `npm test` dentro de `frontend/`), cobrindo a função pura de A7 e a garantia de RF-5. O estilo do arquivo segue os 12 testes existentes em `src/lib/`:

```js
import { describe, it, expect } from 'vitest'
import { SKINS, skinOf, resolveSkin } from './format.js'

describe('resolveSkin', () => {
  it('classic obedece ao tema e mantem a cor escolhida', () => {
    expect(resolveSkin('classic', 'dark', 'teal')).toEqual({ skin: 'classic', mode: 'dark', accent: 'teal', chrome: '#000000' })
    expect(resolveSkin('classic', 'light', 'teal')).toEqual({ skin: 'classic', mode: 'light', accent: 'teal', chrome: '#f2f2f7' })
  })
  it('paper fixa o modo claro mesmo com theme dark e tira a cor do usuario', () => {
    expect(resolveSkin('paper', 'dark', 'teal')).toEqual({ skin: 'paper', mode: 'light', accent: null, chrome: '#f4f0e6' })
  })
  it('estilo desconhecido cai no classic (RF-7)', () => {
    expect(resolveSkin('grind', 'dark', 'teal')).toEqual(resolveSkin('classic', 'dark', 'teal'))
    expect(resolveSkin(undefined, 'dark', 'teal').skin).toBe('classic')
  })
  it('cor desconhecida cai no lime, como o applyPrefs fazia', () => {
    expect(resolveSkin('classic', 'dark', 'roxo').accent).toBe('lime')
  })
  it('todo estilo tem descricao, chrome do modo que fixa e nota quando esconde controle (RF-5)', () => {
    for (const [k, sk] of Object.entries(SKINS)) {
      expect(sk.subtitle, k).toBeTruthy()
      expect(sk.chrome[sk.mode || 'dark'], k).toBeTruthy()
      if (sk.mode || sk.ownAccent) expect(sk.note, k).toBeTruthy()
    }
    expect(skinOf('paper')).toBe(SKINS.paper)
  })
})
```

**8.2 — os 13 arquivos de teste existentes continuam verdes**, incluindo `frontend/src/store/useStore.test.js`, que faz asserções sobre o **texto** de `useStore.js` (conferido nas duas revisões: nenhuma delas quebra com a linha nova do `loadState` nem com o import de `SKINS`).

**8.3 — testes manuais (o que o teste automático não vê):**

1. `cd frontend && npm test` — 14 arquivos, verde.
2. `cd frontend && npm run build` — sem aviso de import não usado (`ACCENTS` fora do `App.jsx`).
3. Abrir o app, ir em **Settings › Appearance**: a linha **Style** aparece em cima, mostrando `Classic`.
4. Tocar em **Style** → a folha lista `Classic` (com check) e `Paper`, cada um com a descrição. Escolher **Paper**: a folha fecha, a tela inteira muda na hora, **Theme** e **Accent color** somem, **Body diagram** fica, e o rodapé passa a explicar o motivo.
5. Recarregar a página (F5): continua Paper, sem piscar em Classic.
6. Voltar em **Style** → **Classic**: o app volta ao escuro com a cor que estava escolhida antes (testar tendo deixado `teal` ou `gold`), e os dois controles reaparecem com o valor certo.
7. Com Paper ativo, conferir nas outras abas que a pele pegou: **Stats** (barras de 3px, heatmap quadrado, selo de e1RM com texto creme sobre vinho), **Home** (o rail de ícone do card de hoje continua visível — S1), **Workout** (timer do descanso, séries, stepper de canto reto, botão do set cronometrado quadrado), **Settings** (lista agrupada com contorno, folha com régua no topo), a barra de abas sólida com régua em cima, e **o anel de foco ao tocar num campo de texto** (R1) e **o feedback de toque nas linhas das folhas** (R1).
8. Abrir uma folha que use rail neutro (**Rest day**, **Back to weekly plan**, **novo exercício**) e conferir o ícone — é o defeito do S1.
9. Com Paper ativo e logado, conferir a barra do navegador no celular: cor `#f4f0e6`, não preta.
10. Logado em dois aparelhos: trocar o estilo num e abrir o outro — o estilo veio junto (como theme/accent).
11. Editar o `localStorage` (`gym_state_v1`) trocando `"skin":"classic"` por `"skin":"grind"` e recarregar: o app abre em Classic, com um aviso no console, sem tela branca (RF-7).
12. **Export backup** com Paper ativo → abrir o JSON e conferir `"skin": "paper"` → **Reset everything** → o app volta ao Classic.
13. Modo demo (sem login) e build mobile: a linha Style aparece e funciona; o rodapé mostra só a nota do estilo, sem a parte da sincronia.
14. Em tela larga (≥1000px) com Paper: a lista de treinos fica em **uma coluna** (A13) e o resto do layout de desktop continua igual.

---

## Comportamento Visual/UX

### Settings › Appearance — hoje

```
┌──────────────────────────────────────────┐
│ ‹   Settings                             │
│                                          │
│ APPEARANCE                               │
│ ┌──────────────────────────────────────┐ │
│ │ ☾  Theme              [ Dark | Light ]│ │
│ ├──────────────────────────────────────┤ │
│ │ ⬤  Body diagram       [ Male | Fem. ] │ │
│ ├──────────────────────────────────────┤ │
│ │ Accent color                          │ │
│ │ ● ● ● ● ● ● ● ●                       │ │
│ └──────────────────────────────────────┘ │
│ synced with your profile                 │
└──────────────────────────────────────────┘
```

### Settings › Appearance — com Style = Classic (novo item, resto igual)

```
┌──────────────────────────────────────────┐
│ APPEARANCE                               │
│ ┌──────────────────────────────────────┐ │
│ │ ◕  Style                  Classic  ›  │ │   ← novo, primeiro item
│ ├──────────────────────────────────────┤ │
│ │ ☾  Theme              [ Dark | Light ]│ │   ← continua
│ ├──────────────────────────────────────┤ │
│ │ ⬤  Body diagram       [ Male | Fem. ] │ │   ← continua
│ ├──────────────────────────────────────┤ │
│ │ Accent color                          │ │   ← continua
│ │ ● ● ● ● ● ● ● ●                       │ │
│ └──────────────────────────────────────┘ │
│ synced with your profile                 │
└──────────────────────────────────────────┘
```

### Settings › Appearance — com Style = Paper (Theme e Accent color somem)

```
┌──────────────────────────────────────────┐
│ APPEARANCE                               │
│ ┌──────────────────────────────────────┐ │
│ │ ◕  Style                    Paper  ›  │ │
│ ├──────────────────────────────────────┤ │
│ │ ⬤  Body diagram       [ Male | Fem. ] │ │   ← Theme sumiu
│ └──────────────────────────────────────┘ │   ← Accent color sumiu
│ Paper brings its own colours and light   │
│ mode, so those controls are hidden.      │
│ synced with your profile                 │
└──────────────────────────────────────────┘
```

### A folha do Style (toque na linha)

```
┌──────────────────────────────────────────┐
│                  ▁▁▁                     │
│ Style                                    │
│ ┌──────────────────────────────────────┐ │
│ │ Classic                          ✓   │ │
│ │ The look openGym has always had.     │ │
│ ├──────────────────────────────────────┤ │
│ │ Paper                                │ │
│ │ Warm paper, serifs and print rules.  │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### O app no Paper (a mesma tela de Stats)

```
┌──────────────────────────────────────────┐   papel #f4f0e6, tinta #15130d
│ Stats                              ⟲     │   H1 em serifa
│ Progress & history (itálico, sans)       │
│                                          │
│ RECENT WORKOUTS              All 307 ›   │   rótulo em caixa-alta espaçada
│ Legs 2                                   │   item sem caixa: linha + régua
│ Sun 20 Sept · 39 min · 8 sets · 9,480 kg │
│ ──────────────────────────────────────── │   1px rgba(21,19,13,.17)
│ Pull C · Shoulder 3D                     │
│ Sun 20 Sept · 55 min · 12 sets · 2,655 kg│
│ ──────────────────────────────────────── │
│ ┌──────────────────────────────────────┐ │   card = contorno, zero sombra
│ │ Muscle balance · by sets worked      │ │   título em serifa
│ │ [ Week | 30d | 90d | All ]           │ │   segmented de contorno, polegar tinta
│ │ Shoulders  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬  39.4 sets│ │   barra 3px, canto reto, vinho #9c2b2b
│ │ Upper back ▬▬▬▬▬              14.4 sets│ │
│ └──────────────────────────────────────┘ │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ Home  Plan  (◕)  Stats  Exercises    │ │   barra sólida, régua em cima, sem blur
└──────────────────────────────────────────┘
```

---

## Riscos e casos de borda

- **Piscada de estilo no boot.** `applyPrefs` roda num `useEffect`, depois do primeiro render — quem está no Paper vê um quadro em Classic antes de virar, e o `<meta name="theme-color">` estático do `index.html` (`#0c0e12`) vale até esse momento. **É o mesmo comportamento que o Theme já tem hoje** (mesma função, mesma ordem), e o `manifest.json` mantém `#0c0e12` no splash do PWA instalado (R19). Se incomodar, o conserto é um script inline no `index.html` lendo o `localStorage` antes do bundle — fica registrado como próximo passo, não como escopo.
- **Especificidade é a armadilha desta feature.** Qualquer regra nova no bloco do Paper que encubra um estado (`:focus`, `:active`, `:hover`) precisa redeclarar esse estado dentro do bloco, porque `:root[data-skin="paper"] .x` é (0,3,0) e vence `.x:focus` (0,2,0). A revisão 1 pegou dois casos (`.field:focus` e `.item:active`); ao acrescentar Grind, Pulse ou Sage, a mesma conferência vale.
- **Cor e raio escritos inline no JSX são inalcançáveis pelo CSS.** É a razão de existirem `.badge-acc` (§4.4) e `.lrow-i.flat` (§4.5), e a razão de o §4.6 trocar o valor no próprio JSX. Ao acrescentar um estilo novo, procurar `style={{` com cor ou raio antes de assumir que o bloco alcança o elemento.
- **Contraste no Paper** (recalculado na revisão): vinho `#9c2b2b` sobre papel `#f4f0e6` = **6,6:1** (AA para texto normal; não é AAA — AAA pediria 7:1). `--label-2` (60% de tinta) = **4,67:1** (AA). `--label-3` (34%, usado em rótulo de seção e legenda) = **2,16:1**, e hoje no Light ele é **1,71:1** — ou seja, o Paper melhora o que já existe, mas rótulo de seção continua sendo texto de baixo contraste por natureza (não é texto de leitura).
- **Selo de e1RM (S2).** A classe `badge-acc` existe justamente para não reprovar AA em quatro acentos do Classic: com `--on-acc` direto, o selo de 12px ficaria em 3,4–4,1:1 com sky/violet/pink/red. Se um dia o selo crescer para texto grande, a decisão pode ser revista.
- **Dois cards com contorno de acento no Paper (A15).** `Workout.jsx:29` e `Admin.jsx:126` já pediam `borderColor: var(--acc)` inline; a regra de contorno acende isso. É intencional e só acontece no estilo que usa contorno.
- **Duas abas com estilos diferentes.** O `localStorage` é compartilhado e o evento `storage` não é tratado hoje para `theme`/`accent`; o estilo herda o mesmo comportamento. A aba em foco manda na próxima escrita.
- **Conflito de sincronia (409).** A mescla adota o estado do servidor para `skin`, como faz para `theme`/`accent`. Trocar o estilo em dois aparelhos ao mesmo tempo termina com o valor do servidor — aceitável e igual ao que já acontece com a cor.
- **Exercício/GIF em fundo branco.** `.exmedia{background:#fff}` e `.thumb{background:#fff}` ficam brancos no meio do papel. É de propósito (a mídia é foto de exercício, não papel) e já é assim no Light.
- **Lista em duas colunas no desktop.** Com A13 o Paper força coluna única na lista de treinos em telas ≥1000px. É a única diferença de layout entre estilos, e é deliberada.
- **3 raios mudam 1px no Classic (A14).** `Workout.jsx:33` (9→8) e `RoutineEdit.jsx:116-117` (7→8). Imperceptível, mas é a única mudança desta entrega que toca o Classic fora da linha nova de Settings — junto com o §4.4/§4.5, que preservam o valor atual.
- **Ícone `palette`.** É o único desenho novo; se a geometria não fechar a 18px, o plano B é `sparkles` (A11). Não travar a entrega por causa disso.
- **Georgia não existe em todo aparelho.** No Android a pilha cai no `serif` genérico e o desenho da serifa muda; por isso o número ficou fora da serifa (A16) e a identidade não depende de métrica fina de fonte.
- **Tradução faltando.** Sem as quatro strings num pacote, a folha mistura idioma (aparece o inglês). O `pt.js` está especificado acima; os outros dez são uma passada de tradução.

---

## Anexo — achados da Revisão 1 (22: 1 bloqueante, 7 médios, 14 leves — aplicados na v2)

| ID | Sev. | Local | Problema | Como ficou |
|---|---|---|---|---|
| R1 | bloqueante | §5, `index.css:386` e `:346` | `:root[data-skin="paper"] .field` é (0,3,0) e vence `.field:focus` (0,2,0) → o anel de foco some no Paper; `… .item{background:transparent}` vence `.item:active` → as linhas tocáveis perdem o feedback de toque | Bloco redeclara `.field:focus`/`.input:focus` e `.item:active`; RF-13 e teste 7 cobrem |
| R2 | média | A5/§5 `.list{gap:0}` | `#app .list` (1,1,0, `@media min-width:1000px`, `index.css:905`) vence o `gap:0` do Paper mesmo com o bloco no fim | Seletor com id; virou A13 e teste 14 |
| R3 | média | A4/A5, `index.css:101-106` | A justificativa estava errada: o par tema+accent é (0,3,0) e vence o bloco (0,2,0) **independente da ordem**; apagar `data-accent` é obrigatório, não cosmético | A4 e A5 reescritas com a especificidade correta; comentário no `applyPrefs` |
| R4 | média | `views/Stats.jsx:168` | Selo de e1RM com `color:'#000'` fixo sobre `var(--acc)`: no Paper vira preto sobre vinho (2,79:1) | §4.4 — resolvido de forma diferente na v3 (ver S2) |
| R5 | média | §5 | Metade dos raios do app ficava fora do estilo (busca 10px, stepper 10px, checkbox redondo, `.iconbtn` redondo, `.thumb`, `.pr`, `#toast`, slider) | Grupo de raios ampliado na v3 (ver S3) |
| R6 | média | §2.2 + RF-7/A8 | Contradição: RF-7 dizia que o valor inválido era resolvido "ao ler o estado", mas o código de §2.2 só avisa no console | RF-7 e A8 reescritos: o estado guarda o valor cru, o fallback é na tela e no DOM |
| R7 | média | §4.2/RF-5/RF-11 | A frase do rodapé fixava "light mode", o que seria falso para um estilo escuro futuro (Grind) | A nota passou a ser **dado do estilo** (campo `note`), uma string por estilo |
| R8 | média | §2.1 | O ANTES/DEPOIS escrevia `const DEF = {` mas o arquivo tem `export const DEF = {` | Corrigido nas duas linhas |
| R9 | leve | §2.2/§4.3/§8.1/"Não inclui" | Números de linha errados: `loadState` é 33-75 (a linha alterada é a 46), a seção *Appearance* é 149-177, `SelectRow` é `ui.jsx:251-275`, `checkState` é `api/server.js:66-89` | Todos corrigidos |
| R10 | leve | §6 | `.lrow-i` é `font-size:18px` numa caixa 29×29 (19px é o `.btn .icn`) | Corrigido |
| R11 | leve | §1 nota final | A nota dizia "format.js não importa nada hoje" e deixava a pergunta do import circular sem resposta | Substituída pela resposta verificada: importa `{ dateLocale, t }` na linha 2 e **não há ciclo** |
| R12 | leve | §5 | `box-shadow:none` em `.card`/`.sect-b`/`.efftbl` era no-op, e `.sheet`/`.center` repetiam raio que `--r-xl`/`--r-lg` já dão no Paper | Declarações mortas removidas |
| R13 | leve | §5 × mock | O mock dizia "itálico, serifa" para `.hdr .sub`, mas a regra o põe em sans itálico | Mock corrigido para "itálico, sans" |
| R14 | leve | Riscos | Contrastes errados: vinho sobre papel é 6,6:1 (não 7,4 — esse é o creme sobre vinho — e é AA, não AAA); `--label-2` 4,67:1; `--label-3` 2,16:1 | Números recalculados e corrigidos |
| R15 | leve | §8/"Base medida" | São **13** arquivos de teste (12 em `src/lib` + `src/store/useStore.test.js`) | Citado no cabeçalho e em §8.2 |
| R16 | leve | §7/"Inclui" | O "Inclui" prometia as quatro strings nos 11 pacotes, mas só o `pt.js` era dado | "Inclui" passou a ser o `pt.js`; os outros dez foram para o "Não inclui" |
| R17 | leve | RF-9 | "Os únicos ficheiros que conhecem o conceito" era falso à letra (faltavam `index.css`, `Icon.jsx` e os locales) | Frase restrita a arquivos **JavaScript** |
| R18 | leve | RF-3 | "exatamente a de hoje" conflitava com RF-1 (a linha Style é nova) | "é a de hoje **mais a linha Style**" |
| R19 | leve | RF-8/`index.html:8`/`manifest.json:10` | O meta estático é `#0c0e12` (não `#000000`) e o manifest fica escuro | Registrado em RF-8 e nos Riscos |
| R20 | leve | §5 `#tabbar button.start .cir` | O `::after` do estado `.rec` (anel pulsante do treino a decorrer) continuava redondo | Incluído no mesmo seletor, com `border-radius:3px` |
| R21 | leve | §5 `.btn{font-size:14px}` | O `font-size` do bloco (0,3,0) achatava `.btn.sm` (15px) e `.btn.xs` (13px) | `font-size` removido da regra do Paper; virou RF-13 |
| R22 | leve | §6 | `info` é a linha 120 (a 121 é o `}` que fecha `P`) | Corrigido |

## Anexo — achados da Revisão 2 (11: 0 bloqueante, 3 médios, 8 leves — aplicados na v3)

| ID | Sev. | Local | Problema | Como ficou |
|---|---|---|---|---|
| S1 | média | `index.css:231` + `Home.jsx:93`, `sheets.jsx:358/786/787/799` | `.lrow-i{color:#fff}` sobre `background:var(--surface-3)` inline: no Paper o ícone fica **1,3:1 — invisível**, e o defeito seria permanente para quem escolhe o estilo | §4.5: classe `flat` nos 5 pontos (o do Home é condicional) + regra no bloco; RF-14 e teste 8 |
| S2 | média | A12/Riscos + `Stats.jsx:168` + `index.css:95-106` | Com `--on-acc`, no Classic com sky/violet/pink/red o selo de 12px/800 passaria de 5,8–6,2:1 para 3,4–4,1:1 — **reprova AA**; a justificativa citava a régua de 3:1, que é de texto grande | A12 reescrita: classe `.badge-acc` com regra base `color:#000` (Classic byte a byte) e `--on-acc` só no Paper |
| S3 | média | §5 grupo de raios + ~9 raios no CSS e 9 inline no JSX | O grupo cobria 8 raios; o app fixa outros ~9 no CSS (`.wday`, `.searchf .clear`, `.setrow .n`, `.setrow .setgo`, `.bw-pm`, `.glyph-cell`, `.mchip`, `.setrow .rm-sp`, `.iconbtn.mini`, `.swatch`) e 9 inline, que nenhum seletor alcança | Grupo ampliado (todos os do CSS) + §4.6 converte 8 raios inline para `var(--r-sm)`; a pílula de `Home.jsx:145` fica fora, no "Não inclui" |
| S4 | leve | §5 `.card{border:…}` + `Workout.jsx:29`, `Admin.jsx:126` | Os dois cards têm `borderColor:'var(--acc)'` inline, hoje inerte; a regra nova acende isso e cria uma diferença Classic×Paper não declarada | A15: declarado como intencional (é a intenção que o código já expressava) |
| S5 | leve | §5 `.card h2 .dim` | Os 3 únicos `.card h2 .dim` têm `textTransform`/`letterSpacing` inline, que vencem o bloco — a regra nascia meio morta | `text-transform`/`letter-spacing` removidos da regra; fica só o reset de família e o `font-size` |
| S6 | leve | §5 grupo de raios | `.ck` não casa com elemento nenhum (o checkbox vivo é `.chk`) | `.ck` fora do grupo; `.setrow .setgo` entrou |
| S7 | leve | §5 contorno | `.tile` ficava sem contorno, e sobre `--bg-el` ele é 1,05:1 — contra a regra que o próprio bloco adota | `.tile` entrou no grupo do contorno |
| S8 | leve | RF-5 × §4.2 | RF-5 dizia "quando tem `mode` ou `ownAccent`", §4.2 mostra "quando `note` existe"; um estilo futuro com `mode` e `note:null` ficaria mudo | RF-5 alinhada ao `note` + asserção nova no §8.1 (todo estilo que esconde controle tem nota) |
| S9 | leve | §5 `.stat-v` na serifa | Georgia tem algarismos old-style: os números de 26px ficariam com alturas desiguais (e `tabular-nums` não conserta); o `.tile .v`, idêntico, continuaria sans | A16: `.stat-v` fora do grupo serifado — número em sans tabular |
| S10 | leve | §5 `.sw .knob` | O knob com `background:var(--surface)` dava 1,3:1 sobre o trilho e ficava de duas cores com o `.sld-knob`, que é `#fff` | `background` removido; fica só o raio |
| S11 | leve | §5 comentário da folha + teste 7 | Nenhuma regra dava régua à folha, e o `blur` que existe é o do `.mback`, que continua — o comentário e o teste prometiam o que o bloco não fazia | A17: `.sheet{border-top:1px solid var(--sep)}` acrescentado, e o texto corrigido |
