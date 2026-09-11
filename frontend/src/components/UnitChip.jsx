// Chip de unidade (BACKLOG-01), na mesma gramática do RestChip: cinza quando o exercício
// herda a unidade do perfil, destacado em --acc quando tem unidade própria. Tocar abre o
// sheet com kg / lb / "Padrão do perfil".
import { t } from '../lib/i18n.js'
import { normUnit } from '../lib/units.js'
import Icon from './Icon.jsx'
import { useUI } from '../store/useUI.js'

export default function UnitChip({ value, base, onChange }) {
  const openSheet = useUI(s => s.openSheet)
  const profile = normUnit(base)
  // `value` igual ao perfil conta como "herda", mesmo que a chave exista: o editor só grava
  // quando difere (A-7), mas um plano importado ou o agente podem ter gravado `unit:'kg'`
  // num perfil kg — e aí o chip diria "própria" para um exercício que não tem nada de próprio.
  const own = value == null || normUnit(value) === profile ? null : normUnit(value)
  const unit = own == null ? profile : own
  const open = () => openSheet(close => (
    <>
      <h3>{t('Weight unit')}</h3>
      <div className="sect-b">
        {['kg', 'lb'].map(v => (
          <button key={v} className="lrow tap" onClick={() => { close(); onChange(v) }}>
            <span className="lrow-m"><span className="lrow-t">{v}</span></span>
            {unit === v && <Icon name="check" className="lrow-k" />}
          </button>
        ))}
        <button className="lrow tap" onClick={() => { close(); onChange(null) }}>
          <span className="lrow-m">
            <span className="lrow-t">{t('Default')} ({profile})</span>
            <span className="lrow-s">{t('Use the profile unit')}</span>
          </span>
          {own == null && <Icon name="check" className="lrow-k" />}
        </button>
      </div>
      <div style={{ height: 8 }} />
    </>
  ))
  return (
    <button className={'tag tap nocap' + (own != null ? ' acc' : '')} onClick={open}
      aria-label={t('Weight unit')}>
      <Icon name="scale" />{unit}
    </button>
  )
}
