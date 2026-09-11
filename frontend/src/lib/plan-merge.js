// frontend/src/lib/plan-merge.js — funções puras do sync de plano (BACKLOG-07/09).
//
// Separadas do store de propósito: são lógica de dados (o que adotar, o que preservar, qual base
// mandar) sem nada de React/DOM, então dão para testar isoladamente — o store importa o `document`
// e não roda em ambiente de teste sem jsdom.
//
// A regra que estas funções implementam foi decidida pelo usuário em 11/09/2026: **o que ele fez
// no app vence o que o assistente escreveu**, e o resto (rotina que ele não tocou) passa a ser a
// versão do servidor.

const BASE_KEY = 'gym_base_routines_v1'

/** Cópia das rotinas como este aparelho as BAIXOU — livro-caixa do aparelho, não do servidor. */
export function rememberBase(routines) {
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(
      Object.fromEntries((routines || []).map(r => [r.id, r]))))
  } catch { /* quota/privado: sem base, o adotador trata como "não mexi" */ }
}

export function readBase() {
  try { return JSON.parse(localStorage.getItem(BASE_KEY)) || {} } catch { return {} }
}

/**
 * Decide quais rotinas ficam no estado local depois de um conflito.
 *  - igual à base (ou sem base) e existe no servidor  → a do SERVIDOR (foi o coach que mudou)
 *  - diferente da base (editada neste aparelho)       → a LOCAL (o usuário vence)
 *  - existia na base e sumiu do servidor              → some (foi apagada, e não foi você)
 *  - não está na base e não existe no servidor        → mantida (sem base não dá para provar que
 *    era do servidor: o mais seguro é não jogar fora o que pode ter sido criado aqui)
 * Devolve { routines, changed } — `changed` liga o aviso na tela.
 */
export function adoptServerRoutines(srv, local, base) {
  const b = base || {}
  const touched = r => b[r.id] !== undefined && JSON.stringify(r) !== JSON.stringify(b[r.id])
  const srvById = new Map((srv || []).map(r => [r.id, r]))
  const out = []
  let changed = false
  for (const s of srv || []) {
    const l = (local || []).find(x => x.id === s.id)
    if (!l) { out.push(s); continue }             // não existe aqui → a do servidor
    if (touched(l)) { out.push(l); changed = true; continue }   // editei aqui → a minha
    out.push(s)                                    // não toquei → a do servidor
  }
  for (const l of local || []) {
    if (srvById.has(l.id)) continue                // já resolvido acima
    if (b[l.id] === undefined) out.push(l)         // criada neste aparelho, o servidor nunca viu
    // existia na base e sumiu do servidor = apagada (e não fui eu) → não volta
  }
  return { routines: out, changed }
}

/** `If-Match` a enviar: a base LIDA (o servidor compara por igualdade). null = sem token. */
export const ifMatchFor = state => {
  const rev = state && Number.isInteger(state.rev) ? state.rev : null
  return rev == null ? null : String(rev)
}
