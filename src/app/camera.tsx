import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import { File } from 'expo-file-system';
import { selectCloseFocusLens } from '@/lib/cameraLens';
import { loadZoom, saveZoom } from '@/lib/cameraZoom';
import { useRemoteTrigger } from '@/lib/useRemoteTrigger';
import { useHardwareShutter } from '@/lib/useHardwareShutter';
import { setPendingHomeAction } from '@/lib/pendingHomeAction';
import { Toast } from '@/components/Toast';
import { CameraPermissionGate } from '@/components/CameraPermissionGate';
import { CameraTuningControls } from '@/components/CameraTuningControls';
import { useCameraTuning } from '@/lib/useCameraTuning';
import type { CaptureMetadata } from '@/lib/photoSidecar';
import { getDeviceInfo } from '../../modules/camera-tuning';
import { ListingPill } from '@/components/ListingPill';
import { UploadQueueBadge } from '@/components/UploadQueueBadge';
import { enqueue, notifyCaptureActivity } from '@/lib/uploadQueue/runner';
import { deleteJobDir, jobDir, newJobId, type UploadJob } from '@/lib/uploadQueue/store';
import {
  CONDITION_COLORS,
  CONDITION_LABELS,
  STORE_COLORS,
  isEbayStore,
  isItemCondition,
  MAX_PHOTOS_BY_STORE,
  type ListingConfig,
} from '@/lib/listingConfig';

// Experimental (camera-tuning-experiment branch): fixed exposure + white balance
// via the local `modules/camera-tuning` native module, so the white backdrop
// stops coming out grey. false = identical behaviour to before.
const ENABLE_CAMERA_TUNING = true;

const TOAST_DURATION_MS = 3000;

type SessionPhoto = {
  id: string;
  uri: string;
  width: number;
  height: number;
  metadata: CaptureMetadata;
};

const THUMBNAIL_SIZE = 64;

function pinchZoom(startZoom: number, scale: number) {
  return Math.min(Math.max(startZoom + (scale - 1) * 0.75, 0), 1);
}
// Only used if the route params carry no valid store, which Home prevents.
const DEFAULT_MAX_PHOTOS = 24;

