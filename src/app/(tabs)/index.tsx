import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
    <Pressable style={styles.container} onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionLabel}>Session folder</Text>
        <Text style={styles.sessionValue}>{dateRoot}/</Text>
        <View style={styles.queueBadge}>
          <UploadQueueBadge showIdle onPress={() => router.push('/upload-queue')} />
        </View>
        {lowDisk && (
          <Text style={styles.warningText}>
            Phone storage is low. Free up space so queued photos keep fitting.
          </Text>
        )}
      </View>

      <View style={styles.form}>
        <Text style={styles.inputLabel}>SKU</Text>
        <View style={styles.skuRow}>
          <TextInput
            style={[styles.input, isFlashing && styles.inputFlash]}
            value={sku}
            onChangeText={handleSkuChange}
            placeholder="Enter SKU"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
          />
          <Pressable style={styles.scanButton} onPress={() => router.push('/scan')}>
            <View style={styles.scanIcon}>
              <View style={[styles.scanIconCorner, styles.scanIconCornerTopLeft]} />
              <View style={[styles.scanIconCorner, styles.scanIconCornerTopRight]} />
              <View style={[styles.scanIconCorner, styles.scanIconCornerBottomLeft]} />
              <View style={[styles.scanIconCorner, styles.scanIconCornerBottomRight]} />
            </View>
          </Pressable>
        </View>
        {!listingConfig && (
          <Text style={styles.existingFilesText}>Set listing config first.</Text>
        )}
        {currentCheck?.offline && (
          <Text style={styles.existingFilesText}>
            Offline: numbering from this phone&apos;s history ({currentCheck.nextNumber} next).
          </Text>
        )}
        {((currentCheck?.count ?? 0) > 0 || queuedCount > 0) && (
          <Text style={styles.existingFilesText}>
            Existing files: {currentCheck?.count ?? 0}
            {queuedCount > 0 ? ` + ${queuedCount} queued on this phone` : ''}
          </Text>
        )}

        <Pressable
          style={[styles.startButton, !canStartCapture && styles.startButtonDisabled]}
          onPress={handleStartCapture}
          disabled={!canStartCapture}
        >
          {isStartingCapture ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.startButtonText}>Start Capture</Text>
          )}
        </Pressable>
      </View>

      <Pressable
        style={[styles.listingCard, !listingConfig && styles.listingCardUnset]}
        onPress={() => router.push('/listing-config')}
      >
        <View style={styles.listingCardBody}>
          <Text style={styles.sessionLabel}>Listing</Text>
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
            <Text style={styles.listingUnsetText}>Not set, tap to configure</Text>
          )}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <Toast message={successToast ?? ''} type="success" visible={successToast !== null} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 32,
  },
  listingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 12,
    padding: 16,
  },
  listingCardUnset: {
    borderColor: '#c2410c',
    backgroundColor: '#fff7ed',
  },
  listingCardBody: {
    flex: 1,
    gap: 10,
  },
  listingPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  listingUnsetText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#c2410c',
  },
  chevron: {
    fontSize: 28,
    color: '#c7c7cc',
    marginLeft: 8,
  },
  sessionInfo: {
    alignItems: 'center',
    gap: 4,
  },
  sessionLabel: {
    fontSize: 13,
    color: '#8e8e93',
    textTransform: 'uppercase',
  },
  sessionValue: {
    fontSize: 20,
    fontWeight: '600',
  },
  form: {
    gap: 12,
  },
  inputLabel: {
    fontSize: 13,
    color: '#8e8e93',
    textTransform: 'uppercase',
  },
  skuRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    height: SKU_ROW_HEIGHT,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 17,
  },
  inputFlash: {
    borderColor: '#208AEF',
    backgroundColor: '#e6f4fe',
  },
  scanButton: {
    width: SKU_ROW_HEIGHT,
    height: SKU_ROW_HEIGHT,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanIcon: {
    width: 22,
    height: 22,
  },
  scanIconCorner: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderColor: '#208AEF',
  },
  scanIconCornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  scanIconCornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  scanIconCornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  scanIconCornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  queueBadge: {
    marginTop: 8,
  },
  warningText: {
    fontSize: 13,
    color: '#dc2626',
    textAlign: 'center',
    marginTop: 4,
  },
  existingFilesText: {
    fontSize: 13,
    color: '#c2410c',
    marginTop: -4,
  },
  startButton: {
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  startButtonDisabled: {
    backgroundColor: '#b7d9f9',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
