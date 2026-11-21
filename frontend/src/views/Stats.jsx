import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fetchAnalysis } from '../lib/coach.js'
import { EXIDX, exName } from '../lib/exercises.js'
import { effortOf } from '../lib/history.js'
import { fmtNum, fmtDate, fmtVol, todayISO, weekKey } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayListSheet, workoutDetailSheet } from '../sheets.jsx'
import { historyItems, runsOn } from '../lib/activities.js'
import { isCardHidden, clearHiddenCards } from '../lib/cards.js'
import HistoryList from '../components/HistoryList.jsx'
import HideCardBtn from '../components/HideCardBtn.jsx'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'
import Icon from '../components/Icon.jsx'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import { loadOfWorkouts, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import {
  hasEffort, displayScale, scaleName, toScale, effortSummary, effortWeeks,
  effortHistogram, isHardSet, HARD_RIR
} from '../lib/effort.js'
import { Button, Segmented } from '../components/ui.jsx'
import ExerciseProgressCard from '../components/ExerciseProgressCard.jsx'

// Which muscles the training in a window actually hit — and, the point of the card,
// which ones it keeps missing. Shading is relative within the window (lib/muscles.js).
function MuscleBalance({ S }) {
  const [win, setWin] = useState(7)
  const [hard, setHard] = useState(false)
  const [sel, setSel] = useState(null)
  const now = Date.now()
  const inWin = S.workouts.filter(w =>
    win === 0 ? true
      : win === 7 ? weekKey(w.d) === weekKey(todayISO())
        : (w.start || new Date(w.d).getTime()) > now - win * 86400000)
  // Counting only the sets taken near failure turns the map from "where did the volume go"
  // into "where did the stimulus go" — a muscle can lead on sets and still never be trained
  // hard. Offered only when the window holds ratings at all, since with none the hard map
  // would just be empty and read as "you trained nothing".
  const rated = inWin.some(w => w.entries.some(e => e.sets.some(s => s.done && isHardSet(s))))
  const on = hard && rated
  const load = loadOfWorkouts(inWin, on ? isHardSet : null)
  const { worked, missed } = rankOf(load)
  const top = worked.slice(0, 4)
  const max = worked.length ? load[worked[0]] : 0
  const sets = m => Math.round((load[m] || 0) * 10) / 10

  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Muscle balance')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {on ? t('by hard sets') : t('by sets worked')}</span></h2>
      <div className="row" style={{ gap: 8 }}>
        {rated && <Button size="sm" icon="flame" style={on ? { color: 'var(--yellow)' } : undefined}
          onClick={() => { setHard(h => !h); setSel(null) }}>{on ? t('Hard') : t('All')}</Button>}
        <HideCardBtn screen="stats" id="muscles" label={t('Muscle balance')} />
      </div>
    </div>
    <Segmented className="seg-range" value={win} onChange={v => { setWin(v); setSel(null) }}
      options={[{ value: 7, label: t('Week') }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') }]} />
    {inWin.length ? <>
      <BodyMap className="tappable" load={load} body={S.body} selected={sel}
        onMuscle={m => setSel(s => (s === m ? null : m))} />
      <BodyMapLegend />
      {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
        <span className="v">{sets(sel) ? t('{0} sets', sets(sel)) : on ? t('no hard sets') : t('not trained')}</span>
      </div>}
      {!sel && top.map(m => <div key={m} className="mrow">
        <span className="nm">{t(MUSCLE_NAME[m])}</span>
        <span className="bar"><i style={{ width: Math.round(load[m] / max * 100) + '%', background: on ? 'var(--yellow)' : undefined }} /></span>
        <span className="v">{t('{0} sets', sets(m))}</span>
      </div>)}
      {missed.length > 0 && <>
        <h4 className="sec" style={{ marginTop: 12 }}>{on ? t('No hard sets in this period') : t('Not trained in this period')}</h4>
        <div className="mchips">{missed.map(m => <span key={m} className="mchip miss">{t(MUSCLE_NAME[m])}</span>)}</div>
      </>}
      {!missed.length && worked.length > 0 &&
        <div className="muted small" style={{ marginTop: 10 }}>{on
          ? t('Every muscle group got at least one hard set in this period.')
          : t('Every muscle group got some work in this period.')}</div>}
    </> : <div className="muted small">{t('No workouts in this period yet.')}</div>}
  </div>
}

// How hard the training was — the half of the picture a volume chart cannot show. Everything
// is computed in RIR (lib/effort.js) and converted to whichever scale this profile reads.
// Every number carries how much of the training it speaks for: rating is optional and off by
// default, so a partly rated history is the normal case, and an average without its
// denominator would quietly speak for sets that were never rated.
function EffortCard({ S }) {
  const [win, setWin] = useState(90)
  const kind = displayScale(S)
  const hd = scaleName(kind)
  const sum = effortSummary(S, win)
  const weeks = effortWeeks(S, win)
  const hist = effortHistogram(S, win)
  const maxBin = Math.max(1, ...hist.map(b => b.n))
  // The week's set count rides along in the tooltip, because the pair is the reading:
  // volume up with effort up is fatigue piling up, volume up with effort flat is adaptation.
  const pts = weeks.map(w => ({ t: w.t, y: toScale(kind, w.rir), note: t('{0} sets', w.sets) }))
  // Bins run hardest-first in both scales: RIR 0 and RPE 10 are the same set.
  const binLabel = b => kind === 'rpe' ? (b.tail ? '≤ 6' : String(10 - b.rir)) : (b.tail ? b.rir + '+' : String(b.rir))

  return <div className="card">
    <div className="row between" style={{ marginBottom: 12 }}>
      <h2 style={{ margin: 0 }}>{t('Effort')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('how close to failure')}</span></h2>
      <HideCardBtn screen="stats" id="effort" label={t('Effort')} />
    </div>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
    {sum.rated === 0 ? <div className="muted small">{t('No rated sets in this period.')}</div> : <>
      <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div className="stat-v">{sum.avg == null ? '—' : fmtNum(toScale(kind, sum.avg)) + ' ' + hd}</div>
          <div className="small dim">{t('average effort')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-v" style={{ color: 'var(--yellow)' }}>{sum.hardPct == null ? '—' : Math.round(sum.hardPct * 100) + '%'}</div>
          <div className="small dim">{t('at {0} {1} or harder', hd, fmtNum(toScale(kind, HARD_RIR)))}</div>
        </div>
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>{t('{0} of {1} finished sets rated', sum.rated, sum.done)}</div>
      {effortOf(S) === 'none' && <div className="small" style={{ color: 'var(--yellow)', marginTop: 4 }}>
        {t('Effort per set is switched off — turn it on in Settings to keep rating.')}
      </div>}
      {pts.length > 1 && <>
        <h4 className="sec" style={{ marginTop: 12 }}>{t('Week by week')}</h4>
        <div className="chart"><LineChart points={pts} h={140} unit={hd} color="var(--yellow)" invert={kind === 'rir'} /></div>
      </>}
      <h4 className="sec" style={{ marginTop: 12 }}>{t('Where the sets land')}</h4>
      {hist.map(b => <div key={b.rir} className="mrow">
        <span className="nm">{hd} {binLabel(b)}</span>
        <span className="bar"><i style={{ width: Math.round(b.n / maxBin * 100) + '%', background: b.rir <= HARD_RIR ? 'var(--yellow)' : 'var(--label-3)' }} /></span>
        <span className="v">{b.n ? b.n + ' · ' + Math.round(b.pct * 100) + '%' : '—'}</span>
      </div>)}
      <div className="small dim" style={{ marginTop: 8 }}>
        {t('Most working sets belong close to failure without living there — half at the floor and half at the top average out to a healthy-looking middle.')}
      </div>
    </>}
  </div>
}

function CoachAnalysisCard(){
  const user = useStore(s=>s.user);
  const [coach,setCoach]=useState(null);
  const [err,setErr]=useState(null);
  useEffect(()=>{ if(!user){ setCoach(null); setErr(null); return; } fetchAnalysis().then(d=>{ setCoach(d); setErr(null); }).catch(e=>setErr(e)); },[user]);
  if(!user) return <div className="card" style={{position:'relative',textAlign:'center',padding:'20px 16px'}}>
    <div style={{position:'absolute',top:14,right:14}}><HideCardBtn screen="stats" id="coach" label={t('Your progress')} /></div>
    <div style={{fontSize:28,marginBottom:8}}>📊</div>
    <div style={{fontWeight:700}}>{t('Your progress')}</div>
    <div className="muted small" style={{marginTop:4}}>Log in to see your progress — volume, records and weeks</div>
  </div>;
  if(err && err.status===401) return <div className="card" style={{position:'relative',textAlign:'center',padding:'20px 16px'}}><div style={{position:'absolute',top:14,right:14}}><HideCardBtn screen="stats" id="coach" label={t('Your progress')} /></div><div className="muted small">Session expired — please log in again</div></div>;
  if(err) return <div className="card" style={{position:'relative',textAlign:'center',padding:'20px 16px'}}><div style={{position:'absolute',top:14,right:14}}><HideCardBtn screen="stats" id="coach" label={t('Your progress')} /></div><div style={{fontSize:22}}>⚠️</div><div className="muted small" style={{marginTop:6}}>Unable to load your progress</div><button className="btn" style={{marginTop:10}} onClick={()=>fetchAnalysis(true).then(d=>{setCoach(d); setErr(null);}).catch(e=>setErr(e))}>Try again</button></div>;
  if(!coach) return <div className="card row between"><div className="muted small">Loading your progress…</div><HideCardBtn screen="stats" id="coach" label={t('Your progress')} /></div>;
  const a=coach.analysis;
  return <div className="card">
    <div className="row between" style={{marginBottom:12}}>
      <h2 style={{margin:0,display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>📈</span> {t('Your progress')}</h2>
      <div className="row" style={{gap:8}}>
        <span className="dim small">{a.period.first ? `${a.period.first} → ${a.period.last}` : '—'}</span>
        <HideCardBtn screen="stats" id="coach" label={t('Your progress')} />
      </div>
    </div>
    {a.weeks?.length>0 && <>
      <h4 className="sec" style={{marginTop:8,marginBottom:6}}>Recent weeks</h4>
      <div className="list small">
        {a.weeks.slice(-4).map(w=> <div key={w.week} className="row between" style={{padding:'8px 0',borderBottom:'var(--hair) solid var(--sep)'}}>
          <span style={{fontWeight:600}}>{w.week.replace('S','Wk ')}</span>
          <span className="dim">{w.sessions} workouts</span>
          <span style={{fontWeight:700}}>{(w.tonnage/1000).toFixed(1)} t</span>
        </div>)}
      </div>
    </>}
    {a.prs?.length>0 && <>
      <h4 className="sec" style={{marginTop:14,marginBottom:6}}>Personal records</h4>
      <div className="list">
        {a.prs.slice(0,3).map(p=>{ const base = p.ex.replace(' (weighted)',''); const name = EXIDX[base] ? exName(EXIDX[base]) : (EXIDX[p.ex] ? exName(EXIDX[p.ex]) : p.ex); return <div key={p.ex} className="row between" style={{padding:'10px 0',borderBottom:'var(--hair) solid var(--sep)',gap:8}}>
          <span style={{fontWeight:600,flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={p.ex}>{name}</span>
          <span className="badge-acc" style={{background:'var(--acc)',padding:'2px 8px',borderRadius:999,fontWeight:800,fontSize:12}}>{p.e1rm} kg</span>
          <span className="dim small">{p.wmax} kg · {p.date}</span>
        </div>;})}
      </div>
    </>}
  </div>;
}

// Stats = the analytics hub: all charts, progress and history live here.
export default function Stats() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [range, setRange] = useState(90)
  const now = Date.now()
  const anyEffort = hasEffort(S)
  const items = historyItems(S)
  const hidden = id => isCardHidden(S, 'stats', id)
  const anyVisible = !hidden('heatmap') || (items.length > 0 && !hidden('recent')) || !hidden('coach')
    || (S.workouts.length > 0 && !hidden('muscles')) || (anyEffort && !hidden('effort'))
    || !hidden('weight') || !hidden('exercise')

  const bwPts = S.bodyweight.filter(b => range === 0 || (b.t || new Date(b.d).getTime()) > now - range * 86400000)
    .map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  return <>
    <div className="hdr"><div><h1>{t('Stats')}</h1><div className="sub">{t('Progress & history')}</div></div>
      <button className="iconbtn" onClick={() => nav('/history')} aria-label={t('History')}><Icon name="history" /></button></div>

    {!anyVisible && <div className="empty">
      <div className="ico"><Icon name="eyeOff" /></div>
      <div>{t('All Stats cards are hidden.')}</div>
      <div style={{ marginTop: 12 }}>
        <Button size="sm" variant="primary" onClick={() => update(s => { s.hiddenCards = clearHiddenCards(s.hiddenCards, 'stats') })}>
          {t('Show all cards')}
        </Button>
      </div>
    </div>}

    {!hidden('heatmap') && <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{t('Activity — last 12 months')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('by time trained')}</span></h2>
        <HideCardBtn screen="stats" id="heatmap" label={t('Activity — last 12 months')} />
      </div>
      <Heatmap S={S} onDay={iso => {
        const ws = S.workouts.filter(w => w.d === iso)
        const rs = runsOn(S, iso)
        if (ws.length === 1 && !rs.length) workoutDetailSheet(ws[0])
        else if (!ws.length && rs.length === 1) nav('/run/' + rs[0].id)
        else if (ws.length || rs.length) dayListSheet(iso, ws)
      }} />
    </div>}

    {items.length > 0 && !hidden('recent') && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Recent workouts')}</h4>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('All')} {items.length}</Button>
          <HideCardBtn screen="stats" id="recent" label={t('Recent workouts')} />
        </div>
      </div>
      <HistoryList items={items.slice(0, 6)} style={{ marginBottom: 12 }} />
    </>}

    {!hidden('coach') && <CoachAnalysisCard />}

    {S.workouts.length > 0 && !hidden('muscles') && <MuscleBalance S={S} />}
    {anyEffort && !hidden('effort') && <EffortCard S={S} />}

    {(!hidden('weight') || !hidden('exercise')) && <div className={!hidden('weight') && !hidden('exercise') ? 'cols' : undefined}>
      {!hidden('weight') && <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
            <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
            <HideCardBtn screen="stats" id="weight" label={t('Body weight')} />
          </div>
        </div>
        <Segmented className="seg-range" value={range} onChange={setRange}
          options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
        <div className="chart"><LineChart points={bwPts} h={160} unit={S.unit} goal={S.targetW} /></div>
      </div>}

      {!hidden('exercise') && <ExerciseProgressCard screen="stats" />}
    </div>}
  </>
}
