import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { effectiveRoutines } from '../lib/history.js'
import { dayModeOf } from '../lib/schedule.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

export default function TabBar({ onStart, onStartDay }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const guard = useUI(s => s.leaveGuard)
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'settings' && k === 'home')

  const startWorkout = () => {
    if (guard && !guard('/workout')) return
    if (!S.active) {
      const iso = todayISO()
      const rs = effectiveRoutines(S, iso).filter(r => r.ex.length)
      if (rs.length > 1 && onStartDay) {
        const mode = dayModeOf(S, new Date(iso + 'T12:00:00').getDay())
        onStartDay(rs, mode)
        return
      }
      if (rs.length === 1) { onStart(rs[0].id); return }
    }
    nav('/workout')
  }
  // A barra e renderizada fora das rotas: sem consultar o guarda, tocar numa aba levaria embora
  // o rascunho da tela de edicao sem perguntar nada.
  const go = to => { if (guard && !guard(to)) return; nav(to) }
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => go(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <button className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} />
      <Tab k="library" icon="list" to="/library" label={t('Exercises')} />
    </nav>
  )
}
