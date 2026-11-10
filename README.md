# EMD: Everything Mobile Development

EMD is an MCP server and CLI. It lets a coding agent launch an Expo app on the iOS simulator, check it, and collect evidence.

Status: early, not on npm yet. Install from source.

## What works today

Stack: Expo (React Native). `detect` reports iOS and Android. `launch` runs on the iOS simulator only.

MCP tools (`emd mcp`):

- `detect`: finds the stack, platforms, app IDs, run commands and package manager of a folder. At a workspace root, it lists the app folders instead (`apps`).
- `launch`: builds the app, installs and opens it on an iOS simulator, and keeps its dev server running. Returns a job at once.
- `job_status`: the state of a job (queued, running, succeeded, failed) and, at the end, its result.
- `logs`: the `[EMD:<tag>]` lines that the app wrote during the run of a launch job.
- `check`: passes or fails a run from tagged log lines and on-screen elements (by testID or text). Returns a job.
- `evidence`: puts the checks, log lines, screenshots and Maestro flows of a run in one folder.

CLI commands (`node dist/bin.js <command>`):

- `detect [dir]`: same as the tool.
- `launch [dir] [--device X] [--timeout N]`: same as the tool, but waits for the result.
- `job status <id>`: reads a job.
- `logs <jobId> [--tag T] [--limit N]`: same as the tool.
- `check <jobId> [--log TAG[=TEXT]] [--element id=X|text=Y] [--name N] [--agent pass|fail]`: same as the tool, but waits.
- `check reset [dir]`: clears the failed-check count. A person must type `reset` at a terminal.
- `evidence <jobId>`: same as the tool.
- `gc [--apply]`: lists, then removes, what EMD made for app folders that no longer exist.
- `mcp`: starts the MCP server on stdio.

## Requirements

- An Expo app with `expo` in package.json and `ios.bundleIdentifier` in its app config (app.json, app.config.js or app.config.ts). EMD reads it with the app's own `expo config`. Without the ID, `launch` stops: "No iOS app ID found".
- The app's dependencies, installed. EMD does not install them.
- macOS. On other systems `detect` works, and `launch` returns "iOS simulators need macOS."
- Xcode, tested with Xcode 26 and 27. Expo SDK 58 apps need Xcode 26 or newer. Without Xcode, `launch` fails: "Could not set up this worktree's simulator and build folders."
- An iOS simulator runtime and at least one shut-down iPhone simulator. EMD clones it once per app folder, as `emd-<key>`. Without one, `launch` fails: "No shut-down iPhone simulator is available to clone."
- Node 22 or newer.
- AXe or Maestro, for element checks only. EMD tries AXe first, then Maestro.
  - AXe (optional, about 40 times faster): `brew install cameroncooke/axe/axe`. With Xcode 27, Device Hub must be running.
  - Maestro: `curl -fsSL "https://get.maestro.mobile.dev" | bash`. It needs Java 17 or newer, with `JAVA_HOME` set.
  - With neither, a check with elements returns `error`. `launch`, `logs`, log checks and `evidence` still work.

## Install from source

```sh
git clone https://github.com/andrewhenin/emd.git
cd emd
npm ci
npm run build
node dist/bin.js detect fixtures/expo
```

The last line must print `"verdict":"detected"` and `"appIds":{"ios":"com.emd.sandbox"}`.

Register `emd mcp` with your agent. Run these lines in the `emd` folder, so that `$PWD` is its full path.

