import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..')

export function safeUidSegment(uid) {
  return String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '')
}

function normPathForCompare(p, platform = process.platform) {
  return platform === 'win32' ? p.toLowerCase() : p
}

function parseJsonMaybe(raw, label) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`JSON inválido em ${label}: ${err.message}`)
  }
}

export function resolveDevPaths({
  localAppData = process.env.LOCALAPPDATA,
  homeDir = os.homedir(),
  overrideDir = process.env.OPENGYM_DEV_DIR,
  platform = process.platform
} = {}) {
  const cleanOverride = typeof overrideDir === 'string' ? overrideDir.trim() : ''
  const cleanLocalAppData = typeof localAppData === 'string' ? localAppData.trim() : ''

  let baseDir
  if (cleanOverride) {
    baseDir = path.resolve(cleanOverride)
  } else if (platform === 'win32' && cleanLocalAppData) {
    baseDir = path.resolve(cleanLocalAppData, 'opengym-dev')
  } else {
    baseDir = path.resolve(homeDir || os.homedir(), '.opengym-dev')
  }

  const dataDir = path.join(baseDir, 'data')
  const mediaDir = path.join(baseDir, 'media')
  return {
    baseDir,
    dataDir,
    mediaDir,
    snapshotUidFile: path.join(dataDir, '.snapshot-uid'),
    snapshotTargetFile: path.join(dataDir, '.snapshot-target')
  }
}

function resolveCanonicalAllowingMissing(targetPath) {
  const resolved = path.resolve(targetPath)
  const missingParts = []
  let probe = resolved

  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    missingParts.unshift(path.basename(probe))
    probe = parent
  }

  const canonicalAncestor = fs.existsSync(probe) ? fs.realpathSync(probe) : probe
  return missingParts.length > 0 ? path.join(canonicalAncestor, ...missingParts) : canonicalAncestor
}

export function assertSafeExternalDir(targetDir, repoRoot) {
  if (typeof targetDir !== 'string' || !targetDir.trim()) {
    throw new Error('Diretório inválido: caminho vazio não permitido.')
  }

  const trimmed = targetDir.trim()
  const resolved = path.resolve(trimmed)
  const parsed = path.parse(resolved)

  if (parsed.root === resolved) {
    throw new Error(`Diretório inseguro: raiz de disco (${resolved}) não permitida.`)
  }
  if (
    trimmed === '/data' ||
    resolved === path.resolve('/data') ||
    (parsed.dir === parsed.root && parsed.base.toLowerCase() === 'data')
  ) {
    throw new Error(`Diretório inseguro: ${targetDir} reserva nome de produção (/data).`)
  }

  const canonicalTarget = resolveCanonicalAllowingMissing(resolved)
  const cmpTarget = normPathForCompare(canonicalTarget)

  if (repoRoot) {
    const canonicalRepo = resolveCanonicalAllowingMissing(repoRoot)
    const cmpRepo = normPathForCompare(canonicalRepo)
    const rel = path.relative(cmpRepo, cmpTarget)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new Error(`Diretório inseguro: ${targetDir} está dentro do repositório git (${repoRoot}).`)
    }
  }

  let cur = canonicalTarget
  while (true) {
    if (fs.existsSync(path.join(cur, '.git'))) {
      throw new Error(`Diretório inseguro: ${targetDir} está sob árvore .git em ${cur}.`)
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }

  return canonicalTarget
}

export function atomicWriteFile(filePath, content) {
  const tmpPath = `${filePath}.tmp`
  try {
    fs.writeFileSync(tmpPath, content, 'utf8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // ignore cleanup error
    }
    throw err
  }
}

