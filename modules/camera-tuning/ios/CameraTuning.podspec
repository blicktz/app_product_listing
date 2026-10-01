Pod::Spec.new do |s|
  s.name           = 'CameraTuning'
  s.version        = '1.0.0'
  s.summary        = 'Manual exposure and white balance for the active back camera'
  s.description    = 'Sets exposure / white balance on the AVCaptureDevice that expo-camera is using.'
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
