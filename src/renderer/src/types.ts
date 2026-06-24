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

export interface Config {
  blocklist: BlockedApp[]
  folderBlocks: FolderRule[]
  blockedSites: string[]
  protectionEnabled: boolean
  blockMessage: string
  userName: string
  onboardingComplete: boolean
  scheduleEnabled: boolean
  schedule: Schedule
  challenge: ChallengeConfig
  panic: PanicConfig
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
  stats: StatsView
  version: string
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
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
