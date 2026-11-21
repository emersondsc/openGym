// Lista mista de treinos e corridas compartilhada entre Histórico e Stats (Treinos recentes).
import { WorkoutRow, workoutDetailSheet, runSheet } from '../sheets.jsx'
import RunRow from './RunRow.jsx'

export default function HistoryList({ items, style }) {
  return <div className="list" style={style}>
    {items.map(it => it.w
      ? <WorkoutRow key={it.k} w={it.w} onClick={() => workoutDetailSheet(it.w)} />
      : <RunRow key={it.k} run={it.r} onClick={() => runSheet(it.r.id)} />)}
  </div>
}
