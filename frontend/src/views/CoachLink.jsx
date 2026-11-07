import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { CONNECTOR_URL, activateCoach, coachStage, errorText, getCoachAccess, minutesLeft, startCoachLink, unlinkCoach } from '../lib/coach-link.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'

const card = { background: 'var(--surface)', borderRadius: 14, padding: '13px 14px', marginTop: 12 }
const step = { margin: '6px 0 0', paddingLeft: 18 }

// Treinador do chat (spec_treinador_por_usuario.md e spec_liberacao_pelo_app.md): a pessoa ativa
// com o e-mail do conector, entra no Claude e diz o código. Quem não ativou não passa da porta.
export default function CoachLink() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [info, setInfo] = useState(undefined)
  const [code, setCode] = useState(null)
  const [email, setEmail] = useState('')
  const [editing, setEditing] = useState(false)   // trocar o e-mail sem criar outra conta
  const [, tick] = useState(0)
  const [busy, setBusy] = useState(false)
  const load = () => getCoachAccess().then(setInfo).catch(() => setInfo(null))
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!code) return
    const id = setInterval(() => { tick(n => n + 1); load() }, 5000)
    return () => clearInterval(id)
  }, [code])
  useEffect(() => { if (info?.linked && code) setCode(null) }, [info])

  const run = async fn => {
    setBusy(true)
    try { await fn() }
    catch (e) { toast(errorText(e, t)) }
    finally { setBusy(false) }
  }
  const activate = () => run(async () => { setCode(await activateCoach(email)); setEditing(false); await load() })
  const edit = () => { setEmail(info?.allowed?.email || ''); setCode(null); setEditing(true) }
  const newCode = () => run(async () => setCode(await startCoachLink()))
  const stop = () => run(async () => { await unlinkCoach(); setCode(null); await load(); toast(t('Coach disconnected')) })

  // Trocar de e-mail é ativar de novo: a API troca o anterior e desfaz a ligação antiga.
  const stage = editing && info ? 'activate' : coachStage(info, code)
  const left = code ? minutesLeft(code.expires_at) : 0
  const guest = info && !info.owner

  const steps = <ol className="muted small" style={step}>
    <li>{t('In Claude: Settings → Connectors → Add custom connector, with the address {0}', CONNECTOR_URL)}</li>
    <li>{t('Sign in with {0}. Cloudflare sends a code to that e-mail.', info?.allowed?.email || code?.email || t('your e-mail'))}</li>
    <li>{t('In a new conversation, tell Claude the code below.')}</li>
  </ol>

  return <div className="view">
    <button onClick={() => nav('/settings')} style={{ all: 'unset', cursor: 'pointer', color: 'var(--acc)' }}>‹ {t('Settings')}</button>
    <h1 style={{ margin: '8px 0 4px' }}>{t('Coach in chat')}</h1>
    <div className="muted">{t('Lets the OpenGym connector in Claude read your own training data. Nobody else sees it.')}</div>

    {stage === 'loading' && <div className="muted" style={{ marginTop: 12 }}>…</div>}

    {stage === 'linked' && <div style={card}>
      <div style={{ fontWeight: 600 }}>{t('Connected')}</div>
      <div className="muted small">{info.linked.email} · {new Date(info.linked.linked_at).toLocaleDateString()}</div>
      <div className="muted small">{info.linked.access === 'write' ? t('The coach can save to your plan') : t('Read only')}</div>
      {guest && <Button disabled={busy} style={{ marginTop: 10 }} onClick={edit}>{t('Change e-mail')}</Button>}
      <Button variant="danger" disabled={busy} style={{ marginTop: guest ? 8 : 10 }} onClick={stop}>{guest ? t('Turn off') : t('Disconnect')}</Button>
    </div>}

    {stage === 'activate' && <div style={card}>
      <div className="muted small">{t('The e-mail you will use to sign in to the connector:')}</div>
      <input className="input" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="voce@exemplo.com"
        value={email} onChange={e => setEmail(e.target.value)} style={{ marginTop: 6 }} />
      <div className="muted small" style={{ marginTop: 8 }}>
        {t('Privacy: your training data goes to the Claude account you use, under your own Claude account terms. You can turn it off here at any time.')}
      </div>
      <Button variant="primary" disabled={busy || !email.trim()} style={{ marginTop: 10 }} onClick={activate}>{t('Turn on with passkey')}</Button>
      {editing && <>
        <div className="muted small" style={{ marginTop: 8 }}>{t('Changing the e-mail disconnects the current login in Claude. Sign in again with the new one.')}</div>
        <Button disabled={busy} style={{ marginTop: 8 }} onClick={() => setEditing(false)}>{t('Cancel')}</Button>
      </>}
    </div>}

    {stage === 'ready' && <div style={card}>
      {guest && <>
        <div style={{ fontWeight: 600 }}>{t('Turned on for {0}', info.allowed.email)}</div>
        {steps}
      </>}
      {!guest && <div className="muted small">{t('Not connected')}</div>}
      <Button variant="primary" disabled={busy} style={{ marginTop: 10 }} onClick={newCode}>{guest ? t('New code') : t('Connect with passkey')}</Button>
      {guest && <Button disabled={busy} style={{ marginTop: 8 }} onClick={edit}>{t('Change e-mail')}</Button>}
      {guest && <Button variant="danger" disabled={busy} style={{ marginTop: 8 }} onClick={stop}>{t('Turn off')}</Button>}
    </div>}

    {stage === 'code' && <div style={card}>
      {guest && steps}
      {guest && <Button disabled={busy} style={{ marginTop: 8 }} onClick={edit}>{t('Change e-mail')}</Button>}
      {left > 0 ? <>
        <div className="muted small" style={{ marginTop: guest ? 10 : 0 }}>{t('In Claude, with the OpenGym connector, say:')}</div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '.08em', margin: '8px 0', fontVariantNumeric: 'tabular-nums' }}>{code.code}</div>
        <div className="muted small">{t('“My OpenGym code is {0}”', code.code)}</div>
        <div className="muted small" style={{ marginTop: 6 }}>{t('Valid for {0} min, one use.', left)}</div>
      </> : <>
        <div className="muted small">{t('The code expired.')}</div>
        <Button variant="primary" disabled={busy} style={{ marginTop: 10 }} onClick={newCode}>{t('New code')}</Button>
      </>}
    </div>}
  </div>
}
