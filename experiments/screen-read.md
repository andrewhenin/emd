# Screen reads: Maestro vs AXe

Question: how long does it take to read the iOS simulator's accessibility tree
for `check`'s element expectations, and is AXe (`axe describe-ui`, what
XcodeBuildMCP uses) fast enough to replace Maestro for that?

Reproduce: `experiments/screen-read.sh <simulator-udid> [runs]` with the sandbox
app launched (`emd launch ~/emd-sandbox`). It brings the app forward before each
read, times each call and checks the output for the testID `smoke-button` and
the label `Ready`.

## Setup

- Sandbox app in the foreground on an iPhone 17 simulator (iOS 26.5), Xcode 26.6,
  macOS 27.0.1, Maestro 2.11.0, AXe 1.8.0 (not run, see below).
- A Mac with little free RAM. Load average was 5.7 to 7.8 when the measured runs
  started, so treat the numbers as slow-host numbers.

## Results (wall-clock seconds, two runs in a row)

| Tool | Run 1 | Run 2 | Output |
|---|---|---|---|
| `maestro hierarchy` | 18.2 | 20.9 | valid, 14,151 bytes, finds `smoke-button` and `Ready` both times |
| `axe describe-ui` | not measured | not measured | |

## Invalid and negative results

- An earlier pair read 53.1 s, then 23.9 s. The second read was invalid: the app
  had been sent to the Home screen and Maestro returned SpringBoard's tree
  (133 KB, no app elements). The load average passed 35 during it. The script
  now brings the app forward before every read.
- Maestro pays about 20 s on every call. It starts and stops its XCUITest driver
  each time, so a second call in a row is not faster.

## AXe: not measured

- `brew install` refused: "Your Command Line Tools are too outdated" for macOS 27.
  Fixing that needs `sudo` and a reinstall of the Command Line Tools.
- The release tarball the formula installs (`AXe-macOS-homebrew-v1.8.0.tar.gz`,
  8.2 MB) was downloaded to a scratch directory and its SHA-256 matched the
  formula's. Extracting, signing and running it was blocked by the auto-mode
  classifier, so it has not been run.

To finish: install AXe yourself (or allow running that copy), then run
`AXE_BIN=/path/to/axe experiments/screen-read.sh <udid> 2` and add its two lines
to the table.

## Decision rule (set before measuring AXe)

AXe replaces Maestro for `check`'s screen reads if its median is at most a third
of Maestro's (about 6 s here) and it finds the same elements (testID and label).
Maestro stays for saving replayable flows. If both are slow, try one warm
Maestro session instead.
