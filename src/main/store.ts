import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_CONFIG, migrate, type Config } from './config-logic'
import { flagTamper, signValue, verifySigned } from './integrity'

// The shape, defaults, and migrate() live in config-logic.ts (pure, unit-tested).
// This module owns the on-disk lifecycle: signed persistence + the in-memory cache.
export * from './config-logic'

let configPath = ''
let cache: Config = structuredClone(DEFAULT_CONFIG)

function load(): Config {
  try {
    if (existsSync(configPath)) {
      // Strip a UTF-8 BOM if some editor added one — JSON.parse chokes on it.
      let text = readFileSync(configPath, 'utf-8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      const raw = JSON.parse(text) as Record<string, unknown> | null
      if (raw && typeof raw === 'object' && ('sig' in raw || 'config' in raw)) {
        // Signed shape { config, sig }. Invalid sig: still honor the file (user
        // agency), but flag it — the tamper costs a lapse and shows a banner.
        if (!verifySigned(raw.config, raw.sig)) flagTamper('config.json')
        return migrate(raw.config)
      }
      // Legacy unsigned shape — valid once; it gets signed on the next persist.
      return migrate(raw)
    }
  } catch (e) {
    console.error('[store] failed to read config, using defaults:', e)
  }
  return structuredClone(DEFAULT_CONFIG)
}

function persist(): void {
  try {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({ config: cache, sig: signValue(cache) }, null, 2),
      'utf-8'
    )
  } catch (e) {
    console.error('[store] failed to write config:', e)
  }
}

/** Must be called after app is ready (needs userData path). */
export function initStore(): void {
  configPath = join(app.getPath('userData'), 'config.json')
  cache = load()
  persist()
  console.log('[store] config at', configPath)
}

export function getConfig(): Config {
  return structuredClone(cache)
}

export function updateConfig(patch: Partial<Config>): Config {
  cache = { ...cache, ...patch }
  persist()
  return getConfig()
}
