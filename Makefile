# Rebuild and reinstall the app on a connected iPhone.
#
#   make              build a Release build, install it and launch it (asks which phone)
#   make install DEVICE=<udid>   skip the prompt
#   make devices      list paired iPhones
#   make launch       launch the installed app
#   make expiry       show when the last build's provisioning profile expires
#   make prebuild     regenerate ios/ from app.json and install pods
#   make clean        delete the Xcode build folder
#
# The same build works on any iPhone. Building with a phone as the destination
# registers that phone in the signing profile, which is why we ask which one.

TEAM      := PR799TR8G6
BUNDLE_ID := com.blickt.product-listings
CONFIG    := Release
IOS_DIR   := ios
APP       := $(IOS_DIR)/build/Build/Products/$(CONFIG)-iphoneos/productlistings.app
PICK      := ./scripts/pick-iphone.sh

.DEFAULT_GOAL := install
.PHONY: install build launch devices expiry prebuild pods clean check

install: check
	@set -e; \
	udid="$${DEVICE:-$$($(PICK))}"; \
	$(MAKE) --no-print-directory build DEVICE="$$udid"; \
	echo "==> Installing on $$udid"; \
	xcrun devicectl device install app --device "$$udid" "$(APP)"; \
	echo "==> Launching"; \
	xcrun devicectl device process launch --device "$$udid" --terminate-existing $(BUNDLE_ID) \
	  || echo "Installed, but launch failed. If the phone says 'Untrusted Developer', trust it in Settings > General > VPN & Device Management."

build: check
	@set -e; \
	udid="$${DEVICE:-$$($(PICK))}"; \
	echo "==> Building $(CONFIG) for $$udid"; \
	cd $(IOS_DIR) && xcodebuild -workspace productlistings.xcworkspace -scheme productlistings \
	  -configuration $(CONFIG) -destination "id=$$udid" \
	  -derivedDataPath build -allowProvisioningUpdates \
	  DEVELOPMENT_TEAM=$(TEAM) CODE_SIGN_STYLE=Automatic \
	  -quiet build
	@echo "==> Built $(APP)"

launch:
	@udid="$${DEVICE:-$$($(PICK))}"; \
	xcrun devicectl device process launch --device "$$udid" --terminate-existing $(BUNDLE_ID)

devices:
	@xcrun devicectl list devices | grep -E 'Identifier|physical' || true

expiry:
	@security cms -D -i "$(APP)/embedded.mobileprovision" | plutil -extract ExpirationDate raw -o - -

# Wipes ios/ (including ios/build). See docs/ios-27-launch-crash.md.
prebuild:
	@# prebuild rewrites the "ios"/"android" scripts in package.json; put them back.
	cp package.json package.json.bak
	npx expo prebuild -p ios --clean --no-install
	mv package.json.bak package.json
	$(MAKE) --no-print-directory pods

pods:
	cd $(IOS_DIR) && pod install

clean:
	rm -rf $(IOS_DIR)/build

check:
	@test -d node_modules || { echo "node_modules missing: run 'npm install' first."; exit 1; }
	@test -d $(IOS_DIR)/productlistings.xcworkspace || { echo "ios/ missing: run 'make prebuild' first."; exit 1; }
	@test -d $(IOS_DIR)/Pods || { echo "Pods missing: run 'make pods' first."; exit 1; }
