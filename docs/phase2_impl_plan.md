# Plan: Phase 2 — Inventory & SKU Management (Home + Camera Views)

## Context
Phase 1 delivered a single camera-permissions test screen. Phase 2 (`docs/phase2_design.md`) replaces that with a two-screen flow: a **Home View** for SKU/session entry and a **Camera View** for multi-photo capture mimicking eBay's listing-photo UI, with photos locally cached, backed up to Camera Roll, and locally organized/named as if ready for R2 upload (no real upload yet — Phase 3).

Two points needed resolving against the literal PRD text, settled via discussion and eBay reference screenshots (`docs/ui_reference/IMG_7876.PNG`, `IMG_7877.PNG`, `IMG_7883.PNG`):
- **1:1 capture**: `expo-camera`'s `ratio` prop (native square capture) is **Android-only** — iOS has no equivalent, confirmed by reading the installed type defs (`node_modules/expo-camera/build/Camera.types.d.ts`). The screenshots clarify what was actually wanted: a **live letterbox overlay** on the full camera preview (black bars top/bottom revealing a centered square "window"), not a native-only setting. We pair this with a **real pixel crop** (via `expo-image-manipulator`) of the captured photo to match that same window, so the saved file is genuinely square on both platforms — not a CSS-only visual crop.
- **Thumbnail delete**: reference UI shows a corner "×" badge per thumbnail, but per the user the badge is purely visual — tapping *anywhere* on the thumbnail deletes it immediately, no confirmation dialog. We're matching that exactly.

The Camera View's layout mirrors `IMG_7883`: top-right "Done" button (no flash/camera-flip/ratio-toggle controls, per instruction), full-bleed letterboxed preview, bottom row with a photo counter (left) + shutter (center), and a thumbnail strip with corner delete badges above that row.

