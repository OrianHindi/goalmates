# GoalMates

GoalMates is a for-fun soccer prediction league for friends — points only, no real money. Players join groups with a join code, and each group tracks one or more real competitions (World Cup 2026, Israeli Premier League) over their fixtures. Before kickoff, every player places a score prediction (a "bet") on each fixture; bets lock at kickoff and stay hidden from the rest of the group until then. Scoring is simple: 3 points for the exact score, 1 point for the right direction (win/draw/lose), 0 for wrong. A leaderboard ranks the group by total points, with exact-hit count and correct-direction count as tiebreakers and bragging rights — plus a combined leaderboard across every competition a group tracks. Fixture scores update automatically, including live in-play scores while a match is being played, with no manual entry required (an admin can still correct a score by hand as a fallback).

Mobile only (iPhone + Android via Expo/React Native) — no web app, no custom API server. The mobile app talks directly to Firebase (Firestore + Firebase Auth); Firestore Security Rules are the entire authorization boundary.

## Status: v1 complete

Everything in the original scope is built, reviewed, and merged to `main`:

- **Product spec** (`docs/product-spec-v1.md`) — screens, scoring rules, bet lifecycle, acceptance criteria.
- **Architecture** (`docs/architecture-v1.md` + two amendments) — Firestore data model, security rules, multi-competition groups, automatic live-score sync.
- **`packages/shared`** — the scoring engine, Firestore types/converters, seed data, and the swappable `AuthProvider`/`FixtureSyncProvider` interfaces.
- **`apps/mobile`** — the full Expo/React Native app: login, groups (create/join by code, up to 4 tracked competitions), fixtures (upcoming/locked/live/finished), per-competition + combined leaderboards, admin score entry.
- **Firestore security rules** (`firestore.rules`) — reviewed twice by an independent security pass, including live emulator-based attack testing (not just a read-through).
- **Automatic fixture sync** (`.github/workflows/fixture-sync.yml` + `scripts/sync-fixtures.ts`) — a GitHub Actions cron job that keeps fixture schedules and scores current, including live in-play scores, without any admin needing to enter them by hand.
- **CI** (`.github/workflows/ci.yml`) — lint, typecheck, test, build, and Firestore rules tests, all on every PR.

Everything runs entirely locally against the Firebase Emulator Suite — **zero real accounts, zero cloud spend, zero paid services** anywhere in this repo today. See "Founder actions" below for what's needed to go live.

## Local dev quickstart

```bash
# Node version is pinned in .nvmrc; pnpm is the package manager
source "$NVM_DIR/nvm.sh" && nvm use
pnpm install

# Terminal A — leave running (Firestore emulator :8080, Auth emulator :9099, UI :4000)
pnpm emulators

# Terminal B — once, after the emulators above are up
pnpm seed        # writes seeded users, competitions, fixtures (incl. one LIVE example), a demo group, and bets

# Terminal B — then, to run the mobile app
cp apps/mobile/.env.example apps/mobile/.env   # defaults already point at the local emulator
pnpm dev:mobile  # starts Expo — press `w` for web, or scan the QR code with Expo Go
```

Quality gates (same commands CI runs):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:rules   # Firestore security rules, against a real local emulator (needs JDK 21+)
```

Sign in on the login screen as any seeded user (Alice/Bob/Carol/Dave — see `packages/shared/src/seed/data.ts`); Alice is the seeded demo group's admin. The demo group ("The Founders League", join code `GM2FUN`) already tracks both seeded competitions with a mix of finished, live, and upcoming fixtures and existing bets, so the leaderboards aren't empty on first run.

**Mobile testing on a physical phone**: Expo Go on the App/Play Store lags new SDKs — this app is pinned to the newest SDK Expo Go currently supports (confirmed at build time; re-check if it's been a while). On a real device (not simulator/web), set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` in `apps/mobile/.env` to your dev machine's LAN IP instead of `127.0.0.1`, since the phone can't resolve "localhost" as your laptop.

## Architecture at a glance

