---
name: emd
description: Build, run and check a change to a mobile app (Expo on the iOS simulator today) with EMD's MCP tools, and prove it with screenshots and log lines. Use when a task changes a mobile app and the result must be seen on a simulator.
---

# EMD

EMD's MCP tools build and launch the app, read its tagged log lines, and decide pass or fail from the log and the screen. Your own reading of a screenshot is only a second opinion.

## If EMD's tools are missing

Run `emd setup --dry-run` from the user's EMD folder (`node dist/bin.js setup --dry-run`) and show the user its plan. Run it with `--yes` only after the user approves. Then ask the user to restart you.

## Before you change code

1. Call `detect` with the app folder. At a workspace root it lists the app folders (`apps`): call it again with one of them.
2. In the code you change, log each event a check needs: `console.log("[EMD:<tag>] <message>")`. Give a testID to each element a check needs.

## The loop

1. `launch` with `dir` set to the app folder. It returns a `jobId` at once.
2. `job_status` every 5 to 10 seconds, until `succeeded` or `failed`. A first build takes minutes. A failed launch gives the reason and the first error lines: fix the cause and launch again.
3. `tap` with the `jobId`, and a testID (`id`) or a visible `text`. Use a point only when the element has neither. `type` types into the field that has focus, so tap the field first. `swipe` scrolls. A result of `ok` means the gesture was sent; the next `check` shows what the app did.
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
