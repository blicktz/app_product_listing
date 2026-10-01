# Product photo post-processing: handover and requirements

Status: requirements for implementation in the post-processing repo (the downstream pipeline, today `ebay-seller-port-wb-normalize-v1`). Written 2026-10-01.

This document has two parts:

1. **What the capture app (this repo) already does**: camera locks, output format, and the per-photo JSON sidecar the post-processor can rely on.
2. **What the post-processor should do**: requirements and acceptance criteria to make app photos look like the AI-edited reference we like best, using cheap, deterministic (non-AI) image processing.

Background research and the full option list are in [`photo-brightness-plan.md`](photo-brightness-plan.md). This document supersedes its "Option 2" section.

---

## 1. The problem in one paragraph

Products are shot on an iPhone 15 Pro Max in front of a white fabric backdrop draped over a table, lit by three LED softboxes. To the eye the scene is bright, but photos come out **grey, uneven and textured**:

- The backdrop sits around 190–228 instead of white.
- It is brighter and slightly blue at the top, darker and warmer at the bottom.
- The fabric's wrinkles and the table/wall fold are clearly visible.

AI editing (Gemini) produces the look we want, but it's too expensive for hundreds of images a day. Better camera settings fix part of it (section 2). The rest has to come from post-processing (section 4).

---

## 2. What is already implemented in the capture app

### 2.1 Locked exposure and white balance

The app drives the camera through a small native iOS module (`modules/camera-tuning`). Its settings are in `src/lib/useCameraTuning.ts`, and the UI chips sit on the camera screen.

| Setting | Behaviour |
|---|---|
| **Lens** | `Back Triple Camera` (a virtual device). iOS switches to the 2.22 mm ultra-wide for close focus. This lens can't take a fixed shutter/ISO or a fixed Kelvin value, so the app uses "measure, then lock". |
| **Exposure** | Auto exposure with an **EV bias** set by the operator (currently +2 EV), then **locked**. Typical locked values: **1/120 s, ISO ~55–64** (flicker-safe under 60 Hz LEDs, at base ISO). |
| **White balance** | **Locked** to whatever auto-WB measured at lock time, usually aimed at the backdrop. Observed values: roughly 4000–4300 K, with a slightly negative tint. It is *not* a fixed 5600 K. |
| **Carry-over** | Locks stay on between SKUs, so consecutive products are shot with identical shutter, ISO and WB. The operator re-measures by toggling a lock off and on, ideally with an empty backdrop. An app restart re-measures once. |
| **Zoom** | The pinch-zoom level is saved and restored for every SKU, so framing is consistent. |

**What this means for post-processing:**
- Within one batch, exposure and colour are **consistent from photo to photo**, so the input is predictable.
- The images are still **not white enough**. Even at +2 EV, Apple's tone mapping keeps the backdrop below ~230, and the light falloff and fabric texture remain.
- WB is locked to the room's light, not to neutral, so a **colour cast can remain**. The pipeline must still neutralise it.

### 2.2 Uploaded image format

| Property | Value |
|---|---|
| Location | R2 bucket `product-listings`, key `{YYYY-MM-DD}/{sku}/{sku}_{nn}.jpg` (`nn` = 01, 02, …) |
| Geometry | Centred **1:1 crop** of the upright photo, resized to **1600 × 1600** |
| Encoding | JPEG, quality 0.9, **no embedded ICC profile** (treat as sRGB) |
| EXIF | **Stripped** by the crop/re-encode step. Use the sidecar instead. |

### 2.3 Per-photo JSON sidecar

Every photo uploaded since 2026-10-01 has a sidecar next to it: `{YYYY-MM-DD}/{sku}/{sku}_{nn}.json`. Older photos don't, so the sidecar is **optional input**. The pipeline must work without it.

Sample: [`ref_images/AAU-0930-026_01.json`](ref_images/AAU-0930-026_01.json). Schema (`schemaVersion: 1`, defined in `src/lib/photoSidecar.ts`):

| Field | Contents |
|---|---|
| `schemaVersion`, `appVersion` | Format and app versions |
| `sku`, `filename` | The photo this sidecar describes |
| `capturedAt` | ISO-8601 UTC, stamped when the shutter was pressed (~0.5 s before the actual exposure) |
| `zoom`, `lens` | Normalised zoom (0–1) and the device name |
| `exif` | The camera's full EXIF dictionary: `ExposureTime`, `ISOSpeedRatings`, `ExposureBiasValue`, `FNumber`, `FocalLength`, `BrightnessValue`, `LensModel`, `DateTimeOriginal` + `SubsecTimeOriginal` + `OffsetTimeOriginal`, … **No GPS.** |
| `device` | Live camera state from the native module: `exposureMode`, `exposureDurationSec`, `iso`, `bias`, `whiteBalanceMode`, `temperatureK`, `tint`, plus supported ranges. `null` on builds without the module. |
| `original` | Width/height of the upright full-resolution capture (e.g. 2768 × 4032) |
| `processing.crop` | Crop rectangle in `original` coordinates |
| `processing.output` | Output size, format and JPEG quality |

