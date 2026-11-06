// Propostas: o que o cartão da Home mostra e como cada estado aparece. Puro, para o teste.
export const OPEN = ['pending', 'stale', 'blocked']
export const RECENT_AUTO_MS = 3 * 86400000

/** Gravada direto pelo chat, sem passkey. */
export const savedFromChat = p => p?.status === 'applied' && p?.mode === 'auto'

/** Abertas primeiro; depois as gravadas pelo chat nos últimos 3 dias, da mais nova para a mais velha. */
export function cardItems(list, now = Date.now()) {
  const abertas = (list || []).filter(p => OPEN.includes(p.status))
  const recentes = (list || []).filter(p => savedFromChat(p) && now - Date.parse(p.decided_at) < RECENT_AUTO_MS)
    .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))
  return [...abertas, ...recentes]
}
