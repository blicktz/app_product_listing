import { useMemo, useState } from 'react';
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
import { Stack, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { PickImage } from '@/components/pick/PickImage';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Pill, ProgressBar, Row, SectionFooter, SectionHeader, Icon } from '@/components/ui';
import { groupColumns, isDone, labelSku, type BoxGroup } from '@/lib/pick/derive';
import { dismissOrphan, refreshPickList } from '@/lib/pick/store';
import { colors, shared, tabular, tints, type } from '@/lib/theme';
import { usePickData } from '@/lib/pick/usePick';
import { useScanHandler } from '@/lib/pick/useScanHandler';

function formatTime(iso: string | null): string {
  if (!iso) {
    return '–';
  }
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function boxStatus(box: BoxGroup): { icon: SFSymbol; color: typeof colors.blue } {
  if (box.done) {
    return box.lines.some((s) => s.status === 'missing')
      ? { icon: 'exclamationmark.triangle.fill', color: colors.orange }
      : { icon: 'checkmark.circle.fill', color: colors.green };
  }
  return box.pickedQty > 0
    ? { icon: 'circle.lefthalf.filled', color: colors.blue }
    : { icon: 'circle', color: colors.tertiaryLabel };
}

function BoxRow({ box, onPress }: { box: BoxGroup; onPress: () => void }) {
  const status = boxStatus(box);
  const missing = box.lines.filter((s) => s.status === 'missing').length;
  const parts = [plural(box.totalQty, 'item')];
  if (box.pickedQty > 0 && !box.done) {
    parts.push(`${box.pickedQty} picked`);
  }
  if (missing > 0) {
    parts.push(`${missing} missing`);
  }
  if (box.room) {
    parts.push(box.room);
  }
  return (
    <Row
      leading={<Icon name={status.icon} color={status.color} size={24} />}
      title={box.boxId}
      subtitle={parts.join(' · ')}
      trailing={
        <Pill tone={box.done ? (missing > 0 ? 'orange' : 'green') : 'neutral'}>
          {box.pickedQty}/{box.totalQty}
        </Pill>
      }
      chevron
      onPress={onPress}
    />
  );
}

function HeaderButtons() {
  const router = useRouter();
  const { snap } = usePickData();
  const dot = snap.online === null ? colors.tertiaryLabel : snap.online ? colors.green : colors.red;

  const askRefresh = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Refresh pick list',
        options: ['Full sync (eBay + Shopify)', 'Quick reload', 'Cancel'],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) {
          void refreshPickList(true);
        } else if (index === 1) {
          void refreshPickList(false);
        }
      }
    );

  return (
    <View style={styles.headerButtons}>
      <Pressable hitSlop={8} onPress={() => router.push('/pick-settings')} style={styles.headerButton}>
        <Icon name="desktopcomputer" color={colors.blue} size={22} />
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
      </Pressable>
      <Pressable hitSlop={8} onPress={askRefresh} disabled={snap.refreshing !== null} style={styles.headerButton}>
        {snap.refreshing ? (
          <ActivityIndicator />
        ) : (
          <Icon name="arrow.clockwise" color={colors.blue} size={21} weight="medium" />
        )}
      </Pressable>
    </View>
  );
}

