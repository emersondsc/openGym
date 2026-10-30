// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./api.js', () => ({ api: vi.fn() }))
const { api } = await import('./api.js')
const { syncPush, disablePush } = await import('./push.js')

function device({ permission = 'granted', sub = null, wanted = false, known = true } = {}) {
  const store = new Map(wanted ? [['gym_push_wanted', '1']] : [])
  const fresh = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/new' }) }
  const pushManager = { getSubscription: vi.fn(async () => sub), subscribe: vi.fn(async () => fresh) }
  vi.stubGlobal('localStorage', {
    getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k)
  })
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({ pushManager }) } })
  const Notification = { permission }
  vi.stubGlobal('window', { PushManager: class {}, Notification })
  vi.stubGlobal('Notification', Notification)
  api.mockImplementation(async url => {
    if (url === '/api/push/check') return { known }
    if (url === '/api/push/public-key') return { key: 'AAAA' }
    return { ok: true }
  })
  return { pushManager, store }
}
const called = url => api.mock.calls.some(c => c[0] === url)

describe('syncPush', () => {
  beforeEach(() => api.mockReset())
  afterEach(() => vi.unstubAllGlobals())

  it('sem permissão não faz nada', async () => {
    const { pushManager } = device({ permission: 'default', wanted: true })
    await syncPush()
    expect(pushManager.getSubscription).not.toHaveBeenCalled()
  })
  it('quem desligou a chave não é reinscrito', async () => {
    const { pushManager } = device()
    await syncPush()
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })
  it('inscrição que o servidor conhece fica como está', async () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/a', unsubscribe: vi.fn() }
    const { pushManager, store } = device({ sub })
    await syncPush()
    expect(sub.unsubscribe).not.toHaveBeenCalled()
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(store.get('gym_push_wanted')).toBe('1')
  })
  it('inscrição que o servidor perdeu é trocada por uma nova', async () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/a', unsubscribe: vi.fn() }
    const { pushManager } = device({ sub, known: false })
    await syncPush()
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(pushManager.subscribe).toHaveBeenCalled()
    expect(called('/api/push/subscribe')).toBe(true)
  })
  it('inscrição que sumiu do navegador volta se o aparelho queria push', async () => {
    const { pushManager } = device({ wanted: true })
    await syncPush()
    expect(pushManager.subscribe).toHaveBeenCalled()
  })
  it('desligar limpa a vontade do aparelho', async () => {
    const { store } = device({ wanted: true })
    await disablePush()
    expect(store.has('gym_push_wanted')).toBe(false)
  })
})
