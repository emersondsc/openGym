// frontend/src/lib/meso.js — modelo do mesociclo (puro, testável sem DOM).
//
// O objeto guarda só o que o cálculo não sabe: "semana atual", "terminado" e "quantas semanas
// faltam" saem das datas. Campo que o app não conhece não é descartado — fica no objeto, aparece
// recolhido na tela (EXTRAS) e volta no export.
//
// As funções que normalizam recebem um array `notes` opcional e ANOTAM o que derivaram ou
// cortaram. Nada é reescrito em silêncio: o resumo do import mostra a lista, e o objeto que sai
// daqui é sempre um objeto que a API aceita — senão o `PUT /api/data` devolveria 400 e travaria
// treino, rotina e peso junto.

/** Teto de cada campo, num lugar só. Os números são os mesmos da tabela do §6 da spec. */
export const LIMITS = {
  name: 120, phase: 80, goal: 400, rules: 40, ruleKey: 40, ruleValue: 600, log: 200, weeks: 52,
  meso: 64 * 1024,      // bytes por mesociclo
  library: 40           // mesociclos na biblioteca
}

export const MESO_KNOWN = new Set([
  'id', 'name', 'start', 'end', 'goal', 'origin', 'priorities', 'rules',
  'weeks', 'evidence', 'log', 'activatedBy', 'activatedAt', 'updatedAt'
])

const ISO = /^\d{4}-\d{2}-\d{2}$/
/**
 * O id carrega a data de início e, quando aquele dia já tem um mesociclo, um sufixo curto
 * (`meso-2026-09-13-2`). Mesma regra do servidor (`api/meso.js`, `MESO_ID_RE`): se as duas
 * divergirem, o cliente normaliza um id que a API recusa — ou pior, reescreve um id com sufixo de
 * volta para a data e o mesociclo passa a SUBSTITUIR outro na biblioteca.
 */
export const MESO_ID_RE = /^meso-\d{4}-\d{2}-\d{2}(-[a-z0-9]{1,8})?$/
const DAY = 86400000
export const isISO = s => typeof s === 'string' && ISO.test(s)
const at = iso => new Date(iso + 'T12:00:00Z')
export const addDays = (iso, n) => new Date(at(iso).getTime() + n * DAY).toISOString().slice(0, 10)

/** Quantos dias a janela `start..end` cobre (inclusive). */
export const spanDays = (a, b) => Math.round((at(b) - at(a)) / DAY) + 1

/** Data ISO que existe no calendário (`2026-02-30` não é). */
export function realISO(s) {
  if (!isISO(s)) return false
  const d = new Date(s + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Bytes do objeto como ele vai para o estado (mesma conta da API). */
export const mesoBytes = m => new TextEncoder().encode(JSON.stringify(m)).length

/**
 * "Hoje" com fuso fixo. O app é usado em viagem e o mesociclo é planejado em America/Sao_Paulo:
 * se a semana atual dependesse do fuso do aparelho, o mesmo dia mostraria semanas diferentes em
 * aparelhos diferentes. O resto do app segue o fuso do aparelho — o mesociclo não.
 */
export function todayInMeso(tz = 'America/Sao_Paulo') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date())                              // en-CA já sai AAAA-MM-DD
  } catch { return new Date().toISOString().slice(0, 10) }
}

/** Fase padrão por posição: primeira calibração, última deload, o resto progressão. */
export const phaseFor = (n, total) => n === 1 ? 'calibração' : n === total ? 'deload' : 'progressão'

/** Semanas de 7 dias a partir de `start` — o caminho de derivação. */
export function buildWeeks(start, count) {
  const out = []
  for (let n = 1; n <= count; n++) {
    const s = addDays(start, (n - 1) * 7)
    out.push({ n, start: s, end: addDays(s, 6), phase: phaseFor(n, count) })
  }
  return out
}

/**
 * Semanas a partir de start..end quando o arquivo não traz nenhuma. Divide em semanas de 7 dias e
 * a última absorve a sobra (9 dias viram 7 + 2). Uma semana de 9 dias inteira só existe quando o
 * arquivo a declara — é o caso da S4 do mesociclo real.
 */
export function weeksFromRange(start, end) {
  const days = spanDays(start, end)
  if (!(realISO(start) && realISO(end)) || !(days >= 1) || days > 366) return []
  const count = Math.max(1, Math.min(LIMITS.weeks, Math.ceil(days / 7)))
  const out = buildWeeks(start, count)
  out[out.length - 1].end = end
  return out
}

