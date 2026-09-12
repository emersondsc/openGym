#!/usr/bin/env node
// Guarda o invariante do catálogo único: frontend/src/lib/exercises-data.json é a ÚNICA lista de
// exercícios do parque (app, API e agente leem este arquivo) e ela precisa estar sã.
//
//   node scripts/check-exercises.mjs [--media DIR] [--fix]
//
// O que confere:
//   1. é JSON válido e é uma lista;
//   2. todo `id` é único e tem 4 dígitos;
//   3. as 10 chaves existem em TODAS as entradas (id n bp eq tg mg sm st img gif);
//   4. `n` não é vazio e não tem caractere fora do Latin-1 básico — foi assim que um `в`
//      cirílico (U+0432) entrou em 4 nomes (`0738`, `0739`, `0740`, `0742`) e sobreviveu
//      porque nada olhava;
//   5. cada `img` e `gif` existe no diretório de mídia.
//
// Avisos (não afetam o código de saída): contagem diferente de CATALOG_EXPECTED.
// Erros (saída 1): tudo o mais, nomeando id e campo.
//
// `--fix` corrige só o defeito 4 quando o homoglifo está colado antes do `°`, com backup.
// Homoglifo em outra posição é erro fatal e NÃO é corrigível automaticamente.
// Não reordena, não renomeia, não baixa mídia.
//
// Sai 0 quando não há erro, 1 quando há, 2 em erro de uso (argumento sem valor).
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG_EXPECTED } from '../api/catalog.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Esta conferência olha SEMPRE o arquivo canônico: `OG_CATALOG` é override de teste, não de repo.
const CATALOG = join(root, 'frontend', 'src', 'lib', 'exercises-data.json')
const FIELDS = ['id', 'n', 'bp', 'eq', 'tg', 'mg', 'sm', 'st', 'img', 'gif']
// Letras que se parecem com latinas e passaram despercebidas: cirílico e grego.
const HOMOGLYPH = /[\u0370-\u03ff\u0400-\u04ff]/
// Um OU MAIS homoglifos antes do °: uma correção manual apressada pode ter deixado `вв°`, e o
// --fix tem de conseguir limpar o que ele mesmo poderia ter deixado pela metade.
const HOMOGLYPH_BEFORE_DEGREE = /[\u0370-\u03ff\u0400-\u04ff]+(?=°)/g

const args = process.argv.slice(2)
const flag = n => args.includes(n)
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const USAGE = 'uso: node scripts/check-exercises.mjs [--media DIR] [--fix]'
if (flag('--help')) { console.log(USAGE); process.exit(0) }
// Argumento que exige valor e veio sem ele é erro de uso, não um default silencioso.
for (const n of ['--media']) {
  if (args.includes(n) && (!opt(n) || opt(n).startsWith('--'))) {
    console.error(`${n} exige um diretório\n${USAGE}`)
    process.exit(2)
  }
}
if (process.env.OG_CATALOG) {
  console.warn(`aviso: OG_CATALOG está definida (${process.env.OG_CATALOG}) — esta conferência `
    + 'ignora o override e olha o arquivo canônico.')
}

const mediaDir = opt('--media') || join(root, 'media')
const fix = flag('--fix')

let raw, data
try { raw = readFileSync(CATALOG, 'utf8') } catch (e) {
  console.error(`FALHA: não consegui ler ${CATALOG}: ${e.message}`)
  process.exit(1)
}
try { data = JSON.parse(raw) } catch (e) {
  console.error(`FALHA: ${CATALOG} não é JSON válido: ${e.message}`)
  process.exit(1)
}
if (!Array.isArray(data)) {
  console.error('FALHA: o catálogo precisa ser uma lista')
  process.exit(1)
}

const problems = []
const warnings = []
const seen = new Map()
const fixed = new Map()   // id → nome corrigido

for (const [i, e] of data.entries()) {
  const where = e && e.id ? e.id : `#${i}`
  if (!e || typeof e !== 'object' || Array.isArray(e)) {
    problems.push([where, 'entrada não é objeto', ''])
    continue
  }
  for (const f of FIELDS) if (!(f in e)) problems.push([where, `campo ausente: ${f}`, ''])
  if (!/^\d{4}$/.test(String(e.id ?? ''))) {
    problems.push([where, `id fora do padrão 4 dígitos: ${JSON.stringify(e.id)}`, ''])
  }
  if (seen.has(e.id)) problems.push([where, `id repetido (também em #${seen.get(e.id)})`, ''])
  else seen.set(e.id, i)

  if (typeof e.n !== 'string' || !e.n.trim()) {
    problems.push([where, 'nome vazio', ''])
  } else if (HOMOGLYPH.test(e.n)) {
    const cleaned = e.n.replace(HOMOGLYPH_BEFORE_DEGREE, '')
    if (cleaned !== e.n && !HOMOGLYPH.test(cleaned)) {
      if (fix) fixed.set(e.id, cleaned)
      else problems.push([where, `nome com homoglifo: ${JSON.stringify(e.n)}`,
                          `sugerido: ${JSON.stringify(cleaned)}`])
    } else {
      // Não é o padrão conhecido (homoglifo antes do °) — não há como adivinhar o nome certo.
      problems.push([where, `nome com homoglifo fora do padrão antes do °: ${JSON.stringify(e.n)}`,
                     'NÃO corrigível automaticamente — corrija à mão'])
    }
  }

  for (const k of ['img', 'gif']) {
    // Campo ausente já é erro no laço de FIELDS; aqui o valor precisa ser string não vazia,
    // senão `img: null` passaria calado.
    if (typeof e[k] !== 'string' || !e[k]) {
      problems.push([where, `${k} vazio ou não é texto: ${JSON.stringify(e[k])}`, ''])
    } else if (!existsSync(join(mediaDir, k, e[k]))) {
      problems.push([where, `${k} não encontrado em ${join(mediaDir, k)}: ${e[k]}`, ''])
    }
  }
}

if (data.length !== CATALOG_EXPECTED) {
  warnings.push(`o catálogo tem ${data.length} exercícios; o esperado é ${CATALOG_EXPECTED} `
    + '(a base pode crescer — se cresceu de propósito, atualize CATALOG_EXPECTED em api/catalog.js)')
}

if (fix && fixed.size) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
  copyFileSync(CATALOG, `${CATALOG}.bak.${stamp}`)
  for (const e of data) if (fixed.has(e.id)) e.n = fixed.get(e.id)
  writeFileSync(CATALOG, JSON.stringify(data, null, 0), 'utf8')
  console.log(`--fix: ${fixed.size} nome(s) corrigido(s) — backup em ${CATALOG}.bak.${stamp}`)
  for (const [id, n] of fixed) console.log(`  ${id}: ${n}`)
}

for (const w of warnings) console.warn(`  aviso: ${w}`)
if (problems.length) {
  for (const [where, msg, hint] of problems) {
    console.error(`  ${where}: ${msg}${hint ? ` — ${hint}` : ''}`)
  }
  console.error(`\n${problems.length} problema(s) em ${CATALOG}`)
  process.exit(1)
}
console.log(`ok: ${data.length} exercícios, ${FIELDS.length} campos, mídia conferida em ${mediaDir}`)