export function isPortInUse(host, port, timeoutMs = 500) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export function sanitizeRemoteBundle(rawDb, rawState, rawDiet, targetQuery) {
  const query = typeof targetQuery === 'string' ? targetQuery.trim() : ''
  if (!query) throw new Error('Parâmetro --user <nome|uid> obrigatório.')

  const db = parseJsonMaybe(rawDb, 'db.json')
  if (!db || !Array.isArray(db.users)) {
    throw new Error('db.json remoto inválido: users ausente.')
  }

  const matches = db.users.filter(u => u && (u.id === query || u.name === query))
  if (matches.length === 0) {
    throw new Error(`Usuário "${query}" não encontrado na VPS.`)
  }
  if (matches.length > 1) {
    const list = matches.map(u => `{ id: "${u.id}", name: "${u.name}" }`).join(', ')
    throw new Error(`Múltiplos usuários correspondem a "${query}": ${list}. Passe o UID exato com --user.`)
  }

  const u = matches[0]
  const safeUser = {
    id: u.id,
    name: u.name,
    created: u.created,
    admin: Boolean(u.admin),
    setupPending: Boolean(u.setupPending)
  }
  if (u.sv !== undefined) safeUser.sv = u.sv

  return {
    user: safeUser,
    state: parseJsonMaybe(rawState, 'state.json'),
    diet: parseJsonMaybe(rawDiet, 'diet.json')
  }
}

export function applySnapshotToLocalData({ dataDir, bundle, localUid } = {}) {
  if (!bundle || !bundle.user) {
    throw new Error('Bundle de snapshot inválido: user ausente.')
  }

  const dbFile = path.join(dataDir, 'db.json')
  if (!fs.existsSync(dbFile)) {
    throw new Error(
      `db.json local não encontrado em ${dataDir}. Rode "node scripts/dev.mjs" e clique em "Criar perfil" no app primeiro.`
    )
  }

  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
  if (!Array.isArray(db.users) || db.users.length === 0) {
    throw new Error(
      'Nenhum perfil local cadastrado ainda em db.json. Suba o app local e clique em "Criar perfil" primeiro.'
    )
  }

  const uidFile = path.join(dataDir, '.snapshot-uid')
  let targetLocalUid = typeof localUid === 'string' && localUid.trim() ? localUid.trim() : ''

  if (targetLocalUid) {
    if (!db.users.some(u => u.id === targetLocalUid)) {
      const avail = db.users.map(u => `${u.name || '(sem nome)'} (${u.id})`).join(', ')
      throw new Error(`--local-uid "${targetLocalUid}" não encontrado em db.json. Disponíveis: ${avail}`)
    }
  } else if (fs.existsSync(uidFile)) {
    const savedUid = fs.readFileSync(uidFile, 'utf8').trim()
    if (savedUid && db.users.some(u => u.id === savedUid)) {
      targetLocalUid = savedUid
    }
  }

  if (!targetLocalUid) {
    if (db.users.length === 1) {
      targetLocalUid = db.users[0].id
    } else {
      const avail = db.users.map(u => `${u.name || '(sem nome)'} (${u.id})`).join(', ')
      throw new Error(
        `Existem ${db.users.length} usuários locais e .snapshot-uid não está definido. Informe --local-uid <uid>. Disponíveis: ${avail}`
      )
    }
  }

  const idx = db.users.findIndex(u => u.id === targetLocalUid)
  const prevUser = db.users[idx]
  db.users[idx] = {
    ...prevUser,
    id: targetLocalUid,
    name: bundle.user.name,
    admin: Boolean(bundle.user.admin),
    setupPending: Boolean(bundle.user.setupPending)
  }

  atomicWriteFile(dbFile, JSON.stringify(db, null, 2))

  const uidSeg = safeUidSegment(targetLocalUid)
  const statePath = path.join(dataDir, `state-${uidSeg}.json`)
  const statePayload = bundle.state && typeof bundle.state === 'object' ? bundle.state : {}
  atomicWriteFile(statePath, JSON.stringify(statePayload, null, 2))

  const dietPath = path.join(dataDir, `diet-${uidSeg}.json`)
  if (bundle.diet !== null && bundle.diet !== undefined) {
    atomicWriteFile(dietPath, JSON.stringify(bundle.diet, null, 2))
  } else if (fs.existsSync(dietPath)) {
    fs.unlinkSync(dietPath)
  }

  atomicWriteFile(uidFile, `${targetLocalUid}\n`)

  return {
    localUid: targetLocalUid,
    remoteUid: bundle.user.id,
    userName: db.users[idx].name,
    hasDiet: bundle.diet !== null && bundle.diet !== undefined
  }
}

