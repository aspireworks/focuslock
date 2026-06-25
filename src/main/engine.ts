import { exec } from 'child_process'
import { promisify } from 'util'
import { app, Notification } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfig } from './store'
import { getStatus } from './schedule'
import { flushStats, initStats, recordBlock, recordRuntime } from './stats'

const execAsync = promisify(exec)

export interface KillEvent {
  name: string
  pid: number
  time: string
}

export interface RunningProcess {
  name: string
  pid: number
}

const POLL_MS = 1500
const POLL_SECONDS = POLL_MS / 1000

let timer: NodeJS.Timeout | null = null
let killLog: KillEvent[] = []
let tickCount = 0

// Dev override: when paused, nothing is enforced and nothing counts as "locked".
// In-memory only, so a restart always re-arms blocking.
let paused = false
export function setPaused(v: boolean): void {
  paused = v
  console.log('[engine] paused =', v)
}
export function isPaused(): boolean {
  return paused
}

// ---- Daily usage tracking (for budget mode) ----
let usagePath = ''
let usage: { date: string; seconds: Record<string, number> } = { date: '', seconds: {} }
let ticksSincePersist = 0
// Which budget warnings have fired today, per app (so we warn once each).
let warned: Record<string, { w5: boolean; w1: boolean }> = {}

function notify(title: string, body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  } catch (e) {
    console.error('[engine] notify failed:', e)
  }
}

// Optional hook: fired when a blocked app is caught, so the main process can surface
// the full-screen lockout takeover in the renderer.
let appBlockedListener: ((name: string) => void) | null = null
export function setOnAppBlocked(cb: (name: string) => void): void {
  appBlockedListener = cb
}

// Stats + toast fire at most once per app per minute, so relaunch spam doesn't inflate
// them. The takeover is separate: it's "armed" per app and re-armed in tick() once the app
// is seen gone (see the re-arm branch below), so it pops once per genuine launch — not on
// every 1.5s poll, and not suppressed for a full minute after the user relaunches.
const lastBlockEvent: Record<string, number> = {}
const BLOCK_EVENT_COOLDOWN = 60_000
const lockoutArmed: Record<string, boolean> = {}

