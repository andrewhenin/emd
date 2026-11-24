# Testing philosophy

**A test that no planted bug can break checks nothing.**

A planted bug is a bug put in on purpose: a seeded fault, or mutant. Tests that catch planted bugs tend to catch real ones.[^mutants] Coverage shows only that code ran, not that anything checked it.[^coverage]

A coding agent's "done" is a claim. EMD turns it into proof that a person can check.

This page lists what we believe, what EMD enforces today, and what it does not enforce yet. Every claim links to a primary source. When a planned item ships, the same PR moves it to "Enforced today".

## What we believe

1. **The agent doesn't grade its own work.** Agents given tests sometimes pass them by cheating, not by fixing the code.[^cheat] Pass or fail comes from signals the agent can't write at check time: the app's own log lines and the screen.
2. **A check must be able to fail.** A check that passes before the change proves nothing. So does a check that still passes after the change is broken. Tests written by LLMs often assert what the code does, not what it should do.[^oracle]
3. **The bar never moves in silence.** An agent can add expectations freely. A wrong one can be replaced under a new check name, but the old name stays in the evidence for a person to see ([decision 0010](decisions/0010-check-expectations-per-name.md)).
4. **Test at the lowest level that can fail for the right reason.** Pure logic gets unit tests. Storage and messaging get integration tests. The whole flow gets one check on a device. Large tests are flaky far more often than small ones.[^size]
5. **Prove it once on a device. Guard it below.** A device run proves the change. A fast test keeps it proven on every commit. Unit tests carved from end-to-end runs catch real regressions.[^carve]
6. **Test rules, not only examples.** If the output must not depend on event order, shuffle the events. If a summary must match its history, rebuild it and compare.[^property]
7. **Time is an input.** Inject the clock and the time zone. Test midnight, time zone boundaries, daylight saving changes and the user's "today". A run you can't repeat is a run you can't trust.[^clock]
8. **Flaky means wrong.** A retry needs a known cause and a limit. Test infrastructure is part of correctness. At Google, about 84% of pass-to-fail transitions involved a flaky test.[^flaky]
9. **Speed is part of correctness.** Block the merge, not the edit loop. Check only what changed. Reuse what didn't. Selecting tests well can catch over 99.9% of regressions while running a third of the tests.[^selection]

## Enforced today

- Pass or fail comes from the app's tagged log lines and the elements on screen. The agent's reading of a screenshot is kept only as a second opinion.
- A check name keeps its first expectations. A later check can add expectations, not drop them. The evidence lists every name that never passed (`notPassed`).
- After 3 failed checks, every check returns `stopped`. Only a person at a terminal can reset the count. The limit is not a tool input.
- A check reads only the logs of the current run. Evidence from an earlier run can't pass a new check.
- `type` succeeds only when the typed text shows on screen. `tap` waits for its element.
- Every check rewrites the evidence folder: checks, log lines, screenshots and Maestro flows.
- For Expo apps, builds are reused. No Xcode build when no native input changed. A matching build is reinstalled. A JavaScript-only change gets a reload.
- EMD's own end-to-end tests run on real simulators and emulators in CI, with pinned tool versions. A flaky call gets a bounded retry only after its cause is in the logs.

## Not enforced yet

In planned order:

1. **Fail first.** The check must fail on the base commit and pass after the change.[^failfirst] ([#272](https://github.com/andrewhenin/emd/issues/272))
2. **Order and timing.** Count only log lines after the check's first action. Events must come in order, within a time limit. An event must not appear before its action. ([#273](https://github.com/andrewhenin/emd/issues/273))
3. **Push down.** After a device pass, the agent adds a fast test. EMD confirms that it fails on the base commit. ([#274](https://github.com/andrewhenin/emd/issues/274))
4. **Weakened-check report.** The PR lists every deleted log tag, loosened expectation and skipped step, and why each name in `notPassed` was dropped. Today the skill asks for this; EMD doesn't check it. ([#275](https://github.com/andrewhenin/emd/issues/275))
5. **Rules and time in the skill.** The skill tells agents when to write order, history and time zone tests. ([#276](https://github.com/andrewhenin/emd/issues/276))
6. **Mutation check.** EMD breaks the changed lines on purpose, and the checks must fail. Opt-in, at PR time, on changed code only.[^mutation-at-scale] ([#277](https://github.com/andrewhenin/emd/issues/277))
7. **Cheat rate.** A public benchmark of impossible mobile tasks, where any pass is a cheat, with and without EMD. ([#278](https://github.com/andrewhenin/emd/issues/278))

## Known limit

An agent with an unrestricted shell can edit EMD's records. Your agent's permission settings are the real wall. EMD makes cheating visible, not impossible.

[^mutants]: The idea dates to R. A. DeMillo, R. J. Lipton and F. G. Sayward, "Hints on Test Data Selection: Help for the Practicing Programmer," IEEE Computer, 1978 ([doi](https://doi.org/10.1109/C-M.1978.218136)). R. Just et al., "Are Mutants a Valid Substitute for Real Faults in Software Testing?," FSE 2014, found the link independent of coverage ([paper](https://homes.cs.washington.edu/~mernst/pubs/mutation-effectiveness-fse2014-abstract.html)). M. Papadakis et al., "Are Mutation Scores Correlated with Real Fault Detection?," ICSE 2018, found it weak once suite size is controlled, but still useful to improve a suite ([paper](https://ieeexplore.ieee.org/document/8453121)).
[^coverage]: L. Inozemtseva and R. Holmes, "Coverage Is Not Strongly Correlated with Test Suite Effectiveness," ICSE 2014 ([doi](https://doi.org/10.1145/2568225.2568271)).
[^cheat]: Z. Zhong, A. Raghunathan and N. Carlini, "ImpossibleBench: Measuring LLMs' Propensity of Exploiting Test Cases," 2025 ([arXiv](https://arxiv.org/abs/2510.20270)).
[^oracle]: M. Konstantinou, R. Degiovanni and M. Papadakis, "Do LLMs Generate Test Oracles that Capture the Actual or the Expected Program Behaviour?," 2024 ([arXiv](https://arxiv.org/abs/2410.21136)).
[^size]: Google Testing Blog, "Where do our flaky tests come from?," 2017: 0.5% of small, 1.6% of medium and 14% of large tests were flaky ([post](https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html)).
[^carve]: N. Alshahwan et al., "Observation-based Unit Test Generation at Meta," FSE 2024 ([arXiv](https://arxiv.org/abs/2402.06111)).
[^property]: Stateful property-based testing generates sequences of actions and shrinks a failure to a minimal case. See the quickcheck-state-machine docs ([Hackage](https://hackage.haskell.org/package/quickcheck-state-machine)).
[^clock]: Martin Fowler's site, "Deterministic Simulation Testing": to repeat a run, the test must control the clock ([article](https://martinfowler.com/articles/deterministic-simulation-testing.html)).
[^flaky]: J. Micco, "Flaky Tests at Google and How We Mitigate Them," Google Testing Blog, 2016 ([post](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)).
[^selection]: Meta Engineering, "Predictive test selection," 2018 ([post](https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/)).
[^failfirst]: Anthropic, "Claude Code: Best practices for agentic coding": write a failing test that reproduces the issue, then fix it ([post](https://www.anthropic.com/engineering/claude-code-best-practices)).
[^mutation-at-scale]: G. Petrović et al., "Practical Mutation Testing at Scale: A view from Google," IEEE TSE 2021 ([arXiv](https://arxiv.org/abs/2102.11378)).
