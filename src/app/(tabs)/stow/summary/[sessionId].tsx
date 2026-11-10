import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, EmptyState, Icon, Pill, Row, SectionHeader } from '@/components/ui';
import { useStowData } from '@/lib/stow/useStow';
import { colors, shared, type } from '@/lib/theme';

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export default function StowSummaryScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { snap, sessions } = useStowData();
  const session = sessions.find((s) => s.id === sessionId);

  if (!session) {
    return (
      <View style={shared.screen}>
        <EmptyState icon="tray" title="Session not found" />
      </View>
    );
  }

  const extras = [
    session.rejects > 0 ? `${session.rejects} rejected` : null,
    session.moves > 0 ? `${session.moves} moved` : null,
  ].filter(Boolean);

  return (
    <View style={shared.screen} collapsable={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scroll}>
        <Card style={styles.firstCard}>
          <View style={styles.donePanel}>
            <Icon name="checkmark.circle.fill" color={colors.green} size={52} />
            <Text style={styles.doneTitle}>{plural(session.units, 'unit')} stowed</Text>
            <Text style={styles.doneSub}>
              {plural(session.boxes.length, 'box', 'boxes')} · {plural(session.skus, 'SKU')}
              {extras.length > 0 ? ` · ${extras.join(' · ')}` : ''}
            </Text>
          </View>
        </Card>

        {session.boxes.length > 0 ? (
          <>
            <SectionHeader>Boxes</SectionHeader>
            <Card>
              {session.boxes.map((box) => (
                <Row
                  key={box.label}
                  title={box.label}
                  subtitle={plural(box.rows.length, 'SKU')}
                  trailing={<Pill>{plural(box.units, 'unit')}</Pill>}
                />
              ))}
            </Card>
          </>
        ) : null}

        <View style={styles.syncRow}>
          {snap.unsentCount > 0 ? (
            <>
              <Icon name="arrow.up.circle.fill" color={colors.orange} size={15} />
              <Text style={[styles.syncText, { color: colors.orange }]}>
                {plural(snap.unsentCount, 'event')} not sent
              </Text>
            </>
          ) : (
            <>
              <Icon name="checkmark.circle.fill" color={colors.green} size={15} />
              <Text style={styles.syncText}>All stows sent</Text>
            </>
          )}
        </View>

        <Button label="Done" filled large onPress={() => router.dismissTo('/stow')} style={styles.done} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  firstCard: {
    marginTop: 12,
  },
  donePanel: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 6,
  },
  doneTitle: {
    ...type.title2,
    color: colors.label,
  },
  doneSub: {
    ...type.subheadline,
    color: colors.secondaryLabel,
    textAlign: 'center',
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 12,
    marginHorizontal: 32,
  },
  syncText: {
    ...type.footnote,
    color: colors.secondaryLabel,
    flexShrink: 1,
  },
  done: {
    marginHorizontal: 16,
    marginTop: 20,
  },
});
