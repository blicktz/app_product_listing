import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  feedbackError,
  feedbackRepeat,
  feedbackSuccess,
  feedbackWarning,
  preparePickFeedback,
} from '../pick/feedback';
import type { Banner } from '../pick/useScanHandler';
import {
  decideManual,
  decideMarkPacked,
  decideScan,
  decideUndo,
  outcome,
  type Decision,
  type Outcome,
} from './scan';
import { consumeNotice, ensureFresh, getSnapshot, packScreenFocused, recordPackEvent } from './store';
import { usePackData } from './usePack';

const AUTO_HIDE_MS = 3500;
// The "pack & stick the label" banner and notices from the other side stay longer.
const LONG_HIDE_MS = 5000;

const SOUNDS: Record<Outcome['sound'], () => void> = {
  ok: feedbackSuccess,
  done: feedbackRepeat,
  warn: feedbackWarning,
  error: feedbackError,
};

type Options = {
  /** Show a package: push it from Pack home, switch to it on the Package screen. */
  openPackage: (key: string) => void;
  /** Reload quietly while this screen is in front (not the photo viewer). */
  autoRefresh?: boolean;
};

type PackBanner = Banner & { long?: boolean };

export function usePackScan({ openPackage, autoRefresh = true }: Options) {
  const [banner, setBanner] = useState<PackBanner | null>(null);
  const [focused, setFocused] = useState(false);
  const nextId = useRef(1);
  const { notices } = usePackData();

  useEffect(() => {
    preparePickFeedback();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const blur = autoRefresh ? packScreenFocused() : null;
      return () => {
        setFocused(false);
        blur?.();
      };
    }, [autoRefresh])
  );

  useEffect(() => {
    if (!banner || banner.actions) {
      return;
    }
    const timer = setTimeout(
      () => setBanner((b) => (b?.id === banner.id ? null : b)),
      banner.long ? LONG_HIDE_MS : AUTO_HIDE_MS
    );
    return () => clearTimeout(timer);
  }, [banner]);

  const show = (b: Omit<PackBanner, 'id'>) => setBanner({ ...b, id: nextId.current++ });
  const dismiss = () => setBanner(null);

  // Things the other side did (desktop packed it, a scan not counted): shown by
  // the screen in front only.
  const notice = notices[0];
  useEffect(() => {
    if (!focused || !notice) {
      return;
    }
    feedbackWarning();
    show({ tone: 'warning', title: notice.title, detail: notice.detail, long: true });
    consumeNotice(notice.id);
  }, [focused, notice]);

  const apply = (decision: Decision): Outcome => {
    if (decision.type !== 'noop') {
      recordPackEvent(decision.record);
    }
    const result = outcome(decision, getSnapshot().board);
    SOUNDS[result.sound]();
    show({ tone: result.tone, title: result.title, detail: result.detail, long: result.done });
    if (result.openKey && result.openKey !== getSnapshot().openKey) {
      openPackage(result.openKey);
    }
    return result;
  };

  const handleScan = (code: string) => {
    const snap = getSnapshot();
    if (!snap.server) {
      feedbackError();
      show({ tone: 'error', title: 'No labels loaded', detail: 'Load labels first (⟳).' });
      return;
    }
    apply(decideScan(snap.board, snap.openKey, code));
  };

  const withPackage = (key: string, decide: (pkg: NonNullable<ReturnType<typeof find>>) => Decision) => {
    const pkg = find(key);
    if (pkg) {
      apply(decide(pkg));
    }
  };

  const foundIt = (key: string, sku: string) => withPackage(key, (pkg) => decideManual(pkg, sku));
  const markPacked = (key: string) => withPackage(key, decideMarkPacked);
  const undo = (key: string) => withPackage(key, decideUndo);

  /**
   * Before asking "Mark packed?": reload if the state is stale (≤ 3 s). Returns
   * false, with a banner, when the package turns out to be packed already.
   */
  const checkBeforeMarkPacked = async (key: string): Promise<boolean> => {
    await ensureFresh();
    const pkg = find(key);
    if (pkg?.packedAt) {
      const where = pkg.packedSource === 'desktop' ? ' on the desktop' : '';
      feedbackWarning();
      show({ tone: 'warning', title: `${pkg.pkg.name} is already packed${where}`, long: true });
      return false;
    }
    return Boolean(pkg);
  };

  return { banner, dismiss, handleScan, foundIt, markPacked, undo, checkBeforeMarkPacked };
}

function find(key: string) {
  const { board } = getSnapshot();
  return board.byKey.get(key) ?? board.byKey.get(board.orderIndex.get(key) ?? '') ?? null;
}
