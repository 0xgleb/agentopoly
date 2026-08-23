# Threat model

- Status: active hackathon threat model
- Scope: peer protocol, provider execution, objective verification, capped automatic USDt settlement, evidence, and arbitration

No money-moving implementation may start until its abuse tests exist and fail for the intended reason.

## Assets

- Dedicated development-wallet funds
- Wallet unlock session and signing authority
- Private inherited sidecar channel
- Protocol signing identity
- Exact job terms and price
- Delivered artifact and acceptance contract
- Verification evidence
- Per-job, session-spend, and native-fee limits
- Idempotency, replay, reservation, and reconciliation state
- Payment and arbitration receipts
- Operator filesystem and unrelated projects
- Judge-facing truth about what actually happened

## Trust boundaries

1. Hyperswarm stream -> framed peer message
2. Wire object -> parsed signed domain message
3. Model or provider output -> isolated artifact workspace
4. Acceptance contract -> local verifier invocation
5. Process output -> bounded verification evidence
6. Durable locally signed agreement witness -> local payment authorization
7. Agreement witness and verification -> private sidecar preview request
8. Durable reserved attempt -> private sidecar broadcast request
9. Sidecar closed command -> WDK MCP and daemon
10. WDK/history response -> typed settlement outcome
11. Stored record or migration snapshot -> replayed state
12. Local runtime event log -> bounded browser projection API
13. Local browser command -> local application command
14. Original dispute evidence -> arbitrator input
15. Arbitrator output -> ruling artifact

## STRIDE analysis

| Threat                 | Concrete abuse                                                                                                      | Required control                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | Peer claims another identity or wallet                                                                              | Verify protocol signature; bind wallet and peer key in signed terms; reject identity rotation without a signed revision                                                                                                                         |
| Spoofing               | Fake local-browser command requests payment                                                                         | Local command authentication; UI cannot construct `PaymentAuthorized`                                                                                                                                                                           |
| Spoofing               | Unrelated local process calls the planned sidecar                                                                   | No listener; the inherited pipe endpoint is the single-parent caller capability; the closed command union accepts broadcast only as `ReservedPaymentAttempt`                                                                                    |
| Tampering              | Bid amount, destination, acceptance criteria, or artifact changes after agreement                                   | Canonical terms hash signed by both parties; artifact and evidence hashes bind later records                                                                                                                                                    |
| Tampering              | WDK address or preview differs from the authorized transfer                                                         | Verify source address separately; compare network, token contract, atomic amount, destination, and native fee cap exactly before broadcast                                                                                                      |
| Tampering              | Missing or synthesized WDK response field appears to satisfy policy                                                 | Decode captured, version-pinned response shapes; a missing, malformed, partial, or unproven field fails closed                                                                                                                                  |
| Tampering              | Persisted evidence is malformed, reordered, or from an incompatible schema                                          | Decode and revalidate every versioned record; migrate through an atomically selected validated snapshot; hash-link records; deterministic replay refuses impossible transitions                                                                 |
| Tampering              | A local caller substitutes an environment terms hash, edits a durable agreement, or reuses it for another workspace | `finalize` loads a strict, workspace-bound agreement witness, rejects unknown fields, recomputes canonical terms hash, and verifies the operator-local signature against a reviewed public key before policy evaluation                         |
| Repudiation            | Buyer denies agreeing or provider denies delivery                                                                   | Signed terms and signed delivery bound to identities and hashes                                                                                                                                                                                 |
| Repudiation            | Arbitrator denies ruling                                                                                            | Signed ruling artifact with evidence references and separate paid-job receipt                                                                                                                                                                   |
| Information disclosure | Peer task or process output leaks credentials or unrelated paths                                                    | Bounded fixture workspace; redact evidence; never include operator environment or unrestricted stdout/stderr                                                                                                                                    |
| Information disclosure | Wallet seed or passphrase reaches logs/model/peer                                                                   | Human-only administration; wallet adapter accepts authorization values, never seed material                                                                                                                                                     |
| Denial of service      | Oversized frames, connection floods, stale adverts, or decompression bombs                                          | 65,536-byte frame limit, 16,384-byte inline-evidence limit, 64-peer cap, 32-per-peer/128-global undecoded queues, 20 accepted frames per peer per rolling 10 seconds with burst 40, five-minute ordinary expiry, and no protocol-v1 compression |
| Denial of service      | QVAC/Pear bootstrap stalls the demo                                                                                 | QVAC stays stretch; deterministic local peer fallback; visible timeouts and cancellation                                                                                                                                                        |
| Denial of service      | Bad latest evidence silently falls back to older favorable evidence                                                 | Fail closed on the latest relevant record; do not choose stale authority                                                                                                                                                                        |
| Elevation of privilege | Remote message directly invokes WDK or a shell                                                                      | Strict capability separation; protocol events are data; local policy and reviewed adapters own side effects                                                                                                                                     |
| Elevation of privilege | Model output writes outside fixture or changes acceptance command                                                   | Disposable workspace, path confinement, local command map, no model shell authority                                                                                                                                                             |
| Elevation of privilege | Duplicate/replayed success or a crash after broadcast triggers a second payment                                     | Atomically reserve one authorization key before broadcast; persist attempt and transaction state; treat tuple-only history matches as candidates; keep ambiguous attempts reserved and never auto-release or retry                              |
| Spoofing               | Forged or partial capability-observation record creates a browser marketplace card                                  | Decode the bounded `capability.observed` envelope and every capability field; require locally recorded `live-peer` provenance; render no capability or authority from a rejected record                                                         |
| Elevation of privilege | A peer capability claim creates wallet, verification, settlement, or reputation authority                           | Append `capability.observed` only after signed protocol and market admission; records are evidence-only and no authority consumer accepts them                                                                                                  |

