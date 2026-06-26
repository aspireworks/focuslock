import { useMemo, useState } from 'react'
import { ShieldCheck } from './icons'

interface Props {
  /** The statement the user reaffirms each morning. */
  text: string
  /** For a personalized greeting. */
  userName?: string
  /** Called after the commitment is recorded for today. */
  onCommitted: () => void
}

/**
 * Lenient comparison so the retype-to-match ritual isn't maddening: case-insensitive,
 * apostrophes dropped (straight vs curly, don't vs dont all pass), and any run of other
 * punctuation/whitespace collapsed to a single space.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
}

/**
 * Full-screen morning takeover: the user retypes their commitment to "commit" to the day.
 * No skip button — it clears once committed (the native window controls still let them
 * minimize Spawncamp to the tray, so it never traps the whole machine like Panic does).
 */
export function Commitment({ text, userName, onCommitted }: Props): JSX.Element {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  const matched = useMemo(() => normalize(typed) === normalize(text), [typed, text])
  const who = userName?.trim()

  async function commit(): Promise<void> {
    if (!matched || busy) return
    setBusy(true)
    await window.api.commitToday()
    onCommitted()
  }

  return (
    <div className="commit-overlay">
      <div className="commit-inner">
        <div className="commit-tile">
          <ShieldCheck size={34} />
        </div>
        <div className="commit-eyebrow">Daily commitment</div>
        <div className="commit-headline">
          {who ? `Good morning, ${who}.` : 'Good morning.'}
        </div>
        <p className="commit-body">
          Before anything else, set your intention for today. Read it, mean it, and type it
          out to commit.
        </p>

        <div className="commit-statement">{text}</div>

        <textarea
          className="field commit-input"
          placeholder="Type your commitment here…"
          value={typed}
          autoFocus
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit()
          }}
        />

        <div className="commit-actions">
          <button className="btn accent commit-btn" disabled={!matched || busy} onClick={() => void commit()}>
            {busy ? 'Committing…' : matched ? 'Commit to today →' : 'Type it out to commit'}
          </button>
        </div>
        <p className="commit-foot muted">
          You can change or turn off the daily commitment in Settings.
        </p>
      </div>
    </div>
  )
}
