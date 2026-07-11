import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { scoreForBet } from '@goalmates/shared/scoring';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { colors } from '../components/theme';
import { fetchBetsForLockedFixture, fetchMyBet, placeBet, type BetSummary } from '../lib/bets';
import { fetchFixture, isFixtureLocked, type FixtureSummary } from '../lib/fixtures';
import { fetchGroupMembers, type MemberSummary } from '../lib/groups';
import { getUsersByIds, type UserSummary } from '../lib/users';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'FixtureDetail'>;

export function FixtureDetailScreen({ route, navigation }: Props) {
  const { groupId, fixtureId } = route.params;
  const { user } = useAuth();

  const [fixture, setFixture] = useState<FixtureSummary | null>(null);
  const [myBet, setMyBet] = useState<BetSummary | null>(null);
  const [allBets, setAllBets] = useState<BetSummary[] | null>(null);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [usersByUid, setUsersByUid] = useState<Map<string, UserSummary>>(new Map());
  const [draftHome, setDraftHome] = useState(0);
  const [draftAway, setDraftAway] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const f = await fetchFixture(fixtureId);
    setFixture(f);
    if (!f) return;

    const mine = await fetchMyBet(groupId, fixtureId, user.uid);
    setMyBet(mine);
    setDraftHome(mine?.predictedHome ?? 0);
    setDraftAway(mine?.predictedAway ?? 0);

    if (isFixtureLocked(f)) {
      // Everyone's bets become readable exactly at kickoff, per
      // firestore.rules -- see lib/bets.ts's fetchBetsForLockedFixture doc
      // comment for why this query would be REJECTED entirely pre-kickoff.
      const [bets, memberList] = await Promise.all([fetchBetsForLockedFixture(groupId, fixtureId), fetchGroupMembers(groupId)]);
      setAllBets(bets);
      setMembers(memberList);
      setUsersByUid(await getUsersByIds(memberList.map((m) => m.userId)));
    } else {
      setAllBets(null);
    }
  }, [fixtureId, groupId, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // No onSnapshot listener here (this app is one-time getDoc/getDocs reads
  // everywhere -- see load() above and lib/fixtures.ts). A LIVE fixture is
  // the one state where that staleness actually matters, since its score
  // keeps changing while the user is sitting on this exact screen. Pull-to-
  // refresh re-runs the same `load()` this screen already calls on focus --
  // the smallest addition, no new data-fetching mechanism.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!fixture || !user) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  const locked = isFixtureLocked(fixture);
  const finished = fixture.status === 'FINISHED';
  const live = fixture.status === 'LIVE';

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await placeBet({ groupId, fixtureId, uid: user!.uid, predictedHome: draftHome, predictedAway: draftAway });
      await load();
    } catch (err) {
      // Most likely cause: kickoff passed between screen load and save --
      // firestore.rules rejects the write server-side regardless of what
      // the UI believed the lock state was a moment ago.
      setError(err instanceof Error ? err.message : 'Could not save -- this fixture may have just kicked off.');
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
        <Text style={styles.title} numberOfLines={1}>
          {fixture.homeTeam} vs {fixture.awayTeam}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 18 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {finished ? (
          <View style={styles.finalBanner}>
            <Text style={styles.finalTag}>FULL TIME</Text>
            <Text style={styles.finalScore}>
              {fixture.homeScore} – {fixture.awayScore}
            </Text>
            <Text style={styles.finalTeams}>
              {fixture.homeTeam} vs {fixture.awayTeam}
            </Text>
          </View>
        ) : live ? (
          <View style={styles.liveBanner}>
            <View style={styles.liveTagRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveTag}>🔴 LIVE</Text>
            </View>
            <Text style={styles.liveScore}>
              {fixture.homeScore} – {fixture.awayScore}
            </Text>
            <Text style={styles.liveTeams}>
              {fixture.homeTeam} vs {fixture.awayTeam}
            </Text>
            <Text style={styles.liveNote}>Updates as the match is played — pull down to refresh</Text>
          </View>
        ) : locked ? (
          <View style={styles.lockBanner}>
            <Text style={styles.lockBannerText}>🔒 LOCKED — kickoff passed, waiting for final score</Text>
          </View>
        ) : (
          <View style={styles.openHero}>
            <Text style={styles.heroSub}>Your bet — editable until kickoff</Text>
            <Stepper
              home={draftHome}
              away={draftAway}
              onChangeHome={setDraftHome}
              onChangeAway={setDraftAway}
              disabled={saving}
            />
          </View>
        )}

        {!finished && !locked && (
          <View style={{ marginTop: 14 }}>
            <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : myBet ? 'Update bet' : 'Save bet'}</Text>
            </Pressable>
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        )}

        {locked && !finished && myBet && (
          <View style={{ marginTop: 4 }}>
            <Text style={styles.sectionLabel}>YOUR BET — LOCKED, READ-ONLY</Text>
            <Text style={styles.readonlyScore}>
              {myBet.predictedHome} – {myBet.predictedAway}
            </Text>
          </View>
        )}
        {locked && !finished && !myBet && <Text style={styles.sectionLabel}>YOU DIDN’T PLACE A BET ON THIS FIXTURE</Text>}

        {!locked && !finished && (
          <View style={styles.privacyCard}>
            <Text style={styles.privacyText}>
              🔐 Friends’ bets are hidden until kickoff -- you’ll see everyone’s predictions the moment this fixture kicks off, even
              before the final score is in.
            </Text>
          </View>
        )}

        {locked && allBets && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionLabel}>{finished ? "EVERYONE'S BETS & POINTS" : 'ALL BETS — REVEALED NOW, POINTS PENDING'}</Text>
            {/* Iterate the full member roster, not just members with a bet
                doc -- a member who never bet still gets an explicit
                "no bet placed" / 0 pts row, per product-spec-v1.md §3's
                edge case and the approved mockup's frame 5c (Tal Ben-David). */}
            {members.map((m) => {
              const bet = allBets.find((b) => b.userId === m.userId);
              const result = finished
                ? scoreForBet(
                    bet ? { predictedHome: bet.predictedHome, predictedAway: bet.predictedAway } : null,
                    { status: 'FINISHED', homeScore: fixture.homeScore!, awayScore: fixture.awayScore! }
                  )
                : null;
              return (
                <View key={m.userId} style={styles.betRow}>
                  <Text style={styles.betWho}>
                    {usersByUid.get(m.userId)?.displayName ?? 'Unknown'}
                    {m.userId === user.uid ? ' (you)' : ''}
                    {!bet && <Text style={{ fontWeight: '500', color: colors.muted }}> · no bet placed</Text>}
                  </Text>
                  <Text style={styles.betScore}>{bet ? `${bet.predictedHome}–${bet.predictedAway}` : '—'}</Text>
                  <Text style={styles.betPts}>
                    {!finished
                      ? bet
                        ? 'pending'
                        : '0 pts'
                      : result!.isExact
                        ? `🎯 ${result!.points} pts`
                        : result!.isDirection
                          ? `↗ ${result!.points} pt`
                          : `${result!.points} pts`}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stepper({
  home,
  away,
  onChangeHome,
  onChangeAway,
  disabled,
}: {
  home: number;
  away: number;
  onChangeHome: (v: number) => void;
  onChangeAway: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.stepper}>
      <StepperSide value={home} onChange={onChangeHome} disabled={disabled} />
      <Text style={styles.stepperDash}>–</Text>
      <StepperSide value={away} onChange={onChangeAway} disabled={disabled} />
    </View>
  );
}

function StepperSide({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable style={styles.stepperBtn} disabled={disabled} onPress={() => onChange(Math.max(0, value - 1))}>
        <Text style={styles.stepperBtnText}>−</Text>
      </Pressable>
      <View style={styles.stepperNum}>
        <Text style={styles.stepperNumText}>{value}</Text>
      </View>
      <Pressable style={styles.stepperBtn} disabled={disabled} onPress={() => onChange(value + 1)}>
        <Text style={styles.stepperBtnText}>＋</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfcfb' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  back: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f1f2f3', alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '800', fontSize: 15, flex: 1, textAlign: 'center' },
  openHero: { backgroundColor: colors.green, borderRadius: 20, padding: 18 },
  heroSub: { color: '#fff', textAlign: 'center', fontSize: 11, fontWeight: '700', opacity: 0.9, marginBottom: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 12 },
  stepperDash: { color: '#fff', fontWeight: '900', fontSize: 16 },
  stepperBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { color: colors.greenDark, fontWeight: '900', fontSize: 15 },
  stepperNum: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stepperNumText: { color: colors.greenDark, fontWeight: '900', fontSize: 18 },
  saveBtn: { backgroundColor: colors.green, borderRadius: 14, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  error: { color: colors.danger, marginTop: 10, textAlign: 'center' },
  lockBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eceef0', borderRadius: 12, padding: 12 },
  lockBannerText: { color: '#5b636a', fontWeight: '800', fontSize: 12 },
  liveBanner: { alignItems: 'center', backgroundColor: colors.dangerLight, borderRadius: 16, padding: 16 },
  liveTagRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  liveTag: { fontSize: 11, fontWeight: '800', color: colors.danger, opacity: 0.9 },
  liveScore: { fontSize: 30, fontWeight: '900', color: colors.danger, marginVertical: 4 },
  liveTeams: { fontSize: 12.5, fontWeight: '700', color: '#8a2020' },
  liveNote: { fontSize: 11, color: '#8a2020', opacity: 0.75, marginTop: 4 },
  finalBanner: { alignItems: 'center', backgroundColor: colors.blueLight, borderRadius: 16, padding: 16 },
  finalTag: { fontSize: 11, fontWeight: '800', color: colors.blue, opacity: 0.8 },
  finalScore: { fontSize: 30, fontWeight: '900', color: colors.blue, marginVertical: 4 },
  finalTeams: { fontSize: 12.5, fontWeight: '700', color: '#33507a' },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', color: colors.muted, marginTop: 16, marginBottom: 8 },
  readonlyScore: { fontSize: 20, fontWeight: '800' },
  privacyCard: { backgroundColor: '#f1f2f3', borderRadius: 14, padding: 14, marginTop: 16 },
  privacyText: { fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  betRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f2f3', gap: 10 },
  betWho: { flex: 1, fontWeight: '700', fontSize: 13.5 },
  betScore: { fontWeight: '800', fontSize: 14.5, backgroundColor: '#f1f2f3', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 10, minWidth: 44, textAlign: 'center' },
  betPts: { fontWeight: '800', fontSize: 12.5, minWidth: 60, textAlign: 'right' },
});
