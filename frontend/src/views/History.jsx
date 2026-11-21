import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { WorkoutRow, workoutDetailSheet, runSheet } from '../sheets.jsx'
import { runsOf } from '../lib/activities.js'
import RunRow from '../components/RunRow.jsx'
import RunCard from '../components/RunCard.jsx'
import Icon from '../components/Icon.jsx'

// Treinos e corridas numa lista só (docs/specs/spec_corrida.md, DIP §13): por dia, do mais recente
// para o mais antigo; no mesmo dia, os treinos primeiro e as corridas depois.
export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const runs = runsOf(S)
  const items = [
    ...S.workouts.map(w => ({ k: 'w' + w.id, d: w.d, g: 0, o: w.start || 0, w })),
    ...runs.map(r => ({ k: 'r' + r.id, d: r.d, g: 1, o: r._ts, r })),
  ].sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.g - b.g || b.o - a.o))
  const sub = t('{0} workouts', S.workouts.length) + (runs.length ? ' · ' + t(runs.length === 1 ? '{0} run' : '{0} runs', runs.length) : '')
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('History')}</h1><div className="sub">{sub}</div></div>
      <button className="iconbtn" onClick={() => runSheet()} aria-label={t('Log a run')}><Icon name="figureRun" /></button></div>
    <RunCard runs={runs} />
    {items.length ? <div className="list">{items.map(it => it.w
      ? <WorkoutRow key={it.k} w={it.w} onClick={() => workoutDetailSheet(it.w)} />
      : <RunRow key={it.k} run={it.r} onClick={() => runSheet(it.r.id)} />)}</div>
      : <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet.')}</div>}
  </>
}
