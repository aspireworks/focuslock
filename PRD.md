# Spawncamp — Pre-Publish Fix & Feature Plan (working PRD)

> **How to use this document**
> Every item below is a checkbox. As work is completed, the box is checked, a
> **Status** line is added with the date and the commit hash, and any deviation
> from the spec is noted there. Nothing gets deleted — completed items stay as a
> record of what was done and why.
>
> - `[ ]` = not started · `[~]` = in progress (noted in Status) · `[x]` = done and verified
> - IDs (1.1, 1.2 …) are stable — refer to items by ID.
> - The letter codes (A1, B3 …) map back to the original audit report from 2026-07-03.
>
> **Release gate:** v1.0 must not ship publicly until **every item in Phases 1–3**
> is checked. Phases 4–5 are post-launch (or pre-launch if time allows).

---

## Phase 1 — Correctness & safety bugs

These are actual defects. Fix in order; each is small and self-contained.

---

### 1.1 `[x]` Make "Unlock anyway" actually unlock something (audit A1)

**Status:** Done 2026-07-03, commit `5e95a98`. Implemented as specced, verified
end-to-end with an automated UI drive of the built app (kill → lockout →
challenge → 5-min exemption honored → survives app restart → panic kills
despite exemption → expiry kills again and re-arms the lockout). Deviation:
exemptions are also honored in the **folder-block** kill path (matched by exe
name) — folder-caught apps show the same lockout/unlock flow, so without this
the unlock would still be a dead end for them; not covered by step 3's wording.

**Problem:** Completing the typing challenge from the lockout screen throws the
earned token away (`src/renderer/src/App.tsx` → `unlockBlocked`). No exemption
mechanism exists in the main process, so the game is killed again on next launch
and the lockout reappears. The app's centerpiece flow is a dead end.

**Design decision:** A successful unlock grants that one app a **temporary
exemption** (default 15 minutes, min 5 / max 60, configurable in Settings →
Unlock challenge). It counts as a lapse (breaks the streak) — the honest cost.

**Steps:**
1. In `src/main/engine.ts`, add an exemptions map: `Record<string /*lowercased exe*/, number /*expiry epoch ms*/>`.
   Persist it to `exemptions.json` in userData (same read/write pattern as `panic.json`) so an app crash/restart doesn't cut a granted break short.
2. Add `exemptApp(name: string, minutes: number)` — sets expiry, persists, logs. Add `getExemptions()` for the UI.
3. In `tick()`, before deciding `shouldKill` for a blocklist app, skip the kill if `exemptions[key] > Date.now()`. Purge expired entries. When an exemption expires, re-arm the lockout (`lockoutArmed[key] = true`) so the next launch pops the takeover again.
4. Panic overrides exemptions: during panic, ignore the exemptions map entirely.
5. New IPC handler in `src/main/ipc.ts`: `exempt-app (name, token)` → requires `isValidToken(token)` (and refuses during panic), clamps minutes from `config.challenge.exemptMinutes` (new config field, default 15), calls `exemptApp`, calls `recordLapse()`, returns updated state.
6. Add `exemptMinutes` to `ChallengeConfig` in `src/main/store.ts` (+ migrate default 15, clamp 5–60 in `set-challenge`), mirror in `src/renderer/src/types.ts`, add the input to Settings → Unlock challenge card.
7. Renderer (`App.tsx`): change `unlockBlocked` so that after the challenge resolves with a token, it calls `window.api.exemptApp(blockedAppExe, token)`. **Note:** the lockout currently only receives the pretty name — thread the raw exe name through `setBlockedApp` (store both pretty and raw).
8. UI feedback: after a successful exemption, toast "`{app}` unlocked for 15 minutes — this breaks today's streak." Show a countdown chip on that app's row in the Apps tab and on the Home locked-apps list while exempt.
9. Update `Lockout.tsx` confirmation copy to state the real consequence: "Continuing opens the unlock challenge. Completing it gives you 15 minutes of access and resets your streak."

**Done when:** With an app blocked "Always", launching it → lockout → Unlock anyway → challenge completed → the app can be launched and stays open for 15 minutes; the streak shows 0; after expiry the app is killed again and the lockout re-appears; restarting Spawncamp mid-exemption preserves it; panic kills the app despite an exemption.

---

### 1.2 `[x]` Guardrails on blockable folders and processes (audit A2)

