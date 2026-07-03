import type { Schedule, TimeRange } from './store'

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const TIME_RE = /^\d{2}:\d{2}$/

function isValidTime(t: unknown): t is string {
  if (typeof t !== 'string' || !TIME_RE.test(t)) return false
  const [h, m] = t.split(':').map(Number)
  return h >= 0 && h <= 23 && m >= 0 && m <= 59
}

const MAX_RANGES_PER_DAY = 12

/**
 * Coerce arbitrary JSON into a valid Schedule: only day keys "0"–"6", only
 * arrays of well-formed HH:MM ranges, max 12 ranges/day. Everything else is
 * dropped — a hand-edited or corrupted config can degrade but never brick
 * the engine.
 */
export function sanitizeSchedule(raw: unknown): Schedule {
  const out: Schedule = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(key) || !Array.isArray(value)) continue
    const ranges: TimeRange[] = []
    for (const item of value) {
      if (ranges.length >= MAX_RANGES_PER_DAY) break
      if (item && typeof item === 'object') {
        const { start, end } = item as { start?: unknown; end?: unknown }
        if (isValidTime(start) && isValidTime(end)) ranges.push({ start, end })
      }
    }
    if (ranges.length > 0) out[key] = ranges
  }
  return out
}

export interface BlockStatus {
  active: boolean
  /** ISO timestamp of the next time `active` flips, or null if it won't within a week. */
  nextChange: string | null
}

/**
 * Whether blocking should be active for the given moment.
 * Ranges are same-day only; a range with end <= start is ignored as invalid.
 * An end of "23:59" means end-of-day (minute 1440) — nobody who types 23:59
 * means "except the last minute", and the everyday preset must not leave a
 * nightly one-minute hole.
 */
export function isActiveAt(schedule: Schedule, date: Date): boolean {
  const day = String(date.getDay())
  const minutes = date.getHours() * 60 + date.getMinutes()
  const ranges = schedule[day] ?? []
  return ranges.some((r) => {
    const s = toMinutes(r.start)
    const e = r.end === '23:59' ? 1440 : toMinutes(r.end)
    return e > s && minutes >= s && minutes < e
  })
}

let statusErrorLogged = false

/**
 * Current block status plus when it next changes (for the UI countdown).
 * Never throws: a malformed schedule degrades to "inactive" (logged once)
 * instead of killing every engine tick and hanging the UI on load.
 */
export function getStatus(schedule: Schedule, enabled: boolean, now: Date): BlockStatus {
  try {
    if (!enabled) return { active: false, nextChange: null }
    const active = isActiveAt(schedule, now)

    // Scan minute-by-minute up to 8 days out for the next state flip. Cheap (~11.5k iterations).
    const probe = new Date(now)
    probe.setSeconds(0, 0)
    for (let i = 1; i <= 8 * 24 * 60; i++) {
      probe.setMinutes(probe.getMinutes() + 1)
      if (isActiveAt(schedule, probe) !== active) {
        return { active, nextChange: probe.toISOString() }
      }
    }
    return { active, nextChange: null }
  } catch (e) {
    if (!statusErrorLogged) {
      statusErrorLogged = true
      console.error('[schedule] getStatus failed; treating schedule as inactive:', e)
    }
    return { active: false, nextChange: null }
  }
}
