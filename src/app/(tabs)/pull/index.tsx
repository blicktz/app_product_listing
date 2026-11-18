import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { ModeStrip, ScannerCard } from '@/components/pull/PullChrome';
import { PullImage } from '@/components/pull/PullImage';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Icon, Pill, ProgressBar, Row, SectionFooter, SectionHeader } from '@/components/ui';
import { groupColumns, unitsLeft, type PullBox } from '@/lib/pull/derive';
import { refreshPullList } from '@/lib/pull/store';
import { usePullData } from '@/lib/pull/usePull';
import { usePullScanHandler } from '@/lib/pull/useScanHandler';
import { colors, shared, tabular, type } from '@/lib/theme';

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

function boxStatus(box: PullBox): { icon: SFSymbol; color: typeof colors.blue } {
  if (box.done) {
    return box.lines.some((s) => s.status === 'missing')
      ? { icon: 'exclamationmark.triangle.fill', color: colors.orange }
      : { icon: 'checkmark.circle.fill', color: colors.green };
  }
  return box.doneLines > 0 || box.lines.some((s) => s.pulled_qty > 0)
    ? { icon: 'circle.lefthalf.filled', color: colors.purple }
    : { icon: 'circle', color: colors.tertiaryLabel };
}

function BoxRow({ box, onPress }: { box: PullBox; onPress: () => void }) {
  const status = boxStatus(box);
  const missing = box.lines.filter((s) => s.status === 'missing').length;
  const parts = [plural(box.lines.length, 'line')];
  if (box.doneLines > 0 && !box.done) {
    parts.push(`${box.doneLines} done`);
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
          {box.doneLines}/{box.lines.length}
        </Pill>
      }
      chevron
      onPress={onPress}
    />
  );
}

function HeaderButtons() {
  const router = useRouter();
  const { snap } = usePullData();
  const dot = snap.online === null ? colors.tertiaryLabel : snap.online ? colors.green : colors.red;
  return (
    <View style={styles.headerButtons}>
      <Pressable hitSlop={8} onPress={() => router.push('/pick-settings')} style={styles.headerButton}>
        <Icon name="desktopcomputer" color={colors.purple} size={22} />
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
      </Pressable>
      <Pressable
        hitSlop={8}
        onPress={() => void refreshPullList()}
        disabled={snap.refreshing}
        style={styles.headerButton}
      >
        {snap.refreshing ? (
          <ActivityIndicator />
        ) : (
          <Icon name="arrow.clockwise" color={colors.purple} size={21} weight="medium" />
        )}
      </Pressable>
    </View>
  );
}

