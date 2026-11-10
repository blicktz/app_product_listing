import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function StowLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Stow', headerLargeTitleEnabled: true, headerShadowVisible: false }}
      />
      {/* An open box is left with Finish, so there's no way back past it. */}
      <Stack.Screen name="box" options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="summary/[sessionId]" options={{ title: 'Stow Finished' }} />
    </Stack>
  );
}