- **No custom server.** The Expo app talks to Firestore directly via the Firebase JS SDK. There's deliberately no Next.js/Express/Cloud Functions layer — see `docs/architecture-v1.md` §0 for why (this app has nothing a server would do that Firestore + security rules + a client-computed leaderboard can't do at friends-scale, and Cloud Functions require the paid Blaze plan, which this project avoids entirely).
- **Firestore Security Rules are the authorization boundary** (`firestore.rules`) — group membership, bet ownership, the pre-kickoff bet-privacy guarantee, and admin-only fixture score entry are all enforced there, not in application code. Reviewed twice, with live emulator attack-testing (see `packages/shared/src/firestore-rules/*.test.ts`).
- **Swappable-integration-stub pattern**, used twice: `AuthProvider` (an emulator-backed dev implementation today; real Google Sign-In drops in later as pure config) and `FixtureSyncProvider` (a seeded stub today; `RealFixtureSyncProvider` for API-Football already exists in code, gated behind an API key that doesn't exist yet).
- **Automatic fixture sync without a server**: a GitHub Actions workflow on a 10-minute cron checks Firestore (for free) to see whether anything is currently in its live window, and only spends real API-Football quota (100 requests/day on the free tier) when something actually is — see `docs/architecture-v1-amendment-livescore.md` for the full budget math.

## Founder actions

Everything below is real, external-account-creation and configuration work — the kind of thing no agent should do unilaterally. Nothing in this list blocks using the app locally today; it's what's needed to go from "works on the emulator" to "works for real, for the founder and friends."

1. **Create a real Firebase project** (Firestore + Authentication enabled), and:
   - Add its config values to `apps/mobile/.env` (`EXPO_PUBLIC_FIREBASE_*`, see `apps/mobile/.env.example`) and set `EXPO_PUBLIC_USE_FIREBASE_EMULATOR=false`. This is a config-only change — no app code changes.
   - Enable Google Sign-In in the Firebase console and wire up `GoogleSignInAuthProvider` (the `AuthProvider` interface already exists in `packages/shared/src/auth/`; only the emulator-backed dev implementation has been built so far).
   - Create a service-account key and add it as the `FIREBASE_SERVICE_ACCOUNT` GitHub Actions secret, so `fixture-sync.yml`'s real-project path (already written, currently unused) can write to it.

2. **Create an api-sports.io (API-Football) account** for real, automatic fixture data including live in-play scores. Add the key as the `FIXTURE_API_KEY` GitHub Actions secret. `RealFixtureSyncProvider` (`packages/shared/src/fixtures/real-provider.ts`) is already written against this provider's documented API — its exact field-mapping should be double-checked against a real response the first time it runs for real (commented clearly in that file where assumptions were made without a live key to test against).

3. **Re-enable the `Fixture Sync` GitHub Actions workflow.** It's currently `disabled_manually` (a deliberate, founder-made call, unrelated to any bug) — re-enable it via the repo's Actions tab when ready. Until a real Firebase project + API key exist (items 1-2), its scheduled runs are a harmless emulator dry-run proving the sync logic still works; once both exist, the same workflow automatically starts doing the real thing with zero code changes.

4. **Open product questions, tracked but not decided** (see `docs/product-spec-v1.md`'s "Open questions" section for full wording):
   - Can a member leave a group, or can the admin remove one? What happens to their leaderboard row if so? (PM lean, not yet built: allow leave, keep the row visible but greyed out.)
   - If a fixture's kickoff time changes (a reschedule) after members have already bet on it, should their bets be kept as-is, or should members be warned? (Not yet resolved — no reschedule-handling exists today; `kickoffAt` is immutable at the rules layer, so this would need a deliberate design decision, not just a code change.)

5. **Known, accepted limitations** (each already flagged in code/docs, not bugs, but worth the founder's awareness):
   - "My groups" is a **per-device** local index (AsyncStorage), not synced across devices — a reinstall or a second device starts empty, though re-joining via the group's join code recovers access fully. A real fix needs a schema/rules change (e.g. a `userId` field on membership docs enabling a proper query) — flagged in the mobile app's PR notes as a deliberate scope trim, not an oversight.
   - The original mockup's "has bet / no bet" indicator for other members' bets pre-kickoff was dropped from the shipped app: Firestore rejects the underlying query outright (rather than partially filtering it) whenever it can't prove privacy for every possible match, so there's no cheap way to show "someone has bet" without also being able to show what they bet. The actual privacy guarantee (bet **values** never leak pre-kickoff) is intact and independently verified twice; only the lighter-weight "has bet" hint is missing. A real fix needs a new, separately-scoped `hasBet` flag with its own rule.
   - `competitionAdmins` grants are never revoked (no "leave group"/"remove admin" flow exists yet) — accepted for v1 (no money, friends-scale), but flagged to fix the moment a leave/remove feature is built (the fix is a corresponding grant deletion, not a rules change).
   - Fixtures have no audit trail (`updatedBy`) for who corrected a score — a cheap addition later if it ever matters.

## Team & process

This project was built by an orchestrated team of specialist agents (`.claude/agents/`) coordinated by a `big-boss` session, following the same pattern as the sibling BinyaniApp project: dedicated branch/worktree per task, PR into `main` reviewed by the coordinating session (agents never self-merge), no cloud spend or account signups by any agent, and a mandatory security review for anything touching authorization or privacy. See `CLAUDE.md` for the full standing rules.
