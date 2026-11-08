import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { startUploadQueue } from '@/lib/uploadQueue/runner';

// Resume anything left in the on-disk upload queue (from a previous run, a
// crash, or an offline stretch) as soon as the app launches.
startUploadQueue();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="camera" options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="listing-config"
          options={{ headerShown: true, title: 'Listing Config', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="upload-queue"
          options={{ headerShown: true, title: 'Upload Queue', headerBackTitle: 'Back' }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}
