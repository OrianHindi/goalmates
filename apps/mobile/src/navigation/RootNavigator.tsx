import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { AdminScoreEntryScreen } from '../screens/AdminScoreEntryScreen';
import { CreateGroupScreen } from '../screens/CreateGroupScreen';
import { FixtureDetailScreen } from '../screens/FixtureDetailScreen';
import { GroupCreatedScreen } from '../screens/GroupCreatedScreen';
import { GroupDetailScreen } from '../screens/GroupDetailScreen';
import { GroupsListScreen } from '../screens/GroupsListScreen';
import { JoinGroupScreen } from '../screens/JoinGroupScreen';
import { LoginScreen } from '../screens/LoginScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="GroupsList" component={GroupsListScreen} />
            <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
            <Stack.Screen name="GroupCreated" component={GroupCreatedScreen} />
            <Stack.Screen name="JoinGroup" component={JoinGroupScreen} />
            <Stack.Screen name="GroupDetail" component={GroupDetailScreen} />
            <Stack.Screen name="FixtureDetail" component={FixtureDetailScreen} />
            <Stack.Screen name="AdminScoreEntry" component={AdminScoreEntryScreen} options={{ presentation: 'modal' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
