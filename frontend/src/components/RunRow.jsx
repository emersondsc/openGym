// Linha de uma corrida no Histórico e na lista do dia (docs/specs/spec_corrida.md, DIP §11).
// Elevação, FC, esforço e nota não aparecem aqui, só no formulário aberto ao tocar.
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { fmtKm, fmtDuration, fmtPace, paceOf } from '../lib/activities.js'
import Icon from './Icon.jsx'

export default function RunRow({ run, showDate = true, onClick }) {
  const parts = [
    showDate ? fmtDate(run.d, true) : null,
    fmtKm(run.km), fmtDuration(run.sec), fmtPace(paceOf(run.km, run.sec)),
    t(run.place === 'treadmill' ? 'Treadmill' : 'Outdoor'),
  ].filter(Boolean)
  return <div className="item" onClick={onClick}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', fontSize: 19 }}><Icon name="figureRun" /></span>
    <div className="grow"><div className="tt">{t('Run')}</div><div className="ss">{parts.join(' · ')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
}
