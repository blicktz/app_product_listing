import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { checkSku } from '@/lib/uploadApi';

function formatDateRoot(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type SkuCheck = {
  sku: string;
  count: number;
  nextNumber: number;
};

export default function HomeScreen() {
  const router = useRouter();
  const [dateRoot] = useState(() => formatDateRoot(new Date()));
  const [sku, setSku] = useState('');
  const [skuCheck, setSkuCheck] = useState<SkuCheck | null>(null);
  const [isStartingCapture, setIsStartingCapture] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setSku('');
      setSkuCheck(null);
    }, [])
  );

  useEffect(() => {
    const trimmedSku = sku.trim();
    if (!trimmedSku) {
      return;
    }

    const timer = setTimeout(() => {
      checkSku(dateRoot, trimmedSku)
        .then((result) => {
          setSkuCheck({ sku: trimmedSku, ...result });
        })
        .catch(() => {
          // Background check failed silently; Start Capture will retry on demand.
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [sku, dateRoot]);

  const canStartCapture = sku.trim().length > 0 && !isStartingCapture;

  const handleStartCapture = async () => {
    const trimmedSku = sku.trim();
    if (!trimmedSku || isStartingCapture) {
      return;
    }

    let nextNumber: number;
    if (skuCheck?.sku === trimmedSku) {
      nextNumber = skuCheck.nextNumber;
    } else {
      setIsStartingCapture(true);
      try {
        const result = await checkSku(dateRoot, trimmedSku);
        setSkuCheck({ sku: trimmedSku, ...result });
        nextNumber = result.nextNumber;
      } catch {
        setIsStartingCapture(false);
        Alert.alert(
          'Could Not Verify SKU',
          'Unable to check for existing photos. Check your connection and try again.'
        );
        return;
      }
      setIsStartingCapture(false);
    }

    router.push({
      pathname: '/camera',
      params: { sku: trimmedSku, dateRoot, startNumber: String(nextNumber) },
    });
  };

  const existingCount = skuCheck?.sku === sku.trim() ? skuCheck.count : null;

  return (
    <View style={styles.container}>
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionLabel}>Session folder</Text>
        <Text style={styles.sessionValue}>{dateRoot}/</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.inputLabel}>SKU</Text>
        <TextInput
          style={styles.input}
          value={sku}
          onChangeText={setSku}
          placeholder="Enter SKU"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {existingCount !== null && existingCount > 0 && (
          <Text style={styles.existingFilesText}>Existing files: {existingCount}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 32,
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
  input: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
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