export default function PullHomeScreen() {
  const router = useRouter();
  const { snap, states, boxes, block } = usePullData();
  const { banner, dismiss, handleScan } = usePullScanHandler({ boxId: null, openBoxMode: 'push' });
  const [doneOpen, setDoneOpen] = useState(false);
  const [flash, setFlash] = useState(false);

  const { columns, done } = useMemo(() => groupColumns(boxes), [boxes]);
  const all = [...states.values()];
  const unlocated = all.filter((s) => !s.box_id && !s.complete);
  const doneUnlocated = all.filter((s) => !s.box_id && s.complete);
  const linesLeft = all.filter((s) => !s.complete).length;
  const linesDone = all.length - linesLeft;
  const missing = all.filter((s) => s.status === 'missing').length;
  let unitsKnown = 0;
  let unknown = false;
  for (const s of all) {
    const left = unitsLeft(s);
    if (left === null) {
      unknown = true;
    } else {
      unitsKnown += left;
    }
  }

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    handleScan(code);
  };

  const openBox = (boxId: string) => router.push({ pathname: '/pull/box/[boxId]', params: { boxId } });
  const openLine = (lineKey: string) => router.push({ pathname: '/pull/missing/[lineKey]', params: { lineKey } });

  const renderEmpty = () => {
    if (snap.refreshing) {
      return (
        <EmptyState
          icon="arrow.triangle.2.circlepath"
          iconColor={colors.purple}
          title="Syncing orders on the Mac…"
          message="The Mac syncs orders before it builds the pull list. This can take up to 2 minutes."
        />
      );
    }
    if (snap.listRefused) {
      return (
        <EmptyState
          icon="exclamationmark.triangle.fill"
          iconColor={colors.orange}
          title="Orders couldn’t be synced"
          message="The Mac builds the pull list only after a good order sync. Pulling is paused until it works again."
          action={<Button label="Try again" icon="arrow.clockwise" tone="purple" filled onPress={() => void refreshPullList()} />}
        />
      );
    }
    if (snap.online === false) {
      return (
        <EmptyState
          icon="wifi.slash"
          title="Can't reach the Mac"
          message={snap.refreshError ?? `Pull works only online. Check that the portal is running at ${snap.serverUrl || '(not set)'}.`}
          action={
            <View style={styles.emptyActions}>
              <Button label="Try again" icon="arrow.clockwise" tone="purple" filled onPress={() => void refreshPullList()} />
              <Button label="Server settings" tone="neutral" onPress={() => router.push('/pick-settings')} />
            </View>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="xmark.bin"
        iconColor={colors.purple}
        title="No pull list yet"
        message="Load the ended listings whose stock is to be pulled and disposed of."
        action={<Button label="Load pull list" icon="arrow.down.circle" tone="purple" filled onPress={() => void refreshPullList()} />}
      />
    );
  };

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen options={{ headerRight: () => <HeaderButtons /> }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refreshPullList()} />}
      >
        <ScanCapture onScan={onScan} />
        <ModeStrip />
        {!snap.list ? (
          renderEmpty()
        ) : (
          <>
            <Card style={styles.firstCard}>
              <View style={styles.summary}>
                <View style={styles.summaryTop}>
                  <Text style={[styles.bigNumber, tabular]}>{linesLeft}</Text>
                  <Text style={styles.bigLabel}>{linesLeft === 1 ? 'line to pull' : 'lines to pull'}</Text>
                  <Text style={[styles.summaryRight, tabular]}>
                    {linesDone} of {all.length} done
                  </Text>
                </View>
                <ProgressBar value={all.length > 0 ? linesDone / all.length : 0} color={linesLeft === 0 ? colors.green : colors.purple} />
                <Text style={styles.summaryMeta}>
                  {unitsKnown}
                  {unknown ? '+' : ''} {unitsKnown === 1 && !unknown ? 'unit' : 'units'} · {boxes.size}{' '}
                  {boxes.size === 1 ? 'box' : 'boxes'}
                  {missing > 0 ? ` · ${missing} missing` : ''}
                </Text>
                <View style={styles.syncRow}>
                  {snap.refreshing ? (
                    <>
                      <ActivityIndicator size="small" />
                      <Text style={styles.syncText}>Syncing orders on the Mac…</Text>
                    </>
                  ) : snap.refreshError ? (
                    <>
                      <Icon name="exclamationmark.circle.fill" color={colors.red} size={15} />
                      <Text style={[styles.syncText, { color: colors.red }]} numberOfLines={2}>
                        Reload failed · {snap.refreshError}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.syncText}>
                      Loaded {formatTime(snap.loadedAt)} · orders synced {formatTime(snap.ordersSync?.at ?? null)}
                    </Text>
                  )}
                </View>
              </View>
            </Card>

            <ScannerCard
              block={block}
              flash={flash}
              title="Scanner ready (Pull)"
              subtitle="Scan a box label to start"
              serverUrl={snap.serverUrl}
            />

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
                <SectionHeader color={colors.orange}>Unlocated · {plural(unlocated.length, 'line')}</SectionHeader>
                <Card inset={72}>
                  {unlocated.map((s) => (
                    <Row
                      key={s.line_key}
                      leading={<PullImage line={s} size={44} />}
                      title={s.sku}
                      subtitle={s.title}
                      chevron
                      onPress={() => openLine(s.line_key)}
                    />
                  ))}
                </Card>
                <SectionFooter>No box on record. Tap one to see where items from the same batch are.</SectionFooter>
              </View>
            ) : null}

            {done.length > 0 || doneUnlocated.length > 0 ? (
              <View>
                <Pressable style={styles.doneHeader} onPress={() => setDoneOpen((v) => !v)}>
                  <Text style={styles.doneHeaderText}>
                    Done · {done.length === 1 ? '1 box' : `${done.length} boxes`}
                    {doneUnlocated.length > 0 ? ` · ${plural(doneUnlocated.length, 'unlocated line')}` : ''}
                  </Text>
                  <Icon name={doneOpen ? 'chevron.down' : 'chevron.right'} color={colors.secondaryLabel} size={12} weight="semibold" />
                </Pressable>
                {doneOpen ? (
                  <Card inset={52}>
                    {done.map((box) => (
                      <BoxRow key={box.boxId} box={box} onPress={() => openBox(box.boxId)} />
                    ))}
                    {doneUnlocated.map((s) => (
                      <Row
                        key={s.line_key}
                        leading={<PullImage line={s} size={36} />}
                        title={s.sku}
                        subtitle={s.status === 'missing' ? 'Missing' : 'Pulled'}
                        chevron
                        onPress={() => openLine(s.line_key)}
                      />
                    ))}
                  </Card>
                ) : null}
              </View>
            ) : null}

            {all.length > 0 && linesLeft === 0 ? (
              <EmptyState
                icon="checkmark.seal.fill"
                iconColor={colors.green}
                title="All pulled"
                message="Every line on the list is pulled or marked missing."
              />
            ) : null}
            {all.length === 0 ? (
              <EmptyState icon="xmark.bin" title="Nothing to pull" message="No ended listing is waiting to be pulled." />
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
  summary: { padding: 16, gap: 10 },
  summaryTop: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  bigNumber: { fontSize: 40, fontWeight: '700', color: colors.label },
  bigLabel: { ...type.title3, color: colors.label },
  summaryRight: { ...type.subheadline, color: colors.secondaryLabel, marginLeft: 'auto' },
  summaryMeta: { ...type.subheadline, color: colors.secondaryLabel },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  syncText: { ...type.footnote, color: colors.secondaryLabel, flexShrink: 1 },
  doneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 22,
    marginBottom: 6,
    marginHorizontal: 32,
  },
  doneHeaderText: { ...type.footnote, color: colors.secondaryLabel, textTransform: 'uppercase' },
  emptyActions: { gap: 10, alignSelf: 'stretch' },
});
