import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePickData } from '@/lib/pick/usePick';

// Bottom nav: the system iOS tab bar (Liquid Glass on iOS 26+).
// Shoot = photo capture (the original home screen); Pick = order picking.
export default function TabsLayout() {
  const { states } = usePickData();
  let toPick = 0;
  for (const s of states.values()) {
    if (s.status !== 'missing') {
      toPick += Math.max(1, s.line.qty) - s.pickedQty;
    }
  }

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'camera', selected: 'camera.fill' }} md="photo_camera" />
        <NativeTabs.Trigger.Label>Shoot</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pick">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'shippingbox', selected: 'shippingbox.fill' }}
          md="package_2"
        />
        <NativeTabs.Trigger.Label>Pick</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={toPick === 0}>{String(toPick)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
