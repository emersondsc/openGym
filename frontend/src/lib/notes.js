// Tipos de nota (docs/specs/spec_tipos_de_nota.md). As regras moram aqui para a tela do treino,
// a edição de um treino terminado, o editor da rotina, os detalhes do exercício e a folha da nota
// usarem a mesma régua — e a API confere o mesmo limite em checkState (badNote).
//
// Três lugares, todos opcionais:
//   exercise → S.exNotes[exId]                 (aparece em todo treino com esse exercício)
//   routine  → S.routines[r].ex[i].note        (esse exercício nessa rotina)
//   workout  → entry.note (treino ativo ou terminado; só aquele treino)
//
// Cada nota é string sem espaços nas pontas, de 1 a NOTE_MAX caracteres contados em pontos de
// código (um emoji conta 1, como o usuário vê). Vazio = a chave sai, nunca fica gravada como "".

export const NOTE_MAX = 1000
export const NOTE_TYPES = ['exercise', 'routine', 'workout']

export const noteLength = text => [...String(text ?? '')].length

export function normalizeNote(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const cps = [...t]
  return cps.length > NOTE_MAX ? cps.slice(0, NOTE_MAX).join('').trimEnd() : t
}

const str = v => (typeof v === 'string' && v ? v : null)

/** O exercício dentro da rotina, ou null (rotina apagada, treino livre, exercício trocado). */
export function routineExOf(S, routineId, exId) {
  if (!routineId) return null
  const r = (S.routines || []).find(x => x.id === routineId)
  return (r && Array.isArray(r.ex) && r.ex.find(e => e.id === exId)) || null
}

/** As três notas de um exercício: { exercise, routine, workout }, cada uma string ou null. */
export function notesOf(S, { exId, routineId, entry }) {
  return {
    exercise: str((S.exNotes || {})[exId]),
    routine: str(routineExOf(S, routineId, exId)?.note),
    workout: str(entry?.note),
  }
}

/**
 * Grava (ou apaga, com texto vazio) a nota de um tipo. Mutador: chame dentro de `update(s => …)`
 * passando o rascunho `st`. Para `workout`, `entry` tem de ser o objeto do próprio rascunho.
 * Devolve false quando não há onde gravar (rotina que não existe mais, por exemplo).
 */
export function applyNote(st, { exId, routineId, entry }, type, text) {
  const n = normalizeNote(text)
  if (type === 'exercise') {
    if (!st.exNotes || typeof st.exNotes !== 'object') st.exNotes = {}
    if (n) st.exNotes[exId] = n
    else delete st.exNotes[exId]
    return true
  }
  const target = type === 'routine' ? routineExOf(st, routineId, exId)
    : type === 'workout' ? entry : null
  if (!target) return false
  if (n) target.note = n
  else delete target.note
  return true
}

/** Cópia do exercício da rotina sem a nota: é o que vira `entry.target` num treino. */
export function withoutNote(cfg) {
  const { note: _n, ...rest } = cfg || {}
  return rest
}
