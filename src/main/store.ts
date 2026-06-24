import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/** A daily time window in 24h "HH:MM" form. Same-day only (end must be after start). */
export interface TimeRange {
  start: string
  end: string
}

/** Weekly schedule keyed by day-of-week: "0" = Sunday … "6" = Saturday. */
export type Schedule = Record<string, TimeRange[]>

export type BlockMode = 'always' | 'schedule' | 'budget'

export interface BlockedApp {
  /** Executable name, e.g. "steam.exe". Matched case-insensitively. */
  name: string
  mode: BlockMode
  /** Minutes of allowed runtime per day, only used in 'budget' mode. */
  dailyLimitMinutes?: number
}

/** Blocks any executable launched from inside this folder (recursively). */
export interface FolderRule {
  path: string
  mode: 'always' | 'schedule'
}

export type ChallengeType = 'words' | 'chars' | 'custom' | 'timer'

export interface PanicConfig {
  /** Lockdown duration in minutes. */
  minutes: number
  /** Shown on the breathing overlay. */
  mantra: string
  /** Also kill browsers during panic (to cut off web-based temptation). */
  blockBrowsers: boolean
}

export interface ChallengeConfig {
  type: ChallengeType
  /** Character count for 'chars' mode. */
  length: number
  /** Word count for 'words' mode. */
  wordCount: number
  /** The exact text the user must type in 'custom' mode. */
  customText: string
  /** Countdown length in minutes for 'timer' mode. */
  timerMinutes: number
}

export interface Config {
  blocklist: BlockedApp[]
  folderBlocks: FolderRule[]
  /** Domains blocked via the hosts file (always-on while listed). */
  blockedSites: string[]
  /** Run-on-boot + self-relaunch watchdog. Turning off is challenge-gated. */
  protectionEnabled: boolean
  /** Shown in the "you're blocked" notification when an app is killed. */
  blockMessage: string
  /** For light personalization (greeting, block messages). */
  userName: string
  /** Self-reported hours/day spent on games before FocusLock. Powers the "time reclaimed" estimate. 0 = not provided/skipped. */
  dailyGamingHours: number
  /** False until the first-run onboarding wizard is finished. */
  onboardingComplete: boolean
  scheduleEnabled: boolean
  schedule: Schedule
  challenge: ChallengeConfig
  panic: PanicConfig
}

export const DEFAULT_MANTRA =
  'This urge is temporary. I am in control of my choices, and I am choosing the person I want to become. Stepping away right now is strength, not loss.'

const DEFAULT_CONFIG: Config = {
  blocklist: [],
  folderBlocks: [],
  blockedSites: [],
  protectionEnabled: false,
  blockMessage: 'Back to what matters. You’ve got this.',
  userName: '',
  dailyGamingHours: 0,
  onboardingComplete: false,
  scheduleEnabled: true,
  schedule: {},
  challenge: { type: 'words', length: 250, wordCount: 40, customText: '', timerMinutes: 5 },
  panic: { minutes: 5, mantra: DEFAULT_MANTRA, blockBrowsers: true }
}

function coerceChallengeType(t: unknown): ChallengeType {
  return t === 'chars' || t === 'custom' || t === 'timer' || t === 'words' ? t : 'words'
}

function coerceMode(m: unknown): BlockMode {
  return m === 'always' || m === 'budget' || m === 'schedule' ? m : 'schedule'
}

/** Normalize/migrate raw JSON into a valid Config (handles the old string[] blocklist). */
function migrate(raw: unknown): Config {
  const base = structuredClone(DEFAULT_CONFIG)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>

  let blocklist: BlockedApp[] = []
  if (Array.isArray(r.blocklist)) {
    blocklist = r.blocklist
      .map((item): BlockedApp | null => {
        if (typeof item === 'string') return { name: item, mode: 'schedule' }
        if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
          const it = item as { name: string; mode?: unknown; dailyLimitMinutes?: unknown }
          const mode = coerceMode(it.mode)
          const out: BlockedApp = { name: it.name, mode }
          if (mode === 'budget') out.dailyLimitMinutes = Number(it.dailyLimitMinutes) || 60
          return out
        }
        return null
      })
      .filter((x): x is BlockedApp => x !== null)
  }

  let folderBlocks: FolderRule[] = []
  if (Array.isArray(r.folderBlocks)) {
    folderBlocks = r.folderBlocks
      .map((item): FolderRule | null => {
        if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
          const it = item as { path: string; mode?: unknown }
          return { path: it.path, mode: it.mode === 'schedule' ? 'schedule' : 'always' }
        }
        return null
      })
      .filter((x): x is FolderRule => x !== null)
  }

  const blockedSites = Array.isArray(r.blockedSites)
    ? r.blockedSites.filter((s): s is string => typeof s === 'string')
    : []

  return {
    blocklist,
    folderBlocks,
    blockedSites,
    protectionEnabled: r.protectionEnabled === true,
    blockMessage: typeof r.blockMessage === 'string' ? r.blockMessage : base.blockMessage,
    userName: typeof r.userName === 'string' ? r.userName : '',
    dailyGamingHours: Math.max(0, Math.min(24, Number(r.dailyGamingHours) || 0)),
    onboardingComplete: r.onboardingComplete === true,
    scheduleEnabled: typeof r.scheduleEnabled === 'boolean' ? r.scheduleEnabled : base.scheduleEnabled,
    schedule:
      r.schedule && typeof r.schedule === 'object' ? (r.schedule as Schedule) : base.schedule,
    challenge: ((): ChallengeConfig => {
      const ch = (r.challenge ?? {}) as Record<string, unknown>
      return {
        type: coerceChallengeType(ch.type),
        length: Number(ch.length) || base.challenge.length,
        wordCount: Number(ch.wordCount) || base.challenge.wordCount,
        customText: typeof ch.customText === 'string' ? ch.customText : '',
        timerMinutes: Number(ch.timerMinutes) || base.challenge.timerMinutes
      }
    })(),
    panic: ((): PanicConfig => {
      const p = (r.panic ?? {}) as Record<string, unknown>
      return {
        minutes: Number(p.minutes) || base.panic.minutes,
        mantra: typeof p.mantra === 'string' && p.mantra.trim() ? p.mantra : base.panic.mantra,
        blockBrowsers:
          typeof p.blockBrowsers === 'boolean' ? p.blockBrowsers : base.panic.blockBrowsers
      }
    })()
  }
}

let configPath = ''
let cache: Config = structuredClone(DEFAULT_CONFIG)

function load(): Config {
  try {
    if (existsSync(configPath)) {
      // Strip a UTF-8 BOM if some editor added one — JSON.parse chokes on it.
      let text = readFileSync(configPath, 'utf-8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      return migrate(JSON.parse(text))
    }
  } catch (e) {
    console.error('[store] failed to read config, using defaults:', e)
  }
  return structuredClone(DEFAULT_CONFIG)
}

function persist(): void {
  try {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (e) {
    console.error('[store] failed to write config:', e)
  }
}

/** Must be called after app is ready (needs userData path). */
export function initStore(): void {
  configPath = join(app.getPath('userData'), 'config.json')
  cache = load()
  persist()
  console.log('[store] config at', configPath)
}

export function getConfig(): Config {
  return structuredClone(cache)
}

export function updateConfig(patch: Partial<Config>): Config {
  cache = { ...cache, ...patch }
  persist()
  return getConfig()
}
