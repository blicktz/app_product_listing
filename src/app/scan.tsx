import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { setPendingHomeAction } from '@/lib/pendingHomeAction';
import { selectCloseFocusLens } from '@/lib/cameraLens';
import { CameraPermissionGate } from '@/components/CameraPermissionGate';

// Kept at module scope, and created eagerly (not at scan time), so the mp3
// is already decoded and ready by the time a barcode is actually detected —
// creating the player fresh at scan time was the source of an audible delay.
// Module scope also means it survives the screen unmounting right after
// router.back(), rather than being a component ref that goes away with it.
let dingPlayer: ReturnType<typeof createAudioPlayer> | null = null;

function getDingPlayer() {
  if (!dingPlayer) {
    dingPlayer = createAudioPlayer(require('../../assets/sounds/ding.mp3'));
  }
  return dingPlayer;
}

function playDing() {
  const player = getDingPlayer();
  player.seekTo(0).then(() => player.play());
}

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const hasScanned = useRef(false);
  const cameraRef = useRef<CameraView>(null);

  // A SKU barcode is held close to the lens; since SDK 57 expo-camera's default
  // wide-angle lens can't focus that near on this iPhone. Switch to a virtual
  // multi-camera lens so iOS auto-engages the ultra-wide for close focus.
  const [lens, setLens] = useState<string>();

  const handleCameraReady = useCallback(async () => {
    const lenses = (await cameraRef.current?.getAvailableLensesAsync()) ?? [];
    const pick = selectCloseFocusLens(lenses);
    if (pick) {
      setLens(pick);
    }
  }, []);

  useEffect(() => {
    // iOS audio defaults to respecting the hardware silent switch; the scan
    // confirmation sound should still play even if it's flipped to silent.
    setAudioModeAsync({ playsInSilentMode: true });
    // Preload/decode the ding now, while the user is still aiming the
    // camera, instead of at the moment a barcode is actually detected.
    getDingPlayer();
  }, []);

  const handleClose = () => {
    router.back();
  };

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (hasScanned.current) {
      return;
    }
    hasScanned.current = true;

    playDing();
    setPendingHomeAction({ type: 'sku-scanned', sku: result.data });
    router.back();
  };

  return (
    <CameraPermissionGate permission={permission} requestPermission={requestPermission}>
      <View style={styles.container}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          selectedLens={lens}
          barcodeScannerSettings={{ barcodeTypes: ['code128', 'code39', 'code93', 'codabar'] }}
          onBarcodeScanned={handleBarcodeScanned}
          onCameraReady={handleCameraReady}
        />

        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <Pressable style={styles.closeButton} onPress={handleClose}>
            <Text style={styles.closeButtonText}>×</Text>
          </Pressable>
        </View>

        <View style={styles.centerContent} pointerEvents="none">
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
          <Text style={styles.hintText}>Point camera at barcode</Text>
        </View>
      </View>
    </CameraPermissionGate>
  );
}

const CORNER_SIZE = 28;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 24,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  scanFrame: {
    width: '80%',
    aspectRatio: 2.2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#fff',
  },
  cornerTopLeft: {
    top: -1,
    left: -1,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
  },
  cornerTopRight: {
    top: -1,
    right: -1,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 12,
  },
  cornerBottomLeft: {
    bottom: -1,
    left: -1,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 12,
  },
  cornerBottomRight: {
    bottom: -1,
    right: -1,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 12,
  },
  hintText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
});
