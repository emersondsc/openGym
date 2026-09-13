// frontend/src/views/PlanRaw.jsx — o JSON cru de UM mesociclo (só leitura).
//
// Só o mesociclo. É o único objeto do app que esta tela pode mostrar sem inventar nada: ele é
// lido e escrito exatamente como está, e é o único cujo arquivo o app importa de volta.
//
// O que NÃO existe mais aqui, de propósito: escopos de "plano" e de "estado". O plano não é um
// objeto guardado — era um envelope montado na hora, que parecia um arquivo do app sem ser — e o
// estado inteiro é o backup, que vive em Settings. Nome de arquivo que não existe (`plan.json`)
// também saiu: o subtítulo diz o que a coisa é.
//
// O aviso de "cópia à frente do servidor" saiu desta entrega por decisão do usuário e está na
// BACKLOG-17 (precisa de um sinal de verdade no store; o `gym_dirty` de hoje só liga quando o
// envio FALHA). O mesociclo grande (até 64 KB) está na BACKLOG-18.
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { mesoToJSON } from '../lib/meso-file.js'
import { pickMeso } from '../lib/meso.js'
import { exportMeso, mesoFormSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Uma linha ou muitas: a chave em inglês é a fonte, então o singular precisa da sua própria.
const lineCount = n => t(n === 1 ? '{0} line' : '{0} lines', n)

export default function PlanRaw() {
  const [q] = useSearchParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)

  // `?id=` manda; sem id (ou com um id que sumiu) cai no ATIVO e depois no primeiro — chegar aqui
  // sem id mostra o mesociclo da vez, nunca um erro.
  const meso = pickMeso(S.mesos, q.get('id'), S.activeMeso)

  const json = meso ? mesoToJSON(meso) : ''
  const kb = meso ? new Blob([json]).size / 1024 : 0
  const lines = json ? json.split('\n').length : 0

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      useUI.getState().toast(t('Copied'))
    } catch { useUI.getState().toast(t('Could not copy')) }
  }

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <h1 style={{ fontSize: 24 }}>{meso ? meso.name : t('Mesocycle')}</h1>
        <div className="sub">
          {t('mesocycle object')}{meso ? ` · ${fmtNum(kb)} KB · ${lineCount(lines)}` : ''}
        </div>
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
          <Button variant="ghost" icon="upload" onClick={() => exportMeso(meso, 'json')}>{t('Share .json')}</Button>
          <div className="dim small" style={{ margin: '10px 2px 0', lineHeight: 1.45 }}>
            {t('Read-only: this is what the app stores, not an editor.')}
          </div>
        </>}
  </>
}
