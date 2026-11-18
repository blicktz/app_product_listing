import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Icon } from '@/components/ui';
import { refreshPullList, type PullBlock } from '@/lib/pull/store';
import { colors, shared, tints, type } from '@/lib/theme';

/** The purple strip on every Pull screen, so it's never mistaken for Pick. */
export function ModeStrip() {
  return (
    <View style={styles.strip}>
      <Icon name="xmark.bin.fill" color={colors.white} size={14} weight="semibold" />
      <Text style={styles.stripText}>PULL · DISPOSE</Text>
    </View>
  );
}

/**
 * The scanner card: purple when the Mac takes pulls, otherwise says why
 * pulling is off (offline, orders not synced or syncing).
 */
export function ScannerCard({
  block,
  flash,
  title,
  subtitle,
  serverUrl,
}: {
  block: PullBlock;
  flash: boolean;
  title: string;
  subtitle?: string;
  serverUrl: string;
}) {
  const router = useRouter();
  if (block === 'offline') {
    return (
      <View style={[shared.card, styles.card, { backgroundColor: colors.fill }]}>
        <Icon name="wifi.slash" color={colors.secondaryLabel} size={28} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.label }]}>Pull needs the Mac</Text>
          <Text style={styles.sub}>Can’t reach {serverUrl || '(not set)'}. Scanning is off.</Text>
          <View style={styles.buttons}>
            <Button label="Try again" tone="neutral" onPress={() => void refreshPullList()} />
            <Button label="Server…" tone="neutral" onPress={() => router.push('/pick-settings')} />
          </View>
        </View>
      </View>
    );
  }
  if (block === 'orders_not_synced' || block === 'orders_syncing') {
    const syncing = block === 'orders_syncing';
    return (
      <View style={[shared.card, styles.card, { backgroundColor: tints.orange }]}>
        <Icon name={syncing ? 'arrow.triangle.2.circlepath' : 'exclamationmark.triangle.fill'} color={colors.orange} size={28} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.orange }]}>
            {syncing ? 'The Mac is syncing orders' : 'Orders couldn’t be synced'}
          </Text>
          <Text style={styles.sub}>
            {syncing
              ? 'Pulling waits until the sync finishes.'
              : 'Pulling is paused until the order sync works again.'}
          </Text>
          <View style={styles.buttons}>
            <Button label={syncing ? 'Reload' : 'Try again'} tone="neutral" onPress={() => void refreshPullList()} />
          </View>
        </View>
      </View>
    );
  }
  return (
    <View style={[shared.card, styles.card, { backgroundColor: flash ? 'rgba(175,82,222,0.32)' : tints.purple }]}>
      <Icon name="barcode.viewfinder" color={colors.purple} size={28} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.purple }]}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.purple,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stripText: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.white,
  },
  card: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  text: { flex: 1, gap: 2 },
  title: { ...type.headline },
  sub: { ...type.subheadline, color: colors.secondaryLabel },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 8 },
});
