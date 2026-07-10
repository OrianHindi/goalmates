// Seed DATA constants only (no script logic here) — the single source of
// truth imported by scripts/seed-emulator.ts, the rules-unit-tests, and
// later the mobile app's dev-stub login picker (architecture-v1.md §5/§6).
// Deliberately zero Firebase imports: these are plain data, timestamps are
// expressed as minute offsets from "now" so re-seeding always produces
// fresh, manually-testable near-kickoff fixtures instead of stale hardcoded
// dates.

export interface SeedUser {
  /** Deterministic dev uid, also used as the Auth emulator uid. */
  uid: string;
  email: string;
  displayName: string;
}

/** Fixed dev-only password for every seeded Auth emulator user. Never used
 * against a real Firebase project. */
export const SEED_DEV_PASSWORD = 'goalmates-dev-2026';

export const SEED_USERS: SeedUser[] = [
  { uid: 'seed-alice', email: 'alice@goalmates.dev', displayName: 'Alice' },
  { uid: 'seed-bob', email: 'bob@goalmates.dev', displayName: 'Bob' },
  { uid: 'seed-carol', email: 'carol@goalmates.dev', displayName: 'Carol' },
  { uid: 'seed-dave', email: 'dave@goalmates.dev', displayName: 'Dave' },
];

export interface SeedCompetition {
  competitionId: string;
  name: string;
}

export const SEED_COMPETITIONS = {
  WC2026: { competitionId: 'wc2026', name: 'World Cup 2026' },
  ISRAELI_PREMIER_LEAGUE: { competitionId: 'israeli-premier-league', name: 'Israeli Premier League' },
} as const satisfies Record<string, SeedCompetition>;

export interface SeedFixture {
  fixtureId: string;
  competitionId: string;
  homeTeam: string;
  awayTeam: string;
  status: 'SCHEDULED' | 'FINISHED';
  homeScore: number | null;
  awayScore: number | null;
  /** Minutes relative to seed-run time; negative = past, positive = future. */
  kickoffOffsetMinutes: number;
}

const DAY = 24 * 60;

export const SEED_FIXTURES: SeedFixture[] = [
  // --- World Cup 2026 (12 fixtures) ---
  { fixtureId: 'wc2026-f01', competitionId: 'wc2026', homeTeam: 'Argentina', awayTeam: 'Brazil', status: 'FINISHED', homeScore: 2, awayScore: 1, kickoffOffsetMinutes: -10 * DAY },
  { fixtureId: 'wc2026-f02', competitionId: 'wc2026', homeTeam: 'France', awayTeam: 'Germany', status: 'FINISHED', homeScore: 1, awayScore: 1, kickoffOffsetMinutes: -9 * DAY },
  { fixtureId: 'wc2026-f03', competitionId: 'wc2026', homeTeam: 'Spain', awayTeam: 'Portugal', status: 'FINISHED', homeScore: 3, awayScore: 2, kickoffOffsetMinutes: -8 * DAY },
  { fixtureId: 'wc2026-f04', competitionId: 'wc2026', homeTeam: 'England', awayTeam: 'Netherlands', status: 'FINISHED', homeScore: 0, awayScore: 0, kickoffOffsetMinutes: -7 * DAY },
  { fixtureId: 'wc2026-f05', competitionId: 'wc2026', homeTeam: 'Italy', awayTeam: 'Croatia', status: 'FINISHED', homeScore: 2, awayScore: 0, kickoffOffsetMinutes: -6 * DAY },
  { fixtureId: 'wc2026-f06', competitionId: 'wc2026', homeTeam: 'USA', awayTeam: 'Mexico', status: 'FINISHED', homeScore: 1, awayScore: 2, kickoffOffsetMinutes: -5 * DAY },
  { fixtureId: 'wc2026-f07', competitionId: 'wc2026', homeTeam: 'Japan', awayTeam: 'South Korea', status: 'FINISHED', homeScore: 1, awayScore: 0, kickoffOffsetMinutes: -4 * DAY },
  { fixtureId: 'wc2026-f08', competitionId: 'wc2026', homeTeam: 'Morocco', awayTeam: 'Senegal', status: 'FINISHED', homeScore: 2, awayScore: 2, kickoffOffsetMinutes: -3 * DAY },
  { fixtureId: 'wc2026-f09', competitionId: 'wc2026', homeTeam: 'Belgium', awayTeam: 'Uruguay', status: 'SCHEDULED', homeScore: null, awayScore: null, kickoffOffsetMinutes: 2 * DAY },
  { fixtureId: 'wc2026-f10', competitionId: 'wc2026', homeTeam: 'Canada', awayTeam: 'Australia', status: 'SCHEDULED', homeScore: null, awayScore: null, kickoffOffsetMinutes: 5 * DAY },
  // Near-future SCHEDULED fixtures for manual lock-testing (bet accepted
  // right up to, then rejected at, kickoff) without waiting for a real match.
  { fixtureId: 'wc2026-f11', competitionId: 'wc2026', homeTeam: 'Ghana', awayTeam: 'Nigeria', status: 'SCHEDULED', homeScore: null, awayScore: null, kickoffOffsetMinutes: 4 },
  { fixtureId: 'wc2026-f12', competitionId: 'wc2026', homeTeam: 'Colombia', awayTeam: 'Ecuador', status: 'SCHEDULED', homeScore: null, awayScore: null, kickoffOffsetMinutes: 8 * DAY },

  // --- Israeli Premier League (6 fixtures) ---
  { fixtureId: 'ipl-f01', competitionId: 'israeli-premier-league', homeTeam: 'Maccabi Tel Aviv', awayTeam: 'Hapoel Beer Sheva', status: 'FINISHED', homeScore: 2, awayScore: 1, kickoffOffsetMinutes: -6 * DAY },
  { fixtureId: 'ipl-f02', competitionId: 'israeli-premier-league', homeTeam: 'Maccabi Haifa', awayTeam: 'Beitar Jerusalem', status: 'FINISHED', homeScore: 1, awayScore: 1, kickoffOffsetMinutes: -5 * DAY },
  { fixtureId: 'ipl-f03', competitionId: 'israeli-premier-league', homeTeam: 'Hapoel Tel Aviv', awayTeam: 'Ironi Kiryat Shmona', status: 'FINISHED', homeScore: 3, awayScore: 0, kickoffOffsetMinutes: -4 * DAY },
  { fixtureId: 'ipl-f04', competitionId: 'israeli-premier-league', homeTeam: 'Bnei Sakhnin', awayTeam: 'Hapoel Haifa', status: 'FINISHED', homeScore: 0, awayScore: 1, kickoffOffsetMinutes: -3 * DAY },
  // Near-future SCHEDULED fixture for manual lock-testing.
  { fixtureId: 'ipl-f05', competitionId: 'israeli-premier-league', homeTeam: 'Maccabi Netanya', awayTeam: 'Hapoel Jerusalem', status: 'SCHEDULED', homeScore: null, awayScore: null, kickoffOffsetMinutes: 6 },
  { fixtureId: 'ipl-f06', competitionId: 'israeli-premier-league', homeTeam: 'Ashdod SC', awayTeam: 'Ramat Gan', status: 'SCHEDULED', homeScore: null, awayScore: null, kickoffOffsetMinutes: 3 * DAY },
];

