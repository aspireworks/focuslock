import { getConfig, updateConfig } from './store'

const pad = (n: number): string => String(n).padStart(2, '0')
/** Local-date key "YYYY-MM-DD" — mirrors the dayKey in stats.ts so daily reset is implicit. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Whether the daily commitment prompt should currently be showing: the feature is on,
 * today's commitment isn't done yet, and the chosen time has arrived.
 */
export function isCommitmentDue(now = new Date()): boolean {
  const c = getConfig().commitment
  if (!c.enabled) return false
  if (c.lastCommittedDate === dayKey(now)) return false
  const [h, m] = c.time.split(':').map(Number)
  const dueMin = (h || 0) * 60 + (m || 0)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return nowMin >= dueMin
}

/** Mark today's commitment as done so the prompt clears until tomorrow. */
export function recordCommitment(): void {
  updateConfig({
    commitment: { ...getConfig().commitment, lastCommittedDate: dayKey(new Date()) }
  })
}

let timer: NodeJS.Timeout | null = null
let lastDue = false

/**
 * Poll for the commitment coming due. Edge-triggered: `onDue` fires once on the
 * not-due → due transition (so we bring the window forward a single time, not every
 * tick while the user hasn't committed). The renderer keeps the overlay up via polled
 * state regardless.
 */
export function startCommitmentScheduler(onDue: () => void): void {
  if (timer) return
  const check = (): void => {
    const due = isCommitmentDue()
    if (due && !lastDue) onDue()
    lastDue = due
  }
  timer = setInterval(check, 30_000)
  check() // also check immediately on startup
}

export function stopCommitmentScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