export function resetZeroData({ dataDir }) {
  const uidFile = path.join(dataDir, '.snapshot-uid')
  if (!fs.existsSync(uidFile)) {
    throw new Error('.snapshot-uid ausente: vincule seu perfil snapshot primeiro antes de rodar --reset-zero.')
  }
  const snapshotUid = fs.readFileSync(uidFile, 'utf8').trim()
  if (!snapshotUid) {
    throw new Error('.snapshot-uid vazio: não é possível determinar o perfil snapshot a preservar.')
  }

  const dbFile = path.join(dataDir, 'db.json')
  if (!fs.existsSync(dbFile)) {
    throw new Error(`db.json não encontrado em ${dataDir}.`)
  }
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
  if (!Array.isArray(db.users) || !db.users.some(u => u.id === snapshotUid)) {
    throw new Error(`Usuário ${snapshotUid} de .snapshot-uid não encontrado em db.json.`)
  }

  db.users = db.users.filter(u => u && u.id === snapshotUid)
  db.creds = Array.isArray(db.creds) ? db.creds.filter(c => c && c.userId === snapshotUid) : []
  db.subs = Array.isArray(db.subs) ? db.subs.filter(s => s && s.userId === snapshotUid) : []
  db.invites = []
  atomicWriteFile(dbFile, JSON.stringify(db, null, 2))

  const keepUidSeg = safeUidSegment(snapshotUid)
  const removedFiles = []
  for (const entry of fs.readdirSync(dataDir)) {
    const stateMatch = /^state-(.+)\.json$/.exec(entry)
    const dietMatch = /^diet-(.+)\.json$/.exec(entry)
    const isSecondaryState = stateMatch && stateMatch[1] !== keepUidSeg
    const isSecondaryDiet = dietMatch && dietMatch[1] !== keepUidSeg
    const isTransient = entry === 'audit.jsonl' || entry === 'micro-idem.json'
    if (isSecondaryState || isSecondaryDiet || isTransient) {
      fs.unlinkSync(path.join(dataDir, entry))
      removedFiles.push(entry)
    }
  }

  return { keptUid: snapshotUid, removedFiles }
}

function buildRemoteSnapshotScript(targetQuery) {
  return [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "function parseJsonMaybe(raw, label) {",
    "  if (raw === null || raw === undefined || raw === '') return null;",
    "  if (typeof raw !== 'string') return raw;",
    "  return JSON.parse(raw);",
    "}",
    sanitizeRemoteBundle.toString(),
    `const targetQuery = ${JSON.stringify(targetQuery)};`,
    "const dataDir = '/data';",
    "const rawDb = fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8');",
    "const pre = sanitizeRemoteBundle(rawDb, null, null, targetQuery);",
    "const uidSeg = String(pre.user.id || '').replace(/[^a-zA-Z0-9_-]/g, '');",
    "const statePath = path.join(dataDir, `state-${uidSeg}.json`);",
    "const dietPath = path.join(dataDir, `diet-${uidSeg}.json`);",
    "const rawState = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : null;",
    "const rawDiet = fs.existsSync(dietPath) ? fs.readFileSync(dietPath, 'utf8') : null;",
    "const bundle = sanitizeRemoteBundle(rawDb, rawState, rawDiet, pre.user.id);",
    "process.stdout.write(JSON.stringify(bundle));",
    ''
  ].join('\n')
}

