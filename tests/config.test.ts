import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, migrate } from '../src/main/config-logic.ts'
import { signValue, verifySigned } from '../src/main/integrity.ts'

test('garbage input migrates to full defaults', () => {
  assert.deepEqual(migrate(null), DEFAULT_CONFIG)
  assert.deepEqual(migrate('nonsense'), DEFAULT_CONFIG)
  assert.deepEqual(migrate(42), DEFAULT_CONFIG)
  assert.deepEqual(migrate({ blocklist: 'no', schedule: 7, challenge: [] }).schedule, {})
})

test('legacy string[] blocklist migrates to schedule-mode entries with .exe names', () => {
  const cfg = migrate({ blocklist: ['steam', 'Discord.exe'] })
  assert.deepEqual(cfg.blocklist, [
    { name: 'steam.exe', mode: 'schedule' },
    { name: 'Discord.exe', mode: 'schedule' }
  ])
})

test('migrate round-trips a modern config unchanged', () => {
  const cfg = migrate({
    ...DEFAULT_CONFIG,
    blocklist: [{ name: 'steam.exe', mode: 'budget', dailyLimitMinutes: 45 }],
    blockedSites: ['reddit.com'],
    strictMode: true,
    schedule: { '1': [{ start: '09:00', end: '17:00' }] }
  })
  assert.deepEqual(migrate(cfg), cfg) // idempotent
  assert.equal(cfg.blocklist[0].dailyLimitMinutes, 45)
  assert.equal(cfg.strictMode, true)
})

test('signed round-trip: persist shape survives load verification, edits fail it', () => {
  const cfg = migrate({ blocklist: [{ name: 'steam.exe', mode: 'always' }], userName: 'C' })
  const onDisk = JSON.parse(JSON.stringify({ config: cfg, sig: signValue(cfg) }))
  assert.ok(verifySigned(onDisk.config, onDisk.sig)) // clean load
  onDisk.config.blocklist = [] // the classic hand-edit
  assert.ok(!verifySigned(onDisk.config, onDisk.sig)) // tamper detected
})

test('clamps and coercions: hours, exemptMinutes, bad modes and times', () => {
  const cfg = migrate({
    dailyGamingHours: 99,
    challenge: { exemptMinutes: 999, type: 'bogus' },
    blocklist: [{ name: 'x.exe', mode: 'bogus' }],
    commitment: { time: '25:99' },
    strictModeOffAt: 'not-a-date'
  })
  assert.equal(cfg.dailyGamingHours, 24)
  assert.equal(cfg.challenge.exemptMinutes, 60)
  assert.equal(cfg.challenge.type, 'words')
  assert.equal(cfg.blocklist[0].mode, 'schedule')
  assert.equal(cfg.commitment.time, '09:00')
  assert.equal(cfg.strictModeOffAt, '')
})
