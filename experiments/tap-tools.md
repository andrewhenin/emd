# Taps: MobileBuildMCP vs AXe vs Maestro

Question: what does one tap cost an agent, in tokens and seconds, through each
way EMD could offer it (decision 0009), and does the app react?

Answer: **all three ways reached the app every time; AXe called directly is the
fastest (1.4 s median) and the agent reads one small reply.** MobileBuildMCP's
replies are small too (about 380 tokens a tap); its cost is in the tool list,
the extra calls and time.

Reproduce: `node --experimental-strip-types experiments/tap-tools.ts <udid> [rounds]`
with the sandbox launched (`emd launch fixtures/expo`), `axe` and `maestro` on
PATH. Before each tap it relaunches the app and waits for "Ready"; a tap counts
as reacted when "Tapped" is on screen within 5 s. The fast ways alternate order
each round; Maestro runs last, in its own phase. It prints each row, one sample
of each reply, and a summary.

## Setup

GitHub's `macos-26` runner (arm64), Xcode 26.6, AXe 1.8.0, Maestro 2.12.1,
MobileBuildMCP 2.7.1, 10 rounds. Run
[42938667023](https://github.com/andrewhenin/emd/actions/runs/42938667023) used
the script at [158b1c8](https://github.com/andrewhenin/emd/blob/158b1c8/experiments/tap-tools.ts);
since then only its logging and summary lines changed, not the taps or the timing.

## Results

| Way | Agent calls per tap | Agent reads | Reacted | Median s | Min | Max |
|---|---|---|---|---|---|---|
| A: MobileBuildMCP MCP tools | 2 (+1 per session) | ~380 tokens (+210 once) | 10 of 10 | 3.8 | 2.5 | 8.5 |
| B: MobileBuildMCP CLI, from EMD | 1 (EMD's tool) | EMD's reply | 10 of 10 | 11.5 | 8.1 | 18.6 |
| C: `axe tap --id`, from EMD | 1 (EMD's tool) | EMD's reply, ~11 tokens | 10 of 10 | 1.4 | 1.1 | 1.9 |
| C fallback: Maestro `tapOn` | 1 (EMD's tool) | EMD's reply | 2 of 2 | | 82 | 104 |

Tool lists, as API tool definitions (`@anthropic-ai/tokenizer`, approximate):

| Server | Tools | Definitions | Server instructions | Names only |
|---|---|---|---|---|
| MobileBuildMCP, `simulator,ui-automation` | 36 | ~5.7k tokens (23 KB) | ~0.5k | ~450 |
| EMD today | 6 | ~1.2k | none | ~50 |
| EMD's tap, type, swipe (draft) | 3 | ~0.4k | none | ~25 |

- MobileBuildMCP's tap runs its bundled AXe (`axe tap --id/--label/--value`, or
  the element's point), then waits up to 2.5 s for the screen to settle. The
  sampled tap warned that it did not settle and asked for a new `snapshot_ui`.
- B pays for two npx starts per tap. EMD would return the same reply as in C.

## Invalid and negative results

- After a Maestro tap, the relaunched app did not show "Ready" to AXe within 2
  minutes, in 3 of 3 tries across two runs, so Maestro has two valid taps (82 s
  in run 42936087957, 104 s above). Cause not found. → next: check it in the e2e
  for the tap backends.
- Run 42936087957 mixed Maestro into every round and stopped at that failure.
  Its one complete round agrees with the table.
