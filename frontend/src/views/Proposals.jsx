import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { approveProposal, getProposal, listProposals, rejectProposal } from '../lib/proposals.js'
import { fmtValue, groupChanges } from '../lib/proposal-diff.js'
import { EXIDX } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'
import { Button, TextArea } from '../components/ui.jsx'

const STATUS = {
  pending: ['Waiting', 'var(--acc)'], stale: ['Out of date', 'var(--red)'], blocked: ['Blocked', 'var(--red)'],
  applied: ['Applied', 'var(--acc)'], rejected: ['Rejected', 'var(--grey)'], canceled: ['Canceled', 'var(--grey)'], expired: ['Expired', 'var(--grey)']
}
const MOTIVO = {
  WORKOUT_IN_PROGRESS: 'A workout is in progress on another device', DATE_IN_PAST: 'This proposal has a day that already passed',
  NO_CHANGES: 'This proposal changes nothing', PROPOSAL_CHANGED: 'The proposal changed. Check it again before approving.',
  PROPOSAL_STALE: 'The plan changed after this proposal. Ask the coach for a new one.'
}
const card = { background: 'var(--surface)', borderRadius: 14, padding: '10px 13px' }
const secao = { fontSize: 12, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3, var(--grey))', margin: '18px 2px 6px' }
const aviso = cor => ({ background: 'var(--surface)', borderLeft: `3px solid ${cor}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, marginTop: 6 })
const linha = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, padding: '7px 0', fontVariantNumeric: 'tabular-nums' }

const nomeEx = id => EXIDX[id]?.n || id

function Status({ value }) {
  const [txt, cor] = STATUS[value] || [value, 'var(--grey)']
  return <span className="small" style={{ color: cor, whiteSpace: 'nowrap' }}>{t(txt)}</span>
}

export default function Proposals() {
  const nav = useNavigate()
  const [list, setList] = useState(null)
  const [erro, setErro] = useState(false)
  useEffect(() => { listProposals(true).then(setList).catch(() => setErro(true)) }, [])
  const abertas = (list || []).filter(p => ['pending', 'stale', 'blocked'].includes(p.status))
  const fechadas = (list || []).filter(p => !abertas.includes(p))
  const Item = ({ p }) => (
    <button onClick={() => nav(`/proposals/${p.id}`)} style={{ all: 'unset', boxSizing: 'border-box', ...card, display: 'flex', gap: 10, alignItems: 'center', width: '100%', cursor: 'pointer', marginTop: 8 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{p.title}</span>
        <span className="muted small">{new Date(p.created_at).toLocaleDateString()}</span>
      </span>
      <Status value={p.status} />
    </button>
  )
  return <div className="view">
    <button className="link" onClick={() => nav('/home')} style={{ all: 'unset', cursor: 'pointer', color: 'var(--acc)' }}>‹ {t('Home')}</button>
    <h1 style={{ margin: '8px 0 4px' }}>{t('Proposals')}</h1>
    {erro && <div className="muted">{t('Could not load')}</div>}
    {list && !abertas.length && <div className="muted" style={{ marginTop: 8 }}>{t('No proposals right now.')}</div>}
    {abertas.map(p => <Item key={p.id} p={p} />)}
    {!!fechadas.length && <div style={secao}>{t('History')}</div>}
    {fechadas.map(p => <Item key={p.id} p={p} />)}
  </div>
}

function Diferenca({ changes, S }) {
  const vazio = t('Empty')
  const { groups, other } = groupChanges(changes)
  const titulo = g => {
    const r = g.rows[0]
    if (g.kind === 'routine') return S.routines?.[r.routine]?.name || `${t('Routine')} ${r.routine + 1}`
    if (g.kind === 'days') return t('Days')
    if (g.kind === 'rules') return t('Rules')
    if (g.kind === 'workout') return S.workouts?.[r.workout]?.d || t('History')
    return g.key
  }
  const rotulo = (g, r) => {
    if (g.kind === 'routine') {
      const ex = r.ex === undefined ? null : S.routines?.[r.routine]?.ex?.[r.ex]
      const campo = r.label ? t(r.label) : r.field
      return r.ex === undefined ? campo : `${ex ? nomeEx(ex.id) : `#${r.ex + 1}`}: ${campo}`
    }
    if (g.kind === 'days') return r.day || `${t('Week')} ${r.weekday}`
    if (g.kind === 'rules') return r.rule
    if (g.kind === 'workout') {
      const e = S.workouts?.[r.workout]?.entries?.[r.entry]
      return `${e ? nomeEx(e.id) : ''} · ${t('Set {0}', r.set + 1)} · ${r.label ? t(r.label) : r.field}`
    }
    return r.path
  }
  const Valor = ({ c }) => <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>
    <span className="muted" style={{ textDecoration: 'line-through' }}>{fmtValue(c.before, vazio)}</span> → <b style={{ color: 'var(--acc)', fontWeight: 600 }}>{fmtValue(c.after, vazio)}</b>
  </span>
  return <>
    {groups.map(g => <div key={g.key} style={{ ...card, marginTop: 8 }}>
      <div style={{ fontWeight: 600 }}>{titulo(g)}</div>
      {g.rows.map(r => <div key={r.path} style={linha}><span style={{ minWidth: 0 }}>{rotulo(g, r)}</span><Valor c={r} /></div>)}
    </div>)}
    {!!other.length && <details style={{ ...card, marginTop: 8 }}>
      <summary className="muted">{t('Other fields')} ({other.length})</summary>
      {other.map(c => <div key={c.path} style={linha}><code style={{ fontSize: 12, overflowWrap: 'anywhere', minWidth: 0 }}>{c.path}</code><Valor c={c} /></div>)}
    </details>}
  </>
}

const textoAviso = w => {
  if (w.code === 'WEIGHT_JUMP') return t('Weight changes {0}% in {1}', w.pct, nomeEx(w.field.split('.').pop()))
  if (w.code === 'RESTRICTION_DROPPED') return t('Rule missing from this plan: {0}', w.field)
  if (w.code === 'MESO_OVERWRITE') return t('This replaces the whole mesocycle')
  return w.code
}

export function ProposalDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const { flushBeforeApproval, pullState } = useStore()
  const toast = useUI(s => s.toast)
  const [p, setP] = useState(null)
  const [erro, setErro] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [recusando, setRecusando] = useState(false)
  const [motivo, setMotivo] = useState('')
  useEffect(() => { getProposal(id).then(setP).catch(() => setErro(true)) }, [id])
  if (erro) return <div className="view"><div className="muted">{t('Could not load')}</div></div>
  if (!p) return <div className="view" />

  const trava = S.active ? t('Finish your workout to approve')
    : p.status === 'stale' ? t('The plan changed after this proposal. Ask the coach for a new one.')
      : p.status === 'blocked' ? t(MOTIVO[p.blocked_reason] || 'This proposal cannot be approved') : null
  const aberta = ['pending', 'stale', 'blocked'].includes(p.status)

  const aprovar = async () => {
    setOcupado(true)
    try {
      if (!(await flushBeforeApproval())) return toast(t('Could not sync this device. Try again.'))
      const atual = await getProposal(id)
      if (atual.approval_hash !== p.approval_hash) {
        setP(atual)
        return toast(t('The proposal changed. Check it again before approving.'))
      }
      await approveProposal(id, p.approval_hash)
      await pullState(false)
      toast(t('Applied to your plan'))
      nav('/proposals')
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') return
      toast(MOTIVO[e.code] ? t(MOTIVO[e.code]) : (e.message || t('This proposal cannot be approved')))
      getProposal(id).then(setP).catch(() => {})
    } finally { setOcupado(false) }
  }
  const recusar = async () => {
    setOcupado(true)
    try { await rejectProposal(id, motivo); toast(t('Proposal rejected. Nothing changed.')); nav('/proposals') }
    catch (e) { toast(e.message || t('Could not load')) }
    finally { setOcupado(false) }
  }

  return <div className="view">
    <button onClick={() => nav('/proposals')} style={{ all: 'unset', cursor: 'pointer', color: 'var(--acc)' }}>‹ {t('Proposals')}</button>
    <h1 style={{ margin: '8px 0 2px' }}>{p.title}</h1>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {t('Coach')} · {new Date(p.created_at).toLocaleString()} · <Status value={p.status} />
    </div>

    {aberta && trava && <div style={aviso('var(--red)')}>{trava}</div>}
    {aberta && p.warnings.map((w, i) => <div key={i} style={aviso('var(--orange)')}>{textoAviso(w)}</div>)}
    {aberta && p.dates_replaced.map(d => <div key={d.date} style={aviso('var(--orange)')}>
      {t(d.trained ? '{0} already has a logged workout' : '{0} already has another plan: it will be replaced', d.date)}
    </div>)}
    {aberta && p.kind === 'history_fix' && <div style={aviso('var(--orange)')}>{t('Volume, records and best weight of this workout will be recalculated')}</div>}

    {!!p.changes.length && <><div style={secao}>{t('What changes')}</div><Diferenca changes={p.changes} S={S} /></>}

    <div style={secao}>{t('Coach explanation')}</div>
    <div style={{ ...card, whiteSpace: 'pre-wrap' }}>
      {p.summary}
      {!!p.reasons.length && <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
    </div>

    {aberta && !recusando && <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
      <Button variant="primary" disabled={!!trava || ocupado || p.status !== 'pending'} style={trava ? { opacity: 0.45 } : undefined} onClick={aprovar}>{t('Approve with passkey')}</Button>
      {trava && <div className="muted small" style={{ textAlign: 'center' }}>{trava}</div>}
      <Button variant="danger" disabled={ocupado} onClick={() => setRecusando(true)}>{t('Reject')}</Button>
    </div>}
    {aberta && recusando && <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
      <TextArea id="proposal-reason" placeholder={t('The coach sees this at the next review')} value={motivo} maxLength={500} onChange={e => setMotivo(e.target.value)} aria-label={t('Reason (optional)')} />
      <Button variant="danger" disabled={ocupado} onClick={recusar}>{t('Confirm rejection')}</Button>
    </div>}
  </div>
}
