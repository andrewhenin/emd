# 0013: `type` confirms its text; `tap` and `swipe` do not

Status: Accepted (2026-11-18)
Date: 2026-11-18

## Context

AXe and Maestro return when they have sent the keys. On CI the simulator gets
keys 10 to 27 s late, or only the first one (issue 163). An agent then trusts
text that is not there. No backend can confirm typed text, so this is EMD code
(decision 0008).

## Decision

`type` reads the screen before and after typing, every 1 s for up to 30 s. It
returns `ok` only when a node that changed shows its old text plus the typed
text, or the typed text alone. Extra characters fail. Secure fields pass when
bullets grow by the text length, with a `note`. If some keys arrived and the
node stays the same for 2 reads, `type` types the rest once. If none arrived,
it never retypes.

`tap` and `swipe` still return `ok` when the gesture is sent. Their effect is
for `check` to show; the right screen state varies, and the typed text is known.

## Consequences

- `type` can take up to 30 s. The limit is not settable.
- Typed text must differ from what the node showed before.
