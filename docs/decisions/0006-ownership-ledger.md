# 0006: EMD records what it creates in a ledger, per worktree

Status: Accepted (2026-10-24)

## Context

Each worktree needs its own simulator, DerivedData and Metro port, and `gc`
(M2) may remove only what EMD made. Launches can start at the same moment.
Expo's `run:ios` has no DerivedData option and finds the built app by matching
`/Developer/Xcode/DerivedData/<name>/Build/Products/` in xcodebuild's output.

## Decision

- **Ledger:** `~/.emd/owned/<key>.json`, one file per worktree (`key` is a hash
  of its real path; `EMD_STATE_DIR` replaces `~/.emd`). It survives reboots,
  unlike the temp state dir.
- **Write-ahead:** an entry is written as `creating` before the resource
  exists, then `owned`. Entries leave only when a cleanup succeeds. A failed
  cleanup, or a crash mid-create, leaves the entry. A ledger that cannot be
  read is an error, never an empty ledger.
- **Atomic allocation:** one machine-wide lock file (`wx`, stale after 30 s)
  covers choosing a port and writing its entry. A relaunch gets the same entry.
- **Resources:** simulator (a clone of a shut-down iPhone, named `emd-<key>`),
  DerivedData (`~/.emd/derived/<key>/Developer/Xcode/DerivedData/<app>`) and
  the Metro port (first free from 8081). Xcode.app's DerivedData is never used.
- **DerivedData redirect:** an `xcodebuild` shim in `~/.emd/bin/<key>/`, first
  on the build's PATH, adds `-derivedDataPath`. It relies on Expo's output shape.
- **Failed-check count:** per worktree, in `~/.emd/checks/`, outside the
  worktree. A pass clears it; so does `emd check reset` (needs a terminal and a
  typed `reset`). The limit is 3 unless a person sets `EMD_RETRY_LIMIT`.
  `reset` and `retryLimit` are not agent inputs; `name` only labels evidence.

## Consequences

- Ports and clones stay reserved until `gc` exists. Disk use per worktree is in
  the launch result (`diskMB`).
- An agent with a raw shell can still edit the ledger or the check count, or
  set `EMD_RETRY_LIMIT`. This stops the tools, not a determined shell.
- Without a job, a check counts per device and app, so a different app ID
  starts a fresh count.