/** Desloca todas as semanas por `delta` dias, preservando fase, planejado, registrado e extras. */
export function shiftWeeks(weeks, delta) {
  return (weeks || []).map(w => ({
    ...w,
    ...(isISO(w.start) ? { start: addDays(w.start, delta) } : {}),
    ...(isISO(w.end) ? { end: addDays(w.end, delta) } : {})
  }))
}

/** Semanas com start/end resolvidos: o que veio manda, o que falta é derivado. */
export function resolveWeeks(meso) {
  const list = Array.isArray(meso.weeks) ? meso.weeks : []
  const total = list.length || 1
  return list.map((w, i) => {
    const n = Number.isInteger(w.n) ? w.n : i + 1
    const start = isISO(w.start) ? w.start : addDays(meso.start, (n - 1) * 7)
    const end = isISO(w.end) ? w.end : addDays(start, 6)
    // A fase NÃO é cortada aqui de propósito: quem corta é o `normalizeMeso`, que anota o corte.
    // Cortar nos dois lugares faria o corte acontecer sem ninguém contar.
    const phase = String(w.phase == null ? phaseFor(n, total) : w.phase)
    return { ...w, n, start, end, phase }
  }).sort((a, b) => a.n - b.n)
}

/**
 * Normaliza o que veio de fora (arquivo, servidor, formulário) e devolve null quando não há núcleo
 * aproveitável. Corta o que passa dos limites ANOTANDO cada corte e deriva o que falta.
 */
export function normalizeMeso(raw, notes = []) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!realISO(raw.start)) return null
  const start = raw.start
  const name = String(raw.name || '').trim()
  if (!name) return null

  if (name.length > LIMITS.name) notes.push({ kind: 'cut', field: 'name', to: LIMITS.name })
  if (raw.goal != null && String(raw.goal).length > LIMITS.goal) {
    notes.push({ kind: 'cut', field: 'goal', to: LIMITS.goal })
  }

  // Semanas: resolve as que vieram, deriva do intervalo quando não veio nenhuma, descarta as
  // incoerentes, renumera 1..N (a API exige sequência) e respeita o teto.
  let weeks = resolveWeeks({ ...raw, start })
    .filter(w => realISO(w.start) && realISO(w.end) && w.end >= w.start)
  if (!weeks.length) {
    if (!realISO(raw.end) || raw.end < start) return null
    weeks = weeksFromRange(start, raw.end)
    if (!weeks.length) return null
    notes.push({ kind: 'derived', field: 'weeks', from: 'start..end', count: weeks.length })
  }
  if (weeks.length > LIMITS.weeks) {
    weeks = weeks.slice(0, LIMITS.weeks)
    notes.push({ kind: 'cut', field: 'weeks', to: LIMITS.weeks })
  }
  weeks = weeks.map((w, i) => ({ ...w, n: i + 1 }))
  for (const w of weeks) {
    const phase = String(w.phase == null ? '' : w.phase)
    if (phase.length > LIMITS.phase) {
      notes.push({ kind: 'cut', field: 'phase', week: w.n, to: LIMITS.phase })
      w.phase = phase.slice(0, LIMITS.phase)
    }
  }
  if (!weeks.length) return null                       // sem semana não há mesociclo

  const id = MESO_ID_RE.test(raw.id) ? raw.id : 'meso-' + start
  if (id !== raw.id) notes.push({ kind: 'derived', field: 'id', from: 'start', value: id })
  const end = realISO(raw.end) && raw.end >= start ? raw.end : weeks[weeks.length - 1].end
  if (end !== raw.end) notes.push({ kind: 'derived', field: 'end', from: 'weeks', value: end })

  const out = {
    ...raw,                                   // extras primeiro: nada é descartado
    id, name: name.slice(0, LIMITS.name), start, end,
    origin: raw.origin === 'assistant' ? 'assistant' : 'user',
    weeks
  }
  if (out.goal != null) out.goal = String(out.goal).slice(0, LIMITS.goal)
  if (out.rules && typeof out.rules === 'object' && !Array.isArray(out.rules)) {
    const pairs = Object.entries(out.rules)
    if (pairs.length > LIMITS.rules) notes.push({ kind: 'cut', field: 'rules', to: LIMITS.rules })
    out.rules = Object.fromEntries(pairs.slice(0, LIMITS.rules).map(([k, v]) => {
      const key = String(k).trim().slice(0, LIMITS.ruleKey)
      const val = String(v)
      if (String(k).trim().length > LIMITS.ruleKey || val.length > LIMITS.ruleValue) {
        notes.push({ kind: 'cut', field: 'rules', label: key })
      }
      return [key, val.slice(0, LIMITS.ruleValue)]
    }))
  } else if (out.rules != null) delete out.rules
  if (Array.isArray(out.log)) {
    if (out.log.length > LIMITS.log) {
      out.log = out.log.slice(0, LIMITS.log)
      notes.push({ kind: 'cut', field: 'log', to: LIMITS.log })
    }
  } else if (out.log != null) delete out.log
  return out
}

