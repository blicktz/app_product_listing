import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Paths } from 'expo-file-system';
import { checkSku } from '@/lib/uploadApi';
import { localMaxNumber, pendingPhotoCount } from '@/lib/uploadQueue/runner';
import { useUploadQueue } from '@/lib/uploadQueue/useUploadQueue';
import { UploadQueueBadge } from '@/components/UploadQueueBadge';
import { useRemoteTrigger } from '@/lib/useRemoteTrigger';
import { useHardwareShutter } from '@/lib/useHardwareShutter';
import { takePendingHomeAction } from '@/lib/pendingHomeAction';
import { Toast } from '@/components/Toast';
import { ListingPill } from '@/components/ListingPill';
import { Button, Card, Icon, SectionHeader } from '@/components/ui';
import { colors, shared, tints, type } from '@/lib/theme';
import {
  CONDITION_COLORS,
  CONDITION_LABELS,
  STORE_COLORS,
  completeListingConfig,
  loadListingConfigDraft,
  type ListingConfig,
} from '@/lib/listingConfig';

const SKU_ROW_HEIGHT = 48;

const TOAST_DURATION_MS = 3000;
// Queued photos live in Documents until R2 confirms them; warn before the
// phone runs out of room for more.
const LOW_DISK_BYTES = 500 * 1024 * 1024;

