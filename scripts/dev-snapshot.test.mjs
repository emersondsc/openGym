import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createMediaMiddleware } from '../frontend/media-middleware.js'
import {
  applySnapshotToLocalData,
  assertSafeExternalDir,
  isPortInUse,
  resetZeroData,
  resolveDevPaths,
  sanitizeRemoteBundle
} from './dev-snapshot.mjs'
import { ensureMediaCache } from './dev.mjs'

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

test('resolveDevPaths respeita override, win32 LOCALAPPDATA e fallback HOME', () => {
  const winPaths = resolveDevPaths({
    localAppData: 'C:\\Users\\emerson\\AppData\\Local',
    homeDir: 'C:\\Users\\emerson',
    overrideDir: '',
    platform: 'win32'
  })
  assert.equal(winPaths.baseDir, path.resolve('C:\\Users\\emerson\\AppData\\Local', 'opengym-dev'))
  assert.equal(winPaths.dataDir, path.join(winPaths.baseDir, 'data'))
  assert.equal(winPaths.mediaDir, path.join(winPaths.baseDir, 'media'))
  assert.equal(winPaths.snapshotUidFile, path.join(winPaths.dataDir, '.snapshot-uid'))

  const nixPaths = resolveDevPaths({
    localAppData: '',
    homeDir: '/home/emerson',
    overrideDir: '',
    platform: 'linux'
  })
  assert.equal(nixPaths.baseDir, path.resolve('/home/emerson', '.opengym-dev'))

  const ovrPaths = resolveDevPaths({
    localAppData: 'C:\\Ignored',
    homeDir: 'C:\\Ignored',
    overrideDir: path.join(os.tmpdir(), 'custom-opengym'),
    platform: 'win32'
  })
  assert.equal(ovrPaths.baseDir, path.resolve(os.tmpdir(), 'custom-opengym'))
})

