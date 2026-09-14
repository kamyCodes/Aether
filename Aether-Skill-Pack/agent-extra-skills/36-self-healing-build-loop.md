# Self-Healing Build Loop

## Trigger
- After generating or modifying code, before presenting it as finished.
- User says "make sure this actually builds/passes", "fix it until it works".

## What it does
After every generated change, runs build/lint/test, parses the actual error output, and iterates fixes autonomously up to a capped attempt count — then reports plainly what it couldn't resolve, instead of claiming success it didn't verify.

## Process
1. After making a change, run the project's build, lint, and test commands (detect from package.json/Makefile/CI config).
2. Parse actual error output — not just "did it exit 0" but what specifically failed and why.
3. Apply a targeted fix for the specific error (not a broad rewrite), then rerun.
4. Repeat up to a capped number of attempts (default 5) to avoid infinite loops or increasingly desperate/unrelated changes.
5. If still failing after the cap, stop and report exactly what's broken, what was tried, and why remaining attempts didn't fix it — never claim success without a clean run.

## Output format
- Attempt log (brief): what failed, what fix was tried, outcome — then final status: clean pass, or explicit list of remaining failures.

## Guardrails
- Never report "done" or "should work now" without an actual clean run to back it up.
- If a fix attempt would mask a failure rather than address it (e.g., deleting a failing test instead of fixing the bug it caught), don't do it — flag the real issue instead.
