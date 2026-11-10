import { useCallback, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { MacHeaderButtons } from '@/components/MacHeaderButtons';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Icon, Pill, ProgressBar, Row, SectionHeader } from '@/components/ui';
import { sameLocalDay, shortStore, type PackageState } from '@/lib/pack/derive';
import { refreshPackState, setOpenKey } from '@/lib/pack/store';
import { usePackData } from '@/lib/pack/usePack';
import { usePackScan } from '@/lib/pack/usePackScan';
import { formatTime } from '@/lib/sessionTime';
import { colors, shared, tabular, tints, type } from '@/lib/theme';

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

function packageStatus(p: PackageState): { icon: SFSymbol; color: typeof colors.blue } {
  switch (p.status) {
    case 'packed':
      return { icon: 'checkmark.circle.fill', color: colors.green };
    case 'cancelled':
      return { icon: 'xmark.octagon.fill', color: colors.red };
    case 'multi_label':
      return { icon: 'exclamationmark.triangle.fill', color: colors.orange };
    case 'started':
      return { icon: 'circle.lefthalf.filled', color: colors.blue };
    default:
      return { icon: 'circle', color: colors.tertiaryLabel };
  }
}

function PackageRow({ pkg, onPress }: { pkg: PackageState; onPress: () => void }) {
  const status = packageStatus(pkg);
  const parts = [pkg.pkg.buyer, shortStore(pkg.pkg.store)];
  if (pkg.packedAt) {
    parts.push(formatTime(pkg.packedAt) + (pkg.manualPacked ? ' · by hand' : ''));
  } else if (pkg.labelScanned) {
    parts.push('label ✓');
  }
  const trailing =
    pkg.status === 'cancelled' ? (
      <Pill tone="red">CANCELLED</Pill>
    ) : pkg.status === 'multi_label' ? (
      <Pill tone="orange">{pkg.pkg.label_count} labels</Pill>
    ) : (
      <Pill tone={pkg.packedAt ? 'green' : pkg.scans > 0 ? 'blue' : 'neutral'}>
        {pkg.doneItems}/{pkg.totalItems}
      </Pill>
    );
  return (
    <Row
      leading={<Icon name={status.icon} color={status.color} size={24} />}
      title={pkg.pkg.name}
      subtitle={parts.filter(Boolean).join(' · ')}
      trailing={trailing}
      chevron
      onPress={onPress}
    />
  );
}

function HeaderButtons() {
  const snap = usePackData();
  const askRefresh = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Refresh labels',
        message: 'Load labels fetches the labels bought on eBay and Shopify. Packed orders stay packed.',
        options: ['Load labels (last 24 h)', 'Load labels (last 72 h)', 'Quick reload', 'Cancel'],
        cancelButtonIndex: 3,
      },
      (index) => {
        if (index === 0) {
          void refreshPackState(true, 24);
        } else if (index === 1) {
          void refreshPackState(true, 72);
        } else if (index === 2) {
          void refreshPackState(false);
        }
      }
    );
  return <MacHeaderButtons refreshing={snap.refreshing !== null} onRefresh={askRefresh} />;
}

