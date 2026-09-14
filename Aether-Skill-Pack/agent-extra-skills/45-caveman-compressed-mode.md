# Caveman Compressed Mode

## Trigger
- User explicitly requests compressed/low-token output: "caveman mode", "compress this", "cut the filler", "be terse", "minimize tokens".
- Long sessions where cumulative token cost matters and the user has opted into this mode for the session or project.

## What it does
Rewrites the agent's own output into stripped-down, filler-free technical prose — dropping hedges, pleasantries, restated context, and throat-clearing — while preserving exact technical accuracy. Same substance, fewer words, lower token cost per turn. Does not compress code, file content, or anything written to disk — only the agent's own conversational/explanatory text.

## Process
1. Before writing a response, draft it normally, then strip:
   - Filler phrases ("I think", "it's worth noting that", "as you can see", "let me explain")
   - Restated context the user already knows (don't repeat back their question before answering it)
   - Redundant transitions and pleasantries ("Great question!", "Sure, happy to help")
   - Hedging that doesn't change the actionable content ("might possibly", "it could be the case that")
2. Keep every technical noun, number, file path, error message, and instruction exact — compression targets prose scaffolding, never facts, code, or precision.
3. Prefer sentence fragments and direct imperatives over full grammatical sentences where meaning stays clear ("Fix: null check missing on line 42" over "The issue here is that there is a missing null check on line 42, which you'll want to fix").
4. Keep structure (lists, headers, code blocks) exactly as it would normally be — compression is about word choice and sentence economy, not about removing structure that aids scanning.
5. Never compress: code itself, exact error text, commands to run, or anything the user needs to copy verbatim.

## Output format
Same format as a normal response (prose/lists/code as the content calls for) — just shorter, denser, filler-free. No special markers or tags added to output.

## Guardrails
- Never sacrifice technical accuracy or omit a caveat that changes what the user should do, purely to save words — correctness always outranks brevity.
- Don't compress code, logs, or user-facing copy the agent generates as a deliverable (e.g., UI text, commit messages, docs) — only the agent's own explanatory/conversational output.
- If the user asks a question that genuinely needs a nuanced, multi-part answer, compress the prose but don't cut a part of the answer just to hit a shorter length — thoroughness under compression, not thoroughness traded away.
- This mode is opt-in per session/project — don't silently apply it to responses if the user hasn't enabled it.
