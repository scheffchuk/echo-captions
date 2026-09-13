# Echo — domain context

Live captions for events: an operator broadcasts speech; audience languages get machine-translated captions.

## Glossary

| Term | Meaning |
|------|---------|
| **Session** | One broadcast event instance with a permanent public slug, spoken and audience languages, and Translation mappings. It is owned by the Operator who created it. A deleted Session's slug is never reused. |
| **Session lifecycle** | A Session is **ready**, **live**, or **deleting**. Ready Sessions may be configured, but may begin a Broadcast only when every earlier Broadcast is drained; live Sessions accept commits; deleting Sessions are unavailable and accept no further changes. Only a ready Session whose Broadcasts are drained may enter deleting. |
| **Broadcast** | One live interval within a Session, from a successful start after transcription is connected until an explicit stop or loss of the active broadcaster. A Session has at most one active Broadcast, while different Sessions may be live concurrently. |
| **Lost Broadcast** | A Broadcast whose active broadcaster disappeared before declaring a Final commit ordinal. It remains unsealed and blocks another Broadcast until recovered or its unknown tail is explicitly abandoned. |
| **Abandoned tail** | The possibly unreceived end of a Lost Broadcast that the Operator explicitly relinquishes when no recoverable capture record remains. The Broadcast is then sealed at its highest server-known Commit ordinal. |
| **Broadcast ID** | The stable identity of one activated Broadcast, shared by every commit captured during that live interval. |
| **Broadcast sequence** | The server-assigned order of an activated Broadcast within its Session. |
| **Broadcast activity** | A Broadcast start, Accepted commit, or Broadcast stop. Session activity timestamps describe only these events, not creation or configuration edits. |
| **Operator** | A signed-in account that creates, manages, and broadcasts its own Sessions. Many Operators may exist on one deploy; each only sees and mutates Sessions they own. |
| **Operator access** | Email-and-password sign-in, optional account creation, sign-out, password change, and ownership checks on Operator capabilities. A valid session is required; owning the Session is required to change it. |
| **Signup gate** | Additional accounts may be created only when no account exists yet, or when the deployment sets `ALLOW_SIGNUP=true`. The first account can always be created. |
| **Segment** | One stored, finished caption outcome for one Accepted commit, carrying that commit's stable Commit ID and caption-order position along with source text, per-language translations, and a translated or failed status. A translated Segment contains every required audience translation. A failed Segment contains no partial translations and falls back to its source text. A Segment is never in-progress workflow state. |
| **Partial** | Interim Scribe transcript for the current open utterance. Operator UI only; not a Segment; not translated. |
| **VAD commit** | Scribe finalizes the current utterance after silence (`CommitStrategy.VAD`). Produces the text that becomes a Segment. |
| **Commit-and-translate** | One workflow: accept a VAD commit, translate its text for every required audience language, and produce its one atomic Segment outcome. Retries reuse the same Accepted commit and Segment. |
| **Accepted commit** | A VAD commit registered for a Session with an immutable transcript snapshot, stable identity, and position in that Session's caption order. It owns translation progress until a finished Segment outcome exists. |
| **Commit ID** | The stable identity of one VAD commit, reused when that commit is retried. Reusing it with a different Session or transcript snapshot is a conflict. |
| **Commit ordinal** | The capture-assigned order of an Accepted commit within its Broadcast. |
| **Commit position** | The pair of Broadcast sequence and Commit ordinal that orders one Accepted commit within its Session. Request arrival, retries, and translation completion do not change it. |
| **Final commit ordinal** | The highest Commit ordinal declared when a Broadcast ends normally. The Broadcast is drained when every ordinal through it has a finished Segment or an Omitted position. |
| **Rejected capture** | A finalized transcript snapshot that could not become an Accepted commit. It remains recoverable until the Operator exports or explicitly discards it. |
| **Omitted position** | A Commit position the Operator explicitly discards without creating an Accepted commit or Segment. It accounts for that position when determining whether its Broadcast is drained. |
| **Translation mapping** | A Session rule that gives one source term or phrase an exact replacement in one Audience language. Source text, terms, and replacements use Unicode NFC; matching is case-insensitive where the source script has casing. A match may not begin or end inside a larger letter-or-number token in boundary-based scripts; scripts without word separators use literal substring matching. When terms overlap, the longest valid match claims the source span. A replacement is exact and is never remapped recursively. Outer whitespace is removed when saving while internal whitespace remains significant. Each case-insensitive source-term and Audience-language pair is unique. A Session may have at most 100 mappings, and each term or replacement may contain at most 200 Unicode characters. Other Audience languages translate the original source normally. Changes affect only commits accepted after the mapping is saved, including during a live Broadcast. |
| **Mapping revision** | One immutable, canonical set of Translation mappings saved for a Session. The Session points to its current Mapping revision, and each Accepted commit points to the revision current when it was accepted so later edits cannot change its translation or retry. |
| **Mapping integrity failure** | A translation outcome in which a protected Translation mapping occurrence cannot be accounted for exactly once. It is a failed atomic Segment outcome rather than a partially repaired or published translation, and it is not retried automatically. |
| **Spoken languages** | Languages the operator may speak; used to resolve/normalize Scribe `language_code` when present, and as fallback when absent. |
| **Audience languages** | Languages captions must be available in (minus source when identical). |

## Avoid

- Calling a VAD-committed blob a “chunk” in product language — prefer **Segment** (stored) vs **Partial** (live interim).
- Treating Partials as translation input.
- Manual / timed force-commits for mic broadcast — VAD silence is the product commit strategy.
