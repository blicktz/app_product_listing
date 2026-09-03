// Pick a rear lens that can autofocus on close subjects.
//
// Since SDK 57 expo-camera forces the bare `builtInWideAngleCamera` on iOS, and
// on recent iPhones (14/15 Pro) that lens cannot focus closer than ~20 cm. The
// virtual multi-camera devices (triple / dual-wide) let iOS automatically switch
// to the ultra-wide constituent for macro range, so close-up product shots stay
// in focus — this is what SDK 54 did implicitly.
//
// `CameraView.getAvailableLensesAsync()` returns localized
// `AVCaptureDevice.localizedName` strings, so match on keywords for both English
// and Simplified Chinese (the device we hit this on). Returns `undefined` when
// nothing matches (single-lens phone, or an unrecognized locale) — the caller
// then leaves `selectedLens` unset and expo-camera keeps its default.
export function selectCloseFocusLens(lenses: string[]): string | undefined {
  const match = (re: RegExp) => lenses.find((lens) => re.test(lens));
  return (
    match(/triple|三摄|三镜/i) ?? // builtInTripleCamera
    match(/dual[\s-]*wide|双广角/i) ?? // builtInDualWideCamera
    match(/ultra[\s-]*wide|超广角/i) // builtInUltraWideCamera — macro-capable, but 0.5x + edge distortion
  );
}
