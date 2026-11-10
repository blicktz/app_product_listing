import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { PackPhoto } from '@/components/pack/PackPhoto';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { Button, Card, EmptyState, Icon, Pill, ProgressBar, SectionHeader } from '@/components/ui';
import { shortStore, spacedTracking, type ItemState, type PackageState } from '@/lib/pack/derive';
import { skuText, undoLabel } from '@/lib/pack/scan';
import { setOpenKey } from '@/lib/pack/store';
import { usePackData } from '@/lib/pack/usePack';
import { usePackScan } from '@/lib/pack/usePackScan';
import { formatTime, sessionDate } from '@/lib/sessionTime';
import { colors, shared, tabular, tints, type } from '@/lib/theme';

const MARGIN = 16;
const GAP = 12;
const ROW_PHOTO = 96;

/** Photos as big as fit: one item full width, 2–4 in two columns, more as rows. */
type Layout = { mode: 'single' | 'grid' | 'rows'; photo: number; tile: number };

function itemLayout(count: number, screenWidth: number): Layout {
  const content = screenWidth - MARGIN * 2;
  if (count <= 1) {
    return { mode: 'single', photo: content - 24, tile: content };
  }
  if (count <= 4) {
    const tile = (content - GAP) / 2;
    return { mode: 'grid', photo: tile - 16, tile };
  }
  return { mode: 'rows', photo: ROW_PHOTO, tile: content };
}

function tags(i: ItemState): string {
  return [i.item.parent_sku ? `of bundle ${i.item.parent_sku}` : null, i.orderName ? `order ${i.orderName}` : null]
    .filter(Boolean)
    .join(' · ');
}

function where(i: ItemState): string {
  const box = i.item.box_label ?? (i.item.box_id && i.item.room !== 'NOT_FOUND' ? i.item.box_id : null);
  return [box ? `Box ${box}` : 'No box on record', i.manual ? '✋ by hand' : null].filter(Boolean).join(' · ');
}

function ItemCard({
  state,
  layout,
  canConfirm,
  onFound,
}: {
  state: ItemState;
  layout: Layout;
  canConfirm: boolean;
  onFound: () => void;
}) {
  const { item, complete } = state;
  const tagLine = tags(state);
  const frame: ViewStyle = complete
    ? { borderColor: colors.green, backgroundColor: tints.green }
    : { borderColor: 'transparent' };
  const big = layout.mode === 'single';

  const text = (
    <View style={[styles.itemText, layout.mode === 'rows' ? styles.itemTextRow : null]}>
      <Text
        style={[big ? styles.skuBig : styles.sku, tabular, item.sku ? null : { color: colors.secondaryLabel }]}
        numberOfLines={1}
      >
        {skuText(item.sku)}
      </Text>
      {tagLine ? (
        <Text style={styles.tag} numberOfLines={2}>
          {tagLine}
        </Text>
      ) : null}
      {item.title ? (
        <Text style={styles.title} numberOfLines={big ? 4 : 2}>
          {item.title}
        </Text>
      ) : null}
      <Text style={styles.where} numberOfLines={1}>
        {where(state)}
      </Text>
      <View style={styles.countRow}>
        <Icon
          name={complete ? 'checkmark.circle.fill' : 'circle'}
          color={complete ? colors.green : colors.tertiaryLabel}
          size={big ? 26 : 20}
        />
        <Text style={[big ? styles.countBig : styles.count, tabular, complete ? { color: colors.green } : null]}>
          {Math.min(state.count, item.qty)}/{item.qty}
        </Text>
        {!complete && canConfirm && layout.mode !== 'grid' ? (
          <Button label="Found it" icon="hand.raised" tone="neutral" onPress={onFound} style={styles.found} />
        ) : null}
      </View>
      {/* A half-width tile has no room beside the count. */}
      {!complete && canConfirm && layout.mode === 'grid' ? (
        <Button label="Found it" icon="hand.raised" tone="neutral" onPress={onFound} style={styles.foundTile} />
      ) : null}
    </View>
  );

  return (
    <View
      style={[
        shared.card,
        styles.itemCard,
        frame,
        layout.mode === 'grid' ? { width: layout.tile, marginHorizontal: 0, marginBottom: 0 } : null,
        layout.mode === 'rows' ? styles.itemCardRow : null,
      ]}
    >
      <PackPhoto item={item} size={layout.photo} />
      {text}
    </View>
  );
}

