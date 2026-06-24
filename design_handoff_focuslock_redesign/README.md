# Handoff: FocusLock UI Redesign ("Launcher" direction)

## Overview
This is a full visual + interaction redesign of the FocusLock desktop app (the Electron/React renderer). It replaces the current single-scroll card grid with a **Discord/Steam-style launcher shell**: a left icon rail navigating six sections, a top bar with live status + Panic, and a streak-forward Home dashboard. It also restyles the four full-screen moments: the **unlock challenge**, **panic mode**, the **lockout/blocked takeover**, and the **onboarding wizard**.

The redesign was chosen by the product owner from three explored directions ("Launcher", "Command HUD", "Focus"). **Launcher won** — clean, familiar, professional, not kitschy.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes that show the intended look and behavior. **They are not production code to copy directly.** `*.dc.html` is a self-contained HTML prototype format; ignore the `<x-dc>` / `support.js` wrapper mechanics.

Your task is to **recreate these designs inside the existing FocusLock renderer** — `src/renderer/src/` — using its established stack: **React 18 + TypeScript**, the existing `window.api` IPC bridge (`src/preload/index.ts`), and the existing types in `src/renderer/src/types.ts`. The current presentation lives in `src/renderer/src/App.tsx`, `Onboarding.tsx`, `Challenge.tsx`, `Panic.tsx`, and `styles.css`. The redesign keeps **all existing behavior and data** — it changes layout, navigation, and styling only. No `window.api` method signatures change.

You may keep `styles.css` (recommended — the design is a clean rewrite of it) or migrate to CSS modules; either is fine. Do not introduce a new UI framework or component library — plain React + CSS, matching the current project.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, and interactions are all specified below and present in the prototype. Recreate the UI to match. Exact hex values and px sizes are given in **Design Tokens**.

---

## Information Architecture

The current app is one long scroll of cards. The redesign splits it into a **left icon rail** with six destinations + a persistent **top bar**. The four full-screen states render as overlays above everything.

| Rail icon | Section | Maps to current App.tsx content |
|---|---|---|
| Shield (logo, top, non-nav) | — | brand mark |
| House | **Home** | `progress-card` summary + status header + a preview of blocked apps + activity |
| Grid (2×2) | **Apps** | "Blocked apps" + "Blocked folders" cards |
| Globe | **Websites** | "Blocked websites" card |
| Calendar | **Schedule** | "Schedule" card |
| Bar chart | **Progress** | full `progress-card` stats + most-resisted + new badges |
| Sliders (bottom) | **Settings** | "Unlock challenge" + "Panic mode" + "Notifications & feedback" + protection + quit |

Top bar (always visible, right side): live **clock**, **Pause/Resume** toggle, **PANIC** button, user avatar. Left side: current section title + a contextual subtitle (e.g. Home shows "Good evening, {name}").

---

## Screens / Views

### Shell (persistent)
- **Layout**: `display:flex; height:100vh; width:100%`. Left `<nav>` rail is `width:74px; flex:none`. Right is a flex column: a `height:58px` top bar (`flex:none`) above a `flex:1; overflow-y:auto` content area.
- **Icon rail** (`background:#0a0c12; border-right:1px solid #1b1f2c; padding:16px 0; gap:6px`, column, centered):
  - **Logo mark** at top: `42×42`, `border-radius:12px`, `background:linear-gradient(150deg,#8b8bff,#5b5bf0)`, white shield icon, `box-shadow:0 6px 18px rgba(123,123,255,.5)`, `margin-bottom:12px`.
  - **Nav buttons**: `48×46`, `border-radius:12px`, transparent, centered icon. Icon stroke color `#c5c9d6`, stroke-width 2.
    - **Active state**: a `position:absolute; inset:0` pill `background:rgba(123,123,255,.16); border-radius:12px` behind the icon, plus a left accent bar `position:absolute; left:-13px; top:12px; width:3px; height:22px; border-radius:2px; background:#7b7bff`.
  - Settings button uses `margin-top:auto` to pin to bottom.
