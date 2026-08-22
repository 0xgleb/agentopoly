# Threat model

- Status: active hackathon threat model
- Scope: peer protocol, provider execution, objective verification, capped automatic USDt settlement, evidence, and arbitration

No money-moving implementation may start until its abuse tests exist and fail for the intended reason.

## Assets

- Dedicated development-wallet funds
- Wallet unlock session and signing authority
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
6. Agreement and verification -> local payment authorization
7. Payment authorization -> WDK preview and broadcast
8. WDK/history response -> settlement observation
9. Stored evidence -> replayed state
10. Local browser command -> local application command
11. Original dispute evidence -> arbitrator input
12. Arbitrator output -> ruling artifact

## STRIDE analysis

| Threat                 | Concrete abuse                                                                    | Required control                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | Peer claims another identity or wallet                                            | Verify protocol signature; bind wallet and peer key in signed terms; reject identity rotation without a signed revision                                                                                                                         |
| Spoofing               | Fake local-browser command requests payment                                       | Local command authentication; UI cannot construct `PaymentAuthorized`                                                                                                                                                                           |
| Tampering              | Bid amount, destination, acceptance criteria, or artifact changes after agreement | Canonical terms hash signed by both parties; artifact and evidence hashes bind later records                                                                                                                                                    |
| Tampering              | WDK address or preview differs from the authorized transfer                       | Verify source address separately; compare network, token contract, atomic amount, destination, and native fee cap exactly before broadcast                                                                                                      |
| Tampering              | Persisted evidence is malformed or reordered                                      | Decode and revalidate every record; hash-link records; deterministic replay refuses impossible transitions                                                                                                                                      |
| Repudiation            | Buyer denies agreeing or provider denies delivery                                 | Signed terms and signed delivery bound to identities and hashes                                                                                                                                                                                 |
| Repudiation            | Arbitrator denies ruling                                                          | Signed ruling artifact with evidence references and separate paid-job receipt                                                                                                                                                                   |
| Information disclosure | Peer task or process output leaks credentials or unrelated paths                  | Bounded fixture workspace; redact evidence; never include operator environment or unrestricted stdout/stderr                                                                                                                                    |
| Information disclosure | Wallet seed or passphrase reaches logs/model/peer                                 | Human-only administration; wallet adapter accepts authorization values, never seed material                                                                                                                                                     |
| Denial of service      | Oversized frames, connection floods, stale adverts, or decompression bombs        | 65,536-byte frame limit, 16,384-byte inline-evidence limit, 64-peer cap, 32-per-peer/128-global undecoded queues, 20 accepted frames per peer per rolling 10 seconds with burst 40, five-minute ordinary expiry, and no protocol-v1 compression |
| Denial of service      | QVAC/Pear bootstrap stalls the demo                                               | QVAC stays stretch; deterministic local peer fallback; visible timeouts and cancellation                                                                                                                                                        |
| Denial of service      | Bad latest evidence silently falls back to older favorable evidence               | Fail closed on the latest relevant record; do not choose stale authority                                                                                                                                                                        |
| Elevation of privilege | Remote message directly invokes WDK or a shell                                    | Strict capability separation; protocol events are data; local policy and reviewed adapters own side effects                                                                                                                                     |
| Elevation of privilege | Model output writes outside fixture or changes acceptance command                 | Disposable workspace, path confinement, local command map, no model shell authority                                                                                                                                                             |
| Elevation of privilege | Duplicate/replayed success or a crash after broadcast triggers a second payment   | Atomically reserve one authorization key before broadcast; persist attempt and transaction state; unknown results reconcile through WDK history and never auto-retry                                                                            |

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

The selected Track 1 path is `@tetherto/wdk-cli` `1.0.0-beta.3`: an operator-local Node sidecar launches `wdk-mcp` over stdio, which reaches the human-unlocked WDK daemon through its user-scoped Unix socket. Agentopoly allows only fixed typed address, balance, history, and `send_token` calls. `send_token` defaults to dry-run, but the daemon does not enforce confirmation before a direct real send, so Agentopoly's local layer independently enforces source verification, preview comparison, caps, reservation, and reconciliation. The Pear worker, browser, provider, and model receive no MCP client, daemon socket, passphrase, seed, or command selector.

## Required abuse tests before implementation

### Protocol

- invalid signature is rejected;
- wrong sender identity is rejected;
- expired message is rejected;
- duplicate message ID is idempotent;
- replayed nonce is rejected;
- oversized frame is dropped before payload allocation;
- queue and peer caps refuse excess work without evicting accepted state;
- rate-limit boundary accepts the twentieth frame and refuses the twenty-first in the same window;
- compressed frame is rejected before decompression or payload allocation;
- unknown version and message type fail closed;
- same semantic terms with different serialization cannot produce ambiguous hashes.

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
- preview token, network, destination, amount, or fee mismatch refuses broadcast;
- a preview older than 30 seconds is never reused;
- stale wallet state refuses broadcast;
- crash after reservation but before the call resumes as reconciliation-pending without broadcast;
- crash after broadcast but before receipt persistence reconciles the existing transaction and never auto-retries an unknown result;
- failed or disputed verification cannot mint `PaymentAuthorized`;
- malformed WDK response fails closed;
- receipt is not marked settled from a broadcast hash alone.

### Arbitration

- evidence from another job cannot enter the bundle;
- missing party signature is visible and cannot be invented;
- ruling references only supplied evidence hashes;
- ruling for a different terms hash is rejected;
- arbitrator payment follows a separate verified agreement;
- arbitrator cannot trigger or rewrite original payment outside signed policy.

### Presentation

- local browser client cannot call WDK directly;
- stale projection is visibly stale and cannot authorize a command;
- redacted evidence cannot be expanded by a client query;
- debug protocol payloads are not exposed in the default judge view.

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
