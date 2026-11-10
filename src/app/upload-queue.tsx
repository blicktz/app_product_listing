import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from 'react-native';
import { Stack } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { Button, EmptyState, Icon, SectionFooter, SectionHeader } from '@/components/ui';
import { colors, shared, tabular, tints, type } from '@/lib/theme';
import { useUploadQueue } from '@/lib/uploadQueue/useUploadQueue';
import {
  clearCompleted,
  exportToPhotos,
  firstThumbnailUri,
  remove,
  renumber,
  retry,
  retryAll,
} from '@/lib/uploadQueue/runner';
import { jobUploadFiles } from '@/lib/uploadQueue/prepare';
import { photoFilename, type UploadJob } from '@/lib/uploadQueue/store';

// Every SKU session waiting to reach R2, plus today's finished ones. Jobs that
// exhausted their retries or hit a numbering conflict sit at the top with the
// manual fallbacks: retry, renumber, save to Photos, or (deliberately) delete.

const STATUS_LABELS: Record<UploadJob['status'], string> = {
  queued: 'Queued',
  preparing: 'Preparing photos',
  uploading: 'Uploading',
  'waiting-retry': 'Waiting to retry',
  failed: 'Upload failed',
  conflict: 'Number conflict',
  done: 'Uploaded',
};

function uploadedPhotos(job: UploadJob) {
  return job.photos.filter((p) => job.uploaded.includes(photoFilename(job.sku, p.number))).length;
}

function photoRange(job: UploadJob) {
  const numbers = job.photos.map((p) => String(p.number).padStart(2, '0'));
  return numbers.length > 1 ? `_${numbers[0]}–_${numbers[numbers.length - 1]}` : `_${numbers[0]}`;
}

