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
// cron, the idempotency guarantee, the emulator-vs-real conditional).

export type FixtureSyncStatus = 'SCHEDULED' | 'FINISHED';

/** One fixture's current state, as reported by an upstream fixture-data source. */
export interface FixtureUpdate {
  fixtureId: string;
  competitionId: string;
  homeTeam: string;
  awayTeam: string;
  /** ISO-8601 instant. Caller converts to a Firestore Timestamp when writing. */
  kickoffAt: string;
  status: FixtureSyncStatus;
  /** null until FINISHED. */
  homeScore: number | null;
  /** null until FINISHED. */
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
}
