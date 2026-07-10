// Seeds the local Firebase Emulator Suite (Firestore + Auth) with demo
// data for manual dev/testing. Uses the Admin SDK, which bypasses
// firestore.rules entirely (correct — rules should never gate the seed
// script) but every document shape below still matches
// docs/architecture-v1.md §2 exactly, since the app and the rules both
// assume that shape.
//
// Run (after `pnpm emulators` is already up in another terminal):
//   pnpm seed
//
// Re-running against a live emulator is NOT a clean reset — Auth users
// and Firestore docs from a previous run remain (createUser calls for
// already-existing seed users are caught and skipped; Firestore writes
// below are all idempotent overwrites of the same doc IDs). For a fully
// clean reseed, restart the emulator (data doesn't persist by default) or
// clear Firestore emulator data first via its REST endpoint:
//   DELETE http://127.0.0.1:8080/emulator/v1/projects/<project-id>/databases/(default)/documents

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type WriteBatch } from 'firebase-admin/firestore';

import {
  SEED_BETS,
  SEED_COMPETITIONS,
  SEED_DEV_PASSWORD,
  SEED_FIXTURES,
  SEED_GROUP,
  SEED_GROUP_MEMBERS,
  SEED_USERS,
} from '@goalmates/shared/seed';

const PROJECT_ID = 'goalmates-dev-placeholder'; // matches .firebaserc "default"

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ??= PROJECT_ID;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}

const auth = getAuth();
const db = getFirestore();

function minutesFromNow(minutes: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + minutes * 60_000);
}

async function seedAuthUsersAndProfiles(): Promise<void> {
  for (const user of SEED_USERS) {
    try {
      await auth.createUser({
        uid: user.uid,
        email: user.email,
        password: SEED_DEV_PASSWORD,
        displayName: user.displayName,
      });
      console.log(`  created auth user ${user.email} (${user.uid})`);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
        console.log(`  auth user ${user.email} already exists, skipping`);
      } else {
        throw err;
      }
    }

    await db.collection('users').doc(user.uid).set({
      displayName: user.displayName,
      photoURL: null,
    });
  }
}

async function seedCompetitions(): Promise<void> {
  for (const competition of Object.values(SEED_COMPETITIONS)) {
    await db.collection('competitions').doc(competition.competitionId).set({
      name: competition.name,
    });
  }
  console.log(`  wrote ${Object.values(SEED_COMPETITIONS).length} competitions`);
}

async function seedFixtures(): Promise<void> {
  for (const fixture of SEED_FIXTURES) {
    await db.collection('fixtures').doc(fixture.fixtureId).set({
      competitionId: fixture.competitionId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      kickoffAt: minutesFromNow(fixture.kickoffOffsetMinutes),
      status: fixture.status,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      externalRef: null,
    });
  }
  const nearFuture = SEED_FIXTURES.filter((f) => f.status === 'SCHEDULED' && f.kickoffOffsetMinutes > 0 && f.kickoffOffsetMinutes <= 15);
  console.log(`  wrote ${SEED_FIXTURES.length} fixtures (${nearFuture.length} scheduled within 15 min, for lock-testing)`);
}

async function seedDemoGroup(): Promise<void> {
  // Same atomic 4-document shape the real client batch write uses (group +
  // creator's admin-membership doc + joinCode doc + competitionAdmins
  // grant) — Admin SDK bypasses rules, but match the shape exactly, and
  // write as one batch for hygiene/consistency with the real client flow.
  const batch: WriteBatch = db.batch();

  const groupRef = db.collection('groups').doc(SEED_GROUP.groupId);
  batch.set(groupRef, {
    name: SEED_GROUP.name,
    competitionId: SEED_GROUP.competitionId,
    createdBy: SEED_GROUP.createdBy,
    createdAt: Timestamp.now(),
  });

  for (const membership of SEED_GROUP_MEMBERS) {
    const memberRef = groupRef.collection('members').doc(membership.userId);
    batch.set(memberRef, {
      role: membership.role,
      joinedAt: minutesFromNow(membership.joinedOffsetMinutes),
    });
  }

  const joinCodeRef = db.collection('joinCodes').doc(SEED_GROUP.joinCode);
  batch.set(joinCodeRef, {
    groupId: SEED_GROUP.groupId,
    createdBy: SEED_GROUP.createdBy,
    createdAt: Timestamp.now(),
  });

  // Only the creator/admin gets a competitionAdmins grant — v1 has exactly
  // one admin per group (see architecture-v1.md §2).
  const grantRef = db.collection('competitionAdmins').doc(`${SEED_GROUP.competitionId}_${SEED_GROUP.createdBy}`);
  batch.set(grantRef, {
    competitionId: SEED_GROUP.competitionId,
    userId: SEED_GROUP.createdBy,
    groupId: SEED_GROUP.groupId,
    grantedAt: Timestamp.now(),
  });

  await batch.commit();
  console.log(`  wrote demo group "${SEED_GROUP.name}" (join code ${SEED_GROUP.joinCode}, ${SEED_GROUP_MEMBERS.length} members)`);
}

async function seedBets(): Promise<void> {
  const batch: WriteBatch = db.batch();
  for (const bet of SEED_BETS) {
    const betRef = db
      .collection('groups')
      .doc(SEED_GROUP.groupId)
      .collection('bets')
      .doc(`${bet.userId}_${bet.fixtureId}`);
    batch.set(betRef, {
      userId: bet.userId,
      fixtureId: bet.fixtureId,
      predictedHome: bet.predictedHome,
      predictedAway: bet.predictedAway,
      updatedAt: Timestamp.now(),
    });
  }
  await batch.commit();
  console.log(`  wrote ${SEED_BETS.length} bets`);
}

async function main(): Promise<void> {
  console.log(`Seeding emulator (project: ${PROJECT_ID})`);
  console.log(` firestore: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(` auth:      ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);

  console.log('Auth users + profiles...');
  await seedAuthUsersAndProfiles();

  console.log('Competitions...');
  await seedCompetitions();

  console.log('Fixtures...');
  await seedFixtures();

  console.log('Demo group...');
  await seedDemoGroup();

  console.log('Bets...');
  await seedBets();

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