export default function PackHomeScreen() {
  const router = useRouter();
  const snap = usePackData();
  const [packedOpen, setPackedOpen] = useState(false);
  const [flash, setFlash] = useState(false);

  // No package is open on this screen; going back here leaves the one that was.
  useFocusEffect(
    useCallback(() => {
      setOpenKey(null);
    }, [])
  );

  const openPackage = (key: string) => {
    setOpenKey(key);
    router.push('/pack/package');
  };
  const { banner, dismiss, handleScan } = usePackScan({ openPackage });

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    handleScan(code);
  };

  const packages = snap.board.packages;
  const toPack = packages.filter((p) => !p.packedAt);
  const packedToday = packages
    .filter((p) => p.packedAt && sameLocalDay(p.packedAt))
    .sort((a, b) => (b.packedAt ?? '').localeCompare(a.packedAt ?? ''));
  const packableLeft = toPack.filter((p) => p.packable).length;
  const total = packedToday.length + packableLeft;
  const lastLoad = snap.server?.last_load ?? null;

  const renderEmpty = () => {
    if (snap.refreshing) {
      return (
        <EmptyState
          icon="arrow.triangle.2.circlepath"
          iconColor={colors.blue}
          title={snap.refreshing === 'load' ? 'Loading labels on the Mac…' : 'Reloading…'}
          message={snap.refreshing === 'load' ? 'Fetching eBay and Shopify labels can take up to 2 minutes.' : undefined}
        />
      );
    }
    if (snap.refreshError) {
      return (
        <EmptyState
          icon="wifi.slash"
          title="Can't reach the Mac"
          message={snap.refreshError}
          action={
            <View style={styles.emptyActions}>
              <Button label="Try again" icon="arrow.clockwise" filled onPress={() => void refreshPackState(false)} />
              <Button label="Server settings" tone="neutral" onPress={() => router.push('/pick-settings')} />
            </View>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="archivebox"
        title="No labels loaded"
        message="Print the shipping labels, then load them from the Mac."
        action={<Button label="Load labels" icon="arrow.down.circle" filled onPress={() => void refreshPackState(true)} />}
      />
    );
  };

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen options={{ headerRight: () => <HeaderButtons /> }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={snap.refreshing === 'quick'} onRefresh={() => void refreshPackState(false)} />
        }
      >
        <ScanCapture onScan={onScan} />
        {!snap.server ? (
          renderEmpty()
        ) : (
          <>
            {/* Summary */}
            <Card style={styles.firstCard}>
              <View style={styles.summary}>
                <View style={styles.summaryTop}>
                  <Text style={[styles.bigNumber, tabular]}>{toPack.length}</Text>
                  <Text style={styles.bigLabel}>to pack</Text>
                  <Text style={[styles.summaryRight, tabular]}>{packedToday.length} packed today</Text>
                </View>
                <ProgressBar
                  value={total > 0 ? packedToday.length / total : 0}
                  color={packableLeft === 0 ? colors.green : colors.blue}
                />
                <Text style={styles.summaryMeta}>
                  {lastLoad
                    ? `Labels loaded ${formatTime(lastLoad.loaded_at)} (${lastLoad.hours} h)` +
                      (lastLoad.orders_found !== null ? ` · ${plural(lastLoad.orders_found, 'order')}` : '')
                    : 'Labels never loaded'}
                </Text>
                {snap.loadRunning && snap.refreshing !== 'load' ? (
                  <View style={styles.syncRow}>
                    <ActivityIndicator size="small" />
                    <Text style={styles.syncText}>Load labels still running on the Mac…</Text>
                  </View>
                ) : null}
                {/* The Mac joined a load already running with another window. */}
                {!snap.loadRunning &&
                !snap.refreshing &&
                lastLoad &&
                snap.requestedLoadHours !== null &&
                lastLoad.hours !== snap.requestedLoadHours ? (
                  <View style={styles.loadAgain}>
                    <Text style={[styles.syncText, styles.loadAgainText]}>
                      That load covered {lastLoad.hours} h, not {snap.requestedLoadHours} h.
                    </Text>
                    <Button
                      label={`Load again (${snap.requestedLoadHours} h)`}
                      tone="neutral"
                      onPress={() => void refreshPackState(true, snap.requestedLoadHours ?? undefined)}
                      style={styles.loadAgainButton}
                    />
                  </View>
                ) : null}
                <View style={styles.syncRow}>
                  {snap.refreshing ? (
                    <Text style={styles.syncText}>
                      {snap.refreshing === 'load' ? 'Loading labels from eBay + Shopify on the Mac…' : 'Reloading…'}
                    </Text>
                  ) : snap.refreshError ? (
                    <>
                      <Icon name="exclamationmark.circle.fill" color={colors.red} size={15} />
                      <Text style={[styles.syncText, { color: colors.red }]} numberOfLines={3}>
                        {snap.refreshError}
                      </Text>
                    </>
                  ) : snap.unsentCount > 0 ? (
                    <>
                      <Icon name="arrow.up.circle.fill" color={colors.orange} size={15} />
                      <Text style={[styles.syncText, { color: colors.orange }]} numberOfLines={2}>
                        {plural(snap.unsentCount, 'scan')} not sent{snap.sendError ? ` · ${snap.sendError}` : ''}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Icon name="checkmark.circle.fill" color={colors.green} size={15} />
                      <Text style={styles.syncText}>Synced {formatTime(snap.loadedAt)} · All scans sent</Text>
                    </>
                  )}
                </View>
              </View>
            </Card>

            {/* Scanner */}
            <View style={[shared.card, styles.scanner, { backgroundColor: flash ? 'rgba(0,122,255,0.28)' : tints.blue }]}>
              <Icon name="barcode.viewfinder" color={colors.blue} size={30} />
              <View style={styles.scannerText}>
                <Text style={styles.scannerTitle}>Scanner ready</Text>
                <Text style={styles.scannerSub}>Scan a shipping label or an item</Text>
              </View>
            </View>

            {toPack.length > 0 ? (
              <View>
                <SectionHeader>To pack · {toPack.length}</SectionHeader>
                <Card inset={52}>
                  {toPack.map((p) => (
                    <PackageRow key={p.key} pkg={p} onPress={() => openPackage(p.key)} />
                  ))}
                </Card>
              </View>
            ) : (
              <EmptyState
                icon="checkmark.seal.fill"
                iconColor={colors.green}
                title="All packed"
                message="Every loaded label is packed. Load labels again after printing more."
              />
            )}

            {packedToday.length > 0 ? (
              <View>
                <Pressable style={styles.collapseHeader} onPress={() => setPackedOpen((v) => !v)}>
                  <Text style={styles.collapseHeaderText}>Packed today · {packedToday.length}</Text>
                  <Icon
                    name={packedOpen ? 'chevron.down' : 'chevron.right'}
                    color={colors.secondaryLabel}
                    size={12}
                    weight="semibold"
                  />
                </Pressable>
                {packedOpen ? (
                  <Card inset={52}>
                    {packedToday.map((p) => (
                      <PackageRow key={p.key} pkg={p} onPress={() => openPackage(p.key)} />
                    ))}
                  </Card>
                ) : null}
              </View>
            ) : null}
          </>
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
  firstCard: {
    marginTop: 8,
  },
  summary: {
    padding: 16,
    gap: 10,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  bigNumber: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.label,
  },
  bigLabel: {
    ...type.title3,
    color: colors.label,
  },
  summaryRight: {
    ...type.subheadline,
    color: colors.secondaryLabel,
    marginLeft: 'auto',
  },
  summaryMeta: {
    ...type.subheadline,
    color: colors.secondaryLabel,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 22,
    marginBottom: 6,
    marginHorizontal: 32,
  },
  collapseHeaderText: {
    ...type.footnote,
    color: colors.secondaryLabel,
    textTransform: 'uppercase',
  },
  loadAgain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadAgainText: {
    flex: 1,
  },
  loadAgainButton: {
    minHeight: 34,
    paddingHorizontal: 10,
  },
  emptyActions: {
    gap: 10,
    alignSelf: 'stretch',
  },
});
