# Test Gap Finder

## Trigger
- User says "find missing tests", "improve coverage", "what's untested here".
- After adding new logic with conditional branches.

## What it does
Runs (or reads) coverage data and generates tests specifically for uncovered branches — not a blanket regeneration of the whole test suite.

## Process
1. Run the project's coverage tool if available; otherwise, statically identify conditional branches (if/else, switch, try/except, ternaries) in the target file.
2. Rank uncovered branches by how many other functions/modules call into them (higher connectivity = higher priority).
3. For each prioritized branch, write a focused test that exercises exactly that path, following the existing test file's conventions (framework, fixtures, naming).
4. Do not rewrite or duplicate existing passing tests.

## Output format
- List of uncovered branches ranked by priority, with a one-line reason each.
- New test code, grouped by file, ready to drop into the existing test files.

## Guardrails
- Match existing test style exactly (assertion library, mocking patterns, naming convention) — don't introduce a second testing paradigm.
- If a branch is uncovered because it's actually dead code, say so instead of writing a test for it.