- **Top bar** (`padding:0 22px; border-bottom:1px solid #1b1f2c; background:#0f1117`, space-between):
  - Left: title `font:700 17px 'Space Grotesk'` + subtitle `13px #6b7180`.
  - Right (`gap:11px`): clock `12px 'JetBrains Mono' #565c6b`; Pause button; PANIC button; avatar `32×32` circle `linear-gradient(135deg,#404659,#262b3a)` with "M".
  - **Pause button** (default): `background:#1a1e29; border:1px solid #262b3a; color:#9aa0b0; border-radius:9px; padding:8px 14px; font:600 13px 'Space Grotesk'`, label "Pause". **When paused**: becomes filled accent gradient, label "Resume blocking".
  - **PANIC button**: `background:#ef4444; color:#fff; border:none; border-radius:9px; padding:8px 16px; font:700 13px 'Space Grotesk'; letter-spacing:.04em; box-shadow:0 4px 14px rgba(239,68,68,.4)`.

### Home
- **Purpose**: at-a-glance status + motivation; the emotional hook is the streak.
- **Layout**: centered column, `max-width:980px; margin:0 auto; padding:22px; gap:16px`.
- **Components (top → bottom):**
  1. **Status banner** (`display:flex; align-items:center; gap:20px; border-radius:16px; padding:20px 22px`).
     - Active state: `background:linear-gradient(115deg,rgba(123,123,255,.20),rgba(123,123,255,.04)); border:1px solid rgba(123,123,255,.32)`. A `54×54` rounded accent-gradient tile with a white shield-check icon; title **"Protection active"** (`font:700 19px 'Space Grotesk'`); sub `13.5px #9aa0b0` = `"{N} apps and {M} sites locked down · enforcing now"`. Right side (separated by `border-left:1px solid rgba(123,123,255,.22)`): streak number `font:700 40px 'Space Grotesk' #b9b9ff` + 🔥, then `12px #9aa0b0` `"day streak · best 21"`.
     - **Paused state** (when `state.paused`): swap to amber — `background:linear-gradient(115deg,rgba(245,158,11,.18),rgba(245,158,11,.04)); border-color:rgba(245,158,11,.4)`; pause-bars icon `#f5b042`; title **"Blocking paused"** in `#f5b042`; sub "Nothing is being blocked right now. Resume when you're ready."
  2. **Stat tiles**: 3-col grid, `gap:12px`. Each: `background:#171b26; border:1px solid #242a39; border-radius:13px; padding:15px 16px`; big number `font:700 26px 'Space Grotesk'`; label `12px #8b91a3`. Values: "34 resisted this week", "218 total blocks", "18.4h time reclaimed". (Wire to `stats.weekTotal`, `stats.totalBlocks`, and `stats.weekRuntime` summed.)
  3. **Two-column** (`grid-template-columns:1.15fr 1fr; gap:16px`):
     - **Locked apps** card: header "Locked apps" + a "Manage →" link (`#9b9bff`, navigates to Apps). Lists the first 4 blocked apps as rows: `background:#1d2230; border:1px solid #2a3142; border-radius:10px; padding:9px 11px`; a `30×30` letter-badge (initials), the name, and a mode tag pill on the right (see tag colors in tokens).
     - **This week** card: a 7-bar chart (`height:84px`, bars `linear-gradient(180deg,#9b9bff,#6b6bf0); border-radius:5px 5px 0 0`, day letters `10px #6b7180`), a divider, then "RECENT BLOCKS" (`11px uppercase #8b91a3 letter-spacing:.08em`) and 3 rows of `name` + `time #6b7180`. (Wire chart to `stats.last7`, list to `killLog`.)

### Apps
- **Purpose**: manage the app blocklist + folder blocks.
- **Layout**: `max-width:780px; margin:0 auto; padding:22px; gap:18px`.
- **Add card** (`#171b26 / #242a39, radius:14, padding:18`): title "Add an app to block", helper text, a text input (`background:#0f1117; border:1px solid #2a3142; radius:9; padding:10px 12px`) + accent **Add** button. Below, two ghost buttons "＋ Game launchers" and "＋ Running apps" (`background:#1a1e29; border:1px solid #262b3a`). Wire to `window.api.detectGames()` (modal) and `window.api.listProcesses()` (modal) exactly as today.
- **Blocked apps list**: section label "Blocked apps" (`14px #9aa0b0`), then one card per app (`#171b26 / #242a39, radius:13, padding:13px 15px`):
  - Row: `34×34` letter-badge, name (`font:600 14.5px 'Space Grotesk'`) + hint sub (`12px #8b91a3`: "Blocked 24/7" / "Follows your schedule" / "{N} min per day").
  - **Segmented mode control** (`Always | Schedule | Limit`): inline-flex, `border:1px solid #2a3142; border-radius:9px; overflow:hidden`. Active segment `background:#5b5bf0; color:#fff`; inactive `background:transparent; color:#8b91a3`. Each segment `padding:6px 12px; font:600 12px 'Space Grotesk'`. Maps to `BlockMode` `'always' | 'schedule' | 'budget'` → call `window.api.setAppMode(name, mode, …, token)` (protected; see Interactions).
  - **Remove** ✕ button: `32×32`, `background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.3); color:#fca5a5; radius:8`. Protected call → `window.api.removeApp`.
  - **Limit (budget) sub-row** (only when mode==='budget'): top border `1px solid #242a39`, shows "Daily limit", the minutes value (`font:700 13px 'JetBrains Mono' #b9b9ff`), a progress bar (`height:6px; track #0f1117; fill #f5b042` width = used/limit), and "{used}/{limit}m used". Editable minutes commit via `setAppMode(name,'budget',minutes,token)`.
