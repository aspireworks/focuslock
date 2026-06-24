import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Challenge } from './Challenge'
import { PanicOverlay } from './Panic'
import { Onboarding } from './Onboarding'
import { Lockout } from './Lockout'
import {
  BarChart,
  Calendar,
  Folder,
  Globe,
  Grid,
  Home,
  Pause,
  Shield,
  ShieldCheck,
  Sliders,
  X
} from './icons'
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

type Tab = 'home' | 'apps' | 'sites' | 'schedule' | 'progress' | 'settings'

const MODES: { key: BlockMode; label: string }[] = [
  { key: 'always', label: 'Always' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'budget', label: 'Limit' }
]

const CHALLENGE_TYPES: { key: ChallengeType; label: string; desc: string }[] = [
  {
    key: 'words',
    label: 'Random words',
    desc: 'A set of random everyday words of mixed length — type them out exactly to unlock.'
  },
  {
    key: 'chars',
    label: 'Characters',
    desc: 'A random string of letters and numbers. Slower and more foolproof than words.'
  },
  {
    key: 'custom',
    label: 'Custom text',
    desc: 'Your own mantra or statement — set it once, then type it exactly to unlock.'
  },
  {
    key: 'timer',
    label: 'Timer',
    desc: 'A countdown, no typing. The block holds until the timer runs out.'
  }
]

// Rough time-to-complete estimates so the count means something. Real, mixed-length words
// type faster than random character strings (you can read a word; you must check each char).
const SECS_PER_WORD = 1.3
const SECS_PER_CHAR = 0.45

function estimateLabel(seconds: number): string {
  if (seconds < 60) return `~${Math.max(5, Math.round(seconds / 5) * 5)} sec`
  const half = Math.round((seconds / 60) * 2) / 2
  return `~${Number.isInteger(half) ? half : half.toFixed(1)} min`
}

// Render days Monday-first to match the design, mapping back to JS day indices.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

const NAV: { key: Tab; label: string; sub: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { key: 'home', label: 'Home', sub: '', Icon: Home },
  { key: 'apps', label: 'Apps', sub: 'Lock down launchers & games', Icon: Grid },
  { key: 'sites', label: 'Websites', sub: 'Block storefronts & communities', Icon: Globe },
  { key: 'schedule', label: 'Schedule', sub: 'When scheduled blocks apply', Icon: Calendar },
  { key: 'progress', label: 'Progress', sub: 'Your streak & wins', Icon: BarChart }
]

const BADGES = [
  { emoji: '🛡️', name: 'First day', need: 1 },
  { emoji: '🔥', name: '7-day streak', need: 7 },
  { emoji: '⚔️', name: '14-day streak', need: 14 },
  { emoji: '👑', name: '30-day reset', need: 30 }
]

function appBadge(name: string): { initials: string; bg: string; fg: string } {
  const lower = name.toLowerCase()
  const base = name.replace(/\.exe$/i, '').replace(/[^a-zA-Z0-9]/g, '')
  const initials = (base.slice(0, 2) || '?').toUpperCase()
  if (lower.includes('steam')) return { initials, bg: '#1b2838', fg: '#6aa3d6' }
  if (lower.includes('epic')) return { initials, bg: '#2a2030', fg: '#cf9ad6' }
  if (lower.includes('battle')) return { initials, bg: '#202a2a', fg: '#7fc7c0' }
  if (lower.includes('xbox')) return { initials, bg: '#1f2a20', fg: '#8ccf8a' }
  if (lower.includes('riot')) return { initials, bg: '#2a2222', fg: '#d68a8a' }
  return { initials, bg: '#232838', fg: '#9aa0b0' }
}

function modeTag(mode: BlockMode): { label: string; cls: string } {
  if (mode === 'always') return { label: 'Always', cls: 'tag-always' }
  if (mode === 'schedule') return { label: 'Schedule', cls: 'tag-schedule' }
  return { label: 'Limit', cls: 'tag-limit' }
}

function prettyName(name: string): string {
  const b = name.replace(/\.exe$/i, '')
  return b.charAt(0).toUpperCase() + b.slice(1)
}

function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function nextMilestone(streak: number): number {
  const targets = [3, 7, 14, 21, 30, 60, 90, 180, 365]
  return targets.find((t) => t > streak) ?? streak + 30
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
  return isWeekdays95(s) ? 'weekdays' : 'custom'
}

