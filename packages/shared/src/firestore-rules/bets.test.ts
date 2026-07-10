import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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
});
