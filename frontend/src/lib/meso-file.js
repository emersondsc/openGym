// frontend/src/lib/meso-file.js — arquivo de mesociclo: import (JSON/CSV) e export.
//
// O import valida FORMA, nunca conteúdo, e devolve sempre a mesma forma:
//   { mesos, notes, errors, refused, filename }
// `notes` é o que o resumo mostra (derivado, cortado, extras preservados, CSV é subconjunto),
// `errors` são recusas de arquivo inteiro e `refused` são os itens que ficaram de fora, nomeados.
//
// Regra que manda aqui: um arquivo mais rico que o nosso objeto entra inteiro. Campo que o app não
// conhece é preservado em qualquer nível (mesociclo, semana, regra) e volta no export.
import { parseCSV } from './import-csv.js'
import { normalizeMeso, buildWeeks, weeksFromRange, LIMITS } from './meso.js'

export const MAX_FILE_BYTES = 2 * 1024 * 1024     // teto do arquivo, conferido antes de ler

const norm = h => String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

// Cabeçalho conhecido → campo, com o rótulo primeiro (mesmo espírito do mapHeader do import-csv).
const COLS = [
  ['id', ['id', 'meso id']], ['name', ['name', 'nome', 'mesociclo']],
  ['start', ['start', 'inicio', 'comeca em', 'data inicio']], ['end', ['end', 'fim', 'termino']],
  ['goal', ['goal', 'objetivo']], ['origin', ['origin', 'origem']],
  ['priority_lower', ['priority lower', 'foco lower', 'prioridade lower']],
  ['priority_upper', ['priority upper', 'foco upper', 'prioridade upper']],
  ['evidence', ['evidence', 'evidencia', 'base evidencia']],
  ['week', ['week', 'semana', 'n']], ['phase', ['phase', 'fase']],
  ['week_start', ['week start', 'semana inicio', 'inicio da semana']],
  ['week_end', ['week end', 'semana fim', 'fim da semana']],
  ['plan', ['plan', 'planejado', 'planejamento']], ['log', ['log', 'registrado', 'registro']],
  ['rules', ['rules', 'regras']]
]

/**
 * `Rótulo=Texto` por linha dentro da célula → mapa, na ordem de leitura.
 * O separador canônico é a quebra de linha dentro da célula (o `parseCSV` lê campo entre aspas com
 * `\n` dentro), e é o que o export escreve: `|` e `;` colidiam com o separador de CSV que o Excel
 * em PT-BR usa e com texto real de regra. Os dois continuam aceitos na leitura, para arquivo
 * feito à mão. Não corta nada aqui: quem corta e anota é o `normalizeMeso`.
 */
export function parseRules(cell) {
  const out = {}
  const src = String(cell == null ? '' : cell)
  const sep = src.includes('\n') ? '\n' : src.includes('|') ? '|' : ';'
  for (const part of src.split(sep)) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}

/** Nota do parser → texto do resumo (o resumo não tem lógica própria de texto). */
export function noteText(note, t) {
  if (!note) return ''
  if (note.kind === 'derived') return t('{0} derived from {1}', note.field, note.from)
  if (note.kind === 'cut') {
    return t('{0} was trimmed to {1}', note.field + (note.week ? ' (week ' + note.week + ')' : ''), note.to)
  }
  if (note.kind === 'extras') return t('{0} extra fields kept: {1}', note.fields.length, note.fields.join(', '))
  if (note.kind === 'format') return t('CSV carries no coach log and no extra fields')
  return ''
}

/**
 * Lê o arquivo. Detecção por conteúdo, não por extensão: `{`/`[` é JSON, o resto é CSV.
 */
export function parseMesoFile(text, filename = '') {
  const notes = [], errors = [], mesos = [], refused = []
  const body = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim()
  if (!body) return { mesos, notes, errors: ['empty'], refused, filename }

  let raw = []
  if (body[0] === '{' || body[0] === '[') {
    let data
    try { data = JSON.parse(body) } catch { return { mesos, notes, errors: ['json'], refused, filename } }
    raw = Array.isArray(data) ? data : Array.isArray(data.mesos) ? data.mesos : [data]
  } else {
    raw = mesoFromCSV(body, notes, errors)
    if (!errors.length) notes.push({ kind: 'format', format: 'csv', loses: ['log', 'extras'] })
  }

  raw.forEach((r, i) => {
    const before = notes.length
    const m = normalizeMeso(r, notes)
    // Recusado não polui as notas dos que entraram, mas fica NOMEADO no resumo.
    if (!m) {
      notes.length = before
      refused.push({ index: i + 1, name: (r && typeof r === 'object' && r.name) || null })
      return
    }
    mesos.push(m)
  })
  if (refused.length) errors.push('refused')
  return { mesos, notes, errors, refused, filename }
}