## Capped automatic wallet policy

A real transfer is allowed only when all are true:

- dedicated wallet is selected and currently unlocked by the human;
- asset and network are allowlisted;
- wallet identity and account index derive the exact authorized source address;
- destination equals the provider wallet in the mutually signed terms;
- token contract or mint, decimals definition, and atomic amount equal the agreed price;
- amount is at or below the per-job cap;
- accumulated authorized spend plus amount is at or below the session cap;
- artifact hash equals the delivered artifact;
- passed verification binds the same terms and artifact hashes;
- transfer preview exactly matches network, token contract, destination, and atomic amount;
- estimated native fee does not exceed the signed atomic fee cap;
- the local preview is no older than 30 seconds;
- the authorization key is atomically reserved with an attempt ID before broadcast;
- no payment receipt, broadcast, or unresolved reservation exists for this authorization key;
- all evidence is fresh enough for the reviewed policy.

The selected Track 1 contract uses `@tetherto/wdk-cli` `1.0.0-beta.3`: the wallet-policy host owns a narrow injected gateway for an operator-local Node sidecar over private inherited stdio, and the sidecar launches `wdk-mcp` over its own stdio. The default gateway is typed unavailable and starts no process. The inherited pipe endpoint is the single-parent caller capability. A closed command union allows address, balance, history, a dry-run-only `PaymentPreviewRequest`, and a broadcast-only `ReservedPaymentAttempt`; it never forwards caller-supplied tool names or raw transfer arguments. Repository tests use captured official-package response fixtures and injected spies only.

`wdk-mcp` reaches the human-unlocked WDK daemon through its user-scoped Unix socket. `send_token` defaults to dry-run, but the daemon does not enforce confirmation before a direct real send, so the local layer independently enforces source verification, preview comparison, caps, reservation, and response classification before an injected gateway may be called. The repository proves that boundary without installing, unlocking, or starting WDK; it is not evidence of a funded broadcast or live-wallet safety. The Pear worker, browser, provider, and model may never receive an MCP client, daemon socket, passphrase, seed, or command selector. A compromised same-user process can still reach the daemon directly and remains a disclosed residual risk.

## Required abuse tests before implementation

### Protocol

- invalid signature is rejected;
- wrong sender identity is rejected;
- an accepted message ID with identical canonical bytes returns its first recorded result even after message expiry or nonce advancement;
- the same message ID with different canonical bytes is a conflict;
- an unseen expired message is `expired` before nonce admission;
- an unseen non-expired nonce at or below the high-water mark is `replayed`;
- oversized frame is dropped before payload allocation;
- queue and peer caps refuse excess work without evicting accepted state;
- rate-limit boundary accepts the twentieth frame and refuses the twenty-first in the same window;
- compressed frame is rejected before decompression or payload allocation;
- forged capability advertisements cannot create or overwrite a local market entry;
- a replayed, duplicate, stale, withdrawn, or conflicting capability advertisement cannot revive or replace newer local market state;
- malformed, expired, replayed, withdrawn, or refused capability advertisements append no `capability.observed` record; an accepted record grants no wallet, verification, settlement, or reputation authority;
- unknown version and message type fail closed;
- same semantic terms with different serialization cannot produce ambiguous hashes;
- unsupported or corrupt persisted-record schema versions keep networking closed;
- a replacement generation with a bad checksum or invariant violation cannot become active;
- interrupted migration leaves the complete prior generation authoritative;
- concurrent or stale generation writers cannot replace the selected manifest;
- a successful migration preserves every nonce high-water mark, message result, payload hash, key revision, agreement, evidence record, receipt, and settlement state.

### Execution and verification

