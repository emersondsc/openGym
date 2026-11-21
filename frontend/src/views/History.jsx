import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { runSheet } from '../sheets.jsx'
import { runsOf, historyItems } from '../lib/activities.js'
import HistoryList from '../components/HistoryList.jsx'
import RunCard from '../components/RunCard.jsx'
import Icon from '../components/Icon.jsx'

// Treinos e corridas numa lista só (docs/specs/spec_corrida.md, DIP §13): por dia, do mais recente
// para o mais antigo; no mesmo dia, os treinos primeiro e as corridas depois.
export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const runs = runsOf(S)
  const items = historyItems(S, runs)
  const sub = t('{0} workouts', S.workouts.length) + (runs.length ? ' · ' + t(runs.length === 1 ? '{0} run' : '{0} runs', runs.length) : '')
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('History')}</h1><div className="sub">{sub}</div></div>
      <button className="iconbtn" onClick={() => runSheet()} aria-label={t('Log a run')}><Icon name="figureRun" /></button></div>
    <RunCard runs={runs} />
    {items.length ? <HistoryList items={items} />
      : <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet.')}</div>}
  </>
}