**How to read it correctly:**
- **Trust `device` for lock state.** EXIF reports `ExposureMode: 0` and `WhiteBalance: 0` ("auto") even when both are locked. EXIF can't express "locked after auto-measuring".
- **`exif.CompositeImage: 2`** means iOS merged several frames (Smart HDR / Deep Fusion) and applied its own tone curve. Pixel values are **not** a linear function of shutter × ISO. Correct from image content (the white background), not from exposure maths.
- **Use `original`, not the EXIF pixel dimensions, for geometry.** EXIF pixel dimensions are in sensor orientation (e.g. 4032 × 2768 with `Orientation: 6`). `original` and `processing.crop` refer to the upright image.
- **Use `DateTimeOriginal` (+ subsec + offset) for the precise capture time**, not `capturedAt`.

### 2.4 Ideas that were tried and dropped

- **Calibration shot** (photographing the empty backdrop for flat-field correction): **dropped.** The fabric backdrop moves and re-wrinkles between items, so a per-pixel reference frame would leave ghost wrinkles. Only its large-scale lighting component would be reusable, and per-image estimation (R4 below) covers that.
- **Segmentation / background-removal models** (rembg, BiRefNet, Apple Vision): **out of scope.** One-off tests didn't work universally across item types and needed too much manual correction.

---

## 3. The target look

Reference (Gemini-edited): [`ui_reference/Gemini_Generated_Image_3w258v3w258v3w25.jpeg`](ui_reference/Gemini_Generated_Image_3w258v3w258v3w25.jpeg). Current app output: [`ref_images/samples_dark/`](ref_images/samples_dark/).

What makes the reference look good:

1. **Bright, neutral, perfectly even background:** every region is 245–247, with neutral R = G = B. No gradient top to bottom, no colour cast.
2. **No visible fabric:** no wrinkles, folds or table/wall seam. It reads as a seamless studio sweep.
3. **A faint, soft contact shadow** under the product (about 3–6 levels below the background). The product looks grounded, not cut out.
4. **A crisp, contrasty product:** deep blacks on dark plastic, rich but natural colour (purples, reds), visible specular highlights and fine moulded detail.
5. **Transparent packaging stays transparent:** the clear blister's edges and reflections are visible, and the background seen through it is clean.

### Measured background values (mean RGB of 1000 px-scale patches)

| Image | Top-left | Top-right | Mid-left | Mid-right | Bottom-left | Bottom-right | Patch noise (σ) |
|---|---|---|---|---|---|---|---|
| **Gemini target** | 245/245/245 | 245/246/245 | 247/247/247 | 246/247/247 | 245/245/245 | 246/246/246 | **1** |
| App `AAU-0930-018_01` | 221/225/228 | 207/207/209 | 213/215/215 | 225/225/225 | 192/188/187 | 199/196/193 | 3–8 |
| App `AAU-0929-087_01` | 219/221/224 | 187/188/190 | 227/228/225 | 203/205/204 | 206/203/202 | 208/206/203 | 2–18 |

The app photos are 20–60 levels too dark, vary by up to 40 levels across the frame, run cool (blue) at the top and warm at the bottom, and the high σ is fabric texture. *(These samples predate the camera locks in 2.1. Newer photos are brighter and more consistent, but have the same kinds of problems.)*

---

## 4. Requirements for the post-processor

### Constraints

- **C1. No AI and no per-image cost.** Classical image processing only (e.g. Python + OpenCV/numpy, or Node `sharp`). No segmentation or generative models.
- **C2. Speed:** ≤ 200 ms per 1600 px image on a single CPU core (target ~100 ms), for hundreds of images a day.
- **C3. Deterministic:** the same input + parameters always give the same output. Parameters live in a config file, not in code.
- **C4. Non-destructive:** never overwrite the original in R2. Write output to the pipeline's existing output location.
- **C5. Sidecar optional:** works with only the JPEG. When the sidecar is there, use it for QA and logging (R9).

### Processing steps

**R1. Input and output**
- Input: one `{sku}_{nn}.jpg`, plus the optional `.json`.
- Output: JPEG, 1600 × 1600, sRGB, quality ≥ 0.9. Keep the input framing (no re-crop or re-centring in this phase).

**R2. Background estimation**
- Build a background mask from pixels that are **bright and low-saturation**, seeded from the image border (top and side strips, ~8% of the frame) and grown by flood fill. Only regions connected to the border count as background.
- Must be robust when the product touches or crosses a border edge, and when the product itself is white or grey.
- If too little of the frame is confidently background (configurable, e.g. < 15%), fall back to global-only corrections (R3 + R5) and flag the image (R10).

**R3. White balance**
- Compute per-channel gains so the **median background colour becomes neutral**, and apply them to the whole image.
- Acceptance: background channel spread (max − min of R, G, B means) **≤ 3** in every region.

**R4. Illumination flattening (gradient removal)**
- Fit a **smooth** illumination surface to the background pixels: a low-order 2-D polynomial (degree 2–3), or a heavily blurred background map with the product region in-painted. Divide the image by it.
- This removes the bright-top / dark-bottom falloff, the left/right imbalance and the vignetting.
- Must be smooth enough not to imprint wrinkles or the product silhouette. It should only model lighting, not texture.
- Acceptance: after R4 + R5, the six background patches in section 3 are all within **±3 levels** of each other.

