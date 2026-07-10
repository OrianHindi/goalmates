import { describe, expect, it } from 'vitest';
import {
  computeLeaderboard,
  scoreForBet,
  type ComparableTimestamp,
  type LeaderboardBet,
  type LeaderboardFixture,
  type LeaderboardMember,
} from './index';

function ts(millis: number): ComparableTimestamp {
  return { toMillis: () => millis };
}

describe('scoreForBet', () => {
  it('scores an exact match as 3 points', () => {
    const result = scoreForBet(
      { predictedHome: 2, predictedAway: 1 },
      { status: 'FINISHED', homeScore: 2, awayScore: 1 }
    );
    expect(result).toEqual({ points: 3, isExact: true, isDirection: false });
  });

  it('scores correct direction (home win, wrong score) as 1 point', () => {
    const result = scoreForBet(
      { predictedHome: 3, predictedAway: 0 },
      { status: 'FINISHED', homeScore: 1, awayScore: 0 }
    );
    expect(result).toEqual({ points: 1, isExact: false, isDirection: true });
  });

  it('scores a draw prediction on a different drawn result as 1 point (draw is a direction)', () => {
    const result = scoreForBet(
      { predictedHome: 1, predictedAway: 1 },
      { status: 'FINISHED', homeScore: 2, awayScore: 2 }
    );
    expect(result).toEqual({ points: 1, isExact: false, isDirection: true });
  });

  it('scores wrong direction as 0 points', () => {
    const result = scoreForBet(
      { predictedHome: 2, predictedAway: 0 },
      { status: 'FINISHED', homeScore: 0, awayScore: 1 }
    );
    expect(result).toEqual({ points: 0, isExact: false, isDirection: false });
  });

  it('scores no bet placed as 0 points even on a finished fixture', () => {
    const result = scoreForBet(null, { status: 'FINISHED', homeScore: 2, awayScore: 1 });
    expect(result).toEqual({ points: 0, isExact: false, isDirection: false });
  });

  it('scores a fixture with no result yet (SCHEDULED) as 0 points', () => {
    const result = scoreForBet({ predictedHome: 2, predictedAway: 1 }, { status: 'SCHEDULED' });
    expect(result).toEqual({ points: 0, isExact: false, isDirection: false });
  });

  it('isExact and isDirection are mutually exclusive', () => {
    const exact = scoreForBet(
      { predictedHome: 1, predictedAway: 0 },
      { status: 'FINISHED', homeScore: 1, awayScore: 0 }
    );
    expect(exact.isExact).toBe(true);
    expect(exact.isDirection).toBe(false);
  });
});

describe('computeLeaderboard', () => {
  const members: LeaderboardMember[] = [
    { userId: 'alice', joinedAt: ts(1000) },
    { userId: 'bob', joinedAt: ts(2000) },
    { userId: 'carol', joinedAt: ts(500) },
    { userId: 'dave', joinedAt: ts(3000) },
  ];

  const fixtures: LeaderboardFixture[] = [
    { fixtureId: 'f1', status: 'FINISHED', homeScore: 2, awayScore: 1 }, // home win
    { fixtureId: 'f2', status: 'FINISHED', homeScore: 0, awayScore: 0 }, // draw
    { fixtureId: 'f3', status: 'SCHEDULED', homeScore: null, awayScore: null }, // not played yet
  ];

  it('produces the exact tie-break ordering: totalPoints desc, exactCount desc, directionCount desc, joinedAt asc', () => {
    const bets: LeaderboardBet[] = [
      // alice: exact on f1 (3), exact on f2 (3) -> total 6, exact 2, direction 0
      { userId: 'alice', fixtureId: 'f1', predictedHome: 2, predictedAway: 1 },
      { userId: 'alice', fixtureId: 'f2', predictedHome: 0, predictedAway: 0 },
      // bob: direction on f1 (1), direction on f2 (1) -> total 2, exact 0, direction 2
      { userId: 'bob', fixtureId: 'f1', predictedHome: 3, predictedAway: 0 },
      { userId: 'bob', fixtureId: 'f2', predictedHome: 1, predictedAway: 1 },
      // carol: exact on f1 (3), wrong on f2 (0) -> total 3, exact 1, direction 0
      { userId: 'carol', fixtureId: 'f1', predictedHome: 2, predictedAway: 1 },
      { userId: 'carol', fixtureId: 'f2', predictedHome: 1, predictedAway: 0 },
      // dave: same totals as carol (exact on f1, wrong on f2) but joined later
      { userId: 'dave', fixtureId: 'f1', predictedHome: 2, predictedAway: 1 },
      { userId: 'dave', fixtureId: 'f2', predictedHome: 2, predictedAway: 0 },
    ];

    const standings = computeLeaderboard(members, bets, fixtures);

    expect(standings.map((s) => s.userId)).toEqual(['alice', 'carol', 'dave', 'bob']);

    expect(standings[0]).toMatchObject({ userId: 'alice', totalPoints: 6, exactCount: 2, directionCount: 0 });
    // carol ranks above dave: equal totalPoints (3) and exactCount (1) and
    // directionCount (0), tie-break falls to joinedAt asc (carol=500 < dave=3000).
    expect(standings[1]).toMatchObject({ userId: 'carol', totalPoints: 3, exactCount: 1, directionCount: 0 });
    expect(standings[2]).toMatchObject({ userId: 'dave', totalPoints: 3, exactCount: 1, directionCount: 0 });
    expect(standings[3]).toMatchObject({ userId: 'bob', totalPoints: 2, exactCount: 0, directionCount: 2 });
  });

  it('gives a member with no bets at all a zero row instead of breaking', () => {
    const standings = computeLeaderboard(members, [], fixtures);
    for (const s of standings) {
      expect(s.totalPoints).toBe(0);
      expect(s.exactCount).toBe(0);
      expect(s.directionCount).toBe(0);
    }
  });
});
