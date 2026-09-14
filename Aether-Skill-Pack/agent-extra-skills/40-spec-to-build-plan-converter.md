# Spec-to-Build-Plan Converter

## Trigger
- User has a loose product idea and wants it built, but hasn't specified a structured plan.
- User says "here's my idea, build it" or similar unstructured product asks.

## What it does
Converts a loose product idea into a structured plan — data model, user flows, milestone sequence — before any code gets written, front-loading planning the way high-end app-builder tools do.

## Process
1. Extract from the idea: who the users are, what the core actions/flows are, what data needs to persist, and what "done" looks like for a first working version (not every possible feature).
2. Draft a data model: entities, key fields, relationships.
3. Draft the core user flows as numbered steps (e.g., "1. User signs up. 2. User creates a board. 3. User adds cards to the board.").
4. Sequence a milestone plan: what's the smallest version that's actually usable end-to-end (walking skeleton), then what gets layered on after.
5. Present this plan for confirmation before starting implementation, unless the user has explicitly asked to skip straight to building.

## Output format
- Structured plan: entities/data model, core flows, milestone sequence (v0 walking skeleton → v1 → v2).

## Guardrails
- Resist the urge to plan every feature the idea could eventually have — scope the first milestone to something genuinely buildable and testable, and clearly separate "v0" from "later."
