// Propostas do treinador: a API decide tudo; aqui só há chamadas e a prova de passkey.
import { api, proveChallenge } from './api.js'

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) })

export const listProposals = (all = false) => api(`/api/proposals${all ? '?all=1' : ''}`).then(r => r.proposals)
export const getProposal = id => api(`/api/proposals/${encodeURIComponent(id)}`)
export const rejectProposal = (id, reason) => post(`/api/proposals/${encodeURIComponent(id)}/reject`, { reason })

// O desafio é preso a esta proposta e a este hash: aprovar depois de ela mudar é recusado.
export async function approveProposal(id, hash) {
  const url = `/api/proposals/${encodeURIComponent(id)}`
  const challenge = await post(`${url}/challenge`, { approval_hash: hash })
  const proof = await proveChallenge(challenge)
  return post(`${url}/approve`, { ...proof, approval_hash: hash })
}
