# app-product-listings

Expo (React Native + TypeScript) app for warehouse inventory photo capture.

Currently a minimal camera permissions test: `src/app/index.tsx` renders a
full-screen `CameraView` with a capture button, using `expo-camera`.

## Run

```bash
npm install
npx expo start
```

Open on a physical device via Expo Go (camera doesn't work in the iOS
Simulator). Grant camera permission when prompted, then tap the shutter
button — a native alert shows the captured photo's `file://` URI.
