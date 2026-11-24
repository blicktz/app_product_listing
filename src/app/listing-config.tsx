import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { ListingPill } from '@/components/ListingPill';
import { Card, Icon, SectionFooter, SectionHeader } from '@/components/ui';
import { colors, shared } from '@/lib/theme';
import {
  CONDITION_COLORS,
  CONDITION_LABELS,
  EBAY_STORES,
  FB_MAX_PHOTOS,
  FB_MKT_COLOR,
  ITEM_CONDITIONS,
  NONE_COLOR,
  STORE_COLORS,
  channelSummary,
  completeListingConfig,
  listsNowhere,
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

  const config = completeListingConfig(draft);
  const fbOnly = draft.ebayStore === null;

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

      <SectionHeader>eBay store</SectionHeader>
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
        <OptionRow
          key="none"
          label="None (FB only)"
          color={NONE_COLOR}
          selected={fbOnly}
          onPress={() => update({ ebayStore: null })}
        />
      </Card>
      <SectionFooter>One eBay store at most.</SectionFooter>

      <SectionHeader>Facebook Marketplace</SectionHeader>
      <Card>
        <View style={styles.row}>
          <View style={styles.switchLabel}>
            <ListingPill label="FB" color={FB_MKT_COLOR} />
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>
                {fbOnly ? 'List on FB Marketplace' : 'Also list on FB Marketplace'}
              </Text>
              <Text style={styles.switchSubtitle}>Local pickup · first {FB_MAX_PHOTOS} photos</Text>
            </View>
          </View>
          <Switch value={!!draft.fbMkt} onValueChange={(fbMkt) => update({ fbMkt })} />
        </View>
      </Card>

      {listsNowhere(draft) ? (
        <View style={styles.warning}>
          <Icon name="exclamationmark.triangle.fill" color={colors.orange} size={16} />
          <Text style={styles.warningText}>Pick an eBay store or turn on FB Marketplace.</Text>
        </View>
      ) : config ? (
        <Text style={styles.summary}>{channelSummary(config)}</Text>
      ) : null}
      <SectionFooter>
        Applies to every SKU you upload until you change it. Uploaded with each SKU as
        listing.env for the listing generators.
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
  switchLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switchText: {
    flex: 1,
  },
  switchTitle: {
    color: colors.label,
    fontSize: 17,
  },
  switchSubtitle: {
    color: colors.secondaryLabel,
    fontSize: 13,
    marginTop: 2,
  },
  summary: {
    color: colors.label,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 20,
    marginHorizontal: 32,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    marginHorizontal: 32,
  },
  warningText: {
    flex: 1,
    color: colors.orange,
    fontSize: 15,
    fontWeight: '600',
  },
});
