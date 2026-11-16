#!/usr/bin/env bash
# Installs AXe into <dir> from EMD's pinned release archive, checked by
# SHA-256 (the pin is in src/core/device/axe.ts; prepare.sh copies it to
# axe-pin.json). For the primed group and the grader. Part of
# experiments/agent-baseline.
set -euo pipefail

dir=${1:?usage: install-axe.sh <dir>}
pin="$(dirname "$0")/axe-pin.json"
url=$(jq -r .url "$pin")
sha=$(jq -r .sha256 "$pin")

mkdir -p "$dir"
curl -fsSL --retry 3 -o "$dir.tar.gz" "$url"
echo "$sha  $dir.tar.gz" | shasum -a 256 -c -
tar -xzf "$dir.tar.gz" -C "$dir"
rm "$dir.tar.gz"
"$dir/axe" --version
