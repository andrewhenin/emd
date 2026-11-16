#!/usr/bin/env bash
# Leaves the simulator side clean between the warm-up, the trial and the
# grader: no dev server, the app uninstalled, every simulator shut down.
# Build caches stay. Part of experiments/agent-baseline.
set -uo pipefail

app=com.emd.sandbox

# Dev servers (Metro) are Node processes that listen on a port.
for pid in $(lsof -a -c node -iTCP -sTCP:LISTEN -t 2>/dev/null); do
  kill "$pid" 2>/dev/null
done
sleep 2
for pid in $(lsof -a -c node -iTCP -sTCP:LISTEN -t 2>/dev/null); do
  kill -9 "$pid" 2>/dev/null
done

for udid in $(xcrun simctl list devices booted -j | jq -r '.devices[][] | .udid'); do
  xcrun simctl terminate "$udid" "$app" 2>/dev/null
  xcrun simctl uninstall "$udid" "$app" 2>/dev/null
done
xcrun simctl shutdown all 2>/dev/null
exit 0
