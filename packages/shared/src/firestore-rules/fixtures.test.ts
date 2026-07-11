import { doc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

import { createTestEnv, modularFirestore, seedCompetition, seedFixture, seedGroup, timestampMinutesFromNow } from './setup';

const PROJECT_ID = 'goalmates-rules-test-fixtures';
const COMPETITION_ID = 'comp-1';
const GROUP_ID = 'group-1';
const ADMIN_UID = 'admin-uid'; // holds a competitionAdmins grant via seedGroup
const NON_ADMIN_UID = 'non-admin-uid';
const FIXTURE_ID = 'fixture-1';
const ORIGINAL_KICKOFF_OFFSET_MIN = 60; // in the future -> not locked yet

describe('fixtures/{fixtureId} update rules', () => {
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
      // Grants ADMIN_UID a competitionAdmins/{COMPETITION_ID}_{ADMIN_UID} doc.
      await seedGroup(db, { groupId: GROUP_ID, competitionIds: [COMPETITION_ID], createdBy: ADMIN_UID, memberIds: [NON_ADMIN_UID] });
      await seedFixture(db, {
        fixtureId: FIXTURE_ID,
        competitionId: COMPETITION_ID,
        status: 'SCHEDULED',
        kickoffAt: timestampMinutesFromNow(ORIGINAL_KICKOFF_OFFSET_MIN),
      });
    });
  });

  it('lets a competitionAdmins grant holder write status/homeScore/awayScore', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertSucceeds(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        status: 'FINISHED',
        homeScore: 2,
        awayScore: 1,
      })
    );
  });

  it('denies a non-admin (no competitionAdmins grant) writing status/scores', async () => {
    const nonAdminDb = modularFirestore(testEnv.authenticatedContext(NON_ADMIN_UID));

    await assertFails(
      updateDoc(doc(nonAdminDb, 'fixtures', FIXTURE_ID), {
        status: 'FINISHED',
        homeScore: 2,
        awayScore: 1,
      })
    );
  });

  it('denies changing kickoffAt even by a legitimate competitionAdmins grant holder', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        kickoffAt: timestampMinutesFromNow(-999), // attempt to retroactively unlock every bet
        status: 'SCHEDULED',
      })
    );
  });

  it('denies changing homeTeam/awayTeam/competitionId/externalRef even by a legitimate admin', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        homeTeam: 'Some Other Team',
        status: 'SCHEDULED',
      })
    );
  });

  it('denies a fully unaffiliated authenticated user (no competitionAdmins grant on any group) from writing scores', async () => {
    // Distinguishes the documented accepted risk ("any group-admin of ANY
    // group on the competition can correct it") from the strictly broader,
    // NOT-accepted possibility ("any authenticated user can correct it").
    const randomDb = modularFirestore(testEnv.authenticatedContext('totally-unaffiliated-uid'));

    await assertFails(
      updateDoc(doc(randomDb, 'fixtures', FIXTURE_ID), {
        status: 'FINISHED',
        homeScore: 9,
        awayScore: 9,
      })
    );
  });

  // ---------------------------------------------------------------
  // Live-score amendment (docs/architecture-v1-amendment-livescore.md):
  // LIVE is a new status whose scores are non-null ints and freely mutable
  // by a competitionAdmins grant holder (the sync job's rules-bypass Admin
  // SDK path doesn't hit these rules; the client-facing surface here is the
  // manual admin override, which shares this rule). These tests also pin
  // that the amendment did NOT weaken FINISHED's score-shape guarantee or
  // kickoffAt immutability.
  // ---------------------------------------------------------------

  it('lets a competitionAdmin move a fixture SCHEDULED -> LIVE with a non-negative in-progress score', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertSucceeds(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        status: 'LIVE',
        homeScore: 1,
        awayScore: 0,
      })
    );
  });

  it('lets a competitionAdmin repeatedly change a LIVE fixture score (running score is mutable)', async () => {
    // Seed the fixture as already LIVE with a score, then bump it — this is
    // what every sync poll does while the match is played.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = modularFirestore(context);
      await seedFixture(db, {
        fixtureId: FIXTURE_ID,
        competitionId: COMPETITION_ID,
        status: 'LIVE',
        kickoffAt: timestampMinutesFromNow(-30), // kicked off 30 min ago
        homeScore: 1,
        awayScore: 0,
      });
    });

    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));
    await assertSucceeds(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), { status: 'LIVE', homeScore: 2, awayScore: 1 })
    );
  });

  it('denies a LIVE update with null scores (LIVE must carry a running score)', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        status: 'LIVE',
        homeScore: null,
        awayScore: null,
      })
    );
  });

  it('denies a LIVE update with a negative score', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        status: 'LIVE',
        homeScore: -1,
        awayScore: 0,
      })
    );
  });

  it('denies a non-admin (no competitionAdmins grant) writing a LIVE score', async () => {
    const nonAdminDb = modularFirestore(testEnv.authenticatedContext(NON_ADMIN_UID));

    await assertFails(
      updateDoc(doc(nonAdminDb, 'fixtures', FIXTURE_ID), {
        status: 'LIVE',
        homeScore: 1,
        awayScore: 0,
      })
    );
  });

  it('still denies changing kickoffAt on a SCHEDULED -> LIVE transition (immutability not weakened by LIVE)', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        status: 'LIVE',
        homeScore: 0,
        awayScore: 0,
        kickoffAt: timestampMinutesFromNow(-999), // retroactive kickoff move — must still be rejected
      })
    );
  });

  it('still requires non-null int scores for FINISHED (FINISHED shape guarantee intact)', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        status: 'FINISHED',
        homeScore: null,
        awayScore: null,
      })
    );
  });

  it('denies an unknown status value (only SCHEDULED/LIVE/FINISHED are valid)', async () => {
    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));

    await assertFails(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        status: 'IN_PROGRESS', // not a member of the allowed enum
        homeScore: 1,
        awayScore: 0,
      })
    );
  });

  it('confirms the accepted risk exactly as documented: an admin of Group A CAN correct a fixture also used by Group B', async () => {
    const OTHER_GROUP_ID = 'group-2';
    const OTHER_GROUP_ADMIN_UID = 'other-group-admin-uid';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = modularFirestore(context);
      // A second, unrelated group on the SAME shared competition.
      await seedGroup(db, { groupId: OTHER_GROUP_ID, competitionIds: [COMPETITION_ID], createdBy: OTHER_GROUP_ADMIN_UID });
    });

    const adminDb = modularFirestore(testEnv.authenticatedContext(ADMIN_UID));
    // ADMIN_UID (Group 1's admin) can correct the shared fixture even though
    // Group 2 (created by a different admin) also uses this competition.
    await assertSucceeds(
      updateDoc(doc(adminDb, 'fixtures', FIXTURE_ID), {
        status: 'FINISHED',
        homeScore: 2,
        awayScore: 1,
      })
    );
  });
});
