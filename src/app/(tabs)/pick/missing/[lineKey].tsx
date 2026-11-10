import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PickImage } from '@/components/pick/PickImage';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Pill, Row, SectionFooter, SectionHeader, Icon } from '@/components/ui';
import { labelSku, shortOrderId } from '@/lib/pick/derive';
import { recordEvent } from '@/lib/pick/store';
import { colors, shared, tints, type } from '@/lib/theme';
import { usePickData } from '@/lib/pick/usePick';
import { useScanHandler } from '@/lib/pick/useScanHandler';

/** AAC-0621-001 → { batch: "AAC-0621", listed: "06-21" } */
function parseBatch(sku: string): { batch: string; listed: string } | null {
  const match = /^([A-Z]+)-?(\d{2})(\d{2})-?\d+$/.exec(sku);
  return match ? { batch: `${match[1]}-${match[2]}${match[3]}`, listed: `${match[2]}-${match[3]}` } : null;
}

const boxIcon = <Icon name="shippingbox" color={colors.blue} size={22} />;

export default function CantFindScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ lineKey: string; from?: string }>();
  const lineKey = String(params.lineKey ?? '');
  const fromBox = params.from ? String(params.from) : null;
  const { states } = usePickData();
  const state = states.get(lineKey);
  const [promptOpen, setPromptOpen] = useState(false);
  const { banner, dismiss, handleScan } = useScanHandler({
    boxId: null,
    preferLineKey: lineKey,
    openBoxMode: 'push',
  });

  if (!state) {
    return (
      <View style={shared.screen}>
        <EmptyState icon="questionmark.folder" title="Not on the pick list" message="This item is no longer waiting to ship." />
      </View>
    );
  }

  const { line } = state;
  const sku = labelSku(line.sku);
  const batch = parseBatch(sku);
  const candidateBoxes = [line.box_id, ...(line.other_boxes ?? [])].filter(
    (b): b is string => Boolean(b) && b !== fromBox
  );
  const openBox = (boxId: string) => router.push({ pathname: '/pick/box/[boxId]', params: { boxId } });

  const markMissing = () => {
    setPromptOpen(true);
    Alert.prompt(
      'Mark as missing',
      'Optional note, e.g. which boxes you checked.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPromptOpen(false) },
        {
          text: 'Mark Missing',
          style: 'destructive',
          onPress: (note?: string) => {
            setPromptOpen(false);
            recordEvent({
              action: 'missing',
              line,
              boxId: fromBox,
              method: 'manual',
              note: note?.trim() || null,
            });
            router.back();
          },
        },
      ],
      'plain-text'
    );
  };

  const clearMissing = () => recordEvent({ action: 'undo', line, boxId: fromBox, method: 'manual' });

  return (
    <View style={shared.screen} collapsable={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        <ScanCapture onScan={handleScan} enabled={!promptOpen} />

        <Card style={styles.firstCard}>
          <View style={styles.photo}>
            <PickImage line={line} size={width - 64} boxId={fromBox} zoomHint />
          </View>
          <View style={styles.info}>
            <View style={styles.skuRow}>
              <Text style={styles.sku}>{sku}</Text>
              {Math.max(1, line.qty) > 1 ? <Pill tone="orange">×{line.qty}</Pill> : null}
            </View>
            <Text style={styles.title}>{line.title}</Text>
            <Text style={styles.meta}>
              Order #{shortOrderId(line.order_id)}
              {batch ? ` · listed ${batch.listed}` : ''}
            </Text>
            {state.status === 'missing' ? (
              <View style={[styles.status, { backgroundColor: tints.orange }]}>
                <Icon name="exclamationmark.triangle.fill" color={colors.orange} size={16} />
                <Text style={[styles.statusText, { color: colors.orange }]}>
                  Marked missing{state.missingNote ? `: “${state.missingNote}”` : ''}
                </Text>
              </View>
            ) : null}
            {state.status === 'picked' ? (
              <View style={[styles.status, { backgroundColor: tints.green }]}>
                <Icon name="checkmark.circle.fill" color={colors.green} size={16} />
                <Text style={[styles.statusText, { color: colors.green }]}>Picked</Text>
              </View>
            ) : null}
          </View>
        </Card>

        <SectionHeader>Also listed in</SectionHeader>
        <Card inset={50}>
          {candidateBoxes.length > 0 ? (
            candidateBoxes.map((boxId) => (
              <Row key={boxId} leading={boxIcon} title={boxId} chevron onPress={() => openBox(boxId)} />
            ))
          ) : (
            <Row
              leading={<Icon name="minus.circle" color={colors.tertiaryLabel} size={22} />}
              title={<Text style={styles.none}>{line.box_id ? 'No other box on record' : 'No box on record'}</Text>}
            />
          )}
        </Card>

        <SectionHeader>Same batch{batch ? ` (${batch.batch})` : ''}</SectionHeader>
        <Card inset={50}>
          {(line.nearby_boxes ?? []).length > 0 ? (
            line.nearby_boxes.map((nearby) => (
              <Row
                key={nearby.box_id}
                leading={boxIcon}
                title={nearby.box_id}
                subtitle={nearby.range}
                chevron
                onPress={() => openBox(nearby.box_id)}
              />
            ))
          ) : (
            <Row
              leading={<Icon name="minus.circle" color={colors.tertiaryLabel} size={22} />}
              title={<Text style={styles.none}>No other boxes hold this batch</Text>}
            />
          )}
        </Card>
        <SectionFooter>
          Items listed at the same time often end up together. Scan any box, then the item, to pick it from there.
        </SectionFooter>

        <View style={styles.actions}>
          {state.status === 'missing' ? (
            <Button label="Clear missing mark" icon="arrow.uturn.backward" tone="neutral" onPress={clearMissing} />
          ) : state.status === 'open' ? (
            <Button label="Mark as missing…" icon="exclamationmark.triangle" tone="red" onPress={markMissing} />
          ) : null}
        </View>
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
  photo: {
    alignItems: 'center',
    paddingTop: 16,
  },
  info: {
    padding: 16,
    gap: 6,
  },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sku: {
    ...type.title2,
    color: colors.label,
    flexShrink: 1,
  },
  title: {
    ...type.callout,
    color: colors.label,
  },
  meta: {
    ...type.footnote,
    color: colors.secondaryLabel,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  statusText: {
    ...type.subheadline,
    fontWeight: '600',
    flexShrink: 1,
  },
  none: {
    ...type.body,
    color: colors.secondaryLabel,
  },
  actions: {
    marginHorizontal: 16,
    marginTop: 24,
  },
});
