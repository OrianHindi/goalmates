import { SEED_USERS } from '@goalmates/shared/seed';
import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { Avatar, Chip } from '../components/ui';
import { colors } from '../components/theme';

export function LoginScreen() {
  const { signInAsSeedUser } = useAuth();
  const [signingInAs, setSigningInAs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleTap(uid: string) {
    setError(null);
    setSigningInAs(uid);
    try {
      await signInAsSeedUser(uid);
      // Navigation to GroupsList happens automatically -- RootNavigator
      // swaps stacks based on auth state.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setSigningInAs(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.logo}>⚽</Text>
        <Text style={styles.title}>GoalMates</Text>
        <View style={{ marginTop: 10 }}>
          <Chip label="🧪 EMULATOR · DEV ONLY" tone="locked" />
        </View>
        <Text style={styles.subtitle}>Tap a seeded account to sign in -- real Google Sign-In arrives later, same screens.</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={SEED_USERS}
        keyExtractor={(u) => u.uid}
        contentContainerStyle={{ paddingHorizontal: 18 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => handleTap(item.uid)}
            disabled={signingInAs !== null}
            style={[styles.card, signingInAs === item.uid && { opacity: 0.6 }]}
          >
            <Avatar uid={item.uid} name={item.displayName} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.name}>{item.displayName}</Text>
              <Text style={styles.email}>{item.email}</Text>
            </View>
            <Text style={{ color: '#c9ced1' }}>{'›'}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfcfb' },
  header: { alignItems: 'center', paddingTop: 26, paddingBottom: 20, paddingHorizontal: 18 },
  logo: { fontSize: 40 },
  title: { fontSize: 22, fontWeight: '900', marginTop: 6 },
  subtitle: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 12 },
  error: { color: colors.danger, textAlign: 'center', marginBottom: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  name: { fontWeight: '800', fontSize: 14.5 },
  email: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
});
