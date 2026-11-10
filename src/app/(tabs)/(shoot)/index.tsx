import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type ColorValue } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { Paths } from 'expo-file-system';
import { localMaxNumber, pendingPhotoCount } from '@/lib/uploadQueue/runner';
import { destinationName, isValidUploadSku, lookupNumbers } from '@/lib/uploadQueue/destinations';
import { useUploadQueue } from '@/lib/uploadQueue/useUploadQueue';
import { MacHeaderButtons } from '@/components/MacHeaderButtons';
import { ShootSyncLine } from '@/components/ShootSyncLine';
import { ScanBanner } from '@/components/pick/ScanBanner';
import { ScanCapture } from '@/components/pick/ScanCapture';
import { useRemoteTrigger } from '@/lib/useRemoteTrigger';
import { useHardwareShutter } from '@/lib/useHardwareShutter';
import { takePendingHomeAction } from '@/lib/pendingHomeAction';
import { ListingPill } from '@/components/ListingPill';
import { Button, Card, Icon, Row, SectionHeader } from '@/components/ui';
import { isStorageLabel } from '@/lib/pick/boxLabel';
import { feedbackError, feedbackSuccess } from '@/lib/pick/feedback';
import { getSnapshot as getPickSnapshot } from '@/lib/pick/store';
import { usePickSnapshot } from '@/lib/pick/usePick';
import type { Banner } from '@/lib/pick/useScanHandler';
import { sessionDate } from '@/lib/sessionTime';
import { refreshShootState, useShootLog } from '@/lib/shootLog/store';
import type { ShootSessionSummary } from '@/lib/shootLog/types';
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

const BANNER_DURATION_MS = 3500;
const RECENT_LIMIT = 20;
// Queued photos live in Documents until their destination confirms them; warn
// before the phone runs out of room for more.
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
  /** Photos already at the destination (0 when it can't be reached). */
  count: number;
  nextNumber: number;
  /** Destination unreachable: nextNumber comes from this phone's queue ledger only. */
  offline: boolean;
};

/**
 * Next photo number for a SKU: after everything at the destination *and*
 * everything already queued on this phone, so a second session on a SKU that's
 * still uploading can't reuse its numbers. Offline, the phone's own history is
 * all there is.
 */
