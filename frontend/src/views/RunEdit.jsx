// Tela dedicada de criação e edição de corrida (rotas `/run/new` e `/run/:id`).
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDate, fmtNum, isoOf, todayISO } from '../lib/format.js'
import { dateLocale, t } from '../lib/i18n.js'
import { NOTE_MAX, noteLength } from '../lib/notes.js'
import {
  runsOf, withRun, removeRun, parseKm, parseDuration, fmtDuration, fmtKm, fmtPace, paceOf, round2, validateRun,
} from '../lib/activities.js'
import { EXIDX } from '../lib/exercises.js'
import { ExerciseAnim } from '../components/Media.jsx'
import { confirmSheet, workoutDateSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, TextArea } from '../components/ui.jsx'

const DIST_PRESETS = [3, 5, 10, 15, 21.1]
const RUN_MEDIA_ID = { outdoor: '0685', treadmill: '0684' }
const RPE_STOPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const heat = (i, n) => `hsl(${Math.round(130 * (1 - i / (n - 1)))} 62% 48%)`

const numOrEmpty = v => {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/** Preserva até 2 casas decimais ao preencher a distância na edição (fmtNum arredonda para 1 casa). */
export function formatKmInput(n) {
  const s = String(round2(n))
  return dateLocale() === 'pt-BR' ? s.replace('.', ',') : s
}

export function yesterdayISO(today = todayISO()) {
  const dt = new Date(today + 'T12:00:00')
  dt.setDate(dt.getDate() - 1)
  return isoOf(dt)
}

export function rpeEffortKey(n) {
  if (n <= 2) return 'Very easy'
  if (n <= 4) return 'Easy'
  if (n <= 6) return 'Moderate'
  if (n <= 8) return 'Hard effort'
  return 'Max effort'
}

function RunRpeBar({ value, onChange }) {
  const barRef = useRef(null)
  const drag = useRef(null)

  const pickAt = clientX => {
    const el = barRef.current
    if (!el) return null
    const b = el.getBoundingClientRect()
    if (!b.width) return null
    const i = Math.max(0, Math.min(9, Math.floor(((clientX - b.left) / b.width) * 10)))
    return RPE_STOPS[i]
  }

  const onPointerDown = e => {
    const n = pickAt(e.clientX)
    if (n == null) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { startX: e.clientX, startVal: value, picked: n, moved: false }
    onChange(n)
  }
  const onPointerMove = e => {
    if (!drag.current) return
    if (Math.abs(e.clientX - drag.current.startX) > 4) drag.current.moved = true
    const n = pickAt(e.clientX)
    if (n != null && n !== drag.current.picked) {
      drag.current.picked = n
      onChange(n)
    }
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved && d.startVal === d.picked) onChange(null)
  }

  const onKeyDown = e => {
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onChange(null); return }
    const step = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1
      : (e.key === 'ArrowLeft' || e.key === 'ArrowDown') ? -1 : 0
    if (!step) return
    e.preventDefault()
    if (value == null) onChange(step > 0 ? 1 : 10)
    else onChange(Math.max(1, Math.min(10, value + step)))
  }

  return (
    <div
      ref={barRef}
      className="run-rpe-bar"
      role="slider"
      tabIndex={0}
      aria-label={t('Perceived effort')}
      aria-valuemin={1}
      aria-valuemax={10}
      aria-valuenow={value ?? 0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null }}
    >
      {RPE_STOPS.map((n, i) => {
        const lit = value != null && n <= value
        const cur = value === n
        const bg = heat(i, 10)
        return (
          <span
            key={n}
            className={'run-rpe-stop' + (lit ? ' lit' : '') + (cur ? ' cur' : '')}
            style={lit ? { background: bg } : undefined}
          >
            {n}
            {!lit && <i style={{ background: bg }} aria-hidden="true" />}
          </span>
        )
      })}
    </div>
  )
}

