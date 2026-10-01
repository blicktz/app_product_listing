# Tap-to-focus: needs and plan

Status: **parked** (2026-10-01). Revisit after a few days of testing the
exposure/WB/zoom persistence and the JSON sidecar. Nice-to-have, not required.

## Need

On the camera screen, tap the preview to focus on that spot, e.g. a small label
or a detail on the item that autofocus misses. Must not disturb the locked
exposure, the locked white balance or the saved zoom.

## Why it is possible now

expo-camera (SDK 57) only offers an `autofocus` prop (`on` / `off`); there is no
focus-at-a-point API. Our native module `modules/camera-tuning` already
configures the same `AVCaptureDevice` expo-camera is running (that is how EV and
WB locks work), so it can also use Apple's `focusPointOfInterest`.

**Verdict: feasible, small to medium effort** — about 40 lines of Swift, about 80
lines of TS/TSX, plus **one native dev-client rebuild**.

## Findings

- **Apple API.** Inside `lockForConfiguration`, set
  `device.focusPointOfInterest` (CGPoint, 0–1), then `device.focusMode`. Check
  `isFocusPointOfInterestSupported` first. The point is in the sensor's
  landscape coordinates ((0,0) = top-left with the phone in landscape-right).
  The app is portrait-locked (`app.json`), so a portrait tap at normalized
  (px, py) becomes `(py, 1 - px)`.
- **No conflict with the locks.** We set only the focus point, never
  `exposurePointOfInterest`. Locked EV and WB stay as they are.
- **expo-camera won't override it.** It writes `focusMode` only in
  `setFocusMode()` (`node_modules/expo-camera/ios/Current/CameraSessionManager.swift:196`),
  which runs only when the `autofocus` prop changes
  (`CameraView.swift:96`). We never set that prop.
- **Lens.** The module finds the device by the `lens` name passed to
  `<CameraView selectedLens>`, same as for exposure/WB. The virtual Triple
  Camera should support focus points, and its switch to the ultra-wide for
  macro is driven by focus distance, so tapping a close item should still
  trigger macro. To confirm on device.
- **Tap → sensor coordinates.** The preview uses `resizeAspectFill`
  (`CameraView.swift:189`) inside `previewContainer`; black bars make the 1:1
  square on top. The sensor frame is 4:3 (originals are 2768×4032). Plain
  aspect-fill math maps a tap to the sensor. Taps on the black bars never
  reach the camera view. Focus points are relative to the visible (zoomed)
  frame, so zoom needs no correction — to verify on device.

## Behaviour after a tap

**Continuous autofocus at the tapped point** (`.continuousAutoFocus` + point):

- keeps refocusing at that spot if the item is nudged or swapped;
- no "focus is stuck" state to manage;
- point resets to the center each time the camera screen opens for a new SKU.

(Apple's sample app instead focuses once and holds until the scene changes.
That suits handheld shooting more than a fixed backdrop rig.)

## Plan

### 1. Native — `modules/camera-tuning/ios/CameraTuningModule.swift`

- New `AsyncFunction("setFocusPoint") { (lensName: String?, x: Double?, y: Double?) }`
  - reuse `findDevice` and `configure`;
  - x/y given and `isFocusPointOfInterestSupported` → set
    `focusPointOfInterest` to the clamped `CGPoint(x, y)`;
  - x/y nil → `(0.5, 0.5)` (reset to center);
  - then `focusMode = .continuousAutoFocus` if supported, else `.autoFocus`;
  - return `info(for:)`.
- Add to `info(for:)`: `supportsFocusPoint`, `focusMode`, `focusPointX/Y`,
  `lensPosition`, and `formatWidth/Height` from
  `CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)`
  (so JS uses the real sensor aspect, not a hardcoded 4:3).
- `focusModeName` helper next to `exposureModeName`.

### 2. JS wrapper — `modules/camera-tuning/index.ts`

- Add the new fields to `CameraTuningInfo` and the native type.
- Export `setFocusPoint(lensName, x?, y?)`; resolves to null when the native
  module is missing (older binary), like the other calls.

### 3. Mapping helper — new `src/lib/focusPoint.ts`

`viewToDevicePoint(tapX, tapY, viewW, viewH, sensorW, sensorH)`:

1. portrait sensor size: `iw = min(sensorW, sensorH)`, `ih = max(...)`;
2. aspect-fill: `s = max(viewW/iw, viewH/ih)`, offsets
   `(iw*s - viewW)/2`, `(ih*s - viewH)/2`;
3. normalize to `px`, `py`;
4. return `{ x: py, y: 1 - px }`, clamped to 0–1.

Pure function; the view center maps to (0.5, 0.5).

### 4. Camera screen — `src/app/camera.tsx`

- `Gesture.Tap().runOnJS(true).onEnd(e => handleTapFocus(e.x, e.y))`, combined
  with the pinch as `Gesture.Simultaneous(pinchGesture, tapGesture)` on the
  existing `GestureDetector`. `runOnJS(true)` for the same reason as the pinch
  (reanimated is in the tree). A pinch doesn't count as a tap.
- `handleTapFocus`: ignore until `isCameraReady && isLensResolved`; map with
  `viewToDevicePoint` using `previewSize` (from `handlePreviewLayout`) and the
  format size from `tuning.info` (fallback 4032×3024); call
  `setFocusPoint(lens, x, y)`, `console.warn` on error.
- Focus indicator: yellow-bordered ~70 px square at the tap, shown ~1 s via
  state + `setTimeout` (cleared on unmount), no Animated.
- On lens resolved: `setFocusPoint(lens)` once, so each SKU starts at center.
- Independent of `ENABLE_CAMERA_TUNING`; only needs the native module.

### 5. Optional — focus in the sidecar

The sidecar's `device` block is `getDeviceInfo` output, so `focusMode`,
`lensPosition` and `focusPoint*` appear automatically. Additive; keep
`schemaVersion: 1` and note the fields in `post-processing-requirements.md`.

### Not changing

Exposure/WB logic in `src/lib/useCameraTuning.ts`, zoom persistence
(`src/lib/cameraZoom.ts`), the scanner screen.

## Cost and risks

- Needs a native rebuild + reinstall of the dev client
  (e.g. `npx expo run:ios --device`); a JS reload isn't enough.
- On an old binary the tap simply does nothing.
- To check on the iPhone: Triple Camera reports `supportsFocusPoint: true`;
  taps near the edge focus correctly when zoomed; macro switching still works.

## Verification

- `npx tsc --noEmit`, `npx expo lint`.
- Rebuild/install the dev client, run `npx expo start --dev-client`, then:
  1. Two objects at different distances: tap near → it sharpens; tap far →
     focus moves. Indicator appears each time.
  2. Pinch-zoom in, tap near a corner of the square: that spot sharpens.
  3. Very close to an item, tap it: macro still engages.
  4. EV/WB readout unchanged before and after taps.
  5. Pinch still zooms without a focus tap; tuning buttons still work.
  6. Done → next SKU: focus back at center.
  7. Take a photo: sidecar `device` has `focusMode` / `lensPosition`.
