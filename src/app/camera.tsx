import { useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';
import { presignUpload } from '@/lib/uploadApi';

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

  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const cameraRef = useRef<CameraView>(null);
  const nextPhotoId = useRef(0);

  const [photos, setPhotos] = useState<SessionPhoto[]>([]);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>We need your permission to use the camera</Text>
        <Pressable style={styles.grantButton} onPress={requestPermission}>
          <Text style={styles.grantButtonText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  const handlePreviewLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewSize({ width, height });
  };

  const handleCapture = async () => {
    if (photos.length >= MAX_PHOTOS) {
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

    const startingNumber = Number(startNumber) || 1;
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

    try {
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
        const putResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': 'image/jpeg' },
        });

        if (!putResponse.ok) {
          throw new Error(`Upload failed for ${filename} (${putResponse.status})`);
        }
      }
    } catch (error) {
      setIsProcessing(false);
      setProcessingLabel('');
      Alert.alert(
        'Upload Failed',
        error instanceof Error
          ? error.message
          : 'Something went wrong uploading photos. Tap Done to retry.'
      );
      return;
    }

    setIsProcessing(false);
    setProcessingLabel('');

    Alert.alert(
      'Upload Complete',
      `${preparedFiles.length} photo(s) uploaded to R2 at /${dateRoot}/${sku}/`
    );
    router.back();
  };

  const squareSize = previewSize.width;
  const barHeight = Math.max((previewSize.height - squareSize) / 2, 0);

  return (
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
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          ratio="1:1"
          pictureSize="Photo"
        />
        {previewSize.height > 0 && (
          <>
            <View style={[styles.letterboxBar, { top: 0, height: barHeight }]} />
            <View style={[styles.letterboxBar, { bottom: 0, height: barHeight }]} />
          </>
        )}
      </View>

      {photos.length > 0 && (
        <ScrollView
          horizontal
          style={styles.thumbnailStrip}
          contentContainerStyle={styles.thumbnailStripContent}
          showsHorizontalScrollIndicator={false}
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

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.photoCount}>
          {photos.length}/{MAX_PHOTOS}
        </Text>
        <Pressable
          style={[
            styles.shutterButton,
            (photos.length >= MAX_PHOTOS || isProcessing) && styles.shutterButtonDisabled,
          ]}
          onPress={handleCapture}
          disabled={photos.length >= MAX_PHOTOS || isProcessing}
        />
        <View style={styles.bottomBarSpacer} />
      </View>

      {isProcessing && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.processingText}>{processingLabel}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  message: {
    textAlign: 'center',
    fontSize: 16,
  },
  grantButton: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  grantButtonText: {
    color: '#fff',
    fontWeight: '600',
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
    maxHeight: THUMBNAIL_SIZE + 16,
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
