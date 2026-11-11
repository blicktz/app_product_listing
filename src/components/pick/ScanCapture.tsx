import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { normalizeScan } from '@/lib/pick/scan';

// Invisible input that receives the Bluetooth scanner's keystrokes. In HID mode
// the scanner is a keyboard: each scan "types" the barcode and presses Enter.
// It stays focused while its screen is in front; the on-screen keyboard is
// suppressed so nothing pops up when the scanner is off.

// Fallback for scanners set to send no Enter suffix: a scan is a burst of
// keystrokes, so a short pause ends it.
const IDLE_SUBMIT_MS = 250;
const REFOCUS_MS = 800;

type Props = {
  onScan: (code: string) => void;
  /** Off while something else needs the keyboard (a prompt, a text field). */
  enabled?: boolean;
};

// The input is uncontrolled: iOS owns its text. A controlled value is echoed
// back from JS, and while JS is busy (a pick, a screen opening) the echo can
// carry stale text and drop keystrokes mid-scan, so a long label arrives
// garbled and only a second scan works.
//
// clear() can't be trusted either: it carries TextInput's event count, which JS
// only updates on a re-render, and iOS ignores a clear whose count is stale.
// Right after a scan JS is busy, so the clear is silently dropped and the next
// scan is typed after the old one (AAU-1110-003AAU-1110-001). We remember the
// text already consumed and strip it from the front of the next scan.
const RETRY_CLEAR_MS = 100;

export function ScanCapture({ onScan, enabled = true }: Props) {
  const inputRef = useRef<TextInput>(null);
  const bufferRef = useRef('');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The field's text at the last submit, which may still be in it (see below). */
  const consumedRef = useRef('');
  const [screenFocused, setScreenFocused] = useState(false);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, [])
  );

  const active = enabled && screenFocused;

  useEffect(() => {
    if (!active) {
      inputRef.current?.blur();
      return;
    }
    inputRef.current?.focus();
    // Taps on buttons or a closed alert take focus away; take it back.
    const timer = setInterval(() => {
      if (inputRef.current && !inputRef.current.isFocused()) {
        inputRef.current.focus();
      }
    }, REFOCUS_MS);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (retryClearTimer.current) clearTimeout(retryClearTimer.current);
    },
    []
  );

  /** @param nativeText the field's full text at Enter, straight from iOS. */
  const submit = (nativeText?: string) => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    const fieldText = nativeText ?? bufferRef.current;
    let raw = fieldText;
    // A dropped clear() leaves the last scan in the field; the new one is typed after it.
    const consumed = consumedRef.current;
    if (consumed && raw.startsWith(consumed)) {
      raw = raw.slice(consumed.length);
    }
    consumedRef.current = fieldText;
    const code = normalizeScan(raw);
    bufferRef.current = fieldText;
    inputRef.current?.clear();
    // Try again once JS has caught up. If new keystrokes reached iOS meanwhile,
    // iOS rejects the clear itself, so a scan in progress is never wiped.
    if (retryClearTimer.current) clearTimeout(retryClearTimer.current);
    retryClearTimer.current = setTimeout(() => {
      retryClearTimer.current = null;
      if (consumedRef.current && bufferRef.current === consumedRef.current) {
        inputRef.current?.clear();
      }
    }, RETRY_CLEAR_MS);
    if (code.length >= 2) {
      onScanRef.current(code);
    }
  };

  const handleChange = (text: string) => {
    // Text that no longer starts with the last scan means the clear worked.
    if (consumedRef.current && !text.startsWith(consumedRef.current)) {
      consumedRef.current = '';
    }
    bufferRef.current = text;
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
    }
    idleTimer.current = setTimeout(() => submit(), IDLE_SUBMIT_MS);
  };

  return (
    <TextInput
      ref={inputRef}
      style={styles.hidden}
      onChangeText={handleChange}
      onSubmitEditing={(e) => submit(e.nativeEvent.text)}
      submitBehavior="submit"
      showSoftInputOnFocus={false}
      // An ASCII keyboard keeps a Chinese (pinyin) input method from catching
      // the keystrokes in its composition bar.
      keyboardType="ascii-capable"
      autoCapitalize="characters"
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      caretHidden
      contextMenuHidden
      accessible={false}
      importantForAutofill="no"
    />
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    top: -10,
  },
});
