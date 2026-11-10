import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui';
import { usePickSnapshot } from '@/lib/pick/usePick';
import { colors } from '@/lib/theme';

/** Header buttons of the tabs that talk to the Mac: connection status and refresh. */
export function MacHeaderButtons({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  const router = useRouter();
  const { online } = usePickSnapshot();
  const dot = online === null ? colors.tertiaryLabel : online ? colors.green : colors.red;

  return (
    <View style={styles.headerButtons}>
      <Pressable hitSlop={8} onPress={() => router.push('/pick-settings')} style={styles.headerButton}>
        <Icon name="desktopcomputer" color={colors.blue} size={22} />
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
      </Pressable>
      <Pressable hitSlop={8} onPress={onRefresh} disabled={refreshing} style={styles.headerButton}>
        {refreshing ? (
          <ActivityIndicator />
        ) : (
          <Icon name="arrow.clockwise" color={colors.blue} size={21} weight="medium" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 4,
  },
  headerButton: {
    minWidth: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    position: 'absolute',
    right: -3,
    bottom: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
});
