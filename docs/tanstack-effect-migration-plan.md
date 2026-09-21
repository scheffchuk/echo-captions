# TanStack Start and Effect migration implementation plan

## Status

Completed on 2026-09-02. This record now describes the architecture that is in production code.

## Target shape

- Convex owns durable identity, authorization, Session and Broadcast lifecycle, commit acceptance, translation progress, retry, and reactive projections.
- TanStack Start owns routing, SSR, request interfaces, and simple route workflows.
- Effect owns typed workflows, resource scope, concurrency, schedules, provider interfaces, and lifecycle-heavy browser state without duplicating Convex or ElevenLabs state.
- React views own temporary presentation state. TanStack Form owns form fields, validation, and submission state.
- Expected failures are explicit tagged errors. Defects throw. No alternate provider, guessed success, broad catch, compatibility read, or defensive fallback is added without an approved product rule.
- Development and production Convex tables are empty, so schema replacement is direct. `convex/migrations.ts` and compatibility machinery are removed rather than expanded.

## Implementation order

### 1. Establish the Effect and dependency baseline

- Upgrade to the newest mutually compatible Effect v4 prerelease and `@effect/atom-react`, pinned to the same exact version.
- Add exact compatible versions of TanStack Form and the selected Workpool and HTML-parser dependencies.
- Reread the installed Effect guidance after the upgrade and migrate current Effect imports before feature work proceeds.
- Make provider-facing Convex action entries own narrow module-scoped runtimes; keep ordinary Convex persistence in native async execution.
- Collocate tagged errors, translate expected failures at registered public edges, delete shallow forwarding interfaces, and decode provider configuration during layer acquisition.
- Prove Google signing and Scribe token acquisition in Convex's default runtime, then remove `"use node"` where verified.

Verification gate: Effect unit tests, provider HTTP tests, Convex code generation and type checking, production build, and redacted provider smoke tests.

### 2. Replace the empty Convex schema with the approved domain model

- Define the sole Operator identity and permanent Session slug reservation.
- Replace the recording flag with explicit Session and Broadcast records, including Broadcast identity, sequence, heartbeat, loss, sealing, and Final commit ordinal.
- Add immutable Mapping revisions and Session current-revision references.
- Add Accepted commits, target progress, Omitted positions, and finished Segments keyed by stable Commit identity and position.
- Remove obsolete embedded mappings, in-progress Segment fields, migration functions, and compatibility reads.

Verification gate: schema generation, validator tests, empty deployment validation, and index review for every query path.

### 3. Finish Operator access as the common mutation policy

- Keep Convex Auth and the guarded one-time Operator setup secret.
- Enforce the sole-Operator policy in every protected query, mutation, action, and internal entry that crosses an authorization seam.
- Keep TanStack route guards as navigation UX only; Convex remains authoritative.
- Preserve validated same-origin return paths and the existing session-refresh behavior.

Verification gate: setup races, authenticated non-Operator denial, deleted or missing identity, redirect validation, SSR hydration, and direct-function authorization tests.

### 4. Implement Session and Broadcast lifecycle

- Implement start only after transcription connects and earlier Broadcasts are drained.
- Assign stable Broadcast ID and server sequence during activation.
- Accept heartbeat every five seconds and classify loss after approximately twenty seconds without activity.
- Implement explicit stop with Final commit ordinal, draining, Lost Broadcast recovery, and explicit tail abandonment.
- Permit deletion only for ready Sessions whose Broadcasts are drained; preserve permanent slug reservation.
- Update Session activity only for Broadcast start, Accepted commit, and stop.

Verification gate: concurrent starts, duplicate commands, heartbeat races, normal stop, loss, recovery, abandonment, deletion races, and multi-Session concurrency.

### 5. Implement immutable Translation mappings

- Build the pure target-specific matching module with Unicode NFC, case-insensitive matching, script-appropriate boundaries, longest-match ownership, exact nonrecursive replacement, uniqueness, and approved limits.
- Save canonical immutable Mapping revisions with expected-revision conflicts and no-op detection.
- Point each Accepted commit at the Mapping revision current at acceptance.
- Encode only matched target documents as HTML with unique `translate="no"` spans; use `text/plain` when no target mapping matches.
- Parse Google output with `parse5` and fail with non-transient Mapping integrity errors when fixed occurrences are not returned exactly once.

Verification gate: example tables, Unicode and overlap properties, revision conflicts, acceptance races, HTML encode/decode, reordered fixed spans, no-match text, and malformed provider output.

### 6. Implement transactional commit acceptance and Workpool translation

