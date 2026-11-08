import { Pressable, StyleSheet, Text } from 'react-native';
import { summarize, useUploadQueue } from '@/lib/uploadQueue/useUploadQueue';

type Props = {
  /** Omit to render a non-interactive status chip (e.g. mid camera session). */
  onPress?: () => void;
  /** Render "All uploaded" instead of nothing when the queue is empty. */
  showIdle?: boolean;
};

export function UploadQueueBadge({ onPress, showIdle = false }: Props) {
  const { jobs, online } = useUploadQueue();
  const { active, waiting, attention } = summarize(jobs);

  let label: string | null = null;
  let color = '#636366';
  if (attention > 0) {
    label = `! ${attention} need${attention === 1 ? 's' : ''} attention`;
    color = '#dc2626';
  } else if (waiting > 0 || (online === false && active > 0)) {
    label = `${online === false ? 'Offline' : 'Retrying'} · ${waiting + active} waiting`;
    color = '#d97706';
  } else if (active > 0) {
    label = `↑ Uploading ${active}`;
    color = '#208AEF';
  } else if (showIdle) {
    label = '✓ All uploaded';
    color = '#15803d';
  }

  if (!label) {
    return null;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.badge, { borderColor: color }]}
      hitSlop={8}
    >
      <Text style={[styles.text, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'center',
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
});
