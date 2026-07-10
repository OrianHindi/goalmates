import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';
import { colors } from '../components/theme';
import { joinGroupByCode } from '../lib/groups';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'JoinGroup'>;

export function JoinGroupScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!user || code.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await joinGroupByCode(code.trim().toUpperCase(), user.uid);
      if (result.status === 'invalid-code') {
        setError("That code doesn't match any group. Double-check with your friend and try again.");
        setSubmitting(false);
        return;
      }
      // 'joined' or 'already-member' both land in the group.
      navigation.replace('GroupDetail', { groupId: result.groupId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join group');
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={{ padding: 18, flex: 1 }}>
        <Text style={styles.title}>Got a code?</Text>
        <Text style={styles.sub}>Ask whoever created the group for their 6-character code.</Text>

        <TextInput
          style={[styles.input, error && { borderColor: colors.danger }]}
          value={code}
          onChangeText={(t) => {
            setCode(t.toUpperCase().slice(0, 6));
            setError(null);
          }}
          placeholder="8Q3KXP"
          autoCapitalize="characters"
          maxLength={6}
        />

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Button
          title={submitting ? 'Joining…' : error ? 'Try again' : 'Join group'}
          onPress={handleSubmit}
          disabled={code.length !== 6}
          loading={submitting}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfcfb' },
  title: { fontSize: 21, fontWeight: '800', marginTop: 20 },
  sub: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 20 },
  input: {
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
  },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 14, padding: 12, marginTop: 14 },
  errorText: { color: '#8f1d1d', fontWeight: '600', fontSize: 13, lineHeight: 18 },
  footer: { paddingHorizontal: 18, paddingBottom: 20 },
});
