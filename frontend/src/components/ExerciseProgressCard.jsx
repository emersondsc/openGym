// O card de progresso de um exercício. Aparece na Home e em Stats, com o mesmo exercício em foco.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { setLabel, modeOf } from '../lib/history.js'
import { unitOfCfg } from '../lib/units.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { e1rmSeries, best1RM } from '../lib/onerm.js'
import { displayScale, scaleName, toScale, avgRir } from '../lib/effort.js'
import LineChart from './LineChart.jsx'
import { Segmented, SelectRow } from './ui.jsx'

// O exercício em foco é preferência do aparelho, não dado de treino: mora no localStorage para
// sobreviver à troca de aba (App.jsx remonta a view inteira a cada rota) e ao reload.
// No estado sincronizado ele viraria uma escrita com `rev` a cada toque no seletor, e uma
// escolha que perdesse a corrida de 409 seria descartada em silêncio — o satélite da BACKLOG-09.
// Id guardado que não existe mais no histórico não precisa de faxina: o fallback de `curEx` já
// cai no primeiro da lista quando o id não está em exHist. E se o exercício voltar ao histórico
// depois (relogado, ou restaurado de um backup), o card volta a ele sozinho.
const EX_KEY = 'gym_stats_ex'
const readEx = () => { try { return localStorage.getItem(EX_KEY) } catch { return null } }
const saveEx = id => { try { localStorage.setItem(EX_KEY, id) } catch { /* sem storage: vale só nesta sessão */ } }


