// Catálogo e preferências dos cards ocultáveis de Home e Stats.
// O estado fica em S.hiddenCards = { home: { [id]: true }, stats: { [id]: true } }.

export const HOME_CARDS = [
  { id: 'welcome', label: 'Welcome!' },
  { id: 'streak', label: 'Week streak' },
  { id: 'volume', label: 'Weekly volume' },
  { id: 'proposals', label: 'Coach' },
  { id: 'exercise', label: 'Exercise progress' },
]

export const STATS_CARDS = [
  { id: 'heatmap', label: 'Activity — last 12 months' },
  { id: 'recent', label: 'Recent workouts' },
  { id: 'coach', label: 'Your progress' },
  { id: 'muscles', label: 'Muscle balance' },
  { id: 'effort', label: 'Effort' },
  { id: 'weight', label: 'Body weight' },
  { id: 'exercise', label: 'Exercise progress' },
]

export const SCREEN_CARDS = { home: HOME_CARDS, stats: STATS_CARDS }

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const copyMap = v => (isObj(v) ? { ...v } : {})

export function isCardHidden(S, screen, id) {
  return S?.hiddenCards?.[screen]?.[id] === true
}

export function withCardHidden(hiddenCards, screen, id, hidden) {
  const valid = SCREEN_CARDS[screen]?.some(c => c.id === id)
  const cur = isObj(hiddenCards) ? hiddenCards : {}
  const base = { home: copyMap(cur.home), stats: copyMap(cur.stats) }
  if (!valid) return base
  if (hidden) base[screen][id] = true
  else delete base[screen][id]
  return base
}

export function clearHiddenCards(hiddenCards, screen) {
  const cur = isObj(hiddenCards) ? hiddenCards : {}
  if (!screen) return { home: {}, stats: {} }
  const base = { home: copyMap(cur.home), stats: copyMap(cur.stats) }
  if (SCREEN_CARDS[screen]) base[screen] = {}
  return base
}

/** Lista de cards aplicáveis ao perfil na tela dada (inclui sempre os já ocultos para permitir reexibir). */
export function visibleCardsFor(S, user, screen, hasEffort) {
  const list = SCREEN_CARDS[screen] || []
  return list.filter(c => {
    if (isCardHidden(S, screen, c.id)) return true
    if (screen === 'home' && c.id === 'welcome') return !(S?.routines?.length)
    if (screen === 'home' && c.id === 'proposals') return !!user?.coachOwner
    if (screen === 'stats' && c.id === 'effort') return !!hasEffort
    return true
  })
}

export function countHidden(S, screen, cards = SCREEN_CARDS[screen] || []) {
  return cards.filter(c => isCardHidden(S, screen, c.id)).length
}
