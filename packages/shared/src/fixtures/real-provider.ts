// RealFixtureSyncProvider — API-Football (api-sports.io) implementation of
// FixtureSyncProvider. See docs/architecture-v1-amendment-livescore.md for
// the full research/design: why this provider (the only free tier with
// genuine live in-play scores), the 100 requests/day budget, and the
// schedule-aware calling pattern (scripts/sync-fixtures.ts) this class is
// built to support cheaply.
//
// NOT exercised by CI or any automated test in this repo — there is no real
// API key yet (creating an api-sports.io account is a founder action, out
// of scope here; see the TODO in scripts/sync-fixtures.ts). This class
// exists purely as the swappable-stub pattern's "real" half:
// scripts/sync-fixtures.ts picks it automatically the moment FIXTURE_API_KEY
// is set AND a real Firebase project is in use (never in emulator/CI mode,
// as a hard safety rule — see that file), with zero other call-site changes,
// the same pattern as AuthProvider's dev -> real Google Sign-In swap.
//
// To test this for real once a key exists:
//   FIXTURE_API_KEY=xxxx GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//     pnpm sync-fixtures
// and watch the console output / Firestore for created/updated fixtures.
// Start by checking the console-logged raw status codes this run actually
// saw against STATUS_MAP below — API-Football's status vocabulary is
// believed stable but has not been checked against a live response.
//
// Field-mapping notes (from API-Football's public v3 docs,
// https://api-sports.io/documentation/football/v3 — NOT verified against a
// live response since no key exists; treat exact field names as a
// well-researched best effort to re-check the first time this runs for
// real, not a guarantee):
//   - Auth: header `x-apisports-key: <key>` against the direct
//     api-sports.io host (v3.football.api-sports.io) — this is the direct
//     (non-RapidAPI-gateway) integration path api-sports.io documents for a
//     plain API key from their own dashboard, which is what "no credit
//     card, free key" (architecture-v1-amendment-livescore.md §1) implies.
//   - `fixture.fixture.id`: API-Football's own numeric fixture ID. Every
//     fixture this provider creates uses `af-${apiFixtureId}` as our
//     Firestore fixtureId (stable, never collides with the seed data's
//     `wc2026-fNN` / `ipl-fNN` scheme), and also stores it in `externalRef`
//     for redundancy/debugging.
//   - `fixture.fixture.status.short`: a short status code — see STATUS_MAP.
//   - `fixture.fixture.date`: ISO-8601 kickoff instant.
//   - `fixture.teams.home.name` / `fixture.teams.away.name`: team names.
//   - `fixture.goals.home` / `fixture.goals.away`: current/final score,
//     `null` before kickoff.

import type { FixtureSyncProvider, FixtureSyncStatus, FixtureUpdate } from './types';

const API_BASE = 'https://v3.football.api-sports.io';

/**
 * Our competitionId -> API-Football {league, season}. Both verified against
 * API-Football's real, current docs/coverage pages during the live-score
 * research phase (docs/architecture-v1-amendment-livescore.md's Phase-1
 * table and "Sources checked" list) — not re-derived here.
 */
const COMPETITION_LEAGUE_MAP: Record<string, { league: number; season: number }> = {
  'wc2026': { league: 1, season: 2026 },
  'israeli-premier-league': { league: 73, season: 2026 },
};

/**
 * API-Football's short status codes, collapsed to our three-value model.
 * Unrecognized codes are logged and SKIPPED (never silently miswritten as
 * some guessed status) — see `mapStatus`.
 *
 * Source: API-Football v3 docs' fixture status table. NS/TBD = not
 * started; 1H/HT/2H/ET/BT/P/SUSP/INT = various in-play/paused states;
 * FT/AET/PEN = finished (regulation / extra time / penalties);
 * PST/CANC/ABD/AWD/WO = postponed/cancelled/abandoned/awarded/walkover —
 * treated conservatively (see comments below).
 */
const LIVE_STATUS_CODES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT']);
const FINISHED_STATUS_CODES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
const SCHEDULED_STATUS_CODES = new Set(['TBD', 'NS']);
// PST (postponed), CANC (cancelled), ABD (abandoned): deliberately NOT
// mapped to any of our three statuses. A postponed/cancelled/abandoned
// match doesn't cleanly fit SCHEDULED (kickoff time may no longer be
// accurate — and kickoffAt is immutable at the rules layer, so we cannot
// silently "reschedule" it here) or FINISHED (no real result). Skipping
// these (logging a warning, making no Firestore write) is the safe choice;
// resolving them properly is a flagged follow-up, not guessed at here.

