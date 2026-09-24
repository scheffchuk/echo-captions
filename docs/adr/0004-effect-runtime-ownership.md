# ADR-0004: Effect runtime ownership across Convex and React

## Status

Accepted (2026-08-28); amended 2026-09-21

## Context

The partial Effect rewrite leaves runtime ownership and failure presentation split across provider modules, Convex action entries, React hooks, mutable refs, and Promise callbacks. Backend provider modules currently export process-global runtimes, the generic Convex runner permits unhandled typed errors, and shallow forwarding interfaces add ceremony without hiding policy. The browser separately duplicates ElevenLabs connection state and Convex recording state while manually coordinating media cleanup, unload behavior, and asynchronous commands.

The application deliberately wants broad Effect use, including the browser, but Convex must remain authoritative for durable and reactive server state, TanStack Start must retain its native request and routing interfaces, and ElevenLabs must retain ownership of its React hook state. Effect should deepen lifecycle-heavy modules without wrapping pure calculations or duplicating external state.

## Decision

1. Use the newest compatible Effect v4 prerelease available when implementation begins. Pin `effect` and `@effect/atom-react` to the same exact version and upgrade them atomically. Pin the selected TanStack Form version exactly as part of the same migration review.
2. Each Convex action entry owns one narrow module-scoped `ManagedRuntime`. Provider modules export only their interface and layer. Reused action environments may reuse that runtime, so acquired resources must be abruptly discardable and may not depend on reliable process shutdown or background fibers.
3. Remove `"use node"` from translation and Scribe actions after the deployment build and provider smoke tests prove compatibility with Convex's default runtime. Restore Node only for the action that demonstrates a concrete incompatibility.
4. Ordinary Convex queries, mutations, and persistence inside actions use native async execution. Provider actions own managed runtimes only where a provider layer or typed asynchronous policy adds value. Expected public failures become safe, stable `ConvexError` codes at the registered public edge; unexpected persistence failures and defects remain ordinary server failures.
5. Tagged errors are collocated with the module that owns their meaning. Configuration, authentication or provider rejection, transient unavailability, malformed responses, and Mapping integrity remain distinct. No broad catch substitutes a generic success value or alternate implementation, and no generic Promise-to-Effect persistence adapter is retained.
6. Provider configuration is decoded when its layer is acquired. Google credentials and signing keys are parsed once. Its access-token cache has one constant key, honors provider expiry, caches only success, and gives failure no retention. Scribe credentials are likewise captured by its layer. Secrets, transcripts, mappings, tokens, and raw provider output never enter logs.
7. Google translation runs as one target-specific structured document per Workpool job. Global translation parallelism is four. Each target has a 20-second timeout and at most three total transient attempts with exponential backoff, jitter, and `Retry-After` support. Explicit retries have lower priority than new live-caption targets. Scribe token acquisition gets at most two short transient retries within a ten-second total bound. Permanent failures are validated completion variants; only transient failures throw for Workpool retry.
8. Convex completion mutations own Accepted-commit progress and publish a Segment only after every required target succeeds. Permanent or exhausted failure produces the one failed atomic Segment; later completion callbacks are idempotent no-ops. Shallow persistence-forwarding interfaces are deleted.
9. In the browser, TanStack Router's existing `Wrap` places `@effect/atom-react`'s `RegistryProvider` beside `ConvexAuthProvider`. The provider owns one isolated registry per rendered React application tree. Router context does not carry the registry, and no custom TanStack Start lifecycle is introduced.
10. The browser uses one registry with feature-local runtimes and layers. Convex hooks continue to own transport, authentication, subscriptions, and caching; simple mutations are called directly rather than through a generic Convex-to-Effect adapter. TanStack Start loaders, middleware, redirects, and server functions remain native unless an internal workflow materially benefits from typed Effect failures, resource scope, retry, or concurrency.
11. The Broadcast model, microphone-device workflow, `useRealtimeConnection`, and `useBroadcastRecording` share one feature boundary while retaining the two-hook split. The realtime hook owns the ElevenLabs seam; the recording hook owns Broadcast coordination, direct Convex commands, acceptance ordering, and heartbeat.
12. Browser voice state is derived from ElevenLabs connection status, subscribed Convex Session and Broadcast state, and the current serialized command's `AsyncResult`. There is no independently writable Broadcast lifecycle enum, duplicate recording flag, or duplicate Partial atom. Finalized ElevenLabs callbacks enter one typed Effect event sink; the recording hook consumes them, assigns Commit ordinals, and invokes the Convex acceptance mutation directly.
13. Start and stop commands are serialized. Duplicate commands fail with a typed conflict rather than being ignored. Captures finalized between transcription connection and Convex activation remain ordered in memory and become Accepted commits after activation or Rejected captures if activation fails.
14. Normal stop disconnects Scribe without forcing a manual transcript commit, continues accepting callbacks already delivered for that connection generation, then freezes the Final commit ordinal and calls Convex stop. Missing disconnect acknowledgement fails with `DisconnectTimeout`; it does not guess an ordinal or pretend shutdown succeeded.
15. The active Broadcast scope sends a heartbeat every five seconds after activation; the server considers it lost after approximately twenty seconds without activity. Normal stop releases the heartbeat. `pagehide` attempts the normal stop operation and always releases local media; if the browser disappears before completion, heartbeat expiry authoritatively produces a Lost Broadcast.
16. Rejected captures remain in the current tab's registry until exported or explicitly discarded, but are not written to IndexedDB or another durable browser journal. Existing microphone, viewer-language, and text-size preferences may remain thin, directly validated `localStorage` helpers. Invalid optional preferences are removed and return to their product-defined defaults.
17. Microphone enumeration and `devicechange` handling use scoped Effect resources and Streams. Temporary permission-acquisition tracks are always stopped. `@effect/platform-browser` is not added without a concrete primitive that replaces local machinery.
18. Expected operational failures remain tagged Effect errors and are presented exactly once at the UI edge. Documented ElevenLabs failures are classified explicitly. Unknown SDK errors, impossible state combinations, malformed trusted values, and programming errors become defects and throw; no friendly catch-all or alternate transcription path is added.
19. Migrate the create-event wizard and login form to TanStack Form with Effect Schema through Standard Schema. TanStack Form owns field, validation, and submission state; direct Convex mutations remain authoritative for persisted input. Remove React Hook Form, `@hookform/resolvers`, and Zod after their final usages disappear. Form schemas stay collocated with their feature.
20. Pure calculations remain pure. Effect types, Schema, Match, Scope, Stream, Schedule, and Atom are used where they model real structure; infallible leaves are not wrapped in `Effect.succeed` merely for coverage. OpenTelemetry machinery is not added.

