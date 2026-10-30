// Popup do esforço da série: arrastar na barra marca o RIR (ou o RPE, conforme o perfil).
// Só grava o esforço: concluir a série continua sendo o quadrado da linha.
import { useRef, useState } from 'react'
import { EFFORT_START, effortStops, nearestStop } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

// RPE 8 == RIR 2: as frases e as cores saem sempre do RIR.
const repsLeft = (kind, v) => (kind === 'rpe' ? 10 - v : v)
const WORDS = ['Failure', 'Very hard', 'Hard', 'Moderate', 'Easy', 'Very easy']
const word = left => t(WORDS[Math.ceil(left)])
const hint = left => {
  if (left === 0) return t('Could not do any more reps')
  if (left === 1) return t('1 rep left')
  if (left === 5) return t('5 or more reps left')
  if (left % 1) return t('Between {0} and {1} reps left', Math.floor(left), Math.ceil(left))
  return t('{0} reps left', left)
}
// Verde (leve) até vermelho (falha), pela posição na barra.
const heat = (i, n) => `hsl(${Math.round(130 * (1 - i / (n - 1)))} 62% 48%)`

export default function EffortSheet({ kind, value, start, onSave, close }) {
  const stops = effortStops(kind)
  const [v, setV] = useState(nearestStop(stops, value ?? start ?? EFFORT_START[kind]))
  const bar = useRef(null)
  const drag = useRef(false)
  const pick = e => {
    const b = bar.current.getBoundingClientRect()
    setV(stops[Math.max(0, Math.min(stops.length - 1, Math.floor((e.clientX - b.left) / b.width * stops.length)))])
  }
  const idx = stops.indexOf(v), left = repsLeft(kind, v)
  return <>
    <div className="effnum">{fmtNum(v)}</div>
    <div className="efflbl">{word(left)}</div>
    <div className="effsub">{hint(left)}</div>
    <div className="effbar" ref={bar} role="slider" aria-label={EFFORT_LABEL[kind]} aria-valuenow={v}
      aria-valuemin={Math.min(...stops)} aria-valuemax={Math.max(...stops)}
      onPointerDown={e => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); pick(e) }}
      onPointerMove={e => { if (drag.current) pick(e) }}
      onPointerUp={() => { drag.current = false }}>
      <div className="effbar-t">
        {stops.map((s, i) => <i key={s} style={{ background: heat(i, stops.length) }}>{s % 1 ? '' : s}</i>)}
      </div>
      <span className="effbar-k" style={{ left: (idx + 0.5) / stops.length * 100 + '%', background: heat(idx, stops.length) }}>{fmtNum(v)}</span>
    </div>
    <div className="effbtns">
      {/* limpar existe porque "sem valor" e RIR 0 são coisas diferentes */}
      <Button variant="plain" onClick={() => { if (value != null) onSave(null); close() }}>{t(value != null ? 'Clear' : 'Cancel')}</Button>
      <Button variant="primary" onClick={() => { onSave(v); close() }}>{t('Save')}</Button>
    </div>
  </>
}
const EFFORT_LABEL = { rir: 'RIR', rpe: 'RPE' }
