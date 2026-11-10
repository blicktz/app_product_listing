import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Icon } from '@/components/ui';
import { RADIUS, colors, tabular, type } from '@/lib/theme';

// Drawn inside the screen, not as a native modal, so the hidden scanner field
// keeps focus and a scan can still interrupt it. Its own keys are needed
// because iOS hides the on-screen keyboard while the scanner is connected.

const MAX_DIGITS = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

type Props = {
  sku: string;
  current: number;
  onCancel: () => void;
  onSet: (quantity: number) => void;
};

export function QuantityPad({ sku, current, onCancel, onSet }: Props) {
  const [value, setValue] = useState('');

  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'clear') {
      setValue('');
    } else if (key === 'back') {
      setValue((v) => v.slice(0, -1));
    } else {
      setValue((v) => (v.length >= MAX_DIGITS || (v === '' && key === '0') ? v : v + key));
    }
  };

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
      <View style={styles.card}>
        <Text style={styles.title}>Quantity</Text>
        <Text style={styles.sku} numberOfLines={1}>
          {sku}
        </Text>
        <Text style={[styles.value, tabular, value === '' ? styles.placeholder : null]}>
          {value === '' ? current : value}
        </Text>
        <View style={styles.keys}>
          {KEYS.map((key) => (
            <Pressable
              key={key}
              onPress={() => press(key)}
              style={({ pressed }) => [styles.key, { backgroundColor: pressed ? colors.pressed : colors.fill }]}
            >
              {key === 'back' ? (
                <Icon name="delete.left" color={colors.label} size={24} />
              ) : key === 'clear' ? (
                <Text style={styles.clear}>Clear</Text>
              ) : (
                <Text style={[styles.digit, tabular]}>{key}</Text>
              )}
            </Pressable>
          ))}
        </View>
        <View style={styles.buttons}>
          <Button label="Cancel" tone="neutral" onPress={onCancel} style={styles.button} />
          <Button
            label="Set"
            filled
            disabled={value === ''}
            onPress={() => onSet(Number(value))}
            style={styles.button}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    width: 304,
    padding: 16,
    gap: 4,
    borderRadius: RADIUS + 2,
    backgroundColor: colors.card,
  },
  title: {
    ...type.headline,
    color: colors.label,
    textAlign: 'center',
  },
  sku: {
    ...type.subheadline,
    color: colors.secondaryLabel,
    textAlign: 'center',
  },
  value: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.label,
    textAlign: 'center',
    marginVertical: 4,
  },
  placeholder: {
    color: colors.tertiaryLabel,
  },
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  key: {
    width: 85,
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    ...type.title2,
    fontWeight: '500',
    color: colors.label,
  },
  clear: {
    ...type.subheadline,
    color: colors.label,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  button: {
    flex: 1,
  },
});
