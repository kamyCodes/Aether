# Commit Message Quality Skill

## Trigger
- Ready to commit staged changes, or user says "write a commit message", "draft a commit".

## What it does
Reviews staged changes and drafts a commit message matching the repo's actual convention (conventional commits, ticket-prefix style, imperative one-liners, etc.), inferred from git log history — not a generic template.

## Process
1. Read the last 20-30 commit messages in the repo's history to infer the actual convention in use (format, typical length, whether scopes/types are used, whether ticket numbers are referenced, tense/voice).
2. Review the staged diff to understand what actually changed and why (not just which files).
3. Draft a message matching the inferred convention exactly — same structure, same level of detail.
4. If the diff bundles multiple unrelated changes, flag that it probably should be split into separate commits, rather than writing one message that awkwardly covers everything.

## Output format
- Drafted commit message in the repo's exact convention, plus a note if the diff looks like it should be split.

## Guardrails
- If the diff includes something that looks like a mistake (leftover debug code, commented-out blocks, an accidental file), flag it before drafting the message — don't just write a clean message over messy staged changes.
