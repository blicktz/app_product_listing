import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function PullLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerTransparent: true,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Pull', headerLargeTitleEnabled: true, headerShadowVisible: false }} />
      <Stack.Screen name="box/[boxId]" options={{ title: '' }} />
      <Stack.Screen name="missing/[lineKey]" options={{ title: "Can't Find" }} />
    </Stack>
  );
}
