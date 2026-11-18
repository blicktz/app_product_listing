import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ModeStrip } from '@/components/pull/PullChrome';
import { PullImage } from '@/components/pull/PullImage';
import { askUndo, promptMissing } from '@/components/pull/lineActions';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Icon, Pill, Row, SectionFooter, SectionHeader } from '@/components/ui';
import { actionsLabel, countLabel, shortDate } from '@/lib/pull/derive';
import { usePullData } from '@/lib/pull/usePull';
import { usePullScanHandler } from '@/lib/pull/useScanHandler';
import { colors, shared, tints, type } from '@/lib/theme';

/** AAC-0621-001 → { batch: "AAC-0621", listed: "06-21" } */
function parseBatch(sku: string): { batch: string; listed: string } | null {
  const match = /^([A-Z]+)-?(\d{2})(\d{2})-?\d+$/.exec(sku);
  return match ? { batch: `${match[1]}-${match[2]}${match[3]}`, listed: `${match[2]}-${match[3]}` } : null;
}

const boxIcon = <Icon name="shippingbox" color={colors.purple} size={22} />;

export default function PullCantFindScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ lineKey: string; from?: string }>();
  const lineKey = String(params.lineKey ?? '');
  const fromBox = params.from ? String(params.from) : null;
  const { states, block, busy } = usePullData();
  const state = states.get(lineKey);
  const [promptOpen, setPromptOpen] = useState(false);
  const { banner, dismiss, handleScan, markMissing, undo } = usePullScanHandler({
    boxId: null,
    preferLineKey: lineKey,
    openBoxMode: 'push',
  });

  if (!state) {
    return (
      <View style={shared.screen}>
        <EmptyState icon="questionmark.folder" title="Not on the pull list" message="This item is no longer waiting to be pulled." />
      </View>
    );
  }

  const sku = state.sku.toUpperCase();
  const batch = parseBatch(sku);
  const candidateBoxes = [state.box_id, ...(state.other_boxes ?? [])].filter(
    (b): b is string => Boolean(b) && b !== fromBox
  );
  const openBox = (boxId: string) => router.push({ pathname: '/pull/box/[boxId]', params: { boxId } });

  const onMissing = () =>
    promptMissing(
      state,
      (note) => {
        void markMissing(state, note).then((ok) => {
          if (ok) {
            router.back();
          }
        });
      },
      setPromptOpen
    );

  return (
    <View style={shared.screen} collapsable={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        <ScanCapture onScan={handleScan} enabled={!promptOpen} />
        <ModeStrip />

        <Card style={styles.firstCard}>
          <View style={styles.photo}>
            <PullImage line={state} size={width - 64} boxId={fromBox} zoomHint />
          </View>
          <View style={styles.info}>
            <View style={styles.skuRow}>
              <Text style={styles.sku}>{sku}</Text>
              <Pill tone="purple">{countLabel(state)}</Pill>
            </View>
            <Text style={styles.title}>{state.title}</Text>
            <Text style={styles.meta}>
              {[
                actionsLabel(state),
                state.decided_at ? `End decided ${shortDate(state.decided_at)}` : null,
                batch ? `listed ${batch.listed}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {state.status === 'missing' ? (
              <View style={[styles.status, { backgroundColor: tints.orange }]}>
                <Icon name="exclamationmark.triangle.fill" color={colors.orange} size={16} />
                <Text style={[styles.statusText, { color: colors.orange }]}>Marked missing</Text>
              </View>
            ) : state.complete ? (
              <View style={[styles.status, { backgroundColor: tints.green }]}>
                <Icon name="checkmark.circle.fill" color={colors.green} size={16} />
                <Text style={[styles.statusText, { color: colors.green }]}>Pulled</Text>
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
              title={<Text style={styles.none}>{state.box_id ? 'No other box on record' : 'No box on record'}</Text>}
            />
          )}
        </Card>

        <SectionHeader>Same batch{batch ? ` (${batch.batch})` : ''}</SectionHeader>
        <Card inset={50}>
          {(state.nearby_boxes ?? []).length > 0 ? (
            state.nearby_boxes.map((nearby) => (
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
          Items listed at the same time often end up together. Scan any box, then the item, to pull it from there.
        </SectionFooter>

        <View style={styles.actions}>
          {state.complete ? (
            <Button
              label={state.status === 'missing' ? 'Undo Mark missing…' : 'Undo…'}
              icon="arrow.uturn.backward"
              tone="neutral"
              disabled={busy}
              onPress={() => askUndo(state, (reason) => void undo(state, reason), setPromptOpen)}
            />
          ) : (
            <Button
              label="Mark as missing…"
              icon="exclamationmark.triangle"
              tone="red"
              disabled={block !== null || busy}
              onPress={onMissing}
            />
          )}
        </View>
      </ScrollView>
      <ScanBanner banner={banner} onDismiss={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  firstCard: { marginTop: 12 },
  photo: { alignItems: 'center', paddingTop: 16 },
  info: { padding: 16, gap: 6 },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sku: { ...type.title2, color: colors.label, flexShrink: 1 },
  title: { ...type.callout, color: colors.label },
  meta: { ...type.footnote, color: colors.secondaryLabel },
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
  statusText: { ...type.subheadline, fontWeight: '600', flexShrink: 1 },
  none: { ...type.body, color: colors.secondaryLabel },
  actions: { marginHorizontal: 16, marginTop: 24 },
});
