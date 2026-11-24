# 0017: The agent names the setup step and the scheme

Status: Accepted
Date: 2026-11-23

## Context

Large iOS apps often make their Xcode project with a setup step: XcodeGen, Tuist, or Bazel behind `make`. The project is often not in git, so a new worktree has none. They also have many schemes and configurations, and none may be named like the project. A wrong guess costs a full build, often 15 minutes or more. Other tools take the scheme as an input: fastlane, the React Native CLI, Expo and XcodeBuildMCP. Tuist's guidance for scripts is `tuist generate --no-open`, then `xcodebuild`.

## Options

### A: EMD runs each generator itself
One adapter step per tool. It skips the repo's own wrapper (pinned versions, extra steps), and a new tool needs new code.

### B: EMD reads the project's docs
The docs are prose, so EMD would guess. Launch would stop being predictable.

### C: the agent passes `prepare`, `scheme` and `configuration`
The agent reads the docs or asks the user. EMD runs exactly what it gets.

## Decision

C. Judgment stays in the agent, mechanics in EMD. One `prepare` input covers every setup step. EMD doesn't remember the values: each task gets a new worktree, so the project's own notes are the place to record them.

## Consequences

- detect gives `needsPrepare` for Tuist, XcodeGen and Bazel markers, and launch stops without `prepare`.
- `prepare` runs before every build, so a changed manifest is never missed. It costs its own time on each launch.
- Without `configuration`, EMD builds the one the scheme's Run action uses, as Xcode does.
- EMD reads shared scheme files and uses `xcodebuild -list` only when there are none.
- An app that Bazel builds with no Xcode project needs a separate override (a build command and the built app's path).
