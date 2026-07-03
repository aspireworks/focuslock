import { app } from 'electron'
import { exec, spawn } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const HEARTBEAT_MS = 1000
const STALE_MS = 3000

function ud(): string {
  return app.getPath('userData')
}
const mainHb = (): string => join(ud(), 'main.hb')
const guardianHb = (): string => join(ud(), 'guardian.hb')
const configFile = (): string => join(ud(), 'config.json')

function readStamp(path: string): number {
  try {
    return Number(JSON.parse(readFileSync(path, 'utf-8')).t) || 0
  } catch {
    return 0
  }
}
function writeStamp(path: string): void {
  try {
    writeFileSync(path, JSON.stringify({ t: Date.now() }), 'utf-8')
  } catch {
    /* ignore */
  }
}
function fresh(path: string): boolean {
  return Date.now() - readStamp(path) < STALE_MS
}

/** Read protection state straight from disk so both processes see live changes. */
function protectionOn(): boolean {
  try {
    let t = readFileSync(configFile(), 'utf-8')
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
    const raw = JSON.parse(t)
    // Signed shape { config, sig } since 2.3; fall back to the legacy flat shape.
    const cfg = raw && typeof raw === 'object' && 'config' in raw ? raw.config : raw
    return cfg?.protectionEnabled === true
  } catch {
    return false
  }
}

function spawnDetached(args: string[]): void {
  try {
    spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref()
  } catch (e) {
    console.error('[watchdog] spawn failed', args, e)
  }
}

// ---- MAIN process side ----
let mainTimer: NodeJS.Timeout | null = null

function ensureGuardian(): void {
  if (!fresh(guardianHb())) spawnDetached(['--watchdog'])
}

export function startWatchdog(): void {
  if (mainTimer) return
  writeStamp(mainHb())
  ensureGuardian()
  mainTimer = setInterval(() => {
    writeStamp(mainHb())
    ensureGuardian()
  }, HEARTBEAT_MS)
  console.log('[watchdog] main heartbeat started')
}

export function stopWatchdog(): void {
  if (mainTimer) {
    clearInterval(mainTimer)
    mainTimer = null
  }
}

// ---- Scheduled-task re-arm (survives "End process tree") ----
// A per-user schtasks entry (no admin needed) relaunches Spawncamp every minute.
// While the app runs, the fired instance hits the single-instance lock and exits;
// --from-task keeps both that and a cold re-arm start silent (hidden to tray).
const GUARD_TASK = 'SpawncampGuard'

export function installGuardTask(): void {
  if (!app.isPackaged) return // dev execPath is electron.exe — never register that
  const cmd = `schtasks /Create /F /SC MINUTE /MO 1 /TN "${GUARD_TASK}" /TR "\\"${process.execPath}\\" --from-task"`
  exec(cmd, { windowsHide: true }, (e) => {
    if (e) console.error('[watchdog] guard task install failed:', e)
    else console.log('[watchdog] guard task installed')
  })
}

export function removeGuardTask(): void {
  if (!app.isPackaged) return
  exec(`schtasks /Delete /F /TN "${GUARD_TASK}"`, { windowsHide: true }, (e) => {
    // "task not found" is fine — treat any other failure as log-worthy.
    if (e && !/ERROR:/i.test(String(e.message))) console.error('[watchdog] guard task remove failed:', e)
    else console.log('[watchdog] guard task removed (or was absent)')
  })
}

/** Run on login. Only meaningful for the installed exe (dev execPath is electron.exe). */
export function applyAutostart(enabled: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
  } catch (e) {
    console.error('[watchdog] setLoginItemSettings failed', e)
  }
}

// ---- GUARDIAN process side (launched with --watchdog) ----
export function startGuardianLoop(): void {
  // If another guardian is already alive, bow out.
  if (fresh(guardianHb())) {
    app.quit()
    return
  }
  console.log('[watchdog] guardian started')
  setInterval(() => {
    if (!protectionOn()) {
      // Protection was turned off — stand down and let the app stay closed.
      app.quit()
      return
    }
    writeStamp(guardianHb())
    if (!fresh(mainHb())) {
      console.log('[watchdog] main is gone — relaunching')
      spawnDetached(['--from-task']) // relaunch to the tray without stealing focus
    }
  }, HEARTBEAT_MS)
}
