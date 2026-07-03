import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MARK_START,
  MARK_END,
  buildHosts,
  buildPsScript,
  normalizeDomain,
  psq,
  verifyHostsApplied
} from '../src/main/hosts-logic.ts'

// ---- normalizeDomain (ported from scripts/test-hosts.cjs) ----

test('normalizeDomain strips protocol, www and path', () => {
  assert.equal(normalizeDomain('https://www.reddit.com/r/all'), 'reddit.com')
})

test('normalizeDomain keeps subdomains and strips ports', () => {
  assert.equal(normalizeDomain('m.youtube.com'), 'm.youtube.com')
  assert.equal(normalizeDomain('example.com:8080'), 'example.com')
})

test('normalizeDomain rejects junk', () => {
  assert.equal(normalizeDomain('not a domain'), null)
  assert.equal(normalizeDomain('   '), null)
})

// ---- buildHosts (ported from scripts/test-hosts.cjs) ----

const userHosts = '127.0.0.1 localhost\r\n# my custom entry\r\n10.0.0.5 nas.local\r\n'

test('buildHosts preserves user entries and adds 0.0.0.0 lines with markers', () => {
  const h = buildHosts(userHosts, ['reddit.com'])
  assert.ok(h.includes('127.0.0.1 localhost'))
  assert.ok(h.includes('10.0.0.5 nas.local'))
  assert.ok(h.includes('0.0.0.0 reddit.com'))
  assert.ok(h.includes('0.0.0.0 www.reddit.com'))
  assert.ok(h.includes(MARK_START) && h.includes(MARK_END))
})

test('buildHosts is idempotent — reapplying replaces, never duplicates, the block', () => {
  const h1 = buildHosts(userHosts, ['reddit.com'])
  const h2 = buildHosts(h1, ['reddit.com', 'x.com'])
  assert.equal((h2.match(/Spawncamp start/g) || []).length, 1)
  assert.ok(h2.includes('0.0.0.0 x.com') && h2.includes('0.0.0.0 reddit.com'))
  assert.ok(h2.includes('10.0.0.5 nas.local'))
})

test('buildHosts with no domains removes the block but keeps user entries', () => {
  const h2 = buildHosts(buildHosts(userHosts, ['reddit.com']), [])
  assert.ok(!h2.includes('Spawncamp start') && !h2.includes('0.0.0.0 reddit.com'))
  assert.ok(h2.includes('127.0.0.1 localhost') && h2.includes('10.0.0.5 nas.local'))
})

// ---- psq / buildPsScript hardening (PRD 1.3) ----

test('psq doubles embedded single quotes', () => {
  assert.equal(psq("C:\\Users\\O'Brien\\x"), "C:\\Users\\O''Brien\\x")
  assert.equal(psq('no quotes'), 'no quotes')
})

test('buildPsScript fails fast and escapes quoted paths', () => {
  const s = buildPsScript("C:\\Users\\O'Brien\\staged", 'C:\\hosts', true)
  assert.ok(s.startsWith("$ErrorActionPreference = 'Stop'"))
  assert.ok(s.includes('try {'))
  assert.ok(s.includes('} catch { exit 1 }'))
  assert.ok(s.trimEnd().endsWith('exit 0'))
  assert.ok(s.includes("O''Brien")) // apostrophe path can't break the quoting
  assert.ok(s.includes('DnsOverHttpsMode'))
})

test('buildPsScript with no domains removes DoH policies instead of setting them', () => {
  const s = buildPsScript('C:\\staged', 'C:\\hosts', false)
  assert.ok(s.includes('Remove-ItemProperty'))
  assert.ok(!s.includes("Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome'"))
})

// ---- verifyHostsApplied (ground-truth parser, PRD 1.3) ----

test('verifyHostsApplied accepts a correctly written block', () => {
  const h = buildHosts(userHosts, ['reddit.com', 'x.com'])
  assert.ok(verifyHostsApplied(h, ['reddit.com', 'x.com']))
})

test('verifyHostsApplied fails when a domain is missing from the block', () => {
  const h = buildHosts(userHosts, ['reddit.com'])
  assert.ok(!verifyHostsApplied(h, ['reddit.com', 'x.com']))
})

test('verifyHostsApplied fails when the write never happened (UAC declined)', () => {
  assert.ok(!verifyHostsApplied(userHosts, ['reddit.com']))
})

test('verifyHostsApplied with no domains requires the block to be gone', () => {
  assert.ok(verifyHostsApplied(userHosts, []))
  assert.ok(!verifyHostsApplied(buildHosts(userHosts, ['reddit.com']), []))
})

test('verifyHostsApplied ignores lookalike lines outside the managed block', () => {
  const fake = userHosts + '0.0.0.0 reddit.com\r\n' // present, but not inside our markers
  assert.ok(!verifyHostsApplied(fake, ['reddit.com']))
})