/** 6 chars, uppercase alphanumeric, excludes visually ambiguous 0/O/1/I/L
 * (architecture-v1.md §2) — chosen by hand here since this is a fixed demo
 * seed, not the runtime generator the app uses. */
export const SEED_GROUP_JOIN_CODE = 'GM2FUN';

export interface SeedGroup {
  groupId: string;
  name: string;
  competitionId: string;
  createdBy: string; // SeedUser.uid
  joinCode: string;
}

export const SEED_GROUP: SeedGroup = {
  groupId: 'seed-demo-group',
  name: "The Founders League",
  competitionId: SEED_COMPETITIONS.WC2026.competitionId,
  createdBy: SEED_USERS[0].uid, // Alice is admin/creator
  joinCode: SEED_GROUP_JOIN_CODE,
};

export interface SeedMembership {
  userId: string; // SeedUser.uid
  role: 'admin' | 'member';
  /** Minutes relative to seed-run time; all in the past, staggered for a
   * meaningful joinedAt tie-break order. */
  joinedOffsetMinutes: number;
}

export const SEED_GROUP_MEMBERS: SeedMembership[] = [
  { userId: 'seed-alice', role: 'admin', joinedOffsetMinutes: -20 * DAY },
  { userId: 'seed-bob', role: 'member', joinedOffsetMinutes: -19 * DAY },
  { userId: 'seed-carol', role: 'member', joinedOffsetMinutes: -18 * DAY },
  { userId: 'seed-dave', role: 'member', joinedOffsetMinutes: -17 * DAY },
];

export interface SeedBet {
  userId: string; // SeedUser.uid
  fixtureId: string;
  predictedHome: number;
  predictedAway: number;
}

/** A handful of bets across the demo users on some of the FINISHED WC2026
 * fixtures, so the seeded group's leaderboard has non-zero, non-trivial
 * rows immediately after seeding. */
export const SEED_BETS: SeedBet[] = [
  { userId: 'seed-alice', fixtureId: 'wc2026-f01', predictedHome: 2, predictedAway: 1 }, // exact, 3
  { userId: 'seed-alice', fixtureId: 'wc2026-f02', predictedHome: 1, predictedAway: 0 }, // wrong direction, 0
  { userId: 'seed-alice', fixtureId: 'wc2026-f03', predictedHome: 2, predictedAway: 1 }, // direction, 1
  { userId: 'seed-bob', fixtureId: 'wc2026-f01', predictedHome: 1, predictedAway: 0 }, // direction, 1
  { userId: 'seed-bob', fixtureId: 'wc2026-f02', predictedHome: 0, predictedAway: 0 }, // direction (draw), 1
  { userId: 'seed-bob', fixtureId: 'wc2026-f03', predictedHome: 3, predictedAway: 2 }, // exact, 3
  { userId: 'seed-carol', fixtureId: 'wc2026-f01', predictedHome: 2, predictedAway: 1 }, // exact, 3
  { userId: 'seed-carol', fixtureId: 'wc2026-f04', predictedHome: 0, predictedAway: 0 }, // exact, 3
  // dave has no bets at all yet — exercises the "no bet" / absent-member row.
];
