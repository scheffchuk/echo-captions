# ADR-0003: Versioned Translation mappings with structured fixed spans

## Status

Accepted (2026-08-28)

## Context

The existing Translation-mapping implementation protects source terms with shared plaintext placeholders, sends the same protected text to every target language, and performs a second replacement pass over translated output. This can suppress normal translation in unrelated target languages, match inside larger words, collide with source text, recursively rewrite output, and publish altered placeholders.

Google Cloud Translation glossaries provide native terminology control, but their regional resource, Cloud Storage, IAM, and long-running update lifecycle adds disproportionate machinery for Session mappings that may change during a live Broadcast. Google Cloud Translation Advanced already supports HTML input with content explicitly marked as not translatable.

## Decision

1. Each saved mapping set is one immutable Mapping revision. A Session points to its current revision, and each Accepted commit points to the revision current when Convex accepts it. Empty mappings use no revision. Canonically equivalent saves are no-ops, and mapping updates carry their expected revision so stale edits conflict instead of overwriting newer work.
2. A Translation mapping applies only to its selected Audience language. Matching uses Unicode NFC and case-insensitive comparison, respects letter-and-number term boundaries in boundary-based scripts, uses literal substring matching in scripts without word separators, and gives the longest valid term ownership of an overlapping source span. Replacements are exact and never recursively remapped.
3. The pure Translation-mapping module validates and canonicalizes revisions and turns source text into an ordered target-specific document of translatable and fixed spans. It is not represented as an Effect `Context.Service`.
4. The Google translation implementation alone encodes fixed spans as HTML `translate="no"` elements and decodes responses with directly declared `parse5`. Every fixed occurrence has a unique identity and must return exactly once, though Google may reorder occurrences for target-language grammar. Targets with no fixed spans continue through `text/plain`.
5. Missing, duplicated, or malformed fixed spans produce a non-transient `MappingIntegrityError`. The complete translation becomes a failed atomic Segment; the Operator may explicitly retry the same Accepted commit and Mapping revision. Viewers never receive markup or raw provider output.
6. The empty development and production tables permit direct replacement of the embedded mapping fields with Mapping revision references. No compatibility reads or migration machinery are retained.

## Consequences

- Google-specific HTML remains local to the external implementation while matching policy remains independently testable.
- Mapping revisions preserve retry semantics without copying the complete mapping set into every Accepted commit.
- Sessions without matching mappings keep the plain translation path and pay no HTML-processing cost.
- Verification covers matching tables, Unicode and overlap properties, Google HTML encoding and decoding through an Effect HTTP test layer, and Convex revision, conflict, acceptance-order, retry, and deletion behavior.