function StatusPanel({ pkg }: { pkg: PackageState }) {
  if (pkg.packedAt) {
    return (
      <View style={[shared.card, styles.panel, { backgroundColor: tints.green }]}>
        <Icon name="checkmark.circle.fill" color={colors.green} size={44} />
        <Text style={styles.panelTitle}>
          Packed {formatTime(pkg.packedAt)}
          {pkg.packedSource === 'desktop' ? ' on the desktop' : ''}
        </Text>
        <Text style={styles.panelSub}>
          {pkg.manualPacked ? 'Marked by hand, not scan-verified.' : 'Label and every item scanned. Stick the label.'}
        </Text>
      </View>
    );
  }
  if (pkg.cancelled) {
    return (
      <View style={[shared.card, styles.panel, { backgroundColor: tints.red }]}>
        <Icon name="xmark.octagon.fill" color={colors.red} size={44} />
        <Text style={[styles.panelTitle, { color: colors.red }]}>CANCELLED — do not ship</Text>
        <Text style={styles.panelSub}>
          {pkg.cancelledNames.join(', ')} cancelled or refunded. Put the items back, then Mark packed to clear it.
        </Text>
      </View>
    );
  }
  if (pkg.pkg.label_count > 1) {
    return (
      <View style={[shared.card, styles.panel, { backgroundColor: tints.orange }]}>
        <Icon name="exclamationmark.triangle.fill" color={colors.orange} size={44} />
        <Text style={styles.panelTitle}>{pkg.pkg.label_count} labels on this order</Text>
        <Text style={styles.panelSub}>Pack it by hand, then Mark packed.</Text>
      </View>
    );
  }
  if (pkg.noItems) {
    return (
      <View style={[shared.card, styles.panel, { backgroundColor: tints.orange }]}>
        <Icon name="exclamationmark.triangle.fill" color={colors.orange} size={44} />
        <Text style={styles.panelTitle}>No items on this order</Text>
        <Text style={styles.panelSub}>Check it on eBay or Shopify, then Mark packed.</Text>
      </View>
    );
  }
  return null;
}

