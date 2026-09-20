// Edição de um treino JÁ FINALIZADO (spec: docs/specs/spec_editar_treino_finalizado.md).
//
// A tela edita um RASCUNHO: nada no histórico muda até o check do cabeçalho, e sair sem salvar
// descarta (perguntando antes, em todo caminho que dá para interceptar). A escrita é uma só, e
// quem recalcula o que é derivado — volume, recordes, melhor peso por exercício, ordem por data —
// é lib/workout-edit.js. Aqui mora a edição e a aparência.
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
   memória sumiria ali. Com a cópia guardada, voltar não perde nada — a tela reabre com o que foi
   digitado e avisa. `sessionStorage` (e não `localStorage`) porque o rascunho vale para esta aba
   e esta sessão: fechar o navegador é desistir da edição. */
const DRAFT_KEY = id => 'gym_edit_draft_' + id
const readDraft = id => {
  try { const v = JSON.parse(sessionStorage.getItem(DRAFT_KEY(id)) || 'null'); return v && v.d ? v : null } catch { return null }
}
const writeDraft = (id, d) => { try { sessionStorage.setItem(DRAFT_KEY(id), JSON.stringify(d)) } catch { /* modo privado */ } }
const clearDraft = id => { try { sessionStorage.removeItem(DRAFT_KEY(id)) } catch { /* */ } }

/* ---------- um exercício do treino, em modo edição ----------
   Mesma grade da tela de treino (`.setrow`/`.sethead`), com a coluna do `×` por série e sem o
   que só faz sentido durante a sessão: descanso, "última vez", prescrição e cronômetro. */
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
          pode ser a do meio. Com uma série só ele fica desabilitado — um treino não pode ficar
          sem nenhuma. */}
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

export default function WorkoutEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const setLeaveGuard = useUI(s => s.setLeaveGuard)
  const w = S.workouts.find(x => x.id === id)
  // Um rascunho guardado tem prioridade sobre o histórico: é o que faz o voltar do navegador não
  // perder nada (ver DRAFT_KEY acima).
  const stored = readDraft(id)
  const [draft, setDraft] = useState(() => stored || (w ? clone(w) : null))
  const dirty = useRef(!!stored)
  const [restored, setRestored] = useState(!!stored)

  useEffect(() => { if (!w) nav('/history') }, [!!w])
  useEffect(() => { if (restored) { toast(t('Unsaved changes from before are still here.')); setRestored(false) } }, [restored])

  // Sair com mudanças pendentes pergunta antes. A barra de baixo é renderizada fora das rotas e
  // levaria o rascunho embora em silêncio; o `beforeunload` cobre recarregar e fechar. O voltar do
  // navegador NÃO dá para bloquear com `HashRouter` + rotas declarativas (o app não tem bloqueador
  // de navegação) — quem cobre esse caminho é o rascunho guardado, que devolve o que foi digitado
  // quando a tela reabre.
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
    // uma releitura do assistente, e o nome da rotina não pode sair de um estado velho.
    const live = useStore.getState().S
    const name = draft.name.trim() || (live.routines.find(r => r.id === w.routineId) || {}).name || t('Freestyle')
    const moved = draft.d !== w.d
    let failed = false, touchedEx = []
    // Recalcula DENTRO do updater: é o estado no instante da escrita que é corrigido.
    update(s => {
      const res = applyWorkoutEdit(s, id, { ...draft, name })
      if (!res) { failed = true; return }
      s.workouts = res.workouts
      s.exWeights = res.exWeights
      touchedEx = res.touchedEx
    })
    if (failed) { toast(t('Nothing to save')); return }
    clearDraft(id)
    // O conflito de sync não pode descartar esta edição: a marca leva os exercícios mexidos (o
    // recálculo do melhor peso vence junto) e se o dia mudou (só aí a mescla reordena).
    useStore.getState().markLocalWin(id, { ex: touchedEx, moved })
    toast(t('Workout updated'))
    leave()
  }

  const setDate = iso => {
    if (iso > todayISO()) { toast(t('A workout cannot be dated in the future')); return }
    mut(d => { const sh = shiftWorkoutDate(d, iso); d.d = sh.d; d.start = sh.start; d.end = sh.end })
  }

  const usedIds = (skip = -1) => draft.entries.filter((_, j) => j !== skip).map(e => e.id)
  const removeEx = i => mut(d => { d.entries.splice(i, 1) })
  const moveEx = (i, dir) => mut(d => {
    const j = i + dir
    if (j < 0 || j >= d.entries.length) return
    ;[d.entries[i], d.entries[j]] = [d.entries[j], d.entries[i]]
  })

  // Trocar exercício: o que é NÚMERO vem junto, o que é do EXERCÍCIO não. `bodyweight`, `unit` e
  // a progressão vivem no `target` e descrevem o exercício antigo — carregá-los para uma barra
  // fixa deixaria "Added (kg)" e o passo de progressão da máquina.
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

  const del = () => confirmSheet({
    title: t('Delete workout?'), message: t('This removes it from your history for good.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      // Apagar mexe no melhor peso dos exercícios do treino e é marcado como a edição — sem isso
      // um 409 traria o treino de volta do servidor.
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
