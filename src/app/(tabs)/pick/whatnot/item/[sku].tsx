import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, EmptyState, Icon } from '@/components/ui';
import { WhatnotStrip } from '@/components/whatnot-pick/WhatnotStrip';
import { colors, shared, tabular, type } from '@/lib/theme';
import { recordWhatnotEvent, whatnotImageUri } from '@/lib/whatnot-pick/store';
import { bundleNote, lotLabel, useWhatnotData, useWhatnotScan } from '@/lib/whatnot-pick/useWhatnot';
import { labelSku } from '@/lib/pick/derive';

// One show item, large: lineup number, photo, where it is, Mark picked /
// Undo / Can't find. Opened from the Lineup view, Unlocated and photos.
export default function WhatnotItemScreen() {
  const router = useRouter();
  const { sku: raw } = useLocalSearchParams<{ sku: string }>();
  const sku = String(raw ?? '').toUpperCase();
  const { plan, prepBox, states, bundles } = useWhatnotData();
  const line = plan?.lines.find((l) => l.sku.toUpperCase() === sku);
  const state = line ? states.get(line.line_key) : undefined;
  const { banner, dismiss, handleScan, confirmManual } = useWhatnotScan({
    boxId: null,
    preferLineKey: line?.line_key ?? null,
    openBoxMode: 'push',
    onPicked: () => setTimeout(() => router.back(), 900),
  });

  if (!plan || !line || !state) {
    return (
      <View style={shared.screen}>
        <EmptyState icon="questionmark.square.dashed" title={`${labelSku(sku)} isn't in this show`} />
      </View>
    );
  }
  const width = plan.number_width;
  const sold = line.status === 'sold';
  const picked = state.status === 'picked';
  const missing = state.status === 'missing';
  const uri = whatnotImageUri(line.image_url_full ?? line.image_url);
  const where = picked ? `In ${prepBox}` : line.box_id ? `In box ${line.box_id}${line.room ? ` (${line.room})` : ''}` : 'No box on record';

  const undo = () => recordWhatnotEvent({ action: 'undo', line: state.line, boxId: null, method: 'manual' });
  const askMissing = () =>
    Alert.prompt?.(
      "Can't find it?",
      'Add a note (optional).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: "Can't find",
          style: 'destructive',
          onPress: (note?: string) =>
            recordWhatnotEvent({ action: 'missing', line: state.line, boxId: null, method: 'manual', note: note || null }),
        },
      ],
      'plain-text'
    );

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        <WhatnotStrip subtitle={plan.title} />
        <ScanCapture onScan={handleScan} />
        <Text style={[styles.lot, tabular, sold && { color: colors.tertiaryLabel }]}>{lotLabel(line.lot, width)}</Text>
        <View style={styles.photo}>
          {uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" /> : <Icon name="photo" color={colors.tertiaryLabel} size={48} />}
        </View>
        <View style={styles.text}>
          <Text style={styles.sku}>{labelSku(line.sku)}</Text>
          {line.bundle_sku ? (
            <Text style={styles.bundle}>
              {bundleNote(line)} · {bundles.get(line.bundle_sku)?.picked ?? 0} of {line.bundle_size} picked
            </Text>
          ) : null}
          <Text style={[styles.title, sold && styles.soldTitle]}>{line.title}</Text>
          <View style={styles.whereRow}>
            <Icon
              name={sold ? 'tag.slash' : picked ? 'checkmark.circle.fill' : missing ? 'exclamationmark.triangle.fill' : 'shippingbox'}
              color={sold ? colors.tertiaryLabel : picked ? colors.green : missing ? colors.orange : colors.secondaryLabel}
              size={17}
            />
            <Text style={styles.where}>{sold ? 'Sold · leave it out of the lineup' : missing ? "Marked can't find" : where}</Text>
          </View>
        </View>
        {sold ? null : (
          <View style={styles.buttons}>
            {picked || missing ? (
              <Button label={picked ? 'Undo pick' : 'Clear can’t find'} icon="arrow.uturn.backward" tone="neutral" large onPress={undo} />
            ) : (
              <>
                <Button label="Mark picked" icon="checkmark" filled large onPress={() => confirmManual(state)} />
                <Button label="Can't find" tone="neutral" large onPress={askMissing} />
              </>
            )}
          </View>
        )}
      </ScrollView>
      <ScanBanner banner={banner} onDismiss={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  lot: { fontSize: 64, fontWeight: '800', color: colors.label, textAlign: 'center', marginTop: 8 },
  photo: {
    marginHorizontal: 16,
    height: 300,
    borderRadius: 12,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  text: { marginHorizontal: 20, marginTop: 14, gap: 4 },
  sku: { ...type.headline, color: colors.label },
  bundle: { ...type.subheadline, fontWeight: '600', color: colors.orange },
  title: { ...type.body, color: colors.label },
  soldTitle: { color: colors.tertiaryLabel, textDecorationLine: 'line-through' },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  where: { ...type.subheadline, color: colors.secondaryLabel },
  buttons: { marginHorizontal: 16, marginTop: 20, gap: 10 },
});
