# Code Complexity Reducer

## Trigger
- User says "simplify this", "reduce complexity", "this function is too complex".
- Any function with deep nesting, long parameter lists, or high branching.

## What it does
Scans for cyclomatic complexity, deep nesting, and long parameter lists, then proposes concrete refactors ranked by complexity-reduction-per-line-changed — not style nitpicks.

## Process
1. Identify complexity signals: nesting depth >3, cyclomatic complexity above a reasonable threshold (rough proxy: count of if/else/case/&&/||/catch branches), functions with >4-5 parameters, functions doing more than one clear responsibility.
2. For each hotspot, propose the specific refactor: extract function, early return/guard clause, replace nested conditionals with a lookup table or polymorphism, collapse a long parameter list into an options object.
3. Rank proposed refactors by impact: complexity reduced vs. lines of code touched — prioritize high-impact, low-risk changes first.
4. Apply refactors incrementally, preserving behavior exactly — no functional changes bundled in.

## Output format
- Ranked list: hotspot (file:function) | current complexity signal | proposed refactor | estimated impact
- Refactored code for the top-ranked items.

## Guardrails
- Never change behavior while "simplifying" — if a refactor would change an edge case's outcome, flag it instead of silently applying it.
- Don't over-abstract: extracting a function used exactly once for no clarity gain is not a win. Only recommend changes that measurably reduce complexity or improve readability.
