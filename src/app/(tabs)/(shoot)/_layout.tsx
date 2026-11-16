import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function ShootLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        // Content scrolls under a translucent bar, as on the large-title screens.
        headerTransparent: true,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Shoot', headerLargeTitleEnabled: true, headerShadowVisible: false }}
      />
    </Stack>
  );
}
