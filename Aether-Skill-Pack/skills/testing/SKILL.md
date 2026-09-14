---
name: testing
description: Design and execute reliable tests for software changes.
---
# Testing
Test behavior, not implementation trivia.
Use the smallest relevant test first, then expand to integration/regression checks.
Cover happy paths, boundaries, invalid input, failure modes, and important regressions.
Prefer deterministic tests.
When tests fail, diagnose before changing assertions.
If no tests exist, use typecheck, lint, build, scripts, runtime checks, and focused manual validation.
