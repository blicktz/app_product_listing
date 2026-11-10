import { Pressable, StyleSheet, Text } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import { Icon } from '@/components/ui';
import { summarize, useUploadQueue } from '@/lib/uploadQueue/useUploadQueue';

type Props = {
  /** Omit to render a non-interactive status chip (e.g. mid camera session). */
  onPress?: () => void;
  /** Render "All uploaded" instead of nothing when the queue is empty. */
  showIdle?: boolean;
  /** outline: bordered chip (camera overlay); tinted: filled chip with an SF Symbol (Shoot screen). */
  variant?: 'outline' | 'tinted';
};

type Status = { glyph: string; icon: SFSymbol; text: string; color: string; tint: string };

export function UploadQueueBadge({ onPress, showIdle = false, variant = 'outline' }: Props) {
  const { jobs, online } = useUploadQueue();
  const { active, waiting, attention } = summarize(jobs);

  let status: Status | null = null;
  if (attention > 0) {
    status = {
      glyph: '!',
      icon: 'exclamationmark.circle.fill',
      text: `${attention} need${attention === 1 ? 's' : ''} attention`,
      color: '#dc2626',
      tint: 'rgba(255,59,48,0.12)',
    };
  } else if (waiting > 0 || (online === false && active > 0)) {
    status = {
      glyph: '',
      icon: online === false ? 'wifi.slash' : 'arrow.clockwise.circle.fill',
      text: `${online === false ? 'Offline' : 'Retrying'} · ${waiting + active} waiting`,
      color: '#d97706',
      tint: 'rgba(255,149,0,0.16)',
    };
  } else if (active > 0) {
    status = {
      glyph: '↑',
      icon: 'arrow.up.circle.fill',
      text: `Uploading ${active}`,
      color: '#208AEF',
      tint: 'rgba(0,122,255,0.12)',
    };
  } else if (showIdle) {
    status = {
      glyph: '✓',
      icon: 'checkmark.circle.fill',
      text: 'All uploaded',
      color: '#15803d',
      tint: 'rgba(52,199,89,0.16)',
    };
  }

  if (!status) {
    return null;
  }

  if (variant === 'tinted') {
    return (
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [styles.tinted, { backgroundColor: status.tint, opacity: pressed ? 0.6 : 1 }]}
        hitSlop={8}
      >
        <Icon name={status.icon} color={status.color} size={15} weight="semibold" />
        <Text style={[styles.text, { color: status.color }]}>{status.text}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.badge, { borderColor: status.color }]}
      hitSlop={8}
    >
      <Text style={[styles.text, { color: status.color }]}>
        {status.glyph ? `${status.glyph} ${status.text}` : status.text}
      </Text>
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
  tinted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
});
