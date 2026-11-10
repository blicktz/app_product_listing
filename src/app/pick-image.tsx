import { useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { labelSku } from '@/lib/pick/derive';
import { imageUri } from '@/lib/pick/images';
import { usePickData } from '@/lib/pick/usePick';
import { useScanHandler } from '@/lib/pick/useScanHandler';

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 280;
const SWIPE_CLOSE_PX = 90;

// Full-screen zoom viewer for an item's cover image. Pinch / double-tap to
// zoom (native iOS ScrollView zooming), drag to pan, swipe down to close.
export default function PickImageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ lineKey: string; boxId?: string }>();
  const lineKey = String(params.lineKey ?? '');
  const boxId = params.boxId ? String(params.boxId) : null;
  const { states } = usePickData();
  const state = states.get(lineKey);

  const [zoom, setZoom] = useState(1);
  // Changing the key remounts the ScrollView at the new zoomScale.
  const [zoomKey, setZoomKey] = useState(0);
  const currentZoom = useRef(1);
  const lastTap = useRef(0);

  const close = () => router.back();
  const { banner, dismiss, handleScan } = useScanHandler({
    boxId,
    preferLineKey: lineKey,
    openBoxMode: 'push',
    allowBoxScan: false,
    onPicked: () => setTimeout(close, 600),
  });

  if (!state) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Pressable style={styles.close} onPress={close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
    );
  }

  const { line } = state;
  const thumb = imageUri(line.image_url ?? line.image_url_full);
  const full = imageUri(line.image_url_full);
  const imageHeight = height * 0.62;

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      const next = currentZoom.current > 1.05 ? 1 : DOUBLE_TAP_ZOOM;
      currentZoom.current = next;
      setZoom(next);
      setZoomKey((k) => k + 1);
    } else {
      lastTap.current = now;
    }
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { zoomScale, contentOffset } = event.nativeEvent;
    currentZoom.current = zoomScale ?? currentZoom.current;
    if ((zoomScale ?? 1) <= 1.01 && contentOffset.y < -SWIPE_CLOSE_PX) {
      close();
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScanCapture onScan={handleScan} />
      <View style={styles.topBar}>
        <Pressable style={styles.close} onPress={close} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
      <ScanBanner banner={banner} onDismiss={dismiss} />

      <ScrollView
        key={zoomKey}
        style={styles.zoomArea}
        contentContainerStyle={{ width, height: imageHeight }}
        maximumZoomScale={MAX_ZOOM}
        minimumZoomScale={1}
        zoomScale={zoom}
        centerContent
        bouncesZoom
        alwaysBounceVertical
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onScrollEndDrag={handleScrollEnd}
        onMomentumScrollEnd={handleScrollEnd}
        scrollEventThrottle={16}
      >
        <Pressable style={{ width, height: imageHeight }} onPress={handleTap}>
          {thumb ? <Image source={{ uri: thumb }} style={styles.image} resizeMode="contain" /> : null}
          {full && full !== thumb ? (
            <Image source={{ uri: full }} style={[styles.image, styles.overlay]} resizeMode="contain" />
          ) : null}
        </Pressable>
      </ScrollView>

      <View style={styles.caption}>
        <View style={styles.captionRow}>
          <Text style={styles.sku}>{labelSku(line.sku)}</Text>
          <Text style={styles.qty}>×{Math.max(1, line.qty)}</Text>
        </View>
        <Text style={styles.title}>{line.title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 20,
  },
  zoomArea: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  caption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sku: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  qty: {
    color: '#fbbf24',
    fontSize: 20,
    fontWeight: '700',
  },
  title: {
    color: '#e5e5ea',
    fontSize: 16,
  },
});
