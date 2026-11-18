import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ModeStrip, ScannerCard } from '@/components/pull/PullChrome';
import { PullImage } from '@/components/pull/PullImage';
import { askUndo, confirmFinish, confirmManualPull } from '@/components/pull/lineActions';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Icon, Pill, ProgressBar, Row, SectionHeader } from '@/components/ui';
import { boxLabel } from '@/lib/pick/boxLabel';
import { actionsLabel, countLabel, groupColumns, shortDate, type PullLineState } from '@/lib/pull/derive';
import { usePullData } from '@/lib/pull/usePull';
import { usePullScanHandler } from '@/lib/pull/useScanHandler';
import { colors, shared, tabular, tints, type } from '@/lib/theme';

const BIG_IMAGE = 128;
const SMALL_IMAGE = 44;

function metaLine(state: PullLineState): string {
  return [actionsLabel(state), state.decided_at ? `decided ${shortDate(state.decided_at)}` : null]
    .filter(Boolean)
    .join(' · ');
}

function doneSubtitle(state: PullLineState): string {
  if (state.status === 'missing') {
    return state.pulled_qty > 0 ? `Missing · ${state.pulled_qty} pulled first` : 'Marked missing';
  }
  const short = state.units_to_pull !== null && state.pulled_qty < state.units_to_pull;
  return short
    ? `Pulled ${state.pulled_qty} of ${state.units_to_pull} · rest recorded missing`
    : `Pulled ${state.pulled_qty} · ${state.title}`;
}

function MoreButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.more, { opacity: disabled ? 0.3 : pressed ? 0.5 : 1 }]}
    >
      <Icon name="ellipsis" color={colors.purple} size={16} weight="semibold" />
    </Pressable>
  );
}

