import { useEffect, useState } from 'react'

interface GameRow {
  label: string
  exe: string
  status: string
  detected: boolean
  blocked: boolean
}

interface Props {
  onDone: () => void
}

const SITE_SUGGESTIONS = [
  'store.steampowered.com',
  'epicgames.com',
  'xbox.com',
  'ea.com',
  'battle.net',
  'roblox.com',
  'twitch.tv'
]

const TOTAL = 6

export function Onboarding({ onDone }: Props): JSX.Element {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [games, setGames] = useState<GameRow[] | null>(null)
  const [apps, setApps] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'always' | 'schedule'>('always')
  const [sites, setSites] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (step === 2 && games === null) {
      void window.api.detectGames().then((g) => {
        const rows = g as GameRow[]
        setGames(rows)
        setApps(new Set(rows.filter((x) => x.detected).map((x) => x.exe)))
      })
    }
  }, [step, games])

  const next = (): void => setStep((s) => Math.min(TOTAL - 1, s + 1))
  const back = (): void => setStep((s) => Math.max(0, s - 1))

  function toggle(set: Set<string>, val: string, setter: (s: Set<string>) => void): void {
    const n = new Set(set)
    if (n.has(val)) n.delete(val)
    else n.add(val)
    setter(n)
  }

  function addCustom(): void {
    const v = custom.trim()
    if (!v) return
    const n = new Set(sites)
    n.add(v)
    setSites(n)
    setCustom('')
  }

  async function finish(): Promise<void> {
    setBusy(true)
    await window.api.completeOnboarding({
      name: name.trim(),
      apps: [...apps],
      mode,
      sites: [...sites]
    })
    onDone()
  }

  const who = name.trim() || 'friend'
  const detected = games ? games.filter((g) => g.detected) : []
  const customSites = [...sites].filter((s) => !SITE_SUGGESTIONS.includes(s))

  return (
    <div className="onb-overlay">
      <div className="onb-card">
        <div className="onb-dots">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <span key={i} className={i === step ? 'onb-dot active' : 'onb-dot'} />
          ))}
        </div>

        {step === 0 && (
          <div className="onb-step">
            <div className="onb-emoji">👋</div>
            <h2>Hey there.</h2>
            <p>
              Before we dive in — a quick heads up. FocusLock is an <strong>early beta</strong>. It’s
              powerful, but it’s new, so you might bump into a rough edge here and there. If anything
              feels off, there’s a <em>Send feedback</em> button built right in, and I’d genuinely
              love to hear from you.
            </p>
            <p className="muted">You’re an early part of building this. Thank you for that.</p>
            <div className="onb-actions">
              <button className="btn primary" onClick={next}>
                I’m in →
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onb-step">
            <h2>We’re really glad you’re here.</h2>
            <p>
              Deciding to take back control from gaming takes real guts — and you’ve already started.
              This tool is going to be a powerful ally in your corner.
            </p>
            <p>
              First things first: <strong>what should I call you?</strong>
            </p>
            <input
              className="input onb-input"
              placeholder="Your name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && next()}
            />
            <div className="onb-actions">
              <button className="btn ghost" onClick={back}>
                Back
              </button>
              <button className="btn primary" onClick={next}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onb-step">
            <h2>Nice to meet you, {who}.</h2>
            <p>
              Let’s see what we’re working with. Here’s what I found installed or running on your
              machine — pick the ones you want to lock down.
            </p>
            <div className="onb-list">
              {!games && <div className="muted pad">Scanning your computer…</div>}
              {games && detected.length === 0 && (
                <div className="muted pad">
                  I didn’t spot any common launchers — no worries, you can add apps anytime from the
                  dashboard.
                </div>
              )}
              {detected.map((g) => (
                <button
                  key={g.exe}
                  className={apps.has(g.exe) ? 'onb-pick active' : 'onb-pick'}
                  onClick={() => toggle(apps, g.exe, setApps)}
                >
                  <span className="onb-check">{apps.has(g.exe) ? '✓' : ''}</span>
                  <span>
                    {g.label}
                    <span className="muted exe-name">{g.exe}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="onb-actions">
              <button className="btn ghost" onClick={back}>
                Back
              </button>
              <button className="btn primary" onClick={next}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onb-step">
            <h2>How far do you want to go, {who}?</h2>
            <p>
              If you’re doing a dopamine detox, I’d honestly recommend blocking these{' '}
              <strong>completely</strong> — give yourself a clean break for at least the next 30 days.
              That’s where the real reset happens. But if you need some access, you can put them on a
              schedule instead.
            </p>
            <div className="onb-choices">
              <button
                className={mode === 'always' ? 'onb-choice active' : 'onb-choice'}
                onClick={() => setMode('always')}
              >
                <strong>Block completely</strong>
                <span className="muted">Recommended · blocked 24/7</span>
              </button>
              <button
                className={mode === 'schedule' ? 'onb-choice active' : 'onb-choice'}
                onClick={() => setMode('schedule')}
              >
                <strong>On a schedule</strong>
                <span className="muted">We’ll start you on weekdays 9–5 — tweak it anytime</span>
              </button>
            </div>
            <div className="onb-actions">
              <button className="btn ghost" onClick={back}>
                Back
              </button>
              <button className="btn primary" onClick={next}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="onb-step">
            <h2>What about the web?</h2>
            <p>
              Games aren’t just apps — the storefronts and communities pull you in too. Want me to
              block some gaming sites as well? Tap any that apply.{' '}
              <span className="muted">(This one asks Windows for a quick admin “yes”.)</span>
            </p>
            <div className="onb-chips">
              {SITE_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className={sites.has(s) ? 'chip-lg active' : 'chip-lg'}
                  onClick={() => toggle(sites, s, setSites)}
                >
                  {sites.has(s) ? '✓ ' : ''}
                  {s}
                </button>
              ))}
              {customSites.map((s) => (
                <button
                  key={s}
                  className="chip-lg active"
                  onClick={() => toggle(sites, s, setSites)}
                >
                  ✓ {s}
                </button>
              ))}
            </div>
            <div className="row-gap add-row">
              <input
                className="input"
                placeholder="add another, e.g. reddit.com"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustom()}
              />
              <button className="btn ghost" onClick={addCustom}>
                Add
              </button>
            </div>
            <div className="onb-actions">
              <button className="btn ghost" onClick={back}>
                Back
              </button>
              <button className="btn primary" onClick={next}>
                {sites.size > 0 ? 'Continue →' : 'Skip for now →'}
              </button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="onb-step">
            <div className="onb-emoji">💪</div>
            <h2>That’s it, {who}. You’re set.</h2>
            <p>
              FocusLock is in your corner now — when the urge hits, it’s got your back. You can change
              anything from the dashboard, and if you ever need to slam the door shut fast, there’s a{' '}
              <strong>Panic</strong> button up top.
            </p>
            <p className="muted">Let’s do this.</p>
            <div className="onb-actions">
              <button className="btn ghost" onClick={back} disabled={busy}>
                Back
              </button>
              <button className="btn primary" onClick={() => void finish()} disabled={busy}>
                {busy ? 'Setting up…' : 'Enter FocusLock →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
