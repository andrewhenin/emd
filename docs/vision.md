# Everything Mobile Development (EMD)

Build, run, check and prove mobile changes from any coding agent, without opening Xcode or Android Studio.

## Who it's for

Developers who use coding agents (Claude Code, Codex, Cursor, and others) on existing iOS, Android and React Native/Expo apps.

## What it is

- An MCP server, a CLI (`emd`) and an agent skill, installed with one command: `npx emd-agents setup`.
- `setup` detects the project's stack and checks or installs only what that stack needs. It registers EMD with the user's agents, installs the skill, previews every change and backs up existing configs. It never installs unrelated software.
- Runs locally. iOS needs a Mac with Xcode installed, but users never have to open it. Android needs only the SDK command-line tools and runs on macOS, Linux or Windows.

## The loop (one task, one agent)

1. **Detect** the stack and project settings: platforms, schemes or build variants, package manager, test tools, and existing notes files.
2. **Isolate**: a git worktree with its own build folders (DerivedData, Gradle outputs), its own simulator or emulator, and its own Metro and adb ports.
3. **Change**: the agent edits code and adds tagged logs for the run.
4. **Run**: build, launch and reproduce with recorded steps. At each step, capture a screenshot and the matching tagged log lines.
5. **Check**: assert that the expected tagged log events fired and the expected elements are on screen. Then compare each screenshot with its logs. If anything fails, fix and retry, up to a set limit.
6. **Test**: add unit tests and save the steps as a Maestro flow.
7. **Prove**: open a PR with the evidence (steps, screenshots, log lines, Maestro file) and an entry in the project's existing decision or findings notes.
8. **Follow CI**: triage mobile failures (Xcode test results, Gradle logs, flaky simulators) and push fixes.
9. **Clean up**: after the PR is merged or closed, `emd gc` removes the worktree, its build folders and its simulator copy.

Several agents can run this loop at the same time, each on its own PR or feature flag. EMD queues builds and device runs so the machine doesn't run out of memory or disk.

## Principles

- **Adapt to what's there.** Detect the stack, and use the project's existing instruction files (AGENTS.md, CLAUDE.md), decision logs and notes folders. Never impose a new structure. Existing tests and Maestro flows are the spec: they must keep passing.
- **Integrate, don't rebuild.** Use the agent tool's own worktree, PR and CI-fix features where they exist. EMD owns the mobile-specific parts.
- **Evidence over claims.** "Done" means screenshots plus matching log lines, not the agent saying it works.
- **Independent checks.** The agent doesn't grade its own work. Pass or fail comes from machine-checkable signals (expected log events, on-screen elements in the accessibility tree). The agent's reading of a screenshot is a second opinion.
- **No weakened checks.** Flag any change that deletes a log tag, loosens an assertion, or skips a test or Maestro step, and list it in the PR.
- **Small answers first.** Tools return a verdict, the matching log lines and paths to screenshots; full logs and images only on request. Cost is measured in agent tokens per completed task, then time, then CPU and memory.
- **Own what you create.** EMD marks every worktree, simulator, port and build folder it creates. `gc` removes only marked resources, and a resource whose cleanup failed stays owned until a retry succeeds. Unknown is never treated as absent.
- **Safe by default.** Preview changes, back up configs, and never touch signing, provisioning or release settings.
- **Any agent.** Works with any MCP-capable agent, not one vendor.
- **Works on every supported setup.** Best available backend per device action, with fallback; support the latest two major Xcode versions.

## v1 scope

- Stacks: native iOS (SwiftUI/UIKit), native Android (Kotlin/Compose), Expo/React Native.
- Commands: `setup`, `doctor`, `gc`, plus MCP tools for the loop above.
- Agents supported by `setup`: Claude Code, Codex, Cursor.

## Not in v1

- Flutter, Kotlin Multiplatform
- Creating new projects (EMD assumes the project already exists and builds)
- Signing, provisioning, App Store or Play submission
- Physical devices and cloud device farms
- Video recording
- Formal verification of native code (for example C/C++ modules)
- Observability integrations (Sentry, PostHog, Crashlytics) and feature-flag checks (LaunchDarkly, Statsig): planned after v1

## Constraints

- License: Apache-2.0.
- Language: TypeScript, Node 22+.
- Distribution: npm package `emd-agents`, CLI command `emd`, repo `emd`.
