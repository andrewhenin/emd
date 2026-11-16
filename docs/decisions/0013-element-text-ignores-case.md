# 0013: Element text matches ignore case

Status: Accepted
Date: 2026-11-16

## Context

- Decision 0010 matches element text exactly.
- In the 0.15.0 batch test (#182, #194), a fresh agent wrote `{"text": "get started"}` from the source. The screen showed "GET STARTED" (styled text). The check failed, used 1 of 3 attempts and left the name in `notPassed`.
- Styled text (`textTransform: "uppercase"`) changes only case. The agent reads the source, not the styles.

## Options

### A: Keep exact
The agent must guess the styling. A correct change fails, and the name stays in `notPassed`.

### B: Whole text, case ignored
"get started" finds "GET STARTED". "Save" does not find "Saved".

### C: Substring or fuzzy
"Save" would find "Saved": a check could pass on the wrong text.

## Decision

B. It removes the false fail and keeps the guard: a match is still the whole text.

- Text is compared in upper case, as styled text shows it ("Straße" finds "STRASSE").
- Ids, log tags and log messages stay exact. So does decision 0010's rule that a later check keeps the first expectations unchanged.
- This replaces "id and text" exact match in decision 0010 for element text only.

## Consequences

- A check can't tell "Saved" from "SAVED". Use an id when case matters.
- `tap` by text is unchanged (exact).
