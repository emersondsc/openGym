// Botão discreto no canto do card para ocultá-lo; para a propagação para não disparar cards clicáveis.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { withCardHidden } from '../lib/cards.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

export default function HideCardBtn({ screen, id, label }) {
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const hide = e => {
    e.stopPropagation()
    update(s => { s.hiddenCards = withCardHidden(s.hiddenCards, screen, id, true) })
    toast(t('Card hidden — show again in Settings'))
  }
  return (
    <button
      type="button"
      className="card-hide"
      aria-label={t('Hide {0}', label)}
      title={t('Hide {0}', label)}
      onClick={hide}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
    >
      <Icon name="eyeOff" />
    </button>
  )
}
