import { randomBytes, randomUUID } from 'crypto'
// Explicit .ts extensions so the unit tests can import this module under plain Node.
import type { ChallengeConfig } from './config-logic.ts'
import { WORDS } from './words.ts'

// Legible alphabet for 'chars' mode — no easily confused chars (0/O, 1/l/I).
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

interface ActiveChallenge {
  id: string
  text: string
}

let current: ActiveChallenge | null = null
// Active timer challenge — issues a token only once real time has elapsed.
let currentTimer: { id: string; endsAt: number } | null = null

// Unlock tokens: token -> expiry epoch ms. Reusable within the window.
const tokens = new Map<string, number>()
const TOKEN_TTL_MS = 60_000

function issueToken(): string {
  const token = randomUUID()
  tokens.set(token, Date.now() + TOKEN_TTL_MS)
  return token
}

function randomIndex(max: number): number {
  return randomBytes(4).readUInt32BE(0) % max
}

function genChars(n: number): string {
  const len = Math.max(10, Math.min(2000, Math.floor(n)))
  const bytes = randomBytes(len)
  let text = ''
  for (let i = 0; i < len; i++) text += CHARS[bytes[i] % CHARS.length]
  return text
}

function genWords(count: number): string {
  const n = Math.max(5, Math.min(300, Math.floor(count)))
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(WORDS[randomIndex(WORDS.length)])
  return out.join(' ')
}

export function generateChallenge(cfg: ChallengeConfig): { id: string; text: string } {
  let text: string
  if (cfg.type === 'custom' && cfg.customText.trim().length > 0) {
    text = cfg.customText.trim()
  } else if (cfg.type === 'chars') {
    text = genChars(cfg.length)
  } else {
    // 'words' (default), or 'custom' with empty text falls back here.
    text = genWords(cfg.wordCount)
  }
  current = { id: randomUUID(), text }
  return { ...current }
}

export function verifyChallenge(id: string, typed: string): { ok: boolean; token?: string } {
  if (!current || current.id !== id) return { ok: false }
  if (typed !== current.text) return { ok: false }
  current = null
  return { ok: true, token: issueToken() }
}

export function startTimerChallenge(minutes: number): {
  id: string
  kind: 'timer'
  endsAt: number
} {
  const m = Math.max(1, Math.min(180, Math.floor(minutes) || 5))
  const id = randomUUID()
  const endsAt = Date.now() + m * 60_000
  currentTimer = { id, endsAt }
  return { id, kind: 'timer', endsAt }
}

/** Issues a token only if the countdown for `id` has genuinely elapsed (no fast-forward). */
export function claimTimer(id: string): { ok: boolean; token?: string; remainingMs?: number } {
  if (!currentTimer || currentTimer.id !== id) return { ok: false }
  const remainingMs = currentTimer.endsAt - Date.now()
  if (remainingMs > 0) return { ok: false, remainingMs }
  currentTimer = null
  return { ok: true, token: issueToken() }
}

/** True if the token is present and unexpired. Lets one challenge authorize several changes for 60s. */
export function isValidToken(token: string | undefined): boolean {
  if (!token) return false
  const exp = tokens.get(token)
  if (!exp) return false
  if (Date.now() > exp) {
    tokens.delete(token)
    return false
  }
  return true
}
