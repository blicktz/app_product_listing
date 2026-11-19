import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function PickLayout() {
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
        options={{ title: 'Pick', headerLargeTitleEnabled: true, headerShadowVisible: false }}
      />
      <Stack.Screen name="box/[boxId]" options={{ title: '' }} />
      <Stack.Screen name="missing/[lineKey]" options={{ title: "Can't Find" }} />
      <Stack.Screen name="whatnot/box/[boxId]" options={{ title: '' }} />
      <Stack.Screen name="whatnot/item/[sku]" options={{ title: '' }} />
      <Stack.Screen
        name="whatnot/shows"
        options={{ title: 'Choose a show', presentation: 'formSheet', headerTransparent: false, sheetAllowedDetents: [0.6, 1] }}
      />
    </Stack>
  );
}
