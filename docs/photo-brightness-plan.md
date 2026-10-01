# Brighter, consistently white product photos: findings and options

Status: research only, not implemented (2026-09-30).

## 1. The problem

### Setup
- **Station:** a white fabric backdrop draped over a table, lit by 3 Andoer LED softboxes (left, right, overhead). Photo: `docs/ui_reference/IMG_0657 2.JPG`.
- **Camera:** an iPhone 15 Pro Max on a stand in front of the table, running this Expo app (`src/app/camera.tsx`, expo-camera 57). The app takes the photo, crops it to a centred 1:1 square and resizes it to 1600 px. It then uploads it to R2, where the downstream pipeline (`ebay-seller-port-wb-normalize-v1`) adjusts white balance.

### Symptoms
- To the eye, the product and backdrop look bright. In the app's photos they look **dull and grey** (`docs/ref_images/samples_dark/`).
- **The background isn't a consistent white.** It is brighter and slightly blue at the top, darker and slightly warm at the bottom, and you can see wrinkles in the fabric.
- What we want is the look of the AI-edited image `docs/ui_reference/Gemini_Generated_Image_3w258v3w258v3w25.jpeg`: a clean, near-white background around 245/255 and a crisp product.
- **AI editing is too expensive for this.** We process hundreds of images a day, so we need it from the camera directly or from cheap, non-AI image processing.

### Measurements
Average background RGB, out of 255:

| Image | Top | Middle (sides) | Bottom |
|---|---|---|---|
| `samples_dark/AAU-0929-087_01` (app, after wb-normalize) | 220 / 224 / 226 | 219–228 | 207 / 204 / 202 |
| `samples_dark/AAU-0930-018_01` (app, after wb-normalize) | 215 / 222 / 224 | 206–216 | 192 / 189 / 188 |
| `sample_2/IMG_4978` (stock Camera, AE lock, +1.70 EV) | 203 / 209 / 208 | 209–216 | 182 / 183 / 179 |
| `sample_2/IMG_4979` (stock Camera, AE lock, +1.45 EV) | 200 / 205 / 205 | 206–215 | 184 / 184 / 180 |
| **Gemini target** | **246 / 246 / 246** | | **244 / 244 / 244** |

