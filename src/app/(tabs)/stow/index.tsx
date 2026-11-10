import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { MacHeaderButtons } from '@/components/MacHeaderButtons';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Card, EmptyState, Icon, Row, SectionHeader } from '@/components/ui';
import { formatTime, sessionDate } from '@/lib/sessionTime';
import type { StowSession } from '@/lib/stow/derive';
import { refreshStowState } from '@/lib/stow/store';
import { useStowData } from '@/lib/stow/useStow';
import { useStowScan } from '@/lib/stow/useStowScan';
import { colors, shared, tints, type } from '@/lib/theme';

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

function sessionLine(session: StowSession): string {
  return `${plural(session.boxes.length, 'box', 'boxes')} · ${plural(session.units, 'unit')}`;
}

function HeaderButtons() {
  const { snap } = useStowData();
  return <MacHeaderButtons refreshing={snap.refreshing} onRefresh={() => void refreshStowState()} />;
}

export default function StowHomeScreen() {
  const router = useRouter();
  const { snap, sessions, current } = useStowData();
  const { banner, dismiss, handleScan } = useStowScan();
  const [flash, setFlash] = useState(false);

  // The first box scanned opens its screen, and a box left open before a
  // restart comes straight back.
  const hasOpenBox = current?.openBox != null;
  useFocusEffect(
    useCallback(() => {
      if (hasOpenBox) {
        router.push('/stow/box');
      }
    }, [hasOpenBox, router])
  );

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    handleScan(code);
  };

  const recent = sessions.filter((s) => s.endedAt !== null && s.units > 0);

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen options={{ headerRight: () => <HeaderButtons /> }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={snap.refreshing} onRefresh={() => void refreshStowState()} />}
      >
        <ScanCapture onScan={onScan} />

        <View style={styles.syncRow}>
          {snap.refreshError ? (
            <>
              <Icon name="exclamationmark.circle.fill" color={colors.red} size={15} />
              <Text style={[styles.syncText, { color: colors.red }]} numberOfLines={2}>
                Refresh failed · {snap.refreshError}
              </Text>
            </>
          ) : snap.unsentCount > 0 ? (
            <>
              <Icon name="arrow.up.circle.fill" color={colors.orange} size={15} />
              <Text style={[styles.syncText, { color: colors.orange }]} numberOfLines={2}>
                {plural(snap.unsentCount, 'event')} not sent
                {snap.sendError ? ` · ${snap.sendError}` : ''}
              </Text>
            </>
          ) : (
            <>
              <Icon name="checkmark.circle.fill" color={colors.green} size={15} />
              <Text style={styles.syncText}>
                {snap.loadedAt ? `Synced ${formatTime(snap.loadedAt)} · ` : ''}All stows sent
              </Text>
            </>
          )}
        </View>

        <View style={[shared.card, styles.scanner, { backgroundColor: flash ? 'rgba(0,122,255,0.28)' : tints.blue }]}>
          <Icon name="barcode.viewfinder" color={colors.blue} size={30} />
          <View style={styles.scannerText}>
            <Text style={styles.scannerTitle}>Scanner ready</Text>
            <Text style={styles.scannerSub}>Scan a box label to start</Text>
          </View>
        </View>

        {recent.length > 0 ? (
          <View>
            <SectionHeader>Recent sessions</SectionHeader>
            <Card inset={52}>
              {recent.map((session) => (
                <Row
                  key={session.id}
                  leading={<Icon name="checkmark.circle.fill" color={colors.green} size={24} />}
                  title={sessionDate(session.startedAt)}
                  subtitle={sessionLine(session)}
                  chevron
                  onPress={() =>
                    router.push({ pathname: '/stow/summary/[sessionId]', params: { sessionId: session.id } })
                  }
                />
              ))}
            </Card>
          </View>
        ) : (
          <EmptyState
            icon="tray.and.arrow.down"
            title="Nothing stowed yet"
            message="Scan a box, then scan each item as it goes in."
          />
        )}
      </ScrollView>
      <ScanBanner banner={banner} onDismiss={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    marginHorizontal: 32,
  },
  syncText: {
    ...type.footnote,
    color: colors.secondaryLabel,
    flexShrink: 1,
  },
  scanner: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  scannerText: {
    flex: 1,
    gap: 1,
  },
  scannerTitle: {
    ...type.headline,
    color: colors.blue,
  },
  scannerSub: {
    ...type.subheadline,
    color: colors.secondaryLabel,
  },
});
