# Prompt/Response Regression Harness

## Trigger
- Any change to a prompt template, model version, or NLP/ML pipeline step.
- User says "did this prompt change break anything", "compare model outputs".

## What it does
Snapshots prompts and their outputs, then flags when the same input starts producing a meaningfully different output after a change.

## Process
1. Collect (or ask for) a small representative set of inputs — 5-15 covering typical, edge, and adversarial cases.
2. Run each input through the current pipeline and record the output as a baseline snapshot (store in a fixtures file).
3. After a prompt/model change, re-run the same inputs and diff against baseline.
4. Classify each diff: cosmetic (formatting only) / substantive (meaning changed) / broken (malformed, refused, empty).
5. Surface only substantive and broken diffs prominently; note cosmetic ones briefly.

## Output format
- Table: input | baseline output (truncated) | new output (truncated) | classification
- Flag count of substantive/broken changes at the top.

## Guardrails
- Never silently update the baseline snapshot — updating it is a decision the user makes explicitly after reviewing diffs.
- Keep stored snapshots small and diffable (truncate long generations, keep full text in a separate file if needed).
