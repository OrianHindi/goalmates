import {
  competitionAdminPath,
  competitionConverter,
  competitionsPath,
  groupConverter,
  groupMemberPath,
  groupMembersPath,
  groupPath,
  groupsPath,
  joinCodeConverter,
  joinCodePath,
  memberConverter,
  type GroupDoc,
  type MemberDoc,
  type MemberRole,
} from '@goalmates/shared/firestore';
import {
  collection,
  doc as docRef,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import { getFirebase } from '../firebase/config';
import { generateJoinCode } from './joinCode';
import { addKnownGroupId, getKnownGroupIds } from './localGroupIndex';

export interface GroupSummary {
  groupId: string;
  name: string;
  competitionIds: string[];
}

export interface MemberSummary {
  userId: string;
  role: MemberRole;
  joinedAt: MemberDoc['joinedAt'];
}

export async function fetchCompetitions(): Promise<{ competitionId: string; name: string }[]> {
  const { firestore } = getFirebase();
  const snap = await getDocs(collection(firestore, competitionsPath()).withConverter(competitionConverter));
  return snap.docs.map((d) => ({ competitionId: d.id, name: d.data().name }));
}

/** See src/lib/localGroupIndex.ts for why this is a device-local list, not a
 * server-side query. Skips any id that no longer resolves (e.g. bad local
 * state) instead of failing the whole screen. */
export async function fetchMyGroups(uid: string): Promise<GroupSummary[]> {
  const { firestore } = getFirebase();
  const ids = await getKnownGroupIds(uid);
  const groups: GroupSummary[] = [];
  for (const groupId of ids) {
    const snap = await getDoc(docRef(firestore, groupPath(groupId)).withConverter(groupConverter));
    if (snap.exists()) {
      groups.push({ groupId: snap.id, name: snap.data().name, competitionIds: snap.data().competitionIds });
    }
  }
  return groups;
}

export async function fetchGroup(groupId: string): Promise<(GroupDoc & { groupId: string }) | null> {
  const { firestore } = getFirebase();
  const snap = await getDoc(docRef(firestore, groupPath(groupId)).withConverter(groupConverter));
  return snap.exists() ? { groupId: snap.id, ...snap.data() } : null;
}

export async function fetchGroupMembers(groupId: string): Promise<MemberSummary[]> {
  const { firestore } = getFirebase();
  const snap = await getDocs(collection(firestore, groupMembersPath(groupId)).withConverter(memberConverter));
  return snap.docs.map((d) => ({ userId: d.id, role: d.data().role, joinedAt: d.data().joinedAt }));
}

const MAX_JOIN_CODE_ATTEMPTS = 5;

/**
 * Atomic group-creation batch, exactly per architecture-v1.md §3 and the
 * multi-competition amendment: group + creator's admin membership + joinCode
 * + one competitionAdmins grant per competitionIds entry (3 + N documents).
 * Retries with a fresh join code up to MAX_JOIN_CODE_ATTEMPTS times on a
 * permission-denied failure (the rules-encoded signal for "code collision" --
 * astronomically unlikely at this alphabet size, per the architecture doc,
 * but correctness, not likelihood, is why the loop exists).
 */
export async function createGroup(args: {
  name: string;
  competitionIds: string[];
  creatorUid: string;
}): Promise<{ groupId: string; joinCode: string }> {
  const { firestore } = getFirebase();
  const groupRef = docRef(collection(firestore, groupsPath()));
  const groupId = groupRef.id;

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt++) {
    const joinCode = generateJoinCode();
    const batch = writeBatch(firestore);

    batch.set(groupRef, {
      name: args.name,
      competitionIds: args.competitionIds,
      createdBy: args.creatorUid,
      createdAt: serverTimestamp(),
    });

    batch.set(docRef(firestore, groupMemberPath(groupId, args.creatorUid)), {
      role: 'admin',
      joinedAt: serverTimestamp(),
    });

    batch.set(docRef(firestore, joinCodePath(joinCode)), {
      groupId,
      createdBy: args.creatorUid,
      createdAt: serverTimestamp(),
    });

    for (const competitionId of args.competitionIds) {
      batch.set(docRef(firestore, competitionAdminPath(competitionId, args.creatorUid)), {
        competitionId,
        userId: args.creatorUid,
        groupId,
        grantedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      await addKnownGroupId(args.creatorUid, groupId);
      return { groupId, joinCode };
    } catch (err) {
      lastError = err;
      // Keep retrying with a fresh code -- see MAX_JOIN_CODE_ATTEMPTS doc
      // comment above. Any other rule failure (e.g. a real bug) will also
      // fail on every retry and surface via lastError once attempts are
      // exhausted, so this never silently swallows a real error.
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to create group after retries');
}

export type JoinGroupResult =
  | { status: 'joined'; groupId: string }
  | { status: 'already-member'; groupId: string }
  | { status: 'invalid-code' };

export async function joinGroupByCode(code: string, uid: string): Promise<JoinGroupResult> {
  const { firestore } = getFirebase();
  const codeSnap = await getDoc(docRef(firestore, joinCodePath(code)).withConverter(joinCodeConverter));
  if (!codeSnap.exists()) {
    return { status: 'invalid-code' };
  }
  const { groupId } = codeSnap.data();

  const memberRef = docRef(firestore, groupMemberPath(groupId, uid));
  const existingMember = await getDoc(memberRef.withConverter(memberConverter));
  if (existingMember.exists()) {
    await addKnownGroupId(uid, groupId);
    return { status: 'already-member', groupId };
  }

  const batch = writeBatch(firestore);
  batch.set(memberRef, { role: 'member', joinedAt: serverTimestamp() });
  await batch.commit();
  await addKnownGroupId(uid, groupId);
  return { status: 'joined', groupId };
}
