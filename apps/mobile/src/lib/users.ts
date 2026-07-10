import { userConverter, usersPath } from '@goalmates/shared/firestore';
import { collection, doc as docRef, documentId, getDoc, getDocs, query, where } from 'firebase/firestore';

import { getFirebase } from '../firebase/config';

export interface UserSummary {
  uid: string;
  displayName: string;
}

/** Batched lookup (Firestore `in` supports up to 30 ids per query). */
export async function getUsersByIds(uids: string[]): Promise<Map<string, UserSummary>> {
  const { firestore } = getFirebase();
  const result = new Map<string, UserSummary>();
  if (uids.length === 0) return result;

  const unique = Array.from(new Set(uids));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));

  for (const chunk of chunks) {
    const snap = await getDocs(
      query(collection(firestore, usersPath()).withConverter(userConverter), where(documentId(), 'in', chunk))
    );
    for (const d of snap.docs) {
      result.set(d.id, { uid: d.id, displayName: d.data().displayName });
    }
  }
  return result;
}

export async function getUser(uid: string): Promise<UserSummary | null> {
  const { firestore } = getFirebase();
  const snap = await getDoc(docRef(firestore, usersPath(), uid).withConverter(userConverter));
  return snap.exists() ? { uid: snap.id, displayName: snap.data().displayName } : null;
}
