#!/usr/bin/env bash
# Times two ways of reading the iOS simulator's accessibility tree, and checks
# each finds the sandbox app's testID and label. Results: experiments/screen-read.md
#
# Usage: experiments/screen-read.sh <simulator-udid> [runs]
# The sandbox app must be on screen (`emd launch ~/emd-sandbox`).
# maestro must be on PATH. AXe: on PATH, or AXE_BIN=/path/to/axe; skipped if absent.
set -u

udid=${1:?usage: screen-read.sh <simulator-udid> [runs]}
runs=${2:-2}
axe=${AXE_BIN:-$(command -v axe || true)}
export MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# timed <name> <command...>: one run, one line: name, seconds, bytes, found id, found label.
timed() {
  local name=$1
  shift
  local out="$work/out" clock="$work/clock"
  /usr/bin/time -p -o "$clock" "$@" >"$out" 2>/dev/null
  local status=$?
  local seconds
  seconds=$(awk '/^real/ {print $2}' "$clock")
  printf '%-18s %7ss  %7s bytes  exit=%s  testID(smoke-button)=%s  label(Ready)=%s\n' \
    "$name" "$seconds" "$(wc -c <"$out" | tr -d ' ')" "$status" \
    "$(grep -c 'smoke-button' "$out" | sed 's/^0$/no/; s/^[1-9].*/yes/')" \
    "$(grep -c '"Ready"' "$out" | sed 's/^0$/no/; s/^[1-9].*/yes/')"
}

# A read has to see the app, so bring it forward first: a tool's driver can send
# the app to the background (the Home screen's tree looks like a different app).
app=${APP_ID:-com.emd.sandbox}
foreground() {
  xcrun simctl launch "$udid" "$app" >/dev/null 2>&1
  sleep 3
}

echo "load average at start: $(uptime | sed 's/.*load averages*: *//')"
for i in $(seq "$runs"); do
  foreground
  timed "maestro hierarchy" maestro --device "$udid" hierarchy
done
if [ -n "$axe" ]; then
  for i in $(seq "$runs"); do
    foreground
    timed "axe describe-ui" "$axe" describe-ui --udid "$udid"
  done
else
  echo "axe: not found (put it on PATH or set AXE_BIN); skipped"
fi
echo "load average at end:   $(uptime | sed 's/.*load averages*: *//')"
