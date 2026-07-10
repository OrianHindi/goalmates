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
      await seedGroup(db, { groupId: GROUP_ID, competitionId: COMPETITION_ID, createdBy: ADMIN_UID, memberIds: [NON_ADMIN_UID] });
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
});