function formatDateRoot(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function incrementTrailingNumber(sku: string): string | null {
  const match = sku.match(/-(\d+)$/);
  if (!match) {
    return null;
  }
  const digits = match[1];
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return sku.slice(0, match.index) + '-' + next;
}

type SkuCheck = {
  sku: string;
  /** Photos already on R2 (0 when offline). */
  count: number;
  nextNumber: number;
  /** R2 was unreachable: nextNumber comes from this phone's queue ledger only. */
  offline: boolean;
};

/**
 * Next photo number for a SKU: after everything on R2 *and* everything already
 * queued on this phone, so a second session on a SKU that's still uploading
 * can't reuse its numbers. Offline, the phone's own history is all there is.
 */
async function resolveSkuCheck(dateRoot: string, sku: string): Promise<SkuCheck> {
  const localNext = localMaxNumber(dateRoot, sku) + 1;
  try {
    const result = await checkSku(dateRoot, sku);
    return {
      sku,
      count: result.count,
      nextNumber: Math.max(result.nextNumber, localNext),
      offline: false,
    };
  } catch {
    return { sku, count: 0, nextNumber: localNext, offline: true };
  }
}

export default function HomeScreen() {
  const router = useRouter();
  const [dateRoot] = useState(() => formatDateRoot(new Date()));
  const [sku, setSku] = useState('');
  const skuRef = useRef('');
  const [skuCheck, setSkuCheck] = useState<SkuCheck | null>(null);
  const [isStartingCapture, setIsStartingCapture] = useState(false);
  // Synchronous re-entry latch. isStartingCapture is state and only updates on
  // the next render, so two remote clicks (or a double tap) in the same tick
  // both pass the guard and push /camera twice — two camera sessions on one SKU
  // whose position-derived uploads then clobber each other. This ref flips
  // immediately. Cleared on the error path and whenever Home regains focus.
  const isStartingCaptureRef = useRef(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [listingConfig, setListingConfig] = useState<ListingConfig | null>(() =>
    completeListingConfig(loadListingConfigDraft())
  );
  // Re-render as the queue changes, so the pending count stays live.
  const { jobs: queuedJobs } = useUploadQueue();
  const [lowDisk, setLowDisk] = useState(false);

  const handleSkuChange = (text: string) => {
    skuRef.current = text;
    setSku(text);
  };

  const flashSku = (value: string) => {
    skuRef.current = value;
    setSku(value);
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 900);
  };

  useFocusEffect(
    useCallback(() => {
      // Re-arm the start-capture latch: returning here (backed out of the
      // camera, or a completed upload) means the next click should work.
      isStartingCaptureRef.current = false;

      // May have just changed on the listing-config screen.
      setListingConfig(completeListingConfig(loadListingConfigDraft()));
      try {
        setLowDisk(Paths.availableDiskSpace < LOW_DISK_BYTES);
      } catch {
        setLowDisk(false);
      }

      const action = takePendingHomeAction();

      if (action?.type === 'queued') {
        setSuccessToast(action.message);
        setTimeout(() => setSuccessToast(null), TOAST_DURATION_MS);

        const incremented = incrementTrailingNumber(skuRef.current.trim());
        if (incremented !== null) {
          flashSku(incremented);
        }
      } else if (action?.type === 'sku-scanned') {
        flashSku(action.sku);
      }

      setSkuCheck(null);
    }, [])
  );

  useEffect(() => {
    const trimmedSku = sku.trim();
    if (!trimmedSku) {
      return;
    }

    const timer = setTimeout(() => {
      void resolveSkuCheck(dateRoot, trimmedSku).then(setSkuCheck);
    }, 500);

    return () => clearTimeout(timer);
  }, [sku, dateRoot]);

  const canStartCapture = sku.trim().length > 0 && listingConfig !== null && !isStartingCapture;

  const handleStartCapture = async () => {
    const trimmedSku = sku.trim();
    // No silent default for condition/store: a batch generated with the wrong
    // ones is wasted, so capture waits until both are chosen.
    if (!trimmedSku || !listingConfig || isStartingCaptureRef.current) {
      return;
    }
    isStartingCaptureRef.current = true;

    // Reuse the debounced check only if it reached R2; an offline result is
    // retried here in case the connection is back. Either way the start
    // number is re-floored by the local ledger, which may have moved since.
    let check: SkuCheck;
    if (skuCheck?.sku === trimmedSku && !skuCheck.offline) {
      check = {
        ...skuCheck,
        nextNumber: Math.max(skuCheck.nextNumber, localMaxNumber(dateRoot, trimmedSku) + 1),
      };
    } else {
      setIsStartingCapture(true);
      check = await resolveSkuCheck(dateRoot, trimmedSku);
      setSkuCheck(check);
      setIsStartingCapture(false);
    }
    // Offline is allowed: the upload queue re-checks R2 before sending and
    // parks the job as a conflict rather than overwrite anything.

    router.push({
      pathname: '/camera',
      params: {
        sku: trimmedSku,
        dateRoot,
        startNumber: String(check.nextNumber),
        numberedOffline: check.offline ? '1' : '0',
        // Snapshot of what Home showed, so the session uploads exactly that.
        itemCondition: listingConfig.itemCondition,
        ebayStore: listingConfig.ebayStore,
      },
    });
  };

  // Remote shutter on the start screen: a short press begins the session,
  // same as tapping "Start Capture". Does nothing if no SKU is entered yet.
  useRemoteTrigger({ onCapture: handleStartCapture });
  useHardwareShutter({ mode: 'volume', onCapture: handleStartCapture });

  const currentCheck = skuCheck?.sku === sku.trim() ? skuCheck : null;
  const queuedCount = sku.trim() ? pendingPhotoCount(queuedJobs, dateRoot, sku.trim()) : 0;

  return (
    // A tap anywhere outside the SKU field dismisses the keyboard; React Native
    // doesn't blur a TextInput on outside taps by itself.
    <Pressable style={shared.screen} onPress={Keyboard.dismiss} accessible={false}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Text style={styles.largeTitle}>Shoot</Text>

        {/* Session */}
        <Card>
          <View style={styles.sessionRow}>
            <View style={[styles.iconTile, { backgroundColor: colors.blue }]}>
              <Icon name="folder.fill" color={colors.white} size={17} />
            </View>
            <View style={styles.sessionBody}>
              <Text style={styles.caption}>Session folder</Text>
              <Text style={styles.sessionValue}>{dateRoot}/</Text>
            </View>
            <UploadQueueBadge showIdle variant="tinted" onPress={() => router.push('/upload-queue')} />
          </View>
          {lowDisk ? (
            <View style={styles.warningRow}>
              <Icon name="externaldrive.badge.exclamationmark" color={colors.red} size={18} />
              <Text style={styles.warningText}>
                Phone storage is low. Free up space so queued photos keep fitting.
              </Text>
            </View>
          ) : null}
        </Card>

        {/* SKU */}
        <SectionHeader>SKU</SectionHeader>
        <Card style={isFlashing ? styles.cardFlash : undefined}>
          <View style={styles.skuRow}>
            <TextInput
              style={styles.input}
              value={sku}
              onChangeText={handleSkuChange}
              placeholder="Enter or scan SKU"
              placeholderTextColor={colors.tertiaryLabel}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
            />
            <Pressable
              style={({ pressed }) => [styles.scanButton, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => router.push('/scan')}
              hitSlop={6}
            >
              <Icon name="barcode.viewfinder" color={colors.blue} size={24} />
            </Pressable>
          </View>
        </Card>
        <View style={styles.notes}>
          {!listingConfig && (
            <View style={styles.noteRow}>
              <Icon name="exclamationmark.circle.fill" color={colors.orange} size={14} />
              <Text style={styles.noteText}>Set listing config first.</Text>
            </View>
          )}
          {currentCheck?.offline && (
            <View style={styles.noteRow}>
              <Icon name="wifi.slash" color={colors.orange} size={14} />
              <Text style={styles.noteText}>
                Offline: numbering from this phone&apos;s history ({currentCheck.nextNumber} next).
              </Text>
            </View>
          )}
          {((currentCheck?.count ?? 0) > 0 || queuedCount > 0) && (
            <View style={styles.noteRow}>
              <Icon name="photo.on.rectangle" color={colors.orange} size={14} />
              <Text style={styles.noteText}>
                Existing files: {currentCheck?.count ?? 0}
                {queuedCount > 0 ? ` + ${queuedCount} queued on this phone` : ''}
              </Text>
            </View>
          )}
        </View>

        <Button
          label="Start Capture"
          icon="camera.fill"
          filled
          large
          onPress={handleStartCapture}
          disabled={!canStartCapture}
          loading={isStartingCapture}
          style={styles.startButton}
        />

        {/* Listing */}
        <SectionHeader>Listing</SectionHeader>
        <Card style={!listingConfig ? styles.cardUnset : undefined}>
          <Pressable
            style={({ pressed }) => [styles.listingRow, pressed ? { backgroundColor: colors.pressed } : null]}
            onPress={() => router.push('/listing-config')}
          >
            {listingConfig ? (
              <View style={styles.listingPills}>
                <ListingPill
                  label={CONDITION_LABELS[listingConfig.itemCondition].toUpperCase()}
                  color={CONDITION_COLORS[listingConfig.itemCondition]}
                />
                <ListingPill
                  label={listingConfig.ebayStore}
                  color={STORE_COLORS[listingConfig.ebayStore]}
                />
              </View>
            ) : (
              <View style={styles.listingUnset}>
                <Icon name="exclamationmark.circle.fill" color={colors.orange} size={20} />
                <Text style={styles.listingUnsetText}>Not set, tap to configure</Text>
              </View>
            )}
            <Icon name="chevron.right" color={colors.tertiaryLabel} size={14} weight="semibold" />
          </Pressable>
        </Card>
      </SafeAreaView>

      <Toast message={successToast ?? ''} type="success" visible={successToast !== null} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  largeTitle: {
    ...type.largeTitle,
    color: colors.label,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 16,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionBody: {
    flex: 1,
    gap: 1,
  },
  caption: {
    ...type.footnote,
    color: colors.secondaryLabel,
  },
  sessionValue: {
    ...type.headline,
    color: colors.label,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: tints.red,
  },
  warningText: {
    ...type.footnote,
    color: colors.red,
    flex: 1,
  },
  cardFlash: {
    backgroundColor: tints.blue,
  },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 8,
    height: SKU_ROW_HEIGHT + 8,
    gap: 8,
  },
  input: {
    flex: 1,
    height: '100%',
    ...type.title3,
    fontWeight: '500',
    color: colors.label,
  },
  scanButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: tints.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notes: {
    marginHorizontal: 32,
    marginTop: 8,
    gap: 4,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  noteText: {
    ...type.footnote,
    color: colors.orange,
    flexShrink: 1,
  },
  startButton: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  cardUnset: {
    backgroundColor: tints.orange,
  },
  listingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  listingPills: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  listingUnset: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listingUnsetText: {
    ...type.headline,
    color: colors.orange,
  },
});
