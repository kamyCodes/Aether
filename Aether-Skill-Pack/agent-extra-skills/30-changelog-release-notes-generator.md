# Changelog/Release Notes Generator

## Trigger
- Preparing a release/tag, or user says "generate changelog", "draft release notes".

## What it does
Reads merged commits/PRs since the last tag and drafts categorized release notes in the project's existing changelog voice and format.

## Process
1. Get the list of commits/PRs since the last tag (git log or PR list).
2. Read the existing CHANGELOG.md (if present) to match its established format, heading style, and tone (terse bullet list vs. narrative, whether it credits authors, whether it links PRs/issues).
3. Categorize entries: Features, Fixes, Breaking Changes, Chores/Internal (only if the existing changelog tracks that level of granularity — don't add a category the project has never used).
4. Rewrite raw commit messages into user-facing language where the raw message is too technical/internal to be meaningful to someone reading the changelog (e.g., "fix null check in parseUser" → "Fixed a crash when loading a profile with a missing name").
5. Flag anything that looks like a breaking change prominently, even if the original commit didn't mark it as one.

## Output format
- Draft changelog entry in the exact format/style of the existing file, ready to prepend.

## Guardrails
- Don't invent user-facing impact for an internal-only change — if a commit is purely internal/refactor with no user-visible effect, it either goes in an "Internal" section (if the project has one) or is omitted, not dressed up as a feature.