/** CSV: uma linha por semana, campos do mesociclo lidos da primeira e valendo para todas. */
function mesoFromCSV(text, notes, errors) {
  // `;` como separador quando a primeira linha tem mais ponto-e-vírgula do que vírgula. A troca
  // respeita aspas: `;` dentro de campo entre aspas não é separador.
  const first = text.split(/\r?\n/, 1)[0] || ''
  const src = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length
    ? text.replace(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ',') : text
  const rows = parseCSV(src)
  if (!rows.length) { errors.push('csv'); return [] }

  const head = rows[0].map(norm)
  const idx = {}
  const unknown = []
  head.forEach((h, i) => {
    const hit = COLS.find(([, names]) => names.includes(h))
    if (hit) { if (idx[hit[0]] === undefined) idx[hit[0]] = i } else if (h) unknown.push([h, i])
  })
  if (idx.name === undefined || idx.start === undefined) { errors.push('no-core'); return [] }

  const data = rows.slice(1)
  const firstCell = k => (idx[k] === undefined || !data.length ? '' : String(data[0][idx[k]] == null ? '' : data[0][idx[k]]).trim())
  // "Meso magro": nenhuma linha de semana de verdade. Uma linha só com nome/objetivo é o caso
  // comum de planilha — as semanas saem de start..end (ou do padrão de 4), não daquela linha.
  const hasWeekCols = ['week', 'phase', 'plan', 'log', 'week_start', 'week_end'].some(k => idx[k] !== undefined)
  const bare = !data.length || (data.length === 1 && !hasWeekCols)

  const meso = {
    name: firstCell('name'), start: firstCell('start'), goal: firstCell('goal'),
    origin: firstCell('origin') || 'user',
    weeks: bare ? [] : data.map((r, i) => {
      const cell = k => (idx[k] === undefined ? '' : String(r[idx[k]] == null ? '' : r[idx[k]]).trim())
      const w = { n: Number(cell('week')) || i + 1 }
      if (cell('phase')) w.phase = cell('phase')
      if (cell('week_start')) w.start = cell('week_start')      // semana de 6 ou 9 dias sobrevive
      if (cell('week_end')) w.end = cell('week_end')
      if (cell('plan')) w.plan = cell('plan')
      if (cell('log')) w.log = cell('log')
      for (const [k, i2] of unknown) {                          // coluna desconhecida → extra DA SEMANA
        const v = String(r[i2] == null ? '' : r[i2]).trim()
        if (v) w[k] = v
      }
      return w
    })
  }
  for (const k of ['id', 'end']) if (firstCell(k)) meso[k] = firstCell(k)
  const pl = firstCell('priority_lower'), pu = firstCell('priority_upper')
  if (pl || pu) meso.priorities = { ...(pl ? { lower: pl } : {}), ...(pu ? { upper: pu } : {}) }
  const rules = parseRules(firstCell('rules'))
  if (Object.keys(rules).length) meso.rules = rules
  if (firstCell('evidence')) meso.evidence = firstCell('evidence')
  if (unknown.length) notes.push({ kind: 'extras', where: 'weeks', fields: unknown.map(([k]) => k) })
  if (bare) {                                                   // CSV de uma linha: mesociclo magro
    const end = meso.end && meso.end >= meso.start ? meso.end : null
    meso.weeks = end ? weeksFromRange(meso.start, end) : buildWeeks(meso.start, 4)
    notes.push({ kind: 'derived', field: 'weeks', from: end ? 'start..end' : 'default', count: meso.weeks.length })
  }
  return [meso]
}

/** Serialização única: a visão crua, o export JSON e o "copiar" usam esta função. */
export const mesoToJSON = meso => JSON.stringify(meso, null, 2)

/**
 * CSV declaradamente parcial: leva o núcleo, as semanas (com as datas, para a semana de 6 ou 9
 * dias sobreviver), objetivo, focos, evidência e regras. NÃO leva `log[]`, `activatedBy/At`,
 * `updatedAt` nem os extras do mesociclo — quem precisa de round-trip fiel usa JSON, e o resumo do
 * import diz isso quando o arquivo é CSV.
 */
export function mesoToCSV(meso) {
  const cols = ['id', 'name', 'start', 'end', 'goal', 'origin', 'priority_lower', 'priority_upper',
    'evidence', 'rules', 'week', 'week_start', 'week_end', 'phase', 'plan', 'log']
  // Uma regra por linha DENTRO da célula (entre aspas): `|` e `;` quebravam com texto real.
  const rules = Object.entries(meso.rules || {}).map(([k, v]) => `${k}=${v}`).join('\n')
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`
  const body = (meso.weeks || []).map((w, i) => [
    i === 0 ? meso.id : '', i === 0 ? meso.name : '', i === 0 ? meso.start : '', i === 0 ? meso.end : '',
    i === 0 ? (meso.goal || '') : '', i === 0 ? (meso.origin || '') : '',
    i === 0 ? (meso.priorities?.lower || '') : '', i === 0 ? (meso.priorities?.upper || '') : '',
    i === 0 ? (meso.evidence || '') : '', i === 0 ? rules : '',
    w.n, w.start || '', w.end || '', w.phase || '', w.plan || '', w.log || ''
  ].map(q).join(','))
  return [cols.join(','), ...body].join('\n') + '\n'
}

export const mesoFileName = (meso, ext) => `${meso.id}.${ext}`

/** Nomes de arquivo aceitos na importação (usado pelo `accept` do input). */
export const MESO_ACCEPT = 'application/json,.json,text/csv,.csv'
export { LIMITS }
