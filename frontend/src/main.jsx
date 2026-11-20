import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { setLang, effLang } from './lib/i18n.js'
import { useStore } from './store/useStore.js'
import './index.css'

const bootLang = effLang(useStore.getState().S)
setLang(bootLang)
document.documentElement.lang = bootLang === 'pt' ? 'pt-BR' : bootLang

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
