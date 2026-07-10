// Typed Firestore converters (snapshot <-> plain object), modular SDK
// (v9+) `FirestoreDataConverter` style. Every document shape here is a
// plain data object with no methods, so the converter logic is identical
// for all of them — one generic factory instead of repeating the same
// four lines per type.
import type {
  DocumentData,
  FirestoreDataConverter,
  PartialWithFieldValue,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
} from 'firebase/firestore';

import type {
  BetDoc,
  CompetitionAdminDoc,
  CompetitionDoc,
  FixtureDoc,
  GroupDoc,
  JoinCodeDoc,
  MemberDoc,
  UserDoc,
} from './types';

function makeConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: WithFieldValue<T> | PartialWithFieldValue<T>): DocumentData {
      return data as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): T {
      return snapshot.data(options) as T;
    },
  };
}

export const userConverter = makeConverter<UserDoc>();
export const groupConverter = makeConverter<GroupDoc>();
export const memberConverter = makeConverter<MemberDoc>();
export const competitionConverter = makeConverter<CompetitionDoc>();
export const fixtureConverter = makeConverter<FixtureDoc>();
export const joinCodeConverter = makeConverter<JoinCodeDoc>();
export const competitionAdminConverter = makeConverter<CompetitionAdminDoc>();
export const betConverter = makeConverter<BetDoc>();
