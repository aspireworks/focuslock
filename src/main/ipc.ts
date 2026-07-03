import { app, dialog, ipcMain, shell } from 'electron'
import { getLogsDir } from './logger'
import { getStats, recordLapse } from './stats'

// Where the in-app "Send feedback" button addresses email. Change to your preferred inbox.
const FEEDBACK_EMAIL = 'connor.d@mindmaven.com'
import {
  getConfig,
  updateConfig,
  type BlockedApp,
  type BlockMode,
  type ChallengeConfig,
  type ChallengeType,
  type CommitmentConfig,
  type PanicConfig,
  type Schedule
} from './store'
import { getStatus } from './schedule'
import { isCommitmentDue, recordCommitment } from './commitment'
import {
  exemptApp,
  getExemptions,
  getKillLog,
  getPanic,
  getUsage,
  isBlockingNow,
  isPanicActive,
  isPaused,
  listRunningApps,
  setPaused,
  startPanic
} from './engine'
import {
  claimTimer,
  generateChallenge,
  isValidToken,
  startTimerChallenge,
  verifyChallenge
} from './challenge'
import { detectGames } from './games'
import { applyHosts, normalizeDomain } from './websites'
import { applyAutostart, startWatchdog, stopWatchdog } from './watchdog'

interface ProtectedResult {
  ok: boolean
  reason?: 'locked'
  error?: string
  config?: ReturnType<typeof getConfig>
}

function fail(): ProtectedResult {
  return { ok: false, reason: 'locked' }
}

/**
 * Protective actions (anything that weakens the block) require a valid unlock token,
 * but only while enforcement is active. Outside that, edits are free.
 */
function authorize(token: string | undefined): boolean {
  if (isPanicActive()) return false // panic lockdown can't be lifted early
  if (!isBlockingNow()) return true
  return isValidToken(token)
}

function coerceMode(m: unknown): BlockMode {
  return m === 'always' || m === 'budget' || m === 'schedule' ? m : 'always'
}

function coerceChallengeType(t: unknown): ChallengeType {
  return t === 'chars' || t === 'custom' || t === 'words' ? t : 'words'
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : lo)))
}

const TIME_RE = /^\d{2}:\d{2}$/

