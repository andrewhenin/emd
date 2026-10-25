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
  `-derivedDataPath` instead (decision 0005).
- A cold build of two worktrees at once did not finish in the 900 s default
  (two runs, 939 s each); with `--timeout 2400` the relaunch reused the
  partial DerivedData and took 260 s.

Reproduce: `git worktree add --detach <dir> HEAD` twice in the sandbox, copy
the untracked files in, run `emd launch <dir> --timeout 2400` on both at once,
and read `derivedData`, `diskMB`, `metro.port` and `device` from the results.