**Status:** Done 2026-07-03, commit `704eac3`. Verified live: adding
`explorer.exe` from the Apps tab shows the error toast and adds nothing; `C:\`,
`C:\Windows`, `C:\Windows\System32`, `C:\Program Files`, and `%USERPROFILE%`
are all rejected through the real IPC path while `C:\Program Files\SomeGame`
is accepted; the running-apps picker lists no protected processes. 7 unit
tests pass via the new `npm test` (node:test, runs the TS directly on Node
22). Deviations (all stricter than spec): subfolders *inside* `%WINDIR%` and
ancestors of `%USERPROFILE%` (e.g. `C:\Users`) are also refused; bare `C:`
(drive-relative form) is treated as a drive root.

**Problem:** Blocking `C:\` or `C:\Windows` kills every user process — including
Windows Explorer and Spawncamp itself. The running-apps picker also lets users
block critical system processes by name.

**Steps:**
1. New module `src/main/safety.ts`:
   - `isDangerousFolder(path: string): string | null` — returns a human-readable reason, or null if safe. Refuse: any drive root (`X:\`), `%WINDIR%` and anything above it, `%USERPROFILE%` itself (subfolders fine), `%ProgramFiles%` / `%ProgramFiles(x86)%` / `%ProgramData%` **roots** (subfolders fine), and any folder that contains Spawncamp's own executable (`path.dirname(process.execPath)` or an ancestor of it).
   - `PROTECTED_PROCESSES: Set<string>` — at minimum: `explorer.exe, svchost.exe, csrss.exe, winlogon.exe, wininit.exe, services.exe, lsass.exe, smss.exe, dwm.exe, taskhostw.exe, sihost.exe, ctfmon.exe, conhost.exe, runtimebroker.exe, spawncamp.exe, electron.exe`.
2. `ipc.ts` → `add-folder`: reject with `{ ok:false, error: reason }` when dangerous. `add-app` (and the onboarding apps loop): reject protected names with a clear error. Renderer: surface these errors via the existing `flash()` toast.
3. Engine-side safety net (defense in depth, in `engine.ts`): never kill a pid equal to `process.pid`; never kill a process whose name is in `PROTECTED_PROCESSES`; in the folder-block path, never kill a process whose path is under `%WINDIR%`.
4. Filter `PROTECTED_PROCESSES` out of the "Running apps" picker list (`listRunningApps`).

**Done when:** Attempting to add `C:\`, `C:\Windows`, or `explorer.exe` shows a clear error and adds nothing; a folder rule that somehow matches a Windows process results in no kill (verified via log); unit tests cover `isDangerousFolder` cases.

---

### 1.3 `[x]` Verify hosts writes actually applied; harden the elevated script (audit A3 + D-quoting)

**Status:** Done 2026-07-03, commit `b9fb3dd`. Pure logic moved to
`src/main/hosts-logic.ts` (starts 3.6's restructuring early);
`scripts/test-hosts.cjs` ported into `tests/hosts.test.ts` and deleted —
14 hosts tests incl. the verification parser (UAC-declined, missing-domain,
lookalike-line-outside-block, and clear cases) all pass. **Needs one manual QA
step (do this before relying on it):** add a site, decline the UAC prompt, and
confirm the error toast appears and the site is NOT saved — the accept path
should behave as before. Also on the 3.7 checklist.

**Problem:** If the user declines the UAC prompt — or `Copy-Item` fails — the
elevated PowerShell can still exit 0, so `applyHosts` reports success and the
site is saved to config without ever being blocked. Separately, userData paths
containing an apostrophe (username like `O'Brien`) break the single-quoted
PowerShell strings.

**Steps:**
1. In `src/main/websites.ts` → `buildPsScript`: first line `$ErrorActionPreference = 'Stop'`; wrap the body in `try { … } catch { exit 1 }`; end with `exit 0`.
2. In the outer wrapper command: wrap `Start-Process -Verb RunAs … -ErrorAction Stop` in `try/catch`, `exit 1` in the catch (catches UAC decline), and `exit $p.ExitCode` only on success.
3. Escape embedded single quotes in all interpolated paths by doubling them (`'` → `''`) — add a tiny `psq()` helper used for `staged`, `scriptPath`, and inside `buildPsScript`.
4. **Ground-truth verification** (the real fix): after `execAsync` returns, re-read `C:\Windows\System32\drivers\etc\hosts` from Node and confirm (a) the managed markers exist iff `domains.length > 0`, and (b) every requested domain appears as a `0.0.0.0` line inside the managed block. If verification fails, return `{ ok:false, error: 'Windows didn't allow the change — the admin prompt may have been declined.' }`.
5. Extend `scripts/test-hosts.cjs` (or the Phase 3.6 test suite) with a verification-parser test.

**Done when:** Declining UAC when adding a site shows the error toast and the site does **not** appear in the blocked list; accepting UAC works as before; a simulated `Copy-Item` failure is reported as failure.

---

### 1.4 `[x]` Validate schedules everywhere; make the engine unbrickable (audit A4)

