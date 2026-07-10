import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/ui';
import { colors } from '../components/theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupCreated'>;

export function GroupCreatedScreen({ route, navigation }: Props) {
  const { groupId, groupName, joinCode } = route.params;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={{ padding: 18, flex: 1 }}>
        <View style={{ alignItems: 'center', marginTop: 22 }}>
          <Text style={{ fontSize: 38 }}>✅</Text>
          <Text style={styles.title}>You’re in -- and you’re admin ⭐</Text>
          <Text style={styles.sub}>{groupName}</Text>
        </View>

        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>SHARE THIS JOIN CODE</Text>
          <Text style={styles.code}>{joinCode}</Text>
          <Button
            title="↗ Share"
            onPress={() =>
              Share.share({ message: `Join my GoalMates group "${groupName}" with code ${joinCode}` })
            }
          />
        </View>
        <Text style={[styles.sub, { textAlign: 'center' }]}>Send this to friends -- anyone with the code can join, no expiry.</Text>
      </View>

      <View style={styles.footer}>
        <Button
          title="Go to group →"
          onPress={() => navigation.replace('GroupDetail', { groupId })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfcfb' },
  title: { fontSize: 21, fontWeight: '800', marginTop: 8 },
  sub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  codeBox: {
    backgroundColor: '#eafbf1',
    borderWidth: 2,
    borderColor: colors.green,
    borderStyle: 'dashed',
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    marginVertical: 20,
  },
  codeLabel: { fontSize: 12, fontWeight: '800', color: colors.greenDark },
  code: { fontSize: 34, fontWeight: '900', letterSpacing: 4, color: colors.greenDark, marginVertical: 12 },
  footer: { paddingHorizontal: 18, paddingBottom: 20 },
});
