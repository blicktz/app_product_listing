import { useEffect, useRef, useState } from 'react';
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
import { useRemoteTrigger } from '@/lib/useRemoteTrigger';
import { setPendingHomeAction } from '@/lib/pendingHomeAction';
import { Toast } from '@/components/Toast';
import { CameraPermissionGate } from '@/components/CameraPermissionGate';

const TOAST_DURATION_MS = 3000;
const MAX_UPLOAD_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 2000;
const UPLOAD_TIMEOUT_MS = 30000;

type SessionPhoto = {
  id: string;
  uri: string;
  width: number;
  height: number;
};

const THUMBNAIL_SIZE = 64;
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

  const [photos, setPhotos] = useState<SessionPhoto[]>([]);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0);
  const zoomStartRef = useRef(0);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      zoomStartRef.current = zoom;
    })
    .onUpdate((event) => {
      const next = zoomStartRef.current + (event.scale - 1) * 0.75;
      setZoom(Math.min(Math.max(next, 0), 1));
    });

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
    if (existingCount + photos.length >= MAX_PHOTOS) {
      return;
    }

    const photo = await cameraRef.current?.takePictureAsync();
    if (!photo) {
      return;
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
  };

  const handleDone = async () => {
    if (isProcessing || photos.length === 0) {
      return;
    }

    setIsProcessing(true);

    let permissionToSave = mediaPermission;
    if (!permissionToSave?.granted) {
      permissionToSave = await requestMediaPermission();
    }

    const sessionDir = new Directory(Paths.cache, 'sessions', dateRoot, sku);
    sessionDir.create({ intermediates: true, idempotent: true });

    const preparedFiles: { filename: string; localUri: string }[] = [];

    for (let index = 0; index < photos.length; index++) {
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

      if (permissionToSave.granted) {
        await MediaLibrary.saveToLibraryAsync(cropped.uri).catch(() => {});
      }

      const nn = String(startingNumber + index).padStart(2, '0');
      const filename = `${sku}_${nn}.jpg`;
      const destination = new File(sessionDir, filename);
      if (destination.exists) {
        destination.delete();
      }
      new File(cropped.uri).copy(destination);

      preparedFiles.push({ filename, localUri: destination.uri });
    }

    // One full pass over the batch: presign, then PUT each photo. Throws on the
    // first failure so the retry loop below can run it again.
    const uploadPreparedFiles = async () => {
      const { uploadUrls } = await presignUpload(
        dateRoot,
        sku,
        preparedFiles.map((file) => file.filename)
      );

      for (let index = 0; index < preparedFiles.length; index++) {
        const { filename, localUri } = preparedFiles[index];
        setProcessingLabel(`Uploading photo ${index + 1} of ${preparedFiles.length}...`);

        const uploadUrl = uploadUrls[filename];
        if (!uploadUrl) {
          throw new Error(`No upload URL returned for ${filename}`);
        }

        const fileResponse = await fetch(localUri);
        const blob = await fileResponse.blob();

        // Abort a PUT that stalls past the timeout so a dropped connection
        // counts as a failed attempt instead of hanging the spinner.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        let putResponse: Response;
        try {
          putResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: blob,
            headers: { 'Content-Type': 'image/jpeg' },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!putResponse.ok) {
          throw new Error(`Upload failed for ${filename} (${putResponse.status})`);
        }
      }
    };

    let uploadError: unknown = null;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
      try {
        await uploadPreparedFiles();
        uploadError = null;
        break;
      } catch (error) {
        uploadError = error;
        if (attempt < MAX_UPLOAD_ATTEMPTS) {
          setProcessingLabel(
            `Upload failed — retrying (${attempt + 1}/${MAX_UPLOAD_ATTEMPTS})...`
          );
          await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_DELAY_MS));
        }
      }
    }

    if (uploadError) {
      setIsProcessing(false);
      setProcessingLabel('');
      const message =
        uploadError instanceof Error
          ? `Upload failed after ${MAX_UPLOAD_ATTEMPTS} tries: ${uploadError.message}`
          : 'Upload failed. Tap Done to retry.';
      setErrorToast(message);
      setTimeout(() => setErrorToast(null), TOAST_DURATION_MS);
      return;
    }

    setIsProcessing(false);
    setProcessingLabel('');

    setPendingHomeAction({
      type: 'upload-complete',
      message: `Uploaded ${preparedFiles.length} photo(s) to /${dateRoot}/${sku}/`,
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
            pictureSize="Photo"
            zoom={zoom}
          />
        </GestureDetector>
        {previewSize.height > 0 && (
          <>
            <View style={[styles.letterboxBar, { top: 0, height: barHeight }]} />
            <View style={[styles.letterboxBar, { bottom: 0, height: barHeight }]} />
          </>
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
    ...StyleSheet.absoluteFillObject,
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
