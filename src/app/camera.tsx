import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';
import { presignUpload } from '@/lib/uploadApi';
import { sleep } from '@/lib/sleep';
import { selectCloseFocusLens } from '@/lib/cameraLens';
import { loadZoom, saveZoom } from '@/lib/cameraZoom';
import { useRemoteTrigger } from '@/lib/useRemoteTrigger';
import { setPendingHomeAction } from '@/lib/pendingHomeAction';
import { Toast } from '@/components/Toast';
import { CameraPermissionGate } from '@/components/CameraPermissionGate';
import { CameraTuningControls } from '@/components/CameraTuningControls';
import { useCameraTuning } from '@/lib/useCameraTuning';

// Save a copy of every cropped photo to the device's camera roll. Disabled for
// now: the R2 upload + auto-retry path has been reliable across 18k+ photos, so
// the local backup isn't earning its keep. Left wired up (not deleted) until
// we're certain it can go. Flip to true to restore.
const SAVE_TO_CAMERA_ROLL = false;

// Experimental (camera-tuning-experiment branch): fixed exposure + white balance
// via the local `modules/camera-tuning` native module, so the white backdrop
// stops coming out grey. false = identical behaviour to before.
const ENABLE_CAMERA_TUNING = true;

const TOAST_DURATION_MS = 3000;
const MAX_UPLOAD_ATTEMPTS = 5;
const UPLOAD_RETRY_BASE_DELAY_MS = 10_000; // wait before the 1st retry
const UPLOAD_RETRY_BACKOFF_FACTOR = 1.5; // ~10s, 15s, 22s, 30s
const UPLOAD_RETRY_MAX_DELAY_MS = 30_000; // cap
const UPLOAD_TIMEOUT_MS = 30000;

type PreparedFile = { filename: string; localUri: string };

type SessionPhoto = {
  id: string;
  uri: string;
  width: number;
  height: number;
};

const THUMBNAIL_SIZE = 64;

function pinchZoom(startZoom: number, scale: number) {
  return Math.min(Math.max(startZoom + (scale - 1) * 0.75, 0), 1);
}
const MAX_PHOTOS = 24;
const MAX_OUTPUT_SIZE = 1600;

