import type { Schedule } from './store'

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export interface BlockStatus {
  active: boolean
  /** ISO timestamp of the next time `active` flips, or null if it won't within a week. */
  nextChange: string | null
}

/**
 * Whether blocking should be active for the given moment.
 * Ranges are same-day only; a range with end <= start is ignored as invalid.
 */
export function isActiveAt(schedule: Schedule, date: Date): boolean {
  const day = String(date.getDay())
  const minutes = date.getHours() * 60 + date.getMinutes()
  const ranges = schedule[day] ?? []
  return ranges.some((r) => {
    const s = toMinutes(r.start)
    const e = toMinutes(r.end)
    return e > s && minutes >= s && minutes < e
  })
}

/** Current block status plus when it next changes (for the UI countdown). */
export function getStatus(schedule: Schedule, enabled: boolean, now: Date): BlockStatus {
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
}
