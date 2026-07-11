// Small shared building blocks used across (not tied to) a single screen --
// Avatar, Card, Button, Chip -- kept intentionally dumb (props in, view out,
// no per-screen configuration knobs) per the "don't build generic
// components for a single use case" standard: these ARE used in >1 place.
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { avatarColorFor, colors, initialsFor } from './theme';

export function Avatar({ uid, name, size = 40 }: { uid: string; name: string; size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColorFor(uid) },
      ]}
    >
      <Text style={{ color: colors.white, fontWeight: '800', fontSize: size * 0.35 }}>{initialsFor(name)}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'gold';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      style={[
        styles.btn,
        variant === 'primary' && { backgroundColor: colors.green },
        variant === 'gold' && { backgroundColor: colors.gold },
        variant === 'secondary' && { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.green },
        variant === 'ghost' && { backgroundColor: '#f1f2f3' },
        isDisabled && { backgroundColor: '#e6e8eb' },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.green : colors.white} />
      ) : (
        <Text
          style={[
            styles.btnText,
            (variant === 'secondary' || variant === 'ghost') && { color: variant === 'secondary' ? colors.greenDark : colors.ink },
            isDisabled && { color: '#9aa2a8' },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

type ChipTone = 'open' | 'locked' | 'live' | 'final' | 'admin';

export function Chip({ label, tone }: { label: string; tone: ChipTone }) {
  const toneStyles: Record<ChipTone, { bg: string; fg: string }> = {
    open: { bg: colors.greenLight, fg: colors.greenDark },
    locked: { bg: '#eceef0', fg: '#5b636a' },
    live: { bg: colors.dangerLight, fg: colors.danger },
    final: { bg: colors.blueLight, fg: colors.blue },
    admin: { bg: colors.goldLight, fg: '#8a5a00' },
  };
  const t = toneStyles[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  card: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 16, marginBottom: 14 },
  btn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', width: '100%' },
  btnText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, alignSelf: 'flex-start' },
  chipText: { fontSize: 11.5, fontWeight: '700' },
});
