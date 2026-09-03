-- Product Listings remote shutter trigger.
--
-- Pair the Bluetooth shutter remote to this Mac (Settings > Bluetooth) instead
-- of the iPhone. It emulates the hardware Volume Up key, so pressing it fires
-- a "SOUND_UP" system-defined key event here — the same key event a real
-- Mac keyboard's volume-up key sends. Short click -> take a photo. Held click
-- -> finish the session (crop/upload), same as the app's on-screen buttons.
--
-- KNOWN LIMITATION: while this script is running, your Mac's own physical
-- volume-up key will *also* trigger a capture, since system key events don't
-- carry a "which device sent this" field. In practice this is a non-issue —
-- you won't be adjusting Mac volume mid-shoot.
--
-- Setup:
--   1. brew install --cask hammerspoon
--   2. Put the shared token in mac-remote-trigger/.token (gitignored) — the
--      same value as EXPO_PUBLIC_APP_TOKEN / APP_SHARED_TOKEN.
--   3. Symlink this file: ln -sf "$(pwd)/mac-remote-trigger/init.lua" ~/.hammerspoon/init.lua
--   4. Launch Hammerspoon, grant it Accessibility + Input Monitoring when prompted.
--   5. Reload config (menu bar icon > Reload Config) after any edit here.

local WORKER_URL = "https://product-listings-upload-worker.blickt.workers.dev"
local TOKEN_FILE = os.getenv("HOME") .. "/Documents/src/product_listings/mac-remote-trigger/.token"
local HOLD_THRESHOLD_SECONDS = 0.5
local TRIGGER_KEY = "SOUND_UP" -- swap to "SOUND_DOWN" if your remote emits that instead

local function readToken()
  local file = io.open(TOKEN_FILE, "r")
  if not file then
    hs.alert.show("Remote trigger: missing " .. TOKEN_FILE)
    return nil
  end
  local token = file:read("*l")
  file:close()
  return token
end

local token = readToken()

local function sendTrigger(action)
  if not token then
    return
  end
  local url = WORKER_URL .. "/remote-trigger"
  local headers = {
    ["Content-Type"] = "application/json",
    ["Authorization"] = "Bearer " .. token,
  }
  local body = hs.json.encode({ action = action })
  hs.http.asyncPost(url, body, headers, function(status, responseBody)
    if status ~= 200 then
      hs.alert.show("Remote trigger failed (" .. tostring(status) .. ")")
      print("remote-trigger error:", status, responseBody)
    end
  end)
end

local pressedAt = nil
local holdTimer = nil
local triggerFired = false

local function cancelHoldTimer()
  if holdTimer then
    holdTimer:stop()
    holdTimer = nil
  end
end

-- NOTE: this MUST be a global (no `local`). Hammerspoon does not retain
-- eventtaps internally the way it does hs.hotkey.bind, so a local reference
-- gets garbage-collected shortly after init.lua finishes and the tap silently
-- stops firing — it appears to "work once per Reload Config" and then die.
-- A global lives for the whole Hammerspoon session and is rebuilt cleanly on
-- each config reload.
remoteWatcher = hs.eventtap.new({ hs.eventtap.event.types.systemDefined }, function(event)
  local info = event:systemKey()
  if not info or info.key ~= TRIGGER_KEY then
    return false -- not our key; let it through untouched
  end

  if info.down then
    -- Guard against key auto-repeat while the button stays held.
    if not pressedAt then
      pressedAt = hs.timer.secondsSinceEpoch()
      triggerFired = false
      cancelHoldTimer()
      -- Fire "done" the moment the hold threshold is reached, without waiting
      -- for release, so the app can start crop/upload while the button is
      -- still held.
      holdTimer = hs.timer.doAfter(HOLD_THRESHOLD_SECONDS, function()
        holdTimer = nil
        if pressedAt then -- still held
          triggerFired = true
          sendTrigger("done")
        end
      end)
    end
  else
    cancelHoldTimer()
    if pressedAt then
      pressedAt = nil
      -- If the threshold timer already sent "done", stay silent so we don't
      -- also fire a "capture" on release.
      if not triggerFired then
        sendTrigger("capture")
      end
    end
    triggerFired = false
  end

  return true -- suppress: no Mac volume change, no volume HUD
end)

remoteWatcher:start()

-- Fallback: plain keyboard shortcuts do the same thing, no remote needed.
hs.hotkey.bind({ "cmd", "shift" }, "c", function()
  sendTrigger("capture")
end)
hs.hotkey.bind({ "cmd", "shift" }, "d", function()
  sendTrigger("done")
end)
