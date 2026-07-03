# Spawncamp

A Windows app blocker built for people quitting compulsive gaming. It kills
blocked games/launchers on sight, blocks gaming websites at the hosts-file
level, and puts real friction (a typing challenge with a cooling-off cost)
between the urge and the relapse. Local-only: no accounts, no telemetry —
see [PRIVACY.md](PRIVACY.md).

**Status:** pre-release. The working plan, audit findings, and per-item
progress live in [PRD.md](PRD.md) — start there.

## Dev setup

```bash
npm i
npm run dev        # electron-vite dev with HMR
```

## Checks & build

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # node --test (runs the TS suites directly, Node 22+)
npm run build      # electron-vite build -> out/
npm run dist       # full Windows installer -> dist/
```

## Architecture (main process modules)

- `index.ts` — app lifecycle: window/tray, single-instance lock, and the three
  special launch modes (`--watchdog` guardian, `--from-task` silent start,
  `--uninstall-cleanup`).
- `engine.ts` — the 1.5s enforcement loop: process polling, kills, budget
  tracking, panic mode, unlock exemptions.
- `store.ts` / `config-logic.ts` — signed (tamper-evident) config persistence;
  the pure shape/defaults/migration logic lives in config-logic.
- `ipc.ts` — every renderer↔main call; protective actions are gated by
  `authorize()` (challenge token required while enforcing, or always in
  strict mode).
- `challenge.ts` — typing/timer challenges and short-lived unlock tokens.
- `schedule.ts` — weekly time-window logic (`sanitizeSchedule`, `getStatus`).
- `websites.ts` / `hosts-logic.ts` — hosts-file blocking + DoH-off policies
  via one elevated PowerShell call, with ground-truth verification.
- `stats.ts` / `streak.ts` — block counts, lapse days, streak math (pure,
  clock-injected in streak.ts).
- `watchdog.ts` — stay-on protection: heartbeat guardian process + the
  per-user `SpawncampGuard` scheduled task.
- `safety.ts` — guardrails: protected process list, dangerous-folder checks,
  exe-name normalization.
- `integrity.ts` — sha256 signing for tamper-evident files.

The renderer is a single React app (`src/renderer/src/App.tsx`) talking to
main exclusively through the preload bridge (`src/preload/index.ts`).

Unit tests live in `tests/` and import the pure modules directly.
