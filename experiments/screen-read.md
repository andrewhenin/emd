# Screen reads: Maestro vs AXe

Question: how long does it take to read the iOS simulator's accessibility tree
for `check`'s element expectations, and is AXe (`axe describe-ui`, what
XcodeBuildMCP uses) fast enough to replace Maestro for that?

Answer: **AXe is about 40 times faster and sees the same elements.** `check` now
reads the screen through AXe when it can and falls back to Maestro (decision 0004).

Reproduce: `experiments/screen-read.sh <simulator-udid> [rounds]` with the sandbox
app launched (`emd launch ~/emd-sandbox`). Each round reads once with each tool in
alternating order. Before each read it brings the app forward and waits for the
load average to drop below 8. A read counts as valid only if it exits 0 and the
output has the testID `smoke-button` and the label `Ready`. It prints each read,
then the median, minimum and maximum per tool.

## Setup

- Sandbox app on an "iPhone Duo" simulator (the only device type the iOS 27.1
  runtime supports), Xcode 27.1, macOS 27.0.1, Maestro 2.11.0, AXe 1.8.0, Device
  Hub running (AXe needs it under Xcode 27).
- A Mac with little free RAM. The load average was 4.7 to 7.9 before each read
  (it was 17 when the script started and waited), so treat the numbers as
  slow-host numbers; the ratio is what matters.

## Results (wall-clock seconds, 3 rounds, alternating order)

| Tool | Reads | Median | Min | Max | Valid |
|---|---|---|---|---|---|
| `maestro hierarchy` | 98.5, 31.8, 28.5 | **31.8** | 28.5 | 98.5 | 3 of 3 |
| `axe describe-ui` | 1.6, 0.5, 0.8 | **0.8** | 0.5 | 1.6 | 3 of 3 |

- The first Maestro read, right after an app launch, took 98.5 s. Maestro starts
  and stops its XCUITest driver on every call, so nothing carries over between
  calls; later reads took about 30 s. Earlier sessions on Xcode 26.6 gave 18 to
  21 s warm and 53 s cold, so absolute numbers move with the host and Xcode.
- AXe talks to the simulator directly, with no driver to start.
- Both found `smoke-button` and `Ready` on every read. AXe's output is smaller
  (15.5 KB against 25.7 KB) because Maestro also lists the status bar.
- AXe's tree names testIDs `AXUniqueId` and text `AXLabel` (with `AXValue` and
  `title`); Maestro's names them `resource-id` and `accessibilityText`, `text`,
  `value`, `title`. Both reduce to the same nodes for matching.

## Invalid and negative results

- Earlier on Xcode 26.6 a second Maestro read in one session returned 133 KB with
  no app elements: the app had gone to the Home screen and Maestro returned
  SpringBoard's tree while the load average was above 35. Reads must bring the app
  forward first (the script does).
- AXe's first attempts failed with "Timed out creating the simulator remote
  automation session", twice. Device Hub was not running (Xcode 27 simulator
  automation goes through it) and the host load average was above 100. After
  starting Device Hub it worked, even at load 26. That is why `check` falls back
  to Maestro when AXe fails on a call.

## Notes that bear on the decision

- AXe 1.8.0's README says it supports Xcode 26 and 27, validated on 26.5 and on
  27 Beta 3. It was installable here only after Xcode 27: Homebrew refuses a
  formula with no build step when the installed Xcode is older than the macOS
  expects (Xcode 26.6 on macOS 27). That is a Homebrew check, not an AXe limit.
- The iOS 27.1 runtime supports only the "iPhone Duo".
- AXe issue #76 (open): `describe-ui` restarts `testmanagerd`, which can end other
  XCUITest runners' sessions, such as a Maestro flow running at the same time. EMD
  reads the screen between steps, not during a flow, so it has not shown up here.

## Decision rule (set before AXe was measured) and outcome

AXe replaces Maestro for `check`'s screen reads if its median is at most a third
of Maestro's (about 10 s here) and it finds the same elements. It is 40 times
faster and found the same elements, so it does. Maestro stays for saving
replayable flows.
