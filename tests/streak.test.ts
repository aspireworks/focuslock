import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCurrentStreak,
  dayKey,
  isLapseDay,
  RUNTIME_LAPSE_THRESHOLD_SEC,
  type StreakData
} from '../src/main/streak.ts'

// Fixed "today" so nothing depends on the wall clock: Wed 2026-06-24.
const today = new Date(2026, 5, 24)
const day = (offset: number): string => {
  const d = new Date(today)
  d.setDate(d.getDate() + offset)
  return dayKey(d)
}

const base = (over: Partial<StreakData> = {}): StreakData => ({
  startDate: day(-30),
  lapseDays: {},
  runtime: {},
  ...over
})

test('dayKey pads month and day', () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05')
})

test('a clean month since start counts every day including today', () => {
  assert.equal(computeCurrentStreak(base(), today), 31) // start day itself counts
})

test('never counts days before startDate', () => {
  assert.equal(computeCurrentStreak(base({ startDate: day(-2) }), today), 3)
  assert.equal(computeCurrentStreak(base({ startDate: day(0) }), today), 1)
})

test('a lapse today means streak 0', () => {
  assert.equal(computeCurrentStreak(base({ lapseDays: { [day(0)]: 1 } }), today), 0)
})

test('streak stops at the most recent lapse', () => {
  assert.equal(computeCurrentStreak(base({ lapseDays: { [day(-3)]: 1 } }), today), 3)
})

test('real gaming runtime breaks the day; sub-threshold noise does not', () => {
  const noisy = base({ runtime: { [day(-1)]: { 'steam.exe': RUNTIME_LAPSE_THRESHOLD_SEC - 1 } } })
  assert.ok(!isLapseDay(noisy, day(-1)))
  assert.equal(computeCurrentStreak(noisy, today), 31)

  const gamed = base({ runtime: { [day(-1)]: { 'steam.exe': 30, 'epic.exe': 40 } } }) // 70s combined
  assert.ok(isLapseDay(gamed, day(-1)))
  assert.equal(computeCurrentStreak(gamed, today), 1) // only today survives
})
