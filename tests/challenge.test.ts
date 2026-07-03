import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimTimer,
  generateChallenge,
  isValidToken,
  startTimerChallenge,
  verifyChallenge
} from '../src/main/challenge.ts'
import type { ChallengeConfig } from '../src/main/config-logic.ts'

const cfg = (over: Partial<ChallengeConfig>): ChallengeConfig => ({
  type: 'words',
  length: 20,
  wordCount: 6,
  customText: '',
  timerMinutes: 1,
  exemptMinutes: 15,
  ...over
})

test('words challenge generates the requested word count', () => {
  const c = generateChallenge(cfg({ type: 'words', wordCount: 6 }))
  assert.equal(c.text.split(' ').length, 6)
})

test('chars challenge generates the requested length', () => {
  const c = generateChallenge(cfg({ type: 'chars', length: 25 }))
  assert.equal(c.text.length, 25)
})

test('custom text is used verbatim; empty custom falls back to words', () => {
  assert.equal(generateChallenge(cfg({ type: 'custom', customText: ' my mantra ' })).text, 'my mantra')
  assert.ok(generateChallenge(cfg({ type: 'custom', customText: '   ' })).text.includes(' '))
})

test('verify: exact text issues a valid one-time token; mismatch and wrong id fail', () => {
  const c = generateChallenge(cfg({}))
  assert.deepEqual(verifyChallenge('wrong-id', c.text), { ok: false })
  const bad = verifyChallenge(c.id, c.text + 'x')
  assert.equal(bad.ok, false)
  const good = verifyChallenge(c.id, c.text)
  assert.equal(good.ok, true)
  assert.ok(isValidToken(good.token))
  assert.ok(!isValidToken('not-a-token'))
  assert.ok(!isValidToken(undefined))
  // The challenge is consumed — the same id can't be verified twice.
  assert.equal(verifyChallenge(c.id, c.text).ok, false)
})

test('timer: claiming before the countdown elapses fails with remainingMs', () => {
  const t = startTimerChallenge(1)
  assert.ok(t.endsAt > Date.now() + 50_000)
  const early = claimTimer(t.id)
  assert.equal(early.ok, false)
  assert.ok((early.remainingMs ?? 0) > 0)
  assert.equal(claimTimer('wrong-id').ok, false)
})
