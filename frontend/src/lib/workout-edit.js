// Edição de um treino JÁ FINALIZADO.
//
// Um treino é um registro, e o que ele alimenta é derivado: volume, recordes, o melhor peso de
// cada exercício e a ordem cronológica do histórico. Corrigir um número tem de recalcular tudo
// isso na MESMA escrita, ou o gráfico e a próxima prescrição passam a mentir.
//
// Tudo aqui é função pura — quem escreve no store é a tela, e o comportamento fica testável sem
// React (workout-edit.test.js). As funções de mescla, no fim do arquivo, também vivem aqui pelo
// mesmo motivo: dentro do store elas seriam fechamento, e o projeto testa store lendo o texto.
import { bestEntryFor, workoutVolume, repFloor } from './history.js'

const clone = o => JSON.parse(JSON.stringify(o))

// Chave ausente em vez de null — a mesma regra do resto do app (só o que foi registrado).
const cleanSet = s => {
  const o = {}
  for (const k in s) if (s[k] !== null && s[k] !== undefined) o[k] = s[k]
  return o
}

/* A forma da SÉRIE não é a forma da CONFIGURAÇÃO: `defaultConfig` devolve
   {sets, reps, weight, mode} — o que a rotina prescreve —, enquanto a série gravada é
   {w, r, done}, {sec, w, done} ou {min, speed, done}. Espalhar a configuração dentro da série
   grava chaves que nada lê e deixa a linha em branco.

   A série nova nasce da ÚLTIMA série quando existe e da prescrição do exercício quando não
   existe — a mesma ideia do `addSet` da tela de treino (Workout.jsx), com uma diferença de
   propósito: lá o modo reps começa em 0 mesmo com carga prescrita, e aqui começa na carga da
   prescrição, que é o número que o usuário acabou de ver na sessão.

   `wUnit` viaja junto: é o override de unidade por série que `unitOfSet` lê (units.js), e uma
   série acrescentada ao lado de um override tem de continuar sendo lida na mesma unidade. */
export const setShape = (mode, prev, cfg = {}) => {
  const carry = prev && prev.wUnit != null ? { wUnit: prev.wUnit } : {}
  if (mode === 'cardio') return { min: prev ? prev.min : (cfg.min || 20), speed: prev ? prev.speed : (cfg.speed || 8), done: false, ...carry }
  if (mode === 'time') return { sec: prev ? prev.sec : (cfg.sec || 45), w: prev ? (prev.w || 0) : (cfg.weight || 0), done: false, ...carry }
  return { w: prev ? (prev.w || 0) : (cfg.weight || 0), r: prev ? (prev.r || 0) : (repFloor(cfg.reps) || 10), done: false, ...carry }
}

// Compara séries CAMPO A CAMPO. `JSON.stringify` depende da ORDEM das chaves, e editar um valor
// (apagar e redigitar) reordena o objeto: um exercício intocado passaria a contar como "mexido" e
// perderia o `topW` confirmado à mão.
const SET_FIELDS = ['w', 'r', 'sec', 'min', 'speed', 'rir', 'rpe', 'wUnit', 'done']
const sameSets = (a, b) =>
  a.length === b.length && a.every((s, i) => SET_FIELDS.every(f => (s[f] ?? null) === (b[i][f] ?? null)))

/* O dia mudou: a HORA LOCAL do treino continua a mesma. Somar o delta em milissegundos parece
   equivalente e não é — atravessar um horário de verão vale 23h ou 25h, e um treino registrado
   00:30 voltaria para o dia anterior. A data é reconstruída campo a campo (`setFullYear` aplica
   ano, mês e dia de uma vez, então não há estouro de dia 31 para mês de 30). `end` pode faltar
   num treino importado, e aí só o que existe é deslocado. */
const sameLocalTimeOn = (ms, iso) => {
  const d = new Date(ms)
  const [y, m, day] = iso.split('-').map(Number)
  d.setFullYear(y, m - 1, day)
  return d.getTime()
}
export function shiftWorkoutDate(w, iso) {
  const out = { ...w, d: iso }
  if (Number.isFinite(w.start)) out.start = sameLocalTimeOn(w.start, iso)
  if (Number.isFinite(w.end)) out.end = sameLocalTimeOn(w.end, iso)
  return out
}

/* Ordem por data, com desempate pela HORA de início. `a.d < b.d ? -1 : 1` nunca devolve 0: o
   `sort` não tem como saber que dois treinos do mesmo dia são "iguais", e a ordem relativa deles
   fica por conta do algoritmo — e é essa ordem que `lastEntryFor` (de trás para frente, parando
   na primeira ocorrência) e `sessionsFor` (para a frente, acumulando, com o mais recente no fim)
   leem como cronologia. */
export const sortWorkouts = ws => [...ws].sort((a, b) =>
  a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0))

