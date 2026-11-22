import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createMediaMiddleware } from './media-middleware.js'

export { createMediaMiddleware }

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

const localMediaPlugin = () => ({
  name: 'opengym-local-media',
  configureServer(server) {
    const mediaDir = (process.env.OPENGYM_MEDIA_DIR || '').trim()
    if (mediaDir) server.middlewares.use(createMediaMiddleware(mediaDir))
  }
})

export default defineConfig({
  plugins: [react(), localMediaPlugin()],
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/.well-known': { target: backend, changeOrigin: true },
      '/exercise-media': { target: media, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 5000 }
})
