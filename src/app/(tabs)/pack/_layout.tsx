import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function PackLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Pack', headerLargeTitleEnabled: true, headerShadowVisible: false }}
      />
      {/* Shows the open package (pack store); a label scan switches it in place. */}
      <Stack.Screen name="package" options={{ title: '' }} />
    </Stack>
  );
}
