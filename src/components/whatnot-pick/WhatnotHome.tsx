import { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { ModeSwitch } from '@/components/pick/ModeSwitch';
import { PickImage } from '@/components/pick/PickImage';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Icon, Pill, ProgressBar, Row, SectionFooter, SectionHeader } from '@/components/ui';
import { groupColumns, isDone, labelSku, type BoxGroup, type LineState } from '@/lib/pick/derive';
import { usePickData } from '@/lib/pick/usePick';
import { colors, shared, tabular, tints, type } from '@/lib/theme';
import {
  recordWhatnotEvent,
  refreshAll,
  refreshPlan,
  setWhatnotActive,
  whatnotImageUri,
} from '@/lib/whatnot-pick/store';
import type { WhatnotLine } from '@/lib/whatnot-pick/types';
import { bundleNote, lotLabel, useWhatnotData, useWhatnotScan, type LineupRow } from '@/lib/whatnot-pick/useWhatnot';

type View_ = 'box' | 'lineup';

export function formatShowTime(utc: string | null, local: string | null): string {
  const d = utc ? new Date(utc) : local ? new Date(local) : null;
  if (!d || Number.isNaN(d.getTime())) {
    return 'no date';
  }
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function clock(iso: string | null): string {
  if (!iso) {
    return '–';
  }
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function statusIcon(state: LineState | undefined, line: WhatnotLine): { icon: SFSymbol; color: typeof colors.blue } {
  if (line.status === 'sold') {
    return { icon: 'tag.slash', color: colors.tertiaryLabel };
  }
  if (state?.status === 'picked') {
    return { icon: 'checkmark.circle.fill', color: colors.green };
  }
  if (state?.status === 'missing') {
    return { icon: 'exclamationmark.triangle.fill', color: colors.orange };
  }
  return { icon: 'circle', color: colors.tertiaryLabel };
}

function HeaderButtons({ several }: { several: boolean }) {
  const router = useRouter();
  const { snap } = useWhatnotData();
  const dot = snap.online === null ? colors.tertiaryLabel : snap.online ? colors.green : colors.red;
  const ask = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Whatnot show pick',
        options: ['Reload this show', ...(several ? ['Choose show…'] : []), 'Cancel'],
        cancelButtonIndex: several ? 2 : 1,
      },
      (index) => {
        if (index === 0) {
          void refreshAll();
        } else if (several && index === 1) {
          router.push('/pick/whatnot/shows');
        }
      }
    );
  return (
    <View style={styles.headerButtons}>
      <Pressable hitSlop={8} onPress={() => router.push('/pick-settings')} style={styles.headerButton}>
        <Icon name="desktopcomputer" color={colors.blue} size={22} />
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
      </Pressable>
      <Pressable hitSlop={8} onPress={ask} disabled={snap.refreshing} style={styles.headerButton}>
        {snap.refreshing ? <ActivityIndicator /> : <Icon name="arrow.clockwise" color={colors.blue} size={21} weight="medium" />}
      </Pressable>
    </View>
  );
}

