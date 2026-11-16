import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { DEFAULT_SERVER_URL, checkHealth } from '@/lib/pick/api';
import { setServerUrl, setUploadDestination, type UploadDestination } from '@/lib/pick/store';
import { usePickSnapshot } from '@/lib/pick/usePick';
import { retryAll } from '@/lib/uploadQueue/runner';
import { colors, shared } from '@/lib/theme';

const DESTINATIONS: { value: UploadDestination; label: string }[] = [
  { value: 'mac', label: 'Mac' },
  { value: 'r2', label: 'R2' },
];

// Where the Mac Studio's portal answers on the home Wi-Fi.
export default function PickSettingsScreen() {
  const router = useRouter();
  const snap = usePickSnapshot();
  const [url, setUrl] = useState(snap.serverUrl);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(await checkHealth(url.trim()));
    setTesting(false);
  };

  const save = () => {
    setServerUrl(url);
    router.back();
  };

  const chooseDestination = (destination: UploadDestination) => {
    setUploadDestination(destination);
    // Jobs that were waiting on the old destination can go now.
    retryAll();
  };

  return (
    // Scrolls under the translucent sheet header.
    <ScrollView
      style={shared.screen}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>Server URL</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={(text) => {
          setUrl(text);
          setResult(null);
        }}
        placeholder="http://Pengs-Mac-Studio.local:8791"
        placeholderTextColor={colors.tertiaryLabel}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="done"
      />
      <Text style={styles.help}>
        With the scanner connected iOS hides the keyboard: double-press the scanner trigger to show
        it. Default: {DEFAULT_SERVER_URL || 'not set (EXPO_PUBLIC_PICK_SERVER_URL)'}
      </Text>

      <View style={styles.row}>
        <Pressable style={styles.button} onPress={test} disabled={testing}>
          {testing ? <ActivityIndicator /> : <Text style={styles.buttonText}>Test connection</Text>}
        </Pressable>
        <Pressable style={[styles.button, styles.primary]} onPress={save}>
          <Text style={[styles.buttonText, styles.primaryText]}>Save</Text>
        </Pressable>
      </View>
      {result !== null ? (
        <Text style={result ? styles.ok : styles.fail}>
          {result ? '✓ Mac is reachable' : '✕ Could not reach the Mac at this URL'}
        </Text>
      ) : null}
      <Text style={styles.help}>
        {snap.unsentCount > 0
          ? `${snap.unsentCount} pick event(s) are waiting to be sent to the Mac.`
          : 'All pick events have been sent to the Mac.'}
      </Text>

      <Text style={[styles.label, styles.section]}>Shoot uploads to</Text>
      <View style={styles.row}>
        {DESTINATIONS.map(({ value, label }) => {
          const selected = snap.uploadDestination === value;
          return (
            <Pressable
              key={value}
              style={[styles.button, selected ? styles.primary : null]}
              onPress={() => chooseDestination(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.buttonText, selected ? styles.primaryText : null]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.help}>
        Applies straight away. A job that has started uploading finishes where it started.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 12,
  },
  label: {
    fontSize: 13,
    color: colors.secondaryLabel,
    textTransform: 'uppercase',
  },
  section: {
    marginTop: 16,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 17,
    color: colors.label,
    backgroundColor: colors.card,
  },
  help: {
    fontSize: 13,
    color: colors.secondaryLabel,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.label,
  },
  primary: {
    backgroundColor: colors.blue,
    borderColor: colors.blue,
  },
  primaryText: {
    color: colors.white,
  },
  ok: {
    fontSize: 15,
    color: colors.green,
    fontWeight: '600',
  },
  fail: {
    fontSize: 15,
    color: colors.red,
    fontWeight: '600',
  },
});
