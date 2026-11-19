import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { PickImage } from '@/components/pick/PickImage';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Icon, Pill, SectionHeader } from '@/components/ui';
import { WhatnotStrip } from '@/components/whatnot-pick/WhatnotStrip';
import { labelSku, type LineState } from '@/lib/pick/derive';
import { colors, shared, tabular, tints, type } from '@/lib/theme';
import { recordWhatnotEvent, whatnotImageUri } from '@/lib/whatnot-pick/store';
import { bundleNote, lotLabel, useWhatnotData, useWhatnotScan } from '@/lib/whatnot-pick/useWhatnot';

// One storage box of the open Whatnot show: its items with their lineup
// numbers, Mark picked / Undo / Can't find. Mirrors pick/box/[boxId].tsx.
export default function WhatnotBoxScreen() {
  const router = useRouter();
  const { boxId: raw } = useLocalSearchParams<{ boxId: string }>();
  const boxId = String(raw ?? '').toUpperCase();
  const { boxes, plan, prepBox, lines } = useWhatnotData();
  const box = boxes.get(boxId);
  const width = plan?.number_width ?? 2;
  const [flash, setFlash] = useState(false);
  const { banner, dismiss, handleScan, confirmManual } = useWhatnotScan({ boxId, openBoxMode: 'replace' });

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    handleScan(code);
  };

  const lot = (s: LineState) => lines.get(s.line.line_key)?.lot;
  const sorted = [...(box?.lines ?? [])].sort((a, b) => (lot(a) ?? 0) - (lot(b) ?? 0));

  const askManual = (s: LineState) =>
    Alert.alert('Mark as picked without scanning?', `${lotLabel(lot(s), width)} ${labelSku(s.line.sku)}\n${s.line.title}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark Picked', onPress: () => confirmManual(s) },
    ]);
  const askUndo = (s: LineState) =>
    Alert.alert(s.status === 'missing' ? 'Clear the missing mark?' : `Undo: put it back in ${boxId}?`, labelSku(s.line.sku), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo',
        style: 'destructive',
        onPress: () => recordWhatnotEvent({ action: 'undo', line: s.line, boxId, method: 'manual' }),
      },
    ]);
  const askMissing = (s: LineState) =>
    Alert.prompt?.(
      "Can't find it?",
      `${lotLabel(lot(s), width)} ${labelSku(s.line.sku)} isn't in ${boxId}. Add a note (optional).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: "Can't find",
          style: 'destructive',
          onPress: (note?: string) =>
            recordWhatnotEvent({ action: 'missing', line: s.line, boxId, method: 'manual', note: note || null }),
        },
      ],
      'plain-text'
    );
  const openItem = (s: LineState) => router.push({ pathname: '/pick/whatnot/item/[sku]', params: { sku: s.line.sku } });

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
        <WhatnotStrip subtitle={plan?.title} />
        <ScanCapture onScan={onScan} />
        {!box ? (
          <EmptyState icon="shippingbox" title={`Nothing to pick in ${boxId}`} message="No item of this show is in this box." />
        ) : (
          <>
            {box.done ? (
              <Card style={styles.firstCard}>
                <View style={styles.donePanel}>
                  <Icon name="checkmark.circle.fill" color={colors.green} size={48} />
                  <Text style={styles.doneTitle}>{boxId} done</Text>
                  <Text style={styles.doneSub}>Scan the next box.</Text>
                </View>
              </Card>
            ) : null}
            <SectionHeader>
              {box.lines.length} {box.lines.length === 1 ? 'item' : 'items'} for the show
            </SectionHeader>
            <Card inset={16}>
              {sorted.map((s) => {
                const picked = s.status === 'picked';
                const missing = s.status === 'missing';
                return (
                  <View key={s.line.line_key} style={styles.item}>
                    <PickImage line={s.line} size={88} uri={whatnotImageUri(s.line.image_url)} onPress={() => openItem(s)} zoomHint />
                    <View style={styles.itemText}>
                      <Text style={[styles.lot, tabular, picked && { color: colors.green }]}>{lotLabel(lot(s), width)}</Text>
                      <Text style={styles.sku}>{labelSku(s.line.sku)}</Text>
                      {lines.get(s.line.line_key)?.bundle_sku ? (
                        <Text style={styles.bundle}>{bundleNote(lines.get(s.line.line_key))}</Text>
                      ) : null}
                      <Text style={styles.title} numberOfLines={2}>
                        {s.line.title}
                      </Text>
                      {picked ? (
                        <View style={styles.statusRow}>
                          <Icon name="checkmark.circle.fill" color={colors.green} size={16} />
                          <Text style={[styles.status, { color: colors.green }]}>In {prepBox}</Text>
                          <Pressable hitSlop={8} onPress={() => askUndo(s)}>
                            <Icon name="arrow.uturn.backward" color={colors.blue} size={16} weight="semibold" />
                          </Pressable>
                        </View>
                      ) : missing ? (
                        <View style={styles.statusRow}>
                          <Icon name="exclamationmark.triangle.fill" color={colors.orange} size={16} />
                          <Text style={[styles.status, { color: colors.orange }]}>Can’t find</Text>
                          <Pressable hitSlop={8} onPress={() => askUndo(s)}>
                            <Icon name="arrow.uturn.backward" color={colors.blue} size={16} weight="semibold" />
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.buttons}>
                          <Button label="Mark picked" onPress={() => askManual(s)} />
                          <Button label="Can't find" tone="neutral" onPress={() => askMissing(s)} />
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        )}
        <View style={[shared.card, styles.scanner, { backgroundColor: flash ? 'rgba(255,204,0,0.45)' : tints.yellow }]}>
          <Icon name="barcode.viewfinder" color={colors.onYellow} size={26} />
          <Text style={styles.scannerTitle}>Scan an item in this box</Text>
        </View>
      </ScrollView>
      <ScanBanner banner={banner} onDismiss={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  firstCard: { marginTop: 12 },
  donePanel: { alignItems: 'center', padding: 18, gap: 6 },
  doneTitle: { ...type.title3, color: colors.label },
  doneSub: { ...type.subheadline, color: colors.secondaryLabel },
  item: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingRight: 12 },
  itemText: { flex: 1, gap: 3 },
  lot: { fontSize: 30, fontWeight: '800', color: colors.label },
  sku: { ...type.subheadline, fontWeight: '600', color: colors.label },
  title: { ...type.footnote, color: colors.secondaryLabel },
  bundle: { ...type.footnote, fontWeight: '600', color: colors.orange },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  status: { ...type.subheadline, fontWeight: '600', flex: 1 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 6 },
  scanner: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  scannerTitle: { ...type.headline, color: colors.onYellow },
});
