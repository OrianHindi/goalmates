// Periodic fixture-data sync. There is no server/Cloud Functions in
// GoalMates (see docs/architecture-v1.md §0), so this script is the "cron
// job": it's meant to be run on a schedule (currently a GitHub Actions
// workflow, .github/workflows/fixture-sync.yml) rather than continuously.
//
// It calls a FixtureSyncProvider (packages/shared/src/fixtures/) for each
// known competition and writes any changes into Firestore via the Admin
// SDK — the same rules-bypass path scripts/seed-emulator.ts already uses
// (the client-side `fixtures` write rule requires a competitionAdmins
// grant; the Admin SDK ignores security rules entirely).
//
// Provider selection (live-score amendment,
// docs/architecture-v1-amendment-livescore.md): RealFixtureSyncProvider
// (API-Football) is used ONLY when BOTH a real Firebase project is active
// (GOOGLE_APPLICATION_CREDENTIALS set) AND a real API key is present
// (FIXTURE_API_KEY set) — see the `useRealApi` check in `main()` below. In
// every other case
// (local dev, this repo's CI, or a real project with no key yet) this
// falls back to StubFixtureSyncProvider, which just re-applies the seed
// fixture data (packages/shared/src/seed/data.ts) idempotently. This is a
// hard safety rule, not just a default: emulator/CI runs must NEVER be able
// to burn real API-Football quota just because a stray env var happens to
// be set, since FIXTURE_API_KEY alone is not sufficient — it also requires
// real-project mode.
//
// TODO(founder): once a real Firebase project + FIXTURE_API_KEY both exist
// (creating an api-sports.io account is a founder action, out of scope
// here), this script automatically starts using RealFixtureSyncProvider —
// see packages/shared/src/fixtures/real-provider.ts for exactly how to test
// it, and its file header for field-mapping assumptions that should be
// re-checked against a real response the first time it runs for real.
//
// Live-window gating (docs/architecture-v1-amendment-livescore.md §4): when
// using the real provider, this script first does a Firestore-only check
// (isWithinLiveWindow, packages/shared/src/fixtures/live-window.ts) —
// nothing live right now means it exits having made ZERO calls to the
// rate-limited (100 requests/day free tier) API-Football endpoint. Only
// when something IS live does it spend exactly one request
// (`syncLiveFixtures`, which covers every tracked competition in a single
// call) — this is what keeps the approved 10-minute cron cadence inside
// budget even on a heavy matchday. In stub/emulator mode this gate is
// skipped entirely (the stub has no real quota to protect) and the
// existing full per-competition sync always runs, unchanged from before
// this amendment — so every existing test/CI behavior is preserved.
//
// --- Two target modes, chosen by environment variables --------------------
//
// 1. Emulator mode (default — used for local dev and this repo's CI, since
//    there is no real Firebase project yet):
//      - Active whenever GOOGLE_APPLICATION_CREDENTIALS is NOT set.
//      - Points the Admin SDK at the local Firestore emulator using the
//        standard FIRESTORE_EMULATOR_HOST env var (defaults to
//        127.0.0.1:8080, same as scripts/seed-emulator.ts), against the
//        placeholder project ID from .firebaserc. No credentials needed.
//      - Run it manually (after `pnpm emulators` and `pnpm seed` are up):
//          pnpm sync-fixtures
//
// 2. Real-project mode (for the future real CI run, once the founder has
//    created a Firebase project and added a service-account secret):
//      - Active whenever GOOGLE_APPLICATION_CREDENTIALS is set to a path
//        containing a service-account JSON key file. The Admin SDK reads
//        this automatically on initializeApp() with no arguments (its
//        standard "Application Default Credentials" behavior) and infers
//        the project ID from the key file itself.
//      - .github/workflows/fixture-sync.yml writes the
//        FIREBASE_SERVICE_ACCOUNT repo secret out to a temp file and points
//        GOOGLE_APPLICATION_CREDENTIALS at it for this mode — see that
//        file and docs/architecture-v1.md §8.
//
// --- Idempotency ------------------------------------------------------
//
// Safe to run every 30-60 minutes forever:
//   - A fixture that doesn't exist yet in Firestore is created.
//   - A fixture already FINISHED is never touched again by this script —
//     its score is treated as a fixed point once set (whether set by the
//     seed script, a prior sync, or a group-admin's manual in-app
//     correction). This is what "don't corrupt existing FINISHED fixtures'
//     scores" means in practice.
//   - A still-SCHEDULED fixture only gets a Firestore write if a field
//     actually differs from what's stored (see `applyFixtureUpdate`);
//     kickoffAt specifically is never overwritten by this stub (see
//     packages/shared/src/fixtures/stub-provider.ts for why).
//   - Result: running this script twice in a row against the same
//     Firestore state produces zero additional writes the second time.

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

