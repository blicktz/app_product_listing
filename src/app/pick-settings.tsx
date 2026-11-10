import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { DEFAULT_SERVER_URL, checkHealth } from '@/lib/pick/api';
import { setServerUrl } from '@/lib/pick/store';
import { usePickSnapshot } from '@/lib/pick/usePick';

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

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Server URL</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={(text) => {
          setUrl(text);
          setResult(null);
        }}
        placeholder="http://Pengs-Mac-Studio.local:8791"
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 12,
    backgroundColor: '#fff',
  },
  label: {
    fontSize: 13,
    color: '#8e8e93',
    textTransform: 'uppercase',
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 17,
  },
  help: {
    fontSize: 13,
    color: '#636366',
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
    borderColor: '#d1d1d6',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  primary: {
    backgroundColor: '#208AEF',
    borderColor: '#208AEF',
  },
  primaryText: {
    color: '#fff',
  },
  ok: {
    fontSize: 15,
    color: '#16a34a',
    fontWeight: '600',
  },
  fail: {
    fontSize: 15,
    color: '#dc2626',
    fontWeight: '600',
  },
});
