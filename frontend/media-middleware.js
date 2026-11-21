import fs from 'node:fs'
import path from 'node:path'

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}

const ROUTES = [
  { prefix: '/exercise-media/still/', bucket: 'still' },
  { prefix: '/exercise-media/clip/', bucket: 'clip' },
  { prefix: '/img/', bucket: 'img' },
  { prefix: '/gif/', bucket: 'gif' }
]

/** Serves exercise media strictly from bounded subdirectories of mediaDir in dev. */
export function createMediaMiddleware(mediaDir) {
  const rootDir = path.resolve(mediaDir)
  return function mediaMiddleware(req, res, next) {
    const rawUrl = String(req.url || '/')
    const rawPath = rawUrl.split(/[?#]/, 1)[0]
    const rawMatch = ROUTES.find(r => rawPath.startsWith(r.prefix))
    if (!rawMatch) return next()

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, HEAD')
      res.end('Method Not Allowed')
      return
    }

    let decodedPath
    try {
      decodedPath = decodeURIComponent(rawPath)
    } catch {
      res.statusCode = 400
      res.end('Bad Request')
      return
    }
    if (decodedPath.includes('\0')) {
      res.statusCode = 400
      res.end('Bad Request')
      return
    }

    const route = ROUTES.find(r => decodedPath.startsWith(r.prefix)) || rawMatch
    const allowedSubdir = path.resolve(rootDir, route.bucket)
    const relInput = decodedPath.slice(route.prefix.length).replace(/\\/g, '/')
    if (relInput.split('/').includes('..') || path.isAbsolute(relInput)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    const resolved = path.resolve(allowedSubdir, relInput)
    const rel = path.relative(allowedSubdir, resolved)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    let stat
    try {
      stat = fs.statSync(resolved)
    } catch {
      res.statusCode = 404
      res.end('Not Found')
      return
    }
    if (!stat.isFile()) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    try {
      const realSubdir = fs.realpathSync(allowedSubdir)
      const realFile = fs.realpathSync(resolved)
      const realRel = path.relative(realSubdir, realFile)
      if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel)) {
        res.statusCode = 403
        res.end('Forbidden')
        return
      }
    } catch {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    const ext = path.extname(resolved).toLowerCase()
    const contentType = MIME[ext] || 'application/octet-stream'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'no-cache')

    const rangeHeader = req.headers?.range
    if (req.method === 'GET' && typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      const size = stat.size
      if (m && (m[1] !== '' || m[2] !== '')) {
        let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1])
        let end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2]))
        if (m[1] === '') end = size - 1
        if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && start < size) {
          const buf = fs.readFileSync(resolved)
          const slice = buf.subarray(start, end + 1)
          res.statusCode = 206
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
          res.setHeader('Content-Length', String(slice.length))
          res.end(slice)
          return
        }
        res.statusCode = 416
        res.setHeader('Content-Range', `bytes */${size}`)
        res.end()
        return
      }
    }

    res.statusCode = 200
    res.setHeader('Content-Length', String(stat.size))
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(fs.readFileSync(resolved))
  }
}
