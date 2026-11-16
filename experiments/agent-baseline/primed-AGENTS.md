# AGENTS.md

An Expo app (SDK 58) for iOS. App ID: `com.emd.sandbox`. `axe` (AXe, a command-line tool for the iOS simulator) is on PATH.

## Commands

- List simulators: `xcrun simctl list devices`. Boot one: `xcrun simctl boot <udid>`.
- Build and install on a simulator: `npx expo run:ios --device <udid> --no-bundler`. The first build takes minutes.
- Start the dev server in the background: `npx expo start --port 8081 > /tmp/metro.log 2>&1 &`. It is ready when `curl -s localhost:8081/status` prints `packager-status:running`.
- Launch the app, and relaunch it after each code change: `xcrun simctl terminate <udid> com.emd.sandbox; xcrun simctl launch <udid> com.emd.sandbox`.
- App logs (`console.log` lines): `xcrun simctl spawn <udid> log show --last 5m --info --style compact --predicate 'processImagePath ENDSWITH "/<executable>"'`. The executable: `plutil -extract CFBundleExecutable raw "$(xcrun simctl get_app_container <udid> com.emd.sandbox)/Info.plist"`.
- Read the screen as an accessibility tree (JSON; visible text in `AXLabel`, testID in `AXUniqueId`): `axe describe-ui --udid <udid>`.
- Tap: `axe tap --label "<text>" --udid <udid>`, or `axe tap --id <testID> --udid <udid>`.
- Screenshot: `xcrun simctl io <udid> screenshot <file>.png`.
