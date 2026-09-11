// frontend/src/lib/unit-migration.js — a migração da unidade por exercício (BACKLOG-01).
//
// Vive aqui, e não dentro do store, por um motivo prático: é o único pedaço desta mudança que
// reescreve o estado do usuário **em silêncio**, e o store importa `document` — não roda em
// teste sem jsdom (o projeto não tem jsdom). Como função pura sobre um `storage` injetado, ela
// é testável de verdade em vez de por asserção sobre o texto do arquivo.
//
// Decisão U1 do usuário ("só daqui pra frente"): só a PRESCRIÇÃO é marcada. `workouts[]` nunca
// é tocado — uma sessão antiga não tem `target.unit` e continua resolvendo para `S.unit` (kg),
// que é exatamente o que o histórico precisa, porque ele JÁ está em kg (convertido à mão).
export const UNIT_PIN_KEY = 'gym_unit_pin_v1'
export const STATE_KEY = 'gym_state_v1'
// lever leg extension, lever seated leg curl — máquinas cuja escala é em libras.
export const LB_EXERCISES = ['0585', '0599']

/**
 * Marca `unit: 'lb'` nos dois aparelhos de perna que estão em libras. Idempotente e com marca
 * de "já feito": quem remover o `unit` à mão depois NÃO o vê voltar no próximo carregamento.
 *
 * Devolve quantas entradas foram marcadas (0 = nada a fazer).
 *
 * Duas ordens importam aqui, as duas aprendidas na revisão da spec:
 *  1. A flag só é marcada quando há rotinas para migrar — num aparelho novo, sem estado ainda,
 *     marcar a flag faria a migração nunca acontecer quando o estado chegasse do servidor.
 *  2. O estado migrado é GRAVADO antes da flag. `loadState` devolve o objeto em memória, mas se
 *     o boot não disparar nenhum `persist` (caso comum: o `pullState` cai no ramo que não
 *     persiste quando o estado local já tem dados e o servidor não é mais novo), o localStorage
 *     continuaria com as rotinas sem `unit` e a flag já marcada — no boot seguinte a migração
 *     não roda mais e o exercício volta a ser lido em kg, em silêncio.
 */
export function pinUnits(state, storage = localStorage, stateKey = STATE_KEY) {
  try {
    if (storage.getItem(UNIT_PIN_KEY)) return 0
    if (!(state.routines || []).length) return 0
    let n = 0
    const pin = ex => { if (LB_EXERCISES.includes(ex.id) && ex.unit == null) { ex.unit = 'lb'; n++ } }
    ;(state.routines || []).forEach(r => (r.ex || []).forEach(pin))
    // `active` entra junto: um treino interrompido que volta depois da atualização não pode
    // continuar lendo o aparelho em kg no meio da sessão.
    ;((state.active || {}).entries || []).forEach(e => { if (e.target) pin(e.target) })
    if (n) storage.setItem(stateKey, JSON.stringify(state))
    storage.setItem(UNIT_PIN_KEY, '1')
    return n
  } catch {
    // localStorage privado/quota: sem migração, o app segue lendo pela unidade do perfil.
    return 0
  }
}
