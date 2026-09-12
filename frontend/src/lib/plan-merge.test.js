// frontend/src/lib/plan-merge.test.js — o gatilho do aviso de "plano atualizado" (BACKLOG-09).
//
// `planChanged` é o que decide se o app avisa que o plano guardado mudou. Ele compara o plano do
// SERVIDOR com a base que este aparelho baixou (decisão do usuário de 12/09/2026: o aviso dispara
// pelo fato de o plano ter mudado, sem separar quem escreveu).
import { describe, it, expect } from 'vitest'
import { planChanged } from './plan-merge.js'

const r = (id, weight) => ({ id, name: id, prog: 'off', ex: [{ id: '0326', sets: 2, weight }] })

describe('planChanged — o plano do servidor mudou em relação à base do aparelho?', () => {
  it('base vazia e servidor com rotina: mudou', () => {
    expect(planChanged([r('r1', 8)], {})).toBe(true)
  })

  it('servidor igual à base: não mudou', () => {
    expect(planChanged([r('r1', 8)], { r1: r('r1', 8) })).toBe(false)
  })

  it('peso diferente da base: mudou', () => {
    expect(planChanged([r('r1', 10)], { r1: r('r1', 8) })).toBe(true)
  })

  it('rotina que estava na base e sumiu do servidor: mudou', () => {
    expect(planChanged([], { r1: r('r1', 8) })).toBe(true)
  })

  it('rotina nova no servidor: mudou', () => {
    expect(planChanged([r('r1', 8), r('r2', 20)], { r1: r('r1', 8) })).toBe(true)
  })

  it('nada nos dois lados: não mudou', () => {
    expect(planChanged([], {})).toBe(false)
  })

  it('base ausente (aparelho sem livro-caixa): qualquer plano do servidor conta como mudança', () => {
    expect(planChanged([r('r1', 8)], undefined)).toBe(true)
  })

  // Deliberado: `JSON.stringify` é sensível à ordem das chaves, então uma rotina com os mesmos
  // valores em ordem diferente CONTA como mudança e liga o aviso. Está fixado aqui para o
  // comportamento ser conhecido, e não descoberto como surpresa (ver "Riscos" na spec).
  it('mesmas chaves em ORDEM diferente: MUDOU (comportamento fixado de propósito)', () => {
    const a = { id: 'r1', name: 'r1', prog: 'off', ex: [{ id: '0326', sets: 2, weight: 8 }] }
    const b = { ex: [{ weight: 8, sets: 2, id: '0326' }], prog: 'off', name: 'r1', id: 'r1' }
    expect(planChanged([a], { r1: b })).toBe(true)
  })
})
