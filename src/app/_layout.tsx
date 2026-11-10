import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { startUploadQueue } from '@/lib/uploadQueue/runner';
import { startPickStore } from '@/lib/pick/store';

// Resume anything left in the on-disk upload queue (from a previous run, a
// crash, or an offline stretch) as soon as the app launches.
startUploadQueue();
// Load the last pick list and send any pick events still queued on the phone.
startPickStore();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Shoot / Pick bottom nav. Screens below are pushed above it, full screen. */}
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="camera" options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="listing-config"
          options={{ headerShown: true, title: 'Listing Config', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="upload-queue"
          options={{ headerShown: true, title: 'Upload Queue', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="pick-image"
          options={{ presentation: 'fullScreenModal', animation: 'fade' }}
        />
        <Stack.Screen
          name="pick-settings"
          options={{ headerShown: true, presentation: 'modal', title: 'Mac Server' }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}