function onBlocked(name: string): void {
  const key = name.toLowerCase()
  const now = Date.now()

  // Full-screen takeover — once per launch episode, and never during panic (its overlay
  // already covers the screen). Disarmed here; re-armed in tick() when the app is gone.
  if (!isPanicActive() && lockoutArmed[key] !== false) {
    lockoutArmed[key] = false
    appBlockedListener?.(name)
  }

  // Stats + toast — throttled to once per app per minute.
  if (now - (lastBlockEvent[key] ?? 0) < BLOCK_EVENT_COOLDOWN) return
  lastBlockEvent[key] = now
  recordBlock(name) // counts toward progress stats (even during panic)
  if (isPanicActive()) return // ...but skip the toast during panic (the overlay covers it)
  const cfg = getConfig()
  const title = cfg.userName ? `Sorry ${cfg.userName} — ${name} is blocked` : `${name} is blocked`
  notify(title, cfg.blockMessage || 'Back to what matters.')
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function initUsage(): void {
  usagePath = join(app.getPath('userData'), 'usage.json')
  try {
    if (existsSync(usagePath)) {
      let text = readFileSync(usagePath, 'utf-8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      const raw = JSON.parse(text)
      usage = { date: String(raw.date ?? ''), seconds: raw.seconds ?? {} }
    }
  } catch (e) {
    console.error('[engine] failed to read usage:', e)
  }
  rollUsageDate()
}

/** Reset accumulated usage when the local day changes. */
function rollUsageDate(): void {
  const t = todayStr()
  if (usage.date !== t) {
    usage = { date: t, seconds: {} }
    warned = {}
  }
}

function persistUsage(): void {
  try {
    writeFileSync(usagePath, JSON.stringify(usage), 'utf-8')
  } catch (e) {
    console.error('[engine] failed to write usage:', e)
  }
}

/** Seconds used today per app name (lowercased) — for the UI. */
export function getUsage(): { date: string; seconds: Record<string, number> } {
  rollUsageDate()
  return { date: usage.date, seconds: { ...usage.seconds } }
}

// ---- Panic mode (nuclear lockdown) ----
const BROWSERS = new Set([
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'opera_gx.exe',
  'vivaldi.exe',
  'arc.exe',
  'iexplore.exe',
  'zen.exe',
  'librewolf.exe'
])

let panicPath = ''
let panicUntil = 0

function initPanic(): void {
  panicPath = join(app.getPath('userData'), 'panic.json')
  try {
    if (existsSync(panicPath)) {
      let text = readFileSync(panicPath, 'utf-8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      panicUntil = Number(JSON.parse(text).until) || 0
    }
  } catch (e) {
    console.error('[engine] failed to read panic state:', e)
  }
}

export function isPanicActive(): boolean {
  return Date.now() < panicUntil
}

export function getPanic(): { active: boolean; until: number } {
  return { active: isPanicActive(), until: panicUntil }
}

/** Start a nuclear lockdown for `minutes`. Persisted so an app restart resumes it. */
export function startPanic(minutes: number): { active: boolean; until: number } {
  const m = Math.max(1, Math.min(180, Math.floor(minutes) || 5))
  // Only ever extend — re-triggering panic can't be used to shorten an active lockdown.
  panicUntil = Math.max(panicUntil, Date.now() + m * 60_000)
  try {
    writeFileSync(panicPath, JSON.stringify({ until: panicUntil }), 'utf-8')
  } catch (e) {
    console.error('[engine] failed to persist panic:', e)
  }
  console.log('[engine] PANIC started for', m, 'min')
  return getPanic()
}

/** Is any enforcement active right now? Used to decide if protective actions need a challenge. */
export function isBlockingNow(): boolean {
  if (isPanicActive()) return true
  if (paused) return false
  const cfg = getConfig()
  const schedActive = getStatus(cfg.schedule, cfg.scheduleEnabled, new Date()).active
  rollUsageDate()
  const appEnforcing = cfg.blocklist.some((a) => {
    if (a.mode === 'always') return true
    if (a.mode === 'schedule') return schedActive
    if (a.mode === 'budget') {
      const limit = (a.dailyLimitMinutes ?? 0) * 60
      return (usage.seconds[a.name.toLowerCase()] ?? 0) >= limit
    }
    return false
  })
  const folderEnforcing = (cfg.folderBlocks ?? []).some(
    (f) => f.mode === 'always' || (f.mode === 'schedule' && schedActive)
  )
  const sitesEnforcing = (cfg.blockedSites?.length ?? 0) > 0
  return appEnforcing || folderEnforcing || sitesEnforcing
}

export function getKillLog(): KillEvent[] {
  return killLog.slice(-100).reverse()
}

/** List running processes via Windows `tasklist` (CSV). Windows-only by design for v1.0. */
async function listProcesses(): Promise<RunningProcess[]> {
  try {
    const { stdout } = await execAsync('tasklist /FO CSV /NH', {
      maxBuffer: 1024 * 1024 * 16,
      windowsHide: true
    })
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''))
        return { name: cols[0] ?? '', pid: Number(cols[1]) }
      })
      .filter((p) => p.name && !Number.isNaN(p.pid))
  } catch (e) {
    console.error('[engine] tasklist failed:', e)
    return []
  }
}

/** Unique blockable executable names currently running (for the "add from running" picker). */
export async function listRunningApps(): Promise<string[]> {
  const procs = await listProcesses()
  const names = Array.from(new Set(procs.map((p) => p.name))).filter((n) =>
    n.toLowerCase().endsWith('.exe')
  )
  names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  return names
}

/**
 * Running processes with full executable paths (for folder blocking). Heavier than tasklist,
 * so it's only called when folder rules exist.
 */
async function listProcessesWithPaths(): Promise<{ pid: number; path: string }[]> {
  try {
    const cmd =
      'powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"'
    const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 32, windowsHide: true })
    const trimmed = stdout.trim()
    if (!trimmed) return []
    const parsed = JSON.parse(trimmed)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr
      .map((p) => ({ pid: Number(p.ProcessId), path: String(p.ExecutablePath ?? '') }))
      .filter((p) => p.path && !Number.isNaN(p.pid))
  } catch (e) {
    console.error('[engine] path query failed:', e)
    return []
  }
}

async function killByPid(pid: number): Promise<void> {
  try {
    await execAsync(`taskkill /F /T /PID ${pid}`, { windowsHide: true })
  } catch {
    // Process may have already exited, or be protected — ignore for v1.0.
  }
}

