# Agent baseline: an agent with and without EMD

Question (#14): for one mobile change, does an agent with EMD finish with
machine-checked proof more often, and spend fewer tokens and less time, than
the same agent without EMD?

Answer: **not run yet.** The hypotheses, groups, graders and predictions were
posted on #14 before any trial, with an amendment for where and how trials
run. A change after the first trial goes in the results as a deviation.

## Reproduce

Each trial is one job of the `agent-baseline` workflow on a fresh `macos-26`
runner, so no trial inherits another's state. Start it by hand:

```
gh workflow run agent-baseline.yml -R andrewhenin/emd -f label=pilot -f groups='[1,2,3]'
gh workflow run agent-baseline.yml -R andrewhenin/emd -f label=round-1 -f trial_minutes=<limit>
```

It needs the repo secret `EVAL_ANTHROPIC_API_KEY`, a key with a spend cap.
Each job uploads one artifact of records. Summarize the downloaded artifacts of
all three rounds with
`node --experimental-strip-types experiments/agent-baseline/summarize.ts <dir>`.

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
   first edit and after the last), the agent's claim, the app's diff, cost,
   turns, time, tool errors, repeated calls, and whether the session's tools
   match its group (a mismatch voids the trial).
5. The workflow removes the API key from every record before the upload.

The five groups are #14's. Their model and arm, and the pinned versions, are
set only in `.github/workflows/agent-baseline.yml`. The primed group's app gets
`agent-baseline/primed-AGENTS.md` and AXe on PATH.

## Results

None yet.

## Invalid and negative results

None yet.
