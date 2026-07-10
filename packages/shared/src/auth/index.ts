// AuthProvider interface + shared types only — per architecture-v1.md §6,
// implementations (EmulatorDevAuthProvider, GoogleSignInAuthProvider) are
// platform code that live in apps/mobile, wrapping the Firebase JS SDK
// directly. Out of scope here.

export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
}

export type Unsubscribe = () => void;

export interface AuthProvider {
  getCurrentUser(): AuthUser | null;
  onAuthStateChanged(cb: (user: AuthUser | null) => void): Unsubscribe;
  signOut(): Promise<void>;
}
