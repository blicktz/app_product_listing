import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui';
import { imageUri } from '@/lib/pick/images';
import { colors } from '@/lib/theme';
import type { PickLine } from '@/lib/pick/types';

type Props = {
  line: PickLine;
  size: number;
  /** Box open on the screen, passed to the viewer so a scan there picks from it. */
  boxId?: string | null;
  /** Show the hint that a tap zooms. */
  zoomHint?: boolean;
};

/** Cover image; a tap opens the full-screen zoom viewer. */
export function PickImage({ line, size, boxId = null, zoomHint = false }: Props) {
  const router = useRouter();
  const uri = imageUri(line.image_url ?? line.image_url_full);
  const radius = size >= 100 ? 10 : 8;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.frame,
        { width: size, height: size, borderRadius: radius, opacity: pressed ? 0.8 : 1 },
      ]}
      onPress={() =>
        router.push({
          pathname: '/pick-image',
          params: { lineKey: line.line_key, boxId: boxId ?? '' },
        })
      }
      disabled={!uri}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={styles.placeholder}>
          <Icon name="photo" color={colors.tertiaryLabel} size={Math.min(28, size * 0.45)} />
        </View>
      )}
      {uri && zoomHint ? (
        <View style={styles.hint}>
          <Icon name="arrow.up.left.and.arrow.down.right" color="#ffffff" size={12} weight="semibold" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: colors.fill,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
