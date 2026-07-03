import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getStatus, isActiveAt, sanitizeSchedule } from '../src/main/schedule.ts'
import type { Schedule } from '../src/main/store.ts'

// Mon 2026-06-29 10:30 local — a known weekday morning.
const monday1030 = new Date(2026, 5, 29, 10, 30)

test('sanitizeSchedule passes a valid schedule through', () => {
  const s = { '1': [{ start: '09:00', end: '17:00' }] }
  assert.deepEqual(sanitizeSchedule(s), s)
})

test('sanitizeSchedule drops garbage day values', () => {
  assert.deepEqual(sanitizeSchedule({ '1': 'garbage' }), {})
  assert.deepEqual(sanitizeSchedule({ '1': 42, '2': null, '3': { start: '09:00' } }), {})
})

test('sanitizeSchedule drops non-day keys and malformed ranges, keeps good ones', () => {
  const out = sanitizeSchedule({
    '7': [{ start: '09:00', end: '17:00' }], // invalid day
    banana: [{ start: '09:00', end: '17:00' }],
    '1': [
      { start: '9:00', end: '17:00' }, // not HH:MM
      { start: '09:00', end: '25:00' }, // invalid hour
      { start: '09:61', end: '17:00' }, // invalid minute
      { start: '09:00' }, // missing end
      'garbage',
      { start: '09:00', end: '17:00' } // the one valid range
    ]
  })
  assert.deepEqual(out, { '1': [{ start: '09:00', end: '17:00' }] })
})

test('sanitizeSchedule handles non-object input and caps ranges at 12/day', () => {
  assert.deepEqual(sanitizeSchedule(null), {})
  assert.deepEqual(sanitizeSchedule('x'), {})
  assert.deepEqual(sanitizeSchedule([1, 2]), {})
  const many = Array.from({ length: 20 }, (_, i) => ({
    start: `${String(i).padStart(2, '0')}:00`,
    end: `${String(i).padStart(2, '0')}:30`
  }))
  assert.equal(sanitizeSchedule({ '1': many })['1'].length, 12)
})

test('isActiveAt basic in/out of range', () => {
  const s: Schedule = { '1': [{ start: '09:00', end: '17:00' }] }
  assert.ok(isActiveAt(s, monday1030))
  assert.ok(!isActiveAt(s, new Date(2026, 5, 29, 18, 0)))
  assert.ok(!isActiveAt(s, new Date(2026, 5, 28, 10, 30))) // Sunday
})

test('an end of 23:59 covers the last minute of the day (everyday preset)', () => {
  const everyday: Schedule = {}
  for (let d = 0; d <= 6; d++) everyday[String(d)] = [{ start: '00:00', end: '23:59' }]
  assert.ok(isActiveAt(everyday, new Date(2026, 5, 29, 23, 59, 30)))
  assert.ok(isActiveAt(everyday, new Date(2026, 5, 29, 0, 0, 0)))
  // A non-23:59 end is still exclusive.
  const s: Schedule = { '1': [{ start: '09:00', end: '17:00' }] }
  assert.ok(!isActiveAt(s, new Date(2026, 5, 29, 17, 0)))
})

test('getStatus never throws on a hostile schedule object', () => {
  const garbage = { '1': 'garbage' } as unknown as Schedule
  assert.deepEqual(getStatus(garbage, true, monday1030), { active: false, nextChange: null })
})

test('getStatus reports active and the next flip', () => {
  const s: Schedule = { '1': [{ start: '09:00', end: '17:00' }] }
  const st = getStatus(s, true, monday1030)
  assert.equal(st.active, true)
  assert.ok(st.nextChange && new Date(st.nextChange).getHours() === 17)
  assert.deepEqual(getStatus(s, false, monday1030), { active: false, nextChange: null })
})
