// frontend/src/views/PlanRaw.jsx — a visão crua do plano em JSON (só leitura).
//
// É o mesmo dado que a tela mostra, sem tradução: o que o app guarda, o que o export escreve e o
// que o assistente lê. Se a tela e isto discordarem, um dos dois está mentindo — por isso a
// serialização é uma só (`mesoToJSON`).
//
// Escopo: `meso` (o objeto do mesociclo), `plan` (mesos + rotinas + semana + dias) e `all` (o
// estado inteiro, com `workouts`). Escopo desconhecido cai em `plan`; id desconhecido mostra o
// vazio explícito — nunca o estado inteiro por acidente.
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { mesoToJSON, mesoFileName } from '../lib/meso-file.js'
import { shareExport, MOBILE } from '../lib/mobile.js'
import Icon from '../components/Icon.jsx'
import { Segmented, Button } from '../components/ui.jsx'

const SCOPES = ['meso', 'plan', 'all']

export default function PlanRaw() {
  const [q, setQ] = useSearchParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)

  const scope = SCOPES.includes(q.get('scope')) ? q.get('scope') : 'plan'
  const meso = scope === 'meso' ? (S.mesos || []).find(m => m.id === q.get('id')) : null
  const missing = scope === 'meso' && !meso

  const payload = missing ? null
    : meso ? meso
      : scope === 'plan'
        ? {
            mesos: S.mesos || [], activeMeso: S.activeMeso || null, mesoPrev: S.mesoPrev || null,
            routines: S.routines || [], week: S.week || {}, dayPlan: S.dayPlan || {}, customEx: S.customEx || []
          }
        : S
  const json = payload ? (meso ? mesoToJSON(meso) : JSON.stringify(payload, null, 2)) : ''
  const kb = payload ? (new Blob([json]).size / 1024).toFixed(1) : '0'
  const lines = json ? json.split('\n').length : 0
  const title = meso ? meso.name : t(scope === 'plan' ? 'Plan' : 'Everything')

  const setScope = s => setQ(s === 'plan' ? {} : { scope: s, ...(s === 'meso' && meso ? { id: meso.id } : {}) })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      useUI.getState().toast(t('Copied'))
    } catch { useUI.getState().toast(t('Could not copy')) }
  }
  const share = async () => {
    const name = (meso ? mesoFileName(meso, 'json') : 'opengym-' + scope + '.json')
    if (MOBILE) { try { await shareExport(json, name) } catch { /* dismissed */ } return }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
    URL.revokeObjectURL(a.href)
  }

  return <>
    <div className="hdr">
      <div>
        <h1>{title}</h1>
        <div className="sub">
          {t(scope === 'meso' ? 'mesocycle.json' : scope === 'plan' ? 'plan.json' : 'state.json')}
          {payload ? ` · ${kb} KB · ${t('{0} lines', lines)}` : ''}
        </div>
      </div>
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Back')}><Icon name="chevronRight" /></button>
    </div>

    <Segmented
      options={[{ value: 'meso', label: t('Mesocycle') }, { value: 'plan', label: t('Plan') }, { value: 'all', label: t('Everything') }]}
      value={scope}
      onChange={setScope}
    />

    {scope === 'plan' && payload && <div className="dim small" style={{ margin: '10px 2px 0' }}>
      {t('rev {0} · synced {1}', S.rev ?? 0, S._ts ? new Date(S._ts).toLocaleString() : '—')}
    </div>}

    <div style={{ height: 12 }} />
    {missing
      ? <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('That mesocycle is not in this profile.')}</div>
      : <pre className="rawjson">{json}</pre>}

    {!missing && <>
      <div style={{ height: 12 }} />
      <Button variant="primary" icon="clipboard" onClick={copy}>{t('Copy JSON')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" icon="upload" onClick={share}>{t('Share .json')}</Button>
    </>}
  </>
}
