// Web Push subscribe/unsubscribe — requires a signed-in profile (subscriptions are stored
// server-side per user, same as everything else under /api).
import { api } from './api.js'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported')

const urlBase64ToUint8Array = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

// Este aparelho quer push. A permissão do navegador não diz isso: ela continua `granted` depois de
// desligar a chave em Ajustes.
const WANTED = 'gym_push_wanted'

async function subscribeHere(reg) {
  const { key } = await api('/api/push/public-key')
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) })
  localStorage.setItem(WANTED, '1')
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications permission was not granted')
  await subscribeHere(await navigator.serviceWorker.ready)
}

/**
 * Ao abrir o app: refaz a inscrição que morreu sem ninguém ver. O serviço de push expira o endpoint,
 * o servidor apaga o registro no 410 e o navegador continua listando a inscrição velha, então só
 * perguntar ao navegador não basta: quem sabe é o servidor. Nunca pede permissão.
 */
export async function syncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub && localStorage.getItem(WANTED) !== '1') return
  if (sub) {
    const { known } = await api('/api/push/check', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) })
    if (known) { localStorage.setItem(WANTED, '1'); return }
    await sub.unsubscribe()
  }
  await subscribeHere(reg)
}

export async function disablePush() {
  if (!pushSupported()) return
  localStorage.removeItem(WANTED)
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
}

export const sendTestPush = () => api('/api/push/test', { method: 'POST', body: '{}' })
