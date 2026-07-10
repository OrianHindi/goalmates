// StubFixtureSyncProvider — re-applies the existing seed fixture data
// (packages/shared/src/seed/data.ts) instead of calling a real fixture-data
// API. There is no real API key yet (creating a football-data.org — or
// equivalent — account is a separate, later founder action), so this is
// the entire "fixture data source" for now.
//
// TODO(founder): swap in RealFixtureSyncProvider once a real fixture-data
// API key exists. The real provider would read its key from the
// FIXTURE_API_KEY env var (see docs/architecture-v1.md §8 and
// scripts/sync-fixtures.ts) — a config-only swap at the provider
// construction site in scripts/sync-fixtures.ts, no other call site
// changes, same pattern as AuthProvider's
// EmulatorDevAuthProvider -> GoogleSignInAuthProvider swap.
//
// Idempotency note: kickoffAt is recomputed relative to "now" on every
// call (same offset-from-now trick seed data already uses, so re-seeded/
// re-synced fixtures are always manually testable near kickoff). That
// means two calls to syncFixtures() a few seconds apart return slightly
// different kickoffAt values for still-SCHEDULED fixtures — this is fine
// and expected for a stub; scripts/sync-fixtures.ts's write-merge logic
// deliberately does NOT write kickoffAt back for fixtures that already
// exist in Firestore, precisely so this stub's clock-drift doesn't look
// like a reschedule on every run. See that file's `applyFixtureUpdate`.

import { SEED_FIXTURES } from '../seed';
import type { FixtureSyncProvider, FixtureUpdate } from './types';

export class StubFixtureSyncProvider implements FixtureSyncProvider {
  async syncFixtures(competitionId: string): Promise<FixtureUpdate[]> {
    const now = Date.now();
    return SEED_FIXTURES.filter((fixture) => fixture.competitionId === competitionId).map(
      (fixture): FixtureUpdate => ({
        fixtureId: fixture.fixtureId,
        competitionId: fixture.competitionId,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        kickoffAt: new Date(now + fixture.kickoffOffsetMinutes * 60_000).toISOString(),
        status: fixture.status,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        externalRef: null,
      }),
    );
  }
}