**Status:** Done 2026-07-03, commit `8c10291`. Verified live: seeded
`config.json` with `"schedule": {"1": "garbage", "2": 42, ...}`, launched the
app — UI loads, notepad.exe (Always) still killed, and the persisted config
comes back sanitized. 7 new unit tests. Deviation: instead of try/catching the
two call sites, `getStatus` itself never throws (degrades to inactive, logs
once) — this also protects `isBlockingNow`, which the spec's wording missed.
`migrate()` round-trip tests still land with the 3.6 restructuring (store.ts
imports electron, so it isn't directly unit-testable yet).

**Problem:** `migrate()` casts `r.schedule as Schedule` unvalidated, and
`set-schedule` accepts any object. A malformed schedule makes `getStatus` throw
on every tick — blocking silently stops and the UI hangs on "Loading Spawncamp…".

**Steps:**
1. Add `sanitizeSchedule(raw: unknown): Schedule` in `src/main/schedule.ts`: accept only keys `"0"`–`"6"`; each value must be an array of `{ start, end }` where both match `/^\d{2}:\d{2}$/` and parse to valid minutes; drop anything else; cap at 12 ranges/day.
2. Use it in `store.ts` → `migrate()` (replacing the cast) and in `ipc.ts` → `set-schedule` (sanitize before saving).
3. Wrap the `getStatus` calls in `get-state` and in `engine.tick()` in try/catch: on error, log once and behave as `{ active:false, nextChange:null }` — degraded but alive, and the UI still loads.
4. Unit tests: garbage schedule shapes through `migrate()` and `sanitizeSchedule` produce valid configs; `getStatus` never throws.

**Done when:** Hand-editing `config.json` to `"schedule": {"1": "garbage"}` and restarting still loads the UI and still enforces "Always" blocks.

---

### 1.5 `[ ]` Normalize app names — "Steam" must block steam.exe (audit A5)

**Problem:** The engine matches exact process names. A user who types `Steam`
gets a success toast and zero enforcement, forever.

**Steps:**
1. Add `normalizeExeName(name: string): string` (in `safety.ts` or a small util): trim; strip surrounding quotes; if it doesn't end in `.exe` (case-insensitive), append `.exe`.
2. Apply in `ipc.ts` → `add-app` and in the `complete-onboarding` apps loop, before the duplicate check.
3. One-time migration in `store.ts` → `migrate()`: normalize existing blocklist names and re-dedupe (keep the first of any collision).

**Done when:** Adding "Steam" creates a `steam.exe` entry that actually kills Steam; unit test covers `steam`, `steam.exe`, `STEAM.EXE`, `"steam.exe"`.

---

### 1.6 `[ ]` Surface website failures during onboarding (audit A6)

**Problem:** If the UAC prompt is declined during onboarding, setup completes
with "You're set" and the user falsely believes their sites are blocked.

**Steps:**
1. `ipc.ts` → `complete-onboarding`: when `applyHosts` fails, still complete onboarding but include `siteError: string` and the list of unapplied sites in the result. Stash the requested sites in a new config field `pendingSites: string[]` so they aren't lost.
2. `Onboarding.tsx` → `finish()`: read the result; if `siteError`, show a final inline warning instead of closing immediately: "Your app blocks are active, but Windows didn't allow the website blocks. You can retry from the Websites tab." with a single "Got it" button.
3. Websites tab: if `pendingSites` is non-empty, show a banner "N sites from setup aren't applied yet — [Retry now]" which calls `add-site` for each (one merged `applyHosts` call), clearing `pendingSites` on success.

**Done when:** Declining UAC during onboarding shows the warning, the Websites tab shows the retry banner, and retry + accept applies all sites in one prompt.

---

### 1.7 `[ ]` Fix the AppUserModelId mismatch so toasts work when installed (audit A7)

**Problem:** `app.setAppUserModelId('Spawncamp')` (`src/main/index.ts:15`)
doesn't match the installer's `appId` `com.spawncamp.app`. Windows ties toast
notifications to the Start-Menu shortcut's ID; a mismatch commonly makes them
silently never appear on installed builds.

**Steps:**
1. Change to `app.setAppUserModelId('com.spawncamp.app')`.
2. Verify on an actual installed build (Phase 3.7 QA): block an app, launch it, confirm the toast appears.

**Done when:** Toast notifications appear on a clean-VM installed build.

---

### 1.8 `[ ]` Close the 23:59 midnight gap (audit B6)

**Problem:** Schedule ranges are end-exclusive, so the "Every day" preset
(00:00–23:59) leaves 23:59–00:00 unblocked — one free minute per day, and a
motivated user will find it.

**Design decision:** Treat an `end` of `"23:59"` as "end of day" (minute 1440).
This is a pragmatic interpretation: nobody who sets an end of 23:59 means
"except the last minute."

**Steps:**
1. In `src/main/schedule.ts` → `isActiveAt`: when `r.end === '23:59'`, use `e = 1440`.
2. Mirror the same rule anywhere the renderer computes range validity (`src/renderer/src/types.ts` → `toMinutes` callers) so the UI and engine agree.
3. Unit test: everyday preset is active at 23:59:30.

**Done when:** With the everyday preset, a blocked app launched at 23:59 is killed.

---

### 1.9 `[ ]` Flush stats/usage on authorized quit (micro-fix found during audit)

**Problem:** `ipc.ts` → `request-quit` calls `app.exit(0)` directly, skipping
`stopEngine()` — up to ~12s of buffered usage/stats writes are lost on a normal quit.

**Steps:** Call `stopEngine()` before `app.exit(0)` in the `request-quit` handler (mirrors the tray-quit path in `index.ts`).

**Done when:** Quitting immediately after gaining budget usage persists that usage across restart.

---

## Phase 2 — Enforcement integrity

The product's promise is friction at the moment of weakness. These close the
holes that currently reduce that friction to near zero. (Full tamper-*proofing*
is impossible against an admin user on their own PC — the goal is raising the
cost, and being honest in the product copy about it.)

---

### 2.1 `[ ]` Replace the Pause button with gated, timed, auto-resuming pause (audit B1 + B2)

**Problem:** Pause is a one-click, un-gated global bypass sitting in the top
bar, and it never auto-resumes — pause-and-forget disables the blocker until
the next app restart.

**Design decision:** Pause becomes **timed only** (15 min / 1 hour / until
tomorrow), is **challenge-gated while any enforcement is active**, always
records a lapse, and auto-resumes. Instant resume stays un-gated (it only
strengthens). The old instant toggle survives only in dev builds
(`!app.isPackaged`) for testing.

**Steps:**
1. `engine.ts`: replace `paused: boolean` with `pausedUntil: number` (epoch ms, in-memory only — a restart re-arms blocking, which is the right integrity default). `isPaused()` → `Date.now() < pausedUntil`. `tick()` needs no resume logic beyond the expiry check, but should log the transition once.
2. `ipc.ts`: change `set-paused` to `pause (minutes: 15|60|'today', token?)` → gate with `authorize(token)` (panic already refuses all authorize calls); compute `pausedUntil` (for `'today'`: next local midnight); call `recordLapse()`. Add `resume` (un-gated) → sets `pausedUntil = 0`. Keep a `dev-set-paused` handler registered **only when `!app.isPackaged`**.
3. `preload/index.ts` + renderer: Pause button opens a small menu (15 min / 1 hr / Until tomorrow). Selecting one runs the existing `protectedCall` flow (challenge appears if enforcement is active). While paused, the button shows "Resumes in 42m · Resume now".
4. Home banner while paused (also fixes audit B8 copy): "App blocking paused — resumes at HH:MM. Website blocks stay on."
5. `get-state` exposes `pausedUntil` so the countdown renders.

**Done when:** Pausing while an Always-block is active requires completing the challenge; pause expires on schedule and blocking resumes without a restart; the streak resets; dev builds keep an instant toggle; packaged builds have no un-gated pause path.

---

### 2.2 `[ ]` Disable DevTools and menu accelerators in packaged builds (audit B3)

**Problem:** Ctrl+Shift+I opens DevTools in production; from the console,
`window.api.setPaused(true)` (or any protected call) is one line away.

**Steps:**
1. `index.ts` → `createWindow`: add `devTools: !app.isPackaged` to `webPreferences`.
2. When packaged, call `Menu.setApplicationMenu(null)` before window creation — removes the default menu's accelerators (DevTools, Ctrl+R reload). Keep the tray menu as-is.
3. Sanity-check that nothing relied on default accelerators (copy/paste in inputs works natively regardless on Windows — verify paste works in the Settings text fields on a packaged build; if not, attach a minimal Edit-roles menu with `visible: false` items instead of null).

**Done when:** On a packaged build: Ctrl+Shift+I and Ctrl+R do nothing; text fields still support Ctrl+C/V; dev build still opens DevTools.

---

### 2.3 `[ ]` Tamper-evident config (audit B4)

**Problem:** `config.json` / `panic.json` are plain JSON. Editing the file and
restarting silently clears blocks, panic, and protection.

**Design decision:** Tamper-**evident**, not tamper-proof (be honest about
this). A signature detects out-of-band edits; the penalty is a broken streak
plus a visible notice — the same social cost as any other lapse.

**Steps:**
1. `store.ts`: on `persist()`, compute `sig = sha256(canonicalJson(config) + APP_SALT)` (fixed salt constant; canonical = `JSON.stringify` of the config object with sorted keys) and write `{ config, sig }` as the file shape. `load()` accepts both shapes (legacy = raw config, no sig → valid once, migrated on next persist).
2. On load with a **present but invalid** sig: still load the config (user agency), but log it, call `recordLapse()`, and set a transient `tamperNotice = true` surfaced through `get-state`.
3. Renderer: when `tamperNotice`, show a one-time banner: "Your settings file was changed outside Spawncamp. Today's streak was reset."
4. Same treatment for `panic.json` (invalid sig → keep the *larger* of file value and 0 — i.e., tampering can't shorten panic, since panic can only be extended legitimately anyway: treat invalid-sig panic as expired but lapse-flag it).
5. Document in README/privacy page: "tamper-evident, not tamper-proof."

**Done when:** Hand-editing `config.json` (removing a blocked app) and restarting shows the banner and a reset streak; normal operation round-trips signatures cleanly; legacy config files migrate without a false tamper flag.

---

### 2.4 `[ ]` Scheduled-task re-arm — survive "End process tree" (audit B5)

**Problem:** One Task Manager "End task" on the tree kills main + guardian
inside the 3-second heartbeat window, and nothing brings Spawncamp back.

**Steps:**
1. New functions in `watchdog.ts`: `installGuardTask()` / `removeGuardTask()` using `schtasks` (per-user, no admin needed):
   `schtasks /Create /F /SC MINUTE /MO 1 /TN "SpawncampGuard" /TR "\"<exePath>\" --from-task"` and `/Delete /F /TN "SpawncampGuard"`. Only when `app.isPackaged`.
2. Wire into `set-protection` (install on enable, remove on challenge-gated disable) and app startup (ensure task state matches `protectionEnabled`).
3. **Silent relaunch handling:** the task fires every minute even while Spawncamp runs; the new instance hits the single-instance lock and exits — but the `second-instance` handler currently calls `showWindow()`, which would pop the window every minute. Change the handler to inspect the second instance's argv (provided as the callback's second argument) and **skip** `showWindow` when it contains `--from-task`.
4. The `--from-task` cold-start path (no instance running) must start normally but **not** show the window (start hidden to tray): check `process.argv` in `createWindow` and skip the initial `show` — add `show: false` + explicit `.show()` only for normal launches.
5. Remove the task in uninstall cleanup (3.1) and before auto-update installs (3.3 note).

**Done when:** With protection on (packaged build): killing the process tree in Task Manager → Spawncamp is back within ~60s, in the tray, without stealing focus; disabling protection removes the task (`schtasks /Query` confirms); no window flashes each minute during normal use.

---

### 2.5 `[ ]` Strict mode — optional "settings locked at all times" (audit B-5/6)

**Problem:** Outside active hours, every protective edit is free — a 2 a.m.
urge (outside a 9–5 schedule) can dismantle tomorrow's blocks without friction.

**Design decision:** Opt-in `strictMode` config flag. When on: `authorize()`
requires a valid token **always** (not just while enforcing), and pause is
unavailable entirely. Turning strict mode **on** is free; turning it **off**
requires the challenge **and** only takes effect at the next local midnight
(cooling-off), shown as "Strict mode ends tonight at midnight".

**Steps:**
1. `store.ts`: add `strictMode: boolean` (default false) + `strictModeOffAt: string` ('' or a day key). Migrate defaults.
2. `ipc.ts` → `authorize()`: if `strictMode` is effectively on, skip the `isBlockingNow()` shortcut. Add `set-strict-mode (enabled, token?)`: enabling is free and clears `strictModeOffAt`; disabling requires `isValidToken` + sets `strictModeOffAt` to tomorrow's day key (a daily check actually flips the flag — piggyback on the commitment scheduler's 30s poll or the engine tick).
3. Disable the pause UI when strict (tooltip: "Strict mode — no pausing").
4. Settings card under Stay-on protection: toggle + explanatory copy + pending-off state display.
5. Onboarding does **not** offer strict mode (too aggressive for first run) — it's discoverable in Settings.