export default function ExerciseProgressCard() {
  const S = useStore(s => s.S)
  const [exId, setExId] = useState(readEx)
  const pickEx = id => { setExId(id); saveEx(id) }
  const [exMetric, setExMetric] = useState('top')
  const kind = displayScale(S)
  const hd = scaleName(kind)
  const exHist = [...new Set(S.workouts.flatMap(w => w.entries.map(e => e.id)))].filter(id => EXIDX[id]).sort((a, b) => EXIDX[a].n < EXIDX[b].n ? -1 : 1)
  const curEx = exId && exHist.includes(exId) ? exId : exHist[0] || null
  // How this exercise was logged most recently decides what the curve means: top weight,
  // longest hold or top speed. Sets logged in another mode lack the field and score 0, so a
  // switched exercise drops its old points instead of mixing seconds into a weight chart.
  const curMode = curEx ? (() => {
    for (let i = S.workouts.length - 1; i >= 0; i--) {
      const en = S.workouts[i].entries.find(e => e.id === curEx)
      if (en) return modeOf({ ...(en.target || {}), id: curEx })
    }
    return modeOf({ id: curEx })
  })() : 'reps'
  const curCardio = curMode === 'cardio'
  const curTimed = curMode === 'time'
  const metric = s => curCardio ? (s.speed || 0) : curTimed ? (s.sec || 0) : (s.w || 0)
  // BACKLOG-01: a unidade do exercício em foco vem do TEMPLATE da rotina que o usa, não da
  // última sessão registrada. Tirar da última entrada faria o eixo do gráfico e o "Best:"
  // mudarem de unidade sozinhos assim que um treino novo do exercício fosse salvo, sem que
  // nada no dado tivesse mudado — e isso contradiz U1 ("vale só daqui pra frente").
  // Se o mesmo id estiver em mais de uma rotina com unidades diferentes, o primeiro vence:
  // a tela é do exercício, não da rotina, e a ambiguidade fica declarada em vez de escondida.
  const curCfg = S.routines.flatMap(r => r.ex || []).find(x => x.id === curEx) || { id: curEx }
  const exUnit = curCardio ? 'km/h' : curTimed ? 's' : unitOfCfg(curCfg, S)
  let exPts = [], exList = [], exBest = 0
  if (curEx) {
    S.workouts.forEach(w => {
      const en = w.entries.find(e => e.id === curEx)
      if (en) { const mx = Math.max(0, ...en.sets.filter(s => s.done).map(metric), curCardio || curTimed ? 0 : (en.topW || 0)); if (mx > 0) { exPts.push({ t: w.start, y: mx, d: w.d, sets: en.sets.filter(s => s.done), target: en.target }); if (mx > exBest) exBest = mx } }
    })
    exList = exPts.slice(-5).reverse()
  }
  // Estimated 1RM (issue #18) — only reps-mode training produces one, so cardio and timed
  // work simply have no points and the toggle stays hidden.
  const e1Pts = curEx ? e1rmSeries(S, curEx) : []
  const e1Best = curEx ? best1RM(S, curEx) : null
  const showE1 = e1Pts.length > 0
  // Effort on this exercise, per session. It rides on the top-set curve as well as having a
  // curve of its own, because the two only mean something together: the same weight moved
  // with more left in the tank is progress a weight-only chart draws as a flat line.
  const exRir = exPts.map(p => avgRir(p.sets))
  const showEff = exRir.filter(v => v != null).length >= 3
  const effPts = exPts.map((p, i) => (exRir[i] == null ? null : { t: p.t, y: toScale(kind, exRir[i]), d: p.d })).filter(Boolean)
  const onE1 = showE1 && exMetric === 'e1rm'
  const onEff = showEff && exMetric === 'effort'
  const topPts = exPts.map((p, i) => ({
    t: p.t, y: p.y, d: p.d,
    // 0 RIR (nothing left) is a full dot, 4+ a faint one; unrated sessions keep the plain line.
    m: exRir[i] == null ? null : 1 - Math.min(4, Math.max(0, exRir[i])) / 4,
    note: exRir[i] == null ? undefined : hd + ' ' + fmtNum(toScale(kind, exRir[i]))
  }))
  const exOpts = [{ value: 'top', label: t('Top set') }]
  if (showE1) exOpts.push({ value: 'e1rm', label: t('Est. 1RM') })
  if (showEff) exOpts.push({ value: 'effort', label: t('Effort') })

  return <div className="card">
    <h2>{t('Exercise progress')}</h2>
    {exHist.length ? <>
      <div className="sect-b" style={{ marginBottom: 10 }}>
        <SelectRow title={t('Exercise')} sheetTitle={t('Exercise progress')} value={curEx} onChange={pickEx}
          options={exHist.map(id => ({ value: id, label: EXIDX[id].n }))} />
      </div>
      {exOpts.length > 1 && <Segmented className="seg-range" value={onEff ? 'effort' : onE1 ? 'e1rm' : 'top'} onChange={setExMetric} options={exOpts} />}
      <div className="chart">
        {onEff
          ? <LineChart points={effPts} h={150} unit={hd} color="var(--yellow)" invert={kind === 'rir'} />
          : <LineChart points={onE1 ? e1Pts.map(p => ({ t: p.t, y: p.y, d: p.d })) : topPts} h={150} unit={exUnit} color="var(--blue)" />}
      </div>
      <div style={{ marginTop: 8 }}>{exList.map((p, i) => <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <span className="muted">{fmtDate(p.d, true)}</span><span>{p.sets.map(s => setLabel(curEx, s, p.target, S)).join('  ')}</span></div>)}</div>
      <div className="small dim" style={{ marginTop: 8 }}>
        {onEff ? t('Average effort per workout') : onE1 ? t('Estimated 1RM per workout') : curCardio ? t('Top speed per workout') : curTimed ? t('Longest hold per workout') : t('Best set weight per workout')}
        {onEff ? '' : <> · {t('Best:')}{' '}<b className="accent">{fmtNum(onE1 ? e1Best.est : exBest)} {exUnit}</b></>}
      </div>
      {onE1 && <div className="small dim" style={{ marginTop: 4 }}>
        {t('Best estimate from {0} on {1} — an estimate, not a tested max.', fmtNum(e1Best.w) + ' ' + exUnit + ' × ' + e1Best.r, fmtDate(e1Best.d, true))}
      </div>}
      {!onEff && !onE1 && showEff && <div className="small dim" style={{ marginTop: 4 }}>
        {t('A fuller dot means less left in the tank — the same weight at a lower {0} is progress the line alone does not show.', hd)}
      </div>}
    </> : <div className="muted small">{t('Finish your first workout to see progress curves here.')}</div>}
  </div>
}
