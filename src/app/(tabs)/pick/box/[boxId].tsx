import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { PickImage } from '@/components/pick/PickImage';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Pill, ProgressBar, Row, SectionHeader, Icon } from '@/components/ui';
import {
  groupColumns,
  labelSku,
  shortDate,
  shortOrderId,
  shortStore,
  type LineState,
} from '@/lib/pick/derive';
import { boxLabel } from '@/lib/pick/boxLabel';
import { recordEvent } from '@/lib/pick/store';
import { colors, shared, tabular, tints, type } from '@/lib/theme';
import { usePickData } from '@/lib/pick/usePick';
import { useScanHandler } from '@/lib/pick/useScanHandler';

const BIG_IMAGE = 128;
const SMALL_IMAGE = 44;

function formatTime(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function metaLine(state: LineState): string {
  const { line } = state;
  return `${shortStore(line.store)} · #${shortOrderId(line.order_id)} · ${shortDate(line.order_date)}`;
}

function UndoButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.undo, { opacity: pressed ? 0.5 : 1 }]}
    >
      <Icon name="arrow.uturn.backward" color={colors.blue} size={16} weight="semibold" />
    </Pressable>
  );
}

export default function BoxScreen() {
  const router = useRouter();
  const { boxId: rawBoxId } = useLocalSearchParams<{ boxId: string }>();
  const boxId = String(rawBoxId ?? '').toUpperCase();
  const { boxes } = usePickData();
  const box = boxes.get(boxId);
  const label = boxLabel(boxId, box?.room ?? null);
  const [flash, setFlash] = useState(false);
  const { banner, dismiss, handleScan, confirmManual } = useScanHandler({
    boxId,
    openBoxMode: 'replace',
  });

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

  const openLines = box?.lines.filter((s) => s.status === 'open') ?? [];
  const missingLines = box?.lines.filter((s) => s.status === 'missing') ?? [];
  // Partly picked lines (qty > 1) also show their picked units here.
  const pickedLines = box?.lines.filter((s) => s.pickedQty > 0) ?? [];

  const askManual = (state: LineState) =>
    Alert.alert('Mark as picked without scanning?', `${labelSku(state.line.sku)}\n${state.line.title}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark Picked', onPress: () => confirmManual(state) },
    ]);

  const askUndo = (state: LineState) =>
    Alert.alert(
      state.status === 'missing' ? 'Clear the missing mark?' : 'Undo this pick?',
      labelSku(state.line.sku),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: () => recordEvent({ action: 'undo', line: state.line, boxId, method: 'manual' }),
        },
      ]
    );

  const openCantFind = (state: LineState) =>
    router.push({
      pathname: '/pick/missing/[lineKey]',
      params: { lineKey: state.line.line_key, from: boxId },
    });

  const openBox = (id: string) => router.replace({ pathname: '/pick/box/[boxId]', params: { boxId: id } });

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen
        options={{
          title: boxId,
          headerRight: () =>
            box ? (
              <Pill tone={box.done ? 'green' : 'neutral'}>
                {box.pickedQty}/{box.totalQty}
              </Pill>
            ) : null,
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        <ScanCapture onScan={onScan} />
        {!box ? (
          <EmptyState
            icon="shippingbox"
            title={`Nothing to pick in ${boxId}`}
            message="None of the orders waiting to ship have items in this box."
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
                    <SectionHeader>Still to pick in column {box.column}</SectionHeader>
                    <Card inset={52}>
                      {remainingInColumn.map((b) => (
                        <Row
                          key={b.boxId}
                          leading={
                            <Icon
                              name={b.pickedQty > 0 ? 'circle.lefthalf.filled' : 'circle'}
                              color={b.pickedQty > 0 ? colors.blue : colors.tertiaryLabel}
                              size={24}
                            />
                          }
                          title={b.boxId}
                          subtitle={`${b.totalQty} ${b.totalQty === 1 ? 'item' : 'items'}`}
                          trailing={
                            <Pill>
                              {b.pickedQty}/{b.totalQty}
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
                  onPress={() => router.dismissTo('/pick')}
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
                        {box.pickedQty} of {box.totalQty} picked
                      </Text>
                    </View>
                    <ProgressBar value={box.totalQty > 0 ? box.pickedQty / box.totalQty : 0} />
                  </View>
                </Card>
                <View
                  style={[
                    shared.card,
                    styles.scanner,
                    { backgroundColor: flash ? 'rgba(0,122,255,0.28)' : tints.blue },
                  ]}
                >
                  <Icon name="barcode.viewfinder" color={colors.blue} size={28} />
                  <Text style={styles.scannerText}>Scan an item to pick it</Text>
                </View>
              </>
            )}

            {openLines.length > 0 ? (
              <SectionHeader>To pick · {openLines.length}</SectionHeader>
            ) : null}
            {openLines.map((state) => {
              const qty = Math.max(1, state.line.qty);
              return (
                <Card key={state.line.line_key} style={styles.itemCard}>
                  <View style={styles.item}>
                    <View style={styles.itemTop}>
                      <PickImage line={state.line} size={BIG_IMAGE} boxId={boxId} zoomHint />
                      <View style={styles.itemInfo}>
                        <View style={styles.skuRow}>
                          <Text style={styles.sku} numberOfLines={1}>
                            {labelSku(state.line.sku)}
                          </Text>
                          {qty > 1 ? <Pill tone="orange">×{qty}</Pill> : null}
                        </View>
                        <Text style={styles.title} numberOfLines={4}>
                          {state.line.title}
                        </Text>
                        <Text style={styles.meta}>{metaLine(state)}</Text>
                        {qty > 1 ? (
                          <Text style={[styles.partial, tabular]}>
                            Scanned {state.pickedQty} of {qty}
                          </Text>
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
                        label="Mark picked"
                        icon="checkmark"
                        onPress={() => askManual(state)}
                        style={styles.itemButton}
                      />
                    </View>
                  </View>
                </Card>
              );
            })}

            {missingLines.length > 0 ? (
              <>
                <SectionHeader color={colors.orange}>Missing · {missingLines.length}</SectionHeader>
                <Card inset={76}>
                  {missingLines.map((state) => (
                    <Row
                      key={state.line.line_key}
                      leading={<PickImage line={state.line} size={SMALL_IMAGE} boxId={boxId} />}
                      title={labelSku(state.line.sku)}
                      subtitle={state.missingNote ? `“${state.missingNote}”` : state.line.title}
                      trailing={<UndoButton onPress={() => askUndo(state)} />}
                      onPress={() => openCantFind(state)}
                    />
                  ))}
                </Card>
              </>
            ) : null}

            {pickedLines.length > 0 ? (
              <>
                <SectionHeader>Picked · {pickedLines.length}</SectionHeader>
                <Card inset={76}>
                  {pickedLines.map((state) => (
                    <Row
                      key={state.line.line_key}
                      leading={<PickImage line={state.line} size={SMALL_IMAGE} boxId={boxId} />}
                      title={
                        <View style={styles.pickedTitle}>
                          <Icon name="checkmark.circle.fill" color={colors.green} size={16} />
                          <Text style={styles.pickedSku} numberOfLines={1}>
                            {labelSku(state.line.sku)}
                          </Text>
                          {state.line.qty > 1 ? (
                            <Text style={[styles.pickedMeta, tabular]}>
                              {state.pickedQty}/{state.line.qty}
                            </Text>
                          ) : null}
                        </View>
                      }
                      subtitle={[
                        state.pickedAt ? formatTime(state.pickedAt) : null,
                        state.method === 'manual' ? 'marked by hand' : null,
                        state.line.title,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      trailing={<UndoButton onPress={() => askUndo(state)} />}
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
  scroll: {
    paddingBottom: 40,
  },
  firstCard: {
    marginTop: 12,
  },
  summary: {
    padding: 16,
    gap: 10,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryLeft: {
    flexShrink: 1,
    gap: 2,
  },
  summaryLabel: {
    ...type.footnote,
    color: colors.secondaryLabel,
  },
  summaryTitle: {
    ...type.headline,
    color: colors.label,
  },
  summaryRight: {
    ...type.subheadline,
    color: colors.secondaryLabel,
    marginLeft: 'auto',
  },
  scanner: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  scannerText: {
    ...type.headline,
    color: colors.blue,
  },
  donePanel: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 6,
  },
  doneTitle: {
    ...type.title2,
    color: colors.label,
  },
  doneSub: {
    ...type.subheadline,
    color: colors.secondaryLabel,
    textAlign: 'center',
  },
  allColumns: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  itemCard: {
    marginBottom: 12,
  },
  item: {
    padding: 12,
    gap: 12,
  },
  itemTop: {
    flexDirection: 'row',
    gap: 12,
  },
  itemInfo: {
    flex: 1,
    gap: 4,
  },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sku: {
    ...type.title3,
    color: colors.label,
    flexShrink: 1,
  },
  title: {
    ...type.subheadline,
    color: colors.label,
  },
  meta: {
    ...type.footnote,
    color: colors.secondaryLabel,
  },
  partial: {
    ...type.subheadline,
    fontWeight: '600',
    color: colors.blue,
  },
  itemButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  itemButton: {
    flex: 1,
  },
  pickedTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickedSku: {
    ...type.headline,
    color: colors.label,
    flexShrink: 1,
  },
  pickedMeta: {
    ...type.subheadline,
    color: colors.secondaryLabel,
  },
  undo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: tints.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
