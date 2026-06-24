import { useEffect, useState } from 'react'

const PHASES = ['Breathe in', 'Hold', 'Breathe out', 'Hold']

interface Props {
  until: number
  mantra: string
  onDone: () => void
}

/**
 * Full-screen lockdown overlay: a calming countdown with a box-breathing animation
 * and the user's mantra. No dismiss — it clears itself when the timer ends.
 */
export function PanicOverlay({ until, mantra, onDone }: Props): JSX.Element {
  const [remaining, setRemaining] = useState(() => Math.max(0, until - Date.now()))
  const [phase, setPhase] = useState(0)

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

  // Box breathing: 4s per phase (in / hold / out / hold).
  useEffect(() => {
    const t = window.setInterval(() => setPhase((p) => (p + 1) % 4), 4000)
    return () => window.clearInterval(t)
  }, [])

  const totalSec = Math.ceil(remaining / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  const big = phase === 0 || phase === 1 // large during inhale + hold-in

  return (
    <div className="panic-overlay">
      <div className="panic-inner">
        <div className="panic-title">Take a breath</div>
        <div className="panic-mantra">{mantra}</div>

        <div className="breathe-wrap">
          <div className={big ? 'breathe-circle big' : 'breathe-circle small'} />
          <span className="breathe-label">{PHASES[phase]}</span>
        </div>

        <div className="panic-countdown">
          {mm}:{ss}
        </div>
        <div className="panic-sub">
          Step away from the screen. Go for a short walk. This urge will pass — you’re the one in
          control.
        </div>
      </div>
    </div>
  )
}
