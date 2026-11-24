import { File, Paths } from 'expo-file-system';

// Item condition and where the listings generated from this app's photos go.
// Uploaded per SKU as `{date}/{sku}/listing.env`, which the downstream
// generic_bulk.py / fb_listings read to override their own GENERIC_BULK_*
// defaults, so a forgotten .env edit can't send a whole batch to the wrong
// condition/store. Spec: docs/listing-config-requirements.md.
//
// Channels: at most one eBay store (they're mutually exclusive) and/or
// Facebook Marketplace. listing.env shapes (server: listing_config.py):
//   eBay only   GENERIC_BULK_EBAY_STORE=<store>
//   eBay + FB   GENERIC_BULK_EBAY_STORE=<store> + GENERIC_BULK_FB_MKT=yes
//   FB only     GENERIC_BULK_EBAY_STORE=fb-mkt

export const ITEM_CONDITIONS = ['new', 'pre-owned'] as const;
export const EBAY_STORES = ['foundandprofound', 'toptierpulls'] as const;
/** The store value listing.env carries for a Facebook Marketplace-only SKU. */
export const FB_MKT_STORE = 'fb-mkt';

export type ItemCondition = (typeof ITEM_CONDITIONS)[number];
export type EbayStore = (typeof EBAY_STORES)[number];

export type ListingConfig = {
  itemCondition: ItemCondition;
  /** null = no eBay listing (Facebook Marketplace only). */
  ebayStore: EbayStore | null;
  fbMkt: boolean;
};

/**
 * A partially chosen config, as edited on the config screen. ebayStore:
 * undefined = not chosen yet, null = "None (FB only)".
 */
export type ListingConfigDraft = {
  itemCondition?: ItemCondition;
  ebayStore?: EbayStore | null;
  fbMkt?: boolean;
};

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
export const FB_MKT_COLOR = '#1877f2';
/** The "None (FB only)" row's pill. */
export const NONE_COLOR = '#8e8e93';

/** Short names for the summary line. */
export const STORE_SHORT: Record<EbayStore, string> = {
  foundandprofound: 'F&P',
  toptierpulls: 'TTP',
};

/** Photos allowed per SKU, matching each platform's listing photo limit. */
export const EBAY_MAX_PHOTOS = 24;
export const FB_MAX_PHOTOS = 10;

export function isItemCondition(value: unknown): value is ItemCondition {
  return ITEM_CONDITIONS.includes(value as ItemCondition);
}

export function isEbayStore(value: unknown): value is EbayStore {
  return EBAY_STORES.includes(value as EbayStore);
}

/**
 * The channels of a config, tolerating the pre-2026-11-23 shape where
 * `ebayStore: 'fb-mkt'` meant Facebook Marketplace only (a saved draft, or an
 * upload job still queued from before the update).
 */
export function channelsOf(raw: { ebayStore?: unknown; fbMkt?: unknown } | null | undefined): {
  ebayStore: EbayStore | null | undefined;
  fbMkt: boolean;
} {
  if (raw?.ebayStore === FB_MKT_STORE) {
    return { ebayStore: null, fbMkt: true };
  }
  const value = raw?.ebayStore;
  const ebayStore = isEbayStore(value) ? value : value === null ? null : undefined;
  return { ebayStore, fbMkt: raw?.fbMkt === true };
}

const configFile = new File(Paths.document, 'listing-config.json');

/**
 * The saved choices. There are deliberately no defaults: an unchosen value
 * stays undefined and Home refuses to start a capture until it's complete.
 */
export function loadListingConfigDraft(): ListingConfigDraft {
  try {
    if (configFile.exists) {
      const saved = JSON.parse(configFile.textSync());
      return {
        itemCondition: isItemCondition(saved?.itemCondition) ? saved.itemCondition : undefined,
        ...channelsOf(saved),
      };
    }
  } catch (error) {
    console.warn('Could not read listing config:', error);
  }
  return {};
}

/** True when the channel choice lists the SKU nowhere: None and FB off. */
export function listsNowhere(draft: ListingConfigDraft): boolean {
  return draft.ebayStore === null && !draft.fbMkt;
}

export function completeListingConfig(draft: ListingConfigDraft): ListingConfig | null {
  if (!draft.itemCondition || draft.ebayStore === undefined || listsNowhere(draft)) {
    return null;
  }
  return { itemCondition: draft.itemCondition, ebayStore: draft.ebayStore, fbMkt: !!draft.fbMkt };
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

/** Photos allowed per SKU: eBay's limit when there's an eBay listing (FB then uses the first 10). */
export function maxPhotos(config: ListingConfig): number {
  return channelsOf(config).ebayStore ? EBAY_MAX_PHOTOS : FB_MAX_PHOTOS;
}

export type StoreBadge = { key: string; label: string; short: string; color: string };

/** One chip per channel, eBay store first. */
export function storeBadges(config: ListingConfigDraft | ListingConfig): StoreBadge[] {
  const { ebayStore, fbMkt } = channelsOf(config);
  const badges: StoreBadge[] = [];
  if (ebayStore) {
    badges.push({ key: ebayStore, label: ebayStore, short: STORE_SHORT[ebayStore], color: STORE_COLORS[ebayStore] });
  }
  if (fbMkt) {
    badges.push({ key: FB_MKT_STORE, label: 'FB', short: 'FB', color: FB_MKT_COLOR });
  }
  return badges;
}

/** e.g. "Lists on: F&P + FB · 24 photos/SKU". */
export function channelSummary(config: ListingConfig): string {
  const names = storeBadges(config).map((badge) => badge.short).join(' + ');
  return `Lists on: ${names} · ${maxPhotos(config)} photos/SKU`;
}

/** The store value listing.env (and the shoot log) carries: 'fb-mkt' when FB only. */
export function listingEnvStore(config: ListingConfig): string {
  return channelsOf(config).ebayStore ?? FB_MKT_STORE;
}

export function buildListingEnv(config: ListingConfig): string {
  const { ebayStore, fbMkt } = channelsOf(config);
  return [
    "# Written by the capture app at upload time. Overrides generic_bulk's .env for this SKU.",
    `GENERIC_BULK_ITEM_CONDITION=${config.itemCondition}`,
    `GENERIC_BULK_EBAY_STORE=${ebayStore ?? FB_MKT_STORE}`,
    ...(ebayStore && fbMkt ? ['GENERIC_BULK_FB_MKT=yes'] : []),
    '',
  ].join('\n');
}
