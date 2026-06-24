import { useEffect, useState } from 'react'

interface Props {
  until: number
  mantra: string
  onDone: () => void
}

/**
 * Full-screen lockdown overlay: a calming countdown with a breathing circle
 * and the user's mantra. No dismiss — it clears itself when the timer ends.
 */
export function PanicOverlay({ until, mantra, onDone }: Props): JSX.Element {
  const [remaining, setRemaining] = useState(() => Math.max(0, until - Date.now()))

  useEffect(() => {
    const t = window.setInterval(() => {
      const r = Math.max(0, until - Date.now())
      setRemaining(r)
      if (r <= 0) {
        window.clearInterval(t)
        onDone()
      }
    }, 250)
    return () => window.clearInterval(t)
  }, [until, onDone])

  const totalSec = Math.ceil(remaining / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')

  return (
    <div className="panic-overlay">
      <div className="panic-inner">
        <div className="breathe-wrap">
          <div className="breathe-circle" />
          <span className="breathe-label">Breathe</span>
        </div>

        <div className="panic-headline">This feeling will pass.</div>
        {mantra && <div className="panic-mantra">{mantra}</div>}

        <div className="panic-countdown">
          {mm}:{ss}
        </div>
        <div className="panic-sub">Lockdown can’t be cancelled early — that’s the point.</div>
      </div>
    </div>
  )
}
