/**
 * Streak/lapse math — pure and clock-injected so tests don't depend on the wall
 * clock. stats.ts owns the persisted state and passes it in.
 */

/**
 * A blocked app running under this many seconds in a day is noise (launched then
 * killed, an incidental background tick) — not a real gaming session. At or above
 * it, the day counts as a lapse and breaks the streak.
 */
export const RUNTIME_LAPSE_THRESHOLD_SEC = 60

export interface StreakData {
  /** Day key the user started ("YYYY-MM-DD"); days before it never count. */
  startDate: string
  /** Day keys broken by a deliberate pause/disable/tamper. */
  lapseDays: Record<string, 1>
  /** day -> appName -> seconds a blocked app ran while allowed. */
  runtime: Record<string, Record<string, number>>
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Total allowed-runtime (seconds) across all blocked apps on a given day. */
function dayRuntimeSeconds(data: StreakData, dayK: string): number {
  const rt = data.runtime[dayK]
  if (!rt) return 0
  let sum = 0
  for (const s of Object.values(rt)) sum += s
  return sum
}

/** A day breaks the streak if protection was paused/disabled OR a blocked game actually ran. */
export function isLapseDay(data: StreakData, dayK: string): boolean {
  return data.lapseDays[dayK] === 1 || dayRuntimeSeconds(data, dayK) >= RUNTIME_LAPSE_THRESHOLD_SEC
}

/**
 * Consecutive clean days ending on `today` (a Date, so day arithmetic follows
 * the local calendar). 0 when today itself is a lapse.
 */
export function computeCurrentStreak(data: StreakData, today: Date): number {
  let current = 0
  const cursor = new Date(today)
  for (;;) {
    const k = dayKey(cursor)
    if (k < data.startDate) break // never count days before the user started
    if (isLapseDay(data, k)) break
    current++
    cursor.setDate(cursor.getDate() - 1)
  }
  return current
}