function mapStatus(shortCode: string): FixtureSyncStatus | null {
  if (SCHEDULED_STATUS_CODES.has(shortCode)) return 'SCHEDULED';
  if (LIVE_STATUS_CODES.has(shortCode)) return 'LIVE';
  if (FINISHED_STATUS_CODES.has(shortCode)) return 'FINISHED';
  return null;
}

/** Shape of the bits of API-Football's fixture object this provider reads.
 * Deliberately narrow (not the full API-Football schema) — only what we
 * actually map. */
interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string; // ISO-8601
    status: { short: string };
  };
  league: { id: number };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
}

interface ApiFootballResponse {
  response: ApiFootballFixture[];
  errors?: unknown;
}

export class RealFixtureSyncProvider implements FixtureSyncProvider {
  constructor(private readonly apiKey: string) {}

  private async request(path: string): Promise<ApiFootballFixture[]> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'x-apisports-key': this.apiKey },
    });
    if (!res.ok) {
      throw new Error(`API-Football request failed: ${path} -> HTTP ${res.status}`);
    }
    const body = (await res.json()) as ApiFootballResponse;
    if (body.errors && Object.keys(body.errors as object).length > 0) {
      throw new Error(`API-Football returned errors for ${path}: ${JSON.stringify(body.errors)}`);
    }
    return body.response;
  }

  private toUpdate(apiFixture: ApiFootballFixture, competitionId: string): FixtureUpdate | null {
    const status = mapStatus(apiFixture.fixture.status.short);
    if (status === null) {
      console.warn(
        `[RealFixtureSyncProvider] unrecognized API-Football status "${apiFixture.fixture.status.short}" ` +
          `for fixture ${apiFixture.fixture.id} — skipping (no Firestore write) rather than guessing.`,
      );
      return null;
    }
    return {
      fixtureId: `af-${apiFixture.fixture.id}`,
      competitionId,
      homeTeam: apiFixture.teams.home.name,
      awayTeam: apiFixture.teams.away.name,
      kickoffAt: new Date(apiFixture.fixture.date).toISOString(),
      status,
      homeScore: status === 'SCHEDULED' ? null : apiFixture.goals.home,
      awayScore: status === 'SCHEDULED' ? null : apiFixture.goals.away,
      externalRef: String(apiFixture.fixture.id),
    };
  }

  /**
   * Full-league fetch: every fixture API-Football knows about for this
   * competition's league/season, in one request. Used by the sync script's
   * ordinary per-competition pass (schedule refresh / fallback when nothing
   * is in its live window per `isWithinLiveWindow`).
   */
  async syncFixtures(competitionId: string): Promise<FixtureUpdate[]> {
    const mapping = COMPETITION_LEAGUE_MAP[competitionId];
    if (!mapping) {
      console.warn(`[RealFixtureSyncProvider] no API-Football league mapping for competitionId "${competitionId}" — skipping.`);
      return [];
    }
    const apiFixtures = await this.request(`/fixtures?league=${mapping.league}&season=${mapping.season}`);
    return apiFixtures
      .map((f) => this.toUpdate(f, competitionId))
      .filter((u): u is FixtureUpdate => u !== null);
  }

  /**
   * Live-only fast path (docs/architecture-v1-amendment-livescore.md §4):
   * ONE call to `fixtures?live=all` returns every currently in-play match
   * across every league API-Football covers, which we then filter down to
   * just the league IDs behind `competitionIds`. This is what keeps "check
   * what's live" to a single request regardless of how many competitions
   * GoalMates tracks, protecting the 100 req/day budget the whole live-sync
   * design is built around.
   */
  async syncLiveFixtures(competitionIds: string[]): Promise<FixtureUpdate[]> {
    const ourLeagueIds = new Map<number, string>();
    for (const competitionId of competitionIds) {
      const mapping = COMPETITION_LEAGUE_MAP[competitionId];
      if (mapping) ourLeagueIds.set(mapping.league, competitionId);
    }
    if (ourLeagueIds.size === 0) return [];

    const apiFixtures = await this.request('/fixtures?live=all');
    const updates: FixtureUpdate[] = [];
    for (const f of apiFixtures) {
      const competitionId = ourLeagueIds.get(f.league.id);
      if (!competitionId) continue; // a live match in a league we don't track
      const update = this.toUpdate(f, competitionId);
      if (update) updates.push(update);
    }
    return updates;
  }
}
