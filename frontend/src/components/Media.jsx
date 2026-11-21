import { useState } from 'react'
import { imgSrc, gifSrc, isVideoSrc, exName } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

function autoplayMuted(el) {
  if (!el) return
  el.muted = true
  el.defaultMuted = true
  el.setAttribute('muted', '')
  const p = el.play?.()
  if (p && typeof p.catch === 'function') p.catch(() => {})
}

let clipObserver = null
const clipsInView = () => clipObserver || (clipObserver = new IntersectionObserver(entries => {
  for (const e of entries) {
    const v = e.target
    if (e.isIntersecting) { const p = v.play?.(); if (p && typeof p.catch === 'function') p.catch(() => {}) }
    else v.pause?.()
  }
}, { rootMargin: '100px 0px' }))

export function autoplayClip(el) {
  autoplayMuted(el)
  if (!el || typeof IntersectionObserver === 'undefined') return
  const io = clipsInView()
  io.observe(el)
  return () => io.unobserve(el)
}

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen. It starts minimized and the chosen size is saved to settings, carrying
// across exercises and future workouts (issue #12).
export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const [failed, setFailed] = useState(null)
  const gifSize = useStore(s => s.S.gifSize)
  const gifSizeChosen = useStore(s => s.S.gifSizeChosen)
  const update = useStore(s => s.update)
  if (!ex.gif) return null
  // Minimized until the user expands it on purpose: the state pulled from the server still carries
  // 'full' from the old default, and that stale value must not beat the new default.
  const mini = minimizable && !(gifSizeChosen && gifSize === 'full')
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini'; s.gifSizeChosen = true }) }
  const animUrl = gifSrc(ex)
  const stillUrl = imgSrc(ex)
  const showAnim = playing && failed == null
  const clip = showAnim && isVideoSrc(animUrl) ? animUrl : null
  const onError = () => setFailed(showAnim ? 'gif' : 'all')
  const onTap = () => {
    if (failed) { setFailed(null); setPlaying(true); return }
    setPlaying(p => !p)
  }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (failed === 'all' ? ' broken' : '')} id={id} onClick={onTap}>
      {failed === 'all'
        ? <div className="exmedia-x"><Icon name="dumbbell" /></div>
        : clip
          ? <video ref={autoplayClip} className="catvid" src={clip} autoPlay muted loop playsInline disablePictureInPicture
              aria-label={exName(ex)} onError={onError} />
          : <img decoding="async" draggable={false} src={showAnim ? animUrl : stillUrl} alt={exName(ex)} onError={onError} />}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && !failed && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  const src = ex.img ? imgSrc(ex) : null
  const [broken, setBroken] = useState(null)
  if (!src || broken === src) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={src} alt="" onError={() => setBroken(src)} />
}
