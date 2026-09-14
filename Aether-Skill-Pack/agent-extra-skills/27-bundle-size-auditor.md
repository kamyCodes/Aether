# Bundle Size Auditor

## Trigger
- Adding a new dependency, or user says "check bundle size", "is this import too heavy".

## What it does
Flags what a new dependency/import actually costs in bundle size, catches accidental full-library imports where a tree-shakeable subpath exists, and suggests lighter alternatives.

## Process
1. Check the actual import statement: is it importing the whole library (`import _ from 'lodash'`) when a subpath/tree-shakeable import exists (`import debounce from 'lodash/debounce'`)?
2. Look up (or estimate from known package size data) the added dependency's minified+gzipped size.
3. If the same functionality is already covered by an existing dependency in the project, flag the redundancy instead of adding a new one.
4. For genuinely new functionality, suggest the smallest well-maintained option if a significantly lighter alternative exists, without sacrificing needed features.

## Output format
- Import statement reviewed | full vs. tree-shaken | estimated size impact | lighter alternative if one exists

## Guardrails
- Don't recommend swapping a library purely for size if it would mean losing features actually in use — note the tradeoff explicitly instead of silently optimizing for size alone.
