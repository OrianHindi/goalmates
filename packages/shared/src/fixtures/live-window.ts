// isWithinLiveWindow — the Firestore-only, zero-API-cost check that makes
// the fixture sync schedule-aware (docs/architecture-v1-amendment-livescore.md
// §4). scripts/sync-fixtures.ts runs this against every SCHEDULED/LIVE
// fixture it already has in Firestore, on every 10-minute cron tick, BEFORE
// ever deciding whether to call the real (rate-limited) fixture-data API.
// Only when this returns true for at least one fixture does the script
// spend any API quota that run — the vast majority of ticks return false
// for everything and exit having made zero external calls.
//
// Deliberately a pure function (no Firebase deps, no Date.now() default) so
// it's trivially unit-testable and so callers control "now" explicitly
// (avoids the flaky-test trap of a function that silently reads the real
// clock).

/**
 * How long after kickoff a fixture is still considered "possibly live" for
 * the purpose of deciding whether to spend API quota checking it. Covers a
 * regulation 90 minutes + half-time + generous stoppage time, and extra
 * time + penalties for a knockout-stage match that goes the distance.
 * (docs/architecture-v1-amendment-livescore.md §4: "kickoffAt through
 * kickoffAt + 2.5h".)
 */
export const LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000;

/**
 * True from the moment of kickoff until `LIVE_WINDOW_MS` after it. Before
 * kickoff (including a `SCHEDULED` fixture whose kickoff hasn't arrived
 * yet) this is false — nothing to check yet. After the window closes this
 * is also false, even if the fixture is still (incorrectly, or because the
 * finish-confirmation call hasn't landed yet) marked LIVE in Firestore —
 * a stuck LIVE fixture past its window falls back to being caught by the
 * ordinary per-competition sync pass rather than burning live-check quota
 * on it forever.
 */
export function isWithinLiveWindow(kickoffAt: Date, now: Date): boolean {
  const kickoffMs = kickoffAt.getTime();
  const nowMs = now.getTime();
  return nowMs >= kickoffMs && nowMs <= kickoffMs + LIVE_WINDOW_MS;
}