export default function PickHomeScreen() {
  const router = useRouter();
  const { snap, states, boxes } = usePickData();
  const { banner, dismiss, handleScan } = useScanHandler({ boxId: null, openBoxMode: 'push' });
  const [doneOpen, setDoneOpen] = useState(false);
  const [flash, setFlash] = useState(false);

  const { columns, done } = useMemo(() => groupColumns(boxes), [boxes]);
  const all = [...states.values()];
  const unlocated = all.filter((s) => !s.line.box_id && !isDone(s));
  const orders = new Set(all.map((s) => s.line.order_id)).size;
  const total = all.reduce((n, s) => n + Math.max(1, s.line.qty), 0);
  const picked = all.reduce((n, s) => n + s.pickedQty, 0);
  const toPick = all.reduce(
    (n, s) => n + (s.status === 'missing' ? 0 : Math.max(1, s.line.qty) - s.pickedQty),
    0
  );
  const missing = all.filter((s) => s.status === 'missing').length;

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    handleScan(code);
  };

  const openBox = (boxId: string) => router.push({ pathname: '/pick/box/[boxId]', params: { boxId } });

  const renderEmpty = () => {
    if (snap.refreshing) {
      return (
        <EmptyState
          icon="arrow.triangle.2.circlepath"
          iconColor={colors.blue}
          title="Syncing orders on the Mac…"
          message={snap.refreshing === 'full' ? 'Re-syncing eBay and Shopify can take up to 2 minutes.' : undefined}
        />
      );
    }
    if (snap.online === false) {
      return (
        <EmptyState
          icon="wifi.slash"
          title="Can't reach the Mac"
          message={snap.refreshError ?? `Check that the portal is running at ${snap.serverUrl || '(not set)'}.`}
          action={
            <View style={styles.emptyActions}>
              <Button label="Try again" icon="arrow.clockwise" filled onPress={() => void refreshPickList(false)} />
              <Button label="Server settings" tone="neutral" onPress={() => router.push('/pick-settings')} />
            </View>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="shippingbox"
        title="No pick list yet"
        message="Load the orders waiting to ship from the Mac."
        action={<Button label="Load pick list" icon="arrow.down.circle" filled onPress={() => void refreshPickList(true)} />}
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
          <RefreshControl refreshing={snap.refreshing === 'quick'} onRefresh={() => void refreshPickList(false)} />
        }
      >
        <ScanCapture onScan={onScan} />
        {!snap.list ? (
          renderEmpty()
        ) : (
          <>
            {/* Summary */}
            <Card style={styles.firstCard}>
              <View style={styles.summary}>
                <View style={styles.summaryTop}>
                  <Text style={[styles.bigNumber, tabular]}>{toPick}</Text>
                  <Text style={styles.bigLabel}>to pick</Text>
                  <Text style={[styles.summaryRight, tabular]}>
                    {picked} of {total} picked
                  </Text>
                </View>
                <ProgressBar value={total > 0 ? picked / total : 0} color={toPick === 0 ? colors.green : colors.blue} />
                <Text style={styles.summaryMeta}>
                  {plural(orders, 'order')} · {boxes.size} {boxes.size === 1 ? 'box' : 'boxes'}
                  {missing > 0 ? ` · ${missing} missing` : ''}
                </Text>
                <View style={styles.syncRow}>
                  {snap.refreshing ? (
                    <>
                      <ActivityIndicator size="small" />
                      <Text style={styles.syncText}>
                        {snap.refreshing === 'full' ? 'Syncing eBay + Shopify on the Mac…' : 'Reloading…'}
                      </Text>
                    </>
                  ) : snap.refreshError ? (
                    <>
                      <Icon name="exclamationmark.circle.fill" color={colors.red} size={15} />
                      <Text style={[styles.syncText, { color: colors.red }]} numberOfLines={2}>
                        Refresh failed · {snap.refreshError}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.syncText}>Synced {formatTime(snap.loadedAt)} ·</Text>
                      {snap.unsentCount > 0 ? (
                        <>
                          <Icon name="arrow.up.circle.fill" color={colors.orange} size={15} />
                          <Text style={[styles.syncText, { color: colors.orange }]}>
                            {plural(snap.unsentCount, 'pick')} not sent
                          </Text>
                        </>
                      ) : (
                        <>
                          <Icon name="checkmark.circle.fill" color={colors.green} size={15} />
                          <Text style={styles.syncText}>All picks sent</Text>
                        </>
                      )}
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
                <Text style={styles.scannerSub}>Scan a box label to start</Text>
              </View>
            </View>

            {columns.map((column) => (
              <View key={column.column}>
                <SectionHeader>
                  Column {column.column} · {column.boxes.length === 1 ? '1 box' : `${column.boxes.length} boxes`}
                </SectionHeader>
                <Card inset={52}>
                  {column.boxes.map((box) => (
                    <BoxRow key={box.boxId} box={box} onPress={() => openBox(box.boxId)} />
                  ))}
                </Card>
              </View>
            ))}

            {unlocated.length > 0 ? (
              <View>
                <SectionHeader color={colors.orange}>Unlocated · {plural(unlocated.length, 'item')}</SectionHeader>
                <Card inset={72}>
                  {unlocated.map((s) => (
                    <Row
                      key={s.line.line_key}
                      leading={<PickImage line={s.line} size={44} />}
                      title={labelSku(s.line.sku)}
                      subtitle={s.line.title}
                      chevron
                      onPress={() =>
                        router.push({ pathname: '/pick/missing/[lineKey]', params: { lineKey: s.line.line_key } })
                      }
                    />
                  ))}
                </Card>
                <SectionFooter>No box on record. Tap one to see where items from the same batch are.</SectionFooter>
              </View>
            ) : null}

            {snap.orphans.length > 0 ? (
              <View>
                <SectionHeader color={colors.orange}>Picked, order gone</SectionHeader>
                <Card>
                  {snap.orphans.map((o) => (
                    <Row
                      key={o.line.line_key}
                      title={`${labelSku(o.line.sku)} → ${o.line.box_id ?? 'no box'}`}
                      subtitle={o.line.title}
                      trailing={
                        <Button label="Put back" tone="neutral" onPress={() => dismissOrphan(o.line.line_key)} />
                      }
                    />
                  ))}
                </Card>
                <SectionFooter>Cancelled or shipped after picking. Return these to their box.</SectionFooter>
              </View>
            ) : null}

            {done.length > 0 ? (
              <View>
                <Pressable style={styles.doneHeader} onPress={() => setDoneOpen((v) => !v)}>
                  <Text style={styles.doneHeaderText}>Done · {done.length === 1 ? '1 box' : `${done.length} boxes`}</Text>
                  <Icon
                    name={doneOpen ? 'chevron.down' : 'chevron.right'}
                    color={colors.secondaryLabel}
                    size={12}
                    weight="semibold"
                  />
                </Pressable>
                {doneOpen ? (
                  <Card inset={52}>
                    {done.map((box) => (
                      <BoxRow key={box.boxId} box={box} onPress={() => openBox(box.boxId)} />
                    ))}
                  </Card>
                ) : null}
              </View>
            ) : null}

            {columns.length === 0 && unlocated.length === 0 ? (
              <EmptyState
                icon="checkmark.seal.fill"
                iconColor={colors.green}
                title="All picked"
                message="Every item on the list is picked or marked missing."
              />
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
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 4,
  },
  headerButton: {
    minWidth: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    position: 'absolute',
    right: -3,
    bottom: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#ffffff',
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
  doneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 22,
    marginBottom: 6,
    marginHorizontal: 32,
  },
  doneHeaderText: {
    ...type.footnote,
    color: colors.secondaryLabel,
    textTransform: 'uppercase',
  },
  emptyActions: {
    gap: 10,
    alignSelf: 'stretch',
  },
});
