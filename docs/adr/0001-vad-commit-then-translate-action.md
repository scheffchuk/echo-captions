# ADR-0001: VAD commits and atomic caption outcomes

## Status

Accepted (2026-07-18; amended 2026-08-26; commit delivery superseded by ADR-0002 on 2026-08-27)

## Context

Live captions use ElevenLabs Scribe with `CommitStrategy.VAD`. After a VAD commit, the app inserted a `translating` Segment, scheduled an internal action, re-fetched segment + session, optionally called Google `detectLanguage`, translated, then `markTranslated`. That hop chain added latency after speech already waited for silence.

We considered MANUAL commits with max-age flush to shrink long monologues. Product chose to keep VAD silence as the only finalize trigger and one Segment per VAD commit (no sentence post-split).

## Retained decision

ADR-0002 supersedes the direct browser-to-action handoff, client-owned optimistic reconciliation, and custom lease-recovery design. The following decisions remain accepted:

1. Keep **VAD** as the only Scribe commit strategy for mic broadcast (`vadSilenceThresholdSecs: 0.31` — SDK rejects `<= 0.3`).
2. Resolve source language from Scribe `language_code` plus the spoken-language fallback; **do not** call Google `detectLanguage` on the live path.
3. A Segment is never used as in-progress workflow state. Operator projections may show pending Accepted commits, while viewers see only finished Segments.
4. Translation is atomic across required Audience languages. A failed attempt stores one failed Segment with source fallback and no partial translations. An explicit retry reuses the Accepted commit and Segment, leaving the prior failed outcome visible until a successful retry atomically replaces it.

## Superseded historical decision

The former public `commitAndTranslate` action, browser fire-and-forget delivery, client optimistic source-text reconciliation, processing lease, and scheduled lease recovery were superseded by ADR-0002. Current delivery is the transactional `acceptCommit` mutation followed by Workpool-owned target execution and Convex-owned completion.

## Consequences

- Viewers never see a shared `translating` source flash.
- A reused Commit ID with a different immutable snapshot is rejected as a conflict.
- Only typed transient provider failures are retried automatically, with bounded backoff. Configuration, credential, invalid-request, and malformed-response failures fail immediately.
- Long continuous speech without pause still yields large Segments (VAD / ~36s Scribe auto-commit) — accepted.
- Translation failure is a durable outcome; command rejection and persistence failure remain typed errors.
