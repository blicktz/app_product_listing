Pod::Spec.new do |s|
  s.name           = 'HardwareShutter'
  s.version        = '1.0.0'
  s.summary        = 'Volume-button / Bluetooth remote shutter events'
  s.description    = 'Reports hardware shutter presses (volume buttons, HID shutter remotes) to JS.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
