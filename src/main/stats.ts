import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface Stats {
  startDate: string
  totalBlocks: number
  byApp: Record<string, number>
  byDay: Record<string, number>
  /** date -> appName -> seconds the app actually ran while it was *allowed* to. */
  runtime: Record<string, Record<string, number>>
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

const pad = (n: number): string => String(n).padStart(2, '0')
const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = (): string => dayKey(new Date())

let statsPath = ''
let stats: Stats = { startDate: '', totalBlocks: 0, byApp: {}, byDay: {}, runtime: {} }
let runtimeWrites = 0

function persist(): void {
  try {
    writeFileSync(statsPath, JSON.stringify(stats), 'utf-8')
  } catch (e) {
    console.error('[stats] write failed:', e)
  }
}

/** Keep stats small — drop day buckets older than 90 days. */
function prune(): void {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const cut = dayKey(cutoff)
  for (const k of Object.keys(stats.byDay)) if (k < cut) delete stats.byDay[k]
  for (const k of Object.keys(stats.runtime)) if (k < cut) delete stats.runtime[k]
}

export function initStats(): void {
  statsPath = join(app.getPath('userData'), 'stats.json')
  try {
    if (existsSync(statsPath)) {
      let t = readFileSync(statsPath, 'utf-8')
      if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
      const r = JSON.parse(t)
      stats = {
        startDate: String(r.startDate || today()),
        totalBlocks: Number(r.totalBlocks) || 0,
        byApp: r.byApp && typeof r.byApp === 'object' ? r.byApp : {},
        byDay: r.byDay && typeof r.byDay === 'object' ? r.byDay : {},
        runtime: r.runtime && typeof r.runtime === 'object' ? r.runtime : {}
      }
    }
  } catch (e) {
    console.error('[stats] read failed, starting fresh:', e)
  }
  if (!stats.startDate) stats.startDate = today()
  prune()
  persist()
}

/** Count one block event (caller debounces to ~once per app per minute). */
export function recordBlock(name: string): void {
  const key = name.toLowerCase()
  stats.totalBlocks++
  stats.byApp[key] = (stats.byApp[key] || 0) + 1
  const d = today()
  stats.byDay[d] = (stats.byDay[d] || 0) + 1
  persist()
}

/** Add allowed-runtime for a blocked app (called every poll while it runs un-killed). */
export function recordRuntime(name: string, seconds: number): void {
  const key = name.toLowerCase()
  const d = today()
  if (!stats.runtime[d]) stats.runtime[d] = {}
  stats.runtime[d][key] = (stats.runtime[d][key] || 0) + seconds
  if (++runtimeWrites >= 8) {
    persist()
    runtimeWrites = 0
  }
}

export function flushStats(): void {
  persist()
}

export function getStats(): StatsView {
  const start = new Date(stats.startDate + 'T00:00:00')
  const daysSinceStart = Math.max(1, Math.floor((Date.now() - start.getTime()) / 86_400_000) + 1)

  const last7: { date: string; count: number }[] = []
  let weekTotal = 0
  const weekRuntimeMap: Record<string, number> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const k = dayKey(d)
    last7.push({ date: k, count: stats.byDay[k] || 0 })
    weekTotal += stats.byDay[k] || 0
    const rt = stats.runtime[k]
    if (rt) for (const [n, s] of Object.entries(rt)) weekRuntimeMap[n] = (weekRuntimeMap[n] || 0) + s
  }

  const topApps = Object.entries(stats.byApp)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const weekRuntime = Object.entries(weekRuntimeMap)
    .map(([name, seconds]) => ({ name, seconds: Math.round(seconds) }))
    .filter((x) => x.seconds >= 60)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 6)

  return { startDate: stats.startDate, daysSinceStart, totalBlocks: stats.totalBlocks, weekTotal, last7, topApps, weekRuntime }
}
