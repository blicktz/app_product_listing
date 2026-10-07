# Remote shutter on the phone: open issue and debug log

Status: under observation. Started 2026-10-07. Review the log around **2026-10-14**, after about a week of normal use.

## Background

The Bluetooth shutter remote can now be paired to the iPhone directly instead of the Mac. The app handles it with the local Expo module `modules/hardware-shutter` (branch `native-remote-shutter`). The Hammerspoon → Worker relay (`mac-remote-trigger/init.lua`) still works as a fallback when the remote is paired to the Mac.

The remote is a Bluetooth HID keyboard that sends **Volume Up**. The app catches it in two ways:

| Screen | Mode | How it works |
|---|---|---|
| Camera | `capture` | `AVCaptureEventInteraction` (iOS 17.2+). Reports press and release, so a click takes a photo and a hold of 0.5 s or more runs Done. The volume doesn't change. |
| Home | `volume` | No camera is running, so the app watches the system output volume. Each change counts as a click (Start Capture), and the app then resets the volume to 0.5. A hidden `MPVolumeView` keeps the volume HUD from appearing. |

`src/lib/useHardwareShutter.ts` switches between the modes as screens gain and lose focus.

## Bugs fixed so far

1. **Camera screen ignored the buttons** (fixed in `04234d8`). `AVCaptureEventInteraction` needs `isEnabled = true`, and it has to be attached to a view inside the app's screens (the root view controller's view), not the window.
2. **Home ignored the remote on a cold start until the camera had been opened once** (fixed in `61ba4a1`).
   - Cause: when the app arms Home's listener, setting the volume slider right after the `MPVolumeView` is added is silently ignored. If the phone started at max volume, the volume stayed at 1.0. Volume Up at max changes nothing, so no press was seen.
   - Fix: `resetVolume` retries every 0.1 s (up to 30 times) until the volume actually reaches 0.5. In testing, attempt 0 always failed and attempt 1 succeeded.

## Open issue

After the fix in `61ba4a1`, one fresh test with the clean build (debug logging removed) failed: the remote didn't start capture from Home. Every test before and after it passed, including cold starts at max volume and launches from the home-screen icon. The cause is unknown. Candidates:

- **The remote was asleep.** Cheap shutter remotes sleep after a few minutes idle, and the first press only wakes them and reconnects. If so, a second press works.
- **Something deactivates the app's audio session or changes its category during startup.** That would stop the volume watcher from receiving changes.
- **A launch or lifecycle path that hasn't been seen yet**, such as the app returning from the background or a phone call or other audio interruption.

## Debug logging (temporary, on the phone only)

The build installed on the iPhone writes a debug log. The logging is committed on `native-remote-shutter` together with this doc, and is meant to be removed later. It lives in `modules/hardware-shutter/ios/HardwareShutterModule.swift` as code marked `HS-DEBUG`: the `dbg()` helper, `debugObservers`, and the calls in `OnCreate`, `apply`, `emit`, the KVO callback, `setActive` and `resetVolume`.

Each line logs the event plus the current output volume, the audio session category, and `isOtherAudioPlaying`. It records:
- module creation
- every mode change (`apply`), with the app state
- every volume KVO callback and every reset attempt
- every emitted event (`click`, `down`, `up`, `cancel`)
- a failed `setActive`
- audio session notifications (interruption, route change, media services reset, silence secondary audio)
- app lifecycle notifications (active, resign active, background, foreground)

The file is `Documents/hs-debug.log` in the app's data container. It is append-only and grows slowly (roughly 100 bytes per line).

### When the remote fails on Home

1. Press the remote a **second time**. If that works, note it; that points to the remote waking from sleep.
2. Write down the approximate time, and what happened just before (cold start, back from the background, music playing, phone call, scanning, and so on).

### Pulling the log

With the iPhone connected to the Mac (USB or the same network) and unlocked:

```sh
xcrun devicectl device copy from \
  --device 00008130-001C40C60142001C \
  --domain-type appDataContainer \
  --domain-identifier com.blickt.product-listings \
  --source Documents/hs-debug.log \
  --destination ./hs-debug.log
```

Lines start with a Unix timestamp. To print them as local times:

```sh
python3 -c '
import datetime, sys
for l in open(sys.argv[1]):
    t, rest = l.split(" ", 1)
    print(datetime.datetime.fromtimestamp(float(t)).strftime("%m-%d %H:%M:%S.%f")[:-3], rest.rstrip())
' hs-debug.log
```

### What to look for around a failure

- **A healthy Home press:** `apply volume` → `resetVolume attempt 0` → `attempt 1` → `KVO 0.5` → (press) `KVO 0.55` → `emit click` → `apply capture`.
- **No KVO line at all when the press happened:** the volume watcher wasn't getting changes. Check the lines just before for a `setActive failed`, an interruption or route-change notification, a category other than `AVAudioSessionCategoryAmbient`, or lifecycle events (background/foreground) with no re-arm afterwards.
- **`resetVolume` reaching attempt 30 with `vol=1.0`:** the reset never landed, so Volume Up at max couldn't register.
- **`emit click` present but the camera didn't open:** the problem is on the JS side. Check that the SKU was entered and the listing config chosen, and look at `handleStartCapture` in `src/app/index.tsx`.
- **Nothing logged for the first press, but the second press logged normally:** the remote was waking up. Not an app bug.

## After the investigation

- Fix whatever the log shows.
- Remove all `HS-DEBUG` code from `HardwareShutterModule.swift`. The simplest way is to restore that file from the commit before the logging was added: `git checkout <logging-commit>^ -- modules/hardware-shutter/ios/HardwareShutterModule.swift`, where `git log -- docs/remote-shutter-debug-log.md` shows the logging commit. Then re-apply any real fix.
- Rebuild and install: `cd ios && xcodebuild … build`, then `xcrun devicectl device install app …`, or `npx expo run:ios --device`.
- Update this doc with the outcome.
