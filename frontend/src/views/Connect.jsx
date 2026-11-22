import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button } from '../components/ui.jsx'

export default function Connect() {
  const { id } = useParams()
  const nav = useNavigate()
  const isGuest = useStore(s => s.isGuest())
  const [req, setReq] = useState(null)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  useEffect(() => {
    if (isGuest) return
    api('/api/oauth/request?id=' + encodeURIComponent(id || ''))
      .then(setReq)
      .catch(() => setGone(true))
  }, [id, isGuest])

  const answer = async yes => {
    setBusy(true)
    setProblem(null)
    try {
      const r = await api(yes ? '/api/oauth/approve' : '/api/oauth/deny', {
        method: 'POST',
        body: JSON.stringify({ id })
      })
      window.location.assign(r.redirect)
    } catch (e) {
      setProblem(e?.message || t('Something went wrong'))
      setBusy(false)
    }
  }

  if (isGuest) return <div className="view">
    <h1 style={{ margin: '12px 0 6px' }}>{t('Sign in required')}</h1>
    <div className="muted">{t('Demo mode cannot authorize an assistant. Sign in with your account first.')}</div>
    <Button style={{ marginTop: 14 }} onClick={() => nav('/settings')}>{t('Settings')}</Button>
  </div>

  if (gone) return <div className="view">
    <h1 style={{ margin: '12px 0 6px' }}>{t('This sign-in has expired')}</h1>
    <div className="muted">{t('Start it again from the assistant. It only waits ten minutes.')}</div>
    <Button style={{ marginTop: 14 }} onClick={() => nav('/home')}>{t('Back to openGym')}</Button>
  </div>

  if (!req) return <div className="view">
    <div className="muted" style={{ marginTop: 16 }}>{t('Loading...')}</div>
  </div>

  return <div className="view">
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
      <Icon name="sparkles" style={{ color: 'var(--acc)', width: 28, height: 28 }} />
      <h1 style={{ margin: 0 }}>{t('{0} wants to use your openGym', req.client)}</h1>
    </div>
    <div className="muted" style={{ marginTop: 8 }}>
      {t('After you say yes, it goes back to {0}. Only say yes if you just started this there.', req.redirectHost)}
    </div>
    {req.loopback && <div className="muted small" role="note" style={{ marginTop: 8, color: 'var(--orange, var(--acc))' }}>
      {t('This goes back to a program on this computer, not to a website. Only allow it if you started it there yourself just now.')}
    </div>}

    <Section title={t('Permissions')} footer={t('Privacy: your training data goes to the assistant account you use. You can disconnect it in Settings at any time.')}>
      <Row icon="person" iconTint="var(--acc)" title={t('Account')} value={req.userName} />
      <Row
        icon="lock"
        iconTint="var(--indigo)"
        title={t('Access')}
        value={req.access === 'write' ? t('Read and proposals') : t('Read only')}
      />
    </Section>

    {problem && <div className="muted small" role="alert" style={{ marginTop: 10, color: 'var(--red)' }}>{problem}</div>}

    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
      <Button variant="primary" icon="check" disabled={busy} onClick={() => answer(true)}>{t('Allow')}</Button>
      <Button disabled={busy} onClick={() => answer(false)}>{t('Not now')}</Button>
    </div>
  </div>
}
