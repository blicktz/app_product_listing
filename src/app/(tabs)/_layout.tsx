import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePackData } from '@/lib/pack/usePack';
import { usePickData } from '@/lib/pick/usePick';
import { summarize, useUploadQueue } from '@/lib/uploadQueue/useUploadQueue';

// Bottom nav: the system iOS tab bar (Liquid Glass on iOS 26+).
// Shoot = photo capture (the original home screen); Stow = putting products
// away into boxes; Pick = order picking; Pack = scan-checking each package.
export default function TabsLayout() {
  const { states } = usePickData();
  let toPick = 0;
  for (const s of states.values()) {
    if (s.status !== 'missing') {
      toPick += Math.max(1, s.line.qty) - s.pickedQty;
    }
  }

  // Packages still to pack; cancelled ones aren't work to do.
  const { board } = usePackData();
  const toPack = board.packages.filter((p) => !p.packedAt && !p.cancelled).length;

  const { jobs } = useUploadQueue();
  const { attention } = summarize(jobs);

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(shoot)">
        <NativeTabs.Trigger.Icon sf={{ default: 'camera', selected: 'camera.fill' }} md="photo_camera" />
        <NativeTabs.Trigger.Label>Shoot</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={attention === 0}>{String(attention)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      {/* An open box is left with Finish, so re-tapping the tab must not pop it. */}
      <NativeTabs.Trigger name="stow" disablePopToTop>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'tray.and.arrow.down', selected: 'tray.and.arrow.down.fill' }}
          md="inventory_2"
        />
        <NativeTabs.Trigger.Label>Stow</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pick">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'shippingbox', selected: 'shippingbox.fill' }}
          md="package_2"
        />
        <NativeTabs.Trigger.Label>Pick</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={toPick === 0}>{String(toPick)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pack">
        <NativeTabs.Trigger.Icon sf={{ default: 'archivebox', selected: 'archivebox.fill' }} md="inventory" />
        <NativeTabs.Trigger.Label>Pack</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={toPack === 0}>{String(toPack)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