function BoxRow({ box, lots, onPress }: { box: BoxGroup; lots: string; onPress: () => void }) {
  const missing = box.lines.filter((s) => s.status === 'missing').length;
  const icon: SFSymbol = box.done
    ? missing > 0
      ? 'exclamationmark.triangle.fill'
      : 'checkmark.circle.fill'
    : box.pickedQty > 0
      ? 'circle.lefthalf.filled'
      : 'circle';
  const color = box.done ? (missing > 0 ? colors.orange : colors.green) : box.pickedQty > 0 ? colors.blue : colors.tertiaryLabel;
  return (
    <Row
      leading={<Icon name={icon} color={color} size={24} />}
      title={box.boxId}
      subtitle={[lots, box.room].filter(Boolean).join(' · ')}
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

export function WhatnotHome() {
  const router = useRouter();
  const data = useWhatnotData();
  const { snap, plan, prepBox, boxes, unlocated, alreadyInPrep, lineup, lines, bundles, total, picked, missing, toPick } = data;
  const { snap: orders, states: orderStates } = usePickData();
  const [view, setView] = useState<View_>('box');
  const [flash, setFlash] = useState(false);
  const { banner, dismiss, handleScan } = useWhatnotScan({ boxId: null, openBoxMode: 'push' });

  useEffect(() => {
    setWhatnotActive(true);
    return () => setWhatnotActive(false);
  }, []);

  const { columns, done } = useMemo(() => groupColumns(boxes), [boxes]);
  const width = plan?.number_width ?? 2;
  const lotOf = (s: LineState) => lines.get(s.line.line_key)?.lot;
  const lotsIn = (box: BoxGroup) =>
    box.lines
      .map(lotOf)
      .filter((n): n is number => Boolean(n))
      .sort((a, b) => a - b)
      .map((n) => lotLabel(n, width))
      .join(' ');
  const shows = snap.shows?.shows ?? [];
  const ordersToPick = [...orderStates.values()].filter((s) => !isDone(s)).length;

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    handleScan(code);
  };
  const openBox = (boxId: string) => router.push({ pathname: '/pick/whatnot/box/[boxId]', params: { boxId } });
  const openItem = (sku: string) => router.push({ pathname: '/pick/whatnot/item/[sku]', params: { sku } });

  const putBack = (sku: string, previous: string | null) =>
    Alert.alert(`Put ${sku} back?`, previous ? `Back into ${previous}.` : 'Back where it came from.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Put back',
        onPress: () => {
          recordWhatnotEvent({ action: 'undo', sku, boxId: null, method: 'manual', note: 'put back: removed from show' });
          void refreshPlan();
        },
      },
    ]);

  const renderEmpty = () => {
    if (snap.refreshing) {
      return <EmptyState icon="arrow.triangle.2.circlepath" iconColor={colors.blue} title="Loading the show from the Mac…" />;
    }
    if (snap.online === false) {
      return (
        <EmptyState
          icon="wifi.slash"
          title="Can't reach the Mac"
          message={snap.refreshError ?? `Check that the portal is running at ${orders.serverUrl || '(not set)'}.`}
          action={
            <View style={styles.emptyActions}>
              <Button label="Try again" icon="arrow.clockwise" filled onPress={() => void refreshAll()} />
              <Button label="Server settings" tone="neutral" onPress={() => router.push('/pick-settings')} />
            </View>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="video.slash"
        title="No Whatnot show to pick"
        message="Publish a show plan in the ops console's Whatnot tab first."
        action={<Button label="Reload" icon="arrow.clockwise" filled onPress={() => void refreshAll()} />}
      />
    );
  };

  const lineupRow = ({ line, state }: LineupRow) => {
    const st = statusIcon(state, line);
    const sold = line.status === 'sold';
    const where = state?.status === 'picked' ? prepBox : line.box_id ?? 'no location';
    const piece = Boolean(line.bundle_sku);
    return (
      <Pressable key={line.line_key} onPress={() => openItem(line.sku)} style={({ pressed }) => [styles.lineupRow, pressed && { opacity: 0.6 }]}>
        {piece ? (
          <Text style={[styles.pieceNo, tabular]}>{line.bundle_pos}/{line.bundle_size}</Text>
        ) : (
          <Text style={[styles.lot, tabular, sold && styles.soldText]}>{lotLabel(line.lot, width)}</Text>
        )}
        {state ? (
          <PickImage line={state.line} size={44} uri={whatnotImageUri(line.image_url ?? line.image_url_full)} onPress={() => openItem(line.sku)} />
        ) : null}
        <View style={styles.lineupText}>
          <Text style={[styles.lineupTitle, sold && styles.soldTitle]} numberOfLines={1}>
            {line.title}
          </Text>
          <Text style={styles.lineupSub} numberOfLines={1}>
            {sold ? 'SOLD · leave out' : `${labelSku(line.sku)} · ${where}`}
          </Text>
        </View>
        <Icon name={st.icon} color={st.color} size={22} />
      </Pressable>
    );
  };

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen options={{ headerRight: () => <HeaderButtons several={shows.length > 1} /> }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refreshAll()} />}
      >
        <ScanCapture onScan={onScan} />
        <ModeSwitch
          mode="whatnot"
          ordersCount={orders.list ? String(ordersToPick) : undefined}
          whatnotCount={plan ? `${picked}/${total}` : undefined}
        />
        {!plan ? (
          renderEmpty()
        ) : (
          <>
            {snap.stale ? (
              <Pressable style={[shared.card, styles.staleBar]} onPress={() => void refreshPlan()}>
                <Icon name="exclamationmark.arrow.triangle.2.circlepath" color={colors.onYellow} size={18} />
                <Text style={styles.staleText}>Lineup changed on the Mac · tap to reload</Text>
              </Pressable>
            ) : null}

            {/* Show card */}
            <Card style={styles.firstCard}>
              <Pressable
                disabled={shows.length < 2}
                onPress={() => router.push('/pick/whatnot/shows')}
                style={styles.summary}
              >
                <View style={styles.showRow}>
                  <Icon name="video.fill" color={colors.label} size={17} />
                  <Text style={styles.showTitle} numberOfLines={1}>
                    {plan.title}
                  </Text>
                  {shows.length > 1 ? <Icon name="chevron.down" color={colors.secondaryLabel} size={14} weight="semibold" /> : null}
                </View>
                <Text style={styles.summaryMeta}>
                  {formatShowTime(plan.whatnot_scheduled_at, plan.scheduled_at)} · {plan.whatnot_status ?? 'scheduled'}
                </Text>
                <View style={styles.summaryTop}>
                  <Text style={[styles.bigNumber, tabular]}>{toPick}</Text>
                  <Text style={styles.bigLabel}>to pick</Text>
                  <Text style={[styles.summaryRight, tabular]}>
                    {picked} of {total} in {prepBox}
                  </Text>
                </View>
                <ProgressBar value={total > 0 ? picked / total : 0} color={toPick === 0 ? colors.green : colors.yellow} />
                <Text style={styles.summaryMeta}>
                  {lotLabel(1, width)}–{lotLabel(plan.lines.length, width)} · {boxes.size} {boxes.size === 1 ? 'box' : 'boxes'}
                  {missing > 0 ? ` · ${missing} missing` : ''}
                  {data.soldCount > 0 ? ` · ${data.soldCount} sold` : ''}
                </Text>
                <View style={styles.syncRow}>
                  {snap.refreshing ? (
                    <>
                      <ActivityIndicator size="small" />
                      <Text style={styles.syncText}>Loading…</Text>
                    </>
                  ) : snap.refreshError ? (
                    <>
                      <Icon name="exclamationmark.circle.fill" color={colors.red} size={15} />
                      <Text style={[styles.syncText, { color: colors.red }]} numberOfLines={2}>
                        Offline · showing the list from {clock(snap.plan?.loadedAt ?? null)}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.syncText}>Loaded {clock(snap.plan?.loadedAt ?? null)} ·</Text>
                      {snap.unsentCount > 0 ? (
                        <>
                          <Icon name="arrow.up.circle.fill" color={colors.orange} size={15} />
                          <Text style={[styles.syncText, { color: colors.orange }]}>
                            {snap.unsentCount} {snap.unsentCount === 1 ? 'pick' : 'picks'} not sent
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
              </Pressable>
            </Card>

            {/* Scanner */}
            <View style={[shared.card, styles.scanner, { backgroundColor: flash ? 'rgba(255,204,0,0.45)' : tints.yellow }]}>
              <Icon name="barcode.viewfinder" color={colors.label} size={30} />
              <View style={styles.scannerText}>
                <Text style={styles.scannerTitle}>Scanner ready → {prepBox}</Text>
                <Text style={styles.scannerSub}>Scan a box label, or an item</Text>
              </View>
            </View>

            {/* By box | Lineup */}
            <View style={styles.viewSwitch}>
              {(['box', 'lineup'] as const).map((v) => (
                <Pressable key={v} onPress={() => setView(v)} style={[styles.viewSeg, view === v && styles.viewSegOn]}>
                  <Text style={[styles.viewSegText, view === v && styles.viewSegTextOn]}>
                    {v === 'box' ? 'By box' : 'Lineup'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {view === 'box' ? (
              <>
                {columns.map((column) => (
                  <View key={column.column}>
                    <SectionHeader>
                      Column {column.column} · {column.boxes.length === 1 ? '1 box' : `${column.boxes.length} boxes`}
                    </SectionHeader>
                    <Card inset={52}>
                      {column.boxes.map((box) => (
                        <BoxRow key={box.boxId} box={box} lots={lotsIn(box)} onPress={() => openBox(box.boxId)} />
                      ))}
                    </Card>
                  </View>
                ))}
                {columns.length === 0 && toPick === 0 ? (
                  <SectionFooter>Everything is pulled. Switch to Lineup to lay it out in order.</SectionFooter>
                ) : null}
                {unlocated.length > 0 ? (
                  <View>
                    <SectionHeader color={colors.orange}>Unlocated · {unlocated.length}</SectionHeader>
                    <Card inset={72}>
                      {unlocated.map((s) => (
                        <Row
                          key={s.line.line_key}
                          leading={<PickImage line={s.line} size={44} uri={whatnotImageUri(s.line.image_url)} onPress={() => openItem(s.line.sku)} />}
                          title={`${lotLabel(lotOf(s), width)}  ${labelSku(s.line.sku)}`}
                          subtitle={[bundleNote(lines.get(s.line.line_key)), s.line.title].filter(Boolean).join(' · ')}
                          chevron
                          onPress={() => openItem(s.line.sku)}
                        />
                      ))}
                    </Card>
                    <SectionFooter>No box on record. Find it, then scan it here to pick it.</SectionFooter>
                  </View>
                ) : null}
                {done.length > 0 ? (
                  <View>
                    <SectionHeader>Done · {done.length === 1 ? '1 box' : `${done.length} boxes`}</SectionHeader>
                    <Card inset={52}>
                      {done.map((box) => (
                        <BoxRow key={box.boxId} box={box} lots={lotsIn(box)} onPress={() => openBox(box.boxId)} />
                      ))}
                    </Card>
                  </View>
                ) : null}
                {alreadyInPrep.length > 0 ? (
                  <View>
                    <SectionHeader>Already in {prepBox} · {alreadyInPrep.length}</SectionHeader>
                    <Card inset={72}>
                      {alreadyInPrep.map((s) => (
                        <Row
                          key={s.line.line_key}
                          leading={<PickImage line={s.line} size={44} uri={whatnotImageUri(s.line.image_url)} onPress={() => openItem(s.line.sku)} />}
                          title={`${lotLabel(lotOf(s), width)}  ${labelSku(s.line.sku)}`}
                          subtitle={s.line.title}
                          trailing={<Icon name="checkmark.circle.fill" color={colors.green} size={20} />}
                        />
                      ))}
                    </Card>
                  </View>
                ) : null}
              </>
            ) : (
              <View>
                <SectionHeader>Auction lineup · {lineup.length}</SectionHeader>
                <Card inset={60}>
                  {lineup.map((row, i) => {
                    const b = row.line.bundle_sku;
                    if (!b || lineup[i - 1]?.line.bundle_sku === b) {
                      return lineupRow(row);
                    }
                    const prog = bundles.get(b);
                    const complete = prog && prog.picked >= prog.total;
                    // A bundle: its lot once, then one row per piece to pick.
                    return (
                      <View key={`bundle-${b}`}>
                        <View style={styles.lineupRow}>
                          <Text style={[styles.lot, tabular, row.line.status === 'sold' && styles.soldText]}>
                            {lotLabel(row.line.lot, width)}
                          </Text>
                          <View style={styles.lineupText}>
                            <Text style={styles.lineupTitle} numberOfLines={1}>
                              Bundle {b}
                            </Text>
                            <Text style={styles.lineupSub} numberOfLines={1}>
                              {row.line.status === 'sold'
                                ? 'SOLD · leave out'
                                : complete
                                  ? `All ${prog.total} pieces in ${prepBox}: put it together`
                                  : `${prog?.picked ?? 0} of ${prog?.total ?? '?'} pieces picked`}
                            </Text>
                          </View>
                          <Icon
                            name={complete ? 'shippingbox.fill' : 'shippingbox'}
                            color={complete ? colors.green : colors.secondaryLabel}
                            size={22}
                          />
                        </View>
                        {lineupRow(row)}
                      </View>
                    );
                  })}
                </Card>
                <SectionFooter>Lay the items out in this order. Tap one to see it large.</SectionFooter>
              </View>
            )}

            {plan.removed_in_prep.length > 0 ? (
              <View>
                <SectionHeader color={colors.orange}>Picked, no longer in this show · {plan.removed_in_prep.length}</SectionHeader>
                <Card>
                  {plan.removed_in_prep.map((r) => (
                    <Row
                      key={r.line_key}
                      title={`${labelSku(r.sku)} → ${r.previous_box ?? 'its old box'}`}
                      subtitle={r.title ?? ''}
                      trailing={<Button label="Put back" tone="neutral" onPress={() => putBack(r.sku, r.previous_box)} />}
                    />
                  ))}
                </Card>
                <SectionFooter>Taken off the show on the Mac after it was picked.</SectionFooter>
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
  scroll: { paddingBottom: 40 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 4 },
  headerButton: { minWidth: 28, height: 32, alignItems: 'center', justifyContent: 'center' },
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
  firstCard: { marginTop: 12 },
  staleBar: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.yellow,
  },
  staleText: { ...type.subheadline, fontWeight: '600', color: colors.onYellow, flex: 1 },
  summary: { padding: 16, gap: 8 },
  showRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  showTitle: { ...type.headline, color: colors.label, flexShrink: 1 },
  summaryTop: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  bigNumber: { fontSize: 40, fontWeight: '700', color: colors.label },
  bigLabel: { ...type.title3, color: colors.label },
  summaryRight: { ...type.subheadline, color: colors.secondaryLabel, marginLeft: 'auto' },
  summaryMeta: { ...type.subheadline, color: colors.secondaryLabel },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  syncText: { ...type.footnote, color: colors.secondaryLabel, flexShrink: 1 },
  scanner: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  scannerText: { flex: 1, gap: 1 },
  scannerTitle: { ...type.headline, color: colors.label },
  scannerSub: { ...type.subheadline, color: colors.secondaryLabel },
  viewSwitch: {
    flexDirection: 'row',
    marginHorizontal: 48,
    marginTop: 18,
    padding: 2,
    borderRadius: 8,
    backgroundColor: colors.fill,
  },
  viewSeg: { flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 6 },
  viewSegOn: { backgroundColor: colors.card },
  viewSegText: { ...type.footnote, fontWeight: '600', color: colors.secondaryLabel },
  viewSegTextOn: { color: colors.label },
  lineupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 60,
  },
  lot: { fontSize: 22, fontWeight: '700', color: colors.label, minWidth: 48 },
  pieceNo: { ...type.footnote, color: colors.secondaryLabel, minWidth: 48, textAlign: 'right', paddingRight: 6 },
  lineupText: { flex: 1, gap: 2 },
  lineupTitle: { ...type.subheadline, color: colors.label },
  lineupSub: { ...type.footnote, color: colors.secondaryLabel },
  soldText: { color: colors.tertiaryLabel },
  soldTitle: { color: colors.tertiaryLabel, textDecorationLine: 'line-through' },
  emptyActions: { gap: 10, alignSelf: 'stretch' },
});
