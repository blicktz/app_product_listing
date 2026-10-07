import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ListingPill } from '@/components/ListingPill';
import {
  CONDITION_COLORS,
  CONDITION_LABELS,
  EBAY_STORES,
  ITEM_CONDITIONS,
  STORE_COLORS,
  loadListingConfigDraft,
  saveListingConfigDraft,
  type ListingConfigDraft,
} from '@/lib/listingConfig';

type OptionRowProps = {
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
};

function OptionRow({ label, color, selected, onPress }: OptionRowProps) {
  return (
    <Pressable style={[styles.row, selected && styles.rowSelected]} onPress={onPress}>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <ListingPill label={label} color={color} />
    </Pressable>
  );
}

export default function ListingConfigScreen() {
  const [draft, setDraft] = useState<ListingConfigDraft>(() => loadListingConfigDraft());

  // Saved on every tap; Home re-reads it when it regains focus.
  const update = (change: ListingConfigDraft) => {
    const next = { ...draft, ...change };
    setDraft(next);
    saveListingConfigDraft(next);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.helpText}>
        Applies to every SKU you upload until you change it. Uploaded with each SKU as
        listing.env for the listing generator.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Item condition</Text>
        {ITEM_CONDITIONS.map((condition) => (
          <OptionRow
            key={condition}
            label={CONDITION_LABELS[condition]}
            color={CONDITION_COLORS[condition]}
            selected={draft.itemCondition === condition}
            onPress={() => update({ itemCondition: condition })}
          />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>eBay store</Text>
        {EBAY_STORES.map((store) => (
          <OptionRow
            key={store}
            label={store}
            color={STORE_COLORS[store]}
            selected={draft.ebayStore === store}
            onPress={() => update({ ebayStore: store })}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 28,
  },
  helpText: {
    fontSize: 15,
    color: '#6b6b70',
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    color: '#8e8e93',
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 56,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
  },
  rowSelected: {
    borderColor: '#208AEF',
    backgroundColor: '#e6f4fe',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#c7c7cc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: '#208AEF',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#208AEF',
  },
});
