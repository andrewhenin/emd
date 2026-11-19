# 0013: `type` confirms its text; `tap` and `swipe` do not

Status: Accepted (2026-11-18)
Date: 2026-11-18

## Context

AXe and Maestro return when they have sent the keys. On CI the simulator gets
keys 10 to 27 s late, or only the first one (issue 163). An agent then trusts
text that is not there. No backend can confirm typed text, so this is EMD code
(decision 0008).

## Decision

`type` reads the screen before typing, types, then reads every 1 s. The whole
call takes at most 40 s, the read before typing included. Each step gets only
the time left, and no step starts after it, so the call ends well inside the
60 s MCP client timeout. `type` returns `ok` only when a node that changed
shows its old text plus the typed text, or the typed text alone. Extra
characters fail. Secure fields pass when bullets grow by the text length, with
a `note`. If the screen stays the same for 20 s (half the limit), `type` types
the missing rest once, all of it when no key arrived. Late keys came 10 to
27 s late, so a shorter wait doubles text; doubled text fails, never a false
`ok`.

Launch turns off Predictive Text and Auto-Correction on EMD's own simulator,
as Appium's WebDriverAgent does. Predictions add new text nodes while `type`
waits, and corrections change the typed text.

`tap` and `swipe` still return `ok` when the gesture is sent. Their effect is
for `check` to show; the right screen state varies, and the typed text is known.

## Consequences

- `type` can take up to 40 s. The limit is not settable.
- Typed text must differ from what the node showed before.
