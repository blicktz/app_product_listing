import { useLocalSearchParams, useRouter } from 'expo-router';
import { ImageZoomEmpty, ImageZoomView } from '@/components/ImageZoomView';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { labelSku } from '@/lib/pick/derive';
import { imageUri } from '@/lib/pick/images';
import { usePickData } from '@/lib/pick/usePick';
import { useScanHandler } from '@/lib/pick/useScanHandler';

// Full-screen zoom viewer for a pick line's cover image. A scan here still
// picks (from the box the viewer was opened from) and closes the viewer.
export default function PickImageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lineKey: string; boxId?: string }>();
  const lineKey = String(params.lineKey ?? '');
  const boxId = params.boxId ? String(params.boxId) : null;
  const { states } = usePickData();
  const state = states.get(lineKey);

  const close = () => router.back();
  const { banner, dismiss, handleScan } = useScanHandler({
    boxId,
    preferLineKey: lineKey,
    openBoxMode: 'push',
    allowBoxScan: false,
    onPicked: () => setTimeout(close, 600),
  });

  if (!state) {
    return <ImageZoomEmpty onClose={close} />;
  }

  const { line } = state;
  return (
    <ImageZoomView
      thumb={imageUri(line.image_url ?? line.image_url_full)}
      full={imageUri(line.image_url_full)}
      sku={labelSku(line.sku)}
      badge={`×${Math.max(1, line.qty)}`}
      title={line.title}
      onClose={close}
    >
      <ScanCapture onScan={handleScan} />
      <ScanBanner banner={banner} onDismiss={dismiss} />
    </ImageZoomView>
  );
}