export function registerIpc(): void {
  // ---- Read (always open) ----
  ipcMain.handle('get-state', () => {
    const config = getConfig()
    const status = getStatus(config.schedule, config.scheduleEnabled, new Date())
    return {
      config,
      status,
      killLog: getKillLog(),
      paused: isPaused(),
      usage: getUsage(),
      panic: getPanic(),
      exemptions: getExemptions(),
      stats: getStats(),
      commitmentDue: isCommitmentDue(),
      version: app.getVersion()
    }
  })

  ipcMain.handle('open-logs', () => shell.openPath(getLogsDir()))

  ipcMain.handle('send-feedback', () => {
    const subject = encodeURIComponent(`Spawncamp feedback (v${app.getVersion()})`)
    const body = encodeURIComponent(
      `What's working, what's broken, what you wish it did:\n\n\n\n---\nSpawncamp v${app.getVersion()}`
    )
    return shell.openExternal(`mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`)
  })

  ipcMain.handle('set-block-message', (_e, text: string) => {
    updateConfig({ blockMessage: String(text).slice(0, 200) })
    return getConfig()
  })

  ipcMain.handle('set-name', (_e, name: string) => {
    updateConfig({ userName: String(name).trim().slice(0, 40) })
    return getConfig()
  })

  // Daily commitment settings. Ungated — turning the ritual off doesn't weaken blocking.
  // lastCommittedDate is internal progress state and never changed from Settings.
  ipcMain.handle('set-commitment', (_e, patch: Partial<CommitmentConfig>) => {
    const cur = getConfig().commitment
    const text = typeof patch?.text === 'string' ? patch.text.trim().slice(0, 280) : ''
    updateConfig({
      commitment: {
        enabled: typeof patch?.enabled === 'boolean' ? patch.enabled : cur.enabled,
        text: text || cur.text,
        time: typeof patch?.time === 'string' && TIME_RE.test(patch.time) ? patch.time : cur.time,
        lastCommittedDate: cur.lastCommittedDate
      }
    })
    return getConfig()
  })

  ipcMain.handle('commit-today', () => {
    recordCommitment()
    return getConfig()
  })

  // Applies every onboarding choice at once (one config write, one UAC for any sites).
  ipcMain.handle(
    'complete-onboarding',
    async (
      _e,
      p: {
        name?: string
        dailyGamingHours?: number
        apps?: string[]
        mode?: string
        sites?: string[]
        commitmentText?: string
        commitmentTime?: string
      }
    ): Promise<ProtectedResult> => {
      const cfg = getConfig()
      const name = String(p?.name ?? '').trim().slice(0, 40)
      const dailyGamingHours = Math.max(0, Math.min(24, Number(p?.dailyGamingHours) || 0))
      const mode: BlockMode = p?.mode === 'schedule' ? 'schedule' : 'always'

      const commitText =
        typeof p?.commitmentText === 'string' ? p.commitmentText.trim().slice(0, 280) : ''
      const commitment: CommitmentConfig = {
        enabled: true,
        text: commitText || cfg.commitment.text,
        time:
          typeof p?.commitmentTime === 'string' && TIME_RE.test(p.commitmentTime)
            ? p.commitmentTime
            : cfg.commitment.time,
        lastCommittedDate: cfg.commitment.lastCommittedDate
      }

      const existing = new Set(cfg.blocklist.map((a) => a.name.toLowerCase()))
      const blocklist = [...cfg.blocklist]
      for (const exe of Array.isArray(p?.apps) ? p.apps : []) {
        if (typeof exe === 'string' && exe && !existing.has(exe.toLowerCase())) {
          blocklist.push({ name: exe, mode })
        }
      }

      let schedule = cfg.schedule
      let scheduleEnabled = cfg.scheduleEnabled
      if (mode === 'schedule' && Object.keys(cfg.schedule).length === 0) {
        schedule = {
          '1': [{ start: '09:00', end: '17:00' }],
          '2': [{ start: '09:00', end: '17:00' }],
          '3': [{ start: '09:00', end: '17:00' }],
          '4': [{ start: '09:00', end: '17:00' }],
          '5': [{ start: '09:00', end: '17:00' }]
        }
        scheduleEnabled = true
      }

      let blockedSites = cfg.blockedSites
      const sites = (Array.isArray(p?.sites) ? p.sites : [])
        .map((s) => normalizeDomain(String(s)))
        .filter((s): s is string => !!s)
      if (sites.length > 0) {
        const merged = Array.from(new Set([...cfg.blockedSites, ...sites]))
        const res = await applyHosts(merged)
        if (res.ok) blockedSites = merged
      }

      updateConfig({
        userName: name,
        dailyGamingHours,
        blocklist,
        schedule,
        scheduleEnabled,
        blockedSites,
        commitment,
        onboardingComplete: true
      })
      return { ok: true, config: getConfig() }
    }
  )

  // Panic mode — anyone can trigger it (it only adds restriction); it can't be lifted early.
  ipcMain.handle('start-panic', () => startPanic(getConfig().panic.minutes))

  ipcMain.handle('set-panic-config', (_e, patch: Partial<PanicConfig>) => {
    const cfg = getConfig()
    updateConfig({
      panic: {
        minutes: clamp(Number(patch?.minutes ?? cfg.panic.minutes), 1, 180),
        mantra: typeof patch?.mantra === 'string' ? patch.mantra : cfg.panic.mantra,
        blockBrowsers:
          typeof patch?.blockBrowsers === 'boolean' ? patch.blockBrowsers : cfg.panic.blockBrowsers
      }
    })
    return getConfig()
  })

  ipcMain.handle('list-processes', () => listRunningApps())

  // Native file picker — choose an .exe on disk, return its basename to block.
  ipcMain.handle('pick-app-file', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select an app to block',
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe'] }],
      defaultPath: process.env['ProgramFiles(x86)'] || 'C:\\'
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const full = res.filePaths[0]
    const name = full.split(/[\\/]/).pop() ?? full
    return { name, path: full }
  })

  // Native folder picker for folder-level blocking.
  ipcMain.handle('pick-folder', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select a folder to block',
      properties: ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  // Detect common game launchers (installed or running) for one-click blocking.
  ipcMain.handle('detect-games', async () => {
    const running = await listRunningApps()
    const names = getConfig().blocklist.map((a) => a.name)
    const result = detectGames(running, names)
    console.log('[games] detected', result.length, 'entries')
    return result
  })

  // ---- Dev override (intentionally NOT challenge-gated) ----
  ipcMain.handle('set-paused', (_e, value: boolean) => {
    if (value) recordLapse() // pausing opens a gaming window — today is no longer a clean day
    setPaused(Boolean(value))
    return { ok: true, paused: isPaused() }
  })

  // Stay-on protection. Turning ON is free; turning OFF needs the challenge (and never during panic).
  ipcMain.handle('set-protection', (_e, enabled: boolean, token?: string): ProtectedResult => {
    const cfg = getConfig()
    const turningOff = cfg.protectionEnabled && !enabled
    if (turningOff && (isPanicActive() || !isValidToken(token))) return fail()
    if (turningOff) recordLapse() // dropping protection taints today's streak
    updateConfig({ protectionEnabled: !!enabled })
    applyAutostart(!!enabled)
    if (enabled) startWatchdog()
    else stopWatchdog()
    return { ok: true, config: getConfig() }
  })

  // ---- Adding / strengthening is always allowed (no challenge) ----
  ipcMain.handle('add-app', (_e, name: string, mode?: BlockMode, dailyLimitMinutes?: number) => {
    const cfg = getConfig()
    const n = String(name).trim()
    if (n && !cfg.blocklist.some((a) => a.name.toLowerCase() === n.toLowerCase())) {
      const m = coerceMode(mode)
      const entry: BlockedApp = { name: n, mode: m }
      if (m === 'budget') entry.dailyLimitMinutes = Number(dailyLimitMinutes) || 60
      updateConfig({ blocklist: [...cfg.blocklist, entry] })
    }
    return getConfig()
  })

  ipcMain.handle('add-folder', (_e, path: string, mode?: 'always' | 'schedule') => {
    const cfg = getConfig()
    const p = String(path).trim()
    if (p && !cfg.folderBlocks.some((f) => f.path.toLowerCase() === p.toLowerCase())) {
      updateConfig({
        folderBlocks: [...cfg.folderBlocks, { path: p, mode: mode === 'schedule' ? 'schedule' : 'always' }]
      })
    }
    return getConfig()
  })

  // Adding a blocked site triggers one elevated (UAC) hosts write.
  ipcMain.handle('add-site', async (_e, domain: string): Promise<ProtectedResult> => {
    const cfg = getConfig()
    const d = normalizeDomain(domain)
    if (!d) return { ok: false, error: 'That doesn’t look like a valid domain.' }
    if (cfg.blockedSites.some((s) => s.toLowerCase() === d)) return { ok: true, config: getConfig() }
    const res = await applyHosts([...cfg.blockedSites, d])
    if (!res.ok) return { ok: false, error: res.error }
    updateConfig({ blockedSites: [...cfg.blockedSites, d] })
    return { ok: true, config: getConfig() }
  })

  // A completed unlock challenge buys a temporary exemption for the caught app.
  // It's the honest trade: access now, streak gone today. Never during panic.
  ipcMain.handle('exempt-app', (_e, name: string, token?: string): ProtectedResult & { minutes?: number } => {
    if (isPanicActive() || !isValidToken(token)) return fail()
    const n = String(name).trim()
    if (!n) return { ok: false, error: 'No app to unlock.' }
    const minutes = clamp(getConfig().challenge.exemptMinutes, 5, 60)
    exemptApp(n, minutes)
    recordLapse() // taking the unlock breaks today's streak
    return { ok: true, minutes, config: getConfig() }
  })

  // ---- Challenge ----
  ipcMain.handle('start-challenge', () => {
    const ch = getConfig().challenge
    if (ch.type === 'timer') return startTimerChallenge(ch.timerMinutes)
    return { ...generateChallenge(ch), kind: 'text' as const }
  })
  ipcMain.handle('verify-challenge', (_e, id: string, typed: string) => verifyChallenge(id, typed))
  ipcMain.handle('claim-timer', (_e, id: string) => claimTimer(id))

  // ---- Protective actions (token-gated while enforcing) ----
  ipcMain.handle(
    'set-app-mode',
    (
      _e,
      name: string,
      mode: BlockMode,
      dailyLimitMinutes: number | undefined,
      token?: string
    ): ProtectedResult => {
      if (!authorize(token)) return fail()
      const cfg = getConfig()
      const m = coerceMode(mode)
      const blocklist = cfg.blocklist.map((a) => {
        if (a.name.toLowerCase() !== String(name).toLowerCase()) return a
        const updated: BlockedApp = { name: a.name, mode: m }
        if (m === 'budget') {
          updated.dailyLimitMinutes = Number(dailyLimitMinutes) || a.dailyLimitMinutes || 60
        }
        return updated
      })
      updateConfig({ blocklist })
      return { ok: true, config: getConfig() }
    }
  )

  ipcMain.handle('remove-app', (_e, name: string, token?: string): ProtectedResult => {
    if (!authorize(token)) return fail()
    const cfg = getConfig()
    updateConfig({
      blocklist: cfg.blocklist.filter((a) => a.name.toLowerCase() !== String(name).toLowerCase())
    })
    return { ok: true, config: getConfig() }
  })

  ipcMain.handle(
    'set-folder-mode',
    (_e, path: string, mode: 'always' | 'schedule', token?: string): ProtectedResult => {
      if (!authorize(token)) return fail()
      const cfg = getConfig()
      updateConfig({
        folderBlocks: cfg.folderBlocks.map((f) =>
          f.path.toLowerCase() === String(path).toLowerCase()
            ? { path: f.path, mode: mode === 'schedule' ? 'schedule' : 'always' }
            : f
        )
      })
      return { ok: true, config: getConfig() }
    }
  )

  ipcMain.handle('remove-folder', (_e, path: string, token?: string): ProtectedResult => {
    if (!authorize(token)) return fail()
    const cfg = getConfig()
    updateConfig({
      folderBlocks: cfg.folderBlocks.filter(
        (f) => f.path.toLowerCase() !== String(path).toLowerCase()
      )
    })
    return { ok: true, config: getConfig() }
  })

  ipcMain.handle('remove-site', async (_e, domain: string, token?: string): Promise<ProtectedResult> => {
    if (!authorize(token)) return fail()
    const cfg = getConfig()
    const next = cfg.blockedSites.filter((s) => s.toLowerCase() !== String(domain).toLowerCase())
    const res = await applyHosts(next)
    if (!res.ok) return { ok: false, error: res.error }
    updateConfig({ blockedSites: next })
    return { ok: true, config: getConfig() }
  })

  ipcMain.handle(
    'set-schedule',
    (_e, schedule: Schedule, scheduleEnabled: boolean, token?: string): ProtectedResult => {
      if (!authorize(token)) return fail()
      updateConfig({ schedule, scheduleEnabled })
      return { ok: true, config: getConfig() }
    }
  )

  ipcMain.handle(
    'set-challenge',
    (_e, patch: Partial<ChallengeConfig>, token?: string): ProtectedResult => {
      if (!authorize(token)) return fail()
      const cfg = getConfig()
      const next: ChallengeConfig = {
        type: coerceChallengeType(patch?.type ?? cfg.challenge.type),
        length: clamp(Number(patch?.length ?? cfg.challenge.length), 10, 2000),
        wordCount: clamp(Number(patch?.wordCount ?? cfg.challenge.wordCount), 5, 300),
        customText:
          typeof patch?.customText === 'string' ? patch.customText : cfg.challenge.customText,
        timerMinutes: clamp(Number(patch?.timerMinutes ?? cfg.challenge.timerMinutes), 1, 180),
        exemptMinutes: clamp(Number(patch?.exemptMinutes ?? cfg.challenge.exemptMinutes), 5, 60)
      }
      updateConfig({ challenge: next })
      return { ok: true, config: getConfig() }
    }
  )

  ipcMain.handle('request-quit', (_e, token?: string): ProtectedResult => {
    if (getConfig().protectionEnabled) return fail() // turn off protection first
    if (!authorize(token)) return fail()
    app.exit(0)
    return { ok: true }
  })
}