import {
  SEED_COMPETITIONS,
  StubFixtureSyncProvider,
  RealFixtureSyncProvider,
  isWithinLiveWindow,
  type FixtureSyncProvider,
  type FixtureUpdate,
} from '@goalmates/shared';

const PLACEHOLDER_PROJECT_ID = 'goalmates-dev-placeholder'; // matches .firebaserc "default"

const usingRealProject = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);

if (!usingRealProject) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT ??= PLACEHOLDER_PROJECT_ID;
}

if (getApps().length === 0) {
  // Real mode: initializeApp() with no config picks up
  // GOOGLE_APPLICATION_CREDENTIALS + the project ID embedded in that key
  // file automatically (standard Admin SDK behavior).
  // Emulator mode: pin the placeholder project ID explicitly, same as
  // scripts/seed-emulator.ts.
  initializeApp(usingRealProject ? {} : { projectId: PLACEHOLDER_PROJECT_ID });
}

const db = getFirestore();

type ApplyResult = 'created' | 'updated' | 'unchanged' | 'skipped-finished';

interface StoredFixture {
  competitionId: string;
  homeTeam: string;
  awayTeam: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED';
  homeScore: number | null;
  awayScore: number | null;
  externalRef: string | null;
  kickoffAt: Timestamp;
}

async function applyFixtureUpdate(update: FixtureUpdate): Promise<ApplyResult> {
  const ref = db.collection('fixtures').doc(update.fixtureId);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      competitionId: update.competitionId,
      homeTeam: update.homeTeam,
      awayTeam: update.awayTeam,
      kickoffAt: Timestamp.fromDate(new Date(update.kickoffAt)),
      status: update.status,
      homeScore: update.homeScore,
      awayScore: update.awayScore,
      externalRef: update.externalRef,
    });
    return 'created';
  }

  const existing = snap.data() as StoredFixture;

  // Fixed point: never touch a fixture once it's FINISHED. Protects a
  // manually-corrected score in the app from being clobbered by a stale
  // stub/provider re-sync.
  if (existing.status === 'FINISHED') {
    return 'skipped-finished';
  }

  // kickoffAt is deliberately excluded here: StubFixtureSyncProvider
  // recomputes it relative to "now" on every call, so writing it back
  // would make every run look like a reschedule (see stub-provider.ts).
  // A RealFixtureSyncProvider reporting a genuine reschedule (an absolute
  // wall-clock change from the upstream source) should add kickoffAt back
  // into this patch, comparing update.kickoffAt against the stored
  // Timestamp instead of always skipping it.
  const patch: Partial<StoredFixture> = {};
  if (existing.homeTeam !== update.homeTeam) patch.homeTeam = update.homeTeam;
  if (existing.awayTeam !== update.awayTeam) patch.awayTeam = update.awayTeam;
  if (existing.status !== update.status) patch.status = update.status;
  if (existing.homeScore !== update.homeScore) patch.homeScore = update.homeScore;
  if (existing.awayScore !== update.awayScore) patch.awayScore = update.awayScore;
  if (existing.externalRef !== update.externalRef) patch.externalRef = update.externalRef;

  if (Object.keys(patch).length === 0) {
    return 'unchanged';
  }

  await ref.update(patch);
  return 'updated';
}

