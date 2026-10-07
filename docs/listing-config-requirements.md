# Per-SKU listing config: handover and requirements

Status: requirements for implementation in the listing-generation repo (`generic_bulk.py`, `generic-bulk-generate`, `generic-bulk-upload`). Written 2026-10-04.

## 1. Why

`generic_bulk.py` takes the item condition and the eBay store from two run-wide env vars:

- `GENERIC_BULK_ITEM_CONDITION` (`new | pre-owned`)
- `GENERIC_BULK_EBAY_STORE` (`foundandprofound | toptierpulls`)

Both are set by hand in the Python `.env`. If one is forgotten, a whole batch is generated (and paid for) with the wrong condition or for the wrong store.

The capture app now records both values **when the photos are taken** and uploads them with each SKU. The generator should use those values, and fall back to `.env` only for SKUs that don't have them.

## 2. What the capture app does

### 2.1 Choosing the values

- The home screen shows the current condition and store as large colour-coded pills, above the SKU field. Tapping the pills opens a config screen.
- **There are no defaults.** Until both values are chosen, Start Capture is disabled (on screen and from the remote shutter).
- The values persist on the phone across SKUs and app restarts, until the operator changes them.
- Each camera session uses a **snapshot** of the values shown on Home when it started. The camera screen shows that snapshot as small chips.

### 2.2 The file: `{YYYY-MM-DD}/{sku}/listing.env`

The file is uploaded to the same R2 folder as the photos (`product-listings` bucket). It uses dotenv format:

```
# Written by the capture app at upload time. Overrides generic_bulk's .env for this SKU.
GENERIC_BULK_ITEM_CONDITION=pre-owned
GENERIC_BULK_EBAY_STORE=foundandprofound
```

- The variable names match the existing env vars, so `dotenv.dotenv_values(path)` returns a dict that can be layered straight over the `.env` values.
- The file is **rewritten on every upload session for that SKU**, so the latest session wins. One SKU is one listing, so it has exactly one condition and one store.
- **It's optional input.** SKUs uploaded before this feature don't have it.
- The app writes only the values listed above. Treat anything else as invalid (section 3).

### 2.3 Backup copy in each photo sidecar

Each `{sku}_{nn}.json` sidecar (see `post-processing-requirements.md` section 2.3) now also has:

```json
"listing": { "itemCondition": "pre-owned", "ebayStore": "foundandprofound" }
```

It's an additive field, so `schemaVersion` stays 1. It's useful as a cross-check, but `listing.env` is the source of truth. A SKU whose photos come from several sessions can have sidecars with older values.

## 3. Requirements for the generator

**L1. Resolve the values per SKU.** For each SKU folder:

1. If `listing.env` exists, use its values.
2. Otherwise, fall back to `GENERIC_BULK_ITEM_CONDITION` and `GENERIC_BULK_EBAY_STORE` from `.env`.
3. If neither gives a value, keep today's behaviour and refuse to run. Report every SKU that's affected.

**L2. Validate strictly.** If `listing.env` has an unknown value, an empty value or a key missing, that's a **hard error for that SKU**. Don't silently fall back to `.env`, because a malformed file means something went wrong.

**L3. Per-SKU condition.** Pass the resolved condition to `bulk_engine/engine.py::load_runtime_config` as `item_condition_override` for that SKU. It then drives the ConditionID mapping and both LLM prompts (item specifics/description and price research), the same as the run-wide value does today.

**L4. Mixed stores.** One run can contain SKUs for both stores. `generic-bulk-upload` (and `generic-bulk-generate UPLOAD=1`) should group the generated rows or CSVs by resolved store and upload each group to its own store.

**L5. `STORE=` on the make command.** Today it overrides `GENERIC_BULK_EBAY_STORE` for one run. Recommendation: it **doesn't** override a per-SKU `listing.env`. It only replaces the `.env` fallback, and it logs a warning for each SKU where it differs from the file. *Decision for the downstream side.*

**L6. Summary before the run.** Before any LLM call, print how each SKU's values were resolved, for example:

```
pre-owned / foundandprofound   23 SKUs  (listing.env)
new       / toptierpulls        4 SKUs  (listing.env)
pre-owned / foundandprofound    2 SKUs  (.env fallback)  AAU-0930-001, AAU-0930-002
```

An optional `CONFIRM=1` prompt here is the last cheap chance to catch a mistake.

**L7. Record the resolved values.** Write the resolved condition, store and source (`listing.env` or `.env`) for each SKU into the run's output or report, so a wrong listing can be traced back.

## 4. Acceptance

- A run over a folder whose SKUs all have `listing.env` ignores `.env`'s `GENERIC_BULK_*` values completely.
- A run that mixes conditions and stores generates each SKU with its own condition, and uploads each SKU to its own store.
- A run over old SKUs without `listing.env` behaves exactly as it does today.
- A malformed `listing.env` stops that SKU with a clear error, and doesn't fall back.