export function fetchRemoteSnapshot(targetQuery) {
  const remoteScript = buildRemoteSnapshotScript(targetQuery)
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', 'vps_oracle', 'docker exec -i opengym-api-1 node --input-type=module -'],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const stdoutChunks = []
    const stderrChunks = []
    child.stdout.on('data', chunk => stdoutChunks.push(chunk))
    child.stderr.on('data', chunk => stderrChunks.push(chunk))
    child.on('error', err => reject(new Error(`Falha ao invocar ssh vps_oracle: ${err.message}`)))
    child.on('close', code => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim()
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      if (code !== 0) {
        reject(new Error(`Snapshot remoto falhou (exit ${code})${stderr ? `: ${stderr}` : ''}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (err) {
        reject(new Error(`Resposta inválida do snapshot remoto: ${err.message}`))
      }
    })
    child.stdin.end(remoteScript, 'utf8')
  })
}

async function ensureApiPortStopped() {
  if (await isPortInUse('127.0.0.1', 3000)) {
    throw new Error(
      'A API local ainda está escutando em 127.0.0.1:3000. Pare scripts/dev.mjs (Ctrl+C) antes de alterar data/.'
    )
  }
}

export async function runPullSnapshot({ paths, repoRoot = DEFAULT_REPO_ROOT, targetQuery, localUid } = {}) {
  assertSafeExternalDir(paths.dataDir, repoRoot)
  await ensureApiPortStopped()

  let effectiveQuery = typeof targetQuery === 'string' ? targetQuery.trim() : ''
  if (!effectiveQuery && fs.existsSync(paths.snapshotTargetFile)) {
    effectiveQuery = fs.readFileSync(paths.snapshotTargetFile, 'utf8').trim()
  }
  if (!effectiveQuery) {
    throw new Error('Informe --user <nome|uid> na primeira sincronização com a VPS.')
  }

  const bundle = await fetchRemoteSnapshot(effectiveQuery)
  const result = applySnapshotToLocalData({ dataDir: paths.dataDir, bundle, localUid })
  atomicWriteFile(paths.snapshotTargetFile, `${bundle.user.id}\n`)
  return result
}

export async function runResetZero({ paths, repoRoot = DEFAULT_REPO_ROOT } = {}) {
  assertSafeExternalDir(paths.dataDir, repoRoot)
  await ensureApiPortStopped()
  return resetZeroData({ dataDir: paths.dataDir })
}

function parseCliArgs(argv) {
  let mode = 'pull'
  let user = ''
  let localUid = ''
  let help = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === 'pull') {
      mode = 'pull'
    } else if (arg === '--reset-zero') {
      mode = 'reset-zero'
    } else if (arg === '--user' && i + 1 < argv.length) {
      user = argv[++i]
    } else if (arg.startsWith('--user=')) {
      user = arg.slice('--user='.length)
    } else if (arg === '--local-uid' && i + 1 < argv.length) {
      localUid = argv[++i]
    } else if (arg.startsWith('--local-uid=')) {
      localUid = arg.slice('--local-uid='.length)
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`)
    }
  }
  return { mode, user, localUid, help }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      [
        'Uso:',
        '  node scripts/dev-snapshot.mjs [pull] --user <nome|uid> [--local-uid <uid>]',
        '  node scripts/dev-snapshot.mjs [--local-uid <uid>]   (reaplica alvo salvo em .snapshot-target)',
        '  node scripts/dev-snapshot.mjs --reset-zero          (remove usuários/dados não-snapshot)'
      ].join('\n')
    )
    return
  }

  const paths = resolveDevPaths()
  if (args.mode === 'reset-zero') {
    const res = await runResetZero({ paths })
    console.log(
      `✓ Reset do perfil zerado concluído (preservado ${res.keptUid}; removidos ${res.removedFiles.length} arquivos).`
    )
    return
  }

  const res = await runPullSnapshot({ paths, targetQuery: args.user, localUid: args.localUid })
  console.log(
    `✓ Snapshot aplicado (${res.remoteUid} -> local ${res.localUid}, usuario=${res.userName}, dieta=${res.hasDiet ? 'sim' : 'nao'}).`
  )
}

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch(err => {
    console.error(`Erro: ${err.message}`)
    process.exit(1)
  })
}
