import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui';
import { colors } from '@/lib/theme';

/** The yellow strip on every Whatnot pick screen, so it's never mistaken for order Pick. */
export function WhatnotStrip({ subtitle }: { subtitle?: string }) {
  return (
    <View style={styles.strip}>
      <Icon name="video.fill" color={colors.onYellow} size={13} weight="semibold" />
      <Text style={styles.text} numberOfLines={1}>
        WHATNOT · SHOW PICK{subtitle ? ` · ${subtitle}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: colors.yellow,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.onYellow,
  },
});