export default function CameraScreen() {
  const router = useRouter();
  const { sku, dateRoot, startNumber } = useLocalSearchParams<{
    sku: string;
    dateRoot: string;
    startNumber: string;
  }>();
  const insets = useSafeAreaInsets();
  const startingNumber = Number(startNumber) || 1;
  const existingCount = startingNumber - 1;

  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const cameraRef = useRef<CameraView>(null);
  const thumbnailStripRef = useRef<ScrollView>(null);
  const nextPhotoId = useRef(0);
  // Filenames that uploaded OK this session. Survives re-renders and repeated
  // Done presses so a manual retry only re-uploads what's still missing. Keyed
  // by the position-derived filename, so it's cleared whenever photos change.
  const uploadedFilenamesRef = useRef<Set<string>>(new Set());

  const [photos, setPhotos] = useState<SessionPhoto[]>([]);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');
  const [errorToast, setErrorToast] = useState<string | null>(null);
  // Restored from the last SKU so every item is framed the same.
  const [zoom, setZoom] = useState(loadZoom);
  const zoomStartRef = useRef(0);

  // Since SDK 57 expo-camera forces the bare wide-angle lens on iOS, which on
  // this iPhone can't focus closer than ~20 cm. Switch to a virtual multi-camera
  // lens once the preview is ready so iOS auto-engages the ultra-wide for macro
  // range (restores the SDK 54 behaviour). Name is localized, so resolve it from
  // the device's own list rather than hardcoding.
  const [lens, setLens] = useState<string>();
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isLensResolved, setIsLensResolved] = useState(false);

  const handleCameraReady = useCallback(async () => {
    setIsCameraReady(true);
    const lenses = (await cameraRef.current?.getAvailableLensesAsync()) ?? [];
    const pick = selectCloseFocusLens(lenses);
    if (pick) {
      setLens(pick);
    }
    setIsLensResolved(true);
  }, []);

  // Wait for the lens pick: tuning the default lens first would lock the wrong
  // device and make the macro lens re-measure instead of keeping its lock.
  const tuning = useCameraTuning(ENABLE_CAMERA_TUNING, lens, isCameraReady && isLensResolved);

  /* eslint-disable react-hooks/refs -- these callbacks run during an active
     pinch gesture, never during render; the ref snapshots the current zoom at
     gesture start so event.scale (cumulative from that point) maps correctly. */
  const pinchGesture = Gesture.Pinch()
    // Since SDK 57 react-native-reanimated is in the tree (via expo-router), so
    // gesture-handler workletizes these callbacks onto the UI thread by default;
    // setZoom() is plain JS and crashes there. Keep them on the JS thread.
    .runOnJS(true)
    .onStart(() => {
      zoomStartRef.current = zoom;
    })
    .onUpdate((event) => {
      setZoom(pinchZoom(zoomStartRef.current, event.scale));
    })
    .onEnd((event) => {
      saveZoom(pinchZoom(zoomStartRef.current, event.scale));
    });
  /* eslint-enable react-hooks/refs */

  const previousPhotoCount = useRef(0);
  useEffect(() => {
    if (photos.length > previousPhotoCount.current) {
      thumbnailStripRef.current?.scrollToEnd({ animated: true });
    }
    previousPhotoCount.current = photos.length;
  }, [photos.length]);

  const handlePreviewLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewSize({ width, height });
  };

  const handleCapture = async () => {
    if (!isCameraReady || isProcessing || existingCount + photos.length >= MAX_PHOTOS) {
      return;
    }

    // The session is briefly not ready right after mount and again right after
    // the lens switch in handleCameraReady. Swallow the rejection so a
    // remote-shutter press in that window is a no-op, not an unhandled rejection.
    const photo = await cameraRef.current
      ?.takePictureAsync(ENABLE_CAMERA_TUNING ? { exif: true } : undefined)
      ?.catch((error) => {
        console.warn('takePictureAsync failed:', error);
        return undefined;
      });
    if (!photo) {
      return;
    }
    if (ENABLE_CAMERA_TUNING && photo.exif) {
      // Spike check: the captured exposure should match the tuning readout.
      const { ExposureTime, ISOSpeedRatings, ExposureBiasValue } = photo.exif;
      console.log('[camera-tuning] captured', { ExposureTime, ISOSpeedRatings, ExposureBiasValue });
    }

    setPhotos((current) => [
      ...current,
      {
        id: `photo-${nextPhotoId.current++}`,
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
      },
    ]);
    // Photo set changed: position-derived filenames no longer map to the same
    // photos, so a partial-upload resume would be wrong. Start fresh.
    uploadedFilenamesRef.current.clear();
  };

  const handleDeletePhoto = (id: string) => {
    if (isProcessing) {
      return;
    }
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) {
        new File(target.uri).delete();
      }
      return current.filter((photo) => photo.id !== id);
    });
    // See handleCapture: filenames are position-derived, so drop resume state.
    uploadedFilenamesRef.current.clear();
  };

  const handleDone = async () => {
    if (isProcessing || photos.length === 0) {
      return;
    }

    setIsProcessing(true);

    let permissionToSave = mediaPermission;
    if (SAVE_TO_CAMERA_ROLL && !permissionToSave?.granted) {
      permissionToSave = await requestMediaPermission();
    }

    const sessionDir = new Directory(Paths.cache, 'sessions', dateRoot, sku);
    sessionDir.create({ intermediates: true, idempotent: true });

    const preparedFiles: PreparedFile[] = [];

    for (let index = 0; index < photos.length; index++) {
      const nn = String(startingNumber + index).padStart(2, '0');
      const filename = `${sku}_${nn}.jpg`;
      // Already uploaded on an earlier Done press this session: skip the crop,
      // the camera-roll save, and the re-upload.
      if (uploadedFilenamesRef.current.has(filename)) {
        continue;
      }

      setProcessingLabel(`Preparing photo ${index + 1} of ${photos.length}...`);

      const photo = photos[index];
      const size = Math.min(photo.width, photo.height);
      const originX = (photo.width - size) / 2;
      const originY = (photo.height - size) / 2;

      const context = ImageManipulator.manipulate(photo.uri);
      context.crop({ originX, originY, width: size, height: size });
      if (size > MAX_OUTPUT_SIZE) {
        context.resize({ width: MAX_OUTPUT_SIZE, height: MAX_OUTPUT_SIZE });
      }
      const rendered = await context.renderAsync();
      const cropped = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });

      if (SAVE_TO_CAMERA_ROLL && permissionToSave?.granted) {
        // saveToLibraryAsync is removed in SDK 57 (throws); the class-based
        // Asset.create is its replacement.
        await MediaLibrary.Asset.create(cropped.uri).catch(() => {});
      }

      const destination = new File(sessionDir, filename);
      if (destination.exists) {
        destination.delete();
      }
      new File(cropped.uri).copySync(destination);

      preparedFiles.push({ filename, localUri: destination.uri });
    }

    let lastError: unknown = null;

    // One pass over the still-pending files: presign them, PUT each one, and keep
    // going past a failure so a single bad photo doesn't block the rest. Records
    // each success in uploadedFilenamesRef and returns the files that failed.
    const uploadPass = async (pending: PreparedFile[]): Promise<PreparedFile[]> => {
      const { uploadUrls } = await presignUpload(
        dateRoot,
        sku,
        pending.map((file) => file.filename)
      );

      const failed: PreparedFile[] = [];
      for (let index = 0; index < pending.length; index++) {
        const { filename, localUri } = pending[index];
        setProcessingLabel(`Uploading photo ${index + 1} of ${pending.length}...`);

        try {
          const uploadUrl = uploadUrls[filename];
          if (!uploadUrl) {
            throw new Error(`No upload URL returned for ${filename}`);
          }

          // Read the local file through expo-file-system rather than fetch():
          // from SDK 56 the global fetch is expo/fetch, whose Response.blob()
          // throws on native. A Uint8Array is a valid PUT body for the presigned
          // R2 upload.
          const body = await new File(localUri).bytes();

          // Abort a PUT that stalls past the timeout so a dropped connection
          // counts as a failed attempt instead of hanging the spinner.
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
          let putResponse: Response;
          try {
            putResponse = await fetch(uploadUrl, {
              method: 'PUT',
              body,
              headers: { 'Content-Type': 'image/jpeg' },
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeout);
          }

          if (!putResponse.ok) {
            throw new Error(`Upload failed for ${filename} (${putResponse.status})`);
          }

          uploadedFilenamesRef.current.add(filename);
        } catch (error) {
          lastError = error;
          failed.push(pending[index]);
        }
      }
      return failed;
    };

    let pending = [...preparedFiles];
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS && pending.length > 0; attempt++) {
      try {
        pending = await uploadPass(pending);
      } catch (error) {
        // presignUpload itself failed: every file is still pending.
        lastError = error;
      }

      if (pending.length === 0) {
        break;
      }
      if (attempt < MAX_UPLOAD_ATTEMPTS) {
        const delay = Math.min(
          Math.round(UPLOAD_RETRY_BASE_DELAY_MS * UPLOAD_RETRY_BACKOFF_FACTOR ** (attempt - 1)),
          UPLOAD_RETRY_MAX_DELAY_MS
        );
        setProcessingLabel(
          `Upload failed — retry ${attempt + 1} of ${MAX_UPLOAD_ATTEMPTS} in ` +
            `${Math.round(delay / 1000)}s (${pending.length} photo${
              pending.length === 1 ? '' : 's'
            } left)...`
        );
        await sleep(delay);
      }
    }

    if (pending.length > 0) {
      setIsProcessing(false);
      setProcessingLabel('');
      console.warn('Upload incomplete:', lastError);
      setErrorToast(
        `${uploadedFilenamesRef.current.size} of ${photos.length} uploaded. Tap Done to retry the rest.`
      );
      setTimeout(() => setErrorToast(null), TOAST_DURATION_MS);
      return;
    }

    setIsProcessing(false);
    setProcessingLabel('');
    uploadedFilenamesRef.current.clear();

    setPendingHomeAction({
      type: 'upload-complete',
      message: `Uploaded ${photos.length} photo(s) to /${dateRoot}/${sku}/`,
    });
    router.back();
  };

  // Remote shutter: short press -> capture, long press -> done. The hook only
  // reacts while this screen is focused, so Home's listener doesn't also fire.
  useRemoteTrigger({ onCapture: handleCapture, onDone: handleDone });

  const squareSize = previewSize.width;
  const barHeight = Math.max((previewSize.height - squareSize) / 2, 0);

  return (
    <CameraPermissionGate permission={permission} requestPermission={requestPermission}>
      <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <Pressable onPress={handleDone} disabled={photos.length === 0 || isProcessing}>
          <Text
            style={[
              styles.doneButtonText,
              (photos.length === 0 || isProcessing) && styles.doneButtonTextDisabled,
            ]}
          >
            Done
          </Text>
        </Pressable>
      </View>

      <View style={styles.previewContainer} onLayout={handlePreviewLayout}>
        <GestureDetector gesture={pinchGesture}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            ratio="1:1"
            pictureSize="photo"
            zoom={zoom}
            selectedLens={lens}
            onCameraReady={handleCameraReady}
          />
        </GestureDetector>
        {previewSize.height > 0 && (
          <>
            <View style={[styles.letterboxBar, { top: 0, height: barHeight }]} />
            <View style={[styles.letterboxBar, { bottom: 0, height: barHeight }]} />
          </>
        )}
        {ENABLE_CAMERA_TUNING && tuning.available && (
          <CameraTuningControls
            settings={tuning.settings}
            info={tuning.info}
            error={tuning.error}
            onChange={tuning.update}
          />
        )}
      </View>

      {/* Fixed-height slot reserved even when empty, so the camera preview area
          (and the square viewport centered in it) never shifts when the first
          thumbnail appears. */}
      <View style={styles.thumbnailStrip}>
        {photos.length > 0 && (
          <ScrollView
            ref={thumbnailStripRef}
            horizontal
            contentContainerStyle={styles.thumbnailStripContent}
            showsHorizontalScrollIndicator={true}
          >
            {photos.map((photo) => (
              <Pressable
                key={photo.id}
                style={styles.thumbnailWrapper}
                onPress={() => handleDeletePhoto(photo.id)}
                disabled={isProcessing}
              >
                <Image source={{ uri: photo.uri }} style={styles.thumbnail} resizeMode="cover" />
                <View style={styles.deleteBadge}>
                  <Text style={styles.deleteBadgeText}>×</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.photoCount}>
          {existingCount + photos.length}/{MAX_PHOTOS}
        </Text>
        <Pressable
          style={[
            styles.shutterButton,
            (existingCount + photos.length >= MAX_PHOTOS || isProcessing) &&
              styles.shutterButtonDisabled,
          ]}
          onPress={handleCapture}
          disabled={existingCount + photos.length >= MAX_PHOTOS || isProcessing}
        />
        <View style={styles.bottomBarSpacer} />
      </View>

      {isProcessing && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.processingText}>{processingLabel}</Text>
        </View>
      )}

      <Toast message={errorToast ?? ''} type="error" visible={errorToast !== null} />
      </View>
    </CameraPermissionGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  doneButtonText: {
    color: '#0a84ff',
    fontSize: 17,
    fontWeight: '600',
  },
  doneButtonTextDisabled: {
    color: 'rgba(10,132,255,0.4)',
  },
  previewContainer: {
    flex: 1,
  },
  letterboxBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#000',
  },
  thumbnailStrip: {
    height: THUMBNAIL_SIZE + 16,
  },
  thumbnailStripContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  thumbnailWrapper: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: 6,
  },
  deleteBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBadgeText: {
    fontSize: 14,
    lineHeight: 14,
    color: '#000',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  photoCount: {
    color: '#fff',
    fontSize: 15,
    width: 80,
  },
  bottomBarSpacer: {
    width: 80,
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#208AEF',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  shutterButtonDisabled: {
    backgroundColor: '#5b7c99',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  processingText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