export default function App(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [now, setNow] = useState(() => new Date())

  // Overlay/preview UI flags
  const [lockoutPreview, setLockoutPreview] = useState(false)
  const [blockedApp, setBlockedApp] = useState<string | null>(null)
  const [replayOnb, setReplayOnb] = useState(false)

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
  const [chLen, setChLen] = useState(400)
  const [chWords, setChWords] = useState(140)
  const [chCustom, setChCustom] = useState('')
  const [chTimer, setChTimer] = useState(5)

  // Panic config drafts
  const [panicMin, setPanicMin] = useState(5)
  const [panicMantra, setPanicMantra] = useState('')
  const [panicBrowsers, setPanicBrowsers] = useState(true)
  const [blockMsg, setBlockMsg] = useState('')
  const [nameInput, setNameInput] = useState('')

  // Challenge modal
  const [challenge, setChallenge] = useState<
    null | {
      id: string
      kind: 'text' | 'timer'
      text?: string
      endsAt?: number
      context?: string
      onResolve: (t: string | null) => void
    }
  >(null)

  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state
  const greeted = useRef(false)

  const flash = useCallback((msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(null), 3200)
  }, [])

  const refresh = useCallback(async () => {
    setState((await window.api.getState()) as AppState)
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(t)
  }, [refresh])

  // Top-bar clock ticks every second.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

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
      setNameInput(state.config.userName)
    }
  }, [state, draft])

  const runChallenge = useCallback(
    (c: { id: string; kind: 'text' | 'timer'; text?: string; endsAt?: number }, context?: string) =>
      new Promise<string | null>((resolve) => {
        setChallenge({
          ...c,
          context,
          onResolve: (t) => {
            setChallenge(null)
            resolve(t)
          }
        })
      }),
    []
  )

  const protectedCall = useCallback(
    async (fn: (token?: string) => Promise<ProtectedResult>, context?: string): Promise<boolean> => {
      let res = await fn(undefined)
      if (res && res.ok === false && res.reason === 'locked') {
        const c = await window.api.startChallenge()
        const token = await runChallenge(c, context)
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

  const removeApp = useCallback(
    async (name: string) => {
      await protectedCall(
        (token) => window.api.removeApp(name, token) as Promise<ProtectedResult>,
        `Removing ${prettyName(name)}`
      )
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
          ) as Promise<ProtectedResult>,
        `Changing ${prettyName(appCfg.name)} to ${modeTag(mode).label}`
      ),
    [protectedCall]
  )

  const commitLimit = useCallback(
    async (appCfg: BlockedApp) => {
      const v = limitDrafts[appCfg.name]
      if (v == null || v === appCfg.dailyLimitMinutes) return
      await protectedCall(
        (token) =>
          window.api.setAppMode(appCfg.name, 'budget', v, token) as Promise<ProtectedResult>,
        `Updating ${prettyName(appCfg.name)} limit`
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
        (token) => window.api.setFolderMode(path, mode, token) as Promise<ProtectedResult>,
        'Changing folder block'
      ),
    [protectedCall]
  )

  const removeFolder = useCallback(
    (path: string) =>
      protectedCall(
        (token) => window.api.removeFolder(path, token) as Promise<ProtectedResult>,
        'Removing a blocked folder'
      ),
    [protectedCall]
  )

  const browse = useCallback(async () => {
    const picked = await window.api.pickAppFile()
    if (picked) await addApp(picked.name)
  }, [addApp])

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
      protectedCall(
        (token) => window.api.removeSite(domain, token) as Promise<ProtectedResult>,
        `Removing ${domain}`
      ),
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
        ) as Promise<ProtectedResult>,
      'Changing the unlock challenge'
    )
    if (ok) flash('Challenge settings saved.')
  }, [chType, chLen, chWords, chCustom, chTimer, protectedCall, flash])

  const quit = useCallback(
    () =>
      protectedCall(
        (token) => window.api.requestQuit(token) as Promise<ProtectedResult>,
        'Quitting FocusLock'
      ),
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

  const saveName = useCallback(async () => {
    await window.api.setName(nameInput)
    await refresh()
    flash('Name saved.')
  }, [nameInput, refresh, flash])

  const toggleProtection = useCallback(async () => {
    if (stateRef.current?.config.protectionEnabled) {
      await protectedCall(
        (token) => window.api.setProtection(false, token) as Promise<ProtectedResult>,
        'Turning off stay-on protection'
      )
    } else {
      await window.api.setProtection(true)
      await refresh()
      flash('Protection on — FocusLock will stay running and start on login.')
    }
  }, [protectedCall, refresh, flash])

  const previewUnlock = useCallback(async () => {
    setLockoutPreview(false) // close the takeover first, else the challenge renders behind it
    const c = await window.api.startChallenge()
    await runChallenge(c, 'Unlocking anyway')
  }, [runChallenge])

  const unlockBlocked = useCallback(async () => {
    setBlockedApp(null) // close the takeover first, else the challenge renders behind it
    const c = await window.api.startChallenge()
    await runChallenge(c, 'Unlocking anyway')
  }, [runChallenge])

  useEffect(() => window.api.onQuitRequested(() => void quit()), [quit])

  // The engine pushes this when it catches a blocked app — show the lockout takeover for real.
  useEffect(() => window.api.onAppBlocked((name) => setBlockedApp(prettyName(name))), [])

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
    },
    [applyPreset]
  )

  // Toggle a whole day from the at-a-glance list: on → default 9–5, off → clear.
  const toggleDay = useCallback((day: number) => {
    setDraft((prev) => {
      const next: Schedule = { ...(prev ?? {}) }
      const cur = next[String(day)] ?? []
      next[String(day)] = cur.length ? [] : [{ start: '09:00', end: '17:00' }]
      setSchedView(detectView(next))
      return next
    })
  }, [])

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
      (token) => window.api.setSchedule(cleaned, true, token) as Promise<ProtectedResult>,
      'Saving the schedule'
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
  const nameDirty = nameInput.trim() !== config.userName && nameInput.trim().length > 0
  const chartMax = Math.max(1, ...stats.last7.map((d) => d.count))
  const streak = stats.currentStreak
  const bestStreak = stats.bestStreak
  // Estimated hours won back: total days since start × the user's self-reported daily gaming
  // hours (captured during onboarding). Cumulative — it doesn't reset when a streak breaks.
  // 0 when they skipped the onboarding step.
  const reclaimedHours = stats.daysSinceStart * config.dailyGamingHours

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

  const userName = config.userName?.trim() || 'friend'
  const avatarLetter = userName.charAt(0).toUpperCase()
  const homeSub = `${greeting(now)}, ${userName}`
  const sectionMeta =
    activeTab === 'home'
      ? { label: 'Home', sub: homeSub }
      : activeTab === 'settings'
        ? { label: 'Settings', sub: 'Challenge, panic & protection' }
        : NAV.find((n) => n.key === activeTab)!

  const clockStr = now
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    .toUpperCase()

  // ---------------------------------------------------------- Home
  function renderHome(): JSX.Element {
    const lockedPreview = config.blocklist.slice(0, 4)
    return (
      <div className="page page-home">
        <div className={paused ? 'status-banner paused' : 'status-banner active'}>
          <div className="status-tile">
            {paused ? <Pause size={26} /> : <ShieldCheck size={28} />}
          </div>
          <div className="status-main">
            <div className="status-title">
              {paused ? 'Blocking paused' : 'Protection active'}
            </div>
            <div className="status-sub">
              {paused
                ? "Nothing is being blocked right now. Resume when you're ready."
                : `${config.blocklist.length} ${config.blocklist.length === 1 ? 'app' : 'apps'} and ${config.blockedSites.length} ${config.blockedSites.length === 1 ? 'site' : 'sites'} locked down · ${enforcing ? 'enforcing now' : 'armed'}`}
            </div>
          </div>
          {!paused && (
            <div className="streak-box">
              <div className="streak-num">
                {streak} <span style={{ fontSize: '28px' }}>🔥</span>
              </div>
              <div className="streak-cap">day streak</div>
              {bestStreak > 0 && (
                <div className="streak-best">
                  {streak >= bestStreak
                    ? '🏆 personal best'
                    : `best ${bestStreak} ${bestStreak === 1 ? 'day' : 'days'}`}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-num">{stats.weekTotal}</div>
            <div className="stat-label">resisted this week</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">{stats.totalBlocks}</div>
            <div className="stat-label">total blocks</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">
              {reclaimedHours.toFixed(1)}
              <span className="unit">h</span>
            </div>
            <div className="stat-label">time reclaimed</div>
          </div>
        </div>

        <div className="two-col">
          <div className="card">
            <div className="card-head">
              <div className="card-title">Locked apps</div>
              <button className="link" onClick={() => setActiveTab('apps')}>
                Manage →
              </button>
            </div>
            {lockedPreview.length === 0 && <div className="empty">Nothing blocked yet.</div>}
            {lockedPreview.map((a) => {
              const b = appBadge(a.name)
              const tag = modeTag(a.mode)
              return (
                <div key={a.name} className="app-row">
                  <div
                    className="lbadge"
                    style={{ width: 30, height: 30, background: b.bg, color: b.fg }}
                  >
                    {b.initials}
                  </div>
                  <span className="app-row-name">{prettyName(a.name)}</span>
                  <span className={`tag ${tag.cls}`}>{tag.label}</span>
                </div>
              )
            })}
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">This week</div>
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
            <div className="divider" />
            <div className="eyebrow">Recent blocks</div>
            {killLog.length === 0 && <div className="empty">Nothing caught yet.</div>}
            {killLog.slice(0, 3).map((k, i) => (
              <div key={i} className="kv-row">
                <span>{prettyName(k.name)}</span>
                <span className="kv-time">{new Date(k.time).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------- Apps
  function renderApps(): JSX.Element {
    return (
      <div className="page page-apps">
        <div className="card add-card">
          <div className="card-title">Add an app to block</div>
          <p className="card-help">Type an executable, browse for it, or pick from launchers we detected.</p>
          <div className="add-row">
            <input
              className="field"
              placeholder="e.g. steam.exe"
              value={newApp}
              onChange={(e) => setNewApp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addApp(newApp)}
            />
            <button className="btn accent" onClick={() => void addApp(newApp)}>
              Add
            </button>
          </div>
          <div className="ghost-row">
            <button className="btn ghost" onClick={openGames}>
              ＋ Game launchers
            </button>
            <button className="btn ghost" onClick={openRunning}>
              ＋ Running apps
            </button>
            <button className="btn ghost" onClick={() => void browse()}>
              Browse…
            </button>
          </div>
        </div>

        <div className="section-label">Blocked apps</div>
        {config.blocklist.length === 0 && <div className="empty">Nothing blocked yet.</div>}
        {config.blocklist.map((a) => {
          const b = appBadge(a.name)
          const limit = a.dailyLimitMinutes ?? 60
          const used = usedMinutes(a.name)
          const hint =
            a.mode === 'always'
              ? 'Blocked 24/7'
              : a.mode === 'schedule'
                ? 'Follows your schedule'
                : `${limit} min per day`
          return (
            <div key={a.name} className="block-item-wrap">
              <div className="block-item">
                <div
                  className="lbadge"
                  style={{ width: 34, height: 34, background: b.bg, color: b.fg }}
                >
                  {b.initials}
                </div>
                <div className="block-item-main">
                  <div className="block-item-name">{prettyName(a.name)}</div>
                  <div className="block-item-hint">{hint}</div>
                </div>
                <div className="block-item-controls">
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
                  <button
                    className="btn-remove"
                    title="Remove"
                    onClick={() => void removeApp(a.name)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              {a.mode === 'budget' && (
                <div className="budget-sub">
                  <span className="b-label">Daily limit</span>
                  <input
                    className="field mini mono"
                    type="number"
                    min={1}
                    max={1440}
                    value={limitDrafts[a.name] ?? limit}
                    onChange={(e) =>
                      setLimitDrafts((d) => ({ ...d, [a.name]: Number(e.target.value) }))
                    }
                    onBlur={() => void commitLimit(a)}
                  />
                  <div className="budget-track">
                    <div
                      className="budget-fill"
                      style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }}
                    />
                  </div>
                  <span className="budget-used">
                    {used}/{limit}m used{used >= limit ? ' — reached' : ''}
                  </span>
                </div>
              )}
            </div>
          )
        })}

        <div className="section-label" style={{ marginTop: 8 }}>
          Blocked folders
        </div>
        <p className="card-help" style={{ marginTop: -8 }}>
          Blocks anything launched from inside a folder — e.g. a game library.
        </p>
        {config.folderBlocks.map((f) => (
          <div key={f.path} className="folder-item">
            <Folder size={18} className="muted" />
            <span className="folder-path" title={f.path}>
              {f.path}
            </span>
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
            <button className="btn-remove" title="Remove" onClick={() => void removeFolder(f.path)}>
              <X size={16} />
            </button>
          </div>
        ))}
        <button className="add-folder-btn" onClick={() => void addFolder()}>
          ＋ Add folder…
        </button>
      </div>
    )
  }

  // ---------------------------------------------------------- Websites
  function renderSites(): JSX.Element {
    return (
      <div className="page page-sites">
        <div className="card add-card">
          <div className="card-title">Block a website</div>
          <p className="card-help">
            Works across Chrome, Edge &amp; Firefox. Adding or removing one shows a quick Windows
            admin prompt.
          </p>
          <div className="add-row">
            <input
              className="field"
              placeholder="e.g. reddit.com"
              value={siteInput}
              onChange={(e) => setSiteInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addSite()}
            />
            <button className="btn accent" onClick={() => void addSite()}>
              Block
            </button>
          </div>
        </div>

        <div className="section-label">Blocked websites</div>
        {config.blockedSites.length === 0 && <div className="empty">No sites blocked.</div>}
        {config.blockedSites.map((d) => (
          <div key={d} className="site-item">
            <Globe size={18} className="site-globe" />
            <span className="site-domain">{d}</span>
            <button className="btn-remove" title="Remove" onClick={() => void removeSite(d)}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    )
  }

  // ---------------------------------------------------------- Schedule
  function renderSchedule(): JSX.Element {
    return (
      <div className="page page-schedule">
        <p className="sched-intro">
          When apps set to <strong>Schedule</strong> mode are blocked. Outside these hours they’re
          free.
        </p>

        <div className="seg" style={{ alignSelf: 'flex-start' }}>
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

        <div className="day-card">
          {DAY_ORDER.map((day) => {
            const ranges = (draft![String(day)] ?? []).slice().sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
            const on = ranges.length > 0
            const first = ranges[0]
            return (
              <div key={day} className={on ? 'day-row on' : 'day-row'}>
                <button
                  className={on ? 'toggle on' : 'toggle'}
                  onClick={() => toggleDay(day)}
                  title={on ? 'Turn off' : 'Turn on'}
                >
                  <span className="toggle-knob" />
                </button>
                <span className="day-name">{DAY_LABELS[day]}</span>
                {on ? (
                  <span className="day-range">
                    {first.start} — {first.end}
                    {ranges.length > 1 ? `  +${ranges.length - 1}` : ''}
                  </span>
                ) : (
                  <span className="day-range off">Not blocked</span>
                )}
              </div>
            )
          })}
        </div>

        {schedView === 'custom' && (
          <>
            <div className="quick-add">
              <div className="day-chips">
                {DAY_ORDER.map((d) => (
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
                    {DAY_LABELS[d][0]}
                  </button>
                ))}
              </div>
              <div className="time-row">
                <input
                  className="field"
                  type="time"
                  value={qaStart}
                  onChange={(e) => setQaStart(e.target.value)}
                />
                <span className="muted">–</span>
                <input
                  className="field"
                  type="time"
                  value={qaEnd}
                  onChange={(e) => setQaEnd(e.target.value)}
                />
                <button className="btn ghost sm" onClick={applyQuickAdd}>
                  Add to selected days
                </button>
              </div>
            </div>

            <div className="card">
              <div className="custom-days">
                {DAY_ORDER.map((day) => {
                  const ranges = draft![String(day)] ?? []
                  return (
                    <div key={day} className="custom-day">
                      <div className="custom-day-label">{DAY_LABELS[day]}</div>
                      <div className="custom-ranges">
                        {ranges.map((r, i) => {
                          const invalid = toMinutes(r.end) <= toMinutes(r.start)
                          return (
                            <div
                              key={i}
                              className={invalid ? 'custom-range invalid' : 'custom-range'}
                            >
                              <input
                                className="field"
                                type="time"
                                value={r.start}
                                onChange={(e) =>
                                  mutateDay(day, (rs) => {
                                    rs[i] = { ...rs[i], start: e.target.value }
                                    return rs
                                  })
                                }
                              />
                              <span className="muted">–</span>
                              <input
                                className="field"
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
                                className="btn-remove"
                                title="Remove"
                                onClick={() =>
                                  mutateDay(day, (rs) => rs.filter((_, j) => j !== i))
                                }
                              >
                                <X size={15} />
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
                          ＋ Add
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        <div className="sched-footer">
          <button className="btn ghost sm" onClick={clearSchedule}>
            Clear all
          </button>
          <div className="time-row">
            {dirty && <span className="muted">Unsaved changes</span>}
            <button className="btn accent" disabled={!dirty} onClick={() => void saveSchedule()}>
              Save schedule
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------- Progress
  function renderProgress(): JSX.Element {
    const milestone = nextMilestone(streak)
    const remaining = Math.max(0, milestone - streak)
    const topMax = Math.max(1, ...stats.topApps.map((a) => a.count))
    return (
      <div className="page page-progress">
        <div className="streak-hero">
          <div className="streak-hero-left">
            <div className="streak-hero-num">
              {streak} <span style={{ fontSize: '34px' }}>🔥</span>
            </div>
            <div className="streak-hero-cap">day streak</div>
            <div className="streak-hero-best">
              {streak >= bestStreak
                ? '🏆 personal best'
                : `Best: ${bestStreak} ${bestStreak === 1 ? 'day' : 'days'}`}
            </div>
          </div>
          <div className="streak-hero-right">
            <div className="milestone-title">Next milestone: {milestone}-day streak</div>
            <div className="milestone-bar">
              <div
                className="milestone-fill"
                style={{ width: `${Math.min(100, (streak / milestone) * 100)}%` }}
              />
            </div>
            <div className="milestone-help">
              {remaining === 0
                ? 'Milestone reached — keep the streak alive.'
                : `${remaining} ${remaining === 1 ? 'day' : 'days'} to go — keep it up.`}
            </div>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-num">{stats.weekTotal}</div>
            <div className="stat-label">resisted this week</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">{stats.totalBlocks}</div>
            <div className="stat-label">blocks all-time</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">
              {reclaimedHours.toFixed(1)}
              <span className="unit">h</span>
            </div>
            <div className="stat-label">time reclaimed</div>
          </div>
        </div>

        <div className="two-col">
          <div className="card">
            <div className="card-head">
              <div className="card-title">Most resisted</div>
            </div>
            {stats.topApps.length === 0 && (
              <div className="empty">No blocks yet — your wins will show up here.</div>
            )}
            {stats.topApps.map((a) => (
              <div key={a.name} className="resist-row">
                <div className="resist-head">
                  <span>{prettyName(a.name)}</span>
                  <span className="resist-count">{a.count}×</span>
                </div>
                <div className="resist-track">
                  <div
                    className="resist-fill"
                    style={{ width: `${(a.count / topMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">Badges</div>
            </div>
            <div className="badge-grid">
              {BADGES.map((bd) => {
                const earned = bestStreak >= bd.need
                const toGo = Math.max(1, bd.need - streak)
                return (
                  <div
                    key={bd.name}
                    className={earned ? 'badge-tile earned' : 'badge-tile locked'}
                  >
                    <div className="badge-emoji">{bd.emoji}</div>
                    <div className="badge-name">{bd.name}</div>
                    <div className="badge-status">
                      {earned ? 'Earned' : `${toGo} ${toGo === 1 ? 'day' : 'days'} to go`}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------- Settings
  function renderSettings(): JSX.Element {
    return (
      <div className="page page-settings">
        {/* Your name */}
        <div className="card">
          <div className="card-title">Your name</div>
          <p className="card-help">
            Used to personalize your greeting and the block notifications.
          </p>
          <div className="add-row">
            <input
              className="field"
              maxLength={40}
              placeholder="What should we call you?"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameDirty) void saveName()
              }}
            />
            <button className="btn accent" disabled={!nameDirty} onClick={() => void saveName()}>
              Save
            </button>
          </div>
        </div>

        {/* Unlock challenge */}
        <div className="card">
          <div className="card-title">Unlock challenge</div>
          <p className="card-help">
            What you have to complete to unlock a block while it’s active. Friction is the feature.
          </p>
          <div className="seg" style={{ marginTop: 12 }}>
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

          <p className="card-help" style={{ marginTop: 12 }}>
            {CHALLENGE_TYPES.find((t) => t.key === chType)?.desc}
          </p>

          {chType === 'words' && (
            <div className="inline-row">
              <input
                className="field mini"
                type="number"
                min={5}
                max={300}
                value={chWords}
                onChange={(e) => setChWords(Number(e.target.value))}
              />
              <span className="inline-label">
                random words to type · {estimateLabel((chWords || 0) * SECS_PER_WORD)}
              </span>
            </div>
          )}
          {chType === 'chars' && (
            <div className="inline-row">
              <input
                className="field mini"
                type="number"
                min={10}
                max={2000}
                value={chLen}
                onChange={(e) => setChLen(Number(e.target.value))}
              />
              <span className="inline-label">
                characters to type · {estimateLabel((chLen || 0) * SECS_PER_CHAR)}
              </span>
            </div>
          )}
          {chType === 'custom' && (
            <textarea
              className="field"
              style={{ marginTop: 12 }}
              placeholder="I understand that unlocking this block will break my streak, and I believe I’m acting in my highest good right now — not giving in to my old habits."
              value={chCustom}
              onChange={(e) => setChCustom(e.target.value)}
            />
          )}
          {chType === 'timer' && (
            <div className="inline-row">
              <input
                className="field mini"
                type="number"
                min={1}
                max={180}
                value={chTimer}
                onChange={(e) => setChTimer(Number(e.target.value))}
              />
              <span className="inline-label">minute countdown</span>
            </div>
          )}

          <div className="sched-footer" style={{ marginTop: 14 }}>
            <span />
            <button className="btn accent" disabled={!chDirty} onClick={() => void saveChallenge()}>
              Save challenge
            </button>
          </div>
        </div>

        {/* Stay-on protection */}
        <div className="card">
          <div className="setting-row">
            <div className="setting-row-main">
              <div className="card-title">Stay-on protection</div>
              <p className="card-help">
                {config.protectionEnabled
                  ? 'On — starts on login and relaunches itself if closed.'
                  : 'Off — FocusLock can be closed normally.'}
              </p>
            </div>
            <button
              className={config.protectionEnabled ? 'btn ghost' : 'btn accent'}
              onClick={() => void toggleProtection()}
            >
              {config.protectionEnabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          <div className="divider" />
          <div className="setting-row">
            <p className="card-help" style={{ margin: 0 }}>
              {config.protectionEnabled
                ? 'Turn off protection to quit FocusLock.'
                : 'Close FocusLock entirely.'}
            </p>
            <button
              className="btn danger"
              disabled={config.protectionEnabled}
              onClick={() => void quit()}
            >
              Quit FocusLock
            </button>
          </div>
        </div>

        {/* Panic mode */}
        <div className="card">
          <div className="card-title">Panic mode</div>
          <p className="card-help">
            A one-tap lockdown for when you’re about to relapse — blocks everything and walks you
            through a breather. It can’t be cancelled early.
          </p>
          <div className="inline-row">
            <input
              className="field mini"
              type="number"
              min={1}
              max={180}
              value={panicMin}
              onChange={(e) => setPanicMin(Number(e.target.value))}
            />
            <span className="inline-label">minute lockdown</span>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={panicBrowsers}
              onChange={(e) => setPanicBrowsers(e.target.checked)}
            />
            Also close browsers during panic
          </label>
          <p className="card-help" style={{ marginTop: 12, marginBottom: 6 }}>
            Your mantra
          </p>
          <textarea
            className="field"
            value={panicMantra}
            onChange={(e) => setPanicMantra(e.target.value)}
          />
          <div className="sched-footer" style={{ marginTop: 14 }}>
            <span />
            <button className="btn accent" disabled={!panicDirty} onClick={() => void savePanic()}>
              Save panic settings
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="card">
          <div className="card-title">Block notification</div>
          <p className="card-help">Message shown in the notification when an app gets blocked.</p>
          <div className="add-row">
            <input
              className="field"
              maxLength={200}
              value={blockMsg}
              onChange={(e) => setBlockMsg(e.target.value)}
            />
            <button className="btn accent" disabled={!blockMsgDirty} onClick={() => void saveBlockMsg()}>
              Save
            </button>
          </div>
        </div>

        {/* Wide actions */}
        <div className="wide-actions">
          <button className="btn ghost block" onClick={() => setLockoutPreview(true)}>
            Preview block screen
          </button>
          <button className="btn ghost block" onClick={() => setReplayOnb(true)}>
            Replay setup walkthrough
          </button>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <button className="btn ghost" onClick={() => void window.api.sendFeedback()}>
            Send feedback
          </button>
          <button className="btn ghost" onClick={() => void window.api.openLogs()}>
            Open logs
          </button>
          <span className="version">FocusLock v{version}</span>
        </div>
      </div>
    )
  }

  function renderSection(): JSX.Element {
    switch (activeTab) {
      case 'home':
        return renderHome()
      case 'apps':
        return renderApps()
      case 'sites':
        return renderSites()
      case 'schedule':
        return renderSchedule()
      case 'progress':
        return renderProgress()
      case 'settings':
        return renderSettings()
    }
  }

  return (
    <div className="shell">
      {notice && <div className="toast">{notice}</div>}

      {/* Icon rail */}
      <nav className="rail">
        <div className="rail-logo">
          <Shield size={22} />
        </div>
        {NAV.map(({ key, Icon }) => (
          <button
            key={key}
            className={activeTab === key ? 'rail-btn active' : 'rail-btn'}
            onClick={() => setActiveTab(key)}
            title={key}
          >
            <span className="rail-pill" />
            {activeTab === key && <span className="rail-accent" />}
            <Icon size={21} />
          </button>
        ))}
        <button
          className={activeTab === 'settings' ? 'rail-btn bottom active' : 'rail-btn bottom'}
          onClick={() => setActiveTab('settings')}
          title="settings"
        >
          <span className="rail-pill" />
          {activeTab === 'settings' && <span className="rail-accent" />}
          <Sliders size={21} />
        </button>
      </nav>

      {/* Right column */}
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-title">{sectionMeta.label}</span>
            <span className="topbar-sub">{sectionMeta.sub}</span>
          </div>
          <div className="topbar-right">
            <span className="clock">{clockStr}</span>
            <button
              className={paused ? 'btn pause on' : 'btn pause'}
              onClick={() => void togglePause()}
            >
              {paused ? 'Resume blocking' : 'Pause'}
            </button>
            <button className="btn panic" onClick={() => void triggerPanic()}>
              PANIC
            </button>
            <button
              className={activeTab === 'settings' ? 'avatar active' : 'avatar'}
              onClick={() => setActiveTab('settings')}
              title="Settings"
              aria-label="Open settings"
            >
              {avatarLetter}
            </button>
          </div>
        </header>

        <div className="content">
          <div className="section" key={activeTab}>
            {renderSection()}
          </div>
        </div>
      </div>

      {/* Game launchers picker */}
      {showGames && (
        <div className="modal-backdrop" onClick={() => setShowGames(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <h2>Game launchers on this PC</h2>
              <button className="btn ghost sm" onClick={() => void scanGames()}>
                Rescan
              </button>
            </div>
            <p className="card-help">One click to block. You usually only need this once.</p>
            <ul className="picker-list">
              {!games && <li className="empty">Scanning…</li>}
              {games &&
                games.map((g) => (
                  <li key={g.exe} className="picker-item">
                    <span className="pick-name">
                      {g.label}
                      <span className={`badge badge-${g.status.replace(/\s/g, '-')}`}>
                        {g.status}
                      </span>
                      <span className="exe-name">{g.exe}</span>
                    </span>
                    {g.blocked ? (
                      <span className="muted">Blocked ✓</span>
                    ) : (
                      <button className="btn accent sm" onClick={() => void addApp(g.exe)}>
                        Block
                      </button>
                    )}
                  </li>
                ))}
            </ul>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowGames(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Running apps picker */}
      {showRunning && (
        <div className="modal-backdrop" onClick={() => setShowRunning(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <h2>Running apps</h2>
              <button className="btn ghost sm" onClick={() => void loadRunning()}>
                Refresh
              </button>
            </div>
            <input
              className="field"
              placeholder="Filter…"
              value={runningFilter}
              onChange={(e) => setRunningFilter(e.target.value)}
            />
            <ul className="picker-list">
              {loadingRunning && <li className="empty">Loading…</li>}
              {!loadingRunning &&
                runningFiltered.map((n) => {
                  const already = blockedSet.has(n.toLowerCase())
                  return (
                    <li key={n} className="picker-item">
                      <span className="pick-name">{n}</span>
                      {already ? (
                        <span className="muted">Blocked ✓</span>
                      ) : (
                        <button className="btn accent sm" onClick={() => void addApp(n)}>
                          Block
                        </button>
                      )}
                    </li>
                  )
                })}
              {!loadingRunning && runningFiltered.length === 0 && (
                <li className="empty">No matches.</li>
              )}
            </ul>
            <div className="modal-actions">
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
          context={challenge.context}
          onResolve={challenge.onResolve}
        />
      )}

      {lockoutPreview && (
        <Lockout
          appName={config.blocklist[0]?.name ? prettyName(config.blocklist[0].name) : 'Steam'}
          streak={streak}
          onClose={() => setLockoutPreview(false)}
          onUnlock={() => void previewUnlock()}
        />
      )}

      {blockedApp && (
        <Lockout
          key={blockedApp}
          appName={blockedApp}
          streak={streak}
          onClose={() => setBlockedApp(null)}
          onUnlock={() => void unlockBlocked()}
        />
      )}

      {state.panic.active && (
        <PanicOverlay
          until={state.panic.until}
          mantra={config.panic.mantra}
          onDone={() => void refresh()}
        />
      )}

      {replayOnb && (
        <Onboarding
          onDone={() => {
            setReplayOnb(false)
            void refresh()
          }}
        />
      )}
    </div>
  )
}
