import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProviderRoot } from './src/auth/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProviderRoot>
        <RootNavigator />
        <StatusBar style="auto" />
      </AuthProviderRoot>
    </SafeAreaProvider>
  );
}
