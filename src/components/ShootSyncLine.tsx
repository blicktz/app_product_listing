import { Pressable, StyleSheet, Text, type ColorValue } from 'react-native';
import { useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { Icon } from '@/components/ui';
import { usePickSnapshot } from '@/lib/pick/usePick';
import { colors, type } from '@/lib/theme';
import { queueWaitReason, summarize, useUploadQueue, waitingPhotoCount } from '@/lib/uploadQueue/useUploadQueue';

type Line = { icon: SFSymbol; color: ColorValue; textColor?: ColorValue; text: string };

/** One line of send status, in Stow's format. Tap for the Upload Queue. */
export function ShootSyncLine() {
  const router = useRouter();
  const { jobs } = useUploadQueue();
  const { uploadDestination } = usePickSnapshot();
  const { attention } = summarize(jobs);
  const waiting = waitingPhotoCount(jobs);
  const photos = `${waiting} photo${waiting === 1 ? '' : 's'} waiting`;
  const reason = queueWaitReason(jobs);

  let line: Line;
  if (attention > 0) {
    line = {
      icon: 'exclamationmark.circle.fill',
      color: colors.red,
      text: `${attention} need${attention === 1 ? 's' : ''} attention`,
    };
  } else if (waiting > 0 && reason === 'drive') {
    line = { icon: 'externaldrive.badge.exclamationmark', color: colors.orange, text: `Mac drive offline · ${photos}` };
  } else if (waiting > 0 && reason === 'mac') {
    line = { icon: 'desktopcomputer', color: colors.orange, text: `Waiting for Mac · ${photos}` };
  } else if (waiting > 0 && reason === 'network') {
    line = { icon: 'wifi.slash', color: colors.orange, text: `Offline · ${photos}` };
  } else if (waiting > 0) {
    line = { icon: 'arrow.up.circle.fill', color: colors.orange, text: photos };
  } else {
    line = {
      icon: 'checkmark.circle.fill',
      color: colors.green,
      textColor: colors.secondaryLabel,
      text: uploadDestination === 'mac' ? 'All on Mac' : 'All uploaded',
    };
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push('/upload-queue')}
      hitSlop={6}
    >
      <Icon name={line.icon} color={line.color} size={15} />
      <Text style={[styles.text, { color: line.textColor ?? line.color }]} numberOfLines={2}>
        {line.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    marginBottom: 4,
    marginHorizontal: 32,
  },
  text: {
    ...type.footnote,
    flexShrink: 1,
  },
});
