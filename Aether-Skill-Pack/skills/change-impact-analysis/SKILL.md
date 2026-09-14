---
name: change-impact-analysis
description: Identify dependencies and regression risks before significant changes.
---
# Change Impact Analysis
Map:
- direct callers/users
- imports/dependents
- API consumers
- data/schema dependencies
- configuration
- tests
- deployment assumptions

Classify impact as local, module, cross-module, or system-wide.
Use the result to determine verification depth.
