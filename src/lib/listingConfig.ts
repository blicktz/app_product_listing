import { File, Paths } from 'expo-file-system';

// Item condition and eBay store for the listings generated from this app's
// photos. Uploaded per SKU as `{date}/{sku}/listing.env`, which the downstream
// generic_bulk.py reads to override its own GENERIC_BULK_* defaults, so a
// forgotten .env edit can't send a whole batch to the wrong condition/store.
// Spec: docs/listing-config-requirements.md.

export const ITEM_CONDITIONS = ['new', 'pre-owned'] as const;
export const EBAY_STORES = ['foundandprofound', 'toptierpulls'] as const;

export type ItemCondition = (typeof ITEM_CONDITIONS)[number];
export type EbayStore = (typeof EBAY_STORES)[number];

export type ListingConfig = {
  itemCondition: ItemCondition;
  ebayStore: EbayStore;
};

/** A partially chosen config, as edited on the config screen. */
export type ListingConfigDraft = Partial<ListingConfig>;

export const LISTING_ENV_FILENAME = 'listing.env';

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: 'New',
  'pre-owned': 'Pre-owned',
};

export const CONDITION_COLORS: Record<ItemCondition, string> = {
  new: '#15803d',
  'pre-owned': '#c2410c',
};

export const STORE_COLORS: Record<EbayStore, string> = {
  foundandprofound: '#7c3aed',
  toptierpulls: '#0f766e',
};

export function isItemCondition(value: unknown): value is ItemCondition {
  return ITEM_CONDITIONS.includes(value as ItemCondition);
}

export function isEbayStore(value: unknown): value is EbayStore {
  return EBAY_STORES.includes(value as EbayStore);
}

const configFile = new File(Paths.document, 'listing-config.json');

/**
 * The saved choices. There are deliberately no defaults: an unchosen value
 * stays undefined and Home refuses to start a capture until both are set.
 */
export function loadListingConfigDraft(): ListingConfigDraft {
  try {
    if (configFile.exists) {
      const saved = JSON.parse(configFile.textSync());
      return {
        itemCondition: isItemCondition(saved?.itemCondition) ? saved.itemCondition : undefined,
        ebayStore: isEbayStore(saved?.ebayStore) ? saved.ebayStore : undefined,
      };
    }
  } catch (error) {
    console.warn('Could not read listing config:', error);
  }
  return {};
}

export function completeListingConfig(draft: ListingConfigDraft): ListingConfig | null {
  if (!draft.itemCondition || !draft.ebayStore) {
    return null;
  }
  return { itemCondition: draft.itemCondition, ebayStore: draft.ebayStore };
}

export function saveListingConfigDraft(draft: ListingConfigDraft) {
  try {
    if (!configFile.exists) {
      configFile.create();
    }
    configFile.write(JSON.stringify(draft));
  } catch (error) {
    console.warn('Could not save listing config:', error);
  }
}

export function buildListingEnv(config: ListingConfig): string {
  return [
    "# Written by the capture app at upload time. Overrides generic_bulk's .env for this SKU.",
    `GENERIC_BULK_ITEM_CONDITION=${config.itemCondition}`,
    `GENERIC_BULK_EBAY_STORE=${config.ebayStore}`,
    '',
  ].join('\n');
}
