import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { QuantityPad } from '@/components/stow/QuantityPad';
import { Button, Card, EmptyState, Icon, Pill, Row, SectionHeader } from '@/components/ui';
import type { StowRow } from '@/lib/stow/derive';
import { useStowData } from '@/lib/stow/useStow';
import { useStowScan } from '@/lib/stow/useStowScan';
import { colors, shared, tabular, tints, type } from '@/lib/theme';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
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

function rowSubtitle(row: StowRow): string {
  return [
    formatTime(row.at),
    row.method === 'manual' ? 'typed by hand' : null,
    row.movedFrom ? `from ${row.movedFrom}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function StowBoxScreen() {
  const router = useRouter();
  const { current, openBoxExisting } = useStowData();
  const { banner, dismiss, handleScan, enterSku, setQuantity, undoRow, finish } = useStowScan();
  const [flash, setFlash] = useState(false);
  const [padRow, setPadRow] = useState<StowRow | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const label = current?.openBox ?? null;
  const box = current?.boxes.find((b) => b.label === label);
  const rows = box?.rows ?? [];
  const [, room, column] = label?.split('-') ?? [];

  const onScan = (code: string) => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    setPadRow(null);
    handleScan(code);
  };

  const askUndo = (row: StowRow) =>
    Alert.alert(row.kind === 'move' ? 'Undo this move?' : 'Take this row back?', row.sku, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Undo', style: 'destructive', onPress: () => undoRow(row) },
    ]);

  const askSku = () => {
    setPromptOpen(true);
    Alert.prompt(
      'Enter SKU',
      'For a label that will not scan. Double-press the scanner trigger to show the keyboard.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPromptOpen(false) },
        {
          text: 'Stow',
          onPress: (text?: string) => {
            setPromptOpen(false);
            enterSku(text ?? '');
          },
        },
      ],
      'plain-text',
      '',
      'ascii-capable'
    );
  };

  const askFinish = () =>
    Alert.alert('Finish stowing?', 'Every item has gone into a box.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        onPress: () => {
          const sessionId = finish();
          if (sessionId) {
            router.replace({ pathname: '/stow/summary/[sessionId]', params: { sessionId } });
          }
        },
      },
    ]);

  if (!current || !label) {
    return <View style={shared.screen} />;
  }

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen
        options={{
          title: label,
          headerRight: () => <Pill>{box?.units ?? 0}</Pill>,
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        <ScanCapture onScan={onScan} enabled={!promptOpen} />

        <Card style={styles.firstCard}>
          <View style={styles.summary}>
            <View style={styles.summaryTop}>
              <Text style={styles.summaryTitle}>
                Column {column} · {room}
              </Text>
              {openBoxExisting === null ? null : (
                <Pill tone={openBoxExisting ? 'neutral' : 'blue'}>{openBoxExisting ? 'Existing' : 'New'}</Pill>
              )}
            </View>
            <Text style={[styles.summaryMeta, tabular]}>
              Session: {plural(current.boxes.length, 'box', 'boxes')} · {plural(current.units, 'unit')}
            </Text>
          </View>
        </Card>

        <View style={[shared.card, styles.scanner, { backgroundColor: flash ? 'rgba(0,122,255,0.28)' : tints.blue }]}>
          <Icon name="barcode.viewfinder" color={colors.blue} size={28} />
          <Text style={styles.scannerText}>Scan an item, or the next box</Text>
        </View>

        <View style={styles.buttons}>
          <Button label="Enter SKU" icon="keyboard" tone="neutral" onPress={askSku} style={styles.button} />
          <Button label="Finish" icon="checkmark" onPress={askFinish} style={styles.button} />
        </View>

        {rows.length > 0 ? (
          <>
            <SectionHeader>In this box · {plural(rows.length, 'SKU')}</SectionHeader>
            <Card>
              {rows.map((row) => (
                <Row
                  key={row.key}
                  title={row.sku}
                  subtitle={rowSubtitle(row)}
                  trailing={
                    <View style={styles.trailing}>
                      {row.kind === 'move' ? (
                        <Pill tone="orange">{row.units === null ? 'moved' : `moved ×${row.units}`}</Pill>
                      ) : (
                        <Pressable
                          hitSlop={4}
                          onPress={() => setPadRow(row)}
                          style={({ pressed }) => [styles.quantity, { opacity: pressed ? 0.5 : 1 }]}
                        >
                          <Text style={[styles.quantityText, tabular]}>×{row.units ?? 0}</Text>
                        </Pressable>
                      )}
                      <UndoButton onPress={() => askUndo(row)} />
                    </View>
                  }
                />
              ))}
            </Card>
          </>
        ) : (
          <EmptyState icon="shippingbox" title="Box is open" message="Scan each item as it goes in." />
        )}
      </ScrollView>

      {padRow ? (
        <QuantityPad
          sku={padRow.sku}
          current={padRow.units ?? 1}
          onCancel={() => setPadRow(null)}
          onSet={(quantity) => {
            setQuantity(padRow, quantity);
            setPadRow(null);
          }}
        />
      ) : null}
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
    gap: 6,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryTitle: {
    ...type.headline,
    color: colors.label,
  },
  summaryMeta: {
    ...type.subheadline,
    color: colors.secondaryLabel,
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
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginHorizontal: 16,
  },
  button: {
    flex: 1,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  quantity: {
    minWidth: 52,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: tints.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityText: {
    ...type.headline,
    color: colors.blue,
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
