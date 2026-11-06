// Ligação ao treinador do chat (spec_treinador_por_usuario.md): a API decide; aqui só há chamadas.
import { api, proveChallenge } from './api.js'
import { minutesLeft } from './coach-link-time.js'

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) })

export const getCoachLink = () => api('/api/coach-link').then(r => r.linked)
export const unlinkCoach = () => post('/api/coach-link/unlink')
/** Passkey com biometria ou PIN e, de volta, o código de uso único. */
export async function startCoachLink() {
  const challenge = await post('/api/coach-link/challenge')
  const proof = await proveChallenge(challenge)
  return post('/api/coach-link/start', proof)
}
export { minutesLeft }
