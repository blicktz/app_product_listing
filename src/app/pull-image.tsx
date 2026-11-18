import { useLocalSearchParams, useRouter } from 'expo-router';
import { ImageZoomEmpty, ImageZoomView } from '@/components/ImageZoomView';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { countLabel } from '@/lib/pull/derive';
import { pullImageUri } from '@/lib/pull/images';
import { usePullData } from '@/lib/pull/usePull';
import { usePullScanHandler } from '@/lib/pull/useScanHandler';

// Full-screen zoom of a pull line's photo. A scan here still pulls (from the
// box the viewer was opened from) and closes the viewer. Pull's own route, so
// it can never count a scan as a pick.
export default function PullImageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lineKey: string; boxId?: string }>();
  const lineKey = String(params.lineKey ?? '');
  const boxId = params.boxId ? String(params.boxId) : null;
  const { states } = usePullData();
  const state = states.get(lineKey);

  const close = () => router.back();
  const { banner, dismiss, handleScan } = usePullScanHandler({
    boxId,
    preferLineKey: lineKey,
    openBoxMode: 'push',
    allowBoxScan: false,
    onPulled: () => setTimeout(close, 600),
  });

  if (!state) {
    return <ImageZoomEmpty onClose={close} />;
  }

  return (
    <ImageZoomView
      thumb={pullImageUri(state.image_url ?? state.image_url_full)}
      full={pullImageUri(state.image_url_full)}
      sku={state.sku}
      badge={`PULL · ${countLabel(state)}`}
      title={state.title}
      onClose={close}
    >
      <ScanCapture onScan={handleScan} />
      <ScanBanner banner={banner} onDismiss={dismiss} />
    </ImageZoomView>
  );
}
