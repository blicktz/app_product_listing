import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui';
import { type as textStyles } from '@/lib/theme';

type ToastProps = {
  message: string;
  type: 'success' | 'error';
  visible: boolean;
};

export function Toast({ message, type, visible }: ToastProps) {
  const insets = useSafeAreaInsets();

  if (!visible) {
    return null;
  }

  const error = type === 'error';
  return (
    <View
      style={[styles.container, { top: insets.top + 12 }, error ? styles.error : styles.success]}
    >
      <Icon name={error ? 'xmark.octagon.fill' : 'checkmark.circle.fill'} color="#ffffff" size={22} weight="semibold" />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  success: {
    backgroundColor: '#248A3D',
  },
  error: {
    backgroundColor: '#D70015',
  },
  text: {
    ...textStyles.headline,
    color: '#fff',
    flex: 1,
  },
});
