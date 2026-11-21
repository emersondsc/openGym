import fs from 'node:fs'
import path from 'node:path'

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

/** Serves /img/* and /gif/* strictly from bounded subdirectories of mediaDir in dev. */
export function createMediaMiddleware(mediaDir) {
  const rootDir = path.resolve(mediaDir)
  return function mediaMiddleware(req, res, next) {
    const rawUrl = String(req.url || '/')
    const rawPath = rawUrl.split(/[?#]/, 1)[0]
    if (!rawPath.startsWith('/img/') && !rawPath.startsWith('/gif/')) return next()

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

    const bucket = decodedPath.startsWith('/img/') ? 'img' : 'gif'
    const allowedSubdir = path.resolve(rootDir, bucket)
    const relInput = decodedPath.slice(bucket.length + 2).replace(/\\/g, '/')
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
    res.statusCode = 200
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
    res.setHeader('Content-Length', String(stat.size))
    res.setHeader('Cache-Control', 'no-cache')
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(fs.readFileSync(resolved))
  }
}
