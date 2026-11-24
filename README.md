# EMD: Everything Mobile Development

<!-- Intro rule: one category line, the job in two or three sentences, then the agents it works with. Nothing else. Add a "used by" line only with a public link for each name. Details go in the sections below. -->

An MCP server, CLI and agent skill for coding agents that change mobile apps.

Your coding agent shouldn't grade its own mobile work. EMD builds the app, launches it on the iOS simulator, and passes or fails each change from the app's own log lines and screen. It keeps the evidence: checks, log lines and screenshots.

`setup` registers EMD with Claude Code, Codex and Cursor. Tested end to end in Claude Code.

Status: early. Expo apps and native iOS apps (SwiftUI or UIKit) on the iOS simulator.

## Requirements

- A Mac with Xcode 26 or 27 and at least one iPhone simulator.
- Node 22 or newer.
- An Expo app with its dependencies installed, or a native iOS app with an `.xcworkspace` or `.xcodeproj` in its root folder. [Check your app](#check-your-app) shows how to check it.

Tested: Expo SDK 58 on Xcode 26 and 27. On Xcode 27, apps below Expo SDK 56 can't build (Expo's bug). Use Xcode 26, or upgrade the app to SDK 56 or newer.

More detail: [Requirements in detail](#requirements-in-detail).

## Install

```sh
npx -y emd-agents@latest setup
```

It finds Claude Code, Codex and Cursor, prints its plan and asks once. On a Mac without AXe, it installs AXe, the tool EMD uses to tap and read the screen. Then it registers EMD with each agent and installs EMD's skill, which tells the agent how to use EMD. It backs up each agent config to `~/.emd/backups/` first.

At the end it runs `doctor`. For each check marked `missing`, do what its `fix` says. Then restart your agents.

- `--dry-run` prints the plan and changes nothing. `--yes` applies it without asking. `--agent codex` (repeatable) picks agents.
- It calls two installers, pinned: [add-mcp](https://github.com/neondatabase/add-mcp) for the server and [skills](https://github.com/vercel-labs/skills) for the skill.

## Check your app

Run this yourself before you ask your agent:

```sh
npx -y emd-agents@latest detect /path/to/my-app
```

It must print `"verdict":"detected"` and no `problem`. For example, `"appIds":{"ios":"com.example.myapp"}`. If the app has no iOS app ID, `detect` says so in `notes`: new Expo apps (from `create-expo-app`) have none, and `launch` lets Expo's build set one in the app config (`ios.bundleIdentifier`). EMD writes nothing to the config. Expo's first `run:ios` also creates the `ios/` folder and points the `ios` and `android` scripts in package.json at `expo run:ios` and `expo run:android`. If `problem` appears, install the app's dependencies: EMD reads the config with the app's own Expo CLI.

A native iOS app detects as `"stack":"xcode"`, with no app ID: `launch` reads the ID from the app it builds, a Debug build of the scheme named like the workspace or project, or of the only scheme.

## First run

Ask your agent for a small change, with the full path of your app:

> In /path/to/my-app, add a button that shows "Saved" when tapped. Prove it on the iOS simulator with EMD, then tell me the evidence folder.

The agent follows EMD's skill. It adds a tagged log line, such as `console.log("[EMD:saved] button tapped")` (Expo) or `NSLog("[EMD:saved] button tapped")` (Swift), and a testID. Then it launches the app, taps, checks the log line and the screen, and gathers the evidence. A first build takes minutes.

Each check ends with one verdict:

- `passed`: done.
- `failed`: the agent fixes the cause and checks again.
- `stopped`: 3 checks failed in this app folder. Only a person can start over, at a terminal: `npx -y emd-agents@latest check reset /path/to/my-app`.
- `error`: the check could not run. The result says why.

A check name keeps its first expectations. A later check with the same name can add expectations, but not drop them. The evidence lists each check name whose last verdict is not `passed`.

Output stays on your Mac:

- Each launch has a run folder, `$TMPDIR/emd/runs/<time>-<app folder>/`. The launch result gives it as `logDir`. It holds `build.log`, `metro.log`, the app's log (`app.ndjson`), the check screenshots, and `evidence/` (`manifest.json`, `logs.json`, `screenshots/`, `flows/`).
- Jobs are in `$TMPDIR/emd/jobs/<jobId>.json`.
- Data that must stay after a restart is in `~/.emd/`: the record of what EMD made (`owned/`), build folders (`derived/`) and failed-check counts (`checks/`).

## Limits today

- Expo and native iOS apps on the iOS simulator only. No Android launch, no physical devices.
- Native iOS: a project with several schemes needs one named like the workspace or project. Projects generated with Tuist, XcodeGen or Bazel show a `problem`: EMD doesn't build through them yet. `launch` builds on every call; there is no build reuse yet.
- `launch` leaves the dev server running. The next `launch` of the same folder stops it and starts a new one. A dev server that EMD did not start on that port still blocks `launch` ("Port N already serves a dev server").
- `EMD_RETRY_LIMIT` (1 to 10) changes the limit of 3 failed checks.
- A build stops when its log has not grown for 600 seconds, or after 3600 seconds in total (`timeoutSeconds`, or `--timeout` in the CLI). Two cold builds at the same time take longer.
- The CLI `launch` waits and does not make a job. `logs`, `check` and `evidence` need the `jobId` of a `launch` that the agent started.

## FAQ

### How is EMD different from agent-device, Argent or MobileBuildMCP?

Each project's README says what it does. [agent-device](https://github.com/callstack/agent-device) lets agents inspect, control, debug and verify apps. [Argent](https://github.com/software-mansion/argent) gives agents direct control of simulators, emulators and devices, to interact, debug, profile and record e2e tests. [MobileBuildMCP](https://github.com/getsentry/MobileBuildMCP) gives agents tools for iOS and macOS projects, such as build and test. EMD centers on the verdict:

- One check reads the app's own tagged log lines and the elements on screen, and passes or fails on both.
- A check name keeps its first expectations, so the agent can't pass it by dropping one.
- After 3 failed checks, every later check returns `stopped` until a person resets the count.

For taps and screen reads, EMD uses AXe, with Maestro as the fallback.

### How do I upgrade?

Run `npx -y emd-agents@latest setup` again, then restart your agents. Setup registers the exact version it ran from, so EMD's server and skill stay at one version.

### How do I remove EMD?

Remove the server from each agent, then the skill:

```sh
claude mcp remove emd -s user
codex mcp remove emd
npx -y skills@1.7.6 remove emd -g -y
```

In Cursor, delete the `emd` entry from `~/.cursor/mcp.json`.

To remove what EMD made on your Mac:

1. Delete its simulators. `xcrun simctl list devices | grep emd-` lists them. `xcrun simctl delete <id>` deletes one.
2. Delete `~/.emd/`. It holds AXe, build folders, EMD's records and the config backups from setup. Copy a backup first if you want to keep it.

## Report a problem

Open an [issue](https://github.com/andrewhenin/emd/issues) with:

- What you asked the agent, and the tool or command that failed, with its JSON result.
- The output of `npx -y emd-agents@latest doctor` and `npx -y emd-agents@latest detect /path/to/my-app`.
- Versions: EMD's (the `emd-agents@<version>` in your agent's MCP config, or `node dist/bin.js` and `git rev-parse --short HEAD` in a clone), `sw_vers` (macOS), `xcodebuild -version`, `node --version`, and `axe --version` or `maestro --version` if you use them.
- From the run folder: `build.log` and `metro.log`, or the lines near the error.
- Before you attach logs or screenshots, remove private details: names, tokens, keys, internal URLs and user data.

## Contributing

EMD is open source but does not accept pull requests from outside contributors yet. Bug reports and ideas are welcome as issues. If you want to fix something yourself, say so in the issue. Report vulnerabilities per [SECURITY.md](SECURITY.md).

## Reference

### MCP tools

`emd mcp` serves these tools:

- `detect`: finds the stack, platforms, app IDs, run commands and package manager of a folder. At a workspace root, it lists the app folders instead (`apps`).
- `launch`: builds the app, installs and opens it on an iOS simulator, and keeps its dev server running. Waits up to 25 s (`waitSeconds`): a reload or relaunch returns its result, a build returns a job.
- `job_status`: the state of a job (queued, running, succeeded, failed) and, at the end, its result. It waits up to 30 s (`waitSeconds`) and returns when the job ends. In Claude Code, `setup` raises the default wait of `launch`, `check` and `job_status` to 100 s (`EMD_WAIT_SECONDS`), so a build takes fewer calls; a client that cancels a call gets the short waits again.
- `logs`: the `[EMD:<tag>]` lines that the app wrote during the run of a launch job.
- `tap`, `type`, `swipe`: act on the launched app. `tap` takes a testID, a visible text or a point. Each says which tool did it (AXe or Maestro).
- `check`: passes or fails a run from tagged log lines and on-screen elements (by testID or text). Waits up to 25 s (`waitSeconds`) and usually returns the verdict; a longer check returns a job. It can run taps, typing and swipes first (`actions`). Each check rewrites the run's evidence folder and returns its path.
- `evidence`: puts the checks, log lines, screenshots and Maestro flows of a run in one folder.

### CLI commands

Run them as `npx -y emd-agents@latest <command>`, or `node dist/bin.js <command>` in a clone. Below, `emd` means either.

- `detect [dir]`: same as the tool.
- `launch [dir] [--device X] [--timeout N]`: same as the tool, but waits for the result.
- `job status <id>`: reads a job.
- `logs <jobId> [--tag T] [--limit N]`: same as the tool.
- `check <jobId> [--log TAG[=TEXT]] [--element id=X|text=Y] [--name N] [--agent pass|fail]`: same as the tool, but waits.
- `check reset [dir]`: clears the failed-check count. A person must type `reset` at a terminal.
- `evidence <jobId>`: same as the tool.
- `gc [--apply]`: lists, then removes, what EMD made for app folders that no longer exist.
- `tap <jobId> --id X|--text Y|--x N --y N`, `type <jobId> <text>`, `swipe <jobId> up|down|left|right`: same as the tools.
- `setup [--dry-run] [--yes] [--agent X]`: registers EMD with your agents and installs the skill.
- `doctor`: checks that this Mac has what EMD needs (Node, macOS, Xcode, an iPhone simulator, AXe or Maestro) and says how to add what is missing.
- `mcp`: starts the MCP server on stdio.

### Requirements in detail

- An Expo app with `expo` in package.json. EMD reads its app config (app.json, app.config.js or app.config.ts) with the app's own `expo config`. Without `ios.bundleIdentifier`, Expo's build sets one and `launch` reports it (`appIdSet`).
- The app's dependencies, installed. EMD does not install them.
- macOS. On other systems `detect` works, and `launch` returns "iOS simulators need macOS."
- Xcode, tested with Xcode 26 and 27. Expo SDK 58 apps need Xcode 26 or newer. Without Xcode, `launch` fails: "Could not set up this worktree's simulator and build folders."
- An iOS simulator runtime and at least one shut-down iPhone simulator. EMD clones it once per app folder, as `emd-<key>`. Without one, `launch` fails: "No shut-down iPhone simulator is available to clone."
- AXe or Maestro, for taps, typing, swipes and element checks. EMD tries AXe first, then Maestro.
  - AXe (about 40 times faster for checks, 60 for taps): `setup` installs it into `~/.emd/tools/`, from AXe's pinned release archive, checked by SHA-256. With Xcode 27, Device Hub must be running.
  - Maestro: `curl -fsSL "https://get.maestro.mobile.dev" | bash`. It needs Java 17 or newer, with `JAVA_HOME` set.
  - With neither, taps, typing and swipes fail, and a check with elements returns `error`. `launch`, `logs`, log checks and `evidence` still work.

### Install from source

```sh
git clone https://github.com/andrewhenin/emd.git
cd emd
npm ci
npm run build
node dist/bin.js detect fixtures/expo
```

The last line must print `"verdict":"detected"` and `"appIds":{"ios":"com.emd.sandbox"}`. Then `node dist/bin.js setup` registers this clone's build with your agents.

### Clean up

`gc` removes what EMD made for app folders that no longer exist, for example a deleted git worktree: the simulator clone and its `~/.emd/` folders. It removes only what EMD recorded as its own. For a folder that still exists, it removes nothing. It is a CLI command only, not an MCP tool.

```sh
emd gc          # dry run: lists what it would remove, and the size
emd gc --apply  # removes it
```

- It lists `emd-*` simulators that no record names, but it never deletes them.
- It does not touch `$TMPDIR/emd` or a dev server that runs.

License: [Apache-2.0](LICENSE)
