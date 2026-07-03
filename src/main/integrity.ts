import { createHash } from 'crypto'

/**
 * Tamper-EVIDENT signing for on-disk state — deliberately not tamper-proof.
 * The salt is a fixed constant shipped in the binary: a motivated user can
 * find it and re-sign, and that's fine. The goal is that a casual out-of-band
 * edit ("just remove the app from config.json") is detected, costs the day's
 * streak, and is shown to the user — the same social cost as any other lapse.
 * Say exactly this in the README/privacy docs; never claim more.
 */
const APP_SALT = 'spawncamp-integrity-v1:e3b0c44298fc1c14'

/** Deterministic JSON: object keys sorted at every level, so signing is stable. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort()
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalJson((v as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(v) ?? 'null'
}

export function signValue(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v) + APP_SALT).digest('hex')
}

export function verifySigned(value: unknown, sig: unknown): boolean {
  return typeof sig === 'string' && sig === signValue(value)
}

// Session-wide tamper flag: set at load time by whichever file failed its check,
// surfaced through get-state, and turned into a recorded lapse once stats are up.
let tampered = false

export function flagTamper(source: string): void {
  if (!tampered) console.error('[integrity] out-of-band edit detected in', source)
  tampered = true
}

export function isTampered(): boolean {
  return tampered
}
