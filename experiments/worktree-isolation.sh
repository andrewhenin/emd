#!/usr/bin/env bash
# Launches two worktrees of the sandbox at the same moment and prints, for
# each, the simulator, Metro port, DerivedData folder and disk use.
# Results: experiments/worktree-isolation.md
#
# Usage: experiments/worktree-isolation.sh [sandbox-dir] [timeout-seconds]
# Needs macOS, Xcode, `npm run build` done in this repo, and a sandbox app that
# builds (default ~/emd-sandbox). Cold builds take many minutes. Both worktrees
# are removed at the end; the simulators and ledger entries stay (EMD-owned).
set -eu

sandbox=${1:-$HOME/emd-sandbox}
timeout=${2:-2400}
emd="$(cd "$(dirname "$0")/.." && pwd)/dist/bin.js"
work=$(mktemp -d)

# The working files the sandbox has but git does not (node_modules, ios, edits).
for n in a b; do
  git -C "$sandbox" worktree add --detach "$work/sandbox-$n" HEAD >/dev/null
  rsync -a --exclude=/.git "$sandbox/" "$work/sandbox-$n/"
done

node "$emd" launch "$work/sandbox-a" --timeout "$timeout" >"$work/a.json" &
node "$emd" launch "$work/sandbox-b" --timeout "$timeout" >"$work/b.json" &
wait || true

for n in a b; do
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(JSON.stringify({
      worktree: process.argv[2], verdict: r.verdict, reason: r.reason,
      simulator: r.device, metroPort: r.metro?.port,
      derivedData: r.derivedData, diskMB: r.diskMB,
    }));
  ' "$work/$n.json" "sandbox-$n"
  pid=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).metro?.pid ?? ""' "$work/$n.json")
  # The dev server runs in its own process group; stop it.
  if [ -n "$pid" ]; then kill -- "-$pid" 2>/dev/null || true; fi
  git -C "$sandbox" worktree remove --force "$work/sandbox-$n"
done
rm -rf "$work"
