import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui';
import { packImages } from '@/lib/pack/store';
import type { PackItem } from '@/lib/pack/types';
import { colors } from '@/lib/theme';

/** An item's photo, in full colour to compare with the item in hand; a tap opens the zoom viewer. */
export function PackPhoto({ item, size }: { item: PackItem; size: number }) {
  const router = useRouter();
  const uri = packImages.uri(item.image_url ?? item.image_url_full);
  const radius = size >= 100 ? 10 : 8;

  return (
    <Pressable
      style={({ pressed }) => [styles.frame, { width: size, height: size, borderRadius: radius, opacity: pressed ? 0.8 : 1 }]}
      onPress={() =>
        router.push({
          pathname: '/pack-image',
          params: { orderKey: item.order_key, seq: String(item.seq) },
        })
      }
      disabled={!uri}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={styles.placeholder}>
          <Icon name="photo" color={colors.tertiaryLabel} size={Math.min(40, size * 0.4)} />
        </View>
      )}
      {uri && size >= 96 ? (
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
