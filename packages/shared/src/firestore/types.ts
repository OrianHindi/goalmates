// Document shapes for every Firestore collection, per architecture-v1.md §2.
// Field names and types here are the source of truth the committed
// `firestore.rules` and the mobile app both assume — do not rename fields
// without updating the rules file and this doc together.
import type { Timestamp } from 'firebase/firestore';

/** `users/{userId}` — 1:1 with the Firebase Auth uid. */
export interface UserDoc {
  displayName: string;
  photoURL: string | null;
}

/** `groups/{groupId}` — Firestore auto-generated ID. */
export interface GroupDoc {
  name: string;
  /**
   * Immutable after creation: a group tracks a fixed set of competitions,
   * chosen at creation time — see
   * docs/architecture-v1-amendment-multicompetition.md. Was
   * `competitionId: string` in v1; a group may now track more than one
   * competition. Still no "add a competition later" flow — creation-time only.
   */
  competitionIds: string[];
  /** Immutable; the sole admin in v1. */
  createdBy: string;
  createdAt: Timestamp;
}

export type MemberRole = 'admin' | 'member';

/** `groups/{groupId}/members/{userId}` subcollection. */
export interface MemberDoc {
  role: MemberRole;
  joinedAt: Timestamp;
}

/** `competitions/{competitionId}` — global, seeded once via the Admin SDK. */
export interface CompetitionDoc {
  name: string;
}

/**
 * `SCHEDULED` → not yet kicked off (scores null). `LIVE` → in progress; the
 * automatic score-sync job updates homeScore/awayScore repeatedly while the
 * match is played (see docs/architecture-v1-amendment-livescore.md). `FINISHED`
 * → full-time; scores are the final result. LIVE was added by the live-score
 * amendment; the older `SCHEDULED | FINISHED` model is superseded by this.
 */
export type FixtureStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED';

/**
 * `fixtures/{fixtureId}` — top-level collection (not nested under
 * competitions), carries `competitionId` — see architecture-v1.md §2 for why.
 */
export interface FixtureDoc {
  competitionId: string;
  homeTeam: string;
  awayTeam: string;
  /** Immutable once created — see architecture-v1.md §2/§3. */
  kickoffAt: Timestamp;
  status: FixtureStatus;
  /** null while SCHEDULED; a running (LIVE) or final (FINISHED) tally otherwise. */
  homeScore: number | null;
  /** null while SCHEDULED; a running (LIVE) or final (FINISHED) tally otherwise. */
  awayScore: number | null;
  /** For a future real fixture-data provider; unused in v1. */
  externalRef: string | null;
}

/** `joinCodes/{code}` — top-level lookup collection, doc ID is the code itself. */
export interface JoinCodeDoc {
  groupId: string;
  createdBy: string;
  createdAt: Timestamp;
}

/**
 * `competitionAdmins/{competitionId_userId}` — denormalized authorization
 * grant so fixture-update rules can do an O(1) `exists()` check instead of
 * an impossible "find any group where I'm admin" query.
 */
export interface CompetitionAdminDoc {
  competitionId: string;
  userId: string;
  /** Which group creation produced this grant (for rule cross-checks/debugging). */
  groupId: string;
  grantedAt: Timestamp;
}

/**
 * `groups/{groupId}/bets/{betId}` where `betId = "${userId}_${fixtureId}"`.
 */
export interface BetDoc {
  userId: string;
  fixtureId: string;
  predictedHome: number;
  predictedAway: number;
  /** Must equal `request.time` on every write (rules-enforced). */
  updatedAt: Timestamp;
}