EXIF from `sample_2` (the app's own photos keep no EXIF, see below):

| | IMG_4978 | IMG_4979 |
|---|---|---|
| Exposure bias | +1.70 EV | +1.45 EV |
| Shutter / ISO / aperture | 1/120 s / ISO 80 / f2.2 | 1/120 s / ISO 64 / f2.2 |
| Lens | ultra-wide 2.22 mm (macro, 24 mm-eq crop) | same |
| White balance | auto | auto |

### Root causes
1. **Auto-exposure aims for middle grey.** A frame that is mostly white makes the iPhone underexpose by about 1–1.5 EV. On top of that, Apple's tone mapping (Smart HDR) pulls highlights down to protect detail. That's why the scene looks bright to the eye but grey on camera. The `sample_2` shots, with AE locked and EV raised, give a visibly better product: more contrast and richer colour.
2. **Camera settings alone won't make the backdrop pure white.** Even at +1.5–1.7 EV the backdrop stays around 205, because of the tone curve. The front of the table sits about 1 stop darker (around 183) because it gets less light.
3. **Uneven, mixed light.** The top is cooler and the bottom warmer, which points to bulbs with different colour temperatures or room light mixing in.
4. **Wrinkled fabric** adds texture that no global brightness or contrast change can remove.
5. **The app can't control exposure today.** On iOS, expo-camera 57 has no exposure-compensation, exposure-lock, ISO or white-balance props. Those exist only for web (`WebCameraSettings`). It only controls focus, zoom, torch and flash.
6. **We throw the metadata away.** The crop in `handleDone` (ImageManipulator) strips EXIF before upload, so app photos can't be compared or tuned by their capture settings.
7. **The existing downstream step only corrects white balance.** `ebay-seller-port-wb-normalize-v1` doesn't fix levels or uneven light.

### Good news from `sample_2`
- **There is plenty of light.** ISO 64–80 at 1/120 s is close to the sensor's base ISO.
- **1/120 s is flicker-safe** for 60 Hz mains LEDs.
- **We can fix exposure manually.** Instead of relying on AE plus a bias, every product (a black bottle or a white doll) gets exactly the same exposure, so the background is identical in every shot.

## 2. Options (ranked by value / effort)

### Option 0: physical fixes (no code)
- **Bulbs:** use the same colour temperature on all of them (5500–5600K), and turn off room and hallway lights.
- **Front of the table:** add a white card or reflector at the front edge to lift the darker foreground.
- **Backdrop:** replace the wrinkled cloth with a seamless white PVC or paper sweep, or steam it and pull it tight. Move the product forward, away from the back wall. If possible, aim one light at the backdrop so it sits about 1 stop above the subject.

### Option 1: in-app camera control with a local Expo module `camera-tuning` (recommended)
A small native iOS module (`npx create-expo-module --local`). It is autolinked and needs a dev build, as we use today. It configures the same `AVCaptureDevice` that expo-camera is using:

- **Manual exposure (primary):** `setManualExposure(durationSec, iso)` → `device.setExposureModeCustom(duration: CMTime(1/120), iso:)`, with ISO clamped to `activeFormat.minISO…maxISO`.
  - Start at **1/120 s, ISO ~100**, matching `sample_2`.
  - Tune with an ISO stepper (80 / 100 / 125 / 160).
  - This gives deterministic exposure for every product.
- **Fallback:** `setExposureBias(ev)` → `device.setExposureTargetBias` (default **+1.5 EV**) plus `lockExposure()` (`exposureMode = .locked`). This is what was done by hand in the stock Camera app.
- **White balance lock:** `lockWhiteBalance(tempK?)` either locks the current gains (while aimed at the empty backdrop) or sets fixed gains with `deviceWhiteBalanceGains(for: .init(temperature: 5600, tint: 0))`.
- **Reading settings back:** `getCurrentSettings()` returns exposure duration, ISO, bias and WB gains, for the metadata in option 3.

**Integration:**
- **Finding the device:** use `AVCaptureDevice.DiscoverySession` with the same virtual device type that `selectCloseFocusLens` picks (`src/lib/cameraLens.ts`). AVCaptureDevice instances are shared per physical device, so settings applied here affect expo-camera's session.
- **When to apply:** after `handleCameraReady` and after every lens switch (`src/app/camera.tsx`).
- **UI:** an ISO stepper and a "Lock exposure/WB" toggle on the camera screen, with the values persisted.

**Fallbacks and alternatives:**
- If the shared-device approach doesn't stick, use `patch-package` on expo-camera's `CameraSessionManager.swift` to add `exposure` / `whiteBalance` props (same AVFoundation calls).
- react-native-vision-camera is not recommended. It supports exposure bias but not WB lock, and moving to it would mean rewriting the camera screen.

### Option 2: deterministic post-processing (non-AI, ~50–100 ms/image, free)
This uses the known-white background as the reference, so it also works on photos that are already uploaded. It belongs in the downstream normalize step (`ebay-seller-port` pipeline), written in Python + OpenCV/numpy or `sharp` in Node.

1. **Background sample:** take the border strips (top and sides, ~8%) and keep the pixels with low saturation.
2. **White balance:** apply per-channel gains so the background median is neutral.
3. **Flat-field / gradient removal:** fit a smooth 2-D polynomial (or a heavily blurred background map) to the background pixels, then divide the image by it. This removes the bright-top / dark-bottom falloff.
4. **Levels:** map the background to about 245–250, then apply a gentle S-curve and a small saturation boost.
5. **Background cleanup:** flood-fill from the border to find connected near-white, low-saturation pixels, and push them to white through a feathered mask. Only areas connected to the border are touched, so white parts of the product (e.g. boots, trims) are kept.
6. **Optional, still no per-call cost:** a local segmentation model (`rembg` / BiRefNet on CPU, or on-device Apple Vision `VNGenerateForegroundInstanceMaskRequest`) can give a perfectly clean #FFF background with a soft shadow.

### Option 3: metadata and calibration (makes option 2 more accurate)
- **Keep capture metadata:** use `takePictureAsync({ exif: true })` plus `camera-tuning.getCurrentSettings()`.
  - Because the crop strips EXIF, upload a sidecar `{sku}_{nn}.json` (exposure, ISO, bias, WB gains, lens, timestamp) through the existing `presignUpload` flow (`src/lib/uploadApi.ts`, `worker/src/index.ts`).
  - Leave GPS out. The stock-camera EXIF includes it.
- **Calibration shot:** add a Home button to photograph the empty backdrop once per day or per setup, uploaded as `/{dateRoot}/_calibration.jpg`.
  - With exposure and WB locked (option 1), dividing each photo by this frame is an exact flat-field correction. It fixes vignetting, light falloff and colour cast in one step.
  - Fall back to border sampling (option 2) when no calibration frame exists.
- **EXIF alone does little for correction.** The known-white background and the calibration frame are what make tuning reliable. The metadata is mainly for consistency checks and debugging.

## 3. Suggested rollout
1. **Option 0,** plus a quick prototype of option 2 on `docs/ref_images/samples_dark` and `sample_2` (ImageMagick or Python), compared against the Gemini reference.
2. **Option 1:** `modules/camera-tuning` and its UI in `src/app/camera.tsx`.
3. **Option 3:** sidecar JSON and calibration shot. Then move the option 2 script into the downstream normalize step.

## 4. Files that would change
- `src/app/camera.tsx`:
  - CameraView setup, plus `handleCameraReady` (apply the settings).
  - `handleCapture` (exif).
  - `handleDone` (sidecar upload).
- `src/lib/cameraLens.ts`: lens choice reused by the native module.
- `modules/camera-tuning/` (new): Swift module and TS wrapper.
- `src/lib/uploadApi.ts`, `worker/src/index.ts`: allow `.json` sidecars and `_calibration.jpg`.

## 5. How to verify
- **Post-processing prototype:**
  - Run it on the sample images.
  - The background should be ≥240 in all corners, with a channel spread ≤3.
  - Compare visually with the Gemini image, and check that white parts of the product survive.
- **In-app exposure:**
  - Dev build on the iPhone. Shoot the same product at ISO 80 / 100 / 125 / 160 (1/120 s) and compare with `sample_2`, measuring background RGB with `magick … -format %[fx:mean]`.
  - Shoot 10 different products with the lock on. The background values should vary by ≤2 levels between shots.
- **Regressions:** `npx tsc --noEmit` and `npx expo lint` pass, and uploads still complete with sidecars present in R2.
