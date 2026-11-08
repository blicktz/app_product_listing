import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
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
    return (
      <View style={[styles.card, needsAttention && styles.cardAttention]}>
        <View style={styles.cardRow}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Text style={styles.thumbPlaceholderText}>{job.status === 'done' ? '✓' : '…'}</Text>
            </View>
          )}
          <View style={styles.cardBody}>
            <Text style={styles.sku}>
              {job.sku} <Text style={styles.range}>{photoRange(job)}</Text>
            </Text>
            <Text style={styles.meta}>
              {job.dateRoot} · {STATUS_LABELS[job.status]}
              {job.id === activeJobId ? ' ●' : ''}
              {job.numberedOffline ? ' · numbered offline' : ''}
            </Text>
            <Text style={styles.meta}>{statusDetail(job, now, online)}</Text>
            {job.lastError && job.status !== 'done' && (
              <Text style={styles.error} numberOfLines={3}>
                {job.lastError}
              </Text>
            )}
          </View>
        </View>
        {(needsAttention || job.status === 'waiting-retry') && (
          <View style={styles.actions}>
            {job.status === 'conflict' ? (
              <ActionButton label="Renumber" onPress={() => handleRenumber(job)} disabled={busy} />
            ) : (
              <ActionButton label="Retry now" onPress={() => retry(job.id)} disabled={busy} />
            )}
            {needsAttention && (
              <>
                <ActionButton
                  label="Save to Photos"
                  onPress={() => handleSaveToPhotos(job)}
                  disabled={busy}
                />
                <ActionButton
                  label="Delete"
                  destructive
                  onPress={() => handleDelete(job)}
                  disabled={busy}
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
        style={styles.list}
        contentContainerStyle={styles.listContent}
        sections={sections}
        keyExtractor={(job) => job.id}
        renderItem={renderJob}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>
            {section.title} ({section.data.length})
          </Text>
        )}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          online === false ? (
            <Text style={styles.offlineBanner}>
              Offline. Photos are safe on this phone and will upload when the network returns.
            </Text>
          ) : null
        }
        ListEmptyComponent={<Text style={styles.empty}>Nothing waiting. Everything is on R2.</Text>}
        ListFooterComponent={
          jobs.length > 0 ? (
            <Text style={styles.footer}>
              Queued photos are kept in the app&apos;s folder until R2 confirms them. You can
              also reach them in the Files app under On My iPhone › product_listings ›
              upload-queue.
            </Text>
          ) : null
        }
      />
    </>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
    >
      <Text style={[styles.actionText, destructive && styles.actionTextDestructive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  headerButton: {
    color: '#0a84ff',
    fontSize: 17,
  },
  offlineBanner: {
    backgroundColor: '#fff7ed',
    borderColor: '#d97706',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: '#9a3412',
    fontSize: 14,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 13,
    color: '#8e8e93',
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 2,
  },
  card: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  cardAttention: {
    borderColor: '#dc2626',
    backgroundColor: '#fef2f2',
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 6,
  },
  thumbPlaceholder: {
    backgroundColor: '#f2f2f7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbPlaceholderText: {
    fontSize: 20,
    color: '#8e8e93',
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  sku: {
    fontSize: 17,
    fontWeight: '600',
  },
  range: {
    fontSize: 14,
    fontWeight: '400',
    color: '#8e8e93',
  },
  meta: {
    fontSize: 13,
    color: '#636366',
  },
  error: {
    fontSize: 13,
    color: '#dc2626',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  actionText: {
    color: '#0a84ff',
    fontSize: 15,
    fontWeight: '600',
  },
  actionTextDestructive: {
    color: '#dc2626',
  },
  empty: {
    textAlign: 'center',
    color: '#8e8e93',
    marginTop: 40,
    fontSize: 15,
  },
  footer: {
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 16,
    lineHeight: 17,
  },
});