export default function PullBoxScreen() {
  const router = useRouter();
  const { boxId: rawBoxId } = useLocalSearchParams<{ boxId: string }>();
  const boxId = String(rawBoxId ?? '').toUpperCase();
  const { snap, boxes, block, busy } = usePullData();
  const box = boxes.get(boxId);
  const label = boxLabel(boxId, box?.room ?? null);
  const [flash, setFlash] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const { banner, dismiss, handleScan, pullManual, finish, undo } = usePullScanHandler({
    boxId,
    openBoxMode: 'replace',
  });
  const canPull = block === null && !busy;

  const remainingInColumn = useMemo(() => {
    if (!box) {
      return [];
    }
    const { columns } = groupColumns(boxes);
    return (columns.find((c) => c.column === box.column)?.boxes ?? []).filter((b) => b.boxId !== boxId);
  }, [boxes, box, boxId]);

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    handleScan(code);
  };

  const openLines = box?.lines.filter((s) => !s.complete) ?? [];
  const doneLines = box?.lines.filter((s) => s.complete) ?? [];

  const openCantFind = (state: PullLineState) =>
    router.push({ pathname: '/pull/missing/[lineKey]', params: { lineKey: state.line_key, from: boxId } });
  const openBox = (id: string) => router.replace({ pathname: '/pull/box/[boxId]', params: { boxId: id } });
  const onUndo = (state: PullLineState) => askUndo(state, (reason) => void undo(state, reason), setPromptOpen);

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen
        options={{
          title: boxId,
          headerRight: () =>
            box ? (
              <Pill tone={box.done ? 'green' : 'purple'}>
                {box.doneLines}/{box.lines.length}
              </Pill>
            ) : null,
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        <ScanCapture onScan={onScan} enabled={!promptOpen} />
        <ModeStrip />
        {!box ? (
          <EmptyState
            icon="xmark.bin"
            title={`Nothing to pull in ${boxId}`}
            message="No ended listing on the pull list has stock in this box."
          />
        ) : (
          <>
            {box.done ? (
              <>
                <Card style={styles.firstCard}>
                  <View style={styles.donePanel}>
                    <Icon name="checkmark.circle.fill" color={colors.green} size={52} />
                    <Text style={styles.doneTitle}>{boxId} done</Text>
                    <Text style={styles.doneSub}>
                      {remainingInColumn.length > 0
                        ? `${remainingInColumn.length} more ${remainingInColumn.length === 1 ? 'box' : 'boxes'} in column ${box.column}. Scan the next one.`
                        : `Column ${box.column} is finished.`}
                    </Text>
                  </View>
                </Card>
                {remainingInColumn.length > 0 ? (
                  <>
                    <SectionHeader>Still to pull in column {box.column}</SectionHeader>
                    <Card inset={52}>
                      {remainingInColumn.map((b) => (
                        <Row
                          key={b.boxId}
                          leading={
                            <Icon
                              name={b.doneLines > 0 ? 'circle.lefthalf.filled' : 'circle'}
                              color={b.doneLines > 0 ? colors.purple : colors.tertiaryLabel}
                              size={24}
                            />
                          }
                          title={b.boxId}
                          subtitle={`${b.lines.length} ${b.lines.length === 1 ? 'line' : 'lines'}`}
                          trailing={
                            <Pill>
                              {b.doneLines}/{b.lines.length}
                            </Pill>
                          }
                          chevron
                          onPress={() => openBox(b.boxId)}
                        />
                      ))}
                    </Card>
                  </>
                ) : null}
                <Button
                  label="All columns"
                  icon="square.grid.2x2"
                  tone="neutral"
                  onPress={() => router.dismissTo('/pull')}
                  style={styles.allColumns}
                />
              </>
            ) : (
              <>
                <Card style={styles.firstCard}>
                  <View style={styles.summary}>
                    <View style={styles.summaryTop}>
                      <View style={styles.summaryLeft}>
                        <Text style={styles.summaryTitle}>
                          Column {box.column}
                          {box.room ? ` · ${box.room}` : ''}
                        </Text>
                        {label ? <Text style={[styles.summaryLabel, tabular]}>Label {label}</Text> : null}
                      </View>
                      <Text style={[styles.summaryRight, tabular]}>
                        {box.doneLines} of {box.lines.length} done
                      </Text>
                    </View>
                    <ProgressBar value={box.lines.length > 0 ? box.doneLines / box.lines.length : 0} color={colors.purple} />
                  </View>
                </Card>
                <ScannerCard block={block} flash={flash} title="Scan each unit to pull it" serverUrl={snap.serverUrl} />
              </>
            )}

            {openLines.length > 0 ? <SectionHeader>To pull · {openLines.length}</SectionHeader> : null}
            {openLines.map((state) => {
              const unknown = state.units_to_pull === null;
              return (
                <Card key={state.line_key} style={styles.itemCard}>
                  <View style={styles.item}>
                    <View style={styles.itemTop}>
                      <PullImage line={state} size={BIG_IMAGE} boxId={boxId} zoomHint />
                      <View style={styles.itemInfo}>
                        <View style={styles.skuRow}>
                          <Text style={styles.sku} numberOfLines={1}>
                            {state.sku}
                          </Text>
                          <Pill tone="purple">{countLabel(state)}</Pill>
                        </View>
                        <Text style={styles.title} numberOfLines={4}>
                          {state.title}
                        </Text>
                        <Text style={styles.meta}>{metaLine(state)}</Text>
                        {unknown ? (
                          <Text style={styles.note}>Count not on record: scan every unit, then tap No more.</Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.itemButtons}>
                      <Button
                        label="Can't find"
                        icon="magnifyingglass"
                        tone="neutral"
                        onPress={() => openCantFind(state)}
                        style={styles.itemButton}
                      />
                      <Button
                        label="Pull 1 by hand"
                        icon="hand.raised"
                        tone="purple"
                        disabled={!canPull}
                        onPress={() => confirmManualPull(state, () => void pullManual(state))}
                        style={styles.itemButton}
                      />
                    </View>
                    {state.pulled_qty > 0 || unknown ? (
                      <Button
                        label="No more in this box"
                        icon="checkmark.rectangle.stack"
                        tone="purple"
                        filled={unknown && state.pulled_qty > 0}
                        disabled={!canPull}
                        onPress={() => confirmFinish(state, () => void finish(state))}
                      />
                    ) : null}
                    {state.pulled_qty > 0 ? (
                      <Pressable onPress={() => onUndo(state)} disabled={busy} style={styles.undoLink}>
                        <Text style={[styles.undoLinkText, { opacity: busy ? 0.4 : 1 }]}>Undo a wrong scan…</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Card>
              );
            })}

            {doneLines.length > 0 ? (
              <>
                <SectionHeader>Done · {doneLines.length}</SectionHeader>
                <Card inset={76}>
                  {doneLines.map((state) => (
                    <Row
                      key={state.line_key}
                      leading={<PullImage line={state} size={SMALL_IMAGE} boxId={boxId} />}
                      title={
                        <View style={styles.doneRowTitle}>
                          <Icon
                            name={state.status === 'missing' ? 'exclamationmark.triangle.fill' : 'checkmark.circle.fill'}
                            color={state.status === 'missing' ? colors.orange : colors.green}
                            size={16}
                          />
                          <Text style={styles.doneSku} numberOfLines={1}>
                            {state.sku}
                          </Text>
                        </View>
                      }
                      subtitle={doneSubtitle(state)}
                      trailing={<MoreButton onPress={() => onUndo(state)} disabled={busy} />}
                    />
                  ))}
                </Card>
              </>
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
  firstCard: { marginTop: 12 },
  summary: { padding: 16, gap: 10 },
  summaryTop: { flexDirection: 'row', alignItems: 'center' },
  summaryLeft: { flexShrink: 1, gap: 2 },
  summaryLabel: { ...type.footnote, color: colors.secondaryLabel },
  summaryTitle: { ...type.headline, color: colors.label },
  summaryRight: { ...type.subheadline, color: colors.secondaryLabel, marginLeft: 'auto' },
  donePanel: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20, gap: 6 },
  doneTitle: { ...type.title2, color: colors.label },
  doneSub: { ...type.subheadline, color: colors.secondaryLabel, textAlign: 'center' },
  allColumns: { marginHorizontal: 16, marginTop: 20 },
  itemCard: { marginBottom: 12 },
  item: { padding: 12, gap: 12 },
  itemTop: { flexDirection: 'row', gap: 12 },
  itemInfo: { flex: 1, gap: 4 },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sku: { ...type.title3, color: colors.label, flexShrink: 1 },
  title: { ...type.subheadline, color: colors.label },
  meta: { ...type.footnote, color: colors.secondaryLabel },
  note: { ...type.footnote, fontWeight: '600', color: colors.purple },
  itemButtons: { flexDirection: 'row', gap: 10 },
  itemButton: { flex: 1 },
  undoLink: { alignSelf: 'center', paddingVertical: 2 },
  undoLinkText: { ...type.footnote, color: colors.secondaryLabel },
  doneRowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneSku: { ...type.headline, color: colors.label, flexShrink: 1 },
  more: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: tints.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
