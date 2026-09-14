# Autonomous Root-Cause Debugger

## Trigger
- Given a bug report, error message, or stack trace.
- User says "why is this happening", "debug this", "find the root cause".

## What it does
Forms hypotheses, adds targeted instrumentation, reproduces the failure, and narrows to root cause before writing any fix — no shotgun patching based on a guess.

## Process
1. Restate the observed symptom precisely (what's expected vs. what actually happens, exact error text/stack trace).
2. Form 2-4 concrete hypotheses for the cause, ranked by likelihood given the symptom and the surrounding code.
3. For the top hypothesis, identify the cheapest way to confirm or rule it out — targeted logging, a minimal repro script, or reading the exact code path the stack trace points to.
4. Iterate: rule hypotheses in/out based on evidence, not assumption, until one is confirmed with actual evidence (not "this is probably it").
5. Only once root cause is confirmed, write the fix — targeted at the actual cause, not the symptom.
6. State explicitly what evidence confirmed the root cause, so the fix isn't taken on faith.

## Output format
- Hypotheses considered (and why ruled out, if any were), confirmed root cause with evidence, then the fix.

## Guardrails
- Never present a fix as "this should solve it" without having actually confirmed the root cause first — a guess-and-patch approach is exactly what this skill exists to avoid.
- Don't leave debug instrumentation/logging added during investigation in the final fix unless it's genuinely useful long-term — clean it up.
