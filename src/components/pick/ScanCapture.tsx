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
export function ScanCapture({ onScan, enabled = true }: Props) {
  const inputRef = useRef<TextInput>(null);
  const bufferRef = useRef('');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  /** @param nativeText the field's full text at Enter, straight from iOS. */
  const submit = (nativeText?: string) => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    const code = normalizeScan(nativeText ?? bufferRef.current);
    bufferRef.current = '';
    inputRef.current?.clear();
    if (code.length >= 2) {
      onScanRef.current(code);
    }
  };

  const handleChange = (text: string) => {
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
