import { useRef } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const cameraRef = useRef<CameraView>(null);

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

  const handleCapture = async () => {
    const photo = await cameraRef.current?.takePictureAsync();
    if (!photo) {
      return;
    }

    let permissionToSave = mediaPermission;
    if (!permissionToSave?.granted) {
      permissionToSave = await requestMediaPermission();
    }

    if (!permissionToSave.granted) {
      Alert.alert('Captured', `${photo.uri}\n\n(Photos permission denied — not saved to library)`);
      return;
    }

    await MediaLibrary.saveToLibraryAsync(photo.uri);
    Alert.alert('Saved to Photos', photo.uri);
  };

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.controls}>
        <Pressable style={styles.shutterButton} onPress={handleCapture} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
});
