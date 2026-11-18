import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildSets, targetSummary, exLine, bestEntryFor, bestWeightFor, migrateLegacyRepRange } from './history.js'
import { bestSetOf, e1rmSeries, is1RMRecord } from './onerm.js'
import { applyWorkoutEdit, mergeCustomSetRoles } from './workout-edit.js'
import { buildPlanBundle, parsePlan, planPrintHTML } from './plan-share.js'
import { groupChanges } from './proposal-diff.js'
import { resolveRoleClass, resolveRoleName } from './set-roles.js'

const LIFT = '0739'
const PULL = '0651'
const customSetRoles = [
  { id: 'cr_top', name: 'Top Set', baseClass: 'standard' },
  { id: 'cr_drop', name: 'Drop-set', baseClass: 'intensified' },
  { id: 'cr_ramp', name: 'Rampa', baseClass: 'prep' },
  { id: 'cr_del', name: 'Antigo', baseClass: 'prep', deleted: true }
]

describe('set-roles dominio & fallback', () => {
  it('resolve classes e nomes nativos, customizados e tombstones', () => {
    expect(resolveRoleClass(undefined, customSetRoles)).toBe('standard')
    expect(resolveRoleClass('warmup', customSetRoles)).toBe('prep')
    expect(resolveRoleClass('cr_drop', customSetRoles)).toBe('intensified')
    expect(resolveRoleClass('cr_del', customSetRoles)).toBe('prep')
    expect(resolveRoleClass('cr_unknown', customSetRoles)).toBe('standard')
    expect(resolveRoleName('cr_top', customSetRoles)).toBe('Top Set')
    expect(resolveRoleName('cr_del', customSetRoles)).toBe('Antigo')
    expect(resolveRoleName('cr_unknown', customSetRoles, x => x)).toBe('Working')
  })
})

describe('buildSets por papel (sem misturar cargas e exWeights)', () => {
  it('preenche por papel relativo, converte wUnit e nunca herda exWeights em prep/backoff', () => {
    const S = {
      unit: 'kg',
      customSetRoles,
      exWeights: { [LIFT]: { w: 180, d: '2026-11-10' } },
      workouts: [{
        d: '2026-11-10',
        entries: [{
          id: LIFT,
          target: { unit: 'kg' },
          sets: [
            { w: 60, r: 8, done: true, role: 'warmup' },
            { w: 220.46, wUnit: 'lb', r: 5, done: true, role: 'cr_top' },
            { w: 140, r: 10, done: true },
            { w: 110, r: 14, done: true, role: 'backoff' }
          ]
        }]
      }]
    }
    const cfg = {
      id: LIFT,
      sets: 5,
      weight: 180, // espelho do topo NAO deve vazar para series sem weight em setTargets
      setTargets: [
        { role: 'warmup', reps: 8 },
        { role: 'pap', reps: 2 },
        { role: 'cr_top', reps: 5, goal: true },
        { reps: '8-12' },
        { role: 'backoff', reps: '12-15' }
      ]
    }
    const out = buildSets(S, cfg)
    expect(out[0]).toEqual({ w: 60, r: 8, done: false, role: 'warmup' })
    // pap novo sem historico nem peso explicito nunca puxa exWeights=180
    expect(out[1]).toEqual({ w: 0, r: 2, done: false, role: 'pap' })
    // cr_top puxou 220.46 lb convertidos ~100 kg
    expect(out[2].role).toBe('cr_top')
    expect(out[2].w).toBeCloseTo(100, 1)
    expect(out[3]).toEqual({ w: 140, r: 8, done: false })
    expect(out[4]).toEqual({ w: 110, r: 12, done: false, role: 'backoff' })
  })

  it('respeita st.weight === 0 explicito em bodyweight mesmo havendo carga no historico', () => {
    const S = {
      unit: 'kg',
      exWeights: { [PULL]: { w: 20 } },
      workouts: [{ d: '2026-11-10', entries: [{ id: PULL, sets: [{ w: 15, r: 8, done: true }] }] }]
    }
    const out = buildSets(S, {
      id: PULL, sets: 2, bodyweight: true,
      setTargets: [{ role: 'warmup', weight: 0, reps: 5 }, { weight: 15, reps: 8, goal: true }]
    })
    expect(out[0]).toEqual({ w: 0, r: 5, done: false, role: 'warmup' })
    expect(out[1]).toEqual({ w: 15, r: 8, done: false })
  })

  it('alinha historico legado sem role a partir do fim para nao puxar aquecimento antigo em work', () => {
    const S = {
      unit: 'kg', exWeights: {},
      workouts: [{
        d: '2026-11-01',
        entries: [{ id: LIFT, sets: [{ w: 40, r: 10, done: true }, { w: 100, r: 8, done: true }, { w: 100, r: 8, done: true }] }]
      }]
    }
    const out = buildSets(S, {
      id: LIFT, sets: 3,
      setTargets: [{ role: 'warmup', reps: 8 }, { reps: 8, goal: true }, { reps: 8, goal: true }]
    })
    expect(out[1].w).toBe(100)
    expect(out[2].w).toBe(100)
  })
})

