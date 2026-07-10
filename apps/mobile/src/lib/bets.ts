import { betConverter, betPath, betsPath, type BetDoc } from '@goalmates/shared/firestore';
import { collection, doc as docRef, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import { getFirebase } from '../firebase/config';

export interface BetSummary extends BetDoc {
  betId: string;
}

/**
 * My own bet for a fixture -- always readable regardless of lock state
 * (firestore.rules: `resource.data.userId == request.auth.uid` arm).
 *
 * Verified against the real emulator: firestore.rules' bet read rule is
 * `resource.data.userId == request.auth.uid || isLocked(...)`, and it does
 * NOT guard against `resource == null` first. For a bet document that
 * doesn't exist yet (the common "haven't bet on this fixture" case),
 * `resource` is null, so `resource.data.userId` throws a null-dereference
 * evaluation error inside the rule itself -- which Firestore surfaces to
 * the client as `permission-denied`, not a clean "not found". This is a
 * property of the already-reviewed, committed rules file (out of scope to
 * change here), not a client bug to route around by editing rules. Since
 * this path is only ever called for the CURRENT user's own bet (never
 * someone else's), a `permission-denied` here can only mean "no bet
 * exists yet" -- if it existed, the rule's first arm would always allow
 * it -- so it's safe and correct to treat that specific error as "no bet".
 */
export async function fetchMyBet(groupId: string, fixtureId: string, uid: string): Promise<BetSummary | null> {
  const { firestore } = getFirebase();
  try {
    const snap = await getDoc(docRef(firestore, betPath(groupId, uid, fixtureId)).withConverter(betConverter));
    return snap.exists() ? { betId: snap.id, ...snap.data() } : null;
  } catch (err) {
    // Duck-typed on `.code` rather than `instanceof FirestoreError`: Metro
    // can resolve `firebase/firestore` through two different paths here
    // (this app's own dependency vs. @goalmates/shared's), which can yield
    // two distinct module instances whose classes fail `instanceof` against
    // each other even though they're semantically the same error type.
    if ((err as { code?: string })?.code === 'permission-denied') {
      return null;
    }
    throw err;
  }
}

/**
 * ALL bets for one fixture within a group -- ONLY call this for a fixture
 * that is already LOCKED (kickoff has passed / status FINISHED). Verified
 * against Firebase's own "securing queries" doc: Firestore rejects a
 * *whole* list query outright (not a silent per-document filter) whenever
 * the rule can't be proven to hold for every potential match the query's
 * filters allow. Our bet read rule is
 * `isMember(groupId) && (resource.data.userId == request.auth.uid ||
 * isLocked(resource.data.fixtureId))` -- with only a `fixtureId` filter (no
 * `userId` filter), Firestore can't prove the `userId` arm holds for
 * documents belonging to other users, so it falls back to requiring the
 * `isLocked(fixtureId)` arm to be true for EVERY potential match. Because
 * `fixtureId` is pinned by the filter, `isLocked(fixtureId)` resolves to one
 * constant for the whole query -- true (query allowed, returns everyone's
 * bets) once locked, but REJECTED OUTRIGHT for the whole query while still
 * unlocked, even for the caller's own bet. Call `fetchMyBet` instead for an
 * unlocked fixture.
 */
export async function fetchBetsForLockedFixture(groupId: string, fixtureId: string): Promise<BetSummary[]> {
  const { firestore } = getFirebase();
  const snap = await getDocs(
    query(collection(firestore, betsPath(groupId)).withConverter(betConverter), where('fixtureId', '==', fixtureId))
  );
  return snap.docs.map((d) => ({ betId: d.id, ...d.data() }));
}

/**
 * Every bet across a set of FINISHED fixtures (for the leaderboard, which
 * only ever needs finished-fixture bets to compute points -- a SCHEDULED
 * fixture always contributes 0 regardless of any bet). A finished fixture's
 * kickoff has necessarily already passed, so `fetchBetsForLockedFixture` is
 * always safe here. Deliberately per-fixture (not one unfiltered query over
 * the whole `bets` subcollection): an unfiltered query would span
 * still-unlocked fixtures' bets too and get rejected outright by the same
 * rule reasoning as fetchBetsForLockedFixture's doc comment.
 */
export async function fetchBetsForFinishedFixtures(groupId: string, finishedFixtureIds: string[]): Promise<BetSummary[]> {
  const results: BetSummary[] = [];
  for (const fixtureId of finishedFixtureIds) {
    results.push(...(await fetchBetsForLockedFixture(groupId, fixtureId)));
  }
  return results;
}

/** Create-or-update my bet. `updatedAt` is always `serverTimestamp()` --
 * never a client Date -- because firestore.rules requires
 * `updatedAt == request.time` on every write. Rejected server-side at/after
 * kickoff regardless of what the UI thinks the lock state is. */
export async function placeBet(args: {
  groupId: string;
  fixtureId: string;
  uid: string;
  predictedHome: number;
  predictedAway: number;
}): Promise<void> {
  const { firestore } = getFirebase();
  await setDoc(docRef(firestore, betPath(args.groupId, args.uid, args.fixtureId)), {
    userId: args.uid,
    fixtureId: args.fixtureId,
    predictedHome: args.predictedHome,
    predictedAway: args.predictedAway,
    updatedAt: serverTimestamp(),
  });
}
