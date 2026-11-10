import { Stack } from 'expo-router';
import { colors } from '@/lib/pick/theme';

export default function PickLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Pick', headerLargeTitleEnabled: true, headerShadowVisible: false }}
      />
      <Stack.Screen name="box/[boxId]" options={{ title: '' }} />
      <Stack.Screen name="missing/[lineKey]" options={{ title: "Can't Find" }} />
    </Stack>
  );
}
