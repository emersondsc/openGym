import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useDiet } from '../store/useDiet.js'
import { useUI } from '../store/useUI.js'
import { DAYS, uid, exCount, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { weekAt, mesoState, todayInMeso, activateMesoState } from '../lib/meso.js'
import { ARCHIVE_FOLDER, dayAssignSheet, rotationAddSheet, loadStarterPlan, planToolsSheet, mesoListSheet, mesoFormSheet, importMesoFile, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { summarizeDietPlan } from '../lib/diet.js'
import { loadOfRoutine } from '../lib/muscles.js'
import { useDragReorder } from '../lib/dragReorder.js'
import {
  WEEK_MON_FIRST,
  dayIdsOf,
  dayModeOf,
  scheduleModeOf,
  rotationProgress,
  routineDaysMap,
  fixedExtraDays,
  combinedLoadOfRoutines,
  sweepRoutineFromSchedule,
} from '../lib/schedule.js'

const PLAN_TAB_KEY = 'gym_plan_tab_v2'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const { store: diet, load: loadDiet, activatePlan: activateDiet } = useDiet()

  useEffect(() => {
    loadDiet().catch(() => {})
  }, [user?.id, loadDiet])

  const [tab, setTabState] = useState(() => {
    try { return localStorage.getItem(PLAN_TAB_KEY) === 'schedule' ? 'schedule' : 'routines' } catch { return 'routines' }
  })
  const [editRoutines, setEditRoutines] = useState(false)
  const [editLoop, setEditLoop] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const setTab = next => {
    setTabState(next)
    setEditRoutines(false)
    setEditLoop(false)
    try { localStorage.setItem(PLAN_TAB_KEY, next) } catch { /* ignore private mode */ }
  }

  const mode = scheduleModeOf(S)
  const setMode = next => {
    setEditLoop(false)
    update(s => { s.scheduleMode = next })
  }

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  const moveRoutine = (from, to) => {
    if (from === to) return
    update(s => {
      if (from < 0 || to < 0 || from >= s.routines.length || to >= s.routines.length) return
      const [item] = s.routines.splice(from, 1)
      s.routines.splice(to, 0, item)
    })
  }

  const deleteRoutine = r => {
    confirmSheet({
      title: t('Delete routine?'),
      message: t('“{0}” and its exercises will be removed.', r.name),
      confirmText: t('Delete'),
      danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = s.routines.filter(x => x.id !== r.id)
          sweepRoutineFromSchedule(s, r.id)
        })
      },
    })
  }

  const moveLoop = (from, to) => {
    if (from === to) return
    update(s => {
      if (!Array.isArray(s.rotation)) return
      if (from < 0 || to < 0 || from >= s.rotation.length || to >= s.rotation.length) return
      const [item] = s.rotation.splice(from, 1)
      s.rotation.splice(to, 0, item)
    })
  }

  const removeLoopAt = idx => {
    update(s => {
      if (!Array.isArray(s.rotation)) return
      s.rotation.splice(idx, 1)
    })
  }

  const toggleLoopRest = idx => {
    update(s => {
      if (!Array.isArray(s.rotation) || !s.rotation[idx]) return
      s.rotation[idx].done = !s.rotation[idx].done
    })
  }

  const resetLoop = () => {
    update(s => {
      if (!Array.isArray(s.rotation)) return
      s.rotation.forEach(x => { if (x && typeof x === 'object') x.done = false })
    })
    useUI.getState().toast(t('Loop reset'))
  }

  // ---- mesociclo ativo (painel enxuto: nome, semana N de M e fase) ----
  const today = todayInMeso()
  const active = (S.mesos || []).find(m => m.id === S.activeMeso) || null
  const state = mesoState(active, today)
  const candidate = active ? null : (S.mesos || []).find(m => mesoState(m, today) === 'current') || null
  const wk = active ? weekAt(active, today) : null
  const shown = wk || (active ? (state === 'future' ? active.weeks[0] : active.weeks[active.weeks.length - 1]) : null)
  const summaryOf = m => shown
    ? t('week {0} of {1}', shown.n, m.weeks.length) + ' · ' + shown.phase
    : t('{0} weeks', m.weeks.length)

  const activate = id => update(s => {
    if (!activateMesoState(s, id, 'user')) return
    useUI.getState().toast(t('{0} is now your mesocycle', (s.mesos.find(m => m.id === id) || {}).name))
  })
  const pickMesoFile = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'application/json,.json,text/csv,.csv'
    inp.onchange = () => { const f = inp.files[0]; if (f) importMesoFile(f) }
    inp.click()
  }

  // ---- dieta ativa ----
  const activeDiet = (diet.plans || []).find(p => p.id === diet.activePlanId) || null
  const dietSummary = summarizeDietPlan(activeDiet)
  const revertDiet = async () => {
    if (!diet.prevPlanId) return
    try {
      const next = await activateDiet(diet.prevPlanId)
      const picked = (next.plans || []).find(p => p.id === diet.prevPlanId)
      if (picked) useUI.getState().toast(t('{0} is now your diet plan', picked.name))
    } catch (e) {
      useUI.getState().toast(e.message || t('Could not activate diet plan'))
    }
  }

  const byId = new Map((S.routines || []).map(r => [r.id, r]))
  const todayDow = new Date().getDay()
  const daysByRoutine = routineDaysMap(S)
  const rot = rotationProgress(S)
  const extraFixed = fixedExtraDays(S)

  const mainRoutines = (S.routines || []).filter(r => r.folder !== ARCHIVE_FOLDER)
  const archivedRoutines = (S.routines || []).filter(r => r.folder === ARCHIVE_FOLDER)

  const moveMainRoutine = (from, to) => {
    if (from === to) return
    const a = mainRoutines[from], b = mainRoutines[to]
    if (!a || !b) return
    update(s => {
      const ia = s.routines.findIndex(x => x.id === a.id)
      const ib = s.routines.findIndex(x => x.id === b.id)
      if (ia < 0 || ib < 0) return
      const [item] = s.routines.splice(ia, 1)
      s.routines.splice(ib, 0, item)
    })
  }

  const routineDrag = useDragReorder(mainRoutines.length, moveMainRoutine)
  const loopDrag = useDragReorder(rot.items.length, moveLoop)

  const renderDayCard = (d, ids) => {
    const rs = ids.map(id => byId.get(id)).filter(Boolean)
    const isToday = d === todayDow
    const totalEx = rs.reduce((n, r) => n + r.ex.length, 0)
    return (
      <button key={d} type="button" className="item" onClick={() => dayAssignSheet(d)}>
        <span className={'plan-day-lbl' + (isToday ? ' today' : '')}>{t(DAYS[d])}</span>
        {rs.length ? <>
          <span className="plan-ico acc"><Icon name={glyphOf(rs[0].emoji)} /></span>
          <div className="grow">
            <div className="tt">{rs.map(r => r.name).join(' + ')}</div>
            <div className="ss">
              {exCount(totalEx)}
              {rs.length > 1 && ` · ${t(dayModeOf(S, d) === 'separate' ? 'Separately' : 'Together')}`}
            </div>
          </div>
          <BodyMap load={combinedLoadOfRoutines(rs)} body={S.body} className="bm-mini" />
        </> : <>
          <span className="plan-ico rest"><Icon name="moon" /></span>
          <div className="grow">
            <div className="tt">{t('Rest day')}</div>
            <div className="ss">{t('Tap to plan something')}</div>
          </div>
        </>}
        <Icon name="chevronRight" className="chev" />
      </button>
    )
  }

  return <div className="narrow">
    <div className="hdr">
      <div>
        <h1>{t('Plan')}</h1>
        <div className="sub">{mode === 'rotation' ? t('Your routines in a loop') : t('Your weekly routine')}</div>
      </div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>

    <div className="plan-seg">
      <Segmented
        options={[
          { value: 'routines', label: t('Routines') },
          { value: 'schedule', label: t('Schedule') },
        ]}
        value={tab}
        onChange={setTab}
      />
    </div>

    {tab === 'schedule' ? <>
      <div className="plan-how">
        <div className="plan-how-lbl">
          <span className="plan-ico orange"><Icon name="repeat" /></span>
          <span>{t('How you train')}</span>
        </div>
        <Segmented
          className="seg-inline"
          options={[
            { value: 'fixed', label: t('Fixed Week') },
            { value: 'rotation', label: t('Rotation') },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      <div className="plan-hint">
        {mode === 'fixed'
          ? t('The same routines on the same weekdays, every week.')
          : t('Routines in a loop. Whatever is next stays next until you train it, whatever the day.')}
      </div>

      {mode === 'fixed' ? <>
        <h4 className="sec">{t('This week')}</h4>
        <div className="list">
          {WEEK_MON_FIRST.map(d => renderDayCard(d, dayIdsOf(S.week?.[d])))}
        </div>
        <div className="plan-hint">{t('Want two routines on one day? Tap the day and pick both.')}</div>
      </> : <>
        <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
          <h4 className="sec" style={{ margin: 0 }}>{t('The loop')}</h4>
          <div className="row" style={{ gap: 10 }}>
            {rot.items.length > 0 && (
              <button type="button" className="plan-edit-btn" onClick={() => setEditLoop(v => !v)}>
                {editLoop ? t('Done') : t('Edit')}
              </button>
            )}
            <Button size="sm" variant="tinted" icon="plus" onClick={rotationAddSheet}>{t('Add')}</Button>
          </div>
        </div>
        {rot.items.length ? <>
          <div className="list" ref={loopDrag.listRef}>
            {rot.items.map((item, i) => {
              const isRest = item.rid === 'rest'
              const r = isRest ? null : byId.get(item.rid)
              if (!isRest && !r) return null
              const isNext = i === rot.nextIdx
              const dragging = loopDrag.drag?.idx === i
              const statusTxt = isNext ? t('Up next') : item.done ? t('Done this round') : t('Later')
              return (
                <div
                  key={item.id}
                  className={'item' + (dragging ? ' plan-dragging' : '')}
                  style={dragging ? { transform: `translateY(${loopDrag.drag.dy}px) scale(1.01)` } : undefined}
                  onClick={() => {
                    if (editLoop) return
                    if (isRest) toggleLoopRest(i)
                    else nav('/plan/r/' + r.id)
                  }}
                >
                  {editLoop && (
                    <button
                      type="button"
                      className="plan-del"
                      aria-label={t('Remove')}
                      onClick={ev => { ev.stopPropagation(); removeLoopAt(i) }}
                    >
                      <Icon name="minus" />
                    </button>
                  )}
                  <span className={'plan-loop-num' + (isNext ? ' next' : '')}>{i + 1}</span>
                  {isRest
                    ? <span className="plan-ico rest"><Icon name="moon" /></span>
                    : <span className="plan-ico acc"><Icon name={glyphOf(r.emoji)} /></span>}
                  <div className="grow">
                    <div className="tt">{isRest ? t('Rest day') : r.name}</div>
                    <div className="ss">{statusTxt}</div>
                  </div>
                  {!editLoop && !isRest && <BodyMap load={loadOfRoutine(r)} body={S.body} className="bm-mini" />}
                  {editLoop ? (
                    <button
                      type="button"
                      className="plan-drag"
                      aria-label={t('Move')}
                      onPointerDown={ev => loopDrag.startDrag(i, ev)}
                      onKeyDown={ev => {
                        if (ev.key === 'ArrowUp' && i > 0) { ev.preventDefault(); moveLoop(i, i - 1) }
                        if (ev.key === 'ArrowDown' && i < rot.items.length - 1) { ev.preventDefault(); moveLoop(i, i + 1) }
                      }}
                    >
                      <Icon name="chevronsUpDown" />
                    </button>
                  ) : !isRest && <Icon name="chevronRight" className="chev" />}
                </div>
              )
            })}
          </div>
          <div className="plan-hint">
            {t('{0} of {1} done this round.', rot.doneCount, rot.total)}{' '}
            {editLoop
              ? t('Drag to reorder. Tap the minus to take one out.')
              : t('Trained out of order? Just pick another routine on Home.')}
          </div>
          <div style={{ marginTop: 10 }}>
            <Button size="sm" variant="ghost" icon="reset" onClick={resetLoop}>{t('Start the loop over')}</Button>
          </div>
        </> : (
          <div className="card muted small" style={{ lineHeight: 1.45 }}>
            {t('No rotation yet. Add routines in the order you want to train them. The first one you haven’t logged stays up next.')}
          </div>
        )}

        {extraFixed.length > 0 && <>
          <h4 className="sec">{t('Also on fixed days')}</h4>
          <div className="list">
            {extraFixed.map(({ d, ids }) => renderDayCard(d, ids))}
          </div>
          <div className="plan-hint">{t('These count on top of the loop. Tap a day to change or clear it.')}</div>
        </>}
      </>}

      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Mesocycle')}</h4>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" icon="list" onClick={mesoListSheet}>{t('All')}</Button>
          <Button size="sm" variant="tinted" icon="plus" onClick={() => mesoFormSheet({})}>{t('New')}</Button>
        </div>
      </div>
      <div className="list" style={{ marginBottom: 4 }}>
        {active ? <div className="item" onClick={() => nav('/plan/meso/' + active.id)}>
          <div className="grow">
            <div className="tt">{active.name}</div>
            <div className="ss">{summaryOf(active)}</div>
          </div>
          {state === 'ended' && <span className="tag">{t('ended')}</span>}
          <Icon name="chevronRight" className="chev" /></div>
        : candidate ? <div className="item" onClick={() => activate(candidate.id)}>
          <div className="grow">
            <div className="tt">{candidate.name}</div>
            <div className="ss">{t('covers today')} · {t('tap to activate')}</div>
          </div>
          <Icon name="chevronRight" className="chev" /></div>
        : <div className="item" onClick={mesoListSheet}>
          <div className="grow">
            <div className="tt">{t('No mesocycle yet')}</div>
            <div className="ss">{t('Create one, or import a file')}</div>
          </div>
          <Icon name="chevronRight" className="chev" /></div>}
      </div>
      {active && state === 'ended' && <div className="sect-f">
        {t('{0} ended on {1}.', active.name, fmtDate(active.end))}{' '}
        <a onClick={() => mesoFormSheet({})}>{t('Start the next one')}</a>{' · '}
        <a onClick={pickMesoFile}>{t('Import')}</a>
      </div>}
      {active && active.activatedBy === 'assistant' && S.mesoPrev && <div className="sect-f">
        <span className="tag acc">{t('Activated by the assistant')}</span>{' '}
        <a onClick={() => activate(S.mesoPrev)}>{t('Back to the previous one')}</a>
      </div>}

      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Diet')}</h4>
      </div>
      <div className="list" style={{ marginBottom: 4 }}>
        <div className="item" onClick={() => nav('/diet')}>
          <div className="grow">
            <div className="tt">{activeDiet ? activeDiet.name : t('No active diet plan')}</div>
            <div className="ss">
              {activeDiet
                ? (dietSummary.summaryLine || activeDiet.goal || t('Tap to open diet plan'))
                : t('Tap to choose or create a diet plan')}
            </div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      </div>
      {activeDiet && activeDiet.activatedBy === 'assistant' && diet.prevPlanId && <div className="sect-f">
        <span className="tag acc">{t('Activated by the assistant')}</span>{' '}
        <a onClick={revertDiet}>{t('Back to the previous one')}</a>
      </div>}
    </> : <>
      <div className="plan-toolbar">
        {S.routines.length > 0 ? (
          <button type="button" className="plan-edit-btn" onClick={() => setEditRoutines(v => !v)}>
            {editRoutines ? t('Done') : t('Edit')}
          </button>
        ) : <span />}
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
      </div>
      {S.routines.length ? <>
        <div className="list" ref={routineDrag.listRef}>
          {mainRoutines.map((r, i) => {
            const days = daysByRoutine[r.id] || []
            const dayText = days.length ? ' · ' + days.map(d => t(DAYS[d])).join(', ') : ''
            const folderText = r.folder ? ' · ' + r.folder : ''
            const dragging = routineDrag.drag?.idx === i
            return (
              <div
                key={r.id}
                className={'item' + (dragging ? ' plan-dragging' : '')}
                style={dragging ? { transform: `translateY(${routineDrag.drag.dy}px) scale(1.01)` } : undefined}
                onClick={() => { if (!editRoutines) nav('/plan/r/' + r.id) }}
              >
                {editRoutines && (
                  <button
                    type="button"
                    className="plan-del"
                    aria-label={t('Delete')}
                    onClick={ev => { ev.stopPropagation(); deleteRoutine(r) }}
                  >
                    <Icon name="minus" />
                  </button>
                )}
                <span className="plan-ico acc"><Icon name={glyphOf(r.emoji)} /></span>
                <div className="grow">
                  <div className="tt row" style={{ gap: 6 }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                    {r.fav && <Icon name="starFill" className="plan-fav" />}
                  </div>
                  <div className="ss">{exCount(r.ex.length)}{dayText}{folderText}</div>
                </div>
                {!editRoutines && <BodyMap load={loadOfRoutine(r)} body={S.body} className="bm-mini" />}
                {editRoutines ? (
                  <button
                    type="button"
                    className="plan-drag"
                    aria-label={t('Move')}
                    onPointerDown={ev => routineDrag.startDrag(i, ev)}
                    onKeyDown={ev => {
                      if (ev.key === 'ArrowUp' && i > 0) { ev.preventDefault(); moveMainRoutine(i, i - 1) }
                      if (ev.key === 'ArrowDown' && i < mainRoutines.length - 1) { ev.preventDefault(); moveMainRoutine(i, i + 1) }
                    }}
                  >
                    <Icon name="chevronsUpDown" />
                  </button>
                ) : <Icon name="chevronRight" className="chev" />}
              </div>
            )
          })}
        </div>
        {archivedRoutines.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button type="button" className="plan-archive-btn" aria-expanded={archiveOpen} onClick={() => setArchiveOpen(v => !v)}>
              <h4 className="sec" style={{ margin: 0 }}>{t('Archive')} ({archivedRoutines.length})</h4>
              <Icon name={archiveOpen ? 'chevronUp' : 'chevronDown'} style={{ color: 'var(--label-3)', fontSize: 15 }} />
            </button>
            {archiveOpen && (
              <div className="list">
                {archivedRoutines.map(r => (
                  <div key={r.id} className="item" onClick={() => { if (!editRoutines) nav('/plan/r/' + r.id) }}>
                    {editRoutines && (
                      <button type="button" className="plan-del" aria-label={t('Delete')} onClick={ev => { ev.stopPropagation(); deleteRoutine(r) }}>
                        <Icon name="minus" />
                      </button>
                    )}
                    <span className="plan-ico dim"><Icon name={glyphOf(r.emoji)} /></span>
                    <div className="grow">
                      <div className="tt">{r.name}</div>
                      <div className="ss">{exCount(r.ex.length)}</div>
                    </div>
                    {!editRoutines && <BodyMap load={loadOfRoutine(r)} body={S.body} className="bm-mini" />}
                    {!editRoutines && <Icon name="chevronRight" className="chev" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="plan-hint">
          {editRoutines
            ? t('Drag to reorder. Tap the minus to delete.')
            : t('Tap a routine to edit it. Reorder and delete are behind Edit.')}
        </div>
      </> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </>}
  </div>
}