function statusDetail(job: UploadJob, now: number, online: boolean | null): string {
  const files = jobUploadFiles(job);
  const sent = files.filter((f) => job.uploaded.includes(f.filename)).length;
  const progress = `${uploadedPhotos(job)}/${job.photos.length} photos`;
  switch (job.status) {
    case 'preparing': {
      const prepared = job.photos.filter((p) => p.rawFile === null).length;
      return `${prepared}/${job.photos.length} prepared`;
    }
    case 'uploading':
      return `${progress} · ${sent}/${files.length} files`;
    case 'waiting-retry':
      if (job.nextAttemptAt === null) {
        return online === false ? `${progress} · waiting for network` : progress;
      }
      return `${progress} · retry in ${Math.max(0, Math.ceil((job.nextAttemptAt - now) / 1000))}s`;
    case 'done':
      return `${job.photos.length} photos${
        job.completedAt
          ? ` · ${new Date(job.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : ''
      }`;
    default:
      return progress;
  }
}

type Section = { title: string; data: UploadJob[] };

export default function UploadQueueScreen() {
  const { jobs, online, activeJobId } = useUploadQueue();
  const [now, setNow] = useState(() => Date.now());
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  // Tick the retry countdowns once a second, only while one is showing.
  const hasCountdown = jobs.some((j) => j.status === 'waiting-retry' && j.nextAttemptAt !== null);
  useEffect(() => {
    if (!hasCountdown) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasCountdown]);

  const attention = jobs.filter((j) => j.status === 'failed' || j.status === 'conflict');
  const inProgress = jobs.filter(
    (j) => j.status !== 'failed' && j.status !== 'conflict' && j.status !== 'done'
  );
  const done = jobs.filter((j) => j.status === 'done').reverse();
  const sections: Section[] = [
    { title: 'Needs attention', data: attention },
    { title: 'In progress', data: inProgress },
    { title: 'Completed today', data: done },
  ].filter((section) => section.data.length > 0);

  const runAction = async (job: UploadJob, action: () => Promise<unknown>) => {
    setBusyJobId(job.id);
    try {
      await action();
    } finally {
      setBusyJobId(null);
    }
  };

  const handleSaveToPhotos = (job: UploadJob) =>
    runAction(job, async () => {
      try {
        const count = await exportToPhotos(job.id);
        Alert.alert(
          'Saved to Photos',
          `${count} photo${count === 1 ? '' : 's'} saved to the album "Unuploaded – ${job.dateRoot} ${job.sku}". ` +
            'The job stays in the queue and will still upload.'
        );
      } catch (error) {
        Alert.alert('Could Not Save', error instanceof Error ? error.message : String(error));
      }
    });

  const handleRenumber = (job: UploadJob) =>
    runAction(job, async () => {
      try {
        await renumber(job.id);
      } catch (error) {
        Alert.alert(
          'Could Not Renumber',
          `Couldn't reach R2 to find free numbers. ${error instanceof Error ? error.message : ''}`
        );
      }
    });

  const handleDelete = (job: UploadJob) => {
    const pending = job.photos.length - uploadedPhotos(job);
    Alert.alert(
      'Delete From Phone?',
      `${pending} photo${pending === 1 ? '' : 's'} of ${job.sku} ${
        pending === 1 ? 'has' : 'have'
      } not reached R2 and will be lost. Save to Photos first if you need them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove(job.id) },
      ]
    );
  };

  const renderJob = ({ item: job }: { item: UploadJob }) => {
    const thumb = job.status === 'done' ? null : firstThumbnailUri(job);
    const needsAttention = job.status === 'failed' || job.status === 'conflict';
    const busy = busyJobId === job.id;
    const look = STATUS_LOOK[job.status];
    return (
      <View style={[shared.card, styles.card]}>
        <View style={styles.cardRow}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Icon
                name={job.status === 'done' ? 'checkmark.circle.fill' : 'photo'}
                color={job.status === 'done' ? colors.green : colors.tertiaryLabel}
                size={24}
              />
            </View>
          )}
          <View style={styles.cardBody}>
            <Text style={styles.sku} numberOfLines={1}>
              {job.sku} <Text style={styles.range}>{photoRange(job)}</Text>
            </Text>
            <View style={styles.statusRow}>
              {job.id === activeJobId ? (
                <ActivityIndicator size="small" />
              ) : (
                <Icon name={look.icon} color={look.color} size={15} weight="semibold" />
              )}
              <Text style={[styles.status, { color: look.color }]}>{STATUS_LABELS[job.status]}</Text>
            </View>
            <Text style={[styles.meta, tabular]}>
              {job.dateRoot} · {statusDetail(job, now, online)}
              {job.numberedOffline ? ' · numbered offline' : ''}
            </Text>
          </View>
        </View>
        {job.lastError && job.status !== 'done' && (
          <View style={styles.errorBox}>
            <Text style={styles.error} numberOfLines={3}>
              {job.lastError}
            </Text>
          </View>
        )}
        {(needsAttention || job.status === 'waiting-retry') && (
          <View style={styles.actions}>
            {job.status === 'conflict' ? (
              <Button
                label="Renumber"
                icon="number"
                onPress={() => handleRenumber(job)}
                disabled={busy}
                style={styles.action}
              />
            ) : (
              <Button
                label="Retry now"
                icon="arrow.clockwise"
                onPress={() => retry(job.id)}
                disabled={busy}
                style={styles.action}
              />
            )}
            {needsAttention && (
              <>
                <Button
                  label="Save to Photos"
                  icon="square.and.arrow.down"
                  tone="neutral"
                  onPress={() => handleSaveToPhotos(job)}
                  disabled={busy}
                  style={styles.action}
                />
                <Button
                  label="Delete"
                  icon="trash"
                  tone="red"
                  onPress={() => handleDelete(job)}
                  disabled={busy}
                  style={styles.action}
                />
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            attention.length > 0 || inProgress.some((j) => j.status === 'waiting-retry') ? (
              <Pressable onPress={retryAll} hitSlop={8}>
                <Text style={styles.headerButton}>Retry all</Text>
              </Pressable>
            ) : done.length > 0 ? (
              <Pressable onPress={clearCompleted} hitSlop={8}>
                <Text style={styles.headerButton}>Clear</Text>
              </Pressable>
            ) : null,
        }}
      />
      <SectionList
        style={shared.screen}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.listContent}
        sections={sections}
        keyExtractor={(job) => job.id}
        renderItem={renderJob}
        renderSectionHeader={({ section }) => (
          <SectionHeader color={section.title === 'Needs attention' ? colors.red : undefined}>
            {section.title} · {section.data.length}
          </SectionHeader>
        )}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          online === false ? (
            <View style={[shared.card, styles.offline]}>
              <Icon name="wifi.slash" color={colors.orange} size={20} />
              <Text style={styles.offlineText}>
                Offline. Photos are safe on this phone and will upload when the network returns.
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="checkmark.icloud.fill"
            iconColor={colors.green}
            title="Nothing waiting"
            message="Everything is on R2."
          />
        }
        ListFooterComponent={
          jobs.length > 0 ? (
            <SectionFooter>
              Queued photos are kept in the app&apos;s folder until R2 confirms them. You can
              also reach them in the Files app under On My iPhone › FPops ›
              upload-queue.
            </SectionFooter>
          ) : null
        }
      />
    </>
  );
}

const STATUS_LOOK: Record<UploadJob['status'], { icon: SFSymbol; color: ColorValue }> = {
  queued: { icon: 'clock', color: colors.secondaryLabel },
  preparing: { icon: 'gearshape.fill', color: colors.blue },
  uploading: { icon: 'arrow.up.circle.fill', color: colors.blue },
  'waiting-retry': { icon: 'arrow.clockwise.circle.fill', color: colors.orange },
  failed: { icon: 'exclamationmark.circle.fill', color: colors.red },
  conflict: { icon: 'exclamationmark.triangle.fill', color: colors.red },
  done: { icon: 'checkmark.circle.fill', color: colors.green },
};

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 40,
  },
  headerButton: {
    ...type.body,
    color: colors.blue,
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 14,
    backgroundColor: tints.orange,
  },
  offlineText: {
    ...type.subheadline,
    color: colors.label,
    flex: 1,
  },
  card: {
    padding: 12,
    gap: 10,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  thumbPlaceholder: {
    backgroundColor: colors.fill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  sku: {
    ...type.headline,
    color: colors.label,
  },
  range: {
    ...type.subheadline,
    fontWeight: '400',
    color: colors.secondaryLabel,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  status: {
    ...type.subheadline,
    fontWeight: '600',
  },
  meta: {
    ...type.footnote,
    color: colors.secondaryLabel,
  },
  errorBox: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: tints.red,
  },
  error: {
    ...type.footnote,
    color: colors.red,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  action: {
    flexGrow: 1,
    minHeight: 40,
    paddingHorizontal: 12,
  },
});