**Done when:** With strict mode on and no blocks currently enforcing, removing an app still demands the challenge; pause is disabled; turning strict off is challenge-gated and takes effect only after midnight (verified by changing the pending state and re-checking next day / with a clock change in dev).

---

## Phase 3 — Publishing readiness

Everything here is required for a responsible public release. None of it is
optional for shipping to strangers, except 3.8.

---

### 3.1 `[ ]` Clean uninstall — restore hosts, DoH policies, task, autostart (audit C1)

**Problem:** Uninstalling currently leaves the user's machine modified: hosts
entries stay (their sites stay blocked **forever**, with the app gone), the
registry policies forcing DNS-over-HTTPS off in Chrome/Edge/Firefox persist,
the SpawncampGuard task (2.4) would keep respawning a ghost, and the HKCU Run
autostart entry lingers. This is "malware accusation in reviews" territory.

**Steps:**
1. Add a cleanup mode to the app itself — `Spawncamp.exe --uninstall-cleanup`:
   a. Set `protectionEnabled: false` in config (guardian stands down), stop watchdog, remove login item (`applyAutostart(false)`), `removeGuardTask()`.
   b. Run the existing `applyHosts([])` flow (one UAC prompt) to remove the managed hosts block **and** the DoH policies (that path already exists in `buildPsScript`).
   c. Exit 0 even on partial failure (never block uninstall), logging what failed.
