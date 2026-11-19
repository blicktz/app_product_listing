import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, EmptyState, Icon, SectionFooter, SectionHeader } from '@/components/ui';
import { formatShowTime } from '@/components/whatnot-pick/WhatnotHome';
import { colors, shared, tabular, type } from '@/lib/theme';
import { selectShow } from '@/lib/whatnot-pick/store';
import { useWhatnotSnapshot } from '@/lib/whatnot-pick/useWhatnot';

// Sheet: which published show to pick for (design.md §3.4).
export default function ShowChooser() {
  const router = useRouter();
  const snap = useWhatnotSnapshot();
  const shows = snap.shows?.shows ?? [];

  return (
    <View style={shared.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {shows.length === 0 ? (
          <EmptyState icon="video.slash" title="No published shows" message="Publish a plan in the ops console's Whatnot tab." />
        ) : (
          <>
            <SectionHeader>Upcoming</SectionHeader>
            <Card inset={44}>
              {shows.map((s) => {
                const on = s.plan_id === snap.selectedPlanId;
                return (
                  <Pressable
                    key={s.plan_id}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                      void selectShow(s.plan_id);
                      router.back();
                    }}
                  >
                    <Icon name={on ? 'largecircle.fill.circle' : 'circle'} color={on ? colors.blue : colors.tertiaryLabel} size={22} />
                    <View style={styles.text}>
                      <Text style={styles.title}>{s.title}</Text>
                      <Text style={[styles.sub, tabular]}>
                        {formatShowTime(s.whatnot_scheduled_at, s.scheduled_at)} · {s.n_items} items · {s.n_picked} picked
                        {s.n_sold ? ` · ${s.n_sold} sold` : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
            <SectionFooter>Only published shows appear here. Plans are made in the ops console (Whatnot tab).</SectionFooter>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingRight: 12, paddingLeft: 12 },
  text: { flex: 1, gap: 2 },
  title: { ...type.headline, color: colors.label },
  sub: { ...type.footnote, color: colors.secondaryLabel },
});
