// Ligação ao treinador do chat (spec_treinador_por_usuario.md e spec_liberacao_pelo_app.md): a API
// decide; aqui só há chamadas.
import { api, proveChallenge } from './api.js'
import { coachStage, errorText, minutesLeft } from './coach-link-time.js'

export const CONNECTOR_URL = 'https://gym-mcp.edsc.fun/mcp'
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) })

/** `{linked, allowed, owner}`: ligação, e-mail ativado e se é o dono. */
export const getCoachAccess = () => api('/api/coach-link')
export const getCoachLink = () => getCoachAccess().then(r => r.linked)
export const unlinkCoach = () => post('/api/coach-link/unlink')
/** Passkey com biometria ou PIN e, de volta, o código de uso único. */
export async function startCoachLink() {
  const challenge = await post('/api/coach-link/challenge')
  const proof = await proveChallenge(challenge)
  return post('/api/coach-link/start', proof)
}
/** Ativar: o e-mail entra na lista do conector e o código sai junto, com a mesma passkey. */
export async function activateCoach(email) {
  const challenge = await post('/api/coach-link/challenge')
  const proof = await proveChallenge(challenge)
  return post('/api/coach-link/activate', { ...proof, email })
}
export { coachStage, errorText, minutesLeft }
