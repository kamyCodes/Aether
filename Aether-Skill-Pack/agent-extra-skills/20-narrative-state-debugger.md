# Narrative-State Debugger for Agentic UIs

## Trigger
- Multi-step AI/agent-driven interfaces (assistant UIs, conversational agents, multi-turn workflows like a JARVIS-style system or an analysis pipeline with a UI).
- User says "the UI doesn't match what the agent is doing", "state seems out of sync".

## What it does
Traces a session's UI state transitions against the underlying agent/session state and flags where they've desynced — a common bug class in AI-driven interfaces where the UI shows a stale step, wrong status, or mismatched output.

## Process
1. Map out the expected state machine: what states can the agent/session be in (idle, thinking, tool-calling, streaming, error, done), and what should the UI show for each.
2. Trace an actual session's transitions (from logs, state store, or event stream) and record the UI's displayed state at each point.
3. Diff expected vs. actual: find points where the UI lagged, skipped, or showed a state the backend never reported (e.g., UI stuck on "thinking" after the agent already errored, or UI shows results before streaming actually completed).
4. Identify the root cause: race condition, missed event, incorrect state derivation, or a state the UI simply doesn't handle.

## Output format
- Timeline: timestamp | backend state | UI state | desync? | likely cause

## Guardrails
- Don't just recommend "add a loading spinner" as a fix for a desync — identify and fix the actual event/state-handling gap causing it.
