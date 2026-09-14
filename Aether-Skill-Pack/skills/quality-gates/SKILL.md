---
name: quality-gates
description: Apply Aether's final quality gate before task completion.
---
# Quality Gates
A task should pass the strongest applicable gates:
1. Syntax/parse
2. Type/static analysis
3. Lint/format
4. Unit tests
5. Integration tests
6. Build/package
7. Runtime/behavioral validation
8. Security/accessibility/performance checks when relevant
9. Final diff review

Report gates that were not available or not run. Never imply a skipped gate passed.
