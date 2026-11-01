import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { listProposals } from '../lib/proposals.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Só existe para o dono das propostas, e só quando há proposta aberta.
export default function ProposalsCard() {
  const owner = useStore(s => !!s.user?.coachOwner)
  const nav = useNavigate()
  const [list, setList] = useState([])
  useEffect(() => {
    if (!owner) return
    let on = true
    listProposals().then(l => { if (on) setList(l) }).catch(() => { /* sem cartão, sem aviso */ })
    return () => { on = false }
  }, [owner])
  if (!owner || !list.length) return null
  return (
    <button className="proposal-card" onClick={() => nav(list.length === 1 ? `/proposals/${list[0].id}` : '/proposals')}
      style={{ all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, width: '100%', cursor: 'pointer', background: 'var(--surface)', borderRadius: 14, padding: '13px 14px', margin: '12px 0' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{t('Coach')}</span>
        <span className="muted small">{list[0].title}</span>
      </span>
      {list.length > 1 && <span className="muted small">{list.length}</span>}
      <Icon name="chevronRight" className="chev" />
    </button>
  )
}
