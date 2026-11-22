import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore, isValidRest } from '../store/useStore.js'
import { exOr, exName } from '../lib/exercises.js'
import { uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { supersetUnits, cleanupSg, exLine, fmtSec } from '../lib/history.js'
import { unitOfCfg } from '../lib/units.js'
import { Thumb } from '../components/Media.jsx'
import {
  ARCHIVE_FOLDER,
  glyphPicker,
  folderPickerSheet,
  exercisePicker,
  exConfigSheet,
  confirmSheet,
  openNotes,
  shareRoutine,
} from '../sheets.jsx'
import { printRoutine } from '../lib/plan-share.js'
import { MOBILE } from '../lib/mobile.js'
import { NoteChip, NoteLines } from '../components/NoteList.jsx'
import Icon from '../components/Icon.jsx'
import { useUI } from '../store/useUI.js'
import { glyphOf } from '../lib/glyphs.js'
import { Button, Row, Section } from '../components/ui.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import { sweepRoutineFromSchedule } from '../lib/schedule.js'
import { useDragReorder } from '../lib/dragReorder.js'

function RestChipForRoutine({ ex, routineId }) {
  const S = useStore(s => s.S)
  const cfgRest = S.routines.find(r => r.id === routineId)?.ex.find(x => x.id === ex.id)?.restSec
  const effective = cfgRest ?? S.globalRestSec ?? 90
  const custom = cfgRest != null
  const openSheet = useUI(s => s.openSheet)
  return (
    <button
      type="button"
      className={'tag tap nocap' + (custom ? ' acc' : '')}
      onClick={ev => {
        ev.stopPropagation()
        openSheet(close => <>
          <h3>{t('Rest time')}</h3>
          <div className="sect-b">
            {[60, 90, 120, 150, 180].map(v => (
              <button
                key={v}
                className="lrow tap"
                onClick={() => {
                  if (!isValidRest(v)) return
                  close()
                  useStore.getState().update(s => {
                    const cfg = s.routines.find(r => r.id === routineId).ex.find(x => x.id === ex.id)
                    cfg.restSec = v
                  })
                  useUI.getState().toast(t('Rest saved for {0} — {1}s', S.routines.find(r => r.id === routineId).name, v))
                }}
              >
                <span className="lrow-t">{fmtSec(v)}</span>
                {effective === v && <Icon name="check" className="lrow-k" />}
              </button>
            ))}
            <button
              className="lrow tap"
              onClick={() => {
                close()
                useStore.getState().update(s => {
                  const cfg = s.routines.find(r => r.id === routineId).ex.find(x => x.id === ex.id)
                  delete cfg.restSec
                })
                useUI.getState().toast(t('Rest reset to default'))
              }}
            >
              <span className="lrow-m">
                <span className="lrow-t">{t('Default')} ({fmtSec(S.globalRestSec ?? 90)})</span>
                <span className="lrow-s">{t('Use the routine rest setting')}</span>
              </span>
              {cfgRest == null && <Icon name="check" className="lrow-k" />}
            </button>
          </div>
        </>)
      }}
    >
      <Icon name="timer" />{fmtSec(effective)}
    </button>
  )
}

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])

  const edit = fn => update(s => {
    const cur = s.routines.find(x => x.id === id)
    if (cur) fn(cur.ex)
  })
  const move = (i, dir) => edit(ex => {
    const j = i + dir
    if (j < 0 || j >= ex.length) return
    ;[ex[i], ex[j]] = [ex[j], ex[i]]
    cleanupSg(ex)
  })
  const moveTo = (from, to) => edit(ex => {
    if (from === to || from < 0 || to < 0 || from >= ex.length || to >= ex.length) return
    const [item] = ex.splice(from, 1)
    ex.splice(to, 0, item)
    cleanupSg(ex)
  })
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })

  const exDrag = useDragReorder(r ? r.ex.length : 0, moveTo)
  if (!r) return null

  const units = supersetUnits(r.ex)
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())

  const addExercise = () => exercisePicker(ex =>
    exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) }), null, r, { routineEdit: true })
  )

  const toggleFav = () => {
    const next = !r.fav
    update(s => {
      const cur = s.routines.find(x => x.id === id)
      if (!cur) return
      if (next) cur.fav = true
      else delete cur.fav
    })
    useUI.getState().toast(next ? t('Added to favourites') : t('Removed from favourites'))
  }

  const allFolders = (S.routines || []).map(x => x.folder).filter(Boolean)
  const folderLabel = !r.folder ? t('None') : r.folder === ARCHIVE_FOLDER ? t('Archive') : r.folder
  const openFolderPicker = () => folderPickerSheet(r.folder || null, allFolders, next => {
    update(s => {
      const cur = s.routines.find(x => x.id === id)
      if (!cur) return
      if (next) cur.folder = next
      else delete cur.folder
    })
  })

  const copyRoutine = () => {
    const nid = uid()
    const copy = {
      ...JSON.parse(JSON.stringify(r)),
      id: nid,
      name: `${r.name} (${t('copy')})`,
    }
    update(s => { s.routines.push(copy) })
    useUI.getState().toast(t('Routine copied'))
    nav('/plan/r/' + nid)
  }

  const deleteRoutine = () => confirmSheet({
    title: t('Delete routine?'),
    message: t('“{0}” and its exercises will be removed.', r.name),
    confirmText: t('Delete'),
    danger: true,
    onConfirm: () => {
      update(s => {
        s.routines = s.routines.filter(x => x.id !== id)
        sweepRoutineFromSchedule(s, id)
      })
      nav('/plan')
    },
  })

  const load = r.ex.length > 0 ? loadOfRoutine(r) : null
  const worked = load ? rankOf(load).worked : []

  return <div className="narrow">
    <div className="hdr re-hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          key={r.id}
          className="input"
          defaultValue={r.name}
          aria-label={t('Routine name')}
          style={{ fontWeight: 600, fontSize: 19, letterSpacing: '-.021em' }}
          onChange={e => update(s => {
            const cur = s.routines.find(x => x.id === id)
            if (cur) cur.name = e.target.value.trim() || t('Routine')
          })}
        />
      </div>
      <div className="row" style={{ gap: 8, flex: 'none' }}>
        <button
          type="button"
          className={'iconbtn' + (r.fav ? ' on-ss' : '')}
          aria-label={r.fav ? t('Remove from favourites') : t('Add to favourites')}
          title={r.fav ? t('Remove from favourites') : t('Add to favourites')}
          onClick={toggleFav}
        >
          <Icon name={r.fav ? 'starFill' : 'star'} />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label={t('Pick an icon')}
          title={t('Pick an icon')}
          onClick={() => glyphPicker(r.emoji, g => update(s => {
            const cur = s.routines.find(x => x.id === id)
            if (cur) cur.emoji = g
          }))}
        >
          <Icon name={glyphOf(r.emoji)} />
        </button>
      </div>
    </div>

    <Section>
      <Row
        icon="folder"
        iconTint="var(--blue)"
        title={t('Folder')}
        value={folderLabel}
        accessory="chevron"
        onClick={openFolderPicker}
      />
    </Section>

    <div className="row between" style={{ marginTop: 6, marginBottom: 10 }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Exercises')}</h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={addExercise}>{t('Add exercise')}</Button>
    </div>

    {r.ex.length ? <div className="list" ref={exDrag.listRef}>{r.ex.map((e, i) => {
      const ex = exOr(e.id)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      const dragging = exDrag.drag?.idx === i
      return <div key={i} style={dragging ? { transform: `translateY(${exDrag.drag.dy}px) scale(1.01)`, position: 'relative', zIndex: 4 } : undefined}>
        {unitFirst.has(i) && <div className="ss-label"><Icon name="link" />{t('Superset')}</div>}
        <div
          className={'item' + (inSS.has(i) ? ' in-ss' : '') + (dragging ? ' plan-dragging' : '')}
          onClick={() => {
            exConfigSheet(ex, e, cfg => edit(x => {
              const keep = { id: x[i].id, sg: x[i].sg }
              if (x[i].note) keep.note = x[i].note
              if (x[i].restSec != null) keep.restSec = x[i].restSec
              x[i] = { ...keep, ...cfg }
            }), () => edit(x => { x.splice(i, 1); cleanupSg(x) }), r, { routineEdit: true })
          }}
        >
          {r.ex.length > 1 && (
            <button
              type="button"
              className="re-grip"
              aria-label={t('Move')}
              onClick={ev => ev.stopPropagation()}
              onPointerDown={ev => exDrag.startDrag(i, ev)}
              onKeyDown={ev => {
                if (ev.key === 'ArrowUp' && i > 0) { ev.preventDefault(); move(i, -1) }
                if (ev.key === 'ArrowDown' && i < r.ex.length - 1) { ev.preventDefault(); move(i, 1) }
              }}
            >
              <Icon name="grip" />
            </button>
          )}
          <Thumb ex={ex} />
          <div className="grow">
            <div className="tt capitalize">{exName(ex)}</div>
            <div className="ss">{exLine(e, unitOfCfg(e, S), S.customSetRoles)}</div>
            <div className="row" style={{ marginTop: 4, gap: 6, flexWrap: 'wrap' }}>
              <RestChipForRoutine ex={e} routineId={r.id} />
              <span onClick={ev => ev.stopPropagation()}>
                <NoteChip onClick={() => openNotes({ exId: e.id, exName: exName(ex), routineId: r.id, types: ['routine'] })} />
              </span>
            </div>
            <NoteLines notes={{ routine: e.note }} lines={2} onOpen={() => openNotes({ exId: e.id, exName: exName(ex), routineId: r.id, types: ['routine'] })} />
          </div>
          <div className="re-ex-controls">
            {i > 0 && (
              <button
                type="button"
                className={'iconbtn' + (linkedPrev ? ' on-ss' : '')}
                title={t('Superset with exercise above')}
                aria-label={t('Superset with exercise above')}
                style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', fontSize: 15 }}
                onClick={ev => { ev.stopPropagation(); toggleLink(i) }}
              >
                <Icon name="link" />
              </button>
            )}
            <div className="re-arrows">
              <button
                type="button"
                className="iconbtn"
                aria-label={t('Move up')}
                disabled={i === 0}
                style={{ width: 28, height: 24, borderRadius: 'var(--r-sm)', fontSize: 12 }}
                onClick={ev => { ev.stopPropagation(); move(i, -1) }}
              >
                <Icon name="chevronUp" />
              </button>
              <button
                type="button"
                className="iconbtn"
                aria-label={t('Move down')}
                disabled={i === r.ex.length - 1}
                style={{ width: 28, height: 24, borderRadius: 'var(--r-sm)', fontSize: 12 }}
                onClick={ev => { ev.stopPropagation(); move(i, 1) }}
              >
                <Icon name="chevronDown" />
              </button>
            </div>
          </div>
        </div>
      </div>
    })}</div> : (
      <div className="empty">
        <div className="ico"><Icon name="dumbbell" /></div>
        {t('No exercises yet — add your first one.')}
      </div>
    )}

    {load && (
      <div className="card" style={{ marginTop: 14 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    )}

    <div className="small dim row" style={{ margin: '10px 2px 18px', gap: 5 }}>
      <Icon name="link" style={{ fontSize: 13 }} />
      {t('Tap the link button on an exercise to superset it with the one above — you’ll do them back-to-back.')}
    </div>

    <Section>
      <Row icon="copy" iconTint="var(--acc)" title={t('Copy routine')} accessory="chevron" onClick={copyRoutine} />
      <Row icon="upload" iconTint="var(--teal)" title={t('Share with a friend')} accessory="chevron" onClick={() => shareRoutine(r)} />
      {!MOBILE && (
        <Row icon="download" iconTint="var(--indigo)" title={t('Print / Save as PDF')} accessory="chevron" onClick={() => printRoutine(S, r, user?.name || '')} />
      )}
    </Section>

    <Section footer={t('“{0}” and its exercises will be removed.', r.name)}>
      <Row icon="trash" iconTint="var(--red)" title={t('Delete routine')} danger onClick={deleteRoutine} />
    </Section>
  </div>
}
