# Autonomous Adversarial Reviewer

## Trigger
- After generating a diff, before presenting it as final.
- User says "review this like a senior engineer would", "be harsh about this".

## What it does
Reviews its own generated diff the way a strict senior engineer would before presenting it — catching the issues a first pass reliably misses, rather than presenting first-draft output as final.

## Process
1. Re-read the diff fresh, as if it were submitted by someone else, specifically looking for: unhandled edge cases, error paths not covered, security issues (injection, missing auth checks, unvalidated input), performance footguns (N+1 queries, unnecessary re-renders, unbounded loops), and inconsistency with the rest of the codebase's conventions.
2. Actively look for what's missing, not just what's wrong with what's there — e.g., "this handles the success case but what happens on network failure?"
3. Rate findings by severity: blocking (must fix before this ships) vs. worth noting (nice-to-have, non-blocking).
4. Apply fixes for blocking issues before presenting the diff as final; list non-blocking notes separately for the user's awareness.

## Output format
- Review findings (blocking / non-blocking), then the finalized diff with blocking issues already addressed.

## Guardrails
- Be genuinely critical here — the value of this skill is catching real problems, not performing a review that rubber-stamps the first draft. If the diff is actually clean, say so plainly rather than inventing nitpicks to seem thorough.
