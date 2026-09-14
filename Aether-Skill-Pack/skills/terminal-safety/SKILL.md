---
name: terminal-safety
description: Safely execute shell commands and system operations.
---
# Terminal Safety
Classify commands before execution:
- Read-only: inspect/search/status
- Reversible mutation: create/edit/build/install
- High-risk: delete/reset/overwrite/permission/network/system changes

Run low-risk commands freely.
For destructive or irreversible operations, require explicit user confirmation unless Aether policy explicitly authorizes the action.
Never expose secrets from environment variables or credential stores.
Prefer narrowly scoped commands over broad recursive/destructive commands.
