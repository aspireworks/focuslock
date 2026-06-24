import { useCallback, useEffect, useState, type SyntheticEvent } from 'react'

interface Props {
  id: string
  kind: 'text' | 'timer'
  text?: string
  endsAt?: number
  onResolve: (token: string | null) => void
}

const block = (e: SyntheticEvent): void => e.preventDefault()

export function Challenge({ id, kind, text, endsAt, onResolve }: Props): JSX.Element {
  if (kind === 'timer') {
    return <TimerChallenge id={id} endsAt={endsAt ?? 0} onResolve={onResolve} />
  }
  return <TextChallenge id={id} text={text ?? ''} onResolve={onResolve} />
}

/** Countdown that auto-unlocks when it elapses. Time is verified by the main process. */
function TimerChallenge({
  id,
  endsAt,
  onResolve
}: {
  id: string
  endsAt: number
  onResolve: (token: string | null) => void
}): JSX.Element {
  const [remaining, setRemaining] = useState(() => Math.max(0, endsAt - Date.now()))

  const claim = useCallback(async () => {
    const res = await window.api.claimTimer(id)
    if (res.ok && res.token) onResolve(res.token)
  }, [id, onResolve])

  useEffect(() => {
    const t = window.setInterval(() => {
      const r = Math.max(0, endsAt - Date.now())
      setRemaining(r)
      if (r <= 0) {
        window.clearInterval(t)
        void claim()
      }
    }, 250)
    return () => window.clearInterval(t)
  }, [endsAt, claim])

  const totalSec = Math.ceil(remaining / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Wait it out</h2>
        <p className="muted">
          The block lifts when this timer reaches zero. It can’t be skipped — that pause is the
          point. You can leave this window open in the background.
        </p>
        <div className="countdown">
          {mm}:{ss}
        </div>
        <div className="challenge-footer">
          <span className="muted">{remaining <= 0 ? 'Unlocking…' : 'Counting down…'}</span>
          <button className="btn ghost" onClick={() => onResolve(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Type-the-text cool-down. Paste is disabled on purpose — the time it takes is the feature.
 */
function TextChallenge({
  id,
  text,
  onResolve
}: {
  id: string
  text: string
  onResolve: (token: string | null) => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const [checking, setChecking] = useState(false)

  let matched = 0
  while (matched < value.length && matched < text.length && value[matched] === text[matched]) {
    matched++
  }
  const hasError = value.length > matched
  const complete = value === text

  const submit = useCallback(async () => {
    setChecking(true)
    const res = await window.api.verifyChallenge(id, value)
    setChecking(false)
    if (res.ok && res.token) onResolve(res.token)
  }, [id, value, onResolve])

  useEffect(() => {
    if (complete && !checking) void submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete])

  const pct = text.length ? Math.round((matched / text.length) * 100) : 0

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Type to unlock</h2>
        <p className="muted">
          Type the text below <strong>exactly</strong> to make this change. No copy-paste — the time
          it takes is the point.
        </p>

        <div className="challenge-text" onCopy={block} onCut={block} onContextMenu={block}>
          <span className="done">{text.slice(0, matched)}</span>
          <span className="todo">{text.slice(matched)}</span>
        </div>

        <textarea
          className={hasError ? 'challenge-input has-error' : 'challenge-input'}
          value={value}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onPaste={block}
          onDrop={block}
          onContextMenu={block}
          placeholder="Type here…"
        />

        <div className="progress">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>

        <div className="challenge-footer">
          <span className="muted">
            {matched} / {text.length}
            {hasError ? ' — mismatch, fix it' : ''}
          </span>
          <div className="row-gap">
            <button className="btn ghost" onClick={() => onResolve(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!complete || checking}
              onClick={() => void submit()}
            >
              {checking ? 'Checking…' : 'Unlock'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
