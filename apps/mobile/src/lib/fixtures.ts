import { fixtureConverter, fixturePath, fixturesPath, type FixtureDoc } from '@goalmates/shared/firestore';
import { collection, doc as docRef, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';

import { getFirebase } from '../firebase/config';

export interface FixtureSummary extends FixtureDoc {
  fixtureId: string;
}

export async function fetchFixturesForCompetitions(competitionIds: string[]): Promise<FixtureSummary[]> {
  const { firestore } = getFirebase();
  const results: FixtureSummary[] = [];
  // Single-field equality per competitionId -- auto-indexed, no composite
  // index needed (architecture-v1.md §5). `in` would need <=30 values;
  // competitionIds is capped at 4 (amendment doc §3), so a plain loop of
  // per-competition queries keeps this simple and avoids the `in` operator
  // entirely.
  for (const competitionId of competitionIds) {
    const snap = await getDocs(
      query(collection(firestore, fixturesPath()).withConverter(fixtureConverter), where('competitionId', '==', competitionId))
    );
    for (const d of snap.docs) {
      results.push({ fixtureId: d.id, ...d.data() });
    }
  }
  results.sort((a, b) => a.kickoffAt.toMillis() - b.kickoffAt.toMillis());
  return results;
}

export async function fetchFixture(fixtureId: string): Promise<FixtureSummary | null> {
  const { firestore } = getFirebase();
  const snap = await getDoc(docRef(firestore, fixturePath(fixtureId)).withConverter(fixtureConverter));
  return snap.exists() ? { fixtureId: snap.id, ...snap.data() } : null;
}

export function isFixtureLocked(fixture: Pick<FixtureDoc, 'kickoffAt'>): boolean {
  return Date.now() >= fixture.kickoffAt.toMillis();
}

/**
 * Admin-only final score entry/correction. Only status/homeScore/awayScore
 * may ever change (firestore.rules pins every other field immutable) --
 * enforcing that here too keeps the update payload minimal and matches the
 * rule exactly. A non-admin's attempt is rejected server-side regardless of
 * this client-side check (see AdminScoreEntryScreen for the UX-only gate).
 */
export async function submitFinalScore(args: {
  fixtureId: string;
  homeScore: number;
  awayScore: number;
}): Promise<void> {
  const { firestore } = getFirebase();
  await updateDoc(docRef(firestore, fixturePath(args.fixtureId)), {
    status: 'FINISHED',
    homeScore: args.homeScore,
    awayScore: args.awayScore,
  });
}
