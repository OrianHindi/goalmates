// Shared setup for the rules-unit-tests. Loads the ACTUAL committed
// `firestore.rules` file from the repo root — never reimplemented or
// mocked — and runs it against a real Firestore emulator instance via
// @firebase/rules-unit-testing. Requires the emulator to already be
// running (see root `pnpm test:rules`, which wraps this with
// `firebase emulators:exec`).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `@firebase/rules-unit-testing@5.x`'s `RulesTestContext.firestore()` is
 * typed as returning the legacy *compat* `firebase.firestore.Firestore`,
 * not the modular SDK's `Firestore` from `firebase/firestore` — a known
 * stale type in that package (see firebase/quickstart-testing's own
 * samples, which pass this same object straight into modular `doc()` /
 * `getDoc()` etc.). The object returned at runtime is fully compatible
 * with the modular SDK; only the TS type declaration lags. This helper
 * documents the cast in one place instead of scattering `as unknown as
 * Firestore` across every test file.
 */
export function modularFirestore(context: RulesTestContext): Firestore {
  return context.firestore() as unknown as Firestore;
}

// packages/shared/src/firestore-rules -> packages/shared/src -> packages/shared -> packages -> repo root
const RULES_FILE_PATH = resolve(__dirname, '../../../../firestore.rules');

const FIRESTORE_EMULATOR_HOST = '127.0.0.1';
const FIRESTORE_EMULATOR_PORT = 8080;

export async function createTestEnv(projectId: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(RULES_FILE_PATH, 'utf8'),
      host: FIRESTORE_EMULATOR_HOST,
      port: FIRESTORE_EMULATOR_PORT,
    },
  });
}

/** now() as a Firestore Timestamp, offset by some number of minutes. */
export function timestampMinutesFromNow(minutes: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + minutes * 60_000);
}

export interface SeedFixtureArgs {
  fixtureId: string;
  competitionId: string;
  kickoffAt: Timestamp;
  status: 'SCHEDULED' | 'FINISHED';
  homeScore?: number | null;
  awayScore?: number | null;
}

/** Seeds one fixture doc, bypassing rules (as the seed script/Admin SDK would). */
export async function seedFixture(db: Firestore, args: SeedFixtureArgs): Promise<void> {
  await setDoc(doc(db, 'fixtures', args.fixtureId), {
    competitionId: args.competitionId,
    homeTeam: 'Home Team',
    awayTeam: 'Away Team',
    kickoffAt: args.kickoffAt,
    status: args.status,
    homeScore: args.homeScore ?? null,
    awayScore: args.awayScore ?? null,
    externalRef: null,
  });
}

/** Seeds one competition doc, bypassing rules. */
export async function seedCompetition(db: Firestore, competitionId: string, name = 'Test Competition'): Promise<void> {
  await setDoc(doc(db, 'competitions', competitionId), { name });
}

export interface SeedGroupArgs {
  groupId: string;
  competitionId: string;
  createdBy: string;
  memberIds?: string[]; // extra members besides createdBy, all role: 'member'
}

/**
 * Seeds a full atomic group (group + admin membership + joinCode +
 * competitionAdmins grant), bypassing rules, exactly matching the shape the
 * real client batch write produces.
 */
export async function seedGroup(db: Firestore, args: SeedGroupArgs): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'groups', args.groupId), {
    name: 'Test Group',
    competitionId: args.competitionId,
    createdBy: args.createdBy,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'groups', args.groupId, 'members', args.createdBy), {
    role: 'admin',
    joinedAt: serverTimestamp(),
  });
  const joinCode = `J${args.groupId.slice(0, 5).toUpperCase()}`;
  batch.set(doc(db, 'joinCodes', joinCode), {
    groupId: args.groupId,
    createdBy: args.createdBy,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'competitionAdmins', `${args.competitionId}_${args.createdBy}`), {
    competitionId: args.competitionId,
    userId: args.createdBy,
    groupId: args.groupId,
    grantedAt: serverTimestamp(),
  });
  for (const memberId of args.memberIds ?? []) {
    batch.set(doc(db, 'groups', args.groupId, 'members', memberId), {
      role: 'member',
      joinedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export interface SeedBetArgs {
  groupId: string;
  userId: string;
  fixtureId: string;
  predictedHome?: number;
  predictedAway?: number;
}

export async function seedBet(db: Firestore, args: SeedBetArgs): Promise<void> {
  await setDoc(doc(db, 'groups', args.groupId, 'bets', `${args.userId}_${args.fixtureId}`), {
    userId: args.userId,
    fixtureId: args.fixtureId,
    predictedHome: args.predictedHome ?? 1,
    predictedAway: args.predictedAway ?? 0,
    updatedAt: serverTimestamp(),
  });
}