function RunEditForm({ id, had, initDay }) {
  const nav = useNavigate()
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const setLeaveGuard = useUI(s => s.setLeaveGuard)

  const today = todayISO()
  const yesterday = yesterdayISO(today)

  const [d, setD] = useState(had?.d || initDay)
  const [place, setPlace] = useState(had?.place || 'outdoor')
  const [km, setKm] = useState(had ? formatKmInput(had.km) : '')
  const [time, setTime] = useState(had ? fmtDuration(had.sec) : '')
  const [opt, setOpt] = useState(() => ({
    elev: had?.elev != null ? String(had.elev) : '',
    hrAvg: had?.hrAvg != null ? String(had.hrAvg) : '',
    hrMax: had?.hrMax != null ? String(had.hrMax) : '',
  }))
  const [rpe, setRpe] = useState(had?.rpe ?? null)
  const [note, setNote] = useState(had?.note || '')
  const [playing, setPlaying] = useState(true)
  const [touched, setTouched] = useState({})
  const touch = k => () => setTouched(x => ({ ...x, [k]: true }))

  const fields = {
    d,
    place,
    km: parseKm(km),
    sec: parseDuration(time),
    elev: numOrEmpty(opt.elev),
    hrAvg: numOrEmpty(opt.hrAvg),
    hrMax: numOrEmpty(opt.hrMax),
    rpe,
    note,
  }
  if (km.trim() && fields.km == null) fields.km = NaN
  if (time.trim() && fields.sec == null) fields.sec = NaN

  const { errors, warnings } = validateRun(fields)
  const bad = { ...errors }
  if (Number.isNaN(fields.km)) bad.km = 'Distance must be between 0 and 300 km'
  if (Number.isNaN(fields.sec)) bad.sec = 'Time must be between 1:00 and 24:00:00'
  if (Number.isNaN(fields.elev)) bad.elev = 'Elevation must be between 0 and 10,000 m'
  if (Number.isNaN(fields.hrAvg)) bad.hrAvg = 'Heart rate must be between 30 and 250'
  if (Number.isNaN(fields.hrMax)) bad.hrMax = 'Heart rate must be between 30 and 250'

  const ok = !Object.keys(bad).length
  const err = (k, always = false) =>
    (always || touched[k]) && bad[k]
      ? <div className="small" style={{ color: 'var(--red)', marginTop: 5 }}>{t(bad[k])}</div>
      : null

  const isDirty = had
    ? (
        d !== had.d ||
        place !== had.place ||
        km !== formatKmInput(had.km) ||
        time !== fmtDuration(had.sec) ||
        opt.elev !== (had.elev != null ? String(had.elev) : '') ||
        opt.hrAvg !== (had.hrAvg != null ? String(had.hrAvg) : '') ||
        opt.hrMax !== (had.hrMax != null ? String(had.hrMax) : '') ||
        rpe !== (had.rpe ?? null) ||
        note !== (had.note || '')
      )
    : (
        d !== initDay ||
        place !== 'outdoor' ||
        km.trim() !== '' ||
        time.trim() !== '' ||
        opt.elev.trim() !== '' ||
        opt.hrAvg.trim() !== '' ||
        opt.hrMax.trim() !== '' ||
        rpe != null ||
        note.trim() !== ''
      )

  const dirtyRef = useRef(false)
  const doneRef = useRef(false)
  dirtyRef.current = isDirty && !doneRef.current

  const leaveTo = to => {
    useUI.getState().closeAll()
    nav(to)
  }
  const leave = () => (
    typeof window !== 'undefined' && window.history?.state?.idx > 0 ? leaveTo(-1) : leaveTo('/history')
  )

  useEffect(() => {
    setLeaveGuard(to => {
      if (!dirtyRef.current) { useUI.getState().closeAll(); return true }
      confirmSheet({
        title: t('Discard changes?'),
        confirmText: t('Discard'),
        danger: true,
        onConfirm: () => { doneRef.current = true; dirtyRef.current = false; leaveTo(to) },
      })
      return false
    })
    const beforeUnload = e => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' }
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('beforeunload', beforeUnload)
    }
    return () => {
      setLeaveGuard(null)
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('beforeunload', beforeUnload)
      }
    }
  }, [setLeaveGuard])

  const back = () => {
    if (!dirtyRef.current) { leave(); return }
    confirmSheet({
      title: t('Discard changes?'),
      confirmText: t('Discard'),
      danger: true,
      onConfirm: () => { doneRef.current = true; dirtyRef.current = false; leave() },
    })
  }

  const save = () => {
    if (!ok) return
    doneRef.current = true
    dirtyRef.current = false
    update(s => { s.activities = withRun(s.activities, id, fields).map })
    toast(had ? t('Saved') : t('Run logged'))
    leave()
  }

  const remove = () => confirmSheet({
    title: t('Delete run?'),
    confirmText: t('Delete'),
    danger: true,
    onConfirm: () => {
      doneRef.current = true
      dirtyRef.current = false
      update(s => { s.activities = removeRun(s.activities, id) })
      toast(t('Run deleted'))
      leave()
    },
  })

  const hasPositiveKm = fields.km != null && !Number.isNaN(fields.km) && fields.km > 0
  const hasPositiveSec = fields.sec != null && !Number.isNaN(fields.sec) && fields.sec > 0
  const livePace = hasPositiveKm && hasPositiveSec ? fmtPace(paceOf(round2(fields.km), fields.sec)) : null
  const [paceNum, paceUnit] = livePace ? livePace.split('/') : ['—:—', 'km']
  const isOtherDate = d !== today && d !== yesterday
  const runEx = EXIDX[RUN_MEDIA_ID[place]]

  return (
    <div className="narrow">
      <div className="hdr">
        <button type="button" className="iconbtn" onClick={back} aria-label={t('Back')}>
          <Icon name="chevronLeft" />
        </button>
        <div style={{ flex: 1, margin: '0 12px', minWidth: 0 }}>
          <h1 style={{ fontSize: 24 }}>{had ? t('Edit run') : t('Log a run')}</h1>
          <div className="sub">{fmtDate(d, true)} · {t(place === 'treadmill' ? 'Treadmill' : 'Outdoor')}</div>
        </div>
        <button
          type="button"
          className="iconbtn"
          style={{ color: ok ? 'var(--acc)' : 'var(--label-3)', opacity: ok ? 1 : 0.4 }}
          disabled={!ok}
          onClick={save}
          aria-label={t('Save')}
        >
          <Icon name="check" />
        </button>
      </div>

      {/* Hero: cabeçalho de largura total + animação à esquerda e ritmo à direita */}
      <div className={'card run-hero' + (livePace ? ' ready' : '')}>
        <div className="run-hero-top">
          <span className="run-hero-lbl">
            <Icon name="timer" style={{ fontSize: 14 }} />
            {t('Pace')}
          </span>
          <span className={'tag' + (livePace ? ' run-tag' : '')}>
            <Icon name={place === 'treadmill' ? 'treadmill' : 'sun'} />
            {t(place === 'treadmill' ? 'Treadmill' : 'Outdoor')}
          </span>
        </div>
        <div className="run-hero-main">
          {runEx && (
            <button
              type="button"
              className="run-hero-media"
              onClick={() => setPlaying(p => !p)}
              aria-label={t(playing ? 'tap to pause' : 'tap to play')}
              title={t(playing ? 'tap to pause' : 'tap to play')}
            >
              <ExerciseAnim
                ex={runEx}
                playing={playing}
                alt={t(place === 'treadmill' ? 'Treadmill' : 'Outdoor')}
              />
            </button>
          )}
          <div className="run-hero-info">
            <div className={'run-pace-val' + (livePace ? '' : ' is-empty')}>
              {paceNum}<span className="u">/{paceUnit}</span>
            </div>
            <div className="run-hero-sub">
              {(hasPositiveKm || hasPositiveSec)
                ? `${hasPositiveKm ? fmtKm(round2(fields.km)) : '— km'} · ${hasPositiveSec ? fmtDuration(fields.sec) : '—:—'} · ${fmtDate(d, true)}`
                : t('Enter distance and time to see your pace')}
            </div>
          </div>
        </div>
        {ok && warnings.map(w => (
          <div key={w} className="run-hero-warn">
            <Icon name="info" style={{ fontSize: 15, flex: 'none' }} />
            <span>{t(w)}</span>
          </div>
        ))}
      </div>

      {/* Onde e quando */}
      <div className="card">
        <Segmented
          value={place}
          onChange={setPlace}
          options={[
            { value: 'outdoor', label: t('Outdoor'), icon: 'sun' },
            { value: 'treadmill', label: t('Treadmill'), icon: 'treadmill' },
          ]}
        />
        <div style={{ marginTop: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="run-field-lbl" style={{ marginBottom: 0 }}>{t('Date')}</span>
            <span className="small muted">{fmtDate(d, true)}</span>
          </div>
          <div className="chips" role="group" aria-label={t('Date')}>
            <button
              type="button"
              className={'chip nocap' + (d === today ? ' on' : '')}
              aria-pressed={d === today}
              onClick={() => setD(today)}
            >
              {t('Today')}
            </button>
            <button
              type="button"
              className={'chip nocap' + (d === yesterday ? ' on' : '')}
              aria-pressed={d === yesterday}
              onClick={() => setD(yesterday)}
            >
              {t('Yesterday')}
            </button>
            <button
              type="button"
              className={'chip nocap run-chip-ico' + (isOtherDate ? ' on' : '')}
              aria-pressed={isOtherDate}
              onClick={() => workoutDateSheet(d, setD)}
            >
              <Icon name="calendar" />
              <span>{isOtherDate ? fmtDate(d) : t('Other date')}</span>
            </button>
          </div>
          {err('d', true)}
        </div>
      </div>

      {/* Distância e tempo lado a lado */}
      <div className="card">
        <div className="grid2">
          <div>
            <label htmlFor="run-km" className="run-field-lbl">{t('Distance')}</label>
            <div className={'run-box' + (touched.km && bad.km ? ' bad' : '')}>
              <input
                id="run-km"
                inputMode="decimal"
                placeholder={dateLocale() === 'pt-BR' ? '5,2' : '5.2'}
                value={km}
                onChange={e => setKm(e.target.value)}
                onBlur={touch('km')}
              />
              <span className="u">km</span>
            </div>
            {err('km')}
          </div>
          <div>
            <label htmlFor="run-sec" className="run-field-lbl">{t('Moving time')}</label>
            <div className={'run-box' + (touched.sec && bad.sec ? ' bad' : '')}>
              <input
                id="run-sec"
                inputMode="numeric"
                placeholder="28:41"
                value={time}
                onChange={e => setTime(e.target.value)}
                onBlur={() => {
                  const s = parseDuration(time)
                  if (s != null) setTime(fmtDuration(s))
                  touch('sec')()
                }}
              />
            </div>
            {err('sec')}
          </div>
        </div>
        <div className="chips" style={{ marginTop: 12, flexWrap: 'wrap' }} aria-label={t('Distance')}>
          {DIST_PRESETS.map(v => (
            <button
              key={v}
              type="button"
              className={'chip nocap' + (fields.km === v ? ' on' : '')}
              aria-pressed={fields.km === v}
              onClick={() => setKm(fmtNum(v))}
            >
              {fmtKm(v)}
            </button>
          ))}
        </div>
        {!(touched.sec && bad.sec) && (
          <div className="small dim" style={{ marginTop: 8 }}>{t('Numbers only: 2841 = 28:41')}</div>
        )}
      </div>

      {/* Mais detalhes (sempre visível) */}
      <div className="card">
        <h2>{t('More details')}</h2>
        <div>
          <div className="grid2">
              <div>
                <label htmlFor="run-hr-avg" className="run-field-lbl">{t('Avg HR')}</label>
                <div className={'run-box sm' + (touched.hrAvg && bad.hrAvg ? ' bad' : '')}>
                  <input
                    id="run-hr-avg"
                    inputMode="numeric"
                    placeholder="152"
                    value={opt.hrAvg}
                    onChange={e => setOpt(o => ({ ...o, hrAvg: e.target.value }))}
                    onBlur={touch('hrAvg')}
                  />
                  <span className="u">bpm</span>
                </div>
                {err('hrAvg')}
              </div>
              <div>
                <label htmlFor="run-hr-max" className="run-field-lbl">{t('Max HR')}</label>
                <div className={'run-box sm' + (touched.hrMax && bad.hrMax ? ' bad' : '')}>
                  <input
                    id="run-hr-max"
                    inputMode="numeric"
                    placeholder="178"
                    value={opt.hrMax}
                    onChange={e => setOpt(o => ({ ...o, hrMax: e.target.value }))}
                    onBlur={touch('hrMax')}
                  />
                  <span className="u">bpm</span>
                </div>
                {err('hrMax')}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label htmlFor="run-elev" className="run-field-lbl">{t('Elevation gain')}</label>
              <div className={'run-box sm' + (touched.elev && bad.elev ? ' bad' : '')}>
                <input
                  id="run-elev"
                  inputMode="numeric"
                  placeholder="48"
                  value={opt.elev}
                  onChange={e => setOpt(o => ({ ...o, elev: e.target.value }))}
                  onBlur={touch('elev')}
                />
                <span className="u">m</span>
              </div>
              {err('elev')}
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="row between" style={{ marginBottom: 6, gap: 8 }}>
                <span className="run-field-lbl" style={{ marginBottom: 0 }}>{t('Perceived effort')}</span>
                {rpe != null ? (
                  <span className="row" style={{ gap: 8 }}>
                    <span className="small" style={{ fontWeight: 600 }}>{rpe}/10 · {t(rpeEffortKey(rpe))}</span>
                    <button type="button" className="btn xs plain" style={{ padding: '2px 6px' }} onClick={() => setRpe(null)}>
                      {t('Clear')}
                    </button>
                  </span>
                ) : (
                  <span className="small dim">{t('Tap or slide')}</span>
                )}
              </div>
              <RunRpeBar value={rpe} onChange={setRpe} />
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <label htmlFor="run-note" className="run-field-lbl" style={{ marginBottom: 0 }}>{t('Note')}</label>
                {note.length > 0 && <span className="small dim">{noteLength(note)} / {NOTE_MAX}</span>}
              </div>
              <TextArea
                id="run-note"
                rows={2}
                maxLength={NOTE_MAX}
                placeholder={t('How did the run feel? (optional)')}
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>
        </div>
      </div>

      <Button variant="primary" icon="check" onClick={save} disabled={!ok}>
        {had ? t('Save') : t('Log a run')}
      </Button>
      {had && (
        <>
          <div style={{ height: 8 }} />
          <Button variant="danger" icon="trash" onClick={remove}>{t('Delete')}</Button>
        </>
      )}
      <div style={{ height: 24 }} />
    </div>
  )
}

export default function RunEdit() {
  const nav = useNavigate()
  const loc = useLocation()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const had = id ? runsOf(S).find(x => x.id === id) : null

  useEffect(() => {
    if (id && !had) nav('/history', { replace: true })
  }, [id, !!had, nav])

  if (id && !had) return null

  const dayParam = new URLSearchParams(loc.search).get('day')
  const initDay = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : todayISO()

  return <RunEditForm key={(id || 'new') + ':' + initDay} id={id || null} had={had} initDay={initDay} />
}
