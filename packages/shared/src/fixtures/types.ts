// FixtureSyncProvider — the swappable boundary between "wherever fixture
// data comes from" and scripts/sync-fixtures.ts, which writes the result
// into Firestore via the Admin SDK (same rules-bypass path
// scripts/seed-emulator.ts already uses; the client-side fixtures write
// rule requires a competitionAdmins grant, but the Admin SDK ignores rules
// entirely).
//
// Deliberately zero Firebase deps (like packages/shared/src/seed/data.ts) —
// this is plain data, so it runs identically whether the caller is Node
// (the sync script) or, in principle, a test. kickoffAt is an ISO-8601
// string rather than a Firestore Timestamp for the same reason; the caller
// converts it to a Timestamp only at the point of writing.
//
// See docs/architecture-v1.md §8 for the full design (why GitHub Actions
// cron, the idempotency guarantee, the emulator-vs-real conditional), and
// docs/architecture-v1-amendment-livescore.md for the LIVE status + the
// schedule-aware, quota-bounded live-sync design this interface supports.

/**
 * LIVE was added by the live-score amendment: a match currently being
 * played, with a running (not yet final) score. Mirrors
 * `FixtureStatus` in packages/shared/src/firestore/types.ts.
 */
export type FixtureSyncStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED';

/** One fixture's current state, as reported by an upstream fixture-data source. */
export interface FixtureUpdate {
  fixtureId: string;
  competitionId: string;
  homeTeam: string;
  awayTeam: string;
  /** ISO-8601 instant. Caller converts to a Firestore Timestamp when writing. */
  kickoffAt: string;
  status: FixtureSyncStatus;
  /** null while SCHEDULED; a running (LIVE) or final (FINISHED) tally otherwise. */
  homeScore: number | null;
  /** null while SCHEDULED; a running (LIVE) or final (FINISHED) tally otherwise. */
  awayScore: number | null;
  /** Upstream provider's own fixture ID, for future dedup/lookup. Null for the stub. */
  externalRef: string | null;
}

/**
 * Swappable-integration-stub pattern (same as `AuthProvider` in
 * packages/shared/src/auth/): call sites (scripts/sync-fixtures.ts) depend
 * only on this interface, never on a concrete provider, so swapping the
 * stub for a real one is a one-line constructor change, nothing else.
 */
export interface FixtureSyncProvider {
  /**
   * Returns this provider's current view of every fixture it knows about
   * for the given competition. Order and completeness are provider-defined
   * — the caller is responsible for diffing this against Firestore's
   * current state and applying changes idempotently (see
   * scripts/sync-fixtures.ts's `applyFixtureUpdate`).
   */
  syncFixtures(competitionId: string): Promise<FixtureUpdate[]>;

  /**
   * OPTIONAL fast path for the live-score amendment's quota-bounded design
   * (docs/architecture-v1-amendment-livescore.md §4): returns updates for
   * whatever is live RIGHT NOW across every competition in `competitionIds`,
   * via a single underlying request regardless of how many competitions are
   * passed (API-Football's `fixtures?live=all` naturally returns every
   * concurrent live match in one call — this method exists so the sync
   * script never has to call the provider once per competition just to
   * check what's live, which would multiply real API quota use). Adding
   * this as an OPTIONAL interface member (rather than changing
   * `syncFixtures`'s signature) keeps every existing implementation and
   * call site unchanged — `StubFixtureSyncProvider` simply doesn't
   * implement it, and the sync script falls back to the existing
   * per-competition `syncFixtures` loop when it's absent.
   */
  syncLiveFixtures?(competitionIds: string[]): Promise<FixtureUpdate[]>;
}
