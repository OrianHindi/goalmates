import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

import { createTestEnv, modularFirestore, seedCompetition, seedGroup } from './setup';

const PROJECT_ID = 'goalmates-rules-test-group-creation';
const COMPETITION_ID = 'comp-1';
const COMPETITION_ID_2 = 'comp-2';
const COMPETITION_ID_3 = 'comp-3';
const COMPETITION_ID_4 = 'comp-4';
const COMPETITION_ID_5 = 'comp-5';
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
      const db = modularFirestore(context);
      await seedCompetition(db, COMPETITION_ID);
      await seedCompetition(db, COMPETITION_ID_2);
      await seedCompetition(db, COMPETITION_ID_3);
      await seedCompetition(db, COMPETITION_ID_4);
      await seedCompetition(db, COMPETITION_ID_5);
    });
  });

  it('succeeds when all 4 documents are written together in one batch', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-full-batch';
    const joinCode = 'CODEAB';

    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Full Batch Group',
      competitionIds: [COMPETITION_ID],
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

  // --- Multi-competition amendment coverage ---
  // (docs/architecture-v1-amendment-multicompetition.md)

  it('succeeds atomically for a 2-competition group: all 4 docs (group, membership, joinCode, 2 grants) land together', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-multi-full-batch';
    const joinCode = 'MULTIAB';

    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Multi Competition Group',
      competitionIds: [COMPETITION_ID, COMPETITION_ID_2],
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
    batch.set(doc(db, 'competitionAdmins', `${COMPETITION_ID_2}_${UID}`), {
      competitionId: COMPETITION_ID_2,
      userId: UID,
      groupId,
      grantedAt: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });

  it('denies a 2-competition group batch missing one of the N competitionAdmins grants (all-or-nothing)', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-multi-partial-batch';
    const joinCode = 'MULTIPARTIAL';

    // Same as the successful 2-competition batch above, but the grant for
    // COMPETITION_ID_2 is missing even though the group claims both
    // competitions — the whole batch must fail, not just silently create a
    // group with an incomplete set of grants.
    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Partial Multi Competition Group',
      competitionIds: [COMPETITION_ID, COMPETITION_ID_2],
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
    // Deliberately no grant for COMPETITION_ID_2.

    await assertFails(batch.commit());
  });

  it('denies a group create with an empty competitionIds array', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-empty-competitions';

    await assertFails(
      setDoc(doc(db, 'groups', groupId), {
        name: 'Empty Competitions Group',
        competitionIds: [],
        createdBy: UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  it('denies a group create referencing a nonexistent competitionId anywhere in the array', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-bad-competition';

    await assertFails(
      setDoc(doc(db, 'groups', groupId), {
        name: 'Bad Competition Group',
        competitionIds: [COMPETITION_ID, 'does-not-exist'],
        createdBy: UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  it('denies a competitionAdmins grant whose competitionId is not one of the group.competitionIds', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-grant-mismatch';
    const joinCode = 'MISMATCH1';

    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Mismatch Group',
      competitionIds: [COMPETITION_ID], // only tracks COMPETITION_ID
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
    // Grant claims COMPETITION_ID_2, which this group does NOT track.
    batch.set(doc(db, 'competitionAdmins', `${COMPETITION_ID_2}_${UID}`), {
      competitionId: COMPETITION_ID_2,
      userId: UID,
      groupId,
      grantedAt: serverTimestamp(),
    });

    await assertFails(batch.commit());
  });

  it('denies a lone groups/{groupId} write with no sibling admin-membership doc', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-partial-1';

    await assertFails(
      setDoc(doc(db, 'groups', groupId), {
        name: 'Partial Group',
        competitionIds: [COMPETITION_ID],
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
      competitionIds: [COMPETITION_ID],
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
      competitionIds: [COMPETITION_ID],
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
        competitionIds: [COMPETITION_ID],
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
        competitionIds: [COMPETITION_ID],
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
        competitionIds: [COMPETITION_ID],
        createdBy: UID,
        memberIds: [attackerUid],
      });
    });

    const attackerDb = modularFirestore(testEnv.authenticatedContext(attackerUid));
    await assertFails(updateDoc(doc(attackerDb, 'groups', groupId, 'members', attackerUid), { role: 'admin' }));
  });

  // --- Follow-up security review coverage (post PR #8) ---
  // Empirically verifies the 4 claims in
  // docs/architecture-v1-amendment-multicompetition.md against the real
  // emulator, plus the cross-group grant-creation question this amendment
  // raises but doesn't fully spell out test coverage for.

  it('succeeds for a group with exactly 4 competitionIds (the documented maximum, N=4, 20 reads)', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-max-4';
    const joinCode = 'MAXFOUR';
    const ids = [COMPETITION_ID, COMPETITION_ID_2, COMPETITION_ID_3, COMPETITION_ID_4];

    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Max Four Group',
      competitionIds: ids,
      createdBy: UID,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'groups', groupId, 'members', UID), { role: 'admin', joinedAt: serverTimestamp() });
    batch.set(doc(db, 'joinCodes', joinCode), { groupId, createdBy: UID, createdAt: serverTimestamp() });
    for (const cid of ids) {
      batch.set(doc(db, 'competitionAdmins', `${cid}_${UID}`), {
        competitionId: cid,
        userId: UID,
        groupId,
        grantedAt: serverTimestamp(),
      });
    }

    await assertSucceeds(batch.commit());
  });

  it('denies a 4-competition batch where only index 3 (the last unrolled entry) is invalid — grant missing for the 4th competition', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-max-4-bad-last';
    const joinCode = 'MAXBAD4';
    const ids = [COMPETITION_ID, COMPETITION_ID_2, COMPETITION_ID_3, COMPETITION_ID_4];

    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Max Four Bad Last Group',
      competitionIds: ids,
      createdBy: UID,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'groups', groupId, 'members', UID), { role: 'admin', joinedAt: serverTimestamp() });
    batch.set(doc(db, 'joinCodes', joinCode), { groupId, createdBy: UID, createdAt: serverTimestamp() });
    // Grants for indices 0,1,2 only — index 3 (COMPETITION_ID_4) deliberately missing.
    for (const cid of [COMPETITION_ID, COMPETITION_ID_2, COMPETITION_ID_3]) {
      batch.set(doc(db, 'competitionAdmins', `${cid}_${UID}`), {
        competitionId: cid,
        userId: UID,
        groupId,
        grantedAt: serverTimestamp(),
      });
    }

    await assertFails(batch.commit());
  });

  it('denies a group create with 5 competitionIds even when all 5 have real competitions and matching grants (size cap is the enforcing check, not incidental failure)', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-five';
    const joinCode = 'FIVECOMP';
    const ids = [COMPETITION_ID, COMPETITION_ID_2, COMPETITION_ID_3, COMPETITION_ID_4, COMPETITION_ID_5];

    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Five Competition Group',
      competitionIds: ids,
      createdBy: UID,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'groups', groupId, 'members', UID), { role: 'admin', joinedAt: serverTimestamp() });
    batch.set(doc(db, 'joinCodes', joinCode), { groupId, createdBy: UID, createdAt: serverTimestamp() });
    // All 5 grants present and valid — if this batch is still denied, it can
    // only be the `competitionIds.size() <= 4` check doing its job, since
    // every other predicate (competition exists, matching grant) is satisfied
    // for every entry the rule actually inspects (indices 0-3).
    for (const cid of ids) {
      batch.set(doc(db, 'competitionAdmins', `${cid}_${UID}`), {
        competitionId: cid,
        userId: UID,
        groupId,
        grantedAt: serverTimestamp(),
      });
    }

    await assertFails(batch.commit());
  });

  it('allows (does not error on) a duplicate competitionId within competitionIds — documents current behavior: redundant entry, not an extra grant/privilege', async () => {
    const db = modularFirestore(testEnv.authenticatedContext(UID));
    const groupId = 'group-dup-competition';
    const joinCode = 'DUPCOMP1';

    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', groupId), {
      name: 'Duplicate Competition Group',
      competitionIds: [COMPETITION_ID, COMPETITION_ID], // same id twice
      createdBy: UID,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'groups', groupId, 'members', UID), { role: 'admin', joinedAt: serverTimestamp() });
    batch.set(doc(db, 'joinCodes', joinCode), { groupId, createdBy: UID, createdAt: serverTimestamp() });
    // Only one grant doc is possible/needed — competitionAdmins/{competitionId}_{uid}
    // is the same document id for both array entries, so there is no way to
    // create "two grants" for a duplicated id even if desired.
    batch.set(doc(db, 'competitionAdmins', `${COMPETITION_ID}_${UID}`), {
      competitionId: COMPETITION_ID,
      userId: UID,
      groupId,
      grantedAt: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });

  it('denies mutating competitionIds via update — adding a competition after creation', async () => {
    const groupId = 'group-immutable-add';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await seedGroup(modularFirestore(context), {
        groupId,
        competitionIds: [COMPETITION_ID],
        createdBy: UID,
      });
    });

    const db = modularFirestore(testEnv.authenticatedContext(UID));
    await assertFails(
      updateDoc(doc(db, 'groups', groupId), { competitionIds: [COMPETITION_ID, COMPETITION_ID_2] })
    );
  });

  it('denies mutating competitionIds via update — removing a competition after creation', async () => {
    const groupId = 'group-immutable-remove';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await seedGroup(modularFirestore(context), {
        groupId,
        competitionIds: [COMPETITION_ID, COMPETITION_ID_2],
        createdBy: UID,
      });
    });

    const db = modularFirestore(testEnv.authenticatedContext(UID));
    await assertFails(updateDoc(doc(db, 'groups', groupId), { competitionIds: [COMPETITION_ID] }));
  });

  it('denies a standalone competitionAdmins grant referencing an unrelated PRE-EXISTING group the requester neither created nor is a member of', async () => {
    const groupId = 'group-unrelated-preexisting';
    // Seeded by a completely different user; requester below has no
    // relationship to this group at all.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await seedGroup(modularFirestore(context), {
        groupId,
        competitionIds: [COMPETITION_ID, COMPETITION_ID_2],
        createdBy: OTHER_UID,
      });
    });

    const attackerUid = 'attacker-uid';
    const attackerDb = modularFirestore(testEnv.authenticatedContext(attackerUid));
    // Attacker tries to self-grant competitionAdmins for COMPETITION_ID_2,
    // which IS in this unrelated group's competitionIds — the `in` check by
    // itself would pass. The requester's own createdBy tie-back must be what
    // blocks this, exactly as it did for the old `==` check pre-amendment.
    await assertFails(
      setDoc(doc(attackerDb, 'competitionAdmins', `${COMPETITION_ID_2}_${attackerUid}`), {
        competitionId: COMPETITION_ID_2,
        userId: attackerUid,
        groupId,
        grantedAt: serverTimestamp(),
      })
    );
  });

  it('denies a standalone competitionAdmins grant from a regular (non-creator) MEMBER of the referenced pre-existing group', async () => {
    const groupId = 'group-member-not-creator';
    const memberUid = 'plain-member-uid';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await seedGroup(modularFirestore(context), {
        groupId,
        competitionIds: [COMPETITION_ID, COMPETITION_ID_2],
        createdBy: OTHER_UID,
        memberIds: [memberUid],
      });
    });

    const memberDb = modularFirestore(testEnv.authenticatedContext(memberUid));
    // Being a genuine member (not the creator) of a group that legitimately
    // tracks COMPETITION_ID_2 must NOT be enough to self-grant competition
    // admin for it — only the group's createdBy may ever create grants tied
    // to that group.
    await assertFails(
      setDoc(doc(memberDb, 'competitionAdmins', `${COMPETITION_ID_2}_${memberUid}`), {
        competitionId: COMPETITION_ID_2,
        userId: memberUid,
        groupId,
        grantedAt: serverTimestamp(),
      })
    );
  });
});
