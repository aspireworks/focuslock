import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDangerousFolder, PROTECTED_PROCESSES, type SafetyEnv } from '../src/main/safety.ts'

// A fixed fake machine so results don't depend on where the tests run.
const env: SafetyEnv = {
  windir: 'C:\\Windows',
  userProfile: 'C:\\Users\\Connor',
  protectedRoots: ['C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'],
  appExeDir: 'C:\\Users\\Connor\\AppData\\Local\\Programs\\Spawncamp'
}

const dangerous = (p: string): boolean => isDangerousFolder(p, env) !== null

test('drive roots are refused', () => {
  assert.ok(dangerous('C:\\'))
  assert.ok(dangerous('D:\\'))
  assert.ok(dangerous('c:'))
})

test('Windows folder, its ancestors and its subfolders are refused', () => {
  assert.ok(dangerous('C:\\Windows'))
  assert.ok(dangerous('C:\\WINDOWS\\'))
  assert.ok(dangerous('C:/Windows'))
  assert.ok(dangerous('C:\\Windows\\System32'))
})

test('user profile and its ancestors are refused; subfolders are fine', () => {
  assert.ok(dangerous('C:\\Users\\Connor'))
  assert.ok(dangerous('C:\\Users'))
  assert.equal(isDangerousFolder('C:\\Users\\Connor\\Games', env), null)
})

test('Program Files / ProgramData roots are refused; subfolders are fine', () => {
  assert.ok(dangerous('C:\\Program Files'))
  assert.ok(dangerous('C:\\Program Files (x86)'))
  assert.ok(dangerous('C:\\ProgramData'))
  assert.equal(isDangerousFolder('C:\\Program Files\\Steam', env), null)
  assert.equal(isDangerousFolder('C:\\Program Files (x86)\\Steam', env), null)
})

test("Spawncamp's own folder and its ancestors are refused", () => {
  assert.ok(dangerous('C:\\Users\\Connor\\AppData\\Local\\Programs\\Spawncamp'))
  assert.ok(dangerous('C:\\Users\\Connor\\AppData'))
})

test('ordinary game folders are allowed', () => {
  assert.equal(isDangerousFolder('D:\\Games', env), null)
  assert.equal(isDangerousFolder('D:\\SteamLibrary\\steamapps\\common', env), null)
})

test('protected process list covers the critical names', () => {
  for (const name of ['explorer.exe', 'lsass.exe', 'spawncamp.exe', 'electron.exe']) {
    assert.ok(PROTECTED_PROCESSES.has(name), name)
  }
})
