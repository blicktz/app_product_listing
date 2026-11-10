import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui';
import { type } from '@/lib/theme';
import type { Banner } from '@/lib/pick/useScanHandler';

const TONES: Record<Banner['tone'], { bg: string; fg: string; icon: SFSymbol }> = {
  success: { bg: '#248A3D', fg: '#ffffff', icon: 'checkmark.circle.fill' },
  warning: { bg: '#FFB340', fg: '#1c1c1e', icon: 'exclamationmark.triangle.fill' },
  error: { bg: '#D70015', fg: '#ffffff', icon: 'xmark.octagon.fill' },
};

/** Standard iOS navigation bar, below the status bar. */
const NAV_BAR_HEIGHT = 44;

/**
 * Floating scan result at the top of the screen. The Pick screens draw from the
 * very top of the display, and the navigation bar's buttons are native views
 * drawn above anything here, so it sits below the status bar and the bar.
 * It covers the large title while shown.
 */
export function ScanBanner({ banner, onDismiss }: { banner: Banner | null; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  if (!banner) {
    return null;
  }
  const tone = TONES[banner.tone];
  return (
    <View style={[styles.wrap, { top: insets.top + NAV_BAR_HEIGHT + 8 }]} pointerEvents="box-none">
      <Pressable
        style={[styles.banner, { backgroundColor: tone.bg }]}
        onPress={banner.actions ? undefined : onDismiss}
      >
        <View style={styles.top}>
          <Icon name={tone.icon} color={tone.fg} size={24} weight="semibold" />
          <View style={styles.text}>
            <Text style={[styles.title, { color: tone.fg }]}>{banner.title}</Text>
            {banner.detail ? <Text style={[styles.detail, { color: tone.fg }]}>{banner.detail}</Text> : null}
          </View>
        </View>
        {banner.actions ? (
          <View style={styles.actions}>
            {banner.actions.map((action) => (
              <Pressable
                key={action.label}
                style={({ pressed }) => [
                  styles.action,
                  action.primary ? styles.actionPrimary : null,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={action.onPress}
              >
                <Text style={[styles.actionText, action.primary ? styles.actionTextPrimary : null]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 10,
  },
  banner: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.headline,
  },
  detail: {
    ...type.subheadline,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  action: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  actionPrimary: {
    backgroundColor: '#1c1c1e',
  },
  actionText: {
    ...type.subheadline,
    fontWeight: '600',
    color: '#1c1c1e',
  },
  actionTextPrimary: {
    color: '#ffffff',
  },
});
