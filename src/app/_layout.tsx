import { useColorScheme } from 'react-native';
import { Stack, ThemeProvider } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { startUploadQueue } from '@/lib/uploadQueue/runner';
import { startPickStore } from '@/lib/pick/store';
import { startShootLog } from '@/lib/shootLog/store';
import { startStowStore } from '@/lib/stow/store';
import { startPackStore } from '@/lib/pack/store';
import { navigationTheme } from '@/lib/theme';

// Load the last pick list and send any pick events still queued on the phone.
// First, because everything below uses the Mac address and settings it loads.
startPickStore();
// Before the queue, which writes to this log.
startShootLog();
// Resume anything left in the on-disk upload queue (from a previous run, a
// crash, or an offline stretch) as soon as the app launches.
startUploadQueue();
// Same as Pick for stow events.
startStowStore();
// And for pack scans.
startPackStore();

export default function RootLayout() {
  // Follows the phone's appearance live, so every header and sheet matches it.
  const scheme = useColorScheme();

  return (
    <ThemeProvider value={navigationTheme(scheme)}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* A shown header is translucent: each screen scrolls under it, like the tab screens. */}
        <Stack screenOptions={{ headerShown: false, headerTransparent: true }}>
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
            name="pack-image"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen
            name="pick-settings"
            options={{ headerShown: true, presentation: 'modal', title: 'Mac Server' }}
          />
        </Stack>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
