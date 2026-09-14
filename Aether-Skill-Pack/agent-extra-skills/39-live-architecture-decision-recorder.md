# Live Architecture Decision Recorder

## Trigger
- A significant technical fork during a build: choosing a library, a data model shape, an auth strategy, a pattern for state management.
- User says "log this decision", "write an ADR".

## What it does
Automatically writes a lightweight ADR (what was decided, why, alternatives considered) at each significant technical fork, so decisions and their reasoning aren't lost by the next session.

## Process
1. Recognize when a decision is significant enough to record: it affects multiple future files, would be costly to reverse later, or was a genuine choice between real alternatives (not a forced/obvious pick).
2. For each such decision, write a short ADR: Context (what problem prompted the decision), Decision (what was chosen), Alternatives considered (briefly, with why they were passed over), Consequences (what this makes easier/harder going forward).
3. Store ADRs in a consistent location (e.g., `/docs/adr/NNN-title.md`), numbered sequentially.
4. Keep each ADR short — a few paragraphs, not an essay. The goal is a fast future lookup, not exhaustive documentation.

## Output format
- One ADR file per significant decision, in the project's ADR folder.

## Guardrails
- Don't write an ADR for every trivial choice — reserve it for decisions that would genuinely confuse a future contributor if left unexplained. Over-logging defeats the purpose.
