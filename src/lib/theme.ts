import { PlatformColor, StyleSheet, type ColorSchemeName, type TextStyle } from 'react-native';
import { DarkTheme, DefaultTheme } from 'expo-router';

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
  /** Pull (dispose) mode's accent, so it never looks like Pick. */
  purple: PlatformColor('systemPurple'),
  /** Whatnot show pick's accent (Whatnot's own yellow), so it never looks like order Pick. */
  yellow: PlatformColor('systemYellow'),
  /** Text on a yellow fill: dark in both appearances, as yellow stays light. */
  onYellow: '#1c1c1e',
  white: '#ffffff',
};

// Navigation headers, back buttons and sheets take their colours from this theme,
// not from `colors`: header options become plain native colours, and a
// PlatformColor doesn't survive that. These are the plain values of the iOS
// colours used above, per appearance. See docs/dark-mode-headers.md.
export function navigationTheme(scheme: ColorSchemeName) {
  const dark = scheme === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: dark ? '#0A84FF' : '#007AFF', // systemBlue
      background: dark ? '#000000' : '#F2F2F7', // systemGroupedBackground
      card: dark ? '#000000' : '#F2F2F7', // an opaque bar blends with the screen
      text: dark ? '#FFFFFF' : '#000000', // label
      border: dark ? '#38383A' : '#C6C6C8', // opaque separator
    },
  };
}

// Tinted fills for status pills and cards (system colors at low opacity).
export const tints = {
  blue: 'rgba(0,122,255,0.12)',
  green: 'rgba(52,199,89,0.16)',
  orange: 'rgba(255,149,0,0.16)',
  red: 'rgba(255,59,48,0.12)',
  purple: 'rgba(175,82,222,0.14)',
  yellow: 'rgba(255,204,0,0.22)',
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
