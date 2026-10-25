#!/usr/bin/env bash
# Times two ways of reading the iOS simulator's accessibility tree, as
# `emd check` would use them, and checks each read really saw the sandbox app.
# Results: experiments/screen-read.md
#
# Usage: experiments/screen-read.sh <simulator-udid> [rounds]
# The sandbox app must be installed and launched (`emd launch ~/emd-sandbox`).
# maestro must be on PATH. AXe: on PATH, or AXE_BIN=/path/to/axe; skipped if absent.
# Each round reads once with each tool, in alternating order. Before each read the
# app is brought forward and the script waits for the 1-minute load average to drop
# below MAX_LOAD (default 8), so a busy host does not decide the result.
set -u

udid=${1:?usage: screen-read.sh <simulator-udid> [rounds]}
rounds=${2:-5}
axe=${AXE_BIN:-$(command -v axe || true)}
app=${APP_ID:-com.emd.sandbox}
max_load=${MAX_LOAD:-8}
export MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
results="$work/results"
: >"$results"

load() { uptime | sed 's/.*load averages*: *//' | awk '{print $1}' | tr -d ,; }

# Bring the app forward (a tool's driver can send it to the background, and the
# Home screen's tree looks like a different app), then let the host calm down.
prepare() {
  xcrun simctl launch "$udid" "$app" >/dev/null 2>&1
  sleep 3
  for _ in $(seq 36); do
    awk -v l="$(load)" -v m="$max_load" 'BEGIN { exit !(l < m) }' && return
    sleep 5
  done
}

# read_once <name> <command...>: one timed read. Valid means exit 0 and the output
# holds the app's testID and label.
read_once() {
  local name=$1
  shift
  local out="$work/out" clock="$work/clock"
  prepare
  local before
  before=$(load)
  /usr/bin/time -p -o "$clock" "$@" >"$out" 2>/dev/null
  local status=$?
  local seconds valid=no
  seconds=$(awk '/^real/ {print $2}' "$clock")
  if [ "$status" = 0 ] && grep -q 'smoke-button' "$out" && grep -q '"Ready"' "$out"; then
    valid=yes
  fi
  echo "$name $seconds $valid" >>"$results"
  printf '%-18s %7ss  %7s bytes  exit=%s  saw the app=%s  load before=%s\n' \
    "$name" "$seconds" "$(wc -c <"$out" | tr -d ' ')" "$status" "$valid" "$before"
}

maestro_read() { read_once "maestro hierarchy" maestro --device "$udid" hierarchy; }
axe_read() { read_once "axe describe-ui" "$axe" describe-ui --udid "$udid"; }

echo "rounds: $rounds, max load before a read: $max_load, load now: $(load)"
for i in $(seq "$rounds"); do
  if [ $((i % 2)) = 1 ]; then
    maestro_read
    [ -n "$axe" ] && axe_read
  else
    [ -n "$axe" ] && axe_read
    maestro_read
  fi
done
[ -n "$axe" ] || echo "axe: not found (put it on PATH or set AXE_BIN); skipped"

echo
echo "summary (valid reads only: seconds)"
for tool in "maestro hierarchy" "axe describe-ui"; do
  total=$(grep -c "^$tool " "$results")
  [ "$total" = 0 ] && continue
  grep "^$tool .* yes$" "$results" | awk '{print $(NF-1)}' | sort -n | awk -v t="$tool" -v total="$total" '
    { v[NR] = $1 }
    END {
      if (NR == 0) { printf "%-18s no valid reads out of %d\n", t, total; exit }
      median = (NR % 2) ? v[(NR + 1) / 2] : (v[NR / 2] + v[NR / 2 + 1]) / 2
      printf "%-18s median %.1f  min %.1f  max %.1f  (%d valid of %d)\n", t, median, v[1], v[NR], NR, total
    }'
done
