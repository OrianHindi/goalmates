import { collection, collectionGroup, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

import { createTestEnv, modularFirestore, seedBet, seedCompetition, seedFixture, seedGroup, timestampMinutesFromNow } from './setup';

const PROJECT_ID = 'goalmates-rules-test-bets';
const GROUP_ID = 'group-1';
const COMPETITION_ID = 'comp-1';
const ADMIN_UID = 'admin-uid';
const MEMBER_UID = 'member-uid';
const OUTSIDER_UID = 'outsider-uid';
const PAST_FIXTURE = 'fixture-past'; // kickoff already happened -> locked
const FUTURE_FIXTURE = 'fixture-future'; // kickoff in the future -> unlocked

describe('groups/{groupId}/bets/{betId} rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createTestEnv(PROJECT_ID);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = modularFirestore(context);
      await seedCompetition(db, COMPETITION_ID);
      await seedGroup(db, { groupId: GROUP_ID, competitionId: COMPETITION_ID, createdBy: ADMIN_UID, memberIds: [MEMBER_UID] });
      await seedFixture(db, { fixtureId: PAST_FIXTURE, competitionId: COMPETITION_ID, status: 'SCHEDULED', kickoffAt: timestampMinutesFromNow(-60) });
      await seedFixture(db, { fixtureId: FUTURE_FIXTURE, competitionId: COMPETITION_ID, status: 'SCHEDULED', kickoffAt: timestampMinutesFromNow(60) });
      // A pre-existing bet by ADMIN_UID on each fixture, for read-permission tests.
      await seedBet(db, { groupId: GROUP_ID, userId: ADMIN_UID, fixtureId: PAST_FIXTURE, predictedHome: 2, predictedAway: 1 });
      await seedBet(db, { groupId: GROUP_ID, userId: ADMIN_UID, fixtureId: FUTURE_FIXTURE, predictedHome: 1, predictedAway: 1 });
    });
  });

  it('denies a signed-in non-member all group-scoped bet reads and writes', async () => {
    const outsiderDb = modularFirestore(testEnv.authenticatedContext(OUTSIDER_UID));

    await assertFails(getDoc(doc(outsiderDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${PAST_FIXTURE}`)));
    await assertFails(
      setDoc(doc(outsiderDb, 'groups', GROUP_ID, 'bets', `${OUTSIDER_UID}_${FUTURE_FIXTURE}`), {
        userId: OUTSIDER_UID,
        fixtureId: FUTURE_FIXTURE,
        predictedHome: 1,
        predictedAway: 0,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('denies a fully unauthenticated caller all group-scoped bet reads and writes', async () => {
    const anonDb = modularFirestore(testEnv.unauthenticatedContext());

    await assertFails(getDoc(doc(anonDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${PAST_FIXTURE}`)));
    await assertFails(
      setDoc(doc(anonDb, 'groups', GROUP_ID, 'bets', `${OUTSIDER_UID}_${FUTURE_FIXTURE}`), {
        userId: OUTSIDER_UID,
        fixtureId: FUTURE_FIXTURE,
        predictedHome: 1,
        predictedAway: 0,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('lets a member always read their own bet, pre- and post-kickoff', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertSucceeds(getDoc(doc(adminDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${FUTURE_FIXTURE}`))); // pre-kickoff, own
    await assertSucceeds(getDoc(doc(adminDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${PAST_FIXTURE}`))); // post-kickoff, own
  });

  it('denies a member reading another member\'s bet pre-kickoff', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    await assertFails(getDoc(doc(memberDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${FUTURE_FIXTURE}`)));
  });

  it('lets a member read another member\'s bet post-kickoff', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    await assertSucceeds(getDoc(doc(memberDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${PAST_FIXTURE}`)));
  });

  it('accepts a bet create before kickoff', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    await assertSucceeds(
      setDoc(doc(memberDb, 'groups', GROUP_ID, 'bets', `${MEMBER_UID}_${FUTURE_FIXTURE}`), {
        userId: MEMBER_UID,
        fixtureId: FUTURE_FIXTURE,
        predictedHome: 2,
        predictedAway: 0,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects a bet create at/after kickoff', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    await assertFails(
      setDoc(doc(memberDb, 'groups', GROUP_ID, 'bets', `${MEMBER_UID}_${PAST_FIXTURE}`), {
        userId: MEMBER_UID,
        fixtureId: PAST_FIXTURE,
        predictedHome: 2,
        predictedAway: 0,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects a bet update at/after kickoff, even by the bet\'s own owner', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${PAST_FIXTURE}`), {
        userId: ADMIN_UID,
        fixtureId: PAST_FIXTURE,
        predictedHome: 9,
        predictedAway: 9,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('accepts a bet update before kickoff by the bet\'s own owner', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertSucceeds(
      updateDoc(doc(adminDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${FUTURE_FIXTURE}`), {
        userId: ADMIN_UID,
        fixtureId: FUTURE_FIXTURE,
        predictedHome: 3,
        predictedAway: 3,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects a negative predictedHome/predictedAway', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    await assertFails(
      setDoc(doc(memberDb, 'groups', GROUP_ID, 'bets', `${MEMBER_UID}_${FUTURE_FIXTURE}`), {
        userId: MEMBER_UID,
        fixtureId: FUTURE_FIXTURE,
        predictedHome: -1,
        predictedAway: 0,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects a non-integer predictedHome/predictedAway', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    await assertFails(
      setDoc(doc(memberDb, 'groups', GROUP_ID, 'bets', `${MEMBER_UID}_${FUTURE_FIXTURE}`), {
        userId: MEMBER_UID,
        fixtureId: FUTURE_FIXTURE,
        predictedHome: 1.5,
        predictedAway: 0,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects a client-spoofed updatedAt that is not request.time', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    await assertFails(
      setDoc(doc(memberDb, 'groups', GROUP_ID, 'bets', `${MEMBER_UID}_${FUTURE_FIXTURE}`), {
        userId: MEMBER_UID,
        fixtureId: FUTURE_FIXTURE,
        predictedHome: 1,
        predictedAway: 0,
        updatedAt: Timestamp.fromMillis(Date.now() - 999_999_999), // spoofed, not serverTimestamp()
      })
    );
  });

  it('rejects changing fixtureId on update, even to another valid unlocked fixture', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${FUTURE_FIXTURE}`), {
        fixtureId: PAST_FIXTURE,
      })
    );
  });

  it('rejects changing userId on update (cannot adopt someone else\'s bet)', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'groups', GROUP_ID, 'bets', `${ADMIN_UID}_${FUTURE_FIXTURE}`), {
        userId: MEMBER_UID,
      })
    );
  });

  it('denies a non-owner member from reading pre-kickoff bets via a full collection list, a where-filtered query, or a collectionGroup query', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    // Firestore denies the entire list request when the rule can't be proven
    // satisfied for every document in the potential result set (it does not
    // silently filter out the disallowed docs) - verified empirically here,
    // not assumed from docs, since this is the crux of the pre-kickoff
    // bet-privacy guarantee for any list/query read path the app might use.
    await assertFails(getDocs(collection(memberDb, 'groups', GROUP_ID, 'bets')));
    await assertFails(
      getDocs(query(collection(memberDb, 'groups', GROUP_ID, 'bets'), where('fixtureId', '==', FUTURE_FIXTURE)))
    );
    // No collectionGroup match rule exists for `bets` at all (only the nested
    // groups/{groupId}/bets match) - confirms a collectionGroup('bets') query
    // can't be used as a bypass path either.
    await assertFails(
      getDocs(query(collectionGroup(memberDb, 'bets'), where('fixtureId', '==', FUTURE_FIXTURE)))
    );
  });

  it('lets a member list bets for a fixture once it is locked (post-kickoff), same query shape', async () => {
    const memberDb = modularFirestore(testEnv.authenticatedContext(MEMBER_UID));

    await assertSucceeds(
      getDocs(query(collection(memberDb, 'groups', GROUP_ID, 'bets'), where('fixtureId', '==', PAST_FIXTURE)))
    );
  });
});