async function resolveSkuCheck(dateRoot: string, sku: string): Promise<SkuCheck> {
  const localNext = localMaxNumber(dateRoot, sku) + 1;
  try {
    const result = await lookupNumbers(getPickSnapshot().uploadDestination, dateRoot, sku);
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

function HeaderButtons() {
  const { refreshing } = useShootLog();
  return <MacHeaderButtons refreshing={refreshing} onRefresh={() => void refreshShootState()} />;
}

function recentLook(session: ShootSessionSummary): { icon: SFSymbol; color: ColorValue; label: string } {
  const missing = Math.max(0, session.photos_declared - session.photos_received);
  switch (session.status) {
    case 'complete':
      return {
        icon: 'checkmark.circle.fill',
        color: colors.green,
        label: session.destination === 'r2' ? 'On R2' : 'On Mac',
      };
    case 'conflict':
      return { icon: 'exclamationmark.triangle.fill', color: colors.red, label: 'Number conflict' };
    case 'rejected':
      return { icon: 'exclamationmark.circle.fill', color: colors.red, label: 'Refused' };
    case 'failed':
      return { icon: 'exclamationmark.circle.fill', color: colors.red, label: 'Upload failed' };
    case 'abandoned':
      return { icon: 'trash', color: colors.secondaryLabel, label: 'Deleted from phone' };
    default:
      return { icon: 'arrow.up.circle.fill', color: colors.orange, label: `${missing} missing` };
  }
}

export default function ShootHomeScreen() {
  const router = useRouter();
  const [dateRoot] = useState(() => formatDateRoot(new Date()));
  const [sku, setSku] = useState('');
  const skuRef = useRef('');
  const [skuCheck, setSkuCheck] = useState<SkuCheck | null>(null);
  const [skuFocused, setSkuFocused] = useState(false);
  const [isStartingCapture, setIsStartingCapture] = useState(false);
  // Synchronous re-entry latch. isStartingCapture is state and only updates on
  // the next render, so two remote clicks (or a double tap) in the same tick
  // both pass the guard and push /camera twice — two camera sessions on one SKU
  // whose position-derived uploads then clobber each other. This ref flips
  // immediately. Cleared on the error path and whenever Home regains focus.
  const isStartingCaptureRef = useRef(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const nextBannerId = useRef(1);
  const [pulling, setPulling] = useState(false);
  const [listingConfig, setListingConfig] = useState<ListingConfig | null>(() =>
    completeListingConfig(loadListingConfigDraft())
  );
  // Re-render as the queue changes, so the pending count stays live.
  const { jobs: queuedJobs } = useUploadQueue();
  const { uploadDestination } = usePickSnapshot();
  const { sessions } = useShootLog();
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

  const showBanner = useCallback((next: Omit<Banner, 'id'>) => {
    setBanner({ ...next, id: nextBannerId.current++ });
  }, []);

  useEffect(() => {
    if (!banner) {
      return;
    }
    const timer = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), BANNER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [banner]);

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
        showBanner({ tone: 'success', title: action.message });

        const incremented = incrementTrailingNumber(skuRef.current.trim());
        if (incremented !== null) {
          flashSku(incremented);
        }
      } else if (action?.type === 'sku-scanned') {
        flashSku(action.sku);
      }

      setSkuCheck(null);
      void refreshShootState();
    }, [showBanner])
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
  }, [sku, dateRoot, uploadDestination]);

  const trimmedSku = sku.trim();
  const skuIsValid = isValidUploadSku(trimmedSku);
  const canStartCapture = skuIsValid && listingConfig !== null && !isStartingCapture;

  const handleStartCapture = async () => {
    const startSku = sku.trim();
    // No silent default for condition/store: a batch generated with the wrong
    // ones is wasted, so capture waits until both are chosen.
    if (!isValidUploadSku(startSku) || !listingConfig || isStartingCaptureRef.current) {
      return;
    }
    isStartingCaptureRef.current = true;

    // Reuse the debounced check only if it reached the destination; an offline
    // result is retried here in case the connection is back. Either way the
    // start number is re-floored by the local ledger, which may have moved since.
    let check: SkuCheck;
    if (skuCheck?.sku === startSku && !skuCheck.offline) {
      check = {
        ...skuCheck,
        nextNumber: Math.max(skuCheck.nextNumber, localMaxNumber(dateRoot, startSku) + 1),
      };
    } else {
      setIsStartingCapture(true);
      check = await resolveSkuCheck(dateRoot, startSku);
      setSkuCheck(check);
      setIsStartingCapture(false);
    }
    // Offline is allowed: the upload queue re-checks the destination before
    // sending and parks the job as a conflict rather than overwrite anything.

    router.push({
      pathname: '/camera',
      params: {
        sku: startSku,
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

  const handleScan = (code: string) => {
    if (isStorageLabel(code)) {
      feedbackError();
      showBanner({ tone: 'error', title: `Box label: ${code}`, detail: 'Scan a product SKU here.' });
    } else if (!isValidUploadSku(code)) {
      feedbackError();
      showBanner({ tone: 'error', title: `Unrecognised barcode: ${code}` });
    } else {
      flashSku(code);
      feedbackSuccess();
      showBanner({ tone: 'success', title: `${code} scanned` });
    }
  };

  const handlePull = async () => {
    setPulling(true);
    if (trimmedSku) {
      setSkuCheck(await resolveSkuCheck(dateRoot, trimmedSku));
    }
    await refreshShootState();
    setPulling(false);
  };

  const currentCheck = skuCheck?.sku === trimmedSku ? skuCheck : null;
  const queuedCount = trimmedSku ? pendingPhotoCount(queuedJobs, dateRoot, trimmedSku) : 0;
  const onMac = uploadDestination === 'mac';
  const recent = sessions.slice(0, RECENT_LIMIT);

  return (
    <View style={shared.screen} collapsable={false}>
      <Stack.Screen options={{ headerRight: () => <HeaderButtons /> }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void handlePull()} />}
      >
        {/* A tap anywhere outside the SKU field dismisses the keyboard; React
            Native doesn't blur a TextInput on outside taps by itself. */}
        <Pressable onPress={() => (skuFocused ? Keyboard.dismiss() : undefined)} accessible={false}>
          <ScanCapture onScan={handleScan} enabled={!skuFocused} />

          <ShootSyncLine />

          {/* Session */}
          <Card style={styles.firstCard}>
            <View style={styles.sessionRow}>
              <View style={[styles.iconTile, { backgroundColor: colors.blue }]}>
                <Icon name="folder.fill" color={colors.white} size={17} />
              </View>
              <View style={styles.sessionBody}>
                <Text style={styles.caption}>{onMac ? 'Mac folder' : 'R2 folder'}</Text>
                <Text style={styles.sessionValue}>{dateRoot}/</Text>
              </View>
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
                onFocus={() => setSkuFocused(true)}
                onBlur={() => setSkuFocused(false)}
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
            {trimmedSku !== '' && !skuIsValid && (
              <View style={styles.noteRow}>
                <Icon name="exclamationmark.circle.fill" color={colors.red} size={14} />
                <Text style={[styles.noteText, { color: colors.red }]}>
                  A SKU can only use letters, numbers, - and _.
                </Text>
              </View>
            )}
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
                  Can&apos;t reach {destinationName(uploadDestination)}: numbering from this phone&apos;s
                  history ({currentCheck.nextNumber} next).
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

          {/* Recent sessions */}
          {recent.length > 0 ? (
            <View>
              <SectionHeader>Recent sessions</SectionHeader>
              <Card inset={52}>
                {recent.map((session) => {
                  const look = recentLook(session);
                  return (
                    <Row
                      key={session.session_id}
                      leading={<Icon name={look.icon} color={look.color} size={24} />}
                      title={`${session.shot_ended_at ? `${sessionDate(session.shot_ended_at)}  ` : ''}${session.sku}`}
                      subtitle={`${session.photos_declared} photo${session.photos_declared === 1 ? '' : 's'} · ${look.label}`}
                    />
                  );
                })}
              </Card>
            </View>
          ) : null}
        </Pressable>
      </ScrollView>

      <ScanBanner banner={banner} onDismiss={() => setBanner(null)} />
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
