import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { ListingPill } from '@/components/ListingPill';
import { Card, Icon, SectionFooter, SectionHeader } from '@/components/ui';
import { colors, shared } from '@/lib/theme';
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

// iOS single-choice list row: the option on the left, a checkmark on the
// selected one (like Settings).
function OptionRow({ label, color, selected, onPress }: OptionRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.pressed } : null]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <ListingPill label={label} color={color} />
      {selected ? <Icon name="checkmark" color={colors.blue} size={18} weight="semibold" /> : null}
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
    <ScrollView
      style={shared.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
    >
      <SectionHeader>Item condition</SectionHeader>
      <Card>
        {ITEM_CONDITIONS.map((condition) => (
          <OptionRow
            key={condition}
            label={CONDITION_LABELS[condition]}
            color={CONDITION_COLORS[condition]}
            selected={draft.itemCondition === condition}
            onPress={() => update({ itemCondition: condition })}
          />
        ))}
      </Card>

      <SectionHeader>Store</SectionHeader>
      <Card>
        {EBAY_STORES.map((store) => (
          <OptionRow
            key={store}
            label={store}
            color={STORE_COLORS[store]}
            selected={draft.ebayStore === store}
            onPress={() => update({ ebayStore: store })}
          />
        ))}
      </Card>
      <SectionFooter>
        Applies to every SKU you upload until you change it. Uploaded with each SKU as
        listing.env for the listing generator.
      </SectionFooter>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
});