**Update (post-implementation):** `IMG_7883` also shows a 24-photo cap (eBay's own listing-photo limit), missed in the first pass. Added to `docs/phase2_design.md` and implemented here: session capped at **24 photos per SKU**, counter changed from `"N photos"` to `"N/24"` format, and the shutter button disables once the cap is hit.

**Update (resolution fix):** captured photos were coming out at 1080x1080 instead of matching eBay's 1600x1600 output. Root cause: we never set `pictureSize` on `CameraView`, so it defaulted to `"High"` (`AVCaptureSession.Preset.high`, confirmed in `node_modules/expo-camera/ios/CameraViewModule.swift`) — a preset shared with video recording that caps well below the sensor's actual photo resolution. We were not downsizing anywhere in our own code; the cap was entirely in the uncustomized capture preset. Fix: set `pictureSize="Photo"` (`AVCaptureSession.Preset.photo`, confirmed in `node_modules/expo-camera/ios/Current/CameraRecordingOptions.swift`) for full-resolution capture, then resize the square crop down to exactly 1600x1600 when it exceeds that (never upscale if a device's native capture is smaller).

## Approach

### 1. New dependencies
- `npx expo install expo-image-manipulator` — real pixel crop to square after each capture.
- `npx expo install expo-file-system` — organizes session photos into `{cache}/sessions/{dateRoot}/{sku}/` and renames them to `<SKU>_NN.jpg` at session end. SDK 54 ships the new class-based API (`File`, `Directory`, `Paths` from `expo-file-system`), confirmed via Expo's SDK 54 docs.
- `expo-camera` and `expo-media-library` are already installed from Phase 1 — reused as-is.
- Neither new package needs an `app.json` config plugin (no permission strings involved).

### 2. Routing (expo-router, already set up for exactly this)
- `src/app/index.tsx` → rewritten as the **Home View**.
- `src/app/camera.tsx` → new **Camera View** route.
- `src/app/_layout.tsx` → add a `<Stack.Screen name="camera" options={{ gestureEnabled: false }} />` so the only way out of the Camera View is the Done button (matches the reference UI, which has no swipe-back/cancel affordance).
- Navigation: `router.push({ pathname: '/camera', params: { sku, dateRoot } })`; Camera View reads them via `useLocalSearchParams<{ sku: string; dateRoot: string }>()`.

### 3. Home View (`src/app/index.tsx`)
- Compute `dateRoot` once on mount: `YYYY-MM-DD` from `new Date()`, displayed as read-only text (e.g. "Session folder: 2026-08-22/").
- Controlled SKU `TextInput`.
- "Start Capture" button, disabled until `sku.trim()` is non-empty; navigates to `/camera`.
- SKU field resets to empty when the screen regains focus (via `useFocusEffect` from `expo-router`), so it's ready for the next item after a session completes.

### 4. Camera View (`src/app/camera.tsx`)
**Layout (top to bottom), mirroring `IMG_7883`:**
- Safe-area top bar: just the "Done" button, right-aligned, blue text.
- Preview container (fills space between top bar and bottom controls): full-bleed `CameraView` (`facing="back"`, `ratio="1:1"` as an Android best-effort hint, `pictureSize="Photo"` for full-resolution capture) via `StyleSheet.absoluteFill`, with two absolutely-positioned black `View` overlays (top + bottom) sized so the visible gap between them is exactly `containerWidth × containerWidth` (a centered square) — computed from `useWindowDimensions()` / `onLayout`.
- Thumbnail strip: horizontal `ScrollView` just above the bottom row, rendering each session photo as a `Pressable` square `Image` with a small white circular "×" badge in its top-right corner (visual indicator only, not a separate tap target). Tapping anywhere on the thumbnail deletes it immediately (removes from state + deletes the cached file), no confirmation.
- Bottom row: left = photo count text (`"N/24"` format, per `IMG_7883`), center = circular shutter button (reusing Phase 1's shutter styling), disabled/dimmed once `photos.length === 24`.

**Capture flow (shutter tap):**
0. No-op if `photos.length >= MAX_PHOTOS` (24) — guards against a queued tap landing after the cap is hit.
1. `cameraRef.current?.takePictureAsync()`.
2. Crop to centered square with `expo-image-manipulator`: `size = min(photo.width, photo.height)`, `origin = centered`, via `ImageManipulator.manipulate(photo.uri).crop(...)`. If `size > MAX_OUTPUT_SIZE` (1600), chain `.resize({ width: 1600, height: 1600 })` before rendering — never upscale if the native capture is smaller. Then `.renderAsync()` → `.saveAsync(...)`. This is the imperative (non-hook) API, callable inside the async handler.
3. Append the cropped file's URI to session `photos` state → thumbnail strip updates immediately (satisfies "immediately save to cache for fast UI").
4. Fire-and-forget `MediaLibrary.saveToLibraryAsync(croppedUri)` (Phase 1's existing pattern) as the Camera Roll backup — not awaited before updating UI, so the shutter stays responsive for rapid shots.

**Done flow:**
- Enabled only when `photos.length > 0`.
- Build final filenames from the surviving queue's current order: index `i` → `NN = String(i + 1).padStart(2, '0')` → `${sku}_${NN}.jpg`.
- Copy each cropped photo into `Directory(Paths.cache, 'sessions', dateRoot, sku)` (created with intermediates) under its final name — this is local-only prep matching the R2 path/naming convention for Phase 3, per the PRD.
- Show `Alert.alert('Ready for Upload', "${photos.length} photo(s) will be uploaded to R2 at /${dateRoot}/${sku}/")` — no real upload, per the PRD's explicit instruction for this phase.
- `router.back()` to Home View.

### 5. State management
- Camera View: local `useState` for the `photos` array (`{ id, uri }[]`). No global store needed — `sku`/`dateRoot` flow in as route params (both plain strings), scope is a single active session.

## Files touched
- `src/app/index.tsx` — rewrite (Home View)
- `src/app/camera.tsx` — new (Camera View)
- `src/app/_layout.tsx` — add camera screen options
- `package.json` / `app.json` — add `expo-image-manipulator`, `expo-file-system`

## Verification
- `npx tsc --noEmit` and `npx expo-doctor` clean, as in Phase 1.
- On-device (Expo Go, SDK 54): enter a SKU → Start Capture → confirm the letterbox bars show exactly the region that ends up in the captured square photo → take several photos, confirm thumbnails appear instantly → tap a thumbnail (anywhere on it, not just the "×"), confirm immediate removal → tap Done → confirm the alert shows the correct count and `/{dateRoot}/{sku}/` path → confirm each photo also landed in the system Photos album as a square image → confirm navigation returns to Home View with the SKU field cleared.