**R5. Levels and tone**
- Map the background to **245 (± 3)**, the same as the target.
- Apply a gentle S-curve for product contrast. Keep **true blacks** on dark products (black plastic shouldn't turn grey) and **roll off highlights** so white or specular parts of the product don't clip to flat 255.
- Optional small saturation/vibrance boost on non-background pixels (configurable, default modest) to match the target's richer colour without making it look cartoonish.

**R6. Background cleanup (wrinkles, folds, table seam)**
- Within the **border-connected background mask**, push near-white, low-saturation pixels to the target background value through a **feathered** mask, so there's no hard cut-out edge around the product.
- **Keep a soft contact shadow** directly under the product: limit how far shadow pixels are lifted near the product's base, so a faint 3–6-level shadow remains as in the target. The aim is a grounded product, not a pasted-on one.
- **Protect product edges:**
  - Stop the flood fill at strong edges (high gradient magnitude), so white product parts touching the backdrop and the **edges of clear plastic packaging** aren't erased.
  - Prefer leaving a faint wrinkle over eating into the product.
- Acceptance:
  - Background patch noise **σ ≤ 2** (target is 1).
  - No visible wrinkle lines at 100% zoom on the test set (section 5).
  - No part of the product lost, specifically white areas and transparent blister edges.

**R7. Sharpening**
- Light unsharp mask on the final image, product-weighted if cheap. Don't sharpen the background, which would bring texture back.

**R8. Colour management**
- Treat input as sRGB (uploaded JPEGs have no ICC profile).
- Do the R3–R6 maths in linear light or a perceptual space.
- Write output tagged sRGB.

### Robustness, QA and reporting

**R9. Use the sidecar for QA** (when present). Log per image:
- `device.exposureMode` and `device.whiteBalanceMode`: flag the image if either isn't `locked`.
- `device.bias`, `device.exposureDurationSec`, `device.iso`, `device.temperatureK`.
- Within one SKU or batch, **flag outliers**: photos whose exposure or WB differ from the batch majority, which means the operator re-measured mid-batch.
- Exposure and WB values are **not** inputs to the correction (see the `CompositeImage` note in 2.3), only consistency checks.

**R10. Safe failure**
- If any step can't run confidently (too little background, a mostly dark frame, a product filling the frame), output a conservative version (WB + levels only) and **flag the image** in a run report, rather than producing artefacts.
- The output must never look worse than the input on the test set.

**R11. Run report**
- Per image: background mean before/after for the six patches, channel spread, σ, background-mask coverage, flags, and processing time.
- Format: CSV or JSON per batch.

### Out of scope (this phase)

- Segmentation or background-removal models (see 2.4), and any AI or generative editing.
- A calibration or flat-field reference frame (see 2.4).
- Re-cropping, re-centring or scaling the product within the frame. The reference shows the product slightly larger and centred; revisit later if wanted.
- Retouching the product itself (dust, scratches, reflections).

---

## 5. Test set and acceptance

Build a test set of **at least 20 photos** shot with the locks from 2.1, covering:

- **Dark products** (black bottle): blacks must stay black.
- **White or light products and white parts** (white doll boots, white packaging): must not be erased into the background.
- **Clear plastic packaging / blisters:** edges must stay visible.
- **Colourful products** (purple, pink, teal): colour must stay true after the background WB correction.
- **Large products** that cover most of the frame: the R2 fallback path.
- **Products touching a frame edge.**
- Older photos without sidecars (e.g. `ref_images/samples_dark/`).

Pass criteria (measured on 1000 px-scale patches, as in section 3):

| Metric | Target |
|---|---|
| Background mean, all six patches | 245 ± 3 |
| Max difference between patches | ≤ 6 levels |
| Background channel spread | ≤ 3 |
| Background σ (texture) | ≤ 2 |
| Product damage (lost white or transparent edges) | none, by visual check at 100% |
| Side-by-side with the Gemini reference | judged "close" by the operator on ≥ 80% of the set |
| Time per image | ≤ 200 ms |

A measurement command (ImageMagick) that reproduces the numbers in section 3:

```sh
magick IMAGE.jpg -resize 1000x1000! -crop 120x120+20+20 +repage \
  -format "%[fx:round(255*mean.r)]/%[fx:round(255*mean.g)]/%[fx:round(255*mean.b)] sd=%[fx:round(255*standard_deviation)]" info:
```

The other patches use crops `120x120+860+20`, `100x150+20+430`, `100x150+880+430`, `120x80+20+900` and `120x80+860+900`.

---

## 6. Open questions

1. **Shadow strength:** keep the faint contact shadow as in the reference, or allow a pure #FFFFFF background for marketplaces that require it (e.g. a config switch)?
2. **Output location and naming:** overwrite the existing normalized output path, or write next to it (e.g. a `_v2` suffix) for an A/B period?
3. **Re-framing:** is product size or centring worth a later phase? The reference crops tighter than the app does.
