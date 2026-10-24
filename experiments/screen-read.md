# Screen reads: Maestro vs AXe

Question: how long does it take to read the iOS simulator's accessibility tree
for `check`'s element expectations, and is AXe (`axe describe-ui`, what
XcodeBuildMCP uses) fast enough to replace Maestro for that?

Status: **Maestro measured, AXe not yet.** See "AXe: blocked".

Reproduce: `experiments/screen-read.sh <simulator-udid> [rounds]` with the sandbox
app launched (`emd launch ~/emd-sandbox`). Each round reads once with each tool in
alternating order. Before each read it brings the app forward and waits for the
load average to drop below 8. A read counts as valid only if it exits 0 and the
output has the testID `smoke-button` and the label `Ready`. It prints each read,
then the median, minimum and maximum per tool.

## Setup

- Sandbox app on an iPhone 17 simulator (iOS 26.5), Xcode 26.6, macOS 27.0.1,
  Maestro 2.11.0, AXe 1.8.0 (not run).
- A Mac with little free RAM, so numbers are slow-host numbers.

## Results so far (wall-clock seconds)

| Read | Seconds | Output |
|---|---|---|
| `maestro hierarchy`, first read after a fresh launch | 53.1 and 53.5 | valid, 14,151 bytes |
| `maestro hierarchy`, later reads, load 6 to 8 | 18.2, 20.9 | valid, same tree |
| `axe describe-ui` | not measured | |

- Maestro starts and stops its XCUITest driver on every call, so nothing carries
  over between calls. The first read after a launch costs about 53 s; later ones
  about 20 s.
- These come from three separate sessions, not the alternating five-round run the
  script now does, so treat them as indicative. The script's summary replaces them.

## Invalid and negative results

- A second read in one session returned 133 KB with no app elements: the app had
  gone to the Home screen and Maestro returned SpringBoard's tree, while the load
  average was above 35. Reads must bring the app forward first (the script does).

## AXe: blocked

- `brew install cameroncooke/axe/axe` fails, now for a different reason than
  before. After updating the Command Line Tools to 27.0, Homebrew still says
  "Your Xcode (26.6) is too outdated. Please update to Xcode 27.0." The formula
  only unpacks a prebuilt binary, but Homebrew treats it as a source install and
  checks the toolchain. Pointing `DEVELOPER_DIR` at the Command Line Tools for
  that command did not change it.
- Updating to Xcode 27 just for this is not worth it here: the sandbox's Expo
  packages need Xcode 26 or newer, and a new Xcode means another multi-GB
  download and iOS runtime.
- The release tarball the formula installs (AXe 1.8.0, 8.2 MB) was downloaded and
  its SHA-256 matched the formula's. Extracting and running it from my session
  was blocked by the auto-mode classifier, so it has not been run.

## Decision rule (set before AXe was measured)

AXe replaces Maestro for `check`'s screen reads if its median is at most a third
of Maestro's and it finds the same elements (testID and label). Maestro stays for
saving replayable flows. If both are slow, try one warm Maestro session instead.