describe('targetSummary e exLine com setTargets e nome do papel', () => {
  it('exibe prefixo com nome do papel quando diferente de Trabalho e resume em exLine', () => {
    const target = {
      sets: 4, mode: 'reps', weight: 200, reps: 5, targetRir: 1,
      setTargets: [
        { role: 'warmup', weight: 90, reps: 8 },
        { role: 'cr_top', weight: 200, reps: 5, targetRir: 1, goal: true },
        { role: 'backoff', weight: 150, reps: '10-12', targetRir: 2 }
      ]
    }
    const sum = targetSummary({ id: LIFT, target }, 'kg', 'rir', customSetRoles)
    expect(sum).toEqual({ parts: ['Top Set', '1 × 5', '200 kg'], eff: 'RIR 1' })
    expect(exLine(target, 'kg', customSetRoles)).toBe('Top Set · 1 × 5 · 200 kg (+1)')
  })

  it('omite prefixo quando papel principal for Trabalho padrao', () => {
    const target = {
      sets: 3, mode: 'reps',
      setTargets: [
        { role: 'warmup', weight: 60, reps: 8 },
        { weight: 100, reps: '8-12', targetRir: 2, goal: true },
        { weight: 100, reps: '8-12', targetRir: 2, goal: true }
      ]
    }
    expect(targetSummary({ id: LIFT, target }, 'kg', 'rir', customSetRoles))
      .toEqual({ parts: ['2 × 8–12', '100 kg'], eff: 'RIR 2' })
  })
})

describe('isolamento de PRs, exWeights, topW e onerm.js', () => {
  it('exclui prep de bestEntryFor/applyWorkoutEdit e exclui prep+intensified de onerm.js', () => {
    const entry = {
      id: LIFT,
      sets: [
        { w: 220, r: 2, done: true, role: 'pap' },       // prep -> fora de TUDO
        { w: 210, r: 8, done: true, role: 'cr_drop' },   // intensified -> fora de e1RM
        { w: 180, r: 5, done: true }                     // standard -> 180*(1+5/30) = 210
      ]
    }
    expect(bestSetOf(entry, 'epley', customSetRoles)).toEqual({ est: 210, w: 180, r: 5 })
    const S = {
      unit: 'kg',
      customSetRoles,
      exWeights: {},
      workouts: [{ id: 'w1', d: '2026-11-10', start: 1, entries: [entry] }]
    }
    expect(bestWeightFor(S, LIFT)).toBe(210) // excluiu pap 220, manteve cr_drop 210
    expect(e1rmSeries(S, LIFT)).toEqual([{ t: 1, d: '2026-11-10', y: 210, w: 180, r: 5 }])
    // PAP de 250 nao deve bater recorde de 1RM nem virar topW
    expect(is1RMRecord(S, LIFT, { id: LIFT, sets: [{ w: 250, r: 3, done: true, role: 'pap' }] })).toBeNull()

    const edited = applyWorkoutEdit(S, 'w1', {
      name: 'A', d: '2026-11-10', start: 1, end: 2,
      entries: [{
        id: LIFT,
        sets: [
          { w: 230, r: 2, done: true, role: 'pap' },
          { w: 185, r: 5, done: true }
        ]
      }]
    })
    expect(edited.workout.entries[0].topW).toBe(185)
    expect(edited.exWeights[LIFT].w).toBe(185)
  })
})

