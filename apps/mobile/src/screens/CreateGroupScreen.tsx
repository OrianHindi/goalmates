import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';
import { colors } from '../components/theme';
import { createGroup, fetchCompetitions } from '../lib/groups';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateGroup'>;

const MAX_COMPETITIONS = 4; // amendment doc §3's verified Firestore rules ceiling

export function CreateGroupScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [competitions, setCompetitions] = useState<{ competitionId: string; name: string }[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCompetitions().then(setCompetitions);
  }, []);

  function toggle(competitionId: string) {
    setSelected((prev) => {
      if (prev.includes(competitionId)) return prev.filter((c) => c !== competitionId);
      if (prev.length >= MAX_COMPETITIONS) return prev;
      return [...prev, competitionId];
    });
  }

  async function handleSubmit() {
    if (!user || !name.trim() || selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { groupId, joinCode } = await createGroup({ name: name.trim(), competitionIds: selected, creatorUid: user.uid });
      navigation.replace('GroupCreated', { groupId, groupName: name.trim(), joinCode });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim().length > 0 && selected.length > 0 && !submitting;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 100 }}>
        <Text style={styles.title}>What’s the group called?</Text>
        <Text style={styles.sub}>Pick something the group will recognize -- competitions can’t be changed after creation.</Text>
        <Text style={styles.label}>Group name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. World Cup 2026 Squad" />

        <Text style={[styles.title, { fontSize: 18, marginTop: 26 }]}>Pick competitions</Text>
        <Text style={styles.sub}>Choose 1 to {MAX_COMPETITIONS} -- fixed for this group, forever.</Text>

        {competitions === null ? (
          <Text style={styles.sub}>Loading competitions…</Text>
        ) : (
          competitions.map((c) => {
            const isSelected = selected.includes(c.competitionId);
            return (
              <Pressable
                key={c.competitionId}
                onPress={() => toggle(c.competitionId)}
                style={[styles.pickRow, isSelected && styles.pickRowSelected]}
              >
                <Text style={[styles.pickLabel, isSelected && { color: colors.greenDark }]}>{c.name}</Text>
                <View style={[styles.checkbox, isSelected && styles.checkboxOn]} />
              </Pressable>
            );
          })
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Button title={submitting ? 'Creating…' : 'Create group →'} onPress={handleSubmit} disabled={!canSubmit} loading={submitting} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfcfb' },
  title: { fontSize: 21, fontWeight: '800', letterSpacing: -0.2 },
  sub: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 14 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 6 },
  input: { borderWidth: 2, borderColor: colors.line, borderRadius: 14, padding: 14, fontSize: 15 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  pickRowSelected: { borderColor: colors.green, backgroundColor: colors.greenLight },
  pickLabel: { fontWeight: '700', fontSize: 14.5 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: '#c9ced1' },
  checkboxOn: { backgroundColor: colors.green, borderColor: colors.green },
  error: { color: colors.danger, marginTop: 10 },
  footer: { position: 'absolute', left: 18, right: 18, bottom: 20 },
});
