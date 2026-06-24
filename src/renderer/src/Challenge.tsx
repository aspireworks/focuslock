import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react'

interface Props {
  id: string
  kind: 'text' | 'timer'
  text?: string
  endsAt?: number
  /** Why the challenge is being shown, e.g. "Removing Steam". */
  context?: string
  onResolve: (token: string | null) => void
}

const block = (e: SyntheticEvent): void => e.preventDefault()

export function Challenge({ id, kind, text, endsAt, context, onResolve }: Props): JSX.Element {
  if (kind === 'timer') {
    return <TimerChallenge id={id} endsAt={endsAt ?? 0} context={context} onResolve={onResolve} />
  }
  return <TextChallenge id={id} text={text ?? ''} context={context} onResolve={onResolve} />
}

/** Countdown that auto-unlocks when it elapses. Time is verified by the main process. */
function TimerChallenge({
  id,
  endsAt,
  context,
  onResolve
}: {
  id: string
  endsAt: number
  context?: string
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
        <div className="modal-title">Wait it out</div>
        <p className="modal-context">
          {context ? `${context}. ` : ''}The block lifts when this timer reaches zero — it can’t be
          skipped. That pause is the point.
        </p>
        <div className="countdown">
          {mm}:{ss}
        </div>
        <div className="modal-footer">
          <span className="count">{remaining <= 0 ? 'Unlocking…' : 'Counting down…'}</span>
          <button className="btn ghost" onClick={() => onResolve(null)}>
            Never mind
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
  context,
  onResolve
}: {
  id: string
  text: string
  context?: string
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

  // Prefer a word counter (matches the common "random words" challenge); fall back to chars.
  const counter = useMemo(() => {
    const totalWords = text.split(/\s+/).filter(Boolean).length
    if (totalWords > 1) {
      const typedWords = text.slice(0, matched).split(/\s+/).filter(Boolean).length
      return `${typedWords} / ${totalWords} words${hasError ? ' — fix the mismatch' : ''}`
    }
    return `${matched} / ${text.length}${hasError ? ' — fix the mismatch' : ''}`
  }, [text, matched, hasError])

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Unlock challenge</div>
        <p className="modal-context">
          {context ? `${context}. ` : ''}Type the text below exactly to continue.
        </p>

        <div className="challenge-target" onCopy={block} onCut={block} onContextMenu={block}>
          <span className="done">{text.slice(0, matched)}</span>
          <span className="todo">{text.slice(matched)}</span>
        </div>

        <textarea
          className={hasError ? 'challenge-area has-error' : 'challenge-area'}
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

        <div className="challenge-progress">
          <div className="challenge-progress-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="modal-footer">
          <span className="count">{counter}</span>
          <div className="footer-btns">
            <button className="btn ghost" onClick={() => onResolve(null)}>
              Never mind
            </button>
            <button
              className="btn accent"
              disabled={!complete || checking}
              onClick={() => void submit()}
            >
              {checking ? 'Checking…' : 'Continue →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
