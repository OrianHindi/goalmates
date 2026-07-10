// Dev-only AuthProvider implementation, per architecture-v1.md §6. Wraps the
// Firebase JS SDK directly (platform code, not packages/shared) against the
// Auth emulator. GoogleSignInAuthProvider is explicitly out of scope --
// founder action for later, once a real Firebase project + OAuth client
// exist -- and drops in as a second AuthProvider implementation with no
// call-site changes anywhere else in the app.
import type { AuthProvider, AuthUser, Unsubscribe } from '@goalmates/shared/auth';
import {
  onAuthStateChanged as fbOnAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type Auth,
} from 'firebase/auth';

import { SEED_DEV_PASSWORD, SEED_USERS, type SeedUser } from '@goalmates/shared/seed';

function toAuthUser(user: { uid: string; displayName: string | null; email: string | null }): AuthUser {
  return { uid: user.uid, displayName: user.displayName, email: user.email };
}

export class EmulatorDevAuthProvider implements AuthProvider {
  constructor(private readonly auth: Auth) {}

  getCurrentUser(): AuthUser | null {
    const user = this.auth.currentUser;
    return user ? toAuthUser(user) : null;
  }

  onAuthStateChanged(cb: (user: AuthUser | null) => void): Unsubscribe {
    return fbOnAuthStateChanged(this.auth, (user) => cb(user ? toAuthUser(user) : null));
  }

  async signOut(): Promise<void> {
    await fbSignOut(this.auth);
  }

  /**
   * Dev-only: signs in as one of packages/shared's seeded test users via a
   * real `signInWithEmailAndPassword` call against the Auth emulator (not a
   * fake cookie/session) -- this is the login picker's tap handler.
   */
  async signInAsSeedUser(seedUserId: SeedUser['uid']): Promise<AuthUser> {
    const seedUser = SEED_USERS.find((u) => u.uid === seedUserId);
    if (!seedUser) {
      throw new Error(`Unknown seed user id: ${seedUserId}`);
    }
    const credential = await signInWithEmailAndPassword(this.auth, seedUser.email, SEED_DEV_PASSWORD);
    return toAuthUser(credential.user);
  }
}
