import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

import { createTestEnv, modularFirestore } from './setup';

const PROJECT_ID = 'goalmates-rules-test-users';

describe('users/{userId} rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createTestEnv(PROJECT_ID);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('lets a signed-in user create/update their own profile doc', async () => {
    const db = modularFirestore(testEnv.authenticatedContext('me-uid'));

    await assertSucceeds(setDoc(doc(db, 'users', 'me-uid'), { displayName: 'Me', photoURL: null }));
  });

  it('denies a user writing another user\'s profile doc (no impersonation)', async () => {
    const attackerDb = modularFirestore(testEnv.authenticatedContext('attacker-uid'));

    await assertFails(setDoc(doc(attackerDb, 'users', 'victim-uid'), { displayName: 'Impersonated', photoURL: null }));
  });

  it('denies an unauthenticated caller writing any profile doc', async () => {
    const anonDb = modularFirestore(testEnv.unauthenticatedContext());

    await assertFails(setDoc(doc(anonDb, 'users', 'someone-uid'), { displayName: 'Anon', photoURL: null }));
  });

  it('denies an empty displayName', async () => {
    const db = modularFirestore(testEnv.authenticatedContext('me-uid'));

    await assertFails(setDoc(doc(db, 'users', 'me-uid'), { displayName: '', photoURL: null }));
  });

  it('denies extra/unexpected fields on the profile doc', async () => {
    const db = modularFirestore(testEnv.authenticatedContext('me-uid'));

    await assertFails(
      setDoc(doc(db, 'users', 'me-uid'), { displayName: 'Me', photoURL: null, role: 'admin' })
    );
  });
});
