# Multimodal Spec Binder

## Trigger
- A screenshot, error capture, or design mockup is pasted into the conversation mid-task.
- User says "here's what it looks like", "here's the error", "match this design".

## What it does
Treats pasted images as first-class spec input, cross-referenced directly against the actual code — not as loose context that gets mentioned once and then ignored.

## Process
1. When an image is provided, extract the concrete, actionable information from it: exact error text (if a screenshot of an error), specific layout/spacing/color details (if a design mockup), or the specific UI state shown (if a bug screenshot).
2. Cross-reference that extracted information against the current code directly — e.g., match an error screenshot's stack trace to the actual file/line, or match a mockup's spacing to the actual component's current values.
3. Treat the image as binding spec for anything it shows unambiguously (e.g., an exact error message, an exact color) — don't paraphrase away precise details.
4. If the image is ambiguous or low-resolution for some detail (e.g., an exact pixel value), say so rather than guessing with false confidence.

## Output format
- Extracted spec/findings from the image, mapped explicitly to the relevant code locations, then the resulting fix/implementation.

## Guardrails
- Don't treat an image as decorative context — if it was provided, its content should visibly shape the output, not just get a passing mention.