test('sanitizeRemoteBundle filtra allowlist de 7 usuários, valida ambiguidade e aceita state/diet null', () => {
  const users = [
    { id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00Z', admin: false, setupPending: false, sv: 1 },
    { id: 'u2', name: 'Emerson', created: '2026-01-02T00:00:00Z', admin: true, setupPending: false, sv: 3, secretLeak: 'nope' },
    { id: 'u3', name: 'Carlos', created: '2026-01-03T00:00:00Z', admin: false, setupPending: true },
    { id: 'u4', name: 'Carlos', created: '2026-01-04T00:00:00Z', admin: false, setupPending: false },
    { id: 'u5', name: 'Joao', created: '2026-01-05T00:00:00Z', admin: false, setupPending: false },
    { id: 'u6', name: 'Maria', created: '2026-01-06T00:00:00Z', admin: false, setupPending: false },
    { id: 'u7', name: 'Pedro', created: '2026-01-07T00:00:00Z', admin: false, setupPending: false }
  ]
  const rawDb = JSON.stringify({
    users,
    creds: [{ id: 'cred-u2', userId: 'u2', publicKey: 'pk' }],
    subs: [{ userId: 'u2', endpoint: 'https://push.example/1' }],
    invites: [{ code: 'INV123' }]
  })

  const byName = sanitizeRemoteBundle(rawDb, JSON.stringify({ workouts: [{ id: 1 }] }), null, 'Emerson')
  assert.deepEqual(byName, {
    user: { id: 'u2', name: 'Emerson', created: '2026-01-02T00:00:00Z', admin: true, setupPending: false, sv: 3 },
    state: { workouts: [{ id: 1 }] },
    diet: null
  })
  assert.equal('creds' in byName, false)
  assert.equal('subs' in byName, false)
  assert.equal('invites' in byName, false)
  assert.equal('secretLeak' in byName.user, false)

  const byUidNullState = sanitizeRemoteBundle(rawDb, null, null, 'u1')
  assert.equal(byUidNullState.state, null)
  assert.equal(byUidNullState.diet, null)
  assert.equal(byUidNullState.user.id, 'u1')

  assert.throws(() => sanitizeRemoteBundle(rawDb, null, null, 'Inexistente'), /não encontrado/i)
  assert.throws(
    () => sanitizeRemoteBundle(rawDb, null, null, 'Carlos'),
    err => /Múltiplos usuários/i.test(err.message) && err.message.includes('u3') && err.message.includes('u4')
  )
})

test('applySnapshotToLocalData preserva credenciais/segredos locais e apaga diet antiga se null', () => {
  const dir = mkTmp('og-apply-')
  try {
    assert.throws(
      () =>
        applySnapshotToLocalData({
          dataDir: dir,
          bundle: { user: { id: 'vps-1', name: 'Emerson', admin: true, setupPending: false }, state: {}, diet: null }
        }),
      /Criar perfil/i
    )

    const initialDb = {
      users: [{ id: 'local-1', name: 'Temp', created: '2026-11-21T00:00:00Z', admin: false, setupPending: true, sv: 2 }],
      creds: [{ id: 'c1', userId: 'local-1', publicKey: 'local-pk' }],
      subs: [{ userId: 'local-1', endpoint: 'https://fcm/local' }],
      invites: [{ code: 'KEEP' }]
    }
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(initialDb, null, 2))
    fs.writeFileSync(path.join(dir, 'secret'), 'local-secret-hex')
    fs.writeFileSync(path.join(dir, 'vapid.json'), '{"publicKey":"pub","privateKey":"priv"}')
    fs.writeFileSync(path.join(dir, 'diet-local-1.json'), '{"kcal":2200}')

    const res = applySnapshotToLocalData({
      dataDir: dir,
      bundle: {
        user: { id: 'vps-99', name: 'Emerson', created: '2025-01-01', admin: true, setupPending: false, sv: 9 },
        state: { workouts: [{ d: '2026-11-20' }] },
        diet: null
      }
    })
    assert.equal(res.localUid, 'local-1')
    assert.equal(fs.readFileSync(path.join(dir, '.snapshot-uid'), 'utf8').trim(), 'local-1')
    assert.equal(fs.readFileSync(path.join(dir, 'secret'), 'utf8'), 'local-secret-hex')
    assert.equal(fs.readFileSync(path.join(dir, 'vapid.json'), 'utf8'), '{"publicKey":"pub","privateKey":"priv"}')
    assert.equal(fs.existsSync(path.join(dir, 'diet-local-1.json')), false)

    const updatedDb = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'))
    assert.deepEqual(updatedDb.creds, initialDb.creds)
    assert.deepEqual(updatedDb.subs, initialDb.subs)
    assert.deepEqual(updatedDb.invites, initialDb.invites)
    assert.equal(updatedDb.users[0].id, 'local-1')
    assert.equal(updatedDb.users[0].name, 'Emerson')
    assert.equal(updatedDb.users[0].admin, true)
    assert.equal(updatedDb.users[0].setupPending, false)
    assert.equal(updatedDb.users[0].sv, 2)

    const savedState = JSON.parse(fs.readFileSync(path.join(dir, 'state-local-1.json'), 'utf8'))
    assert.deepEqual(savedState, { workouts: [{ d: '2026-11-20' }] })

    // >1 usuário local sem .snapshot-uid exige --local-uid
    fs.unlinkSync(path.join(dir, '.snapshot-uid'))
    updatedDb.users.push({ id: 'local-2', name: 'Zero', created: '2026-11-21', admin: false, setupPending: true })
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(updatedDb, null, 2))

    assert.throws(
      () =>
        applySnapshotToLocalData({
          dataDir: dir,
          bundle: { user: { id: 'vps-99', name: 'Emerson', admin: true, setupPending: false }, state: {}, diet: null }
        }),
      err => /local-uid/i.test(err.message) && err.message.includes('local-1') && err.message.includes('local-2')
    )

    // Funciona passando localUid explicitamente e restaura .snapshot-uid
    applySnapshotToLocalData({
      dataDir: dir,
      localUid: 'local-1',
      bundle: { user: { id: 'vps-99', name: 'Emerson', admin: true, setupPending: false }, state: {}, diet: { kcal: 2500 } }
    })
    assert.equal(fs.readFileSync(path.join(dir, '.snapshot-uid'), 'utf8').trim(), 'local-1')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'diet-local-1.json'), 'utf8')), { kcal: 2500 })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('resetZeroData remove apenas usuário secundário e preserva snapshot + segredos', () => {
  const dir = mkTmp('og-reset-')
  try {
    assert.throws(() => resetZeroData({ dataDir: dir }), /\.snapshot-uid/i)

    fs.writeFileSync(path.join(dir, '.snapshot-uid'), 'snap-1\n')
    fs.writeFileSync(path.join(dir, 'secret'), 'keep-secret')
    fs.writeFileSync(path.join(dir, 'vapid.json'), 'keep-vapid')
    fs.writeFileSync(path.join(dir, 'state-snap-1.json'), '{"ok":true}')
    fs.writeFileSync(path.join(dir, 'diet-snap-1.json'), '{"kcal":2400}')
    fs.writeFileSync(path.join(dir, 'state-zero-2.json'), '{"tmp":1}')
    fs.writeFileSync(path.join(dir, 'diet-zero-2.json'), '{"tmp":2}')
    fs.writeFileSync(path.join(dir, 'audit.jsonl'), '{"ev":1}\n')
    fs.writeFileSync(path.join(dir, 'micro-idem.json'), '{}')
    fs.writeFileSync(
      path.join(dir, 'db.json'),
      JSON.stringify({
        users: [
          { id: 'snap-1', name: 'Emerson' },
          { id: 'zero-2', name: 'Teste Zero' }
        ],
        creds: [
          { id: 'c1', userId: 'snap-1' },
          { id: 'c2', userId: 'zero-2' }
        ],
        subs: [
          { userId: 'snap-1', endpoint: 'a' },
          { userId: 'zero-2', endpoint: 'b' }
        ],
        invites: [{ code: 'TMP' }]
      })
    )

    const res = resetZeroData({ dataDir: dir })
    assert.equal(res.keptUid, 'snap-1')
    assert.deepEqual(res.removedFiles.sort(), ['audit.jsonl', 'diet-zero-2.json', 'micro-idem.json', 'state-zero-2.json'])

    const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'))
    assert.deepEqual(db.users.map(u => u.id), ['snap-1'])
    assert.deepEqual(db.creds.map(c => c.id), ['c1'])
    assert.deepEqual(db.subs.map(s => s.userId), ['snap-1'])
    assert.deepEqual(db.invites, [])
    assert.equal(fs.existsSync(path.join(dir, 'state-snap-1.json')), true)
    assert.equal(fs.existsSync(path.join(dir, 'diet-snap-1.json')), true)
    assert.equal(fs.existsSync(path.join(dir, 'secret')), true)
    assert.equal(fs.existsSync(path.join(dir, 'vapid.json')), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('assertSafeExternalDir rejeita caminhos inseguros e aceita diretórios externos ainda não criados', () => {
  const sandbox = mkTmp('og-safe-')
  const fakeRepo = path.join(sandbox, 'repo')
  const externalSibling = path.join(sandbox, 'opengym-dev', 'nested', 'data')
  try {
    fs.mkdirSync(path.join(fakeRepo, '.git'), { recursive: true })
    const rootDisk = path.parse(sandbox).root

    assert.throws(() => assertSafeExternalDir('', fakeRepo))
    assert.throws(() => assertSafeExternalDir('   ', fakeRepo))
    assert.throws(() => assertSafeExternalDir('/data', fakeRepo))
    assert.throws(() => assertSafeExternalDir(path.resolve('/data'), fakeRepo))
    assert.throws(() => assertSafeExternalDir(rootDisk, fakeRepo))
    assert.throws(() => assertSafeExternalDir(fakeRepo, fakeRepo))
    assert.throws(() => assertSafeExternalDir(path.join(fakeRepo, 'uncreated', 'data'), fakeRepo))
    assert.throws(() => assertSafeExternalDir(path.join(fakeRepo, 'sub', 'data')))

    const safeResolved = assertSafeExternalDir(externalSibling, fakeRepo)
    assert.equal(path.basename(safeResolved), 'data')
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})

test('isPortInUse detecta porta ocupada e livre', async () => {
  const srv = net.createServer()
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
  const { port } = srv.address()
  assert.equal(await isPortInUse('127.0.0.1', port), true)
  await new Promise(resolve => srv.close(resolve))
  assert.equal(await isPortInUse('127.0.0.1', port), false)
})

test('createMediaMiddleware serve /img e /gif com segurança estrita e bloqueia traversal', async () => {
  const mediaRoot = mkTmp('og-media-mw-')
  let srv
  try {
    fs.mkdirSync(path.join(mediaRoot, 'img'), { recursive: true })
    fs.mkdirSync(path.join(mediaRoot, 'gif'), { recursive: true })
    fs.mkdirSync(path.join(mediaRoot, 'still'), { recursive: true })
    fs.mkdirSync(path.join(mediaRoot, 'clip'), { recursive: true })
    fs.mkdirSync(path.join(mediaRoot, 'img2'), { recursive: true })
    fs.writeFileSync(path.join(mediaRoot, 'img', 'bench.jpg'), Buffer.from([0xff, 0xd8, 0xff]))
    fs.writeFileSync(path.join(mediaRoot, 'gif', 'bench.gif'), Buffer.from('GIF89a'))
    fs.writeFileSync(path.join(mediaRoot, 'still', '0025.webp'), Buffer.from('RIFFWEBP'))
    fs.writeFileSync(path.join(mediaRoot, 'clip', '0025.mp4'), Buffer.from('0123456789'))
    fs.writeFileSync(path.join(mediaRoot, 'img2', 'secret.jpg'), Buffer.from('nope'))
    fs.writeFileSync(path.join(mediaRoot, 'secret.jpg'), Buffer.from('nope'))

    const mw = createMediaMiddleware(mediaRoot)
    srv = http.createServer((req, res) => {
      mw(req, res, () => {
        res.statusCode = 418
        res.end('passthrough')
      })
    })
    await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${srv.address().port}`

    const imgRes = await fetch(`${baseUrl}/img/bench.jpg`)
    assert.equal(imgRes.status, 200)
    assert.equal(imgRes.headers.get('content-type'), 'image/jpeg')
    assert.equal(imgRes.headers.get('cache-control'), 'no-cache')
    assert.deepEqual(Buffer.from(await imgRes.arrayBuffer()), Buffer.from([0xff, 0xd8, 0xff]))

    const gifRes = await fetch(`${baseUrl}/gif/bench.gif`)
    assert.equal(gifRes.status, 200)
    assert.equal(gifRes.headers.get('content-type'), 'image/gif')
    assert.equal(await gifRes.text(), 'GIF89a')

    const stillRes = await fetch(`${baseUrl}/exercise-media/still/0025.webp`)
    assert.equal(stillRes.status, 200)
    assert.equal(stillRes.headers.get('content-type'), 'image/webp')
    assert.equal(await stillRes.text(), 'RIFFWEBP')

    const clipRes = await fetch(`${baseUrl}/exercise-media/clip/0025.mp4`, { headers: { range: 'bytes=2-5' } })
    assert.equal(clipRes.status, 206)
    assert.equal(clipRes.headers.get('content-type'), 'video/mp4')
    assert.equal(clipRes.headers.get('content-range'), 'bytes 2-5/10')
    assert.equal(await clipRes.text(), '2345')

    const headRes = await fetch(`${baseUrl}/img/bench.jpg`, { method: 'HEAD' })
    assert.equal(headRes.status, 200)
    assert.equal(headRes.headers.get('content-type'), 'image/jpeg')
    assert.equal(headRes.headers.get('content-length'), '3')
    assert.equal(await headRes.text(), '')

    assert.equal((await fetch(`${baseUrl}/img/missing.jpg`)).status, 404)
    assert.equal((await fetch(`${baseUrl}/img/bench.jpg`, { method: 'POST' })).status, 405)
    assert.equal((await fetch(`${baseUrl}/img/%E0%A4%A`)).status, 400)
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 418)

    for (const badPath of [
      '/img/../secret.jpg',
      '/img/%2e%2e%2fsecret.jpg',
      '/img/../gif/bench.gif',
      '/img/../img2/secret.jpg',
      '/img/../img2/secret.jpg?x=1',
      '/exercise-media/still/../secret.jpg',
      '/exercise-media/clip/../still/0025.webp'
    ]) {
      const sockRes = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: srv.address().port, path: badPath, method: 'GET' }, res => {
          res.resume()
          resolve(res.statusCode)
        })
        req.on('error', reject)
        req.end()
      })
      assert.equal(sockRes, 403, `esperado 403 para ${badPath}, veio ${sockRes}`)
    }
  } finally {
    if (srv) await new Promise(resolve => srv.close(resolve))
    fs.rmSync(mediaRoot, { recursive: true, force: true })
  }
})

test('ensureMediaCache baixa uma vez, pula quando .ready existe e recria quando incompleto ou refresh=true', async () => {
  const sandbox = mkTmp('og-cache-')
  const mediaDir = path.join(sandbox, 'media')
  try {
    let calls = 0
    const mockClone = destDir => {
      calls++
      fs.mkdirSync(path.join(destDir, 'images'), { recursive: true })
      fs.mkdirSync(path.join(destDir, 'videos'), { recursive: true })
      fs.writeFileSync(path.join(destDir, 'images', 'ex1.jpg'), 'jpg')
      fs.writeFileSync(path.join(destDir, 'videos', 'ex1.gif'), 'gif')
    }

    const first = await ensureMediaCache(mediaDir, { cloneFn: mockClone })
    assert.equal(calls, 1)
    assert.equal(first.skipped, false)
    assert.equal(fs.existsSync(path.join(mediaDir, '.ready')), true)
    assert.equal(fs.existsSync(path.join(mediaDir, 'img', 'ex1.jpg')), true)
    assert.equal(fs.existsSync(path.join(mediaDir, 'gif', 'ex1.gif')), true)

    const second = await ensureMediaCache(mediaDir, { cloneFn: mockClone })
    assert.equal(calls, 1)
    assert.equal(second.skipped, true)

    const refreshed = await ensureMediaCache(mediaDir, { cloneFn: mockClone, refresh: true })
    assert.equal(calls, 2)
    assert.equal(refreshed.skipped, false)

    // Sem .ready deve baixar novamente e substituir
    fs.unlinkSync(path.join(mediaDir, '.ready'))
    const repaired = await ensureMediaCache(mediaDir, { cloneFn: mockClone })
    assert.equal(calls, 3)
    assert.equal(repaired.skipped, false)
    assert.equal(fs.existsSync(path.join(mediaDir, '.ready')), true)
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})
