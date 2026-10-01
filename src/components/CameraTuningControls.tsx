import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CameraTuningInfo } from '../../modules/camera-tuning';
import { EV_STEPS, ISO_STEPS, type CameraTuningSettings } from '@/lib/useCameraTuning';

type CameraTuningControlsProps = {
  settings: CameraTuningSettings;
  info: CameraTuningInfo | null;
  error: string | null;
  onChange: (patch: Partial<CameraTuningSettings>) => void;
};

function step(steps: number[], current: number, direction: 1 | -1) {
  const index = steps.findIndex((value) => value >= current);
  const from = index === -1 ? steps.length - 1 : index;
  return steps[Math.min(Math.max(from + direction, 0), steps.length - 1)];
}

function formatShutter(seconds: number) {
  return seconds > 0 && seconds < 1 ? `1/${Math.round(1 / seconds)}s` : `${seconds.toFixed(1)}s`;
}

export function CameraTuningControls({ settings, info, error, onChange }: CameraTuningControlsProps) {
  // Lenses without custom exposure fall back to AE + bias + lock, so the
  // stepper adjusts EV there instead of ISO.
  const usesIso = info?.supportsCustomExposure ?? true;
  // Same for WB: without custom gains the lock freezes the measured scene
  // value rather than wbTemperatureK, so don't show a temperature on the chip.
  const wbLabel =
    info?.supportsCustomWhiteBalance === false ? 'WB: LOCK' : `WB ${settings.wbTemperatureK}K`;
  const stepValue = (direction: 1 | -1) =>
    usesIso
      ? onChange({ iso: step(ISO_STEPS, settings.iso, direction) })
      : onChange({ ev: step(EV_STEPS, settings.ev, direction) });

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.row}>
        <Chip
          label={settings.manual ? 'Exposure: LOCK' : 'Exposure: AUTO'}
          active={settings.manual}
          onPress={() => onChange({ manual: !settings.manual })}
        />
        {settings.manual && (
          <View style={styles.stepper}>
            <Pressable style={styles.stepButton} onPress={() => stepValue(-1)} hitSlop={8}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.stepLabel}>
              {usesIso ? `ISO ${settings.iso}` : `${settings.ev >= 0 ? '+' : ''}${settings.ev} EV`}
            </Text>
            <Pressable style={styles.stepButton} onPress={() => stepValue(1)} hitSlop={8}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        )}
        {settings.manual && (
          <Chip
            label={settings.wbLocked ? wbLabel : 'WB: AUTO'}
            active={settings.wbLocked}
            onPress={() => onChange({ wbLocked: !settings.wbLocked })}
          />
        )}
      </View>
      {info && (
        <Text style={styles.readout}>
          {formatShutter(info.exposureDurationSec)} · ISO {Math.round(info.iso)} · {info.exposureMode}
          {' · '}
          {Math.round(info.temperatureK)}K {info.whiteBalanceMode}
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress} hitSlop={6}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    gap: 6,
    alignItems: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  chipActive: {
    backgroundColor: 'rgba(255,204,0,0.9)',
  },
  chipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#000',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  stepButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  stepText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  stepLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    minWidth: 64,
    textAlign: 'center',
  },
  readout: {
    color: '#fff',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    overflow: 'hidden',
  },
  error: {
    color: '#fff',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(200,0,0,0.75)',
    overflow: 'hidden',
  },
});
