import { Pressable, StyleSheet, Text, View } from 'react-native';
import { setPickMode, type PickMode } from '@/lib/pick/store';
import { colors, tabular, type } from '@/lib/theme';

type Props = {
  mode: PickMode;
  /** "12" orders to pick. */
  ordersCount?: string;
  /** "4/20" picked of the open show. */
  whatnotCount?: string;
};

/**
 * Orders | Whatnot at the top of Pick home (design.md §2). Always visible, one
 * tap; the Whatnot segment is yellow so the mode reads at a glance.
 */
export function ModeSwitch({ mode, ordersCount, whatnotCount }: Props) {
  const segment = (value: PickMode, label: string, count?: string) => {
    const on = mode === value;
    const whatnot = value === 'whatnot';
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        onPress={() => setPickMode(value)}
        style={[styles.segment, on && (whatnot ? styles.onWhatnot : styles.onOrders)]}
      >
        <Text style={[styles.label, on && (whatnot ? styles.labelOnWhatnot : styles.labelOn)]} numberOfLines={1}>
          {label}
          {count ? <Text style={[styles.count, tabular]}>{`  ${count}`}</Text> : null}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {segment('orders', 'Orders', ordersCount)}
      {segment('whatnot', 'Whatnot', whatnotCount)}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 4,
    padding: 2,
    borderRadius: 9,
    backgroundColor: colors.fill,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 7,
  },
  onOrders: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  onWhatnot: {
    backgroundColor: colors.yellow,
  },
  label: {
    ...type.subheadline,
    fontWeight: '600',
    color: colors.secondaryLabel,
  },
  labelOn: {
    color: colors.label,
  },
  labelOnWhatnot: {
    color: colors.onYellow,
  },
  count: {
    fontWeight: '400',
  },
});
