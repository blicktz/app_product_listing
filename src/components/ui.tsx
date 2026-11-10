import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ColorValue, type ViewStyle } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Host, ProgressView } from '@expo/ui/swift-ui';
import { tint } from '@expo/ui/swift-ui/modifiers';
import { colors, shared, tabular, tints, type } from '@/lib/theme';

// Small building blocks for iOS "inset grouped" screens.

export function Icon({
  name,
  color = colors.secondaryLabel,
  size = 20,
  weight = 'regular',
}: {
  name: SFSymbol;
  color?: ColorValue;
  size?: number;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}) {
  return <SymbolView name={name} tintColor={color} size={size} weight={weight} style={{ width: size, height: size }} />;
}

export function SectionHeader({ children, color }: { children: ReactNode; color?: ColorValue }) {
  return <Text style={[shared.sectionHeader, color ? { color } : null]}>{children}</Text>;
}

export function SectionFooter({ children }: { children: ReactNode }) {
  return <Text style={shared.sectionFooter}>{children}</Text>;
}

/** A rounded card; direct children are separated by inset hairlines. */
export function Card({ children, style, inset = 16 }: { children: ReactNode; style?: ViewStyle; inset?: number }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[shared.card, style]}>
      {items.map((child, i) => (
        <Fragment key={child.key ?? i}>
          {i > 0 ? <View style={[shared.separator, { marginLeft: inset }]} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

type RowProps = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
};

export function Row({ leading, title, subtitle, trailing, chevron = false, onPress }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? { backgroundColor: colors.pressed } : null]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.body}>
        {typeof title === 'string' ? (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {trailing}
      {chevron ? <Icon name="chevron.right" size={14} color={colors.tertiaryLabel} weight="semibold" /> : null}
    </Pressable>
  );
}

type PillTone = 'neutral' | 'green' | 'orange' | 'blue' | 'red';

const PILL_TONES: Record<PillTone, { bg: ColorValue; fg: ColorValue }> = {
  neutral: { bg: colors.fill, fg: colors.secondaryLabel },
  green: { bg: tints.green, fg: colors.green },
  orange: { bg: tints.orange, fg: colors.orange },
  blue: { bg: tints.blue, fg: colors.blue },
  red: { bg: tints.red, fg: colors.red },
};

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: PillTone }) {
  const t = PILL_TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillText, tabular, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

type ButtonTone = 'blue' | 'red' | 'neutral';

/** iOS "tinted" / "filled" button. */
export function Button({
  label,
  icon,
  onPress,
  tone = 'blue',
  filled = false,
  disabled = false,
  loading = false,
  large = false,
  style,
}: {
  label: string;
  icon?: SFSymbol;
  onPress: () => void;
  tone?: ButtonTone;
  filled?: boolean;
  disabled?: boolean;
  /** Spinner in place of the label. */
  loading?: boolean;
  /** Primary call-to-action height (50 pt). */
  large?: boolean;
  style?: ViewStyle;
}) {
  const fg = tone === 'red' ? colors.red : tone === 'neutral' ? colors.label : colors.blue;
  const bg = filled
    ? tone === 'red'
      ? colors.red
      : colors.blue
    : tone === 'red'
      ? tints.red
      : tone === 'neutral'
        ? colors.fill
        : tints.blue;
  const textColor = filled ? colors.white : fg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        large ? styles.buttonLarge : null,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon ? <Icon name={icon} color={textColor} size={large ? 19 : 17} weight="semibold" /> : null}
          <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Native SwiftUI linear progress bar. */
export function ProgressBar({ value, color = colors.blue }: { value: number; color?: ColorValue }) {
  return (
    <Host matchContents={{ vertical: true }} style={styles.progress}>
      <ProgressView value={Math.max(0, Math.min(1, value))} modifiers={[tint(color)]} />
    </Host>
  );
}

/** Centered icon + title + text, for empty and offline states. */
export function EmptyState({
  icon,
  iconColor = colors.tertiaryLabel,
  title,
  message,
  action,
}: {
  icon: SFSymbol;
  iconColor?: ColorValue;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={52} color={iconColor} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
  },
  leading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.headline,
    color: colors.label,
  },
  subtitle: {
    ...type.subheadline,
    color: colors.secondaryLabel,
  },
  pill: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignItems: 'center',
  },
  pillText: {
    ...type.subheadline,
    fontWeight: '600',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  buttonLarge: {
    minHeight: 50,
    borderRadius: 12,
  },
  buttonText: {
    ...type.headline,
  },
  progress: {
    width: '100%',
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 48,
    gap: 10,
  },
  emptyTitle: {
    ...type.title3,
    color: colors.label,
    textAlign: 'center',
  },
  emptyMessage: {
    ...type.subheadline,
    color: colors.secondaryLabel,
    textAlign: 'center',
    marginBottom: 8,
  },
});
