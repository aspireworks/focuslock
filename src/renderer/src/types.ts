export interface TimeRange {
  start: string
  end: string
}

export type Schedule = Record<string, TimeRange[]>

export type BlockMode = 'always' | 'schedule' | 'budget'

export interface BlockedApp {
  name: string
  mode: BlockMode
  dailyLimitMinutes?: number
}

export type ChallengeType = 'words' | 'chars' | 'custom' | 'timer'

export interface ChallengeConfig {
  type: ChallengeType
  length: number
  wordCount: number
  customText: string
  timerMinutes: number
  /** Minutes of access a completed unlock challenge grants (5–60). */
  exemptMinutes: number
}

export interface FolderRule {
  path: string
  mode: 'always' | 'schedule'
}

export interface PanicConfig {
  minutes: number
  mantra: string
  blockBrowsers: boolean
}

export interface CommitmentConfig {
  enabled: boolean
  text: string
  time: string
  lastCommittedDate: string
}

/** Stock commitment shown on first run (mirrors DEFAULT_COMMITMENT in main/store.ts). */
export const DEFAULT_COMMITMENT =
  'I commit to being the hero of my own life and saying no to the distractions that don’t serve me.'

export interface Config {
  blocklist: BlockedApp[]
  folderBlocks: FolderRule[]
  blockedSites: string[]
  /** Onboarding sites whose hosts write failed — retryable from the Websites tab. */
  pendingSites: string[]
  protectionEnabled: boolean
  blockMessage: string
  userName: string
  dailyGamingHours: number
  onboardingComplete: boolean
  scheduleEnabled: boolean
  schedule: Schedule
  challenge: ChallengeConfig
  panic: PanicConfig
  commitment: CommitmentConfig
}

export interface BlockStatus {
  active: boolean
  nextChange: string | null
}

export interface KillEvent {
  name: string
  pid: number
  time: string
}

export interface Usage {
  date: string
  seconds: Record<string, number>
}

export interface StatsView {
  startDate: string
  daysSinceStart: number
  /** Consecutive clean (fully-protected, no-gaming) days ending today. 0 if today is a lapse. */
  currentStreak: number
  /** Longest clean streak ever reached. */
  bestStreak: number
  totalBlocks: number
  weekTotal: number
  last7: { date: string; count: number }[]
  topApps: { name: string; count: number }[]
  weekRuntime: { name: string; seconds: number }[]
}

export interface AppState {
  config: Config
  status: BlockStatus
  killLog: KillEvent[]
  paused: boolean
  usage: Usage
  panic: { active: boolean; until: number }
  /** Active unlock exemptions: lowercased exe name -> expiry epoch ms. */
  exemptions: Record<string, number>
  stats: StatsView
  /** True when today's commitment is due and not yet done (drives the morning overlay). */
  commitmentDue: boolean
  version: string
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Minutes for a range END. "23:59" means end-of-day (1440) — mirrors the engine's rule. */
export function endMinutes(hhmm: string): number {
  return hhmm === '23:59' ? 1440 : toMinutes(hhmm)
}

/** Remove exact duplicate ranges and sort by start. Invalid ranges are kept (flagged in the UI). */
export function dedupeRanges(ranges: TimeRange[]): TimeRange[] {
  const seen = new Set<string>()
  const out: TimeRange[] = []
  for (const r of ranges) {
    const key = `${r.start}-${r.end}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(r)
    }
  }
  return out.sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
}