2. Create `build/installer.nsh` with `!macro customUnInstall`:
   a. `nsProcess`-style kill of running `Spawncamp.exe` instances (electron-builder NSIS has `${nsProcess::KillProcess}` available via include, or use `taskkill /F /IM Spawncamp.exe /T` via `ExecWait`).
   b. `ExecWait '"$INSTDIR\Spawncamp.exe" --uninstall-cleanup'` **before** files are removed.
   c. `ExecWait 'schtasks /Delete /F /TN "SpawncampGuard"'` as a belt-and-braces repeat.
3. Wire it up in `electron-builder.yml`: `nsis.include: build/installer.nsh`.
4. Decide userData: keep it on uninstall (streak survives a reinstall — kind to relapsing users). Note this in the uninstall UI text if possible.
5. Order note: implement after 2.4 so the task removal is real.

**Done when (VM test):** Install → block sites + enable protection → uninstall → hosts file has no Spawncamp block, all three DoH policy keys are gone, `schtasks /Query` shows no SpawncampGuard, HKCU Run has no entry, no Spawncamp processes remain, blocked sites resolve again.

---

### 3.2 `[ ]` Code signing (audit C2)

**Problem:** Unsigned installers hit the SmartScreen "Windows protected your
PC" wall — most users stop there — and a process-killing, hosts-editing,
self-relaunching app is unusually prone to antivirus false positives.

