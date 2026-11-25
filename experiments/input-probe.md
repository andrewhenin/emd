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

Run [44670204774](https://github.com/andrewhenin/emd/actions/runs/44670204774),
2026-11-20, macOS 26 runner (3 CPUs), iOS 26, 20 attempts per phase:

- Taps: 20 of 20 reached the app and fired the button.
- Typing: 60 of 60 `ok`, and the app got every word, in all three phases.
- Prediction bar: shown in 40 of 40 attempts with the keys in
  `com.apple.Preferences` only (they read back 0), and in 0 of 20 after they
  were also written to `com.apple.keyboard.preferences`. So iOS 26 reads them
  there; #233 writes both.
- Neither nightly failure reproduced with an idle app. In the failed nightly of
  2026-11-17, the app got the touch 12 s after `tap` returned, after the check
  had stopped; in the e2e, that tap follows a reload. Unverified; the e2e logs
  touches and input times, so the next failure shows more.

## Results on Xcode 27 (#284)

`-f runner=xcode-27`, and `-f devicehub=on` to open Device Hub first. Runs
[45514999153](https://github.com/andrewhenin/emd/actions/runs/45514999153)
(iPhone Duo),
[45515002823](https://github.com/andrewhenin/emd/actions/runs/45515002823)
(iPhone Duo, Device Hub opened) and
[45519510634](https://github.com/andrewhenin/emd/actions/runs/45519510634)
(iPhone 17, after #179), 2026-11-25: Xcode 27.1, macOS 27.0.1, 3 CPUs,
AXe 1.8.0, 5 attempts per phase.

- Taps reached the app in 2, 3 and 1 of 5. Each tap that landed took 1.9 to
  3.5 s in AXe; each one that missed took 8.4 to 17.9 s.
- Device Hub was not running before either Duo run. In the first, a
  DeviceHub process was there at cleanup; what started it is not known.
  Opening it by bundle ID started Xcode 27.2's Device Hub while 27.1 was
  selected. After that, AXe could not read the screen ("Cannot run
  accessibility commands against <UDID>"), and typing failed 15 of 15.
- Typing without Device Hub opened: 5 of 15 on the Duo, 8 of 15 on the
  iPhone 17. The phase with the keyboard keys in both domains: 1 of 10.
- The Duo's device type is `com.apple.CoreSimulator.SimDeviceType.iPhone-Duo`.
- So neither Device Hub nor the Duo explains the missed taps. Next: tap by a
  point from one screen read, to separate AXe's element lookup from the touch.
