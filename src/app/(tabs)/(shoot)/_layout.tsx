import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function ShootLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
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
