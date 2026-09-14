# XML/Document-Structure Validator

## Trigger
- Working with XML, DOCX-internal XML, XSD-bound documents, or any schema-validated document format.
- User says "validate this XML", "why is this document invalid", "check against the schema".

## What it does
Validates a document against its schema (XSD/DTD/RelaxNG) and translates raw parser errors into plain-language explanations with a suggested fix.

## Process
1. Locate or ask for the schema the document should conform to.
2. Run validation and capture all errors, not just the first one.
3. For each error, translate the parser's technical message (e.g., "cvc-complex-type.2.4.a") into a plain description: what element/attribute is wrong, what was expected, where in the document (line/path).
4. Group related errors (e.g., 10 errors from one missing namespace declaration) instead of listing them as 10 separate unrelated problems.
5. Propose the minimal fix for each group.

## Output format
- Grouped error list: plain-language description | location | suggested fix
- Note if one root cause is producing a cascade of downstream errors.

## Guardrails
- Don't auto-modify the document without showing the diff first — structural XML edits can silently corrupt formatting (especially inside DOCX/OOXML).
