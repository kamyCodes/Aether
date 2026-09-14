# Error/Logging Consistency Enforcer

## Trigger
- Adding error handling/logging, or user says "check logging consistency", "standardize error handling".

## What it does
Checks that errors are logged with a consistent structure (level, context fields, stack trace inclusion) across the codebase, instead of every file inventing its own shape.

## Process
1. Sample existing logging calls across the codebase to establish the current convention (or lack thereof): what fields are typically included (request ID, user ID, error code), what log levels are used for what severity, whether stack traces are included for errors.
2. Check new/target code against this convention.
3. If the codebase has no consistent convention yet, propose one based on best practice for the stack (structured logging with consistent fields) rather than inventing something disconnected from how the team already logs.
4. Flag: swallowed errors (caught but not logged at all), logged-but-wrong-level (an actual failure logged as `info`), and missing context (an error logged with no identifying info to debug it later).

## Output format
- Findings: location | issue (swallowed / wrong level / missing context / inconsistent shape) | fix

## Guardrails
- Never suggest logging sensitive data (passwords, tokens, full PII) as part of "adding context" — flag if existing logging already does this.
