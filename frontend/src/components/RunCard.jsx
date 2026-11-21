// Cartão "Corrida" no Histórico (docs/specs/spec_corrida.md, Technical Plan §6 e DIP §12).
// Só corridas lançadas pelo formulário entram aqui; o cardio dentro do treino fica de fora.
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { fmtKm, fmtPace } from '../lib/activities.js'
import { weeklyKm, longestRun, avgPaceLast, bestPace } from '../lib/run-stats.js'

const ddmm = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7)
const placeLabel = r => t(r.place === 'treadmill' ? 'Treadmill' : 'Outdoor')

function Line({ label, value }) {
  return <div className="row between run-line"><span className="muted">{label}</span><span>{value}</span></div>
}

export default function RunCard({ runs }) {
  if (!runs.length) return null
  const today = todayISO()
  const weeks = weeklyKm(runs, today)
  const maxKm = Math.max(...weeks.map(w => w.km), 0)
  const longest = longestRun(runs)
  const avg = avgPaceLast(runs)
  const best = minKm => {
    const b = bestPace(runs, minKm)
    return b ? [fmtPace(b.pace), ddmm(b.run.d), placeLabel(b.run)].join(' · ') : t('No {0} km run yet', minKm)
  }
  return <div className="card run-card">
    <h2>{t('Run')}</h2>
    <Line label={t('km this week')} value={fmtKm(weeks[weeks.length - 1].km)} />
    <div className="muted small" style={{ marginTop: 10 }}>{t('Last 8 weeks')}</div>
    <div className="run-bars" role="img" aria-label={t('Last 8 weeks')}>
      {weeks.map(w => <div key={w.start} className="run-bar">
        <i style={{ height: maxKm ? Math.max(2, Math.round((w.km / maxKm) * 48)) : 2 }} title={fmtKm(w.km)} />
        <span>{ddmm(w.start)}</span>
      </div>)}
    </div>
    <Line label={t('Longest run')} value={fmtKm(longest.km) + ' · ' + fmtDate(longest.d, true)} />
    <Line label={t('Avg pace (last 5)')} value={avg ? fmtPace(avg) : '—'} />
    <Line label={t('Best pace · {0} km or more', 5)} value={best(5)} />
    <Line label={t('Best pace · {0} km or more', 10)} value={best(10)} />
    <div className="small dim" style={{ marginTop: 10 }}>{t('Only runs logged here count toward progress.')}</div>
  </div>
}
