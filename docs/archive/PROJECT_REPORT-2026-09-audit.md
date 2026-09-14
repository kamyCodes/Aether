# Aether — Full Project Change Report

**Project:** Aether (`C:\Users\Kamy\Hybrid`) — AI coding IDE + autonomous agent
**Stack:** React 18 + TypeScript + Zustand + Vite (frontend) · Express + ws + tsx (backend) · OpenAI-compatible model endpoint (OmnitRoute, default `http://localhost:20128/v1`)
**Data dir:** `~/.aether` (settings, skills, checkpoints, permissions, memory, history)

This report covers every change made during this engagement, in the order it happened.

---

## 1. Folder picker: kill the stale `window.prompt` (root-cause fix)

**Problem:** The app kept showing the raw browser prompt *"Absolute folder path to open as workspace"*.

**Root cause found:** An earlier half-finished migration left syntax errors in the source (`await` inside non-async click handlers in `WelcomeScreen.tsx` and `CommandPalette.tsx`). Vite failed to compile every time, silently serving the **last successful build** — which still contained `window.prompt`. So no source fix ever reached the browser.

**Changes:**
- `src/components/WelcomeScreen.tsx` — made the onClick `async` (this alone unblocked compilation)
- `src/components/CommandPalette.tsx` — made three handlers `async`; widened `Cmd.run` type to `void | Promise<void>`
- `src/components/Sidebar.tsx` — migrated both "Add Folder" buttons to the in-app `promptDialog` with a **Browse…** button hitting `POST /api/pick-folder`
- Rebuilt the bundle; verified no `window.prompt` remained in `dist/`

**Lesson embedded:** the in-app dialog system (`src/lib/dialogs.ts` — zustand-based `promptDialog`/`confirmDialog`/`alertDialog`, rendered by `src/components/Dialogs.tsx`) is the canonical replacement for all native browser dialogs.

---

## 2. Native folder picker: behind-window → Explorer-style, owned & on top

**Problem:** The picker opened behind the app window. The user asked for the modern picker "other sites use" (the Vista+ Explorer-style dialog).

**Iterations:**
1. First attempt: PowerShell `FolderBrowserDialog` with an invisible owner form + `SetForegroundWindow` — still stacked behind (owner form lived in a different process).
2. Second attempt: hand-written C# COM interop for `IFileOpenDialog` (ComImport interfaces, `FOS_PICKFOLDERS`), compiled at runtime via `Add-Type`, owned by `GetForegroundWindow()`.
3. **Marker binding:** frontend (`Dialogs.tsx`) tags `document.title` with a one-time `AETHER-PICKER-xxxx` token for the duration of the request; the C# enumerates windows (`EnumWindows` + `GetWindowText`) to find the Aether window **by identity, not focus**, and owns the dialog to it. Falls back to `GetForegroundWindow()`.
4. **Runtime failure discovered** (later, when the picker stopped appearing at all): `QueryInterface` for `IFileDialog` fails with `E_NOINTERFACE` on this machine — even on an explicit STA thread. The COM interop had only ever been *compile*-tested.
5. **Final working version:** WinForms `OpenFileDialog` — which .NET auto-upgrades to the same Vista+ Explorer-style dialog — repurposed as a folder picker via the classic fake-filename trick (`ValidateNames=false`, `FileName="Select this folder"`, then deriving the directory from the result). Runs on a dedicated STA thread. `FolderBrowserDialog` kept as in-code last resort; compile failures now write to stderr and exit nonzero instead of failing silently.

