# Broadcast accounting rollout

The new counter counts Accepted commits awaiting their first finished Segment.
A failed first Segment satisfies drain. Repairs retain that Segment and never
change the counter. Existing retries admitted by the previous implementation
still contribute to its counter, so they must finish before switching versions.
No schema migration is required.

## Preflight

Run the bounded, read-only audit against the deployment being upgraded:

```sh
pnpm exec convex run --inline-query "$(cat scripts/inspect-broadcast-accounting.query.js)"
```

The command defaults to development. An authorized production operator can add
`--prod`. Tools available in this implementation session cannot inspect
production user data; a development result does not establish production safety.
The audit returns aggregate counts, without caption text or identifiers.

Proceed only when `complete` is true, `pendingRetries` is zero, and
`invalidCountStates` and `countMismatches` are zero. Count equality is evaluated
only for a complete audit. Before rollout, pending old repairs count as obligations;
after repairs have settled, the same comparison verifies first-outcome accounting.
Pending initial work can continue through deployment.
If `complete` is false, stop: use an authorized paginated audit of all Accepted
commits and Broadcasts before deciding whether deployment is safe. The bounded
sample cannot establish that no retries exist. Resolve invalid counter states
before rollout; do not mask them by rewriting counters blindly.

## Conditional retry pause

If retries are pending, deploy an intermediate version of the **old** backend
that rejects new retry admission with a temporary maintenance error. Keep its old
retry completion and counter accounting intact. Initial acceptance and provider
work can continue. Let all previously admitted retries finish, then rerun the
preflight. If retries remain pending, investigate their Workpool outcomes rather
than switching accounting early.

When the complete audit reports no pending retries and no invalid counter states,
deploy this implementation. Its retry mutation restores normal admission, so no
permanent pause flag or compatibility branch is needed. If preflight initially
reports no pending retries, coordinate retry admission during the audit/deploy
window: use the same temporary pause when another Operator could admit a retry.

## Verify after deployment

Rerun the audit before admitting new repairs and confirm first-outcome count equality.
The audit uses old retry accounting during preflight, so settle any new repairs
before repeating this comparison on the upgraded deployment.
Verify a failed caption can be retried on a sealed Broadcast,
its finished fallback remains visible during repair, and the same Segment is
updated on success. Verify stopping and starting Broadcasts does not wait for
repair, while Session deletion does. The registered-function and Operator UI
tests exercise these contracts without contacting translation providers.

Do not roll back across accounting versions while repairs are pending. Quiesce
retry admission and settle repairs first; old completion code would decrement a
counter that the new admission code did not increment.
