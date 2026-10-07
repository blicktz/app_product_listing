import AVFoundation
import AVKit
import ExpoModulesCore
import MediaPlayer
import UIKit

// Hardware shutter presses: the phone's volume buttons and Bluetooth shutter
// remotes (which pair as a HID keyboard and send Volume Up), so the remote can
// drive the app directly instead of via the Mac/Hammerspoon relay.
//
// Two modes, chosen by the focused screen:
// - "capture": AVCaptureEventInteraction (iOS 17.2+), Apple's hardware-shutter
//   API. Reports press ("down") and release ("up") separately, so JS can tell a
//   click from a hold, and the system volume is left alone. It only fires while
//   an AVCaptureSession is running, i.e. on the camera screen.
// - "volume": for screens without a camera. Watches the system output volume,
//   reports each change as a "click", and puts the volume back. An off-screen
//   MPVolumeView keeps the system volume HUD from appearing.
public class HardwareShutterModule: Module {
  // A mid-range volume so a Volume Up press is never lost at max volume.
  // Volume steps are 1/16, so 0.5 is exactly reachable.
  private static let restingVolume: Float = 0.5
  // Holding the button auto-repeats volume changes; collapse them into one click.
  private static let clickDebounce: TimeInterval = 0.4
  // Our own resets (and entering the mode) cause volume changes too.
  private static let settleTime: TimeInterval = 0.5

  private var mode = "off"
  private var interaction: UIInteraction?
  private weak var interactionView: UIView?
  private var volumeView: MPVolumeView?
  private var volumeObservation: NSKeyValueObservation?
  private var activeObserver: NSObjectProtocol?
  private var savedVolume: Float?
  private var ignoreVolumeUntil = Date.distantPast
  private var lastClickAt = Date.distantPast

  public func definition() -> ModuleDefinition {
    Name("HardwareShutter")

    Events("onShutter")

    Function("setMode") { (mode: String) in
      DispatchQueue.main.async {
        self.apply(mode)
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.apply("off")
      }
    }
  }

  private func apply(_ newMode: String) {
    guard newMode != mode else {
      return
    }
    teardown()
    switch newMode {
    case "capture":
      // Pre-17.2 iOS has no capture event API; the volume watcher still gives clicks.
      mode = startCaptureMode() ? "capture" : (startVolumeMode() ? "volume" : "off")
    case "volume":
      mode = startVolumeMode() ? "volume" : "off"
    default:
      mode = "off"
    }
  }

  private func teardown() {
    if let interaction {
      interactionView?.removeInteraction(interaction)
    }
    interaction = nil
    interactionView = nil
    stopVolumeMode()
    mode = "off"
  }

  private func emit(_ type: String) {
    sendEvent("onShutter", ["type": type])
  }

  // MARK: - Capture mode

  private func startCaptureMode() -> Bool {
    guard #available(iOS 17.2, *), let window = Self.keyWindow() else {
      return false
    }
    let handler: (AVCaptureEvent) -> Void = { [weak self] event in
      switch event.phase {
      case .began:
        self?.emit("down")
      case .ended:
        self?.emit("up")
      case .cancelled:
        self?.emit("cancel")
      @unknown default:
        break
      }
    }
    // Primary is Volume Up (what the remote sends), secondary is Volume Down.
    let interaction = AVCaptureEventInteraction(primary: handler, secondary: handler)
    window.addInteraction(interaction)
    self.interaction = interaction
    interactionView = window
    return true
  }

  // MARK: - Volume mode

  private func startVolumeMode() -> Bool {
    guard let window = Self.keyWindow() else {
      return false
    }
    // Output volume is only reported while our audio session is active.
    // Ambient + mixWithOthers leaves any playing music alone.
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.ambient, options: [.mixWithOthers])
    try? session.setActive(true)

    let volumeView = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 100, height: 40))
    volumeView.alpha = 0.01
    volumeView.isUserInteractionEnabled = false
    window.addSubview(volumeView)
    self.volumeView = volumeView

    savedVolume = session.outputVolume
    resetVolume()

    volumeObservation = session.observe(\.outputVolume, options: [.new]) { [weak self] _, change in
      guard let volume = change.newValue else {
        return
      }
      DispatchQueue.main.async {
        self?.volumeChanged(volume)
      }
    }
    // Volume may have changed (and the session been interrupted) while backgrounded.
    activeObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self, self.mode == "volume" else {
        return
      }
      try? AVAudioSession.sharedInstance().setActive(true)
      self.resetVolume()
    }
    return true
  }

  private func stopVolumeMode() {
    guard let volumeView else {
      return
    }
    volumeObservation?.invalidate()
    volumeObservation = nil
    if let activeObserver {
      NotificationCenter.default.removeObserver(activeObserver)
    }
    activeObserver = nil
    if let savedVolume {
      Self.setVolume(savedVolume, using: volumeView)
    }
    savedVolume = nil
    self.volumeView = nil
    // Keep the view around until the restore has applied, so it doesn't show the HUD.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      volumeView.removeFromSuperview()
    }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func volumeChanged(_ volume: Float) {
    guard mode == "volume", let volumeView else {
      return
    }
    let now = Date()
    if now < ignoreVolumeUntil || abs(volume - Self.restingVolume) < 0.001 {
      return
    }
    if now.timeIntervalSince(lastClickAt) > Self.clickDebounce {
      lastClickAt = now
      emit("click")
    }
    Self.setVolume(Self.restingVolume, using: volumeView)
  }

  private func resetVolume() {
    guard let volumeView else {
      return
    }
    ignoreVolumeUntil = Date().addingTimeInterval(Self.settleTime)
    Self.setVolume(Self.restingVolume, using: volumeView)
  }

  // MPVolumeView's slider is the only public way to set the system volume. It is
  // created lazily, so retry once on the next run loop if it isn't there yet.
  private static func setVolume(_ volume: Float, using volumeView: MPVolumeView, retry: Bool = true) {
    if let slider = volumeView.subviews.compactMap({ $0 as? UISlider }).first {
      slider.value = volume
    } else if retry {
      DispatchQueue.main.async {
        setVolume(volume, using: volumeView, retry: false)
      }
    }
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }
}