- artifact path escaping the disposable workspace is rejected;
- symlink escape is rejected;
- peer-supplied command text never executes;
- model output containing instructions to call wallet or host tools remains inert data;
- artifact changed after delivery fails hash verification;
- passing process exit with wrong artifact fails;
- verification evidence is bounded and redacted;
- timeout cancels child work and produces no payment witness.

### Wallet

- wrong source address, wallet index, asset, token contract, network, destination, atomic amount, decimals, terms hash, artifact hash, or verification hash causes zero WDK broadcast calls;
- wrong native-fee asset, cap, or estimate causes zero WDK broadcast calls;
- per-job limit boundary allows exactly the cap and refuses cap plus one atomic unit;
- session cap conserves total authorized spend across concurrent jobs;
- concurrent duplicate authorization broadcasts at most once;
- repeated refusal finalization appends each refusal and reputation event at most once, and a concurrent finalizer fails closed while the first decision is recorded;
- a conflicting prior refusal or reputation record for the same workspace and job fails closed instead of being overwritten or duplicated;
- a second local caller cannot attach to the private inherited sidecar channel, and a raw tool name or raw transfer argument is rejected before any WDK call;
- `PaymentPreviewRequest` can invoke only `dryRun=true`, while broadcast requires the matching durable `ReservedPaymentAttempt`;
- preview token, network, destination, amount, or fee mismatch refuses broadcast;
- a missing, malformed, partial, or synthesized preview field refuses broadcast;
- a preview older than 30 seconds is never reused;
- stale wallet state refuses broadcast;
- crash while `reserved` but before the durable `broadcasting` marker proves no invocation; returning to `available` still requires a new preview and complete policy evaluation;
- crash or any non-success after the `broadcasting` marker remains reconciliation-pending;
- only the fully decoded in-flight success response with its 64-character lowercase hexadecimal transaction hash identifies the attempt;
- explicit error, partial response, missing or invalid transaction hash, timeout, transport failure, and malformed response all persist reconciliation-pending and never auto-retry;
- crash after broadcast but before receipt persistence never treats a tuple-only history match as attempt identity;
- an unknown result remains reserved without automatic release or retry;
- failed or disputed verification cannot mint `PaymentAuthorized`;
- a missing, malformed, altered, wrong-workspace, or replayed locally signed agreement witness appends no `agreement.observed` event and causes zero WDK preview or broadcast calls;
- a witness whose canonical terms hash, destination, network, amount, or native-fee cap differs from the verification or local policy causes zero WDK preview or broadcast calls;
- receipt is not marked settled from a broadcast hash alone.

### Arbitration

- evidence from another job cannot enter the bundle;
- missing party signature is visible and cannot be invented;
- ruling references only supplied evidence hashes;
- ruling for a different terms hash is rejected;
- arbitrator payment follows a separate verified agreement;
- arbitrator cannot trigger or rewrite original payment outside signed policy.

### Presentation

- local runtime event-log input is bounded before decoding; malformed, oversized, future, duplicate, and unsupported records produce a bounded refusal or one recorded projection rather than a fabricated economic event;
- a bounded legacy `receipt.recorded` envelope with schema version 1 is ignored; a schema-version-2 receipt must pass the complete decoder or fail closed, and ignored fields cannot derive payment, settlement, reputation, or raw browser data;
- malformed, partial, expired, duplicate, or non-`live-peer` `capability.observed` records cannot project a capability, remove the capability-discovery absence marker, derive verification or reputation, or authorize a local action;
- malformed, duplicate, mismatched, or unvalidated `agreement.observed` records cannot project fixed-price terms, reveal signatures, wallet destinations, or full hashes, or authorize payment;
- local browser client cannot call WDK directly;
- stale projection is visibly stale and cannot authorize a command;
- redacted evidence cannot be expanded by a client query;
- debug protocol payloads are not exposed in the default judge view;
- recorded demo fixtures are labeled and cannot mint live payment authorization;
- cross-job or mismatched receipt evidence cannot project a provider as paid;
- an arbitration receipt cannot be reused as the original provider payment.

## Supply-chain gates

For every dependency added to the project:

- confirm official package and current maintenance;
- inspect install/build scripts and native binaries;
- verify Bare/Node assumptions;
- pin through the lockfile and Nix input where applicable;
- run the relevant package audit;
- confirm license compatibility;
- reject dependencies that pull secrets or wallet authority into the peer worker.

## Residual risks disclosed by the MVP

- Provider-side non-payment risk remains because there is no escrow.
- Arbitration is advisory unless signed policy defines a voluntary follow-up transfer.
- Local reputation is not globally canonical and can be selectively presented.
- A compromised same-user process may reach an unlocked WDK daemon; a dedicated tiny wallet and short unlock window limit impact but do not create OS isolation.
- Hackathon network conditions can disrupt DHT discovery and seeding.
- Objective coding verification protects the named acceptance contract, not unspecified product intent.