describe('migracao repsMin, mergeCustomSetRoles, plan-share e proposal-diff', () => {
  it('converte repsMin/repsMax legados para A-B e mergeCustomSetRoles preserva tombstones', () => {
    expect(migrateLegacyRepRange({ reps: 12, repsMin: 8 })).toBe('8-12')
    expect(migrateLegacyRepRange({ reps: 8, repsMin: 8, repsMax: 12 })).toBe('8-12')
    expect(migrateLegacyRepRange({ reps: '8-12', repsMin: 8 })).toBeNull()

    const merged = mergeCustomSetRoles(
      [{ id: 'cr_1', name: 'Drop', baseClass: 'intensified' }, { id: 'cr_2', name: 'Top', baseClass: 'standard' }],
      [{ id: 'cr_1', name: 'Drop', baseClass: 'intensified', deleted: true }, { id: 'cr_3', name: 'Rampa', baseClass: 'prep' }]
    )
    expect(merged.find(r => r.id === 'cr_1').deleted).toBe(true)
    expect(merged.filter(r => !r.deleted).map(r => r.id)).toEqual(['cr_2', 'cr_3'])
  })

  it('plan-share exporta/importa setTargets sanitizando cr_* externos e proposal-diff formata setTargets', () => {
    const S = {
      unit: 'kg', customEx: [], week: {},
      customSetRoles: [{ id: 'cr_1', name: '<script>x</script>', baseClass: 'standard' }],
      routines: [{
        id: 'r1', name: 'A', emoji: 'A', prog: 'linear',
        ex: [{
          id: LIFT, sets: 2, mode: 'reps', weight: 100, reps: '8-12',
          setTargets: [
            { role: 'warmup', weight: 50, reps: 8 },
            { role: 'cr_1', weight: 100, reps: '8-12', targetRir: 2, goal: true }
          ]
        }]
      }]
    }
    const bundle = buildPlanBundle(S, 'Plano')
    expect(bundle.routines[0].prog).toBeUndefined()
    // Custom role local virou work (role omitido) no arquivo exportado
    expect(bundle.routines[0].ex[0].setTargets[1].role).toBeUndefined()
    const parsed = parsePlan(bundle)
    expect(parsed.routines[0].ex[0].setTargets.length).toBe(2)

    const html = planPrintHTML(S, 'Dono')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; · 1 × 8–12 · 100 kg')

    const { groups } = groupChanges([
      { path: 'routines.0.ex.0.setTargets.1.weight', before: 100, after: 105 },
      { path: 'routines.0.ex.0.setTargets.0.role', before: 'work', after: 'warmup' }
    ])
    expect(groups[0].rows.map(r => r.label)).toEqual(['Set 2 · Weight', 'Set 1 · Role'])
  })
})

describe('remocao da Progressao Automatica e cobertura dos 11 locales', () => {
  it('progression.js e progression.test.js nao existem mais', () => {
    expect(fs.existsSync(path.resolve('src/lib/progression.js'))).toBe(false)
    expect(fs.existsSync(path.resolve('src/lib/progression.test.js'))).toBe(false)
  })

  it('todos os 11 arquivos de locale definem as chaves da Entrega 2 nao vazias', () => {
    const modules = import.meta.glob('../locales/*.js', { eager: true })
    const entries = Object.entries(modules)
    expect(entries.length).toBe(11)
    const requiredKeys = [
      'Set roles', 'Set role', 'Roles', 'Working', 'Back-off', 'Warm-up', 'Feeder', 'PAP',
      'Prep', 'Prep · no RIR', 'Standard work', 'Intensified work',
      'Add role', 'Edit role', 'Delete role', 'Delete role?', 'Role name',
      'Accounting class', 'Exact', 'Range', 'From', 'To', 'Per-set targets',
      'Use single target?', 'Collapse', 'Goal', 'meta'
    ]
    for (const [file, mod] of entries) {
      const dict = mod.default
      expect(typeof dict, file).toBe('object')
      for (const k of requiredKeys) {
        expect(typeof dict[k], `${file}:${k}`).toBe('string')
        expect(dict[k].trim().length, `${file}:${k}`).toBeGreaterThan(0)
      }
    }
  })
})
