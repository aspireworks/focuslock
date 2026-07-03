---
name: verify
description: Build and drive Spawncamp (Electron) end-to-end to verify a change at its real surface.
---

# Verifying Spawncamp changes

## Build & launch
1. `npm run build` (electron-vite → `out/`). The app runs from `out/` with plain electron: no dev server needed.
2. Drive with playwright-core (install once per checkout: `npm i --no-save playwright-core`):
   ```js
   const { _electron } = require('<repo>/node_modules/playwright-core')
   const electronPath = require('<repo>/node_modules/electron')
   const app = await _electron.launch({ executablePath: electronPath, args: ['.'], cwd: '<repo>' })
   const win = await app.firstWindow()
   await win.waitForSelector('.shell') // main UI loaded (onboarding skipped)
   ```
3. userData is `%APPDATA%\spawncamp`. Seed `config.json` there BEFORE launch (full Config shape — see `src/main/store.ts` DEFAULT_CONFIG). Always set:
   - `onboardingComplete: true` (else the onboarding overlay blocks everything)
   - `commitment.enabled: false` (else the morning commitment overlay may cover the UI)
   - `panic.blockBrowsers: false` (a PANIC probe must never kill the user's real browsers)
   - `protectionEnabled: false` (no watchdog/guardian respawns during tests)
   Delete the whole `%APPDATA%\spawncamp` dir in cleanup (check it didn't pre-exist with real user data first — if it did, back it up and restore).

## Driving the app
- Guinea-pig process: block `notepad.exe`, launch via `exec('start "" notepad')`, poll `tasklist /FI "IMAGENAME eq notepad.exe" /FO CSV /NH`. Engine kills within ~3s (1.5s poll). Kill leftover notepads in cleanup.
- Tab nav: `button[title="apps"|"sites"|"schedule"|...]`. Add-app: `.add-row .field` + `.add-row .btn.accent`. Toast: `.toast`. Lockout takeover: `.lockout`. Challenge: read `.challenge-target` textContent, `fill('.challenge-area', text)` — auto-submits on match.
- IPC without UI: `win.evaluate(() => window.api.xyz(...))` exercises preload+IPC+main for handlers whose UI needs a native dialog (folder picker).
- Exit: `app.evaluate(({app}) => app.exit(0))` in try/catch (window close is prevented → hides to tray; `app.close()` hangs).

## Hard limits
- Anything behind UAC (hosts writes / add-site / retry-pending-sites) pops a real elevation prompt and edits the real hosts file + HKLM — do NOT trigger; leave to manual QA (PRD 3.7).
- Single-instance lock: make sure no real Spawncamp/dev instance is running first (`tasklist | findstr /I electron`).

## Also run
`npm test` (node:test, runs `.ts` directly on Node 22) and `npx tsc --noEmit` — but these complement, never replace, driving the app.
