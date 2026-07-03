import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, signValue, verifySigned } from '../src/main/integrity.ts'

test('canonicalJson sorts keys at every level', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 'x' } }),
    '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}'
  )
})

test('sign/verify round-trips regardless of key order', () => {
  const a = { blocklist: [{ name: 'steam.exe', mode: 'always' }], userName: 'C' }
  const b = { userName: 'C', blocklist: [{ mode: 'always', name: 'steam.exe' }] }
  assert.ok(verifySigned(a, signValue(a)))
  assert.equal(signValue(a), signValue(b))
})

test('verify fails when the value was edited after signing', () => {
  const cfg = { blocklist: [{ name: 'steam.exe', mode: 'always' }] }
  const sig = signValue(cfg)
  const edited = { blocklist: [] as unknown[] }
  assert.ok(!verifySigned(edited, sig))
})

test('verify fails on missing or malformed sig', () => {
  assert.ok(!verifySigned({ a: 1 }, undefined))
  assert.ok(!verifySigned({ a: 1 }, 42))
  assert.ok(!verifySigned({ a: 1 }, 'deadbeef'))
})

test('numbers sign stably (panic.json signs a bare epoch number)', () => {
  const until = 1783116000000
  assert.ok(verifySigned(until, signValue(until)))
  assert.ok(!verifySigned(until - 60000, signValue(until)))
})
