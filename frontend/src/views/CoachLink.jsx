import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { getCoachLink, minutesLeft, startCoachLink, unlinkCoach } from '../lib/coach-link.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'

const card = { background: 'var(--surface)', borderRadius: 14, padding: '13px 14px', marginTop: 12 }

// Liga esta conta ao treinador do chat (Claude). Quem não ligou não vê nada pelo conector.
export default function CoachLink() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [link, setLink] = useState(undefined)
  const [code, setCode] = useState(null)
  const [, tick] = useState(0)
  const [busy, setBusy] = useState(false)
  const load = () => getCoachLink().then(setLink).catch(() => setLink(null))
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!code) return
    const id = setInterval(() => { tick(n => n + 1); load() }, 5000)
    return () => clearInterval(id)
  }, [code])
  useEffect(() => { if (link && code) setCode(null) }, [link])

  async function start() {
    setBusy(true)
    try { setCode(await startCoachLink()) }
    catch (e) { toast(e.message || t('Could not load')) }
    finally { setBusy(false) }
  }
  async function stop() {
    setBusy(true)
    try { await unlinkCoach(); setLink(null); toast(t('Coach disconnected')) }
    catch (e) { toast(e.message || t('Could not load')) }
    finally { setBusy(false) }
  }
  const left = code ? minutesLeft(code.expires_at) : 0

  return <div className="view">
    <button onClick={() => nav('/settings')} style={{ all: 'unset', cursor: 'pointer', color: 'var(--acc)' }}>‹ {t('Settings')}</button>
    <h1 style={{ margin: '8px 0 4px' }}>{t('Coach in chat')}</h1>
    <div className="muted">{t('Lets the OpenGym connector in Claude read your own training data. Nobody else sees it.')}</div>
    {link === undefined && <div className="muted" style={{ marginTop: 12 }}>…</div>}
    {link && <div style={card}>
      <div style={{ fontWeight: 600 }}>{t('Connected')}</div>
      <div className="muted small">{link.email} · {new Date(link.linked_at).toLocaleDateString()}</div>
      <div className="muted small">{link.access === 'write' ? t('The coach can save to your plan') : t('Read only')}</div>
      <Button variant="danger" disabled={busy} style={{ marginTop: 10 }} onClick={stop}>{t('Disconnect')}</Button>
    </div>}
    {link === null && !code && <div style={card}>
      <div className="muted small">{t('Not connected')}</div>
      <Button variant="primary" disabled={busy} style={{ marginTop: 10 }} onClick={start}>{t('Connect with passkey')}</Button>
    </div>}
    {link === null && code && <div style={card}>
      {left > 0 ? <>
        <div className="muted small">{t('In Claude, with the OpenGym connector, say:')}</div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '.08em', margin: '8px 0', fontVariantNumeric: 'tabular-nums' }}>{code.code}</div>
        <div className="muted small">{t('“My OpenGym code is {0}”', code.code)}</div>
        <div className="muted small" style={{ marginTop: 6 }}>{t('Valid for {0} min, one use.', left)}</div>
      </> : <>
        <div className="muted small">{t('The code expired.')}</div>
        <Button variant="primary" disabled={busy} style={{ marginTop: 10 }} onClick={start}>{t('New code')}</Button>
      </>}
    </div>}
  </div>
}
