// Pure scoring/leaderboard logic. Zero Firebase/Firestore imports on purpose
// (see docs/architecture-v1.md §4) so this runs identically in the Expo app
// (React Native/Hermes) and in plain Node for these unit tests.

export type FixtureResult =
  | { status: 'SCHEDULED' }
  | { status: 'FINISHED'; homeScore: number; awayScore: number };

// null = no bet placed for this fixture.
export type BetPrediction = { predictedHome: number; predictedAway: number } | null;

export interface ScoreResult {
  points: 0 | 1 | 3;
  isExact: boolean; // true only on a 3-point (exact score) result
  isDirection: boolean; // true only on a 1-point (right direction, wrong score) result
  // isExact and isDirection are mutually exclusive by construction.
}

type MatchDirection = 'HOME' | 'AWAY' | 'DRAW';

function directionOf(home: number, away: number): MatchDirection {
  if (home > away) return 'HOME';
  if (home < away) return 'AWAY';
  return 'DRAW';
}

/**
 * 3 points for an exact score match, 1 point for correct direction
 * (home win / draw / away win) with a different score, 0 otherwise.
 * A draw prediction on a (different) drawn result still earns 1 point —
 * draw is a direction, not just "not exact".
 */
export function scoreForBet(bet: BetPrediction, fixture: FixtureResult): ScoreResult {
  if (fixture.status !== 'FINISHED' || bet === null) {
    return { points: 0, isExact: false, isDirection: false };
  }

  const { homeScore, awayScore } = fixture;

  if (bet.predictedHome === homeScore && bet.predictedAway === awayScore) {
    return { points: 3, isExact: true, isDirection: false };
  }

  const actual = directionOf(homeScore, awayScore);
  const predicted = directionOf(bet.predictedHome, bet.predictedAway);

  if (actual === predicted) {
    return { points: 1, isExact: false, isDirection: true };
  }

  return { points: 0, isExact: false, isDirection: false };
}

/**
 * Structural subset of Firestore's `Timestamp` (has `toMillis()`). Declared
 * locally, rather than importing `Timestamp` from `firebase/firestore`, so
 * this module keeps zero Firebase imports per architecture-v1.md §4 — a
 * real Firestore `Timestamp` instance satisfies this interface as-is, so
 * callers can pass one directly with no adapter needed.
 */
export interface ComparableTimestamp {
  toMillis(): number;
}

export interface LeaderboardMember {
  userId: string;
  joinedAt: ComparableTimestamp;
}

export interface LeaderboardBet {
  userId: string;
  fixtureId: string;
  predictedHome: number;
  predictedAway: number;
}

export interface LeaderboardFixture {
  fixtureId: string;
  status: 'SCHEDULED' | 'FINISHED';
  homeScore: number | null;
  awayScore: number | null;
}

export interface MemberStanding {
  userId: string;
  totalPoints: number;
  exactCount: number;
  directionCount: number;
  joinedAt: ComparableTimestamp; // tie-break only
}

function betKey(userId: string, fixtureId: string): string {
  return `${userId}_${fixtureId}`;
}

function toFixtureResult(fixture: LeaderboardFixture): FixtureResult {
  if (fixture.status === 'FINISHED' && fixture.homeScore !== null && fixture.awayScore !== null) {
    return { status: 'FINISHED', homeScore: fixture.homeScore, awayScore: fixture.awayScore };
  }
  // Not finished, or finished but missing a score somehow — treat as no
  // result yet, per architecture-v1.md §4.
  return { status: 'SCHEDULED' };
}

/**
 * Per-member totals across every finished fixture, ranked per product-spec
 * §3's tie-break: totalPoints desc, exactCount desc, directionCount desc,
 * joinedAt asc (earliest joined ranks higher on a full tie).
 *
 * Tolerates a member with no bets, and only ever iterates the `members`
 * array it's given — a caller that filters out a left/removed member later
 * doesn't require any change here (architecture-v1.md §2's "cheap hook").
 */
export function computeLeaderboard(
  members: LeaderboardMember[],
  bets: LeaderboardBet[],
  fixtures: LeaderboardFixture[]
): MemberStanding[] {
  const betsByKey = new Map<string, LeaderboardBet>();
  for (const bet of bets) {
    betsByKey.set(betKey(bet.userId, bet.fixtureId), bet);
  }

  const finishedFixtures = fixtures.filter((f) => f.status === 'FINISHED');

  const standings: MemberStanding[] = members.map((member) => {
    let totalPoints = 0;
    let exactCount = 0;
    let directionCount = 0;

    for (const fixture of finishedFixtures) {
      const bet = betsByKey.get(betKey(member.userId, fixture.fixtureId)) ?? null;
      const prediction: BetPrediction = bet
        ? { predictedHome: bet.predictedHome, predictedAway: bet.predictedAway }
        : null;
      const result = scoreForBet(prediction, toFixtureResult(fixture));

      totalPoints += result.points;
      if (result.isExact) exactCount += 1;
      if (result.isDirection) directionCount += 1;
    }

    return {
      userId: member.userId,
      totalPoints,
      exactCount,
      directionCount,
      joinedAt: member.joinedAt,
    };
  });

  return standings.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
    if (b.directionCount !== a.directionCount) return b.directionCount - a.directionCount;
    return a.joinedAt.toMillis() - b.joinedAt.toMillis();
  });
}