/* Aplica o rascunho sobre o histórico. Devolve `null` quando não há nada a salvar (treino
   inexistente ou nenhuma série marcada) — quem chama avisa e não escreve nada.

   O ALVO (a prescrição que a sessão carrega) não é editável aqui, por decisão de produto: o app
   julga cada sessão passada contra o alvo gravado nela (`readSession` → `sessionsFor` →
   `nextPrescription`) para decidir a carga da próxima vez. */
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
        // O resto da entrada é PRESERVADO: `deleteCustomEx` carimba `e.n` no histórico para o
        // treino antigo continuar legível, e remontar do zero apagaria o nome (o detalhe passaria
        // a mostrar o id cru, em definitivo).
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
  // passou de tudo o que veio antes. Mesmo critério do `doFinishWorkout` (sheets.jsx), com o
  // próprio treino fora do julgamento.
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
  // prescreve carga. Percorre a UNIÃO do que havia e do que ficou — um exercício removido, ou com
  // todas as séries desmarcadas, não pode continuar segurando um peso que não existe mais.
  const exWeights = { ...(S.exWeights || {}) }
  const ids = new Set([...before.entries.map(e => e.id), ...entries.map(e => e.id)])
  ids.forEach(exId => {
    const e = entries.find(x => x.id === exId)
    const oldE = beforeById.get(exId)
    const oldMx = Math.max(0, ...((oldE && oldE.sets) || []).filter(s => s.done).map(s => s.w || 0), (oldE && oldE.topW) || 0)
    const mx = e ? Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0), e.topW || 0) : 0
    const cur = exWeights[exId]
    if (mx > 0 && (!cur || mx > cur.w)) { exWeights[exId] = { w: mx, d: w.d, src: id }; return }
    if (!cur || mx >= cur.w) return
    // Desce só quando o valor guardado PODIA ter vindo deste treino. `src` responde isso com
    // exatidão; nos dados antigos, que não têm `src`, a prova é o valor guardado ser no máximo o
    // que este treino registrava — um peso confirmado à mão acima de tudo o que foi registrado
    // fica de fora, e é o que se quer.
    const fromHere = cur.src ? cur.src === id : cur.w <= oldMx
    if (!fromHere) return
    const best = bestEntryFor({ ...S, workouts }, exId)
    if (best.w > 0) exWeights[exId] = { w: best.w, d: best.d, src: best.src }
    else delete exWeights[exId]
  })

  return { workout: w, workouts, exWeights, touchedEx: [...ids] }
}

/* Apagar um treino também mexe no melhor peso registrado dos exercícios dele: com `src` no jogo,
   deixar a chave como está apontaria para um treino que não existe mais, e aquele exercício nunca
   mais teria o melhor peso corrigido para baixo. Vale para os DOIS caminhos de apagar (a tela de
   edição e o `Delete workout` do detalhe, que já existia). */
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

/* ------------------------------------------------------------------ mescla (RF-12) --
   Um treino editado tem o MESMO id de um que já está no servidor, e a mescla por id deixa a
   cópia do servidor vencer — é o que preserva o que o assistente escreveu. Para uma edição
   recém-feita isso descartaria o trabalho em silêncio, então o store guarda uma MARCA de edição
   recente e estas funções a respeitam.

   A marca vive no `localStorage` e é lida por TODAS as abas, mas cada aba tem o próprio store:
   sem o carimbo de conteúdo (`sig`), uma aba que nunca editou aprovaria a cópia velha dela e o
   push seguinte reverteria a edição no servidor. */
export const LOCAL_WIN_MS = 60000
export const sigOf = w => JSON.stringify([w.d, w.name, w.entries])
export const freshMark = (mark, now = Date.now()) =>
  (mark && mark.id && Number.isFinite(mark.at) && now - mark.at < LOCAL_WIN_MS ? mark : null)

const keepLocal = (x, mark) => !!mark && x.id === mark.id && sigOf(x) === mark.sig

export function mergeWorkouts(serverWs, localWs, mark) {
  const m = freshMark(mark)
  const byId = new Map()
  // Treino apagado agora não volta do servidor enquanto a marca valer.
  ;(serverWs || []).forEach(w => { if (m && m.deleted && w.id === m.id) return; byId.set(w.id, w) })
  ;(localWs || []).forEach(w => { if (!byId.has(w.id) || keepLocal(w, m)) byId.set(w.id, w) })
  const out = [...byId.values()]
  // A ordem do array É a cronologia que o app lê — mas a mescla só reordena quando a edição MEXEU
  // no dia. Fora isso vale a ordem do servidor: o histórico pode ter chegado em outra ordem, e
  // reordenar o que ninguém tocou mudaria a "última sessão" de exercícios sem relação com a
  // edição.
  return m && m.moved ? sortWorkouts(out) : out
}

// O `exWeights` é por EXERCÍCIO: a edição vence nos exercícios que ela MEXEU (a lista viaja na
// marca), inclusive quando o recálculo apagou a chave — que não pode ressuscitar do servidor.
export function mergeExWeights(serverEW, localEW, mark) {
  const out = { ...(serverEW || {}) }
  const m = freshMark(mark)
  if (!m) return out
  ;(m.ex || []).forEach(exId => {
    if (localEW && localEW[exId]) out[exId] = localEW[exId]
    else delete out[exId]
  })
  return out
}
