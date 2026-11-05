# iOS 27 launch crash: UIScene lifecycle

Status: fixed on 2026-11-04 with Expo's SDK 57 scene support opt-in. Launch is confirmed on the phone. The changes are uncommitted as of this writing.

## Symptom

After installing a new build on the iPhone and trusting the developer certificate, the app flashed and closed immediately. No JS ran.

## Cause

Apps built with the iOS 27 SDK must use UIKit's scene lifecycle, or iOS stops them at launch ([Apple TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle.md)). The generated project had no `UIApplicationSceneManifest` in `Info.plist`, because Expo SDK 57 doesn't turn scene support on by default.

The crash report shows it:

```
EXC_BREAKPOINT (SIGTRAP), main thread
UIKitCore  ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke
```

## What it was not

**It is not a Debug vs Release problem.** That was an early theory, and testing ruled it out:

| Build (all Xcode 27, iOS 27 SDK) | Scene support | Result on the phone, 2026-11-04 |
|---|---|---|
| Oct 5 Debug build (re-signed, its profile had expired) | No | Crashes |
| Release | No | Crashes |
| Release, after the fix | Yes | Runs |

Debug and Release both crash without scene support, and the fix is what made the difference. A Debug build with the fix wasn't tested.

It also isn't related to the `fb-mkt` store change, which was just the reason for the rebuild.

## Open question: why did earlier builds work?

Not fully answered. The app was running on the phone as late as Oct 10, on builds made with Xcode 27 (installed around Oct 1) and no scene manifest. The same kind of build crashes now.

The likeliest explanation is that the phone's iOS changed after Oct 10. It's on iOS 27.0.1 now, but we couldn't see its update history, so this is unconfirmed. Neither Xcode nor macOS has been updated since Oct 1.

## The fix

Based on [Expo's instructions for SDK 57](https://github.com/expo/expo/issues/46664), which require Expo 57.0.23+ and `expo-build-properties` 57.0.20+.

1. Update Expo and its packages. This project moved from 57.0.19 to 57.0.31, with the other packages at the versions `npx expo install --check` expects.
2. Add `expo-build-properties` 57.0.22.
3. Pin `react-dom` to `19.2.3` as a direct dependency. Without it, `npm install` fails with `ERESOLVE`: npm pulls in a newer `react-dom` that needs a newer `react` than the pinned 19.2.3. Don't use `--force`.
4. Turn on scene support in the `plugins` list in `app.json`:

   ```json
   [
     "expo-build-properties",
     {
       "ios": {
         "enableSceneSupport": true
       }
     }
   ]
   ```

5. Regenerate the native project:

   ```sh
   npx expo prebuild -p ios --clean --no-install
   cd ios && pod install
   ```

To confirm it worked, `ios/productlistings/Info.plist` should contain `UIApplicationSceneManifest` with the delegate `EXExpoAppSceneDelegate`.

SDK 58 and later have scene support by default, so remove `enableSceneSupport` when upgrading.

## Building and installing on the phone

```sh
cd ios
xcodebuild -workspace productlistings.xcworkspace -scheme productlistings \
  -configuration Release -destination 'id=00008130-001C40C60142001C' \
  -derivedDataPath build -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=PR799TR8G6 CODE_SIGN_STYLE=Automatic build

xcrun devicectl device install app --device 00008130-001C40C60142001C \
  build/Build/Products/Release-iphoneos/productlistings.app
```

- **Why not `npx expo run:ios`:** with `--configuration Release` it failed with `No profiles for 'com.blickt.product-listings' were found`, because no local profile existed and it didn't let Xcode fetch one. `-allowProvisioningUpdates` fixes that.
- **Why pass the team:** `prebuild --clean` removes `DEVELOPMENT_TEAM` from the generated project, because `app.json` doesn't set `ios.appleTeamId`.
- **Why Release:** the JS is bundled into the app, so it runs without Metro or a cable.

## Things to watch

- **The profile only lasts 7 days.** The current one expires on 2026-11-11 at 16:46 PST, and the Oct 5 build's had also expired. Expect the app to stop opening after that until it's rebuilt and reinstalled. Check a build's expiry with:

  ```sh
  security cms -D -i ios/build/Build/Products/Release-iphoneos/productlistings.app/embedded.mobileprovision \
    | plutil -extract ExpirationDate raw -o - -
  ```

- **`prebuild --clean` has side effects.** It deletes all of `ios/`, including `ios/build`. It also changed the `ios` and `android` scripts in `package.json` to `expo run:*`; those were restored by hand to `expo start --*`.
- **`ios/` is gitignored and generated.** Native changes made directly in it won't survive a prebuild. They belong in `app.json`, a config plugin or `modules/`.
- **`enableSceneSupport` has a known limit on SDK 57.** It needs the standard Swift `AppDelegate`, so other config plugins that modify `AppDelegate` (Firebase, for example) may make prebuild fail.
- **One project reported this opt-in wasn't enough.** [Its app](https://github.com/usekaneo/kaneo/issues/2048) stuck on the launch screen because native modules never registered, and SDK 58 fixed it. This app didn't hit that, but it's the next thing to try if that symptom appears.

## Diagnosing a launch crash

Launching with a console shows whether the app reaches JS, and the crash report shows where it died:

```sh
UDID=00008130-001C40C60142001C

xcrun devicectl device process launch --device $UDID --terminate-existing \
  --console com.blickt.product-listings

xcrun devicectl device info files --device $UDID --domain-type systemCrashLogs | grep productlistings

xcrun devicectl device copy from --device $UDID --domain-type systemCrashLogs \
  --source <name>.ips --destination ./crash.ips
```

The app closes when a `--console` session ends, so an exit at that moment isn't a crash. Go by whether a new `.ips` report appears.

The `.ips` file is one line of JSON metadata followed by a JSON body. In the body, `faultingThread` is the index into `threads`, and each frame's `imageIndex` points into `usedImages`.
