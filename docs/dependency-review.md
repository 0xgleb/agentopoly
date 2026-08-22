# Dependency review

- Checked: 2026-08-22
- Package manager: Bun only
- Lockfile policy: `bun.lock` records exact resolved versions and integrity hashes; CI installs with `bun install --frozen-lockfile`.

Audit commands are evidence, not an assertion that a required sponsor beta is clean. Every finding remains disclosed until it is remediated or accepted through an explicit narrow policy.

## Runtime dependencies

| Package             | Locked version  | Boundary                                                                                                |
| ------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `@tetherto/wdk`     | `1.0.0-beta.16` | Future local wallet adapter only; never remote wallet authority.                                        |
| `@tetherto/wdk-cli` | `1.0.0-beta.3`  | Future operator-local sidecar only; never imported into the Pear worker or provider workspace.          |
| `hyperswarm`        | `4.17.0`        | Candidate P2P transport; network bytes remain untrusted until bounded decoding and signature admission. |
| `pear-runtime`      | `1.3.1`         | Pear host and worker lifecycle; no wallet authority.                                                    |

### WDK CLI intake

The exact direct release is Apache-2.0 licensed, requires Node.js 22.18 or newer, and exposes the `wdk`, `wdk-mcp`, and `wdk-daemon` binaries. It is required for the selected WDK CLI Track 1 integration, but no wallet process starts and no wallet configuration loads during install, build, lint, test, audit, or CI.

The CLI pins `@tetherto/wdk` `1.0.0-beta.6`, while Agentopoly directly resolves `@tetherto/wdk` `1.0.0-beta.16`. No type, request, response, or behavior may be assumed identical across those instances.

Current production and full Bun audits report 34 transitive advisories: 13 high, 19 moderate, and 2 low. Affected paths include `ws` through Spark, `axios` through the ERC-4337 relay stack, and `elliptic` through Bitcoin support. Upstream packages pin some affected versions exactly, and the latest available `elliptic` release remains affected. This is not a clean bill of health.

Bun blocked the `protobufjs@7.6.5` lifecycle script. It remains untrusted and must not be run without a separate source review and a demonstrated requirement.

The dependency is acceptable for publication only under the human-selected advisory policy. Regardless of that decision:

- WDK CLI, MCP, daemon, Spark, ERC-4337, and Bitcoin code remain unreachable from the Pear worker, provider workspace, browser, peer input, and model output;
- no arbitrary URLs, headers, proxy settings, method names, arguments, or command strings cross the future sidecar boundary;
- wallet creation and unlock remain human-only and use a dedicated limited-fund development wallet;
- funded use remains blocked until the selected path has captured-response, malformed-response, preview, reservation, idempotency, and reconciliation tests;
- audit output remains disclosed until upstream remediation or a reviewed replacement exists.

### Official Pear Worklet WDK option

The official [Pear Worklet WDK documentation](https://docs.wdk.tether.io/tools/pear-wrk-wdk/) describes `@tetherto/pear-wrk-wdk`, an HRPC and framed JSON-RPC layer that runs WDK in a Bare worklet. It supports `initializeWDK({ config, encryptionKey, encryptedSeed })`, generic wallet and protocol calls, optional method allowlists, dynamic registration, and a native-host bridge.

That package may simplify a future Bare integration, but it does not automatically satisfy Agentopoly's boundary: the P2P worker must remain wallet-blind, seed material must never reach peer-facing or model-facing code, and generic method dispatch is broader than the fixed typed settlement contract. It also does not replace the selected CLI Track 1 dependency without an explicit sponsor-lane decision. Review its configuration and API contracts before choosing it for a separate local wallet worklet.

## Development tooling

| Package             | Locked version | License    | Review                                                                       |
| ------------------- | -------------- | ---------- | ---------------------------------------------------------------------------- |
| `typescript`        | `5.9.3`        | Apache-2.0 | Compiler only; supported by the pinned lint stack.                           |
| `eslint`            | `10.9.0`       | MIT        | Node-only development and CI linter.                                         |
| `@eslint/js`        | `10.0.1`       | MIT        | Maintained JavaScript ruleset.                                               |
| `typescript-eslint` | `8.67.0`       | MIT        | Strict typed TypeScript lint rules.                                          |
| `prettier`          | `3.9.6`        | MIT        | Formatter only.                                                              |
| `@types/bun`        | `1.4.0`        | MIT        | Test-only Bun declarations; runtime typechecking excludes ambient packages.  |
| `@types/node`       | `26.2.0`       | MIT        | Type-only dependency required by Bun declarations; never a Node runtime pin. |

`@types/node` `26.2.0` has no lifecycle scripts and depends only on `undici-types ~8.3.0`. The root runtime TypeScript config sets `types: []`, so Agentopoly production source cannot acquire Node globals from this package. Only the test config loads `bun`; Bun's declarations require the newer Node declaration surface. The exact `@types/bun`/`@types/node`/TypeScript combination compiles when TypeScript is launched by the pinned Node 22.23.2 development runtime, and the earlier quality-gate PR passed on CI Node 22.18.0 with the same resolved type pair.

The reviewed direct development packages have no lifecycle install hooks. Their Node-oriented execution is reachable only through package scripts and CI, never from the Pear/Bare runtime module.

## Intake rules

- Inspect purpose, official source, license, engines, dependency surface, install scripts, native code, and Bare/Node assumptions before adding a dependency.
- Add and remove JavaScript packages only with Bun.
- Keep Node development tools and wallet capabilities out of Pear/Bare peer modules.
- Never allow install or build scripts to receive wallet secrets.
- Extend this review for every new runtime dependency.
