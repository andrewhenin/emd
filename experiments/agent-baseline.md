# Agent baseline: an agent with and without EMD

Question (#14): for one mobile change, does an agent with EMD finish with
machine-checked proof more often, and spend fewer tokens and less time, than
the same agent without EMD?

Answer (3 rounds, Nov 16, EMD 0.15.0): **EMD beats the same agent without
it, but not an agent primed with the right commands.** With EMD, Sonnet and
Haiku proved 6 of 6 changes from a machine read of the screen; without EMD,
0 of 6. An AGENTS.md that names the build, run and screen-read commands, with
AXe on PATH, also proved 3 of 3, at the same cost and 7% faster, in 9 turns
against 21. By #14's rule, EMD 0.15.0 added nothing to this task that the
primed file did not. The hypotheses, groups, graders and predictions were
posted on #14 before any trial.

## Results

Medians of 3 trials per group, scored by the current `score.ts`. Every trial's
outcome passed; none hit the 21 min limit; none stopped for a person.

| Group | Arm | Model | Proof (H1) | Turns | Cost | Time to answer |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | raw | Sonnet 5.5 | 0 of 3 | 30 | $0.15 | 475 s |
| 2 | primed | Sonnet 5.5 | 3 of 3 | 9 | $0.09 | 343 s |
| 3 | EMD | Sonnet 5.5 | 3 of 3 | 21 | $0.09 | 367 s |
| 4 | raw | Haiku 5.5 | 0 of 3 | 31 | $0.02 | 570 s |
| 5 | EMD | Haiku 5.5 | 3 of 3 | 25 | $0.01 | 325 s |

Against the predictions: H1 held against raw and failed against primed. H2
(EMD at most half of raw's cost) failed: 60%. H3 (EMD faster) held against raw
and failed against primed. H4 (only EMD needs no help) failed: no group needed
help. H5 (Haiku with EMD matches Sonnet without it) held for proof, at 7% of
the cost; no Haiku primed group ran, so the gain may belong to AXe.

Where the time went: 86 to 94% outside the model (`duration_api_ms` against
`duration_ms`), mostly build, simulator boot and first screen. EMD's extra turns were 5 to 7 `job_status` polls per
trial, one `tap`, 1 or 2 `evidence` calls and one turn for its tools to load.

## Deviations

- The scorer changed after the transcripts were read, as #14's plan allows
  for grader errors. Four rules: reads and an edit in one shell call count in
  order, and a script that writes a source file is an edit (primed proof 1 of
  3 became 3 of 3); EMD's server still connecting at the start is not a void
  (Haiku with EMD 1 of 3 valid became 3 of 3); a final answer before the limit
  is not a timeout (one Haiku raw trial); time runs to the final answer, not to
  the process's end. Two changes favor groups without EMD, one favors EMD,
  and the time rule applies to all.
- The person review in #14's plan has not happened: the transcript reads are
  Claude's (the mentor's).
- The harness uninstalled the app after each warm-up, so every EMD trial's
  first launch was a full build (157 to 323 s); build reuse ran only on the
  second launch. The primed agent rebuilds each time, so this cost only EMD.
- One EMD bug: a stale install with its files gone cost about 4 min in one
  Haiku trial (#202, fixed by #211).

Next run: #207's call savings, the "app already installed" case and a Haiku
primed group, pre-registered on #14 before it starts.

## Reproduce

Each trial is one job of the `agent-baseline` workflow on a fresh `macos-26`
runner, so no trial inherits another's state. Start it by hand:

```
gh workflow run agent-baseline.yml -R andrewhenin/emd -f label=pilot -f groups='[1,2,3]'
gh workflow run agent-baseline.yml -R andrewhenin/emd -f label=round-1 -f trial_minutes=<limit>
```

It needs the repo secret `EVAL_ANTHROPIC_API_KEY`, a key with a spend cap.
Each job uploads one artifact of records. Download all three rounds into one
folder, score each trial again with the current scorer, then summarize:

```
for d in <dir>/*/; do OUT_DIR="$d" node --experimental-strip-types experiments/agent-baseline/score.ts >/dev/null; done
node --experimental-strip-types experiments/agent-baseline/summarize.ts <dir>
```

Per trial (`experiments/agent-baseline/`):

1. `prepare.sh`: the fixture app in its own git repo; one pinned simulator (all
   others deleted, shut down at the start, because EMD clones only a shut-down
   one); Claude Code with an empty user config; the group's tools; a warm build
   made the way that group's agent builds. Then the workflow deletes the repo
   checkout, so a raw agent can't find EMD on disk.
2. `run.ts`: `claude -p` with the prompt from #14, the group's model, and
   `--dangerously-skip-permissions`, stopped at the time limit.
3. `grade.ts` (outcome): builds the app as the trial left it, launches it, taps
   "Save" and checks that "Saved" appears. "Saved" before the tap is a fail.
4. `score.ts`: H1 proof from the transcript (an element-tree read before the
   first edit and after the last, in order within one shell call too), the
   agent's claim, the app's diff, cost, turns, time from prompt to final
   answer, tool errors, repeated calls, and whether the session's tools match
   its group (a mismatch voids the trial; EMD's server still connecting
   counts as present). A trial hits the limit only when no final answer came
   before it, and then its outcome is a fail.
5. The workflow removes the API key from every record before the upload.

The five groups are #14's. Their model and arm, and the pinned versions, are
set only in `.github/workflows/agent-baseline.yml`. The primed group's app gets
`agent-baseline/primed-AGENTS.md` and AXe on PATH.