async function syncCompetition(provider: FixtureSyncProvider, competitionId: string, counts: Record<ApplyResult, number>): Promise<void> {
  const updates = await provider.syncFixtures(competitionId);
  for (const update of updates) {
    const result = await applyFixtureUpdate(update);
    counts[result] += 1;
  }
  console.log(`  ${competitionId}: ${updates.length} fixtures checked`);
}

/**
 * The Firestore-only, zero-API-cost live-window check
 * (docs/architecture-v1-amendment-livescore.md §4). Fetches every fixture
 * that's SCHEDULED or LIVE (a single-field `in` filter — no composite index
 * needed, same "index-free by construction" property architecture-v1.md §5
 * already relies on) and filters client-side with `isWithinLiveWindow`,
 * since Firestore can't express "kickoffAt + 2.5h >= now" as a query
 * predicate directly. At GoalMates' fixture volumes (a couple of
 * competitions, at most a season's worth of not-yet-finished matches) this
 * is a small, cheap read — if that ever stops being true, narrow it with a
 * composite index on (status, kickoffAt) instead of changing this logic.
 */
async function anyFixtureCurrentlyLive(now: Date): Promise<boolean> {
  const snap = await db.collection('fixtures').where('status', 'in', ['SCHEDULED', 'LIVE']).get();
  return snap.docs.some((doc) => {
    const data = doc.data() as StoredFixture;
    return isWithinLiveWindow(data.kickoffAt.toDate(), now);
  });
}

async function main(): Promise<void> {
  console.log(`Syncing fixtures (${usingRealProject ? 'real project' : 'emulator'}, project: ${process.env.GCLOUD_PROJECT ?? '(from credentials)'})`);

  const competitionIds = Object.values(SEED_COMPETITIONS).map((c) => c.competitionId);
  const useRealApi = usingRealProject && Boolean(process.env.FIXTURE_API_KEY);

  const counts: Record<ApplyResult, number> = { created: 0, updated: 0, unchanged: 0, 'skipped-finished': 0 };

  if (useRealApi) {
    // Real provider: honor the quota-bounded design exactly. Check
    // Firestore first, for free; only ever call API-Football when
    // something is actually live, and then only once (syncLiveFixtures
    // covers every tracked competition in a single request).
    const live = await anyFixtureCurrentlyLive(new Date());
    if (!live) {
      console.log('No fixture is currently in its live window — skipping this run (zero API-Football requests spent).');
      return;
    }

    const provider = new RealFixtureSyncProvider(process.env.FIXTURE_API_KEY!);
    // syncLiveFixtures is a required capability of RealFixtureSyncProvider
    // (see packages/shared/src/fixtures/real-provider.ts) — the `!` is safe
    // here, not a cast around a genuinely-optional gap.
    const updates = await provider.syncLiveFixtures!(competitionIds);
    for (const update of updates) {
      const result = await applyFixtureUpdate(update);
      counts[result] += 1;
    }
    console.log(`Live check: ${updates.length} fixtures currently live across ${competitionIds.length} competitions.`);
  } else {
    // Stub/emulator mode (including this repo's CI): no real quota to
    // protect, so run the full per-competition pass every time, exactly as
    // before this amendment. This also naturally handles the stub's
    // SCHEDULED/LIVE/FINISHED seed data (including the seeded LIVE
    // fixture, packages/shared/src/seed/data.ts) without any special-casing
    // — `applyFixtureUpdate` already treats LIVE like any other non-FINISHED
    // status: it diffs and patches whatever changed.
    const provider: FixtureSyncProvider = new StubFixtureSyncProvider();
    for (const competitionId of competitionIds) {
      await syncCompetition(provider, competitionId, counts);
    }
  }

  console.log(
    `Sync complete: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts['skipped-finished']} skipped (already finished).`,
  );
}

main().catch((err) => {
  console.error('Fixture sync failed:', err);
  process.exitCode = 1;
});
