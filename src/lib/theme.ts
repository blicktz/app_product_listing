import { PlatformColor, StyleSheet, type TextStyle } from 'react-native';

// iOS semantic colors: follow light/dark mode and accessibility contrast
// settings automatically, like the system apps.
export const colors = {
  background: PlatformColor('systemGroupedBackground'),
  card: PlatformColor('secondarySystemGroupedBackground'),
  label: PlatformColor('label'),
  secondaryLabel: PlatformColor('secondaryLabel'),
  tertiaryLabel: PlatformColor('tertiaryLabel'),
  separator: PlatformColor('separator'),
  fill: PlatformColor('tertiarySystemFill'),
  pressed: PlatformColor('systemFill'),
  blue: PlatformColor('systemBlue'),
  green: PlatformColor('systemGreen'),
  orange: PlatformColor('systemOrange'),
  red: PlatformColor('systemRed'),
  white: '#ffffff',
};

// Tinted fills for status pills and cards (system colors at low opacity).
export const tints = {
  blue: 'rgba(0,122,255,0.12)',
  green: 'rgba(52,199,89,0.16)',
  orange: 'rgba(255,149,0,0.16)',
  red: 'rgba(255,59,48,0.12)',
};

// iOS text styles (Dynamic Type default sizes).
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700' },
  title2: { fontSize: 22, fontWeight: '700' },
  title3: { fontSize: 20, fontWeight: '600' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17 },
  callout: { fontSize: 16 },
  subheadline: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
} satisfies Record<string, TextStyle>;

export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const SPACING = 16;
export const RADIUS = 12;

export const shared = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  card: {
    marginHorizontal: SPACING,
    borderRadius: RADIUS,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  sectionHeader: {
    ...type.footnote,
    color: colors.secondaryLabel,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 6,
    marginHorizontal: SPACING + 16,
  },
  sectionFooter: {
    ...type.footnote,
    color: colors.secondaryLabel,
    marginTop: 6,
    marginHorizontal: SPACING + 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
});
