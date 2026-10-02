# ADR-0002: Transactional caption acceptance and Convex-owned delivery

## Status

Accepted (2026-08-27)

## Context

The browser previously sent each VAD commit directly to a `commitAndTranslate` action and reconciled an unrelated optimistic caption to the resulting Segment by source text. That path could reorder repeated captions, lose identity across retries, and left action delivery and retry policy split between browser and backend. We considered a durable IndexedDB dispatcher, but rejected its storage, replay, claim, and migration machinery in favor of Convex's existing mutation, optimistic-update, reactive-query, and Workpool modules.

## Decision

1. The capture owner assigns one stable Commit ID and Commit ordinal to every VAD commit. Caption order is the immutable pair of server-assigned Broadcast sequence and capture-assigned Commit ordinal.
2. The browser calls an idempotent `acceptCommit` mutation. The mutation validates identity and position, atomically stores the Accepted commit and its Translation-mapping snapshot, and enqueues an internal translation action in Workpool.
3. Workpool owns bounded provider concurrency and bounded retries of typed transient failures. Its completion mutation produces exactly one translated or failed Segment for the Accepted commit.
4. The Operator caption query projects Accepted commits and finished Segments under the same Commit ID. A Convex optimistic update inserts the pending Accepted commit until the authoritative projection arrives; source text is never an identity or reconciliation key. Public feeds expose only finished Segments.
5. The browser has no durable capture journal, custom drain lease, or provider retry loop. Convex automatically retries outstanding mutations while the client remains alive and warns before leaving; durability begins when `acceptCommit` succeeds. A reload or crash before acceptance can lose that capture, and a Lost Broadcast with no recoverable client record requires explicit abandonment of its unknown tail.

## Consequences

- The backend becomes the single owner of acceptance, translation progress, retry, and terminal Segment creation.
- Browser code keeps only active Broadcast identity, the next Commit ordinal, and ephemeral mutation state; `mergeBroadcastCaptions` and its source-text tests are deleted.
- Starting another Broadcast remains blocked until every prior Broadcast is drained or its unknown tail is explicitly abandoned.
- This supersedes ADR-0001's direct browser-to-action delivery and custom lease-recovery decisions while preserving its VAD and atomic translation decisions.

## Amendment: Broadcast accounting and caption repair (2026-10-02)

Named Broadcast transaction workflows own acceptance, retry admission, completion,
and first publication. Registered Convex functions remain their public and test
surface. Broadcast position admission and drain updates are centralized in the
Broadcast module; Workpool and Session deletion retain their existing ownership.

Accepted positions are contiguous. Each position satisfies drain permanently
when its first translated or failed Segment is published. Repairs reuse the same
Commit ID, position, mapping snapshot, and Segment without reopening or delaying
Broadcast sealing. A Lost Broadcast still requires abandonment of its unknown
tail even after every known position has finished.

An Operator can repair a failed caption in every Broadcast state while the
Session exists and is not deleting, including after a later Broadcast starts.
Different captions can be repaired concurrently; repeated admission for an
already pending commit is a no-op. Deletion waits for admitted repairs. A repair
retains the last finished caption for both Operator and audience, and publishes
its replacement atomically. Retry progress is visible only to the Operator.
Older captions can be loaded explicitly in bounded pages.

The accounting transition requires old pending retries to finish before rollout.
The conditional pause and read-only preflight are documented in
[broadcast-accounting-rollout.md](../broadcast-accounting-rollout.md).
