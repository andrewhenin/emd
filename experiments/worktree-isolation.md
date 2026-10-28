# Two worktrees of the sandbox, launched at the same moment

2026-10-24, Xcode 27.1, `~/emd-sandbox` (Expo SDK 58), two git worktrees of it
(`sandbox-a`, `sandbox-b`, node_modules and ios copied in), `emd launch` run on
both in parallel. Cold builds, nothing cached.

| | worktree a | worktree b |
|---|---|---|
| Simulator | `emd-8e51b781ff8f` 2F5A67BF-C92F-476F-9462-EA1BFEDD2220 | `emd-99bc3a51cd78` 16972546-4FC9-41FD-B21B-4E51C283731E |
| Metro port | 8081 | 8082 |
| DerivedData | `~/.emd/derived/8e51b781ff8f/…/sandbox-a` | `~/.emd/derived/99bc3a51cd78/…/sandbox-b` |
| DerivedData size | 882 MB | 881 MB |
| Simulator data | 1207 MB | 1196 MB |
| Bundle served | `iOS Bundled 4214ms (713 modules)` by its own Metro | `iOS Bundled 4222ms (713 modules)` by its own Metro |

- Xcode.app's `~/Library/Developer/Xcode/DerivedData/emdsandbox-*` kept its
  Oct 24 21:04 timestamp: the builds did not touch it.
- Ledger entries for both: simulator, port, derivedData, all `owned`
  (port stays `creating` until Metro is ready; both were).
- Negative results: `expo run:ios --port` is refused with `--no-bundler`, so
  the port goes in as `RCT_METRO_PORT`. `ios/build` is not the build folder
  (Expo uses Xcode's default DerivedData); an `xcodebuild` shim on PATH adds
  `-derivedDataPath` instead (decision 0006).
- A cold build of two worktrees at once did not finish in the 900 s default
  (two runs, 939 s each); with `--timeout 2400` the relaunch reused the
  partial DerivedData and took 260 s.

## Run of the script, 2026-10-27: blocked by load

`experiments/worktree-isolation.sh` end to end, cold. Both worktrees compiled
(0 errors) on separate simulators (`emd-1f1ce4dcafc2`, `emd-8825c9ed16c3`) with
separate Metro ports (8093 for a, 8092 for b, from the ledger). Expo's
`simctl openurl` then timed out (POSIX 60) on both, so both launches ended
`failed`. The `__expo_url=…:8081` in those logs is Expo's deep link, not the
worktree's port. The end-to-end run is blocked by load, not passed; the
numbers above come from the 2026-10-24 run.

Reproduce: `experiments/worktree-isolation.sh [sandbox] [timeout]` (builds EMD first with `npm run build`).

## Which Metro each app loads from

Two Metros (8081, 8082) and the two proof simulators running, Expo's deep link
(`__expo_url=…:8081`, as in every launch log) sent to both, then `simctl launch`.
`lsof -a -p <app pid> -iTCP`: the app on the 8081 worktree held 4 connections to
8081; the app on the 8082 worktree held 4 to 8082. The port is most likely baked into the app
by `RCT_METRO_PORT` at build time (not isolated as the cause), so no `RCT_jsLocation` default was needed.
