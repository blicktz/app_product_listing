# Dark mode: white navigation headers

**Status:** Fixed 2026-11-16: navigation theme in `src/app/_layout.tsx` (`navigationTheme()` in `src/lib/theme.ts`), translucent headers on every stack, and the Mac Server sheet moved off hard-coded light colours. Same bug was found and fixed in `st_auction_app` (Nov 2026).

## Symptom

With the iPhone in dark mode, some screens have a **white bar at the top** (or a black title on a
black background), while the rest of the screen is dark. Typical pattern:

- Large-title tab screens (Shoot / Stow / Pick / Pack) look fine at the top, but the collapsed
  bar after scrolling and the title colour can be wrong.
- Screens with a **standard (small) header** show a white bar in dark mode:
  `listing-config` (Listing Config), `upload-queue` (Upload Queue), `pick-settings`
  (Mac Server sheet), `stow/summary/[sessionId]` (Stow Finished), `pick/missing/[lineKey]`
  (Can't Find), and the `box` / `package` pages.

## Root cause

The navigation headers are not drawn by our screens. They are native `UINavigationBar`s that
`react-native-screens` creates, and they take their colours from the **React Navigation theme**
(`theme.colors.card` for the bar, `theme.colors.text` for the title).

This app never sets a theme. expo-router then uses React Navigation's **`DefaultTheme`, which
is always light**: `card` is white and `text` is black, whatever the phone's appearance is.
`"userInterfaceStyle": "automatic"` in `app.json` and the `PlatformColor` values in
`src/lib/theme.ts` don't reach the header, so:

- A standard header gets an opaque **white** bar in dark mode.
- A large-title header is transparent at rest, so it shows the (correctly dark) screen behind
  it and *looks* right. But its title can come out black-on-black, and the bar turns light again
  once content scrolls under it.

### Two tempting fixes that don't work

1. **`headerStyle: { backgroundColor: colors.background }`** (a `PlatformColor`).
   Header options are converted to plain colours for the native bar, and a `PlatformColor`
   doesn't survive that, so it falls back to white (and the title to black).
2. **A solid colour per scheme** (`'#000'` in dark mode).
   This removes the white, but the bar becomes **opaque**. It no longer looks like the tab
   screens, where content blurs through the bar as you scroll.

Patching colours screen by screen also leaves every other header (sheets, future screens)
still on the light theme.

## Proper fix

Give the navigation system a theme that follows the phone's appearance, once, in the root
layout. Every header, back button and sheet then picks the right colours, including screens
added later.

`src/app/_layout.tsx`:

```tsx
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const scheme = useColorScheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  // Match the app's systemGroupedBackground / label (plain values: headers can't take PlatformColor).
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: scheme === 'dark' ? '#000000' : '#F2F2F7',
      text: scheme === 'dark' ? '#FFFFFF' : '#000000',
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }}>{/* … screens unchanged … */}</Stack>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
```

Notes:

- `ThemeProvider`, `DarkTheme` and `DefaultTheme` come from `expo-router` (it re-exports React
  Navigation's). No new dependency.
- `useColorScheme()` re-renders when the phone switches appearance, so the theme follows live.
- Keep `contentStyle: { backgroundColor: colors.background }` on the stacks; screen bodies can
  keep using `PlatformColor`. Only **header options** need plain colours.
- Remove any `headerStyle.backgroundColor` / `headerTitleStyle.color` that were added as
  workarounds; the theme covers them.

### Optional: translucent bar on pushed screens

To make a pushed screen's bar blur its content like the tab screens do (instead of an opaque
bar), let the content scroll under it:

```tsx
<Stack.Screen name="listing-config" options={{ headerShown: true, title: 'Listing Config', headerTransparent: true }} />
```

The screen's `ScrollView` must use `contentInsetAdjustmentBehavior="automatic"` (ours already
do), so content starts below the bar at rest and slides under it when scrolled. Only use this on
screens whose content is in a `ScrollView`; otherwise the top of the content hides under the bar.

## How to verify

1. Rebuild (`make`), then switch the phone to dark mode (Control Centre or Settings > Display).
2. Open each screen listed under *Symptom*: the bar should match the dark screen, the title
   should be white, and the status-bar text white.
3. Scroll a tab screen and a pushed screen: the bar stays dark, and content blurs through it.
4. Switch back to light mode with the app open: headers should follow without a relaunch.
5. Open the Mac Server sheet in both modes: sheet header and title should match the sheet.

## Reference

Fixed in `st_auction_app` in `src/app/_layout.tsx` (navigation theme + `headerTransparent` on the
lot detail screen) and `src/lib/theme.ts` (`headerColors()`, plain colour values per scheme).
