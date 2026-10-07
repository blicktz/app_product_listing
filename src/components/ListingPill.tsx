import { StyleSheet, Text, View } from 'react-native';

type Props = {
  label: string;
  color: string;
  size?: 'large' | 'small';
};

export function ListingPill({ label, color, size = 'large' }: Props) {
  return (
    <View style={[styles.pill, size === 'small' && styles.pillSmall, { backgroundColor: color }]}>
      <Text style={[styles.text, size === 'small' && styles.textSmall]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  pillSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  textSmall: {
    fontSize: 12,
  },
});
