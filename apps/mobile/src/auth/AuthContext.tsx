import type { AuthUser } from '@goalmates/shared/auth';
import type { SeedUser } from '@goalmates/shared/seed';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { getFirebase } from '../firebase/config';
import { EmulatorDevAuthProvider } from './EmulatorDevAuthProvider';

interface AuthContextValue {
  user: AuthUser | null;
  initializing: boolean;
  signInAsSeedUser: (seedUserId: SeedUser['uid']) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProviderRoot({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const provider = useMemo(() => {
    const { auth } = getFirebase();
    return new EmulatorDevAuthProvider(auth);
  }, []);

  useEffect(() => {
    const unsubscribe = provider.onAuthStateChanged((u) => {
      setUser(u);
      setInitializing(false);
    });
    return unsubscribe;
  }, [provider]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      signInAsSeedUser: async (seedUserId) => {
        await provider.signInAsSeedUser(seedUserId);
      },
      signOut: () => provider.signOut(),
    }),
    [user, initializing, provider]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProviderRoot');
  return ctx;
}
