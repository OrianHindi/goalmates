// Firebase JS SDK bootstrap. Per architecture-v1.md §6, the emulator-vs-real
// swap is pure config: which values go into initializeApp() and whether
// connectFirestoreEmulator()/connectAuthEmulator() are called, gated by
// EXPO_PUBLIC_USE_FIREBASE_EMULATOR. Expo only exposes env vars prefixed
// EXPO_PUBLIC_ to client code -- everything read here uses that prefix.
import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

// Matches .firebaserc's "default" project id -- the emulator suite runs
// fully offline against this placeholder, never reaching real GCP.
const EMULATOR_PROJECT_ID = 'goalmates-dev-placeholder';

const USE_EMULATOR = process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR !== 'false';

// A physical device can't reach a laptop's 127.0.0.1 -- set this to the dev
// machine's LAN IP (e.g. 192.168.1.23) when testing on a phone. Defaults to
// localhost, which is correct for `expo start --web` and iOS Simulator /
// Android Emulator via the standard host-loopback mapping Expo already
// handles for Metro's own bundle server.
const EMULATOR_HOST = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? '127.0.0.1';
const FIRESTORE_EMULATOR_PORT = 8080;
const AUTH_EMULATOR_PORT = 9099;

function buildFirebaseConfig() {
  if (USE_EMULATOR) {
    // The Auth/Firestore emulators don't validate these values -- only
    // projectId must match .firebaserc / firebase.json's singleProjectMode
    // setup. apiKey/appId are non-empty placeholders because the SDK
    // requires *some* string, not a real one.
    return {
      apiKey: 'demo-emulator-api-key',
      projectId: EMULATOR_PROJECT_ID,
      appId: 'demo-emulator-app-id',
    };
  }

  // Real project config, for later (founder action -- see architecture-v1.md
  // §6). Every value below is required once USE_EMULATOR is false.
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  };
}

let app: FirebaseApp;
let auth: Auth;
let firestore: Firestore;
let emulatorsConnected = false;

/** Idempotent -- safe to call from multiple modules at import time. */
export function getFirebase(): { app: FirebaseApp; auth: Auth; firestore: Firestore } {
  if (getApps().length === 0) {
    app = initializeApp(buildFirebaseConfig());
  } else {
    app = getApps()[0]!;
  }

  auth ??= getAuth(app);
  firestore ??= getFirestore(app);

  if (USE_EMULATOR && !emulatorsConnected) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
    connectFirestoreEmulator(firestore, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
    emulatorsConnected = true;
  }

  return { app, auth, firestore };
}

export const isUsingEmulator = USE_EMULATOR;
