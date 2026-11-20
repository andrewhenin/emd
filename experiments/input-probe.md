# Input probe

Why do taps and typing through EMD sometimes not take effect on a CI
simulator? Nightly e2e runs failed on both: a `tap` returned `ok` but the
app's "tapped" log line never came (#94), and `type` failed with the
keyboard's prediction bar on screen (#213), even after `launch` writes
`KeyboardPrediction` as false to `com.apple.Preferences`. This probe collects
evidence before anything is fixed.

## Run it

```
gh workflow run input-probe.yml -R andrewhenin/emd -f attempts=20
```

The job builds the test app (`fixtures/expo`) with EMD, then runs
`experiments/input-probe/probe.ts`. Each attempt prints one JSON line to the
job log and to `attempts.jsonl`. A failed attempt also keeps AXe's tree and a
screenshot. The artifact holds these and EMD's run folder (app log, build log).

## What each line says

- `prefs`: `KeyboardPrediction` and `KeyboardAutocorrection` as read from
  `com.apple.Preferences` and `com.apple.keyboard.preferences`.
- `tap`: `touched` means the app logged a touch (`[EMD:touch]`), so the tap
  reached it; `pressed` means the button fired (`[EMD:smoke] tapped`). Touched
  but not pressed points at the button or the read; neither points at the tap.
- `type`: EMD's verdict, `appGotIt` (the app's `[EMD:typed]` line ends with the
  word) and `predictionsShown` (AXe's tree has "Typing Predictions").

The three typing phases separate the causes: as `launch` started the app, after
a plain relaunch (the control), and after the two keys are also written to
`com.apple.keyboard.preferences` and the app relaunched.

## Results

None yet.
