import { useEffect, useRef } from 'react'
import { fmtVol, isoOf, todayISO, MONTHS } from '../lib/format.js'
import { runsOf, fmtKm } from '../lib/activities.js'
import { t } from '../lib/i18n.js'

// GitHub-style activity heatmap, shaded by time trained per day (treinos + corridas).
export default function Heatmap({ S, onDay }) {
  const wrapRef = useRef(null)
  useEffect(() => { if (wrapRef.current) wrapRef.current.scrollLeft = wrapRef.current.scrollWidth }, [])

  const agg = {}
  const dayOf = d => (agg[d] = agg[d] || { w: 0, r: 0, vol: 0, min: 0, km: 0 })
  ;(S.workouts || []).forEach(w => {
    const a = dayOf(w.d)
    a.w++; a.vol += w.vol || 0
    a.min += Math.max(0, Math.round(((w.end || w.start) - w.start) / 60000))
  })
  runsOf(S).forEach(r => {
    const a = dayOf(r.d)
    a.r++; a.km += r.km; a.min += r.min
  })
  const mins = Object.values(agg).map(a => a.min).filter(v => v > 0).sort((a, b) => a - b)
  const q = p => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(p * mins.length))] : 0)
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75)
  const level = a => !a ? 0 : !a.min ? 1 : a.min >= t3 ? 4 : a.min >= t2 ? 3 : a.min >= t1 ? 2 : 1
  const tip = (key, a) => {
    if (!a) return key
    return [
      key,
      a.w ? t(a.w === 1 ? '{0} workout' : '{0} workouts', a.w) : null,
      a.r ? t(a.r === 1 ? '{0} run' : '{0} runs', a.r) : null,
      a.min ? `${a.min} min` : null,
      a.vol ? fmtVol(a.vol, S.unit) : null,
      a.km ? fmtKm(a.km) : null,
    ].filter(Boolean).join(' · ')
  }

  const today = new Date(); today.setHours(12, 0, 0, 0)
  const end = new Date(today); end.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const start = new Date(end); start.setDate(end.getDate() - 52 * 7)

  const months = [], cols = []
  let lastMonth = -1
  for (let wk = 0; wk <= 52; wk++) {
    const colStart = new Date(start); colStart.setDate(start.getDate() + wk * 7)
    const mo = colStart.getMonth()
    const showM = mo !== lastMonth && colStart.getDate() <= 7 && wk < 51
    months.push(<span key={wk}>{showM ? t(MONTHS[mo]) : ''}</span>)
    if (colStart.getDate() <= 7) lastMonth = mo
    const cells = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(colStart); day.setDate(colStart.getDate() + d)
      const key = isoOf(day)
      const a = agg[key]
      const cls = 'hm-c l' + level(a) + (key === todayISO() ? ' today' : '') + (day > today ? ' future' : '')
      cells.push(<div key={d} className={cls}
        title={tip(key, a)}
        onClick={a && onDay ? () => onDay(key) : undefined} />)
    }
    cols.push(<div key={wk} className="hm-col">{cells}</div>)
  }

  return <>
    <div className="hm-wrap" ref={wrapRef}>
      <div className="hm-months" style={{ marginLeft: 30 }}>{months}</div>
      <div className="hm-body">
        <div className="hm-days"><span>{t('Mon')}</span><span /><span>{t('Wed')}</span><span /><span>{t('Fri')}</span><span /><span /></div>
        <div className="hm-grid">{cols}</div>
      </div>
    </div>
    <div className="hm-legend">{t('Less time')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" /><div className="hm-c l3" /><div className="hm-c l4" /> {t('More time')}</div>
  </>
}
