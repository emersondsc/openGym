import { useRef, useState } from 'react'

/** Pointer-driven vertical drag-to-reorder hook for `.list` containers. */
export function useDragReorder(count, onMove) {
  const listRef = useRef(null)
  const [drag, setDrag] = useState(null) // { idx, dy }
  const stateRef = useRef(null)

  const startDrag = (idx, e) => {
    e.preventDefault()
    e.stopPropagation()
    if (count < 2) return
    const list = listRef.current
    const els = list ? [...list.children] : []
    const step = els.length >= 2 ? els[1].getBoundingClientRect().top - els[0].getBoundingClientRect().top : 68
    stateRef.current = { idx, startY: e.clientY, step: Math.max(40, step) }
    setDrag({ idx, dy: 0 })

    const onMoveWin = ev => {
      const st = stateRef.current
      if (!st) return
      let dy = ev.clientY - st.startY
      if (dy > st.step * 0.55 && st.idx < count - 1) {
        onMove(st.idx, st.idx + 1)
        st.idx += 1
        st.startY += st.step
        dy -= st.step
      } else if (dy < -st.step * 0.55 && st.idx > 0) {
        onMove(st.idx, st.idx - 1)
        st.idx -= 1
        st.startY -= st.step
        dy += st.step
      }
      setDrag({ idx: st.idx, dy })
    }
    const onEnd = () => {
      stateRef.current = null
      setDrag(null)
      window.removeEventListener('pointermove', onMoveWin)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
    window.addEventListener('pointermove', onMoveWin)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  return { listRef, drag, startDrag }
}