export default function CameraScreen() {
  const router = useRouter();
  const { sku, dateRoot, startNumber, itemCondition, ebayStore, numberedOffline } =
    useLocalSearchParams<{
      sku: string;
      dateRoot: string;
      startNumber: string;
      itemCondition: string;
      ebayStore: string;
      numberedOffline?: string;
    }>();
  // Snapshotted by Home at Start Capture, which refuses to start without both.
  const listingConfig: ListingConfig | null =
    isItemCondition(itemCondition) && isEbayStore(ebayStore)
      ? { itemCondition, ebayStore }
      : null;
  const maxPhotos = listingConfig ? MAX_PHOTOS_BY_STORE[listingConfig.ebayStore] : DEFAULT_MAX_PHOTOS;
  const insets = useSafeAreaInsets();
  const startingNumber = Number(startNumber) || 1;
  const existingCount = startingNumber - 1;

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const thumbnailStripRef = useRef<ScrollView>(null);
  const nextPhotoId = useRef(0);
  // Synchronous latch so a double Done (tap + remote long-press) can't queue
  // the same session twice.
  const isFinishingRef = useRef(false);

  const [photos, setPhotos] = useState<SessionPhoto[]>([]);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
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
    if (!isCameraReady || existingCount + photos.length >= maxPhotos) {
      return;
    }
    // Hold off the upload queue's cropping work so the shutter stays snappy.
    notifyCaptureActivity();

    // The session is briefly not ready right after mount and again right after
    // the lens switch in handleCameraReady. Swallow the rejection so a
    // remote-shutter press in that window is a no-op, not an unhandled rejection.
    const capturedAt = new Date().toISOString();
    const photo = await cameraRef.current
      ?.takePictureAsync({ exif: true })
      ?.catch((error) => {
        console.warn('takePictureAsync failed:', error);
        return undefined;
      });
    if (!photo) {
      return;
    }
    // Exposure / WB are locked, so the state read right after the shot is the
    // state it was taken with. Null when the native module isn't in the build.
    const device = await getDeviceInfo(lens).catch(() => null);

    setPhotos((current) => [
      ...current,
      {
        id: `photo-${nextPhotoId.current++}`,
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
        metadata: {
          capturedAt,
          zoom,
          lens: lens ?? null,
          exif: photo.exif ?? null,
          device,
          original: { width: photo.width, height: photo.height },
        },
      },
    ]);
  };

  const handleDeletePhoto = (id: string) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) {
        new File(target.uri).delete();
      }
      return current.filter((photo) => photo.id !== id);
    });
  };

  // Leave without uploading: drop the local captures and return Home without a
  // pending action, so Home doesn't advance the SKU number.
  const handleBack = () => {
    const discardAndLeave = () => {
      for (const photo of photos) {
        try {
          new File(photo.uri).delete();
        } catch {
          // Cache file already gone; nothing to clean up.
        }
      }
      router.back();
    };
    if (photos.length === 0) {
      discardAndLeave();
      return;
    }
    Alert.alert(
      'Discard Photos?',
      `${photos.length} photo${photos.length === 1 ? '' : 's'} will be deleted and not uploaded.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: discardAndLeave },
      ]
    );
  };

  // Hand the session to the background upload queue and go straight back Home.
  // The captures are copied into a durable job folder (Documents, not cache)
  // with a manifest first; only once that's on disk are the cache originals
  // deleted, so a failure here leaves the session intact to try again.
  const handleDone = () => {
    if (isFinishingRef.current || photos.length === 0) {
      return;
    }
    isFinishingRef.current = true;

    const jobId = newJobId(sku);
    try {
      const dir = jobDir(jobId);
      dir.create({ intermediates: true, idempotent: true });

      const job: UploadJob = {
        id: jobId,
        createdAt: new Date().toISOString(),
        dateRoot,
        sku,
        listing: listingConfig,
        photos: photos.map((photo, index) => {
          const number = startingNumber + index;
          const rawFile = `raw_${String(number).padStart(2, '0')}.jpg`;
          new File(photo.uri).copySync(new File(dir, rawFile));
          return {
            number,
            rawFile,
            width: photo.width,
            height: photo.height,
            metadata: photo.metadata,
          };
        }),
        numberedOffline: numberedOffline === '1',
        status: 'queued',
        prepared: false,
        collisionChecked: false,
        uploaded: [],
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        completedAt: null,
      };
      enqueue(job);
    } catch (error) {
      console.warn('Could not queue the session:', error);
      try {
        deleteJobDir(jobId);
      } catch {
        // Nothing was written.
      }
      isFinishingRef.current = false;
      setErrorToast('Could not save photos for upload. Tap Done to try again.');
      setTimeout(() => setErrorToast(null), TOAST_DURATION_MS);
      return;
    }

    for (const photo of photos) {
      try {
        new File(photo.uri).delete();
      } catch {
        // Cache copy already gone; the queued copy is what matters.
      }
    }

    setPendingHomeAction({
      type: 'queued',
      message: `Queued ${photos.length} photo${photos.length === 1 ? '' : 's'} for ${sku}`,
    });
    router.back();
  };

  // Remote shutter: short press -> capture, long press -> done. The hook only
  // reacts while this screen is focused, so Home's listener doesn't also fire.
  useRemoteTrigger({ onCapture: handleCapture, onDone: handleDone });
  // Same actions when the remote is paired to the phone itself.
  useHardwareShutter({ mode: 'capture', onCapture: handleCapture, onDone: handleDone });

  const squareSize = previewSize.width;
  const barHeight = Math.max((previewSize.height - squareSize) / 2, 0);

  return (
    <CameraPermissionGate permission={permission} requestPermission={requestPermission}>
      <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <Pressable onPress={handleBack}>
          <Text style={styles.doneButtonText}>Back</Text>
        </Pressable>
        <View style={styles.listingChips}>
          {listingConfig && (
            <>
              <ListingPill
                size="small"
                label={CONDITION_LABELS[listingConfig.itemCondition].toUpperCase()}
                color={CONDITION_COLORS[listingConfig.itemCondition]}
              />
              <ListingPill
                size="small"
                label={listingConfig.ebayStore}
                color={STORE_COLORS[listingConfig.ebayStore]}
              />
            </>
          )}
        </View>
        <Pressable onPress={handleDone} disabled={photos.length === 0}>
          <Text
            style={[styles.doneButtonText, photos.length === 0 && styles.doneButtonTextDisabled]}
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
        {/* Status only: tapping through to the queue would end the session. */}
        <View style={styles.queueBadge} pointerEvents="none">
          <UploadQueueBadge />
        </View>
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
          {existingCount + photos.length}/{maxPhotos}
        </Text>
        <Pressable
          style={[
            styles.shutterButton,
            existingCount + photos.length >= maxPhotos && styles.shutterButtonDisabled,
          ]}
          onPress={handleCapture}
          disabled={existingCount + photos.length >= maxPhotos}
        />
        <View style={styles.bottomBarSpacer} />
      </View>

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
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  listingChips: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
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
  queueBadge: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
