// frontend/src/views/PlanRaw.jsx — o JSON cru de UM mesociclo (só leitura).
//
// Só o mesociclo. É o único objeto do app que esta tela pode mostrar sem inventar nada: ele é
// lido e escrito exatamente como está e é o único que o app sabe importar de volta (pela folha de
// import, que aceita o arquivo exportado daqui).
//
// O que NÃO existe mais aqui, de propósito: escopos de "plano" e de "estado". O plano não é um
// objeto guardado — era um envelope montado na hora, que parecia um arquivo do app sem ser — e o
// estado inteiro é o backup, que vive em Settings. Nome de arquivo que não existe (`plan.json`)
// também saiu: o subtítulo diz o que a coisa é.
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { mesoToJSON, mesoFileName } from '../lib/meso-file.js'
import { shareExport, MOBILE } from '../lib/mobile.js'
import { mesoFormSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function PlanRaw() {
  const [q] = useSearchParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)

  // O mesociclo vem do id da query; sem id (ou com um id que sumiu) cai no ATIVO e depois no
  // primeiro — chegar aqui sem id mostra o mesociclo da vez, nunca um erro.
  const all = S.mesos || []
  const wanted = q.get('id')
  const meso = all.find(m => m.id === wanted) || all.find(m => m.id === S.activeMeso) || all[0] || null

  const json = meso ? mesoToJSON(meso) : ''
  const kb = meso ? (new Blob([json]).size / 1024).toFixed(1) : '0'
  const lines = json ? json.split('\n').length : 0

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      useUI.getState().toast(t('Copied'))
    } catch { useUI.getState().toast(t('Could not copy')) }
  }
  const share = async () => {
    const name = mesoFileName(meso, 'json')     // o nome que o import do app reconhece de volta
    if (MOBILE) { try { await shareExport(json, name) } catch { /* dismissed */ } return }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
    URL.revokeObjectURL(a.href)
  }

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(meso ? '/plan/meso/' + meso.id : '/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <h1 style={{ fontSize: 24 }}>{meso ? meso.name : t('Mesocycle')}</h1>
        <div className="sub">{t('mesocycle object')}{meso ? ` · ${kb} KB · ${t('{0} lines', lines)}` : ''}</div>
      </div>
    </div>

    {!meso
      ? <div className="empty">
          <div className="ico"><Icon name="clipboard" /></div>
          {t('No mesocycle yet')}
          <div style={{ height: 12 }} />
          <Button variant="tinted" icon="plus" onClick={() => mesoFormSheet({})}>{t('New mesocycle')}</Button>
        </div>
      : <>
          <div className="dim small" style={{ margin: '0 2px 12px', lineHeight: 1.45 }}>
            {t('Exactly what the app stores for this mesocycle — extra fields included.')}
          </div>
          <pre className="rawjson">{json}</pre>
          <div style={{ height: 12 }} />
          <Button variant="primary" icon="clipboard" onClick={copy}>{t('Copy JSON')}</Button>
          <div style={{ height: 8 }} />
          <Button variant="ghost" icon="upload" onClick={share}>{t('Share .json')}</Button>
          <div className="dim small" style={{ margin: '10px 2px 0', lineHeight: 1.45 }}>
            {t('Read-only: this is what the app stores, not an editor.')}
          </div>
        </>}
  </>
}
