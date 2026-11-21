import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_REPO_ROOT,
  assertSafeExternalDir,
  isPortInUse,
  resolveDevPaths,
  runPullSnapshot
} from './dev-snapshot.mjs'

const MEDIA_REPO = 'https://github.com/hasaneyldrm/exercises-dataset'

function hasNonEmptyDir(dirPath) {
  return fs.existsSync(dirPath) && fs.readdirSync(dirPath).length > 0
}

function copyMatchingExt(srcDir, dstDir, ext) {
  if (!fs.existsSync(srcDir)) return 0
  fs.mkdirSync(dstDir, { recursive: true })
  let count = 0
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!entry.name.toLowerCase().endsWith(ext)) continue
    fs.copyFileSync(path.join(srcDir, entry.name), path.join(dstDir, entry.name))
    count++
  }
  return count
}

function defaultCloneMedia(destDir) {
  const res = spawnSync('git', ['clone', '--depth', '1', MEDIA_REPO, destDir], {
    shell: false,
    stdio: 'inherit'
  })
  if (res.error) throw res.error
  if (res.status !== 0) {
    throw new Error(`git clone de ${MEDIA_REPO} falhou (exit ${res.status}).`)
  }
}

export async function ensureMediaCache(mediaDir, { cloneFn = defaultCloneMedia, refresh = false } = {}) {
  const readyFile = path.join(mediaDir, '.ready')
  const imgDir = path.join(mediaDir, 'img')
  const gifDir = path.join(mediaDir, 'gif')

  if (!refresh && fs.existsSync(readyFile) && hasNonEmptyDir(imgDir) && hasNonEmptyDir(gifDir)) {
    return { mediaDir, skipped: true }
  }

  fs.mkdirSync(path.dirname(mediaDir), { recursive: true })
  const cloneTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-media-clone-'))
  const stagingDir = path.join(
    path.dirname(mediaDir),
    `${path.basename(mediaDir)}.staging-${process.pid}-${Date.now()}`
  )

  try {
    await cloneFn(cloneTmpDir)
    const imgCount = copyMatchingExt(path.join(cloneTmpDir, 'images'), path.join(stagingDir, 'img'), '.jpg')
    const gifCount = copyMatchingExt(path.join(cloneTmpDir, 'videos'), path.join(stagingDir, 'gif'), '.gif')
    if (imgCount === 0 || gifCount === 0) {
      throw new Error(`Cache de mídia incompleto após clone (img=${imgCount}, gif=${gifCount}).`)
    }
    fs.writeFileSync(path.join(stagingDir, '.ready'), `${new Date().toISOString()}\n`, 'utf8')
    if (fs.existsSync(mediaDir)) {
      fs.rmSync(mediaDir, { recursive: true, force: true })
    }
    fs.renameSync(stagingDir, mediaDir)
    return { mediaDir, skipped: false, imgCount, gifCount }
  } finally {
    fs.rmSync(cloneTmpDir, { recursive: true, force: true })
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
}

async function waitForHealth(url, apiProc, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (apiProc.exitCode !== null || apiProc.signalCode !== null) {
      throw new Error(`API local encerrou antes do healthcheck (exit=${apiProc.exitCode}).`)
    }
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // retry until deadline
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Timeout de ${timeoutMs}ms aguardando ${url}.`)
}

function parseDevArgs(argv) {
  let doPull = false
  let pullTarget = ''
  let localUid = ''
  let refreshMedia = false
  let help = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--refresh-media') {
      refreshMedia = true
    } else if (arg === '--pull') {
      doPull = true
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        pullTarget = next
        i++
      }
    } else if (arg.startsWith('--pull=')) {
      doPull = true
      pullTarget = arg.slice('--pull='.length)
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
  return { doPull, pullTarget, localUid, refreshMedia, help }
}

function stopChild(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      clearTimeout(forceTimer)
      resolve()
    }
    child.once('exit', done)
    child.once('error', done)
    try {
      child.kill('SIGTERM')
    } catch {
      done()
      return
    }
    const forceTimer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      setTimeout(done, 300)
    }, 1500)
  })
}

async function main() {
  const args = parseDevArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      [
        'Uso:',
        '  node scripts/dev.mjs [--pull [<nome|uid>]] [--local-uid <uid>] [--refresh-media]'
      ].join('\n')
    )
    return
  }

  const repoRoot = DEFAULT_REPO_ROOT
  const paths = resolveDevPaths()
  assertSafeExternalDir(paths.dataDir, repoRoot)
  assertSafeExternalDir(paths.mediaDir, repoRoot)
  fs.mkdirSync(paths.dataDir, { recursive: true })

  const apiModules = path.join(repoRoot, 'api', 'node_modules')
  const frontendModules = path.join(repoRoot, 'frontend', 'node_modules')
  if (!fs.existsSync(apiModules) || !fs.existsSync(frontendModules)) {
    throw new Error('Dependências ausentes. Rode "npm --prefix api ci" e "npm --prefix frontend ci".')
  }

  if (await isPortInUse('127.0.0.1', 3000)) {
    throw new Error('Porta 3000 já está em uso em 127.0.0.1.')
  }
  if (await isPortInUse('localhost', 5173)) {
    throw new Error('Porta 5173 já está em uso em localhost.')
  }

  if (args.doPull) {
    const snap = await runPullSnapshot({
      paths,
      repoRoot,
      targetQuery: args.pullTarget,
      localUid: args.localUid
    })
    console.log(`✓ Snapshot atualizado (${snap.remoteUid} -> ${snap.localUid}).`)
  }

  const repoMediaDir = path.join(repoRoot, 'catalogue', 'media')
  let viteMediaDir = repoMediaDir
  if (hasNonEmptyDir(path.join(repoMediaDir, 'still')) && hasNonEmptyDir(path.join(repoMediaDir, 'clip'))) {
    console.log(`✓ Mídia local pronta (${repoMediaDir}).`)
  } else {
    const mediaRes = await ensureMediaCache(paths.mediaDir, { refresh: args.refreshMedia })
    viteMediaDir = paths.mediaDir
    if (mediaRes.skipped) {
      console.log(`✓ Mídia em cache pronta (${paths.mediaDir}).`)
    } else {
      console.log(`✓ Cache de mídia criado em ${paths.mediaDir} (${mediaRes.imgCount} JPGs, ${mediaRes.gifCount} GIFs).`)
    }
  }

  const apiEnv = { ...process.env }
  delete apiEnv.COACH_OWNER_UID
  delete apiEnv.COACH_AUTO_APPLY
  delete apiEnv.INVITE_ONLY
  apiEnv.HOST = '127.0.0.1'
  apiEnv.PORT = '3000'
  apiEnv.DATA_DIR = paths.dataDir
  apiEnv.RP_ID = 'localhost'
  apiEnv.ORIGIN = 'http://localhost:5173'
  apiEnv.SETUP_ENABLED = '1'

  const viteEnv = {
    ...process.env,
    API_TARGET: 'http://127.0.0.1:3000',
    OPENGYM_MEDIA_DIR: viteMediaDir
  }

  const apiProc = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: path.join(repoRoot, 'api'),
    env: apiEnv,
    stdio: 'inherit'
  })

  let viteProc = null
  let shuttingDown = false

  const shutdown = async exitCode => {
    if (shuttingDown) return
    shuttingDown = true
    await Promise.all([stopChild(viteProc), stopChild(apiProc)])
    process.exit(exitCode)
  }

  process.on('SIGINT', () => void shutdown(0))
  process.on('SIGTERM', () => void shutdown(0))
  if (process.platform === 'win32') {
    process.on('SIGBREAK', () => void shutdown(0))
  }

  const onChildExit = name => (code, signal) => {
    if (shuttingDown) return
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      void shutdown(0)
      return
    }
    console.error(`${name} encerrou inesperadamente (code=${code}, signal=${signal}). Encerrando dev...`)
    void shutdown(code && code !== 0 ? code : 1)
  }

  apiProc.on('exit', onChildExit('API'))

  try {
    await waitForHealth('http://127.0.0.1:3000/api/health', apiProc, 10000)
  } catch (err) {
    await stopChild(apiProc)
    throw err
  }

  viteProc = spawn(
    process.execPath,
    [path.join(repoRoot, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--strictPort', '--host', 'localhost'],
    {
      cwd: path.join(repoRoot, 'frontend'),
      env: viteEnv,
      stdio: 'inherit'
    }
  )

  viteProc.on('exit', onChildExit('Vite'))

  console.log('\n→ openGym local pronto em http://localhost:5173 (Ctrl+C para encerrar)\n')
}

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch(err => {
    console.error(`Erro: ${err.message}`)
    process.exit(1)
  })
}
