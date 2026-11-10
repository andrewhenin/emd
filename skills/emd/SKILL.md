---
name: emd
description: Build, run and check a change to a mobile app (Expo on the iOS simulator today) with EMD's MCP tools, and prove it with screenshots and log lines. Use when a task changes a mobile app and the result must be seen on a simulator.
---

# EMD

EMD's MCP tools build and launch the app, read its tagged log lines, and decide pass or fail from the log and the screen. Your own reading of a screenshot is only a second opinion.

## Before you change code

1. Call `detect` with the app folder. At a workspace root it lists the app folders (`apps`): call it again with one of them.
2. In the code you change, log each event a check needs: `console.log("[EMD:<tag>] <message>")`. Give a testID to each element a check needs.

## The loop

1. `launch` with `dir` set to the app folder. It returns a `jobId` at once.
2. `job_status` every 5 to 10 seconds, until `succeeded` or `failed`. A first build takes minutes. A failed launch gives the reason and the first error lines: fix the cause and launch again.
3. To tap, type or swipe, use MobileBuildMCP (EMD doesn't tap):
   - `session_set_defaults` with `simulatorId` set to `device.id` from the launch result.
   - `snapshot_ui`, then `tap` (or `type_text`, `swipe`).
   - A `tap` can report success and change nothing. Judge it by the next `check`. If nothing changed, try `touch` (down, then up) once.
4. `logs`, to read the tagged lines of this run.
5. `check` with the expected log events and elements, then `job_status` until it ends:
   - `passed`: done.
   - `failed`: fix the cause, then check again.
   - `stopped`: the retry limit is reached. Stop and report what is missing. Only a person can reset the count.
   - `error`: the check could not run. Read its reason.
6. `evidence`, to write the evidence folder. Put its path, the screenshots and the matching log lines in your report or PR.

## Rules

- Don't delete a log tag, loosen an expectation or skip a step to make a check pass. If you must, say so in the PR.
- Report only checks that ran.
