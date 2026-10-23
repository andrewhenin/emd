# How we log

The repo is EMD's memory. Keep it small enough that every session can read what matters.

## Before writing anything

1. **Will it change a future decision or action?** If not, don't log it.
2. **Would a fresh agent find it in one search or one file read?** If yes, don't log it. If finding it takes digging (old PR threads, many files, running something), or it isn't in the code at all (why, what failed, gotchas), log it. If an agent already missed it once, it isn't findable: log it.
3. **Is it already written somewhere?** Update that line instead of adding a new one.

## One home per fact

| Kind of note | Where | Form |
|---|---|---|
| Rule agents must follow | `AGENTS.md` | One imperative line |
| What EMD is, principles, scope | `docs/vision.md` | Edit in place |
| A decision and why | `docs/decisions/NNNN-title.md` | One file per decision. Once accepted, don't rewrite it; supersede it with a new one |
| Observation that isn't a rule yet (gotcha, measurement, idea) | `docs/findings.md` | One dated line with a source |
| Measurement (before/after, benchmark) | `experiments/<topic>.md` plus its reproduction script | Results, setup and negative results; raw data stays out of the repo |
| Planned work | GitHub issue | Not in .md files |
| What changed | Commits and CHANGELOG | Not in .md files |
| Private context (origin, strategy) | Outside this repo | Never committed |

## How to write an entry

- **Point, don't copy.** Say where something lives and why (`iOS build settings: src/adapters/ios/, reason in decision 0003`). Copies go stale, and a stale note is worse than none because agents trust it.
- One line, specific, with a source:
  `- 2026-10-23: Agent xcodebuild and Xcode sharing one DerivedData overwrite each other's state (22.7s rebuild became 863s). [source](url)`
- Facts, not stories. A failed approach is one line: "X doesn't work because Y".
- If the entry belongs somewhere else later, add `→ next:` with where it goes.

## Every finding ends one of three ways

1. **Promoted** to a rule, decision or principle, then deleted from findings.
2. **Moved** into a GitHub issue, then deleted from findings.
3. **Deleted** when it's no longer true or useful.

Findings never just accumulate. When the file is at its limit, consolidate or delete before adding.

## When to log

- At the end of a task, in the same PR as the code, not after merge.
- When an agent repeats a mistake: add a rule to `AGENTS.md`.
- When review catches something an agent should have known: add a rule or a finding.

## Size limits (to be enforced by a CI check)

- `AGENTS.md`: 200 lines
- `docs/vision.md`: 120 lines
- `docs/findings.md`: 50 entries
- Each decision file: 40 lines