async function tick(): Promise<void> {
  tickCount++
  const panicActive = isPanicActive()
  if (paused && !panicActive) return
  const cfg = getConfig()
  if (!panicActive && cfg.blocklist.length === 0 && (cfg.folderBlocks?.length ?? 0) === 0) return

  rollUsageDate()
  const schedActive = getStatus(cfg.schedule, cfg.scheduleEnabled, new Date()).active

  // Map running processes by lowercased name -> pids.
  const procs = await listProcesses()
  const running = new Map<string, number[]>()
  for (const p of procs) {
    const k = p.name.toLowerCase()
    const arr = running.get(k)
    if (arr) arr.push(p.pid)
    else running.set(k, [p.pid])
  }

  let usageChanged = false

  for (const appCfg of cfg.blocklist) {
    const key = appCfg.name.toLowerCase()
    const pids = running.get(key)
    let shouldKill = false

    if (panicActive) {
      shouldKill = true
    } else if (appCfg.mode === 'always') {
      shouldKill = true
    } else if (appCfg.mode === 'schedule') {
      shouldKill = schedActive
    } else if (appCfg.mode === 'budget') {
      const limitSec = (appCfg.dailyLimitMinutes ?? 0) * 60
      const used = usage.seconds[key] ?? 0
      if (used >= limitSec) {
        shouldKill = true
      } else if (pids && pids.length > 0) {
        // Running and still under budget — accrue time toward the limit.
        const newUsed = used + POLL_SECONDS
        usage.seconds[key] = newUsed
        usageChanged = true

        // Fire "time almost up" warnings once each, so the user can save.
        const remaining = limitSec - newUsed
        const w = warned[key] ?? (warned[key] = { w5: false, w1: false })
        if (limitSec > 300 && remaining <= 300 && !w.w5) {
          w.w5 = true
          notify('Spawncamp', `5 minutes of ${appCfg.name} left today — find a save point.`)
        }
        if (limitSec > 60 && remaining <= 60 && !w.w1) {
          w.w1 = true
          notify('Spawncamp', `1 minute of ${appCfg.name} left today — wrap it up.`)
        }
      }
    }

    if (shouldKill && pids) {
      for (const pid of pids) {
        await killByPid(pid)
        killLog.push({ name: appCfg.name, pid, time: new Date().toISOString() })
        console.log('[engine] killed', appCfg.name, 'pid', pid, `(${appCfg.mode})`)
      }
      onBlocked(appCfg.name)
    } else if (pids && pids.length > 0) {
      // Running but allowed right now — track the time spent (the insight: usage outside block hours).
      recordRuntime(appCfg.name, POLL_SECONDS)
    } else {
      // App isn't running — re-arm its takeover so the next genuine launch pops it again.
      lockoutArmed[key] = true
    }
  }

  // Panic also slams browsers shut to cut off web-based temptation.
  if (panicActive && cfg.panic.blockBrowsers) {
    for (const [name, pids] of running) {
      if (BROWSERS.has(name)) {
        for (const pid of pids) {
          await killByPid(pid)
          killLog.push({ name, pid, time: new Date().toISOString() })
          console.log('[engine] killed (panic browser)', name, 'pid', pid)
        }
      }
    }
  }

  // Folder blocking — kills any process whose exe lives under a blocked folder.
  // Throttled to every other tick since the path query is heavier.
  const folders = cfg.folderBlocks ?? []
  if (folders.length > 0 && tickCount % 2 === 0) {
    const activeFolders = folders
      .filter((f) => panicActive || f.mode === 'always' || (f.mode === 'schedule' && schedActive))
      .map((f) => f.path.replace(/[\\/]+$/, '').toLowerCase())
    if (activeFolders.length > 0) {
      const withPaths = await listProcessesWithPaths()
      for (const p of withPaths) {
        const lp = p.path.toLowerCase()
        if (activeFolders.some((f) => lp.startsWith(f + '\\'))) {
          await killByPid(p.pid)
          killLog.push({
            name: p.path.split(/[\\/]/).pop() || p.path,
            pid: p.pid,
            time: new Date().toISOString()
          })
          console.log('[engine] killed (folder)', p.path, 'pid', p.pid)
          onBlocked(p.path.split(/[\\/]/).pop() || 'app')
        }
      }
    }
  }

  if (killLog.length > 500) killLog = killLog.slice(-500)

  // Persist usage periodically (~every 12s) and whenever it changed near a boundary.
  ticksSincePersist++
  if (usageChanged && ticksSincePersist >= 8) {
    persistUsage()
    ticksSincePersist = 0
  }
}

export function startEngine(): void {
  if (timer) return
  initUsage()
  initPanic()
  initStats()
  void tick()
  timer = setInterval(() => {
    tick().catch((e) => console.error('[engine] tick error:', e))
  }, POLL_MS)
  console.log('[engine] started, polling every', POLL_MS, 'ms')
}

export function stopEngine(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  persistUsage()
  flushStats()
}