**Files:** `server/folderPicker.ts` (C# source embedded, PS script generated to temp, spawned per request with 120s timeout), `src/components/Dialogs.tsx`.

**Verification:** user confirmed the dialog appeared on top and returned their picks — both folder mode (`aether-demo`, `IRIS-workspace`) and file mode.

---

## 3. Empty-tree bug: picomatch negation trap

**Problem:** Workspace selected but the Files tree was empty; even `README.md` was filtered out.

**Root cause:** `pga-web`'s `.gitignore` contains a negation rule (`!.vscode/extensions.json`). `readIgnore` merged all patterns into a single `picomatch()` call — and a pattern list containing **any** `!` negation inverts picomatch's semantics, so every non-matching path returned `true` (ignored). Everything was filtered.

**Fix (`server/workspace.ts`):** positive and negative patterns matched **separately** — a path is ignored only if it matches a positive pattern *and* no negative pattern. Also added bare directory names (`node_modules` itself, not just `node_modules/**`) so top-level junk hides cleanly.

Also that session: **"This folder is empty"** empty-state in the Files panel (`Sidebar.tsx`) instead of a blank tree, including folders whose visible content is only ignored files.

---

## 4. Monaco overflow fix

**Problem:** Monaco's IntelliSense suggestion widget rendered detached from the editor, floating over the rest of the UI (screenshot-verified).

**Fix (`src/components/EditorView.tsx`):** `fixedOverflowWidgets: true` on the Monaco options + `position: relative; overflow: hidden` on the editor wrapper as containment backstop.

---

## 5. AgentPanel redesign — the specified visual language

Rebuilt `src/components/AgentPanel.tsx` + `src/styles.css` to spec:

- **Tool calls as bordered cards** (`.tool-card`): flat `--bg-elev`, 1px hairline border, tool name + mono param line, result/error collapsed behind a chevron expanding to a scrollable mono block; non-tool activity renders as plain conversational lines
- **Inline permission prompts**: accent-tinted cards with **Allow Once** (accent primary) / **Allow Always** / **Deny**; answered prompts collapse to a confirmation instead of vanishing. Question cards support choice/yesno/text/confirm kinds
- **Streaming status strip**: fixed 28px strip, pulsing accent dot + present-tense verb ("Reading file...", "Running command...", "Running tests..." — derived from tool name); fixed height so transitions never reflow
- **Diffs**: proposal cards with `+N −N` counts in semantic colors; View Diff opens the existing green/red diff tab
- **Persistent input bar** pinned at the bottom on a distinct shade (`--seg-track`), starts follow-up tasks
- State changes are color/icon-driven only; no gradients, no shadows, no layout shift

**Bug found during live verification:** every tool card rendered as a 2px sliver — flexbox was *shrinking* children of the scroll container (`.tool-card` has `overflow:hidden`, so min-height collapses to 0). Fix: `.agent-scroll > * { flex-shrink: 0; }`.

**End-to-end verification** (mock model endpoint, `scripts/mock-omni.mjs` — an OpenAI-compatible fake that issues scripted tool calls): real task run through the UI produced task queue rows, permission prompt (exercised both Allow and Deny paths), streaming strip, tool cards with expandable results, proposal card. Screenshots captured throughout.

---

## 6. Memory: agent memory + task-history persistence

**Agent memory (`server/memory.ts`):**
- Per-workspace durable facts stored in `~/.aether/memory/<workspaceId>.json` (dedup, 500-char/200-entry caps, in-process cache)
- Injected into the system prompt of every task in that workspace
- New **`save_memory` agent tool** (`server/tools.ts`); system prompt instructs the agent when to use it
- REST: `GET/POST /workspaces/:id/memory`, `DELETE /:entryId`, `POST /clear`; `memory` WS event broadcast
- UI: collapsible **Memory strip** atop the AgentPanel (brain icon, count badge, hover-forget, Forget all, add-your-own input)

**Task history (`server/history.ts`):**
- Tasks + activity + transcripts mirror to `~/.aether/history/<taskId>.json` (500ms debounced writes)
- Restored on server boot (`restorePersisted` — interrupted tasks marked failed); frontend fetches `GET /api/agent/tasks` on load, so the panel survives F5 and restarts

**Verified live:** agent ran a task, called `save_memory` mid-run (strip went 2 → 3), tasks restored after reload; disk files confirmed.

**Known gap (flagged, not fixed):** the workspace registry itself is still in-memory — workspaces must be re-added after a backend restart (memory/history survive; the registry doesn't).

---

## 7. File picker: mode split (folder vs file)

- `server/folderPicker.ts` parameterized with `mode: 'folder' | 'file'` (C#, PS args, macOS `choose file/folder`, Linux zenity)
- `POST /api/pick-folder` accepts `mode` + `workspaceId`; in file mode returns a **workspace-relative** path when the pick is inside the workspace
- Frontend: `openFileWithNativePicker()` (`Dialogs.tsx`); **Ctrl+K → "Open File (system dialog)…"** (`CommandPalette.tsx`); opens in the editor; alerts if no workspace is open

---

## 8. File & folder creation in the open workspace

- `Sidebar.tsx`: **New file / New folder in root** buttons atop the Files tree; hovering any folder reveals inline **New file here / New folder here**
- Names support nested paths (`src/utils/newfile.ts` creates the parent chain)
- Store: `createFile` (creates + opens the file), `createFolder` (creates via `.gitkeep` placeholder so the tree shows it)
- Verified via API: nested creation and cleanup

---

## 9. Rename, delete, auto-refresh

- **Rename** (`renameEntry`): prompt pre-filled with current path — supports in-place rename *and* move (`notes.md` → `src/docs/notes.md`); open tab, content cache, and dirty marker follow the file to its new path
- **Delete** (`deleteEntry`): confirmation dialog (sterner for folders, mentions checkpoints), removes from disk, closes tabs that had the file open
- Tree hover actions: files get Rename/Delete; folders get New file/New folder/Rename/Delete
- **Auto-refresh:** watcher plumbing existed (chokidar → `fs:change` WS broadcast → `refreshTree`) but bursts fired overlapping refetches — now coalesced through a 250ms debounce; deleted files also auto-close their editor tabs (no ghost tabs)
- Verified the full loop live: create → rename (tree updated) → delete (tree updated)

---

## 10. Small UX polish

- **Picker-waiting feedback** in the Add Workspace dialog: Browse… becomes "Waiting for picker…" with a pulsing status line "Opening system dialog — pick a folder or cancel to return here…" while the native dialog is open

---

## Infrastructure created along the way

| Artifact | Purpose |
|---|---|
| `scripts/mock-omni.mjs` | OpenAI-compatible mock model endpoint (port 20128) for end-to-end agent-loop verification without a real model; scripted to exercise tool calls, permission gating, and `save_memory` |
| `scripts/test-picker-compile.mjs` | Regenerates the temp PowerShell picker test from `server/folderPicker.ts` source — regression check that the embedded C# compiles |
| `~/.aether/memory/`, `~/.aether/history/` | New persistent stores (alongside existing settings/skills/checkpoints/permissions) |

## Recurring failure patterns this project surfaced (and how they were handled)

1. **Silent stale bundles** — broken source + a serving fallback = fixes that never ship. Diagnosis: compare source vs `dist/` content; verify by rebuild + hard refresh.
2. **Compile-tested ≠ run-tested** — the COM interop compiled perfectly and never worked at runtime. Now every picker change is verified with an actual dialog spawn.
3. **Swallowed errors** — `catch { return null; }` in the picker hid the real HRESULT for weeks of sessions. Compile failures now propagate; error text reaches stderr.
4. **Library semantic traps** — picomatch's negation-list inversion; flex-shrink collapsing scroll-container children. Both found by bisecting against live behavior, not by reading code.

## Known open items

- Workspace registry not persisted across backend restarts (memory/history/settings are)
- Proposals can accumulate in the AgentPanel after multiple runs (stale cards not auto-dismissed)
- Completed tasks' live activity only streams over WS — history restore covers restarts, but in-session page reloads repopulate task rows without their streaming state
- macOS/Linux branches of the picker (`osascript`, `zenity`) follow the same mode API but were not exercised on this Windows machine
