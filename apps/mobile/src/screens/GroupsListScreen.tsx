import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '../auth/AuthContext';
import { Avatar, Button, Card } from '../components/ui';
import { colors } from '../components/theme';
import { fetchGroupMembers, fetchMyGroups, type GroupSummary } from '../lib/groups';
import { getUsersByIds, type UserSummary } from '../lib/users';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupsList'>;

interface GroupRow extends GroupSummary {
  memberAvatars: UserSummary[];
}

export function GroupsListScreen({ navigation }: Props) {
  const { user, signOut } = useAuth();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const summaries = await fetchMyGroups(user.uid);
    const rows: GroupRow[] = [];
    for (const g of summaries) {
      const members = await fetchGroupMembers(g.groupId);
      const users = await getUsersByIds(members.map((m) => m.userId));
      rows.push({ ...g, memberAvatars: members.map((m) => users.get(m.userId)).filter((u): u is UserSummary => !!u) });
    }
    setGroups(rows);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!user) return null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Text style={styles.title}>My Groups</Text>
        <Avatar uid={user.uid} name={user.displayName ?? user.email ?? '?'} size={32} />
      </View>

      {groups === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🥅</Text>
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.emptyBody}>Create a group for a competition, or join a friend’s group with their code.</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.groupId}
          contentContainerStyle={{ paddingHorizontal: 18 }}
          renderItem={({ item }) => (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text
                  style={styles.groupName}
                  onPress={() => navigation.navigate('GroupDetail', { groupId: item.groupId })}
                >
                  {item.name}
                </Text>
              </View>
              <Text style={styles.groupMeta}>{item.competitionIds.length} competition{item.competitionIds.length > 1 ? 's' : ''}</Text>
              <View style={{ flexDirection: 'row', marginTop: 12, gap: 6 }}>
                {item.memberAvatars.map((m) => (
                  <Avatar key={m.uid} uid={m.uid} name={m.displayName} size={28} />
                ))}
              </View>
              <View style={{ marginTop: 12 }}>
                <Button title="Open group" onPress={() => navigation.navigate('GroupDetail', { groupId: item.groupId })} variant="ghost" />
              </View>
            </Card>
          )}
        />
      )}

      <View style={styles.footer}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="＋ Create group" onPress={() => navigation.navigate('CreateGroup')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="🔑 Join group" onPress={() => navigation.navigate('JoinGroup')} variant="secondary" />
          </View>
        </View>
        <View style={{ marginTop: 10 }}>
          <Button title="Sign out" onPress={signOut} variant="ghost" />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10 },
  title: { fontSize: 21, fontWeight: '900' },
  groupName: { fontWeight: '800', fontSize: 16 },
  groupMeta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  emptyEmoji: { fontSize: 44, marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  emptyBody: { fontSize: 13, color: colors.muted, textAlign: 'center', marginBottom: 24, lineHeight: 19 },
  footer: { paddingHorizontal: 18, paddingBottom: 16, paddingTop: 8 },
});
