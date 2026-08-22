# Partner technology research

- Checked: 2026-08-22
- Source policy: official documentation only for factual claims
- Scope rule: research informs the build; external application code is not imported

## Pear

### Verified current facts

The official `hello-pear-bare` guide describes a standalone terminal application built on Bare, with `pear-runtime` in a worker, Corestore, and Hyperswarm. The application compiles into one executable per OS/architecture; the user's machine does not require Node.js, Bare, or the Pear CLI.

The guide identifies three layers: a CLI entrypoint, an application lifecycle host, and a worker that owns P2P code and the updater. The main variant is intended for long-running terminal applications; single-thread and daemon variants exist for different process shapes.

The current CLI reference tracks Pear 3.2.0. `pear run` is removed in v3 and replaced by embedding `pear-runtime`. `pear init` is also removed. `pear install pear://<key>` remains the install path for built applications. Staging, seeding, provisioning, and quorum production release are distinct current concepts; the old single-key `pear release` path is removed.

### Architectural consequence

Agentopoly should not build around `pear run` or a global Pear runtime API. Its P2P and OTA ownership belongs in a Bare worker. The browser or Telegram presentation layer must project local application state without replacing Hyperswarm as the economic transport.

### Questions to verify with mentors

- Whether the official boilerplate may be used directly under the event code rule.
- Whether a seeded install plus visible OTA update is the expected submission evidence.
- Whether multiple local processes satisfy P2P judging or a second device is expected.
- How a browser projection should be packaged with the standalone Bare participant.

### Sources

- https://docs.pears.com/getting-started/from-a-template/start-from-hello-pear-bare/
- https://docs.pears.com/reference/pear/cli/

## WDK

### Verified current facts

WDK is a multi-chain self-custodial wallet toolkit. The docs expose standard EVM, Bitcoin, Lightning/Spark, TON, TRON, Solana, and other modules.

The WDK CLI MCP server exposes wallet operations over stdio and routes wallet-dependent calls to a local daemon. Relevant tools include `get_address`, `get_balance`, `get_history`, and `send_token`.

Wallet administration is deliberately not exposed over MCP: create, import, export, unlock, lock, delete, rename, and default selection remain CLI/human operations. The wallet must already be unlocked.

Security details are important:

- on Unix-like systems, the user-scoped daemon socket separates OS users, not processes running as the same user;
- an unlocked wallet behaves as a local hot wallet for its TTL;
- MCP activity does not extend the unlock TTL;
- `send_token` defaults to dry-run;
- the daemon does not enforce preview-before-real-send if a caller explicitly requests broadcast.

### Architectural consequence

The operator creates and unlocks a dedicated tiny-balance development wallet. Agentopoly must enforce its own exact, capped authorization and preview comparison before any broadcast. A peer never receives MCP or wallet access.

The largest unresolved integration question is whether the standalone Bare participant calls the WDK CLI daemon through a narrow local adapter, uses a WDK SDK module compatible with Bare, or relies on a separate sidecar.

### Sources

- https://docs.wdk.tether.io/
- https://docs.wdk.tether.io/cli/guides/use-mcp-server/

## QVAC

### Verified current facts

The QVAC JS/TS package is `@qvac/sdk` and the introduction states that it runs on Node.js, Bare, and Expo. The SDK supports local model inference and delegated inference over the Holepunch stack.

Delegated inference is direct by provider public key rather than topic discovery. A provider starts `startQVACProvider()` on its keypair; a consumer passes a delegate option to `loadModel()` and connects to that provider key.

### Architectural consequence

Agentopoly discovery can advertise a paid QVAC-inference capability and the provider public key. If hired, the execution adapter can use QVAC's direct delegated-inference path, then return the result through the normal Agentopoly delivery and payment protocol.

This is complementary rather than duplicative: Agentopoly discovers, negotiates, verifies, and pays; QVAC performs the inference. It remains stretch because model loading, peer bootstrap, hardware variance, and live reconnection add demo risk.

### Sources

- https://docs.qvac.tether.io/introduction/
- https://docs.qvac.tether.io/p2p-capabilities/delegated-inference/

## x402

The supplied project brief describes x402 as a WDK-supported agentic pay-per-API mechanism. It naturally fits HTTP request/payment/retry semantics, while Agentopoly's native transport is a P2P stream.

### Architectural consequence

Do not add HTTP to the core protocol merely to claim x402. A provider may later advertise an x402-backed HTTP service; Agentopoly can broker discovery and record the resulting economic evidence.

### Research still required

Official x402 integration documentation and a realistic response fixture must be pinned before implementation. The user-provided brief is design input, not enough evidence for wire-format assumptions.

## Sponsor strategy

Agentopoly will optimize for WDK CLI Track 1 because the economic loop and local wallet guardrails are core product behavior. Pear remains the second priority for independent peers and distribution. QVAC is a cherry-on-top only after the paid transaction and arbitration loops work. Enter the separate General Track too if cross-sponsor combination is allowed.

## Strongest integration risk

The strongest counter-hypothesis to a clean all-in-one design is runtime incompatibility: Pear's judged artifact is a standalone Bare executable, while WDK CLI/MCP uses a local Node-backed daemon and the polished browser/Telegram projection may need an HTTP or bot adapter. The design must prove these can remain narrow local boundaries without undermining the standalone and P2P claims.