- **Blocked folders**: label + helper "Blocks anything launched from inside a folder…", folder rows (folder icon + monospace path + ✕), and a dashed "＋ Add folder…" button. Wire to `pickFolder`/`addFolder`/`setFolderMode`/`removeFolder`.

### Websites
- **Layout**: `max-width:680px`. Add card: title "Block a website", helper "Works across Chrome, Edge & Firefox. Adding or removing one shows a quick Windows admin prompt.", input + accent **Block** button → `window.api.addSite(domain)`. List: rows with a globe icon (`stroke #7fb0d6`), the domain (`font:500 13.5px 'JetBrains Mono' #c5c9d6`), and a ✕ remove (protected → `removeSite`).

### Schedule
- **Layout**: `max-width:680px`. Intro line. A `Weekdays 9–5 | Custom` segmented control (same styling as the app mode segment). Then a card (`#171b26 / #242a39, radius:14, padding:8`) with **7 day rows**:
  - Each row (`padding:11px 12px; border-bottom:1px solid #1d2230`): an iOS-style **toggle** (`42×24` pill; track `#5b5bf0` on / `#2a3142` off; `18×18` white knob sliding `left:3px`↔`21px`), the day name (`38px wide, font:600 13px 'Space Grotesk'`, `#e6e8ee` on / `#8b91a3` off), and either a monospace range "09:00 — 17:00" or muted "Not blocked".
  - This is a simplified presentation of the existing `Schedule` type (`Record<string, TimeRange[]>`). Preserve the real app's full custom range editing (add/remove ranges, quick-add) — fold the existing controls into the Custom view; the per-day toggle is the at-a-glance layer on top. Persist via `window.api.setSchedule(...)`.

### Progress
- **Layout**: `max-width:880px`.
- **Streak hero** banner (accent-tinted, radius:16, padding:24): left = big streak `font:700 56px 'Space Grotesk' #b9b9ff` + 🔥 + "day streak"; right (border-left) = "Next milestone: 14-day streak" + a progress bar (`fill linear-gradient(90deg,#9b9bff,#5b5bf0)`) + helper.
- **3 stat tiles** (same style as Home).
- **Two columns**:
  - **Most resisted**: bars per app — name + count, plus a `6px` progress bar (`fill #7b7bff`, width relative to max). Wire to `stats.topApps`.
  - **Badges** (new, light gamification): 2×2 grid of badge tiles (`#1d2230 / #2a3142, radius:11, padding:12`, centered): emoji + name + status. Earned tiles full opacity with green "Earned" (`#7ee0a0`); locked tiles `opacity:.5` with muted status. Suggested badges: 🛡️ First day, 🔥 7-day streak, ⚔️ 14-day streak, 👑 30-day reset. Derive earned/locked from `stats.daysSinceStart` / streak.

