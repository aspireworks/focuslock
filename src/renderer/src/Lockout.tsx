import { ShieldCheck } from './icons'

interface Props {
  /** Name of the app that was just caught/closed. */
  appName: string
  /** Current day streak, woven into the body copy. */
  streak: number
  onClose: () => void
  onUnlock: () => void
}

/**
 * Full-screen takeover shown when a blocked app is caught/closed.
 * Currently surfaced as a preview from Settings; the copy leans on the streak.
 */
export function Lockout({ appName, streak, onClose, onUnlock }: Props): JSX.Element {
  return (
    <div className="lockout">
      <div className="lockout-inner">
        <div className="lockout-tile">
          <ShieldCheck size={34} />
        </div>
        <div className="lockout-eyebrow">
          Blocked · {appName.toUpperCase()} closed
        </div>
        <div className="lockout-headline">Not right now. You’ve got this.</div>
        <p className="lockout-body">
          You’re <strong>{streak} {streak === 1 ? 'day' : 'days'} strong</strong> — that’s real
          progress. Don’t trade it for twenty minutes you won’t remember tomorrow.
        </p>
        <div className="lockout-actions">
          <button className="btn accent" onClick={onClose}>
            I’m good — close this
          </button>
          <button className="btn ghost" onClick={onUnlock}>
            Unlock anyway
          </button>
        </div>
      </div>
    </div>
  )
}
