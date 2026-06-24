import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Challenge } from './Challenge'
import { PanicOverlay } from './Panic'
import { Onboarding } from './Onboarding'
import {
  DAY_LABELS,
  dedupeRanges,
  toMinutes,
  type AppState,
  type BlockedApp,
  type BlockMode,
  type ChallengeType,
  type Schedule,
  type TimeRange
} from './types'
// FolderRule type is read via state.config; no direct import needed.

interface ProtectedResult {
  ok: boolean
  reason?: string
}

interface GameRow {
  label: string
  exe: string
  status: string
  detected: boolean
  blocked: boolean
}

const MODES: { key: BlockMode; label: string }[] = [
  { key: 'always', label: 'Always' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'budget', label: 'Limit' }
]

const CHALLENGE_TYPES: { key: ChallengeType; label: string }[] = [
  { key: 'words', label: 'Random words' },
  { key: 'chars', label: 'Characters' },
  { key: 'custom', label: 'Custom text' },
  { key: 'timer', label: 'Timer' }
]

function formatUntil(iso: string | null): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'now'
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 24) return `${Math.round(h / 24)}d`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtDur(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

type SchedView = 'weekdays' | 'custom'

function isWeekdays95(s: Schedule): boolean {
  for (let d = 0; d <= 6; d++) {
    const r = s[String(d)] ?? []
    if (d >= 1 && d <= 5) {
      if (r.length !== 1 || r[0].start !== '09:00' || r[0].end !== '17:00') return false
    } else if (r.length !== 0) {
      return false
    }
  }
  return true
}

function detectView(s: Schedule): SchedView {
  if (isWeekdays95(s)) return 'weekdays'
  return 'custom'
}

export default function App(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Schedule editing draft
  const [draft, setDraft] = useState<Schedule | null>(null)
  const [schedView, setSchedView] = useState<SchedView>('custom')

  // Add-app + pickers
  const [newApp, setNewApp] = useState('')
  const [siteInput, setSiteInput] = useState('')
  const [running, setRunning] = useState<string[] | null>(null)
  const [runningFilter, setRunningFilter] = useState('')
  const [loadingRunning, setLoadingRunning] = useState(false)

  // Gaming launcher detection (modal)
  const [games, setGames] = useState<GameRow[] | null>(null)
  const [showGames, setShowGames] = useState(false)
  const [showRunning, setShowRunning] = useState(false)

  // Per-app budget minute drafts
  const [limitDrafts, setLimitDrafts] = useState<Record<string, number>>({})

  // Schedule quick-add
  const [qaDays, setQaDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]))
  const [qaStart, setQaStart] = useState('09:00')
  const [qaEnd, setQaEnd] = useState('17:00')

  // Challenge config drafts
  const [chType, setChType] = useState<ChallengeType>('words')
  const [chLen, setChLen] = useState(250)
  const [chWords, setChWords] = useState(40)
  const [chCustom, setChCustom] = useState('')
  const [chTimer, setChTimer] = useState(5)

  // Panic config drafts
  const [panicMin, setPanicMin] = useState(5)
  const [panicMantra, setPanicMantra] = useState('')
  const [panicBrowsers, setPanicBrowsers] = useState(true)
  const [blockMsg, setBlockMsg] = useState('')

  // Challenge modal
  const [challenge, setChallenge] = useState<
    null | {
      id: string
      kind: 'text' | 'timer'
      text?: string
      endsAt?: number
      onResolve: (t: string | null) => void
    }
  >(null)

  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state
  const greeted = useRef(false)

  const flash = useCallback((msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(null), 4000)
  }, [])

  const refresh = useCallback(async () => {
    setState((await window.api.getState()) as AppState)
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(t)
  }, [refresh])

  // One-time boot greeting.
  useEffect(() => {
    if (state?.config.onboardingComplete && state.config.userName && !greeted.current) {
      greeted.current = true
      flash(`Welcome back, ${state.config.userName}.`)
    }
  }, [state, flash])

  useEffect(() => {
    if (state && draft === null) {
      setDraft(state.config.schedule)
      setSchedView(detectView(state.config.schedule))
      setChType(state.config.challenge.type)
      setChLen(state.config.challenge.length)
      setChWords(state.config.challenge.wordCount)
      setChCustom(state.config.challenge.customText)
      setChTimer(state.config.challenge.timerMinutes)
      setPanicMin(state.config.panic.minutes)
      setPanicMantra(state.config.panic.mantra)
      setPanicBrowsers(state.config.panic.blockBrowsers)
      setBlockMsg(state.config.blockMessage)
    }
  }, [state, draft])

  const runChallenge = useCallback(
    (c: { id: string; kind: 'text' | 'timer'; text?: string; endsAt?: number }) =>
      new Promise<string | null>((resolve) => {
        setChallenge({
          ...c,
          onResolve: (t) => {
            setChallenge(null)
            resolve(t)
          }
        })
      }),
    []
  )

  const protectedCall = useCallback(
    async (fn: (token?: string) => Promise<ProtectedResult>): Promise<boolean> => {
      let res = await fn(undefined)
      if (res && res.ok === false && res.reason === 'locked') {
        const c = await window.api.startChallenge()
        const token = await runChallenge(c)
        if (!token) return false
        res = await fn(token)
        if (res && res.ok === false) {
          flash('Still locked — try again.')
          return false
        }
      }
      await refresh()
      return true
    },
    [refresh, runChallenge, flash]
  )

  const scanGames = useCallback(async () => {
    setGames((await window.api.detectGames()) as GameRow[])
  }, [])

  const openGames = useCallback(() => {
    setShowGames(true)
    void scanGames()
  }, [scanGames])

  // New apps default to "Always" so "block this" actually blocks immediately.
  const addApp = useCallback(
    async (name: string, mode: BlockMode = 'always') => {
      const n = name.trim()
      if (!n) return
      await window.api.addApp(n, mode)
      setNewApp('')
      await refresh()
      await scanGames()
      flash(`Blocking ${n}.`)
    },
    [refresh, flash, scanGames]
  )

  const browse = useCallback(async () => {
    const picked = await window.api.pickAppFile()
    if (picked) await addApp(picked.name)
  }, [addApp])

  const removeApp = useCallback(
    async (name: string) => {
      await protectedCall((token) => window.api.removeApp(name, token) as Promise<ProtectedResult>)
      await scanGames()
    },
    [protectedCall, scanGames]
  )

  const changeMode = useCallback(
    (appCfg: BlockedApp, mode: BlockMode) =>
      protectedCall(
        (token) =>
          window.api.setAppMode(
            appCfg.name,
            mode,
            mode === 'budget' ? appCfg.dailyLimitMinutes || 60 : undefined,
            token
          ) as Promise<ProtectedResult>
      ),
    [protectedCall]
  )

  const commitLimit = useCallback(
    async (appCfg: BlockedApp) => {
      const v = limitDrafts[appCfg.name]
      if (v == null || v === appCfg.dailyLimitMinutes) return
      await protectedCall(
        (token) => window.api.setAppMode(appCfg.name, 'budget', v, token) as Promise<ProtectedResult>
      )
    },
    [limitDrafts, protectedCall]
  )

  const addFolder = useCallback(async () => {
    const path = await window.api.pickFolder()
    if (!path) return
    await window.api.addFolder(path, 'always')
    await refresh()
    flash('Folder blocked.')
  }, [refresh, flash])

  const changeFolderMode = useCallback(
    (path: string, mode: 'always' | 'schedule') =>
      protectedCall(
        (token) => window.api.setFolderMode(path, mode, token) as Promise<ProtectedResult>
      ),
    [protectedCall]
  )

  const removeFolder = useCallback(
    (path: string) =>
      protectedCall((token) => window.api.removeFolder(path, token) as Promise<ProtectedResult>),
    [protectedCall]
  )

  const addSite = useCallback(async () => {
    const d = siteInput.trim()
    if (!d) return
    const res = (await window.api.addSite(d)) as { ok: boolean; error?: string }
    if (res?.ok === false) {
      flash(res.error || 'Could not block that site.')
      return
    }
    setSiteInput('')
    await refresh()
    flash(`Blocking ${d}.`)
  }, [siteInput, refresh, flash])

  const removeSite = useCallback(
    (domain: string) =>
      protectedCall((token) => window.api.removeSite(domain, token) as Promise<ProtectedResult>),
    [protectedCall]
  )

  const togglePause = useCallback(async () => {
    const cur = stateRef.current?.paused ?? false
    await window.api.setPaused(!cur)
    await refresh()
  }, [refresh])

  const saveChallenge = useCallback(async () => {
    const ok = await protectedCall(
      (token) =>
        window.api.setChallenge(
          {
            type: chType,
            length: chLen,
            wordCount: chWords,
            customText: chCustom,
            timerMinutes: chTimer
          },
          token
        ) as Promise<ProtectedResult>
    )
    if (ok) flash('Challenge settings saved.')
  }, [chType, chLen, chWords, chCustom, chTimer, protectedCall, flash])

  const quit = useCallback(
    () => protectedCall((token) => window.api.requestQuit(token) as Promise<ProtectedResult>),
    [protectedCall]
  )

  const triggerPanic = useCallback(async () => {
    await window.api.startPanic()
    await refresh()
  }, [refresh])

  const savePanic = useCallback(async () => {
    await window.api.setPanicConfig({
      minutes: panicMin,
      mantra: panicMantra,
      blockBrowsers: panicBrowsers
    })
    await refresh()
    flash('Panic settings saved.')
  }, [panicMin, panicMantra, panicBrowsers, refresh, flash])

  const saveBlockMsg = useCallback(async () => {
    await window.api.setBlockMessage(blockMsg)
    await refresh()
    flash('Block message saved.')
  }, [blockMsg, refresh, flash])

  const toggleProtection = useCallback(async () => {
    if (stateRef.current?.config.protectionEnabled) {
      await protectedCall(
        (token) => window.api.setProtection(false, token) as Promise<ProtectedResult>
      )
    } else {
      await window.api.setProtection(true)
      await refresh()
      flash('Protection on — FocusLock will stay running and start on login.')
    }
  }, [protectedCall, refresh, flash])

  useEffect(() => window.api.onQuitRequested(() => void quit()), [quit])

  // ---- Schedule draft editing ----
  function mutateDay(day: number, fn: (ranges: TimeRange[]) => TimeRange[]): void {
    setDraft((prev) => {
      const base: Schedule = { ...(prev ?? {}) }
      base[String(day)] = fn([...(base[String(day)] ?? [])])
      return base
    })
  }

  const applyPreset = useCallback((kind: 'weekdays' | 'everyday') => {
    const s: Schedule = {}
    if (kind === 'weekdays') {
      for (let d = 1; d <= 5; d++) s[String(d)] = [{ start: '09:00', end: '17:00' }]
    } else {
      for (let d = 0; d <= 6; d++) s[String(d)] = [{ start: '00:00', end: '23:59' }]
    }
    setDraft(s)
  }, [])

  const selectView = useCallback(
    (v: SchedView) => {
      setSchedView(v)
      if (v === 'weekdays') applyPreset('weekdays')
      // 'custom' keeps the current draft so the user can fine-tune it
    },
    [applyPreset]
  )

  const clearSchedule = useCallback(() => {
    setDraft({})
    setSchedView('custom')
  }, [])

  const applyQuickAdd = useCallback(() => {
    if (toMinutes(qaEnd) <= toMinutes(qaStart)) {
      flash('End time must be after start.')
      return
    }
    if (qaDays.size === 0) {
      flash('Pick at least one day.')
      return
    }
    setDraft((prev) => {
      const next: Schedule = { ...(prev ?? {}) }
      for (const d of qaDays) {
        const key = String(d)
        next[key] = dedupeRanges([...(next[key] ?? []), { start: qaStart, end: qaEnd }])
      }
      return next
    })
  }, [qaDays, qaStart, qaEnd, flash])

  const saveSchedule = useCallback(async () => {
    if (!draft) return
    const cleaned: Schedule = {}
    for (const k of Object.keys(draft)) {
      const d = dedupeRanges(draft[k])
      if (d.length) cleaned[k] = d
    }
    const ok = await protectedCall(
      (token) => window.api.setSchedule(cleaned, true, token) as Promise<ProtectedResult>
    )
    if (ok) {
      setDraft(cleaned)
      flash('Schedule saved.')
    }
  }, [draft, protectedCall, flash])

  const loadRunning = useCallback(async () => {
    setLoadingRunning(true)
    setRunning(await window.api.listProcesses())
    setLoadingRunning(false)
  }, [])

  const openRunning = useCallback(() => {
    setShowRunning(true)
    void loadRunning()
  }, [loadRunning])

  const dirty = useMemo(() => {
    if (!state || !draft) return false
    return JSON.stringify(draft) !== JSON.stringify(state.config.schedule)
  }, [state, draft])

  const usedMinutes = useCallback(
    (name: string) => Math.floor((state?.usage.seconds[name.toLowerCase()] ?? 0) / 60),
    [state]
  )

  if (!state || !draft) {
    return <div className="loading">Loading FocusLock…</div>
  }

  const { status, config, killLog, paused, version, stats } = state
  const blockedSet = new Set(config.blocklist.map((a) => a.name.toLowerCase()))
  const blockMsgDirty = blockMsg !== config.blockMessage
  const chartMax = Math.max(1, ...stats.last7.map((d) => d.count))

  const enforcing =
    !paused &&
    (config.blockedSites.length > 0 ||
      config.blocklist.some(
        (a) =>
          a.mode === 'always' ||
          (a.mode === 'schedule' && status.active) ||
          (a.mode === 'budget' && usedMinutes(a.name) >= (a.dailyLimitMinutes ?? 0))
      ))

  const runningFiltered = (running ?? []).filter((n) =>
    n.toLowerCase().includes(runningFilter.toLowerCase())
  )

  const headerClass = paused
    ? 'status status-paused'
    : enforcing
      ? 'status status-active'
      : 'status status-idle'

  const chDirty =
    chType !== config.challenge.type ||
    chLen !== config.challenge.length ||
    chWords !== config.challenge.wordCount ||
    chCustom !== config.challenge.customText ||
    chTimer !== config.challenge.timerMinutes

  const panicDirty =
    panicMin !== config.panic.minutes ||
    panicMantra !== config.panic.mantra ||
    panicBrowsers !== config.panic.blockBrowsers

  if (!config.onboardingComplete) {
    return <Onboarding onDone={() => void refresh()} />
  }

  return (
    <div className="app">
      {notice && <div className="notice">{notice}</div>}

      <header className={headerClass}>
        <div>
          <div className="status-label">
            {paused ? 'PAUSED (dev override)' : enforcing ? 'BLOCKING ACTIVE' : 'Idle'}
          </div>
          <div className="status-sub">
            {paused
              ? 'Nothing is being blocked while paused.'
              : enforcing
                ? 'Blocked apps will be closed on sight.'
                : status.nextChange
                  ? `Next scheduled block in ${formatUntil(status.nextChange)}`
                  : `${config.blocklist.length} app(s) armed`}
          </div>
        </div>
        <div className="header-right">
          <button className="btn panic-btn" onClick={() => void triggerPanic()}>
            Panic
          </button>
          <button className={paused ? 'btn primary' : 'btn ghost'} onClick={() => void togglePause()}>
            {paused ? 'Resume blocking' : 'Pause (dev)'}
          </button>
          <div className="brand">FocusLock</div>
        </div>
      </header>

      <main className="grid">
        {/* Progress */}
        <section className="card progress-card">
          <h3>Your progress</h3>
          <div className="stat-row">
            <div className="stat-big">
              <div className="stat-num">{stats.daysSinceStart}</div>
              <div className="stat-label">{stats.daysSinceStart === 1 ? 'day' : 'days'} strong</div>
            </div>
            <div className="stat-big">
              <div className="stat-num">{stats.weekTotal}</div>
              <div className="stat-label">resisted this week</div>
            </div>
            <div className="stat-big">
              <div className="stat-num">{stats.totalBlocks}</div>
              <div className="stat-label">total blocks</div>
            </div>
          </div>

          <div className="chart">
            {stats.last7.map((d) => (
              <div key={d.date} className="chart-col">
                <div className="chart-bar-wrap">
                  <div
                    className="chart-bar"
                    style={{ height: `${Math.round((d.count / chartMax) * 100)}%` }}
                    title={`${d.count}`}
                  />
                </div>
                <div className="chart-day">
                  {DAY_LABELS[new Date(d.date + 'T00:00:00').getDay()][0]}
                </div>
              </div>
            ))}
          </div>

          {stats.totalBlocks === 0 ? (
            <p className="muted pad">
              No blocks yet — once FocusLock starts catching things, your wins show up here.
            </p>
          ) : (
            stats.topApps.length > 0 && (
              <>
                <p className="muted top-label">Most-resisted</p>
                <ul className="list">
                  {stats.topApps.map((a) => (
                    <li key={a.name} className="list-item">
                      <span>{a.name}</span>
                      <span className="muted">{a.count}×</span>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}

          {stats.weekRuntime.length > 0 && (
            <>
              <p className="muted top-label">Time on blocked apps (last 7 days)</p>
              <ul className="list">
                {stats.weekRuntime.map((a) => (
                  <li key={a.name} className="list-item">
                    <span>{a.name}</span>
                    <span className="muted">{fmtDur(a.seconds)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Blocked apps */}
        <section className="card">
          <h3>Blocked apps</h3>
          <div className="row-gap add-row">
            <input
              className="input"
              placeholder="e.g. steam.exe"
              value={newApp}
              onChange={(e) => setNewApp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addApp(newApp)}
            />
            <button className="btn primary" onClick={() => void addApp(newApp)}>
              Add
            </button>
            <button className="btn ghost" onClick={() => void browse()}>
              Browse…
            </button>
          </div>

          <div className="row-gap">
            <button className="btn ghost" onClick={openGames}>
              Add game launchers
            </button>
            <button className="btn ghost" onClick={openRunning}>
              Add from running apps
            </button>
          </div>

          <ul className="list scroll">
            {config.blocklist.length === 0 && <li className="muted pad">Nothing blocked yet.</li>}
            {config.blocklist.map((a) => {
              const limit = a.dailyLimitMinutes ?? 60
              const used = usedMinutes(a.name)
              return (
                <li key={a.name} className="app-item">
                  <div className="app-item-top">
                    <span className="app-name">{a.name}</span>
                    <button className="btn danger sm" onClick={() => void removeApp(a.name)}>
                      Remove
                    </button>
                  </div>
                  <div className="app-item-controls">
                    <div className="seg">
                      {MODES.map((m) => (
                        <button
                          key={m.key}
                          className={a.mode === m.key ? 'seg-btn active' : 'seg-btn'}
                          onClick={() => void changeMode(a, m.key)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {a.mode === 'budget' && (
                      <div className="budget-row">
                        <input
                          className="input mini"
                          type="number"
                          min={1}
                          max={1440}
                          value={limitDrafts[a.name] ?? limit}
                          onChange={(e) =>
                            setLimitDrafts((d) => ({ ...d, [a.name]: Number(e.target.value) }))
                          }
                          onBlur={() => void commitLimit(a)}
                        />
                        <span className="muted">
                          min/day · {used}/{limit}m used{used >= limit ? ' — reached' : ''}
                        </span>
                      </div>
                    )}
                    {a.mode === 'schedule' && (
                      <span className="muted mode-hint">uses the schedule →</span>
                    )}
                    {a.mode === 'always' && <span className="muted mode-hint">blocked 24/7</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Blocked folders */}
        <section className="card">
          <h3>Blocked folders</h3>
          <p className="muted">
            Blocks every app launched from inside a folder — e.g. a game library.
          </p>
          <div className="row-gap add-row">
            <button className="btn primary" onClick={() => void addFolder()}>
              Add folder…
            </button>
          </div>
          <ul className="list scroll">
            {config.folderBlocks.length === 0 && (
              <li className="muted pad">No folders blocked.</li>
            )}
            {config.folderBlocks.map((f) => (
              <li key={f.path} className="app-item">
                <div className="app-item-top">
                  <span className="folder-path" title={f.path}>
                    {f.path}
                  </span>
                  <button className="btn danger sm" onClick={() => void removeFolder(f.path)}>
                    Remove
                  </button>
                </div>
                <div className="app-item-controls">
                  <div className="seg">
                    <button
                      className={f.mode === 'always' ? 'seg-btn active' : 'seg-btn'}
                      onClick={() => void changeFolderMode(f.path, 'always')}
                    >
                      Always
                    </button>
                    <button
                      className={f.mode === 'schedule' ? 'seg-btn active' : 'seg-btn'}
                      onClick={() => void changeFolderMode(f.path, 'schedule')}
                    >
                      Schedule
                    </button>
                  </div>
                  <span className="muted mode-hint">
                    {f.mode === 'always' ? 'blocked 24/7' : 'uses the schedule →'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Blocked websites */}
        <section className="card">
          <h3>Blocked websites</h3>
          <p className="muted">
            Blocks domains across Chrome, Edge &amp; Firefox via the hosts file. Adding or removing
            one shows a Windows admin prompt.
          </p>
          <div className="row-gap add-row">
            <input
              className="input"
              placeholder="e.g. reddit.com"
              value={siteInput}
              onChange={(e) => setSiteInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addSite()}
            />
            <button className="btn primary" onClick={() => void addSite()}>
              Block
            </button>
          </div>
          <ul className="list scroll">
            {config.blockedSites.length === 0 && <li className="muted pad">No sites blocked.</li>}
            {config.blockedSites.map((d) => (
              <li key={d} className="list-item">
                <span>{d}</span>
                <button className="btn danger sm" onClick={() => void removeSite(d)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Schedule */}
        <section className="card">
          <h3>Schedule</h3>
          <p className="muted">When apps set to “Schedule” mode are blocked.</p>

          <div className="seg challenge-seg">
            <button
              className={schedView === 'weekdays' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => selectView('weekdays')}
            >
              Weekdays 9–5
            </button>
            <button
              className={schedView === 'custom' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => selectView('custom')}
            >
              Custom
            </button>
          </div>

          {schedView === 'weekdays' && (
            <p className="sched-summary">
              Blocking <strong>Monday–Friday</strong>, 9:00 AM – 5:00 PM.
            </p>
          )}

          {schedView === 'custom' && (
            <>
              <div className="quick-add">
                <div className="day-chips">
                  {DAY_LABELS.map((label, d) => (
                    <button
                      key={d}
                      className={qaDays.has(d) ? 'chip active' : 'chip'}
                      onClick={() =>
                        setQaDays((prev) => {
                          const next = new Set(prev)
                          if (next.has(d)) next.delete(d)
                          else next.add(d)
                          return next
                        })
                      }
                    >
                      {label[0]}
                    </button>
                  ))}
                </div>
                <div className="row-gap">
                  <input type="time" value={qaStart} onChange={(e) => setQaStart(e.target.value)} />
                  <span>–</span>
                  <input type="time" value={qaEnd} onChange={(e) => setQaEnd(e.target.value)} />
                  <button className="btn ghost sm" onClick={applyQuickAdd}>
                    Add to selected days
                  </button>
                </div>
              </div>

              <div className="schedule">
                {DAY_LABELS.map((label, day) => {
                  const ranges = draft[String(day)] ?? []
                  return (
                    <div key={day} className="sched-day">
                      <div className="sched-day-label">{label}</div>
                      <div className="sched-ranges">
                        {ranges.map((r, i) => {
                          const invalid = toMinutes(r.end) <= toMinutes(r.start)
                          return (
                            <div key={i} className={invalid ? 'sched-range invalid' : 'sched-range'}>
                              <input
                                type="time"
                                value={r.start}
                                onChange={(e) =>
                                  mutateDay(day, (rs) => {
                                    rs[i] = { ...rs[i], start: e.target.value }
                                    return rs
                                  })
                                }
                              />
                              <span>–</span>
                              <input
                                type="time"
                                value={r.end}
                                onChange={(e) =>
                                  mutateDay(day, (rs) => {
                                    rs[i] = { ...rs[i], end: e.target.value }
                                    return rs
                                  })
                                }
                              />
                              <button
                                className="btn danger sm"
                                title="Remove"
                                onClick={() => mutateDay(day, (rs) => rs.filter((_, j) => j !== i))}
                              >
                                ✕
                              </button>
                            </div>
                          )
                        })}
                        <button
                          className="btn ghost sm"
                          onClick={() =>
                            mutateDay(day, (rs) => [...rs, { start: '09:00', end: '17:00' }])
                          }
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <div className="divider" />
          <div className="sched-footer">
            <button className="btn ghost sm" onClick={clearSchedule}>
              Clear all
            </button>
            <div className="row-gap">
              {dirty && <span className="muted">Unsaved changes</span>}
              <button className="btn primary" disabled={!dirty} onClick={() => void saveSchedule()}>
                Save schedule
              </button>
            </div>
          </div>
        </section>

        {/* Activity */}
        <section className="card">
          <h3>Recent blocks</h3>
          <ul className="list scroll">
            {killLog.length === 0 && <li className="muted pad">Nothing killed yet.</li>}
            {killLog.map((k, i) => (
              <li key={i} className="list-item">
                <span>{k.name}</span>
                <span className="muted">{new Date(k.time).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Settings */}
        <section className="card">
          <h3>Unlock challenge</h3>
          <p className="muted">What you must type to weaken the block while it’s enforcing.</p>

          <div className="seg challenge-seg">
            {CHALLENGE_TYPES.map((t) => (
              <button
                key={t.key}
                className={chType === t.key ? 'seg-btn active' : 'seg-btn'}
                onClick={() => setChType(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {chType === 'words' && (
            <div className="row-gap add-row">
              <input
                className="input mini"
                type="number"
                min={5}
                max={300}
                value={chWords}
                onChange={(e) => setChWords(Number(e.target.value))}
              />
              <span className="muted">random words to type</span>
            </div>
          )}
          {chType === 'chars' && (
            <div className="row-gap add-row">
              <input
                className="input mini"
                type="number"
                min={10}
                max={2000}
                value={chLen}
                onChange={(e) => setChLen(Number(e.target.value))}
              />
              <span className="muted">random characters to type</span>
            </div>
          )}
          {chType === 'custom' && (
            <textarea
              className="challenge-input custom-input"
              placeholder="e.g. I am choosing to game as a healthy break, not an escape from what I should be doing."
              value={chCustom}
              onChange={(e) => setChCustom(e.target.value)}
            />
          )}
          {chType === 'timer' && (
            <div className="row-gap add-row">
              <input
                className="input mini"
                type="number"
                min={1}
                max={180}
                value={chTimer}
                onChange={(e) => setChTimer(Number(e.target.value))}
              />
              <span className="muted">minute countdown to unlock</span>
            </div>
          )}

          <div className="row-gap end">
            <button className="btn primary" disabled={!chDirty} onClick={() => void saveChallenge()}>
              Save challenge
            </button>
          </div>

          <div className="divider" />
          <div className="protection-row">
            <div>
              <strong>Stay-on protection</strong>
              <p className="muted protection-desc">
                {config.protectionEnabled
                  ? 'On — starts on login and relaunches itself if closed.'
                  : 'Off — FocusLock can be closed normally.'}
              </p>
            </div>
            <button
              className={config.protectionEnabled ? 'btn ghost' : 'btn primary'}
              onClick={() => void toggleProtection()}
            >
              {config.protectionEnabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>

          <div className="divider" />
          <button
            className="btn danger"
            disabled={config.protectionEnabled}
            onClick={() => void quit()}
          >
            Quit FocusLock
          </button>
          {config.protectionEnabled && <p className="muted">Turn off protection to quit.</p>}
        </section>

        {/* Panic mode */}
        <section className="card">
          <h3>Panic mode</h3>
          <p className="muted">
            A one-tap lockdown for when you’re about to relapse — blocks everything for a set time
            and walks you through a breather. It can’t be cancelled early.
          </p>
          <div className="row-gap add-row">
            <input
              className="input mini"
              type="number"
              min={1}
              max={180}
              value={panicMin}
              onChange={(e) => setPanicMin(Number(e.target.value))}
            />
            <span className="muted">minute lockdown</span>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={panicBrowsers}
              onChange={(e) => setPanicBrowsers(e.target.checked)}
            />
            Also close browsers during panic
          </label>
          <p className="muted panic-mantra-label">Your mantra</p>
          <textarea
            className="challenge-input custom-input"
            value={panicMantra}
            onChange={(e) => setPanicMantra(e.target.value)}
          />
          <div className="row-gap end">
            <button className="btn primary" disabled={!panicDirty} onClick={() => void savePanic()}>
              Save panic settings
            </button>
          </div>
        </section>

        {/* Notifications & feedback */}
        <section className="card">
          <h3>Notifications &amp; feedback</h3>
          <p className="muted">Message shown in the notification when an app gets blocked.</p>
          <div className="row-gap add-row">
            <input
              className="input"
              maxLength={200}
              value={blockMsg}
              onChange={(e) => setBlockMsg(e.target.value)}
            />
            <button className="btn primary" disabled={!blockMsgDirty} onClick={() => void saveBlockMsg()}>
              Save
            </button>
          </div>

          <div className="divider" />
          <div className="row-gap">
            <button className="btn ghost" onClick={() => void window.api.sendFeedback()}>
              Send feedback
            </button>
            <button className="btn ghost" onClick={() => void window.api.openLogs()}>
              Open logs
            </button>
          </div>
          <p className="muted version-line">FocusLock v{version}</p>
        </section>
      </main>

      {/* Gaming launcher detection popup */}
      {showGames && (
        <div className="modal-backdrop" onClick={() => setShowGames(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <h2>Game launchers on this PC</h2>
              <button className="btn ghost sm" onClick={() => void scanGames()}>
                Rescan
              </button>
            </div>
            <p className="muted">One click to block. You usually only need this once.</p>
            <ul className="list scroll games-list">
              {!games && <li className="muted pad">Scanning…</li>}
              {games &&
                games.map((g) => (
                  <li key={g.exe} className="list-item">
                    <span className="game-name">
                      {g.label}
                      <span className={`badge badge-${g.status.replace(/\s/g, '-')}`}>
                        {g.status}
                      </span>
                      <span className="muted exe-name">{g.exe}</span>
                    </span>
                    {g.blocked ? (
                      <span className="muted">Blocked ✓</span>
                    ) : (
                      <button className="btn primary sm" onClick={() => void addApp(g.exe)}>
                        Block
                      </button>
                    )}
                  </li>
                ))}
            </ul>
            <div className="row-gap end">
              <button className="btn ghost" onClick={() => setShowGames(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Running apps popup */}
      {showRunning && (
        <div className="modal-backdrop" onClick={() => setShowRunning(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <h2>Running apps</h2>
              <button className="btn ghost sm" onClick={() => void loadRunning()}>
                Refresh
              </button>
            </div>
            <input
              className="input"
              placeholder="Filter…"
              value={runningFilter}
              onChange={(e) => setRunningFilter(e.target.value)}
            />
            <ul className="list scroll games-list">
              {loadingRunning && <li className="muted pad">Loading…</li>}
              {!loadingRunning &&
                runningFiltered.map((n) => {
                  const already = blockedSet.has(n.toLowerCase())
                  return (
                    <li key={n} className="list-item">
                      <span>{n}</span>
                      {already ? (
                        <span className="muted">Blocked ✓</span>
                      ) : (
                        <button className="btn primary sm" onClick={() => void addApp(n)}>
                          Block
                        </button>
                      )}
                    </li>
                  )
                })}
              {!loadingRunning && runningFiltered.length === 0 && (
                <li className="muted pad">No matches.</li>
              )}
            </ul>
            <div className="row-gap end">
              <button className="btn ghost" onClick={() => setShowRunning(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {challenge && (
        <Challenge
          id={challenge.id}
          kind={challenge.kind}
          text={challenge.text}
          endsAt={challenge.endsAt}
          onResolve={challenge.onResolve}
        />
      )}

      {state.panic.active && (
        <PanicOverlay
          until={state.panic.until}
          mantra={config.panic.mantra}
          onDone={() => void refresh()}
        />
      )}
    </div>
  )
}
