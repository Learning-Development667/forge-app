# FORGE — Handover Brief

**What it is:** "Forge" — a 90-day bodyweight challenge PWA for up to 10 named
users. Hosted on **GitHub Pages from `main`**. Repo: `learning-development667/forge-app`.
Live URL: `https://learning-development667.github.io/forge-app/`.
Keep this file updated as the project evolves.

## Working rules (also in CLAUDE.md — follow exactly)
- Work **directly on `main`**; commit **and push** after every change. Never create feature branches or PRs.
- **Never** overwrite `js/config.js` (real Firebase creds) or anything in `images/`.
- If an image path is referenced in code, assume the file exists (the user uploads them separately).
- **Increment the patch version in `index.html` on every commit** — the
  `<p class="brand-version">vX.Y.Z</p>` on the login screen. Never reset it.
- After committing, allow 60–90s for Pages to deploy.
- The user often uploads images mid-task; expect `Add files via upload` commits on
  remote — rebase onto them, never force-push.

## File structure
- `index.html` — shell: login/register/confirm/dashboard markup + script tags
  (Firebase compat SDK, Lottie player CDN, Chart.js CDN, config.js, scripts.js).
  The displayed version number lives here only.
- `js/scripts.js` — **all app logic**, one big IIFE. Screens are rendered
  dynamically into `<main class="screen">` containers via `ensureScreen(id)`.
- `js/config.js` — Firebase config constants only (populated; do not touch).
- `css/styles.css` — all styles.
- `sw.js` — service worker, **network-first**, wipes caches on activate.
- `manifest.json` — PWA manifest, start_url `/forge-app/`.
- `images/` — avatars (`mark/shelley/hayley/liisa/nikki/keith/lou/andy.png`),
  `bg-login/training/recovery/social/minimal.png`, `icon-192/512.png`,
  `fire.json` (Lottie), `form-pressup.mp4`.

## Key dates / constants (scripts.js)
- `SOFT_START` = 16 Jun 2026 (soft launch begins, no points), `POINTS_START` =
  22 Jun 2026 (points/streaks begin, banner disappears), `CHALLENGE_START`
  (**Day 1**) = **23 Jun 2026** (Day 90 = 20 Sep). `TOTAL_DAYS` 90, `TOTAL_WEEKS` 13.
- `DEV_MODE = true` (top of scripts.js) — shows **Dev Login** + **Dev Friday Mode**
  buttons that enter as Mark (`markbrown667@gmail.com`). Set false for production;
  never remove.

## Architecture / screens
- **Single persistent top nav** (`buildNav`/`showNav(active)`/`hideNav`), fixed 60px:
  **Messages** (board), **Exercises** (dashboard), **Progress**, **Plan**, **Settings**.
  Built once and reused — not injected per screen.
- After login the **message board is the home screen** (not the dashboard).
  Warm-up/cool-down are **on-demand buttons** on the dashboard (no auto-intercepts).
- Auth: Firebase **magic link** (passwordless). `sendSignInLinkToEmail` is only
  called from `onForge` (Let's Forge) and `onRegisterSubmit`, guarded by a
  `pendingSend` dedup. Return flow uses `signInWithEmailLink` + an in-app
  email-confirm screen (no `prompt`).
- Login uses a hardcoded `TEAM` rolodex carousel (swipe-only) + Register.
  `AVATARS` map (all 8 have photos). Invite code `FORGE2026`.
- Exercises: pressups 5→50, situps 10→100, plank 20→180s, lunges 5→20 (linear).
  Weekday rest rotation; **Friday = best effort** (2-min SVG ring + Web Audio
  countdown sounds). **Bonus spin** = 10 `BONUS_EXERCISES`, once/day.
- Points engine **recomputed from logs** each load (10/log, 25 all-due, 50 Fri
  best-effort, 100 at 7-day streak, 500 at 30-day, 20 bonus; none before 22 Jun).
- **Form guides** per exercise (info "i" icon on each card; one-time intro note).
  Video area only for the 4 main exercises (Press-ups has a real video); bonus =
  text-only card.
- Progress: Chart.js best-effort line graphs (you=orange, group avg=cream,
  mood=amber right axis) + stats. Plan: overview, weekly structure, progression
  ladders, bonus list, points.

## Firestore data model
- `users/{id}`: name, email, avatar, totalPoints, currentStreak, longestStreak,
  plankPreference, reminderEnabled, reminderTime, formSeen{}, introSeen,
  warmupShownDate, cooldownShownDate, createdAt.
- `users/{id}/logs/{id}`: date (YYYY-MM-DD), exercise, repsCompleted, target,
  mood, isBestEffort, bonusExercise, createdAt.
- `messages/{id}`: userId, userName, message, timestamp.
- `activities/{id}`: userId, userName, exercise, repsCompleted, mood, reactions[], timestamp.

## Visual effects
- `.forge-laser` rotating conic-comet border (`@property --forgeAngle`, 3s, random
  per-element stagger via `--laser-delay`) on primary buttons + active cards.
- Lottie **fire tiles** (`images/fire.json`, 60px tiles) along button bottoms.
- `state.user` / `state.logs` are the cached source of truth all screens read from.

## Read-efficiency measures (don't regress)
- `loadUsers` reads once/session (`usersLoaded`). Board onSnapshot listeners
  (messages/activities/squad collection-group) **subscribe once and persist**
  across navigation; torn down only on sign-out. Progress cross-user best-effort
  query cached with a 5-min TTL.

## Known caveats / server-side setup still needed
- Name repair (`ensureUserDoc`) uses Firebase **displayName** to fix email-username
  names — works for dev login; a real magic-link user with no displayName + bad
  stored name can't be auto-resolved.
- Needs **Firestore security rules** + likely a **collection-group index** on
  `logs` (date / isBestEffort).
- `@property` is required for the laser animation (modern browsers only). iOS
  silent switch can't be detected for the Web Audio sounds.
