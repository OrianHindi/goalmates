import { computeLeaderboard, type LeaderboardBet, type LeaderboardFixture, type MemberStanding } from '@goalmates/shared/scoring';

import type { FixtureSummary } from './fixtures';
import type { MemberSummary } from './groups';
import type { UserSummary } from './users';

export interface RankedStanding extends MemberStanding {
  rank: number;
  displayName: string;
}

/**
 * Thin app-level wrapper around the pure `computeLeaderboard` (see
 * docs/architecture-v1-amendment-multicompetition.md §4): the caller
 * filters `fixtures` down to one competition for a per-competition tab, or
 * passes every fixture across the group's tracked competitions for the
 * combined tab -- `computeLeaderboard` itself has no competition concept.
 * This wrapper just adds display rank (ties share a rank, per the mockup's
 * empty-state screen showing every zero-point member at rank 1) and
 * resolves display names.
 */
export function buildLeaderboard(
  members: MemberSummary[],
  bets: LeaderboardBet[],
  fixtures: LeaderboardFixture[],
  usersByUid: Map<string, UserSummary>
): RankedStanding[] {
  const standings = computeLeaderboard(members, bets, fixtures);

  const ranked: RankedStanding[] = [];
  let lastRank = 0;
  let lastKey: string | null = null;
  standings.forEach((s, i) => {
    const key = `${s.totalPoints}|${s.exactCount}|${s.directionCount}`;
    if (key !== lastKey) {
      lastRank = i + 1;
      lastKey = key;
    }
    ranked.push({
      ...s,
      rank: lastRank,
      displayName: usersByUid.get(s.userId)?.displayName ?? 'Unknown player',
    });
  });
  return ranked;
}

export function fixturesForCompetition(fixtures: FixtureSummary[], competitionId: string | 'ALL'): LeaderboardFixture[] {
  const filtered = competitionId === 'ALL' ? fixtures : fixtures.filter((f) => f.competitionId === competitionId);
  return filtered.map((f) => ({
    fixtureId: f.fixtureId,
    status: f.status,
    homeScore: f.homeScore,
    awayScore: f.awayScore,
  }));
}