### Settings
- **Layout**: `max-width:680px; gap:16px`. Cards (`#171b26 / #242a39, radius:14, padding:18`):
  1. **Unlock challenge**: title + helper "What you must type to weaken a block while it's enforcing. Friction is the feature." A segmented control `Random words | Characters | Timer` (maps to `ChallengeType`; the prototype omits "Custom text" for brevity — **keep all four** from the real app). Below, a number input + contextual label ("random words to type" / "characters to type" / "minute countdown"), plus the custom-text textarea when type==='custom'. Persist via `setChallenge`.
  2. **Stay-on protection**: title + dynamic description ("On — starts on login and relaunches itself if closed." / "Off — …") + a right-aligned toggle button. Turning **off** is a protected action (challenge). Maps to `config.protectionEnabled` / `setProtection`.
  3. **Panic mode**: helper, a minutes number input + "minute lockdown", and a "Your mantra" textarea. Persist via `setPanicConfig` (also keep the "close browsers during panic" checkbox from the real app).
  4. **Two wide buttons**: "Preview block screen" (opens the Lockout overlay — dev/preview affordance, optional in prod) and "Replay setup walkthrough" (re-runs Onboarding).
  5. **Footer row**: "Send feedback" + "Open logs" ghost buttons (`sendFeedback`/`openLogs`), and right-aligned version `font:500 12px 'JetBrains Mono' #565c6b` "FocusLock v{version}".
  - Also retain the real app's **block message** input and **Quit FocusLock** (disabled while protection on) — place in Settings.

### Overlay: Unlock Challenge (modal)
- Backdrop `rgba(6,7,12,.72)` + `backdrop-filter:blur(3px)`, centered. Card `width:min(600px,94vw); background:#171b26; border:1px solid #2a3142; border-radius:16; padding:24; box-shadow:0 24px 70px rgba(0,0,0,.55)`.
- Title "Unlock challenge" (`700 18px 'Space Grotesk'`) + context line "{label}. Type the text below exactly to continue."
- **Target text** block (`background:#0f1117; border:1px solid #242a39; radius:11; padding:14; font:500 15px/1.7 'JetBrains Mono'; user-select:none`): already-matched prefix renders **green `#5ee08f`**, remaining text **`#6b7180`**.
- A textarea (matching monospace) for input.
- **Progress bar** (`height:6px; track #0f1117; fill #5ee08f`) = matched chars / total.
- Footer: "{words} / {total} words" counter, "Never mind" ghost (cancel), and "Continue →" — **disabled (`#1a1e29` static) until the typed text exactly equals the target**, then becomes the accent gradient button.
- Maps to the existing `Challenge.tsx` flow (`startChallenge` → token). The redesign matches the current word/char/custom/timer challenge types.

### Overlay: Lockout / Blocked takeover
- Full screen `radial-gradient(circle at 50% 34%, #1a1a3a, #0a0b14 72%)`, centered text. This is what the user sees when a blocked app is caught/closed.
- `72×72` accent-gradient rounded tile with white shield-check, `box-shadow:0 10px 34px rgba(123,123,255,.55)`.
- Eyebrow `font:700 13px 'Space Grotesk'; letter-spacing:.18em; color:#9b9bff` = "BLOCKED · {APP} CLOSED".
- Headline `font:700 26px 'Space Grotesk' #fff` "Not right now. You've got this."
- Body `15px #aab0c0` with the streak woven in (bold `#b9b9ff`): "You're 12 days strong — that's real progress. Don't trade it for twenty minutes you won't remember tomorrow."
- Two buttons: accent "I'm good — close this" + ghost "Unlock anyway" (opens the challenge).

### Overlay: Panic mode
- Full screen `radial-gradient(circle at 50% 38%, #1b2440, #0a0c14 72%)`, centered.
- **Breathing circle**: `200×200` `border-radius:50%; background:radial-gradient(circle, rgba(123,123,255,.55), rgba(123,123,255,.1))` animated `transform: scale(.6)↔scale(1)` over **5s ease-in-out infinite**. "Breathe" label centered on top (`600 19px 'Space Grotesk' #fff`).
- Headline "This feeling will pass." + the user's **mantra** (`16px #b6bccc`).
- **Live countdown** `font:700 40px 'JetBrains Mono' #b9b9ff; letter-spacing:2px` (mm:ss), and "Lockdown can't be cancelled early — that's the point." Maps to existing `Panic.tsx` (`startPanic`, `panic.until`).