**Steps:**
1. Sign up for **Azure Trusted Signing** (~$9.99/mo): Azure account → "Trusted Signing" resource → individual identity validation (needs government ID; takes days — **start this early, it's the long pole**).
2. Configure electron-builder: `win.azureSignOptions` (endpoint, certificateProfileName, code-signing account name) + `AZURE_*` env credentials. Sign both the installer and the app exe (electron-builder does both when configured).
3. Add signing to the `dist` flow but keep it skippable locally (env-gated) so dev builds don't require credentials.
4. After the first signed build: submit the installer to Microsoft's file-submission portal (Defender false-positive review) and to major AV vendors' whitelisting programs.
5. Fallback option if Azure identity validation stalls: an OV certificate from SSL.com/Sectigo (~$100–250/yr, cloud HSM). Decision recorded here when made.

**Done when:** A freshly downloaded installer on a clean VM runs with a normal publisher name shown and no red SmartScreen interstitial (a yellow "not commonly downloaded" note may persist until reputation accrues — that's expected).

---

### 3.3 `[ ]` Auto-update (audit C3)

**Problem:** No update mechanism — every shipped bug is permanent on users'
machines.

**Steps:**
1. Add `electron-updater` to dependencies. Create a **public GitHub repo used only for releases** (code can stay private); set `publish: { provider: github, owner, repo }` in `electron-builder.yml`.
2. In `index.ts` (main branch only, packaged only): configure `autoUpdater` — check on startup + every 6 hours; `autoDownload: true`; `autoInstallOnAppQuit: true`.
3. **Interplay with protection (important):** updates install on quit, but quit is gated. Policy: when an update is downloaded, show a Settings banner + tray hint "Update ready — restarts Spawncamp" with a button that calls a new `install-update` IPC → temporarily stops the watchdog + guard task, calls `autoUpdater.quitAndInstall()` (which relaunches the new version, which re-arms protection on boot). No challenge required — updating never weakens blocking.
4. Settings footer: show "v1.0.0 — up to date / update available / downloading…".
5. Test the full loop with two dummy versions (1.0.0 → 1.0.1) via a draft GitHub release before the public one.

**Done when:** A VM with 1.0.0 and protection ON detects a 1.0.1 release, updates via the banner button, relaunches as 1.0.1 with protection still on, and the guard task points at the (unchanged) install path.

---

### 3.4 `[ ]` Ship only what belongs in the installer (audit C4)

**Problem:** electron-builder's `files` list is exclusion-based, so `brand/`,
`preview/`, `design_handoff_focuslock_redesign/` (internal design docs and
screenshots) and `package-lock.json` get packaged into the app users install.
`react`/`react-dom` are also listed as production dependencies although Vite
bundles them — they get shipped twice.

**Steps:**
1. Replace `files` in `electron-builder.yml` with an explicit allow-list:
   ```yaml
   files:
     - out/**
     - package.json
   extraResources: []   # resources/tray.png is bundled via the ?asset import into out/
   ```
   (Verify the tray icon path still resolves in a packaged build — the `?asset` import copies it into `out/`; if `resources/` is needed at runtime, add it back deliberately.)
2. Move `react` and `react-dom` to `devDependencies` (renderer deps are bundled by electron-vite; only main-process runtime deps must stay in `dependencies` — currently none).
3. Build and inspect: `npx asar list dist/win-unpacked/resources/app.asar` — confirm no `brand/`, `preview/`, `design_handoff*`, `package-lock.json`.
4. Note the installer size before/after in the Status line.

**Done when:** asar listing is clean, the packaged app runs (window icon, tray icon, fonts all load), and installer size dropped.

---

### 3.5 `[ ]` Legal, docs, and identity (audit C5)

**Steps:**
1. **License:** add `LICENSE.md` — proprietary, "All rights reserved" (code stays private; the installer is freeware for now). Set `"license": "SEE LICENSE IN LICENSE.md"` in package.json.
2. **Privacy page:** `PRIVACY.md` — truthfully: all data stays on-device; no accounts, no telemetry, no network calls except the update check to GitHub. Link it from Settings footer and the website. (Update it if/when 3.8 or 4.4 add any network component.)
3. **Third-party notices:** `THIRD-PARTY-NOTICES.md` — Electron/Chromium, React, JetBrains Mono (OFL), Space Grotesk (OFL). Link from Settings footer.
4. **README.md** for the repo: what it is, dev setup (`npm i`, `npm run dev`), build (`npm run dist`), architecture map (one paragraph per main-process module), and a pointer to this PRD.
5. **Name check:** search USPTO TESS + Steam/app stores + npm/GitHub for "Spawncamp" conflicts in software. Record findings here. Buy a matching domain (e.g. `spawncamp.app`) — **before** first release, since `appId: com.spawncamp.app` is painful to change after users install (updates break across appId changes).
6. Decide the support email (currently `connor.d@mindmaven.com` in `ipc.ts:6`) — confirm or change; consider an alias like `support@spawncamp.app` once the domain exists.

**Done when:** All four files exist and are linked where stated; trademark/domain findings recorded in Status; appId confirmed final.

---

### 3.6 `[ ]` Tests, linting, CI (audit C6)

**Steps:**
1. Restructure for testability: extract pure logic into importable modules where needed (`normalizeDomain`/`buildHosts` already are; `sanitizeSchedule` (1.4), `normalizeExeName` (1.5), `isDangerousFolder` (1.2), streak math in `stats.ts` — refactor `computeStreak`/`isLapseDay` to accept injected state + "today" so tests don't depend on the wall clock).
2. Add `node:test`-based suites under `tests/` (no framework dependency needed; run with `node --test`): hosts merge/normalize (port `scripts/test-hosts.cjs`), schedule (incl. the 23:59 rule and invalid ranges), streak/lapse/best-streak, `migrate()` round-trips (legacy string[] blocklist, garbage input, tamper sig from 2.3), challenge verify + timer claim, exe-name normalization, folder-safety checks.
3. `npm test` script; delete `scripts/test-hosts.cjs` once ported.
4. ESLint 9 flat config + `typescript-eslint` + `eslint-plugin-react-hooks`; Prettier; `npm run lint`. Fix whatever it surfaces (expect minor unused-var noise only).
5. GitHub Actions workflow `.github/workflows/ci.yml`: on push/PR → `npm ci`, `typecheck`, `lint`, `test`, `build` (electron-vite build; electron-builder only on tags, unsigned in CI unless secrets present).

**Done when:** `npm test` and `npm run lint` pass locally; CI is green on the repo; the streak logic has regression coverage.

---

### 3.7 `[ ]` Release QA checklist — clean-VM matrix (audit C7)

Run this full pass before **every** public release (copy the table into the
release notes and check it off):

- [ ] Windows 11 VM, fresh: install per-user → onboarding (accept UAC) → detected launchers correct → block Steam → launch Steam → killed + toast **appears** + lockout appears
- [ ] Same VM: unlock flow end-to-end (1.1) — exemption works and expires
- [ ] Onboarding with UAC **declined** → warning shown → retry banner works (1.6)
- [ ] Windows 10 22H2 VM: repeat the install + block + toast basics
- [ ] Non-admin standard user account: install, hosts write prompts for admin credentials, everything else works
- [ ] Protection ON → Task Manager end-tree → app returns ≤60s (2.4) → uninstall still works cleanly (3.1)
- [ ] Update path: previous version + protection ON → auto-update → new version, protection intact (3.3)
- [ ] Uninstall with sites blocked + protection ON → full cleanup verified (3.1 list)
- [ ] 125% / 150% display scaling: UI usable, no clipped controls
- [ ] Non-English Windows locale (e.g. German): dates/times render, schedule works across the week boundary
- [ ] OneDrive-redirected profile: config/stats persist correctly
- [ ] Defender/SmartScreen: fresh download runs without red interstitial (3.2)
- [ ] Laptop on battery: CPU usage of Spawncamp processes idle < ~1% average over 10 min

**Done when:** This checklist is executed and recorded for the release candidate.

---

### 3.8 `[ ]` (Optional, recommended at public launch) Crash visibility decision (audit C-8)

**Decision to make:** stay with local logs + "Send feedback" mailto (current,
zero privacy cost) vs. adding opt-in Sentry crash reporting.
**Recommendation:** defer through beta; revisit at public launch. If added:
explicit opt-in toggle in Settings, disclosed in PRIVACY.md.

**Done when:** Decision recorded here with rationale.

---

## Phase 4 — Product completeness

Post-gate features, roughly in impact order for the target user (compulsive
gamers trying to quit). Each gets a fuller mini-spec when picked up.

### 4.1 `[ ]` Offer stay-on protection during onboarding (audit E2)
Final onboarding step gains a pre-checked toggle: "Protect Spawncamp from being
closed (recommended)" → enabling applies autostart + watchdog on finish. Copy
explains what it does and that turning it off later requires the challenge.
**Done when:** a fresh onboarding with defaults ends with protection ON.

### 4.2 `[ ]` Escalating challenge cost (audit E-escalation)
Track unlock-challenge completions per day; each successive unlock same-day
doubles the challenge size (words/chars ×2, timer ×2), capped at ×8. Off
switch in Settings (`escalate: boolean`, default on). Surface "next unlock will
be harder" on the lockout confirm screen.

### 4.3 `[ ]` Cooling-off removals (audit E-delay)
Alternative/addition to strict mode: optional setting so remove/weaken actions
don't apply immediately but after 24h, with a visible pending state and
cancel button. Interacts with 2.5 — design them together when picked up.

### 4.4 `[ ]` Accountability partner (audit E3)
Partner email receives: lapse events, protection-off events, weekly summary.
**Requires the first server-side component** (e.g. Cloudflare Worker +
Postmark/Resend; the app POSTs an event, the worker emails). Must update
PRIVACY.md. Spec fully before building; consider shipping the weekly summary
as a local shareable image first (zero backend) to validate demand.

### 4.5 `[ ]` Steam library auto-detection (audit E4)
Read Steam install path from `HKCU\Software\Valve\Steam` (+ default
`%ProgramFiles(x86)%\Steam`), parse `steamapps\libraryfolders.vdf`, offer each
library's `steamapps\common` as a one-click folder block in onboarding step 3
and as a banner on the Apps tab. Closes the "launch the game exe directly"
hole for Steam users. Also add copy in the games picker explaining
launcher-vs-game blocking (Epic/Xbox games run as separate processes).

### 4.6 `[ ]` Subdomain coverage for site blocks (audit B7-now part)
Hosts can't wildcard. Expand each blocked domain with a curated subdomain set
(`www`, `m`, `old`, `new`, `np`, `i`, `mobile`, `music`, `gaming` where
applicable) via a per-domain map for the big ones (youtube, reddit, twitch,
steam). UI hint: "blocks example.com and its common subdomains."

### 4.7 `[ ]` Browser extension (audit E8 / B7-future)
Chrome MV3 + Firefox extension for path-level blocking (YouTube *channels*,
subreddits), immune to hosts-file limits and DoH. Syncs its rule list from the
app via native messaging. This is the real answer to "block my YouTube
triggers" — big item, spec separately when Phase 3 is done.

### 4.8 `[ ]` New-launcher watch (audit E9)
Weekly `detectGames()` rescan in the engine; if a catalog launcher is newly
present and unblocked → toast + badge on the Apps tab ("EA app showed up —
block it?").

### 4.9 `[ ]` Emotional check-in on lockout (audit E7)
Optional 1-tap prompt on the lockout screen ("What were you about to escape
from?" — bored / stressed / lonely / habit / other). Stored locally in stats;
Progress page shows top triggers over time. Skippable, never gates anything.

### 4.10 `[ ]` Streak transparency + honest stats (audit D8/D10/E10)
Record *why* each lapse happened (pause / protection-off / played N min /
tamper) and show it on the Progress page ("Streak reset Tuesday — Steam ran 47
min"). Count "near-miss wins" (lockouts closed without unlocking). Fix
"time reclaimed" to count only **clean** days × daily hours. Show the
already-computed `weekRuntime` ("time spent in allowed windows") on Progress.

### 4.11 `[ ]` UX polish batch (audit D13/D15 + misc)
- Panic button: confirmation step ("Start a {N}-minute lockdown now? Browsers will close.") — prevents accidental slams.
- Panic overlay: make the window fullscreen + always-on-top for the duration (currently it's only an in-window overlay despite "lockdown" copy).
- Timer challenge: dismissing "Never mind" keeps the countdown running in main (`currentTimer` survives; re-opening resumes rather than resets).
- Tray menu: show current status line (Active / Paused until HH:MM / Panic) and a "Pause…" item mirroring 2.1.
- Overnight schedule ranges (22:00–06:00 as a single range; engine treats end<start as spanning midnight).
- Onboarding: validate custom site entries in the renderer with the same regex as `normalizeDomain` and show inline errors instead of silently dropping.
- Budget-mode caveat copy: launcher processes (steam.exe) idle in the background and consume budget — recommend budget mode for game exes, not launchers (until 5.6 lands).

---

## Phase 5 — Code health backlog

No user-visible behavior change; do opportunistically (5.1–5.3 ideally before
heavy Phase 4 renderer work).

### 5.1 `[ ]` Split `App.tsx` (1,788 lines) into per-tab components
`src/renderer/src/pages/{Home,Apps,Sites,Schedule,Progress,Settings}.tsx` + a
`useAppState` hook for the poll/refresh/protectedCall plumbing. Pure move —
no logic changes; verify with a full click-through afterward.

### 5.2 `[ ]` Single shared types module
`src/shared/types.ts` imported by main, preload, and renderer (electron-vite
supports this); delete the duplicated definitions in `renderer/src/types.ts`
and the `DEFAULT_COMMITMENT` duplicate. Preload API returns typed promises
instead of `as` casts.

### 5.3 `[ ]` React ErrorBoundary + unbrickable loading screen
ErrorBoundary around the app (message + "Open logs" button instead of white
screen). If `get-state` fails 3+ times, show an error state with Retry instead
of eternal "Loading Spawncamp…".

### 5.4 `[ ]` Guardian robustness (audit D1)
`startGuardianLoop` writes its heartbeat **immediately** on adoption (not 1s
later); `ensureGuardian` backs off (min 10s between spawn attempts). Prevents
duplicate ~80MB guardian processes on slow cold starts.

### 5.5 `[ ]` Poll efficiency + overlap guard (audit D3/D7)
`inFlight` flag so a slow `tasklist` never overlaps the next tick; measure and
consider 2–2.5s poll. Longer term: persistent PowerShell helper or native
module for the path query (currently a fresh PS process every 3s when folder
rules exist).

### 5.6 `[ ]` Budget counts foreground time only (audit D4)
Only accrue budget seconds when the app owns the foreground window. Needs a
cheap foreground-process probe (native call via a small addon or a helper);
spec options when picked up. Until then, 4.11's copy caveat covers it.

### 5.7 `[ ]` Renderer hardening (audit D6)
`sandbox: true` (works with contextBridge + ipcRenderer), CSP meta tag in
`index.html` (`default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`),
`will-navigate` + `setWindowOpenHandler` deny-all in main.

### 5.8 `[ ]` Renderer error capture (audit D-logging)
`window.onerror`/`unhandledrejection` → `log-renderer-error` IPC → file logger,
so beta feedback includes UI crashes.

### 5.9 `[ ]` Unify day-key helpers (audit B8-minor)
One padded `dayKey()` in shared code; `engine.ts` `todayStr()` (unpadded)
migrates to it. Note: first run after the change resets that day's usage
tally once — acceptable, mention in release notes.

### 5.10 `[ ]` Dependency hygiene
Bump Electron to latest stable before release and monthly thereafter
(Chromium security); enable Dependabot/Renovate on the repo.

### 5.11 `[ ]` Clear stale budget drafts (audit D11)
`limitDrafts` entry cleared on successful commit **and** on failed/cancelled
challenge so the input snaps back to the real value.

---

## Decisions log

Record every deviation from this spec here, dated:

- *(2026-07-03)* Document created from the full-code audit. Phases 1–3 are the
  v1.0 release gate; 4–5 are post-gate.
