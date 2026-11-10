// Nota por série (spec_nota_por_serie.md). As regras moram aqui para a tela do treino, a
// edição de um treino terminado e a folha da nota usarem a mesma régua — e a API confere o
// mesmo limite em checkState.
//
// `note` é opcional na série: string sem espaços nas pontas, de 1 a NOTE_MAX caracteres
// contados em pontos de código (um emoji conta 1, como o usuário vê). Vazio = a chave sai,
// nunca fica gravada como "".

export const NOTE_MAX = 1000

export const noteLength = text => [...String(text ?? '')].length

export function normalizeNote(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const cps = [...t]
  return cps.length > NOTE_MAX ? cps.slice(0, NOTE_MAX).join('').trimEnd() : t
}

export function withNote(set, text) {
  const { note: _old, ...rest } = set || {}
  const n = normalizeNote(text)
  return n ? { ...rest, note: n } : rest
}

export const hasNote = set => typeof set?.note === 'string' && set.note.length > 0
