import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../components/theme';
import { fetchFixturesForCompetitions, isFixtureLocked, submitFinalScore, type FixtureSummary } from '../lib/fixtures';
import { fetchGroup } from '../lib/groups';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminScoreEntry'>;

export function AdminScoreEntryScreen({ route, navigation }: Props) {
  const { groupId } = route.params;
  const [fixtures, setFixtures] = useState<FixtureSummary[] | null>(null);
  const [selected, setSelected] = useState<FixtureSummary | null>(null);
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const group = await fetchGroup(groupId);
      if (!group) return;
      const all = await fetchFixturesForCompetitions(group.competitionIds);
      // Only fixtures at/after kickoff are eligible for score entry, per
      // product-spec-v1.md §3 -- a non-admin's write attempt is rejected
      // server-side too regardless of this client-side filter.
      setFixtures(all.filter((f) => isFixtureLocked(f)));
    })();
  }, [groupId]);

  function selectFixture(f: FixtureSummary) {
    setSelected(f);
    setHome(f.homeScore ?? 0);
    setAway(f.awayScore ?? 0);
    setError(null);
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await submitFinalScore({ fixtureId: selected.fixtureId, homeScore: home, awayScore: away });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed -- only a competition admin can enter scores.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back}>
          <Text>{'←'}</Text>
        </Pressable>
        <Text style={styles.title}>Enter final score</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 100 }}>
        <Text style={styles.label}>Fixture</Text>
        {fixtures === null ? (
          <ActivityIndicator />
        ) : fixtures.length === 0 ? (
          <Text style={styles.empty}>No fixtures have kicked off yet -- nothing to score.</Text>
        ) : (
          fixtures.map((f) => (
            <Pressable
              key={f.fixtureId}
              onPress={() => selectFixture(f)}
              style={[styles.pickRow, selected?.fixtureId === f.fixtureId && styles.pickRowSelected]}
            >
              <Text style={styles.pickLabel}>
                {f.homeTeam} vs {f.awayTeam}
              </Text>
              <Text style={styles.pickMeta}>{f.status === 'FINISHED' ? `Final ${f.homeScore}–${f.awayScore} (tap to correct)` : 'Kicked off, no result yet'}</Text>
            </Pressable>
          ))
        )}

        {selected && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.label}>Final score</Text>
            <View style={styles.scoreCard}>
              <View style={styles.stepper}>
                <StepperSide value={home} onChange={setHome} />
                <Text style={styles.dash}>–</Text>
                <StepperSide value={away} onChange={setAway} />
              </View>
            </View>
            <Text style={styles.hint}>
              {selected.homeTeam} {home} – {away} {selected.awayTeam}. Everyone’s points recompute the moment you save.
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        )}
      </ScrollView>

      {selected && (
        <View style={styles.footer}>
          <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : '💾 Save final score'}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function StepperSide({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable style={styles.stepperBtn} onPress={() => onChange(Math.max(0, value - 1))}>
        <Text style={styles.stepperBtnText}>−</Text>
      </Pressable>
      <View style={styles.stepperNum}>
        <Text style={styles.stepperNumText}>{value}</Text>
      </View>
      <Pressable style={styles.stepperBtn} onPress={() => onChange(value + 1)}>
        <Text style={styles.stepperBtnText}>＋</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfcfb' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  back: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f1f2f3', alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '800', fontSize: 15 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 8 },
  empty: { color: colors.muted, fontSize: 13 },
  pickRow: { borderWidth: 2, borderColor: colors.line, borderRadius: 14, padding: 14, marginBottom: 10 },
  pickRowSelected: { borderColor: colors.gold, backgroundColor: colors.goldLight },
  pickLabel: { fontWeight: '700', fontSize: 14 },
  pickMeta: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  scoreCard: { backgroundColor: '#fbfaf5', borderWidth: 1, borderColor: colors.gold, borderRadius: 18, padding: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#fff3cd', borderRadius: 14, padding: 12 },
  dash: { fontWeight: '900', fontSize: 16, color: '#8a5a00' },
  stepperBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  stepperNum: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stepperNumText: { color: '#8a5a00', fontWeight: '900', fontSize: 18 },
  hint: { fontSize: 13, color: colors.muted, marginTop: 10 },
  error: { color: colors.danger, marginTop: 10 },
  footer: { position: 'absolute', left: 18, right: 18, bottom: 20 },
  saveBtn: { backgroundColor: colors.gold, borderRadius: 14, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