## Consequences

- Runtime ownership is visible at executable entries and rendered React trees rather than hidden in provider modules or router context.
- Convex, TanStack Start, and ElevenLabs keep their native leverage while Effect owns typed workflows, resources, concurrency, and cross-module browser state.
- Ordinary Convex persistence is expressed directly in transaction order; managed Effect runtimes remain at provider action boundaries where their layers and policies are useful.
- Browser coordination is concentrated at the imperative ElevenLabs and Convex seams, and duplicated optimistic source-text reconciliation is gone.
- Effect v4 reactivity remains an unstable prerelease interface, so exact lockstep upgrades and focused integration tests are required.
- Tests run effects directly with controlled layers, registry instances, `TestClock`, and deterministic fibers. Focused React tests verify router registry ownership, Strict Mode behavior, and media/listener cleanup. Convex codegen, type checking, deployment build, JWT signing, Scribe token acquisition, and provider HTTP tests verify default-runtime compatibility.

## Amendment (2026-09-21)

The browser Effect registry was removed (commit `d5e1101`). This supersedes the `@effect/atom-react` pin in decision 1, the `RegistryProvider` in decision 9, the single registry in decision 10, the `AsyncResult` in decision 12, and the registry storage in decision 16.

- `@effect/atom-react` is not a dependency. TanStack Router's `Wrap` places `RejectedCaptureOwnerProvider` beside `ConvexAuthProvider`.
- Rejected captures live in that provider's owner for the lifetime of the rendered tree. They are still not durably journaled.
- Browser voice state derives from ElevenLabs status, Convex subscriptions, and the Broadcast coordinator's serialized command result.
- Microphone enumeration still uses Effect and Stream in `hooks/microphone-devices.ts`. The mic selector owns its lifecycle.
