import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { CONNECTOR_URL, errorText, getCoachAccess, revokeOauthConnection, unlinkCoach } from '../lib/coach-link.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'

const card = { background: 'var(--surface)', borderRadius: 14, padding: '13px 14px', marginTop: 12 }
const step = { margin: '6px 0 0', paddingLeft: 18 }

export default function CoachLink() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [info, setInfo] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const load = () => getCoachAccess().then(setInfo).catch(() => setInfo(null))
  useEffect(() => { load() }, [])

  const run = async fn => {
    setBusy(true)
    try { await fn() }
    catch (e) { toast(errorText(e, t)) }
    finally { setBusy(false) }
  }

  const url = info?.connectorUrl || CONNECTOR_URL
  const connections = info?.oauthConnections || []

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast(t('Copied'))
    } catch {
      toast(t('Could not copy'))
    }
  }

  const revoke = id => run(async () => {
    await revokeOauthConnection(id)
    await load()
    toast(t('Coach disconnected'))
  })

  const stopLegacy = () => run(async () => {
    await unlinkCoach()
    await load()
    toast(t('Coach disconnected'))
  })

  return <div className="view">
    <button onClick={() => nav('/settings')} style={{ all: 'unset', cursor: 'pointer', color: 'var(--acc)' }}>‹ {t('Settings')}</button>
    <h1 style={{ margin: '8px 0 4px' }}>{t('Coach in chat')}</h1>
    <div className="muted">{t('Lets the OpenGym connector in Claude read your own training data. Nobody else sees it.')}</div>

    {info === undefined && <div className="muted" style={{ marginTop: 12 }}>…</div>}

    {info !== undefined && <>
      <div style={card}>
        <div style={{ fontWeight: 600 }}>{t('Connector address')}</div>
        <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 10, background: 'var(--bg)', fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
          {url}
        </div>
        <Button style={{ marginTop: 8 }} onClick={copyUrl}>{t('Copy address')}</Button>

        <div className="muted small" style={{ marginTop: 12 }}>{t('How to connect:')}</div>
        <ol className="muted small" style={step}>
          <li>{t('In Claude: Settings → Connectors → Add custom connector')}</li>
          <li>{t('Paste the address above and click Connect')}</li>
          <li>{t('Authorize access here in openGym — no e-mail or code needed')}</li>
        </ol>
        <div className="muted small" style={{ marginTop: 8 }}>
          {t('Privacy: your training data goes to the assistant account you use. You can disconnect it in Settings at any time.')}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600 }}>{t('Connected assistants')}</div>
        {!connections.length && <div className="muted small" style={{ marginTop: 6 }}>{t('No assistant connected yet.')}</div>}
        {connections.map(c => (
          <div key={c.id} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div className="muted small">
              {c.access === 'write' ? t('The coach can save to your plan') : t('Read only')}
              {' · '}
              {new Date(c.used || c.created).toLocaleDateString()}
            </div>
            <Button variant="danger" disabled={busy} style={{ marginTop: 8 }} onClick={() => revoke(c.id)}>
              {t('Disconnect')}
            </Button>
          </div>
        ))}
      </div>

      {(info?.linked || info?.allowed) && <div style={card}>
        <div style={{ fontWeight: 600 }}>{t('Previous connection')}</div>
        <div className="muted small" style={{ marginTop: 4 }}>
          {info.linked?.email || info.allowed?.email || t('Connected')}
        </div>
        <Button variant="danger" disabled={busy} style={{ marginTop: 8 }} onClick={stopLegacy}>
          {t('Disconnect')}
        </Button>
      </div>}
    </>}
  </div>
}
