# Initial threat model

- Status: pre-implementation
- Scope: peer protocol, provider execution, objective verification, capped automatic USDt settlement, evidence, and arbitration

No money-moving implementation may start until its abuse tests exist and fail for the intended reason.

## Assets

- Dedicated development-wallet funds
- Wallet unlock session and signing authority
- Protocol signing identity
- Exact job terms and price
- Delivered artifact and acceptance contract
- Verification evidence
- Per-job and session spend limits
- Idempotency and replay state
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
10. Browser or Telegram command -> local application command
11. Original dispute evidence -> arbitrator input
12. Arbitrator output -> ruling artifact

## STRIDE analysis

| Threat | Concrete abuse | Required control |
| --- | --- | --- |
| Spoofing | Peer claims another identity or wallet | Verify protocol signature; bind wallet and peer key in signed terms; reject identity rotation without a signed revision |
| Spoofing | Fake browser/Telegram command requests payment | Local command authentication; UI cannot construct `PaymentAuthorized` |
| Tampering | Bid amount, destination, acceptance criteria, or artifact changes after agreement | Canonical terms hash signed by both parties; artifact and evidence hashes bind later records |
| Tampering | WDK preview differs from authorized transfer | Compare network, token, atomic amount, source, destination, and fee policy exactly before broadcast |
| Tampering | Persisted evidence is malformed or reordered | Decode and revalidate every record; hash-link records; deterministic replay refuses impossible transitions |
| Repudiation | Buyer denies agreeing or provider denies delivery | Signed terms and signed delivery bound to identities and hashes |
| Repudiation | Arbitrator denies ruling | Signed ruling artifact with evidence references and separate paid-job receipt |
| Information disclosure | Peer task or process output leaks credentials or unrelated paths | Bounded fixture workspace; redact evidence; never include operator environment or unrestricted stdout/stderr |
| Information disclosure | Wallet seed or passphrase reaches logs/model/peer | Human-only administration; wallet adapter accepts authorization values, never seed material |
| Denial of service | Oversized frames, connection floods, stale adverts, or decompression bombs | Application message limits, bounded peers/queues, expiry, rate limits, and no unbounded decompression |
| Denial of service | QVAC/Pear bootstrap stalls the demo | QVAC stays stretch; deterministic local peer fallback; visible timeouts and cancellation |
| Denial of service | Bad latest evidence silently falls back to older favorable evidence | Fail closed on the latest relevant record; do not choose stale authority |
| Elevation of privilege | Remote message directly invokes WDK or a shell | Strict capability separation; protocol events are data; local policy and reviewed adapters own side effects |
| Elevation of privilege | Model output writes outside fixture or changes acceptance command | Disposable workspace, path confinement, local command map, no model shell authority |
| Elevation of privilege | Duplicate/replayed success triggers a second payment | One payment key per terms hash; persisted idempotency record checked before preview and broadcast |

## Capped automatic wallet policy

A real transfer is allowed only when all are true:

- dedicated wallet is selected and currently unlocked by the human;
- asset and network are allowlisted;
- destination equals the provider wallet in the mutually signed terms;
- atomic amount equals the agreed price;
- amount is at or below the per-job cap;
- accumulated authorized spend plus amount is at or below the session cap;
- artifact hash equals the delivered artifact;
- passed verification binds the same terms and artifact hashes;
- transfer preview exactly matches authorization;
- no payment receipt or in-flight broadcast exists for this authorization key;
- all evidence is fresh enough for the reviewed policy.

The WDK documentation states that its MCP `send_token` defaults to dry-run but the daemon does not enforce confirmation before a direct real send. Agentopoly therefore enforces preview comparison and caps in its own local authorization layer.

## Required abuse tests before implementation

### Protocol

- invalid signature is rejected;
- wrong sender identity is rejected;
- expired message is rejected;
- duplicate message ID is idempotent;
- replayed nonce is rejected;
- oversized frame is dropped without allocation growth;
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

- wrong asset, network, destination, atomic amount, decimals, terms hash, artifact hash, or verification hash causes zero WDK broadcast calls;
- per-job limit boundary allows exactly the cap and refuses cap plus one atomic unit;
- session cap conserves total authorized spend across concurrent jobs;
- concurrent duplicate authorization broadcasts at most once;
- preview mismatch refuses broadcast;
- stale wallet state refuses broadcast;
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

- browser or Telegram client cannot call WDK directly;
- stale projection is visibly stale and cannot authorize a command;
- redacted evidence cannot be expanded by a client query;
- debug protocol payloads are not exposed in the default judge view.

## Supply-chain gates

For every dependency added after the event starts:

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
