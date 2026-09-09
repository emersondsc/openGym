import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, setsDoneActive } from '../lib/history.js'
import { loadOfRoutine, loadOfWorkouts, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import { todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length

  // Planned weekly volume per muscle (spec_home_weekly_volume_card.md): effective
  // routine of each day in the strip week -> loadOfRoutine, ranked; follows weekOffset.
  const plan = {}
  let nPlan = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const r = S.routines.find(r => r.id === effectiveRoutineId(S, isoOf(d)))
    if (!r) continue
    nPlan++
    const l = loadOfRoutine(r)
    for (const k in l) plan[k] = (plan[k] || 0) + l[k]
  }
  const planWorked = rankOf(plan).worked
  const planTop = planWorked.slice(0, 4)
  const fmtPlan = m => Math.round((plan[m] || 0) * 10) / 10

  // Done in the displayed strip week (spec_home_weekly_volume_progress.md): same ISO
  // week as `monday` (follows weekOffset), only sets actually ticked off count.
  const dispWeek = weekKey(isoOf(monday))
  const doneW = S.workouts.filter(w => w.d && weekKey(w.d) === dispWeek)
  const done = loadOfWorkouts(doneW)
  const nDone = doneW.filter(w => (w.entries || []).some(e => (e.sets || []).some(s => s.done))).length
  const doneWorked = rankOf(done).worked
  const doneTop = doneWorked.slice(0, 4)
  const doneMax = doneWorked.length ? done[doneWorked[0]] : 0
  const fmtDone = m => Math.round((done[m] || 0) * 10) / 10
  const pctDone = m => (plan[m] > 0 ? Math.min(100, (done[m] || 0) / plan[m] * 100) : 0)
  // Overall totals for header subtitle + pill
  const totalPlan = planWorked.reduce((a,m)=>a+(plan[m]||0),0)
  const totalDoneForPlan = planWorked.reduce((a,m)=>a+(done[m]||0),0)
  const overallPct = totalPlan > 0 ? Math.min(100, Math.round(totalDoneForPlan/totalPlan*100)) : 0
  const isFuture = weekOffset > 0
  const isDoneOnlyExtra = doneWorked.filter(m=>!plan[m]).slice(0,2)

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else dayOverrideSheet(todayISO()) }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      <div className="today-row" onClick={onToday}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name) : routine ? routine.name : t('Rest day')}{todayOvr && routine ? ' · ' + t('rescheduled') : ''}</div>
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
    </div>

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => calendarSheet()}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}>
            <Icon name="flame" style={{ color: 'var(--orange)' }} />
            {t('{0} week streak', streakWeeks(S))}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>

    {planWorked.length > 0 ? (
      <div className="card tappable" style={{ cursor: 'pointer' }} role="button" tabIndex={0}
        onClick={() => nav('/plan')}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') nav('/plan') }}
        aria-label={isFuture
          ? t('Weekly volume planned, {0} workouts planned — open Plan', nPlan)
          : t('Weekly volume, {0} of {1} workouts done — open Plan', nDone, nPlan)}>
        {/* Header: title + overall progress pill. Future weeks show planned-only */}
        <div className="row between" style={{ marginBottom: isFuture ? 10 : 6 }}>
          <h2 style={{ margin: 0 }}>{t('Weekly volume')}{isFuture ? ' · ' + t('planned') : ''}</h2>
          {isFuture ? (
            <span className="muted small">{t('{0} workouts', nPlan)}</span>
          ) : (
            <span className="tag" style={{ background: overallPct >= 100 ? 'var(--acc)' : 'var(--acc-soft)', color: overallPct >= 100 ? 'var(--on-acc)' : 'var(--acc)', fontWeight: 600, fontSize: 12, padding: '3px 8px', borderRadius: 99 }}>
              {overallPct}% · {t('{0} of {1} workouts', nDone, nPlan)}
            </span>
          )}
        </div>
        {!isFuture && totalPlan > 0 && (
          <div className="muted small" style={{ marginBottom: 10, lineHeight: 1.35 }}>
            {Math.round(totalDoneForPlan*10)/10} / {Math.round(totalPlan*10)/10} {t('sets')} · {nDone === nPlan && nPlan>0 && overallPct>=100 ? t('done') : t('planned')}
          </div>
        )}
        {planTop.map(m => {
          const pd = pctDone(m)
          const isDone = pd >= 100
          const hasExtra = (done[m]||0) > (plan[m]||0)
          return (
            <div key={m} className="mrow">
              <span className="nm">{t(MUSCLE_NAME[m])}</span>
              <span className="bar" aria-hidden="true" title={isFuture ? `${fmtPlan(m)} ${t('sets')}` : `${fmtDone(m)} / ${fmtPlan(m)}`}>
                <i style={{ width: isFuture ? '100%' : Math.round(pd) + '%', background: isFuture ? 'var(--label-3)' : isDone ? 'var(--acc)' : 'var(--acc)', opacity: isFuture ? .45 : 1 }} />
              </span>
              <span className="v" style={{ minWidth: 64 }}>
                {isFuture
                  ? <span style={{ color: 'var(--label-2)' }}>{t('{0} sets', fmtPlan(m))}</span>
                  : <>
                      <span style={{ color: isDone ? 'var(--acc)' : 'var(--label)', fontWeight: isDone ? 600 : 500 }}>{fmtDone(m)}</span>
                      <span style={{ color: 'var(--label-3)' }}> / {fmtPlan(m)}</span>
                      {isDone && <Icon name="check" style={{ fontSize: 11, color: 'var(--acc)', marginLeft: 4, verticalAlign: 'middle' }} />}
                      {hasExtra && !isDone && <span style={{ color: 'var(--orange)', fontSize: 10, marginLeft: 4 }}>+{Math.round(((done[m]||0)-(plan[m]||0))*10)/10}</span>}
                    </>
                }
              </span>
            </div>
          )
        })}
        {planWorked.length > 4 && <div className="muted small" style={{ marginTop: 8 }}>{t('+{0} more', planWorked.length - 4)}</div>}
        {/* Extra muscles trained but not in plan */}
        {!isFuture && isDoneOnlyExtra.length > 0 && (
          <div className="muted small" style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--sep)', lineHeight: 1.4 }}>
            + extra: {isDoneOnlyExtra.map(m=> `${t(MUSCLE_NAME[m])} ${fmtDone(m)} ${t('sets')}`).join(' · ')}
          </div>
        )}
      </div>
    ) : doneWorked.length > 0 ? (
      <div className="card tappable" style={{ cursor: 'pointer' }} role="button" tabIndex={0}
        onClick={() => nav('/plan')}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') nav('/plan') }}
        aria-label={t('Weekly volume done, {0} workouts — open Plan', nDone)}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('Weekly volume')} · {t('done')}</h2>
          <span className="muted small">{t('{0} workouts', nDone)}</span>
        </div>
        {doneTop.map(m => <div key={m} className="mrow">
          <span className="nm">{t(MUSCLE_NAME[m])}</span>
          <span className="bar" aria-hidden="true"><i style={{ width: Math.round(done[m] / doneMax * 100) + '%', background: 'var(--teal)' }} /></span>
          <span className="v">{t('{0} sets', fmtDone(m))}</span>
        </div>)}
        {doneWorked.length > 4 && <div className="muted small" style={{ marginTop: 6 }}>{t('+{0} more', doneWorked.length - 4)}</div>}
        <div className="muted small" style={{ marginTop: 8 }}>{t('No plan this week yet.')}</div>
      </div>
    ) : (
      <div className="card tappable" style={{ cursor: 'pointer' }} role="button" tabIndex={0}
        onClick={() => nav('/plan')}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') nav('/plan') }}
        aria-label={t('No plan this week yet. — open Plan')}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>{t('Weekly volume')} · {t('planned')}</h2>
          <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>{t('No plan this week yet.')}</div>
      </div>
    )}
  </div>
}
