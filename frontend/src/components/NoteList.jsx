// Tipos de nota (docs/specs/spec_tipos_de_nota.md): a etiqueta "Nota" do exercício e as linhas
// das notas que existem, usadas pela tela do treino e pela edição de um treino terminado, para as
// duas telas não terem duas versões. Sem estado: quem chama passa as notas e o que abrir.
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

// Ordem fixa da lista e do seletor: do mais duradouro ao do dia.
export const NOTE_META = {
  exercise: { icon: 'pin', name: 'Pinned exercise note', edit: 'Edit pinned exercise note', desc: 'Shows every time you log this exercise.' },
  routine: { icon: 'clipboard', name: 'Pinned routine note', edit: 'Edit pinned routine note' },
  workout: { icon: 'note', name: 'Workout note', edit: 'Edit workout note', desc: 'Shows only in this workout.' },
}
export const NOTE_ORDER = ['exercise', 'routine', 'workout']

export function NoteChip({ onClick }) {
  return <button className="tag notechip nocap" onClick={onClick}><Icon name="note" />{t('Note')}</button>
}

/** Uma linha por nota existente; tocar abre a caixa já naquele tipo. */
export function NoteLines({ notes, onOpen, only = NOTE_ORDER, lines = 3 }) {
  const ks = only.filter(k => notes[k])
  if (!ks.length) return null
  return <div className="notelist">
    {ks.map(k => <button key={k} className="noteline" aria-label={t(NOTE_META[k].edit)}
      onClick={e => { e.stopPropagation(); onOpen(k) }}>
      <Icon name={NOTE_META[k].icon} />
      <span className="nl-t" style={{ WebkitLineClamp: lines }}>{notes[k]}</span>
    </button>)}
  </div>
}
