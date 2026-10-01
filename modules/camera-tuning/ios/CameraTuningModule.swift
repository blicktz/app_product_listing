import AVFoundation
import ExpoModulesCore

// Manual exposure / white balance for the back camera expo-camera is running.
//
// expo-camera (SDK 57) exposes no exposure or white-balance props on iOS. An
// AVCaptureDevice's settings live on the hardware device, so we look up the
// same device by its localized name (the `selectedLens` string the app passes
// to <CameraView>) and configure it directly; the change shows up in
// expo-camera's running session.
public class CameraTuningModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CameraTuning")

    AsyncFunction("getDeviceInfo") { (lensName: String?) -> [String: Any] in
      return Self.info(for: try Self.findDevice(lensName))
    }

    AsyncFunction("setManualExposure") { (lensName: String?, durationSec: Double, iso: Double, promise: Promise) in
      Self.run(promise) {
        let device = try Self.findDevice(lensName)
        guard device.isExposureModeSupported(.custom) else {
          throw UnsupportedException("custom exposure on \(device.localizedName)")
        }
        let format = device.activeFormat
        let minDuration = CMTimeGetSeconds(format.minExposureDuration)
        let maxDuration = CMTimeGetSeconds(format.maxExposureDuration)
        let duration = CMTimeMakeWithSeconds(
          min(max(durationSec, minDuration), maxDuration),
          preferredTimescale: 1_000_000
        )
        let clampedIso = min(max(Float(iso), format.minISO), format.maxISO)
        try Self.configure(device) {
          device.setExposureModeCustom(duration: duration, iso: clampedIso) { _ in
            promise.resolve(Self.info(for: device))
          }
        }
      }
    }

    AsyncFunction("setExposureBias") { (lensName: String?, ev: Double, promise: Promise) in
      Self.run(promise) {
        let device = try Self.findDevice(lensName)
        let bias = min(max(Float(ev), device.minExposureTargetBias), device.maxExposureTargetBias)
        try Self.configure(device) {
          // Bias only applies while auto-exposure is metering.
          if device.exposureMode != .continuousAutoExposure,
            device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
          }
          device.setExposureTargetBias(bias) { _ in
            promise.resolve(Self.info(for: device))
          }
        }
      }
    }

    AsyncFunction("lockExposure") { (lensName: String?) -> [String: Any] in
      let device = try Self.findDevice(lensName)
      guard device.isExposureModeSupported(.locked) else {
        throw UnsupportedException("exposure lock on \(device.localizedName)")
      }
      try Self.configure(device) {
        device.exposureMode = .locked
      }
      return Self.info(for: device)
    }

    AsyncFunction("lockWhiteBalance") { (lensName: String?, temperatureK: Double?, promise: Promise) in
      Self.run(promise) {
        let device = try Self.findDevice(lensName)
        guard device.isWhiteBalanceModeSupported(.locked) else {
          throw UnsupportedException("white balance lock on \(device.localizedName)")
        }
        guard let temperatureK else {
          // Freeze whatever auto-WB currently sees (aim at the empty backdrop).
          try Self.configure(device) {
            device.whiteBalanceMode = .locked
          }
          promise.resolve(Self.info(for: device))
          return
        }
        guard device.isLockingWhiteBalanceWithCustomDeviceGainsSupported else {
          throw UnsupportedException("custom white balance gains on \(device.localizedName)")
        }
        let gains = Self.clamp(
          device.deviceWhiteBalanceGains(
            for: AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(
              temperature: Float(temperatureK),
              tint: 0
            )
          ),
          for: device
        )
        try Self.configure(device) {
          device.setWhiteBalanceModeLocked(with: gains) { _ in
            promise.resolve(Self.info(for: device))
          }
        }
      }
    }

    AsyncFunction("resetAuto") { (lensName: String?) -> [String: Any] in
      let device = try Self.findDevice(lensName)
      try Self.configure(device) {
        if device.isExposureModeSupported(.continuousAutoExposure) {
          device.exposureMode = .continuousAutoExposure
        }
        device.setExposureTargetBias(0, completionHandler: nil)
        if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
          device.whiteBalanceMode = .continuousAutoWhiteBalance
        }
      }
      return Self.info(for: device)
    }
  }

  // Same device types and fallback expo-camera uses (Common/DeviceDiscovery.swift).
  private static let backDeviceTypes: [AVCaptureDevice.DeviceType] = [
    .builtInWideAngleCamera,
    .builtInTelephotoCamera,
    .builtInUltraWideCamera,
    .builtInTripleCamera,
    .builtInDualCamera,
    .builtInDualWideCamera
  ]

  private static func findDevice(_ lensName: String?) throws -> AVCaptureDevice {
    if let lensName {
      let session = AVCaptureDevice.DiscoverySession(
        deviceTypes: backDeviceTypes,
        mediaType: .video,
        position: .back
      )
      if let device = session.devices.first(where: { $0.localizedName == lensName }) {
        return device
      }
    }
    if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) {
      return device
    }
    throw DeviceNotFoundException(lensName ?? "default back camera")
  }

  private static func configure(_ device: AVCaptureDevice, _ body: () throws -> Void) throws {
    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }
    try body()
  }

  private static func run(_ promise: Promise, _ body: () throws -> Void) {
    do {
      try body()
    } catch let error as Exception {
      promise.reject(error)
    } catch {
      promise.reject("ERR_CAMERA_TUNING", error.localizedDescription)
    }
  }

  private static func clamp(
    _ gains: AVCaptureDevice.WhiteBalanceGains,
    for device: AVCaptureDevice
  ) -> AVCaptureDevice.WhiteBalanceGains {
    let maxGain = device.maxWhiteBalanceGain
    return AVCaptureDevice.WhiteBalanceGains(
      redGain: min(max(gains.redGain, 1), maxGain),
      greenGain: min(max(gains.greenGain, 1), maxGain),
      blueGain: min(max(gains.blueGain, 1), maxGain)
    )
  }

  private static func info(for device: AVCaptureDevice) -> [String: Any] {
    let format = device.activeFormat
    let gains = clamp(device.deviceWhiteBalanceGains, for: device)
    let whiteBalance = device.temperatureAndTintValues(for: gains)
    return [
      "lensName": device.localizedName,
      "deviceType": device.deviceType.rawValue,
      "exposureMode": exposureModeName(device.exposureMode),
      "exposureDurationSec": CMTimeGetSeconds(device.exposureDuration),
      "iso": Double(device.iso),
      "bias": Double(device.exposureTargetBias),
      "minIso": Double(format.minISO),
      "maxIso": Double(format.maxISO),
      "minDurationSec": CMTimeGetSeconds(format.minExposureDuration),
      "maxDurationSec": CMTimeGetSeconds(format.maxExposureDuration),
      "minBias": Double(device.minExposureTargetBias),
      "maxBias": Double(device.maxExposureTargetBias),
      "supportsCustomExposure": device.isExposureModeSupported(.custom),
      "supportsLockedExposure": device.isExposureModeSupported(.locked),
      "whiteBalanceMode": whiteBalanceModeName(device.whiteBalanceMode),
      "temperatureK": Double(whiteBalance.temperature),
      "tint": Double(whiteBalance.tint),
      "supportsCustomWhiteBalance": device.isLockingWhiteBalanceWithCustomDeviceGainsSupported
    ]
  }

  private static func exposureModeName(_ mode: AVCaptureDevice.ExposureMode) -> String {
    switch mode {
    case .locked: return "locked"
    case .autoExpose: return "auto"
    case .continuousAutoExposure: return "continuousAuto"
    case .custom: return "custom"
    @unknown default: return "unknown"
    }
  }

  private static func whiteBalanceModeName(_ mode: AVCaptureDevice.WhiteBalanceMode) -> String {
    switch mode {
    case .locked: return "locked"
    case .autoWhiteBalance: return "auto"
    case .continuousAutoWhiteBalance: return "continuousAuto"
    @unknown default: return "unknown"
    }
  }
}

internal final class DeviceNotFoundException: GenericException<String> {
  override var reason: String {
    "No back camera found for lens '\(param)'"
  }
}

internal final class UnsupportedException: GenericException<String> {
  override var reason: String {
    "Not supported: \(param)"
  }
}
