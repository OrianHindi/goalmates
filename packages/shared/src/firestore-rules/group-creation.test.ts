import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

import { createTestEnv, modularFirestore, seedCompetition, seedGroup } from './setup';

const PROJECT_ID = 'goalmates-rules-test-group-creation';
const COMPETITION_ID = 'comp-1';
const UID = 'creator-uid';
const OTHER_UID = 'other-uid';

describe('atomic group creation (groups + members + joinCodes + competitionAdmins)', () => {
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
      await seedCompetition(modularFirestore(context), COMPETITION_ID);
    });
  });

  it('succeeds when all 4 documents are written together in one batch', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-full-batch';
    const joinCode = 'CODEAB';

    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Full Batch Group',
      competitionId: COMPETITION_ID,
      createdBy: UID,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'groups', groupId, 'members', UID), {
      role: 'admin',
      joinedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'joinCodes', joinCode), {
      groupId,
      createdBy: UID,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'competitionAdmins', `${COMPETITION_ID}_${UID}`), {
      competitionId: COMPETITION_ID,
      userId: UID,
      groupId,
      grantedAt: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });

  it('denies a lone groups/{groupId} write with no sibling admin-membership doc', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-partial-1';

    await assertFails(
      setDoc(doc(db, 'groups', groupId), {
        name: 'Partial Group',
        competitionId: COMPETITION_ID,
        createdBy: UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  it('denies a lone members/{uid} admin write with no sibling group doc', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-partial-2';

    await assertFails(
      setDoc(doc(db, 'groups', groupId, 'members', UID), {
        role: 'admin',
        joinedAt: serverTimestamp(),
      })
    );
  });

  it('denies a lone joinCodes/{code} write with no sibling group/membership docs', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-partial-3';

    await assertFails(
      setDoc(doc(db, 'joinCodes', 'LONECODE'), {
        groupId,
        createdBy: UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  it('denies a lone competitionAdmins/{competitionId_userId} write with no sibling group doc', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-partial-4';

    await assertFails(
      setDoc(doc(db, 'competitionAdmins', `${COMPETITION_ID}_${UID}`), {
        competitionId: COMPETITION_ID,
        userId: UID,
        groupId,
        grantedAt: serverTimestamp(),
      })
    );
  });

  it('denies a second create at an already-existing joinCodes/{code}', async () => {
    const groupId1 = 'group-first';
    const groupId2 = 'group-second';
    const code = 'DUPCODE';

    // First creator legitimately claims the code via a full atomic batch.
    const firstDb = modularFirestore(testEnv.authenticatedContext(UID));
    const firstBatch = writeBatch(firstDb);
    firstBatch.set(doc(firstDb, 'groups', groupId1), {
      name: 'First Group',
      competitionId: COMPETITION_ID,
      createdBy: UID,
      createdAt: serverTimestamp(),
    });
    firstBatch.set(doc(firstDb, 'groups', groupId1, 'members', UID), {
      role: 'admin',
      joinedAt: serverTimestamp(),
    });
    firstBatch.set(doc(firstDb, 'joinCodes', code), {
      groupId: groupId1,
      createdBy: UID,
      createdAt: serverTimestamp(),
    });
    firstBatch.set(doc(firstDb, 'competitionAdmins', `${COMPETITION_ID}_${UID}`), {
      competitionId: COMPETITION_ID,
      userId: UID,
      groupId: groupId1,
      grantedAt: serverTimestamp(),
    });
    await assertSucceeds(firstBatch.commit());

    // A second, different user's group-creation batch collides on the same
    // code. Firestore rules see this as an *update* to the existing
    // joinCodes/{code} doc (allow update: if false), so the whole batch
    // must fail, even though this second creator's own group/member/
    // competitionAdmins documents would otherwise be perfectly valid.
    const secondDb = modularFirestore(testEnv.authenticatedContext(OTHER_UID));
    const secondBatch = writeBatch(secondDb);
    secondBatch.set(doc(secondDb, 'groups', groupId2), {
      name: 'Second Group',
      competitionId: COMPETITION_ID,
      createdBy: OTHER_UID,
      createdAt: serverTimestamp(),
    });
    secondBatch.set(doc(secondDb, 'groups', groupId2, 'members', OTHER_UID), {
      role: 'admin',
      joinedAt: serverTimestamp(),
    });
    secondBatch.set(doc(secondDb, 'joinCodes', code), {
      groupId: groupId2,
      createdBy: OTHER_UID,
      createdAt: serverTimestamp(),
    });
    secondBatch.set(doc(secondDb, 'competitionAdmins', `${COMPETITION_ID}_${OTHER_UID}`), {
      competitionId: COMPETITION_ID,
      userId: OTHER_UID,
      groupId: groupId2,
      grantedAt: serverTimestamp(),
    });

    await assertFails(secondBatch.commit());
  });

  it('denies replaying an already-committed group-creation batch (idempotency / re-entrancy)', async () => {
    const groupId = 'group-replay';
    const joinCode = 'REPLAY1';

    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const makeBatch = () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'groups', groupId), {
        name: 'Replay Group',
        competitionId: COMPETITION_ID,
        createdBy: UID,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'groups', groupId, 'members', UID), { role: 'admin', joinedAt: serverTimestamp() });
      batch.set(doc(db, 'joinCodes', joinCode), { groupId, createdBy: UID, createdAt: serverTimestamp() });
      batch.set(doc(db, 'competitionAdmins', `${COMPETITION_ID}_${UID}`), {
        competitionId: COMPETITION_ID,
        userId: UID,
        groupId,
        grantedAt: serverTimestamp(),
      });
      return batch;
    };

    await assertSucceeds(makeBatch().commit());
    // A replay of the identical batch: the members/{uid} doc already exists,
    // so this second write is an *update* to it, which is unconditionally
    // denied (`allow update: if false`) - failing that one document fails
    // the whole atomic batch, so replay can't create any duplicate or
    // conflicting state.
    await assertFails(makeBatch().commit());
  });

  it('denies a member adding ANOTHER user as a group member (self-join only)', async () => {
    const groupId = 'group-selfjoin';
    const attackerUid = 'attacker-uid';
    const victimUid = 'victim-uid';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await seedGroup(modularFirestore(context), {
        groupId,
        competitionId: COMPETITION_ID,
        createdBy: UID,
        memberIds: [attackerUid],
      });
    });

    const attackerDb = modularFirestore(testEnv.authenticatedContext(attackerUid));
    await assertFails(
      setDoc(doc(attackerDb, 'groups', groupId, 'members', victimUid), {
        role: 'member',
        joinedAt: serverTimestamp(),
      })
    );
  });

  it('denies a member self-promoting to admin via update (role changes are always denied)', async () => {
    const groupId = 'group-selfpromote';
    const attackerUid = 'attacker-uid';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await seedGroup(modularFirestore(context), {
        groupId,
        competitionId: COMPETITION_ID,
        createdBy: UID,
        memberIds: [attackerUid],
      });
    });

    const attackerDb = modularFirestore(testEnv.authenticatedContext(attackerUid));
    await assertFails(updateDoc(doc(attackerDb, 'groups', groupId, 'members', attackerUid), { role: 'admin' }));
  });
});