- Claude Code ([docs](https://code.claude.com/docs/en/mcp)): `claude mcp add --scope user --transport stdio emd -- node "$PWD/dist/bin.js" mcp`. `--scope user` makes EMD available in all your projects. Check with `claude mcp list`.
- Codex ([docs](https://developers.openai.com/codex/mcp)): `codex mcp add emd -- node "$PWD/dist/bin.js" mcp`. This writes `[mcp_servers.emd]` in `~/.codex/config.toml`. Check with `/mcp` in Codex.
- Cursor ([docs](https://cursor.com/docs/mcp)): add `{ "mcpServers": { "emd": { "command": "node", "args": ["/full/path/to/emd/dist/bin.js", "mcp"] } } }` to `~/.cursor/mcp.json`, with the full path of your `emd` folder. Check under Output > MCP Logs.

EMD does not tap or type. For that, also register [MobileBuildMCP](https://github.com/getsentry/MobileBuildMCP) with your agent; its README has the steps. EMD's e2e tests one version of it, pinned in `test/e2e/launch.test.ts`.

## First run

1. In your app, log an event with a tag, for example `console.log("[EMD:ready] home shown")`. Give a testID to each element that you want to check.
2. Ask your agent, with the full path of your app:

   > Use the emd tools on /path/to/my-app. Launch it on the iOS simulator. Check that the `ready` log event fired and that the element with testID `home` is on screen. Then gather the evidence and tell me the folder.

The agent then runs this loop:

1. `launch`, with `dir` set to your app. It returns a `jobId` at once.
2. `job_status` every 5 to 10 seconds, until `succeeded` or `failed`. A first build takes minutes. A failed launch gives the reason and the first error lines.
3. To tap, type or swipe: MobileBuildMCP's `snapshot_ui`, then `tap` (or `type_text`, `swipe`), on the simulator from the launch result (`device.id`).
4. `logs`, to read the tagged lines.
5. `check`, with the expected log events and elements, then `job_status` until it ends. The verdict is `passed`, `failed` (fix and check again), `stopped` (3 failed checks: stop and report) or `error` (the check could not run).
6. `evidence`, to write the evidence folder.

Output stays on your Mac:

- Each launch has a run folder, `$TMPDIR/emd/runs/<time>-<app folder>/`. The launch result gives it as `logDir`. It holds `build.log`, `metro.log`, the app's log (`app.ndjson`), the check screenshots, and `evidence/` (`manifest.json`, `logs.json`, `screenshots/`, `flows/`).
- Jobs are in `$TMPDIR/emd/jobs/<jobId>.json`.
- Data that must stay after a restart is in `~/.emd/`: the record of what EMD made (`owned/`), build folders (`derived/`) and failed-check counts (`checks/`).

## Clean up

`gc` removes what EMD made for app folders that no longer exist, for example a deleted git worktree: the simulator clone and its `~/.emd/` folders. It removes only what EMD recorded as its own. For a folder that still exists, it removes nothing. It is a CLI command only, not an MCP tool.

```sh
node dist/bin.js gc          # dry run: lists what it would remove, and the size
node dist/bin.js gc --apply  # removes it
```

- It lists `emd-*` simulators that no record names, but it never deletes them.
- It does not touch `$TMPDIR/emd` or a dev server that runs.

## Limits today

- Expo apps on the iOS simulator only. No native iOS or Android projects, no Android launch, no physical devices.
- `launch` leaves the dev server running. The next `launch` of the same folder stops it and starts a new one. A dev server that EMD did not start on that port still blocks `launch` ("Port N already serves a dev server").
- After 3 failed checks in one app folder, `check` returns `stopped`. Only a person can start over: `node dist/bin.js check reset /path/to/my-app` at a terminal. `EMD_RETRY_LIMIT` (1 to 10) changes the limit.
- A build can take 900 seconds by default (`timeoutSeconds`, or `--timeout` in the CLI). Two cold builds at the same time can take longer.
- The CLI `launch` waits and does not make a job. `logs`, `check` and `evidence` need the `jobId` of a `launch` that the agent started.

## Report a problem

Open an [issue](https://github.com/andrewhenin/emd/issues) with:

- What you asked the agent, and the tool or command that failed, with its JSON result.
- Versions: `node dist/bin.js` and `git rev-parse --short HEAD` in the `emd` folder (EMD), `sw_vers` (macOS), `xcodebuild -version`, `node --version`, and `axe --version` or `maestro --version` if you use them.
- The output of `node dist/bin.js detect /path/to/my-app`.
- From the run folder: `build.log` and `metro.log`, or the lines near the error.
- Before you attach logs or screenshots, remove private details: names, tokens, keys, internal URLs and user data.

## Contributing

EMD is open source but not accepting outside pull requests yet. Bug reports and ideas are welcome as issues; report vulnerabilities per [SECURITY.md](SECURITY.md).

License: [Apache-2.0](LICENSE)
