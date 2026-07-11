import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { Chip } from '../components/ui';
import { colors } from '../components/theme';
import { fetchBetsForFinishedFixtures } from '../lib/bets';
import { isFixtureLocked, fetchFixturesForCompetitions, type FixtureSummary } from '../lib/fixtures';
import { fetchCompetitions, fetchGroup, fetchGroupMembers, type MemberSummary } from '../lib/groups';
import { buildLeaderboard, fixturesForCompetition, type RankedStanding } from '../lib/leaderboard';
import { getUsersByIds, type UserSummary } from '../lib/users';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupDetail'>;

type TopTab = 'fixtures' | 'leaderboard';

function formatKickoff(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function countdown(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return 'Kicked off';
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

export function GroupDetailScreen({ route, navigation }: Props) {
  const { groupId } = route.params;
  const { user } = useAuth();
  const [topTab, setTopTab] = useState<TopTab>('fixtures');

  const [groupName, setGroupName] = useState<string>('');
  const [competitionIds, setCompetitionIds] = useState<string[]>([]);
  const [competitionNames, setCompetitionNames] = useState<Map<string, string>>(new Map());
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [usersByUid, setUsersByUid] = useState<Map<string, UserSummary>>(new Map());
  const [fixtures, setFixtures] = useState<FixtureSummary[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState<string>('ALL');
  const [standings, setStandings] = useState<RankedStanding[] | null>(null);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadGroup = useCallback(async () => {
    const group = await fetchGroup(groupId);
    if (!group) return;
    setGroupName(group.name);
    setCompetitionIds(group.competitionIds);
    setLeaderboardTab((prev) => (prev === 'ALL' && group.competitionIds.length === 1 ? group.competitionIds[0]! : prev));

    const [allCompetitions, memberList, fixtureList] = await Promise.all([
      fetchCompetitions(),
      fetchGroupMembers(groupId),
      fetchFixturesForCompetitions(group.competitionIds),
    ]);
    setCompetitionNames(new Map(allCompetitions.map((c) => [c.competitionId, c.name])));
    setMembers(memberList);
    setFixtures(fixtureList);
    setIsAdmin(memberList.some((m) => m.userId === user?.uid && m.role === 'admin'));

    const users = await getUsersByIds(memberList.map((m) => m.userId));
    setUsersByUid(users);
  }, [groupId, user?.uid]);

  useFocusEffect(
    useCallback(() => {
      loadGroup();
    }, [loadGroup])
  );

  // No real-time listener in this app (every read here is a one-time
  // getDoc/getDocs, refreshed on screen focus via useFocusEffect -- see
  // lib/fixtures.ts, lib/groups.ts). That's stale exactly once a fixture is
  // LIVE and its score is changing without the user navigating away and
  // back. Pull-to-refresh is the smallest addition that fits: it reuses the
  // same one-time-read `loadGroup` this screen already calls on focus,
  // rather than introducing onSnapshot (a bigger, screen-only divergence
  // from every other screen's data-fetching pattern) just for this one case.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGroup();
    setRefreshing(false);
  }, [loadGroup]);

  const loadLeaderboard = useCallback(
    async (tab: string) => {
      if (!fixtures) return;
      setLoadingLeaderboard(true);
      const relevantFixtures = fixturesForCompetition(fixtures, tab as string);
      const finishedIds = relevantFixtures.filter((f) => f.status === 'FINISHED').map((f) => f.fixtureId);
      const bets = await fetchBetsForFinishedFixtures(groupId, finishedIds);
      setStandings(buildLeaderboard(members, bets, relevantFixtures, usersByUid));
      setLoadingLeaderboard(false);
    },
    [fixtures, groupId, members, usersByUid]
  );

  useFocusEffect(
    useCallback(() => {
      if (topTab === 'leaderboard' && fixtures) {
        loadLeaderboard(leaderboardTab);
      }
    }, [topTab, leaderboardTab, fixtures, loadLeaderboard])
  );

  // LIVE is its own bucket, not folded into SCHEDULED or FINISHED -- a LIVE
  // fixture used to fall through both of the filters below and vanish from
  // the list entirely (docs/architecture-v1-amendment-livescore.md §6).
  const live = (fixtures ?? []).filter((f) => f.status === 'LIVE').sort((a, b) => a.kickoffAt.toMillis() - b.kickoffAt.toMillis());
  const nonFinished = (fixtures ?? []).filter((f) => f.status === 'SCHEDULED').sort((a, b) => a.kickoffAt.toMillis() - b.kickoffAt.toMillis());
  const finished = (fixtures ?? []).filter((f) => f.status === 'FINISHED').sort((a, b) => b.kickoffAt.toMillis() - a.kickoffAt.toMillis());
  const hero = nonFinished[0];
  const restUpcoming = nonFinished.slice(1);

  const leaderboardTabs = competitionIds.length > 1 ? [...competitionIds, 'ALL'] : competitionIds;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back}>
          <Text>{'←'}</Text>
        </Pressable>
        <Text style={styles.groupTitle} numberOfLines={1}>{groupName}</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.groupTabs}>
        <Pressable style={[styles.gTab, topTab === 'fixtures' && styles.gTabActive]} onPress={() => setTopTab('fixtures')}>
          <Text style={[styles.gTabText, topTab === 'fixtures' && styles.gTabTextActive]}>Fixtures</Text>
        </Pressable>
        <Pressable style={[styles.gTab, topTab === 'leaderboard' && styles.gTabActive]} onPress={() => setTopTab('leaderboard')}>
          <Text style={[styles.gTabText, topTab === 'leaderboard' && styles.gTabTextActive]}>Leaderboard</Text>
        </Pressable>
      </View>

      {isAdmin && (
        <Pressable style={styles.adminBar} onPress={() => navigation.navigate('AdminScoreEntry', { groupId })}>
          <Text style={styles.adminBarText}>⭐ Admin: enter/correct a final score</Text>
        </Pressable>
      )}

      {fixtures === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : topTab === 'fixtures' ? (
        <ScrollView
          contentContainerStyle={{ padding: 18 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {!hero && finished.length === 0 && live.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Text style={{ fontSize: 44, marginBottom: 10 }}>⚽</Text>
              <Text style={{ fontWeight: '700' }}>No fixtures yet</Text>
            </View>
          )}

          {live.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>🔴 LIVE NOW</Text>
              {live.map((f) => (
                <FixtureRow key={f.fixtureId} fixture={f} onPress={() => navigation.navigate('FixtureDetail', { groupId, fixtureId: f.fixtureId })} />
              ))}
            </>
          )}

          {hero && (
            <Pressable onPress={() => navigation.navigate('FixtureDetail', { groupId, fixtureId: hero.fixtureId })}>
              <View style={[styles.hero, isFixtureLocked(hero) && { backgroundColor: '#6b7278' }]}>
                <Text style={styles.heroMeta}>
                  {isFixtureLocked(hero) ? '🔒 LOCKED — waiting for result' : `⏱ KICKOFF IN ${countdown(hero.kickoffAt.toMillis())}`}
                </Text>
                <Text style={styles.heroTeams}>
                  {hero.homeTeam} vs {hero.awayTeam}
                </Text>
                <Text style={styles.heroTime}>{formatKickoff(hero.kickoffAt.toMillis())}</Text>
              </View>
            </Pressable>
          )}

          {restUpcoming.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>MORE FIXTURES</Text>
              {restUpcoming.map((f) => (
                <FixtureRow key={f.fixtureId} fixture={f} onPress={() => navigation.navigate('FixtureDetail', { groupId, fixtureId: f.fixtureId })} />
              ))}
            </>
          )}

          {finished.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>FINISHED</Text>
              {finished.map((f) => (
                <FixtureRow key={f.fixtureId} fixture={f} onPress={() => navigation.navigate('FixtureDetail', { groupId, fixtureId: f.fixtureId })} />
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {leaderboardTabs.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subTabs} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
              {leaderboardTabs.map((tabId) => (
                <Pressable
                  key={tabId}
                  onPress={() => {
                    setLeaderboardTab(tabId);
                    loadLeaderboard(tabId);
                  }}
                  style={[styles.subTab, leaderboardTab === tabId && styles.subTabActive]}
                >
                  <Text style={[styles.subTabText, leaderboardTab === tabId && styles.subTabTextActive]}>
                    {tabId === 'ALL' ? 'Combined' : (competitionNames.get(tabId) ?? tabId)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {loadingLeaderboard || standings === null ? (
            <ActivityIndicator style={{ marginTop: 40 }} />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 18 }}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, { width: 30 }]}>#</Text>
                <Text style={[styles.th, { flex: 1, textAlign: 'left' }]}>Player</Text>
                <Text style={[styles.th, { width: 40 }]}>PTS</Text>
                <Text style={[styles.th, { width: 50 }]}>🎯 Exact</Text>
                <Text style={[styles.th, { width: 40 }]}>↗ Dir</Text>
              </View>
              {standings.map((s) => (
                <View key={s.userId} style={[styles.tableRow, s.userId === user?.uid && { backgroundColor: colors.greenLight }]}>
                  <Text style={[styles.td, { width: 30 }]}>{s.rank}</Text>
                  <Text style={[styles.td, { flex: 1, textAlign: 'left' }]}>
                    {s.displayName}
                    {s.userId === user?.uid ? ' (you)' : ''}
                  </Text>
                  <Text style={[styles.td, { width: 40, color: colors.greenDark, fontWeight: '900' }]}>{s.totalPoints}</Text>
                  <Text style={[styles.td, { width: 50 }]}>{s.exactCount}</Text>
                  <Text style={[styles.td, { width: 40 }]}>{s.directionCount}</Text>
                </View>
              ))}
              <Text style={styles.tieBreakNote}>Ties break by points → exact hits → correct directions → who joined earliest.</Text>
            </ScrollView>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function FixtureRow({ fixture, onPress }: { fixture: FixtureSummary; onPress: () => void }) {
  const locked = isFixtureLocked(fixture);
  return (
    <Pressable style={styles.fxCompact} onPress={onPress}>
      <View>
        <Text style={styles.fxTeams}>
          {fixture.homeTeam} vs {fixture.awayTeam}
        </Text>
        <Text style={styles.fxTime}>
          {fixture.status === 'FINISHED'
            ? `Final: ${fixture.homeScore}–${fixture.awayScore}`
            : fixture.status === 'LIVE'
              ? `Live: ${fixture.homeScore}–${fixture.awayScore}`
              : formatKickoff(fixture.kickoffAt.toMillis())}
        </Text>
      </View>
      <Chip
        label={fixture.status === 'FINISHED' ? '🔵 Final' : fixture.status === 'LIVE' ? '🔴 LIVE' : locked ? '🔒 Locked' : '🟢 Open'}
        tone={fixture.status === 'FINISHED' ? 'final' : fixture.status === 'LIVE' ? 'live' : locked ? 'locked' : 'open'}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfcfb' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  back: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f1f2f3', alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontWeight: '800', fontSize: 15, flex: 1, textAlign: 'center' },
  groupTabs: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: colors.line, marginHorizontal: 18 },
  gTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent', marginBottom: -2 },
  gTabActive: { borderBottomColor: colors.green },
  gTabText: { fontWeight: '700', fontSize: 13.5, color: '#9aa2a8' },
  gTabTextActive: { color: colors.greenDark },
  adminBar: { backgroundColor: colors.goldLight, marginHorizontal: 18, marginTop: 10, padding: 10, borderRadius: 12 },
  adminBarText: { color: '#8a5a00', fontWeight: '800', fontSize: 12.5, textAlign: 'center' },
  hero: {
    backgroundColor: colors.green,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  heroMeta: { color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center', opacity: 0.9, marginBottom: 8 },
  heroTeams: { color: '#fff', fontWeight: '800', fontSize: 16, textAlign: 'center' },
  heroTime: { color: '#fff', fontSize: 12, textAlign: 'center', marginTop: 4, opacity: 0.85 },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', color: colors.muted, marginVertical: 8 },
  fxCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  fxTeams: { fontWeight: '700', fontSize: 13.5 },
  fxTime: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  subTabs: { flexGrow: 0, marginTop: 10 },
  subTab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#f1f2f3' },
  subTabActive: { backgroundColor: colors.green },
  subTabText: { fontWeight: '700', fontSize: 12.5, color: colors.muted },
  subTabTextActive: { color: '#fff' },
  tableHeader: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  th: { fontSize: 10.5, color: colors.muted, textTransform: 'uppercase', fontWeight: '800', textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f2f3', borderRadius: 8 },
  td: { fontSize: 13.5, fontWeight: '700', textAlign: 'center' },
  tieBreakNote: { fontSize: 12, color: colors.muted, marginTop: 16 },
});