/** Chaves que o app não conhece — o que a tela mostra em EXTRAS e o export devolve. */
export const extrasOf = o => Object.entries(o || {})
  .filter(([k]) => !MESO_KNOWN.has(k) && !k.startsWith('_'))

/** A semana que cobre a data (inclusive nas bordas), ou null. */
export const weekAt = (meso, iso) =>
  resolveWeeks(meso).find(w => iso >= w.start && iso <= w.end) || null

/** 'future' | 'current' | 'ended' — derivado, nunca gravado. */
export function mesoState(meso, today = todayInMeso()) {
  if (!meso) return null
  if (today < meso.start) return 'future'
  return today > meso.end ? 'ended' : 'current'
}

/**
 * Ativação, num lugar só. Usada pelo painel, pela lista, pela tela, pelo import e pelo "voltar ao
 * anterior". `by` é 'user' ou 'assistant' e vale pelo fato verificado, nunca por um campo que o
 * corpo declarou.
 */
export function activateMesoState(S, id, by = 'user') {
  const m = (S.mesos || []).find(x => x.id === id)
  if (!m || S.activeMeso === id) return false
  S.mesoPrev = S.activeMeso || null
  S.activeMeso = id
  m.activatedBy = by
  m.activatedAt = new Date().toISOString()
  return true
}

/**
 * Mescla da biblioteca nos dois caminhos de conflito do store: o servidor manda nos ids que ele
 * tem, o que só existe neste aparelho é preservado. Sem livro-caixa e sem desempate por relógio —
 * a API é overwrite total e quem coordena é o assistente, lendo antes de escrever.
 */
export function mergeMesos(srv, local) {
  const out = new Map((srv || []).map(m => [m.id, m]))
  for (const m of local || []) if (!out.has(m.id)) out.set(m.id, m)
  return [...out.values()]
}

/** Ponteiro de ativo coerente com a lista: id que não existe na biblioteca vira null. */
export function fixMesoPointers(S) {
  const ids = new Set((S.mesos || []).map(m => m.id))
  if (S.activeMeso && !ids.has(S.activeMeso)) S.activeMeso = null
  if (S.mesoPrev && !ids.has(S.mesoPrev)) S.mesoPrev = null
  return S
}

/**
 * Apagar um mesociclo da biblioteca, num lugar só (a folha "All" e o `⋯` da tela usam o mesmo).
 *
 * Apagar o ATIVO não promove o anterior: o app fica sem mesociclo em uso e a aba Plan volta ao
 * estado vazio. Promover outro seria uma ativação que ninguém pediu. Devolve o mesociclo removido
 * (o aviso usa o nome) ou null quando o id não existe — quem chama não inventa um toast de sucesso.
 */
export function removeMesoState(S, id) {
  const list = Array.isArray(S.mesos) ? S.mesos : []
  const i = list.findIndex(m => m.id === id)
  if (i < 0) return null
  const [gone] = list.splice(i, 1)
  fixMesoPointers(S)
  return gone
}

/**
 * Qual mesociclo mostrar quando a tela pergunta por um id: o do id, senão o ATIVO, senão o
 * primeiro da biblioteca, senão nenhum. Pura de propósito — a escolha é o que a visão crua e o
 * Plan Tools decidem, e isso entra no teste sem DOM.
 */
export function pickMeso(mesos, id, activeMeso) {
  const list = mesos || []
  return list.find(m => m.id === id) || list.find(m => m.id === activeMeso) || list[0] || null
}

/**
 * Id de um mesociclo NOVO a partir da data de início: `meso-<data>` quando está livre, senão
 * `meso-<data>-2`, `-3`… Criar dois mesociclos que começam no mesmo dia é legítimo (um teste, um
 * plano B), e antes disso o segundo **substituía** o primeiro em silêncio, porque o id é a chave
 * da biblioteca. O sufixo é o que o servidor aceita (`^meso-\d{4}-\d{2}-\d{2}(-[a-z0-9]{1,8})?$`).
 */
export function uniqueMesoId(mesos, start) {
  const taken = new Set((mesos || []).map(m => m.id))
  const base = 'meso-' + start
  if (!taken.has(base)) return base
  for (let n = 2; n <= 99; n++) {
    const id = base + '-' + n
    if (!taken.has(id)) return id
  }
  return base + '-' + Date.now().toString(36).slice(-4)   // 99 no mesmo dia: improvável, mas não trava
}