### Overlay: Onboarding wizard
- Full screen `#0b0d13`, centered card `width:min(620px,95vw); background:#171b26; border:1px solid #242a39; border-radius:20; padding:34`.
- **Progress dots** at top: active dot is a `22px`-wide `#7b7bff` pill, others `8px #2a3142` (transition `.2s`).
- Steps (the prototype condenses to 5; **keep the real app's 6-step copy** from `Onboarding.tsx`):
  0. Welcome (👋 emoji, warm intro).
  1. Name input.
  2. "Nice to meet you, {name}." + detected launcher checklist (rows toggle `background:rgba(123,123,255,.12); border:#5b5bf0` + a check box when selected).
  3. Block-mode choice: two big selectable cards ("Block completely" recommended / "On a schedule"), selected card gets `border:#5b5bf0; background:rgba(123,123,255,.12)`.
  4. (sites step from real app)
  5. Done (💪 emoji) → "Enter FocusLock →" finishes.
- Footer: "Back" ghost (hidden on step 0) + "Continue →" accent (or "Enter FocusLock →" on last step).

---

## Interactions & Behavior
- **Navigation**: clicking a rail icon swaps the content section; active icon shows the pill + left bar. Section title/subtitle in the top bar update. Content area fades/slides in subtly (`transform: translateY(8px) → 0` over `.35s ease`; **do not animate opacity from 0** if you screenshot-test — keep content visible throughout).
- **Protected actions** (reducing protection): removing an app, removing a site, switching a mode to a weaker one, turning off protection, "Unlock anyway", and Quit must route through the **unlock challenge** exactly as the current `protectedCall` helper does (`window.api.*(…, token)` returning `{ok:false, reason:'locked'}` → `startChallenge()` → run challenge → retry with token). The prototype demonstrates this on remove + protection-off.
- **Pause**: toggles `window.api.setPaused(!paused)`; Home banner + top-bar button reflect it.
- **Panic**: PANIC button → `window.api.startPanic()`; overlay shows live countdown derived from `panic.until`; cannot be dismissed early.
- **Add app / site**: Enter key or button; trims input; dedupes; shows a toast.
- **Toast**: top-center pill, accent gradient, `box-shadow:0 10px 30px rgba(0,0,0,.45)`, auto-dismiss ~3.2s. Use for "Blocking {x}.", "{x} removed.", etc. (mirrors the current `flash`/`notice`).
- **Polling**: keep the existing 2s `getState()` refresh loop; the top-bar clock can update on a 1s interval.

## State Management
Reuse the existing model verbatim — no new shapes needed:
- `AppState` from `types.ts` (`config`, `status`, `killLog`, `paused`, `usage`, `panic`, `stats`, `version`).
- New **UI-only** local state to add: `activeTab` (`'home'|'apps'|'sites'|'schedule'|'stats'|'settings'`) and the existing modal/overlay flags. Everything else already exists in `App.tsx`.
- All persistence goes through the current `window.api` methods (see `src/preload/index.ts` / `src/preload/index.d.ts`). **No IPC changes required.**

## Design Tokens

**Colors**
| Token | Hex | Use |
|---|---|---|
| App background | `#0f1117` | main surface |
| Rail background | `#0a0c12` | icon rail |
| Card | `#171b26` | section cards |
| Card-2 / inset | `#1d2230` | nested rows, inputs-on-card |
| Input background | `#0f1117` | text inputs / tracks |
| Ghost button | `#1a1e29` | secondary buttons |
| Border | `#242a39` | card borders |
| Border-2 | `#2a3142` | row/input borders |
| Rail divider | `#1b1f2c` | rail + topbar borders |
| Text | `#e6e8ee` | primary text |
| Text bright | `#c5c9d6` | nav icons, paths |
| Muted | `#8b91a3` | labels |
| Muted-2 | `#6b7180` / `#565c6b` | times, version, hints |
| **Accent** | `#7b7bff` | primary accent (bars, links) |
| Accent gradient | `linear-gradient(150deg,#8b8bff,#5b5bf0)` | logo, primary buttons, active segment |
| Accent solid | `#5b5bf0` | active segment fill |
| Accent text | `#b9b9ff` / `#9b9bff` | streak number, links |
| Danger | `#ef4444` (panic) · `#fca5a5` text · `rgba(239,68,68,.12)` bg · `rgba(239,68,68,.3)` border | PANIC, remove |
| Amber (paused) | `#f5b042`, tints `rgba(245,158,11,.18/.04)` | paused state |
| Green (success) | `#5ee08f` (challenge typed) · `#7ee0a0` (earned) | progress, badges |
| App tag — Always | text `#ff8a8a`, bg `rgba(255,80,80,.13)`, border `rgba(255,80,80,.28)` | mode pill |
| App tag — Schedule | text `#b9b9ff`, bg `rgba(123,123,255,.14)`, border `rgba(123,123,255,.3)` | mode pill |
| App tag — Limit | text `#ffce7a`, bg `rgba(255,180,60,.13)`, border `rgba(255,180,60,.28)` | mode pill |

App letter-badge colors: Steam `#1b2838/#6aa3d6`, Epic `#2a2030/#cf9ad6`, Battle.net `#202a2a/#7fc7c0`, Xbox `#1f2a20/#8ccf8a`, Riot `#2a2222/#d68a8a`, default `#232838/#9aa0b0` (`bg/text`).

**Typography**
- Display / headings / UI labels: **Space Grotesk** (400–700). Weights used: 600 (labels/buttons), 700 (titles, stat numbers, streak).
- Monospace data (paths, domains, clock, countdown, challenge text, version): **JetBrains Mono** (400/500/700).
- Body fallback: system-ui / 'Segoe UI' (it's a Windows app). Load Space Grotesk + JetBrains Mono via Google Fonts or bundle locally.
- Key sizes: page titles 17px/700; card titles 14–15px/600; body 13–14px; helper/muted 12–13px; stat numbers 26px/700; streak hero 40–56px/700.

**Spacing**: page padding 22px; card padding 13–18px; grid/list gaps 8–16px; section gaps 16–18px.

**Radii**: cards 13–16px; rows/inputs/buttons 9–11px; pills/tags 6px; nav/logo tiles 12px; toggles/avatars 50%.

**Shadows / effects**: accent glow `0 6px 18px rgba(123,123,255,.5)` (logo) / `0 8px 22px rgba(123,123,255,.4)` (primary buttons); modal `0 24px 70px rgba(0,0,0,.55)`; toast `0 10px 30px rgba(0,0,0,.45)`; PANIC `0 4px 14px rgba(239,68,68,.4)`. Challenge backdrop uses `backdrop-filter:blur(3px)`.

**Animations**: breathing circle `scale(.6)↔scale(1)` 5s ease-in-out infinite; section enter `translateY(8px)→0` .35s ease; toggle knob `left` .15s; progress bars `width` .1–.3s.

## Assets
- **Icons** are simple inline stroke SVGs (shield, house, 2×2 grid, globe, calendar, bar chart, sliders, folder, pause-bars, shield-check). Recreate with your icon set (e.g. Lucide: `shield`, `home`, `layout-grid`, `globe`, `calendar`, `bar-chart-2`, `sliders-horizontal`, `folder`, `shield-check`) or keep the inline SVGs from the prototype.
- **App logos** are currently **letter-badge placeholders** (e.g. "ST" for Steam). Replace with real launcher logos if you have licensed assets; otherwise keep the colored letter badges.
- **Emoji** (🔥 streak, 👋💪 onboarding, badge glyphs) are used intentionally and lightly — keep or swap for icons per your preference.
- Fonts: Space Grotesk + JetBrains Mono (Google Fonts).

## Screenshots
Reference renders of every screen and overlay are in `screenshots/`:
| File | Shows |
|---|---|
| `01-home.png` | Home dashboard (status banner, streak, stat tiles, locked apps, weekly chart) |
| `02-apps.png` | Apps section (add card, blocked apps with mode segments + limit bar, folders) |
| `03-websites.png` | Websites section (add + blocked list) |
| `04-schedule.png` | Schedule section (segmented preset + 7 day toggles) |
| `05-progress.png` | Progress (streak hero, milestone bar, stat tiles, most-resisted, badges) |
| `06-settings.png` | Settings (challenge, protection, panic, actions) |
| `07-challenge.png` | Unlock challenge modal (mid-type, green match + progress) |
| `08-lockout.png` | Lockout / blocked takeover |
| `09-panic.png` | Panic mode (breathing circle + countdown) |
| `10-onboarding-welcome.png` | Onboarding step 0 (welcome) |
| `11-onboarding-launchers.png` | Onboarding launcher picker step |

## Files
- `FocusLock.dc.html` — the **full interactive redesign** (all six sections + four overlays). This is the primary reference. Open it in a browser to click through every state.
- `FocusLock Directions.dc.html` — the original 3-direction comparison (Launcher / HUD / Focus). Included for context; **"Launcher" is the chosen direction** and is what `FocusLock.dc.html` builds out.
- Target files to modify in the codebase: `src/renderer/src/App.tsx`, `Onboarding.tsx`, `Challenge.tsx`, `Panic.tsx`, `styles.css`. Data contracts: `src/renderer/src/types.ts`, `src/preload/index.d.ts`.
