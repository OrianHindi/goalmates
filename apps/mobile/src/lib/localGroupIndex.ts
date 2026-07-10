// Device-local index of "groups I belong to" -- see the PR description for
// why: `groups/{groupId}/members/{memberId}` has no field mirroring the
// member's uid (only role + joinedAt), and a Firestore collectionGroup
// query cannot filter by document ID using just the leaf segment (it needs
// a full path, which requires already knowing groupId -- circular). Making
// a cross-device "list my groups" query efficient would need either a
// denormalized `userGroups/{uid}/groups/{groupId}` mirror collection or a
// `userId` field added to MemberDoc (loosening its `hasOnly(['role',
// 'joinedAt'])` rule) -- both are firestore.rules edits, out of scope for
// this PR per the hard precondition not to touch the rules file.
//
// This is the pragmatic, zero-rules-change alternative: remember which
// groupIds this device has created/joined, then hydrate "my groups" with
// direct per-id `getDoc` calls (each legal under the existing
// `allow read: if isMember(groupId)` rule, since the caller really is a
// member). Tradeoff, stated plainly: this list is per-device, not synced
// server-side -- a fresh install or a second device starts empty and can
// only recover membership by re-joining via join code (the founder/admin
// can always re-share it; nothing is lost server-side, only the local
// "which groups are mine" shortcut).
import AsyncStorage from '@react-native-async-storage/async-storage';

function storageKey(uid: string): string {
  return `@goalmates/knownGroupIds:${uid}`;
}

export async function getKnownGroupIds(uid: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(storageKey(uid));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function addKnownGroupId(uid: string, groupId: string): Promise<void> {
  const existing = await getKnownGroupIds(uid);
  if (existing.includes(groupId)) return;
  await AsyncStorage.setItem(storageKey(uid), JSON.stringify([...existing, groupId]));
}
