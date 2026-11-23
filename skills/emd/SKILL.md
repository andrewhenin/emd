---
name: emd
description: Build, run and check a change to a mobile app (Expo or native iOS apps on the iOS simulator, native Android apps on an emulator) with EMD's MCP tools, and prove it with screenshots and log lines. Use when a task changes a mobile app and the result must be seen on a simulator or emulator.
---

# EMD

EMD's MCP tools build and launch the app, read its tagged log lines, and decide pass or fail from the log and the screen. Your own reading of a screenshot is only a second opinion.

## If EMD's tools are missing

Run `npx -y emd-agents@latest setup --dry-run` and show the user its plan. Run it with `--yes` only after the user approves. Show the user the `fix` of each `doctor` check in its result that is `missing`. Then ask the user to restart you.

## Before you change code

1. Call `detect` with the app folder. At a workspace root it lists the app folders (`apps`): call it again with one of them.
   - If it gives `needsPrepare`, a setup step makes the native project. Find in the project's docs (README, AGENTS.md, CLAUDE.md, Makefile) the command that makes it, and for iOS the scheme you run and its configuration. Pass them to every `launch` as `prepare`, `scheme` and `configuration`. If the docs don't say, ask the user once, then offer to add them to the project's agent notes.
   - A native iOS app with several schemes stops with a list. Pass `scheme` the same way.
2. In the code you change, log each event a check needs, and give a testID to each element a check needs:
   - Expo: `console.log("[EMD:<tag>] <message>")` and `testID`.
   - Native iOS (Swift): `NSLog("[EMD:<tag>] <message>")` and `accessibilityIdentifier`. Swift's `print` doesn't reach the log EMD reads.
   - Native Android (Kotlin): `Log.i("EMD", "[EMD:<tag>] <message>")`. Compose: `Modifier.testTag("<id>")`, with `Modifier.semantics { testTagsAsResourceId = true }` once on a parent, or EMD can't see the tags. Views: an `android:id`; give its name without the package.

## The loop

After you change code, call `launch` again before you `check` or `tap`. Expo on iOS: when nothing native changed, `launch` reloads the running app from the dev server in seconds (`build.action: "reloaded"`). Expo on Android and native apps: `launch` builds every time. For an Expo app, `launch` picks iOS; pass `platform: "android"` for Android.

1. `launch` with `dir` set to the app folder. It waits up to 25 s (100 s in Claude Code): a reload or relaunch usually returns its result.
2. If it returned a job still running, `job_status` with the `jobId`, until `succeeded` or `failed`. A first build takes minutes. A failed launch gives the reason and the first error lines: fix the cause and launch again.
3. `tap` with the `jobId`, and a testID (`id`) or a visible `text`. Use a point only when the element has neither. `type` types into the field that has focus, so tap the field first. `swipe` scrolls. For `tap` and `swipe`, `ok` means the gesture was sent; the next `check` shows what the app did. For `type`, `ok` means the text shows on screen; it can take up to 40 s. A secure field shows bullets, so `ok` there has a `note`.
4. `logs`, to read the tagged lines of this run.
5. `check` with the expected log events and elements and a `name` for the moment, e.g. `after-save`. Put the taps, typing and swipes that lead to that moment in its `actions`, so one call acts and checks. A later check under that name must keep the first expectations unchanged; it can add more. It usually returns its verdict in the same call; if it returns a job, `job_status` until it ends:
   - `passed`: done.
   - `failed`: fix the cause, then check again.
   - `stopped`: the retry limit is reached. Stop and report what is missing. Only a person can reset the count.
   - `error`: the check could not run. Read its reason.
6. Each check rewrites the run's evidence folder and returns its path (`evidenceDir`). Put that path, the screenshots and the matching log lines in your report or PR, and each name in `notPassed`. Call `evidence` only to rewrite the folder on its own.

## Rules

- Don't delete a log tag, loosen an expectation or skip a step to make a check pass. If you must, say so in the PR.
- Report only checks that ran.
