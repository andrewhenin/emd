#!/usr/bin/env bash
# Prepares one trial of the agent baseline (#14) on a fresh macOS runner: the
# app in its own git repo, the group's tools, one pinned simulator and a warm
# build. Run by .github/workflows/agent-baseline.yml from the repo root, after
# `npm ci && npm run build`. Writes prepare.json (and the warm-up output) to
# OUT_DIR. Results: experiments/agent-baseline.md
#
# Env: ARM (raw, primed or emd), EMD_VERSION, CLAUDE_CODE_VERSION,
# DEVICE_NAME, HARNESS, APP_DIR, OUT_DIR.
set -euo pipefail

here=experiments/agent-baseline
mkdir -p "$OUT_DIR" "$HARNESS"

# The workflow deletes the repo checkout after this script, so a raw agent
# can't find EMD on disk. The later steps need only these: the scripts, and
# EMD's AXe pin and screen parser (dist/core/device/axe.js; Node built-ins only).
cp "$here"/*.ts "$here"/*.sh "$HARNESS/"
cp -R dist "$HARNESS/dist"
echo '{"type":"module"}' >"$HARNESS/package.json"
(cd "$HARNESS" && node -e 'import("./dist/core/device/axe.js").then((m) => console.log(JSON.stringify(m.axePin)))') >"$HARNESS/axe-pin.json"

# The app: the fixture at its committed state, in its own repo, so the agent's
# change is one diff. Only the primed group gets the AGENTS.md.
cp -R fixtures/expo "$APP_DIR"
if [ "$ARM" = primed ]; then
  cp "$here/primed-AGENTS.md" "$APP_DIR/AGENTS.md"
  echo "@AGENTS.md" >"$APP_DIR/CLAUDE.md"
fi
git -C "$APP_DIR" init -q
git -C "$APP_DIR" config user.name "baseline"
git -C "$APP_DIR" config user.email "baseline@example.invalid"
git -C "$APP_DIR" add -A
git -C "$APP_DIR" commit -qm "start"
npm ci --prefix "$APP_DIR"

# One simulator: the pinned device type on the runtime the selected Xcode
# builds for. Every other simulator is deleted, so the agent, EMD's clone and
# the grader all use the same type and runtime. It starts shut down, because
# EMD clones only a shut-down simulator.
sdk=$(xcrun --sdk iphonesimulator --show-sdk-version)
runtime="com.apple.CoreSimulator.SimRuntime.iOS-${sdk//./-}"
xcrun simctl shutdown all || true
udid=$(xcrun simctl list devices available -j |
  jq -r --arg r "$runtime" --arg n "$DEVICE_NAME" '[.devices[$r][]? | select(.name == $n) | .udid] | first // empty')
if [ -z "$udid" ]; then
  echo "No $DEVICE_NAME on $runtime."
  xcrun simctl list devices available
  exit 1
fi
xcrun simctl list devices -j | jq -r --arg u "$udid" '.devices[][] | select(.udid != $u) | .udid' |
  while IFS= read -r other; do xcrun simctl delete "$other" || true; done

# Claude Code, with an empty user config. EMD's setup registers itself there.
npm install -g "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION"
mkdir -p "$HOME/.claude"
[ -f "$HOME/.claude.json" ] || echo '{}' >"$HOME/.claude.json"

case "$ARM" in
emd)
  (cd "$APP_DIR" && npx -y "emd-agents@$EMD_VERSION" setup --yes) | tee "$OUT_DIR/setup.json"
  grep -q '"verdict":"done"' "$OUT_DIR/setup.json"
  ;;
primed)
  # The tools its AGENTS.md names: AXe, the same pinned release as EMD's.
  bash "$HARNESS/install-axe.sh" "$HOME/tools/axe"
  echo "$HOME/tools/axe" >>"$GITHUB_PATH"
  ;;
esac

# Warm build: each arm builds the way its agent will, so the trial's first
# build reuses the cache. A failed warm-up stops the job before the trial (see
# the end), because a cold trial is not the planned condition.
start=$(date +%s)
warmup=0
if [ "$ARM" = emd ]; then
  # From the app folder: in this repo, npx resolves emd-agents to the repo's
  # own package, which has no linked bin (exit 127).
  (cd "$APP_DIR" && npx -y "emd-agents@$EMD_VERSION" launch .) >"$OUT_DIR/warmup.json" 2>"$OUT_DIR/warmup.log" || warmup=$?
else
  (cd "$APP_DIR" && npx expo run:ios --device "$udid" --no-bundler) >"$OUT_DIR/warmup.log" 2>&1 || warmup=$?
fi
warmup_seconds=$(($(date +%s) - start))
bash "$HARNESS/stop.sh"

jq -n \
  --arg udid "$udid" --arg name "$DEVICE_NAME" --arg runtime "$runtime" \
  --arg xcode "$(xcodebuild -version | tr '\n' ' ')" \
  --arg macos "$(sw_vers -productVersion)" \
  --arg node "$(node --version)" \
  --arg claude "$(claude --version)" \
  --argjson warmupExit "$warmup" --argjson warmupSeconds "$warmup_seconds" \
  '{device: {udid: $udid, name: $name, runtime: $runtime}, xcode: $xcode,
    macos: $macos, node: $node, claudeCode: $claude,
    warmup: {exit: $warmupExit, seconds: $warmupSeconds}}' >"$OUT_DIR/prepare.json"
cat "$OUT_DIR/prepare.json"
if [ "$warmup" -ne 0 ]; then
  echo "The warm-up failed (exit $warmup), so the trial would start cold. Its output is in the records."
  exit 1
fi