- Replace the direct browser-to-action path with idempotent `acceptCommit` mutation semantics.
- Validate Commit ID reuse, Broadcast identity, Commit ordinal, immutable transcript snapshot, source language, required targets, and Mapping revision atomically.
- Enqueue one Workpool job per target with global parallelism four and lower priority for explicit retries than new live-caption work.
- Give Google targets a 20-second timeout and at most three transient attempts with exponential backoff, jitter, and `Retry-After`; give Scribe token acquisition at most two short transient retries within ten seconds.
- Record target completion idempotently. Publish one translated Segment only after every target succeeds, or one failed atomic Segment after permanent or exhausted failure.
- Project pending Accepted commits and finished Segments under the same Commit ID for the Operator; expose only finished Segments publicly.

Verification gate: duplicate acceptance, conflicting snapshots, out-of-order completion, repeated source text, partial target completion, Workpool retry classification, callback replay, explicit retry priority, and atomic Segment publication.

### 7. Rebuild the browser Broadcast workflow around scoped Effect resources

- Place `RegistryProvider` in TanStack Router `Wrap` beside `ConvexAuthProvider`.
- Keep the Broadcast model, microphone workflow, `useRealtimeConnection`, and `useBroadcastRecording` within one feature boundary while retaining the two-hook split.
- Derive voice presentation from ElevenLabs status, Convex subscription state, and serialized command `AsyncResult`; remove duplicated writable connection and recording state.
- Feed finalized ElevenLabs callbacks into one typed Effect event sink. Buffer captures during Convex activation, assign stable Commit IDs and ordinals, and call `acceptCommit` directly from the recording hook.
- Scope Scribe connection, temporary media streams, device-change listeners, keyboard and unload listeners, heartbeat, and command fibers.
- Attempt normal stop on `pagehide`; if the page disappears before completion, let heartbeat expiry produce the Lost Broadcast.
- Keep Rejected captures alive for the current tab until export or explicit discard. Do not add IndexedDB or another durable browser journal.
- Remove source-text optimistic reconciliation and consume Convex's Commit-ID projection instead.

Verification gate: start and stop serialization, activation buffering, disconnect timeout, stale callback generations, unmount cleanup, page teardown, rejected-capture export and discard, device permission denial, device changes, Strict Mode, HMR, and registry isolation.

### 8. Complete the TanStack Form and Effect Schema migration

- Move the create-event wizard and login form to TanStack Form.
- Use collocated Effect schemas through Standard Schema for form and Router search validation.
- Keep Convex validators and mutations authoritative for persisted rules.
- Remove React Hook Form, `@hookform/resolvers`, and Zod when no references remain.

Verification gate: per-step validation, transformed submission values, server rejection, duplicate submit, dialog reset, login setup and sign-in, malformed search parameters, and dependency search proving removal.

### 9. Remove superseded machinery and verify the complete architecture

- Delete direct `commitAndTranslate`, shallow Commit storage forwarding, global provider runtimes, embedded mapping code, `isRecording`, source-text caption merging, obsolete tests, and unused dependencies.
- Keep existing thin browser-only preference helpers, validating stored values with Effect Schema and removing malformed optional entries.
- Run lint, all tests, Convex code generation and type checking, production and Vercel builds, SSR checks, and provider smoke tests.
- Review logs for safe identifiers and tags only; confirm transcript, mapping, credential, token, and raw-provider-output redaction.

Completion record: the superseded browser action, persistence forwarding, embedded Session mappings, compatibility reads, migration entry, source-text reconciliation, old tests, and unused direct UI dependencies were removed. Browser preferences now decode with Effect Schema and delete malformed optional values. The final gate covered lint, focused and full tests, Convex code generation and type checking, production and Vercel build paths, SSR-focused router tests, and provider HTTP/signing tests.

## Commit policy

Each numbered slice should land as an automatic commit only after its verification gate is green. If a slice is too large to remain reviewable, split it at an interface that is already independently valid; do not land compatibility scaffolding solely to make an intermediate commit compile.

## Accepted records

- [ADR-0001](./adr/0001-vad-commit-then-translate-action.md): VAD-only capture and atomic translation foundations.
- [ADR-0002](./adr/0002-transactional-caption-acceptance.md): durable Convex acceptance and Commit-ID projection.
- [ADR-0003](./adr/0003-versioned-translation-mappings.md): immutable Mapping revisions and structured fixed spans.
- [ADR-0004](./adr/0004-effect-runtime-ownership.md): Convex and React Effect runtime ownership.
