import { useLocalSearchParams, useRouter } from 'expo-router';
import { ImageZoomEmpty, ImageZoomView } from '@/components/ImageZoomView';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { skuText } from '@/lib/pack/scan';
import { packImages, setOpenKey } from '@/lib/pack/store';
import { usePackData } from '@/lib/pack/usePack';
import { usePackScan } from '@/lib/pack/usePackScan';

// Full-screen zoom viewer for a pack item's photo. A scan here is handled as
// on the Package screen below it (which follows the open package), then the
// viewer closes.
export default function PackImageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ orderKey: string; seq: string }>();
  const snap = usePackData();
  const packageKey = snap.board.orderIndex.get(String(params.orderKey ?? ''));
  const item = packageKey
    ? snap.board.byKey
        .get(packageKey)
        ?.items.find((i) => i.item.order_key === params.orderKey && String(i.item.seq) === params.seq)
    : undefined;

  const close = () => router.back();
  const { banner, dismiss, handleScan } = usePackScan({ openPackage: setOpenKey, autoRefresh: false });

  if (!item) {
    return <ImageZoomEmpty onClose={close} />;
  }

  const onScan = (code: string) => {
    handleScan(code);
    setTimeout(close, 600);
  };

  return (
    <ImageZoomView
      thumb={packImages.uri(item.item.image_url ?? item.item.image_url_full)}
      full={packImages.uri(item.item.image_url_full)}
      sku={skuText(item.item.sku)}
      badge={item.item.qty > 1 ? `×${item.item.qty}` : undefined}
      title={item.item.title}
      onClose={close}
    >
      <ScanCapture onScan={onScan} />
      <ScanBanner banner={banner} onDismiss={dismiss} />
    </ImageZoomView>
  );
}