export default function PackageScreen() {
  const router = useRouter();
  const snap = usePackData();
  const { width } = useWindowDimensions();
  const [flash, setFlash] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const { banner, dismiss, handleScan, foundIt, markPacked, undo, checkBeforeMarkPacked } = usePackScan({
    openPackage: setOpenKey,
  });

  const pkg = snap.openKey ? snap.board.byKey.get(snap.openKey) : undefined;

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    handleScan(code);
  };

  const confirm = (title: string, message: string, action: string, run: () => void, destructive = false) => {
    setAlertOpen(true);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => setAlertOpen(false) },
      {
        text: action,
        style: destructive ? 'destructive' : 'default',
        onPress: () => {
          setAlertOpen(false);
          run();
        },
      },
    ]);
  };

  if (!pkg) {
    return (
      <View style={shared.screen} collapsable={false}>
        <ScanCapture onScan={onScan} />
        <EmptyState
          icon="archivebox"
          title="Package not found"
          message="It is no longer on the list. Go back and scan a label."
          action={<Button label="All packages" tone="neutral" onPress={() => router.dismissTo('/pack')} />}
        />
        <ScanBanner banner={banner} onDismiss={dismiss} />
      </View>
    );
  }

  const layout = itemLayout(pkg.items.length, width);
  const canConfirm = pkg.packable && !pkg.packedAt && !pkg.noItems;
  const store = pkg.pkg.store === 'shopify' ? 'Shopify' : shortStore(pkg.pkg.store);
  const place = [pkg.pkg.ship_city, pkg.pkg.ship_state].filter(Boolean).join(', ');
  const undoWhat = undoLabel(pkg);

  const askFound = (i: ItemState) =>
    confirm('Confirm by hand?', `${skuText(i.item.sku)} has no readable barcode and is in the box.`, 'Found it', () =>
      foundIt(pkg.key, i.item.sku)
    );
  // The desktop may have packed it meanwhile: look first (at most ~3 s).
  const askMark = async () => {
    const key = pkg.key;
    setChecking(true);
    const go = await checkBeforeMarkPacked(key);
    setChecking(false);
    if (!go) {
      return;
    }
    confirm(
      `Mark ${pkg.pkg.name} as packed without scanning?`,
      'It is recorded as marked by hand (not scan-verified). Undo reverses it.',
      'Mark packed',
      () => markPacked(key)
    );
  };
  const askUndo = () =>
    confirm(`Undo ${undoWhat}?`, pkg.pkg.name, 'Undo', () => undo(pkg.key), true);

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen
        options={{
          title: pkg.pkg.name,
          headerRight: () => (
            <Pill tone={pkg.packedAt ? 'green' : 'neutral'}>
              {pkg.doneItems}/{pkg.totalItems}
            </Pill>
          ),
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        <ScanCapture onScan={onScan} enabled={!alertOpen} />

        {/* Package */}
        <Card style={styles.firstCard}>
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>
              {pkg.orders.length > 1 ? `${pkg.orders.length} orders, one box` : pkg.pkg.name} · {store}
            </Text>
            {pkg.orders.length > 1 ? (
              <Text style={styles.summaryMeta}>Orders {pkg.orders.map((o) => o.order.name).join(', ')}</Text>
            ) : null}
            <Text style={styles.summaryMeta}>
              {[pkg.pkg.buyer, place].filter(Boolean).join(' — ')}
            </Text>
            <Text style={[styles.summaryMeta, tabular]} selectable>
              {[pkg.pkg.carrier, spacedTracking(pkg.pkg.tracking)].filter(Boolean).join(' ')}
            </Text>
            <View style={styles.labelRow}>
              <Icon
                name={pkg.labelScanned ? 'checkmark.circle.fill' : 'tag'}
                color={pkg.labelScanned ? colors.green : colors.orange}
                size={17}
              />
              <Text style={[styles.labelState, { color: pkg.labelScanned ? colors.green : colors.orange }]}>
                {pkg.labelScanned ? 'Label scanned' : 'Label not scanned yet'}
              </Text>
              {pkg.pkg.label_time ? (
                <Text style={styles.labelTime}>bought {sessionDate(pkg.pkg.label_time)}</Text>
              ) : null}
            </View>
            {!pkg.packedAt && pkg.packable ? (
              <ProgressBar value={pkg.totalItems > 0 ? pkg.doneItems / pkg.totalItems : 0} />
            ) : null}
          </View>
        </Card>

        <StatusPanel pkg={pkg} />
        {canConfirm ? (
          <View style={[shared.card, styles.scanner, { backgroundColor: flash ? 'rgba(0,122,255,0.28)' : tints.blue }]}>
            <Icon name="barcode.viewfinder" color={colors.blue} size={28} />
            <Text style={styles.scannerText}>
              {pkg.labelScanned ? 'Scan each item' : 'Scan the label and each item'}
            </Text>
          </View>
        ) : null}

        <SectionHeader>
          Items · {pkg.doneItems}/{pkg.totalItems}
        </SectionHeader>
        <View style={layout.mode === 'grid' ? styles.grid : null}>
          {pkg.items.map((i) => (
            <ItemCard
              key={`${i.item.order_key}:${i.item.seq}`}
              state={i}
              layout={layout}
              canConfirm={canConfirm}
              onFound={() => askFound(i)}
            />
          ))}
        </View>

        <View style={styles.buttons}>
          {!pkg.packedAt ? (
            <Button
              label="Mark packed"
              icon="checkmark"
              tone="neutral"
              onPress={() => void askMark()}
              loading={checking}
              disabled={checking}
              style={styles.button}
            />
          ) : null}
          <Button
            label="Undo last scan"
            icon="arrow.uturn.backward"
            onPress={askUndo}
            disabled={!undoWhat}
            style={styles.button}
          />
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
  summary: {
    padding: 16,
    gap: 4,
  },
  summaryTitle: {
    ...type.headline,
    color: colors.label,
  },
  summaryMeta: {
    ...type.subheadline,
    color: colors.secondaryLabel,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 6,
  },
  labelState: {
    ...type.subheadline,
    fontWeight: '600',
  },
  labelTime: {
    ...type.footnote,
    color: colors.secondaryLabel,
    marginLeft: 'auto',
  },
  panel: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    gap: 6,
  },
  panelTitle: {
    ...type.title2,
    color: colors.label,
    textAlign: 'center',
  },
  panelSub: {
    ...type.subheadline,
    color: colors.secondaryLabel,
    textAlign: 'center',
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    marginHorizontal: MARGIN,
    marginBottom: GAP,
  },
  itemCard: {
    marginBottom: GAP,
    padding: 8,
    gap: 8,
    borderWidth: 3,
  },
  itemCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  itemText: {
    gap: 3,
    paddingHorizontal: 4,
  },
  itemTextRow: {
    flex: 1,
  },
  sku: {
    ...type.headline,
    color: colors.label,
  },
  skuBig: {
    ...type.title2,
    color: colors.label,
  },
  tag: {
    ...type.footnote,
    color: colors.blue,
  },
  title: {
    ...type.subheadline,
    color: colors.label,
  },
  where: {
    ...type.footnote,
    color: colors.secondaryLabel,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  count: {
    ...type.headline,
    color: colors.secondaryLabel,
  },
  countBig: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.secondaryLabel,
  },
  found: {
    marginLeft: 'auto',
    minHeight: 34,
    paddingHorizontal: 10,
  },
  foundTile: {
    minHeight: 34,
    marginTop: 6,
    paddingHorizontal: 8,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginHorizontal: MARGIN,
  },
  button: {
    flex: 1,
  },
});
