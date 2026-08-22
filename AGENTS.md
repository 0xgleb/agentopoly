# AGENTS.md

Rules for human and AI contributors. Every rule is a directive.

## Read first

Before changing behavior, read:

1. [SPEC.md](./SPEC.md) for the behavior contract;
2. [ROADMAP.md](./ROADMAP.md) and the active GitHub issue for scope ([issue #1](https://github.com/0xgleb/agentopoly/issues/1) for the current foundation PR);
3. [docs/threat-model.md](./docs/threat-model.md) for trust boundaries and required abuse tests;
4. [CONTRIBUTING.md](./CONTRIBUTING.md) for the delivery workflow.

All repository, dependency, Nix, test, and application work must remain demonstrably Agentopoly hackathon work. Attributable official sponsor or hackathon boilerplate may be reused after review; the judged protocol, wallet policy, and WDK integration remain Agentopoly work.

## Product invariants

Never weaken these:

- Independently operated peers are counterparties; no shared orchestrator is authoritative.
- Raw peer messages, artifacts, model output, wallet responses, configuration, and persisted evidence are untrusted at their boundaries.
- Parse into domain types at the boundary. Internal modules never receive unchecked wire objects.
- A remote peer may propose work or payment terms but can never authorize a local wallet operation.
- Payment requires exact agreement, delivery, verification, destination, asset, network, amount, and local-limit witnesses.
- Monetary values are integer atomic units with explicit asset and network types. No floating point.
- Arbitration is an ordinary paid service using the same protocol, not a privileged subsystem.
- Side effects are idempotent. Duplicate or replayed messages cannot repeat execution, signing, payment, or settlement.
- Signed evidence proves statements and linkage; it does not imply global consensus or eliminate counterparty risk.

## Secrets and operator boundary

Agents must never inspect, print, log, or commit wallet seeds, private keys, passphrases, auth tokens, provider credentials, or secret-bearing configuration. Do not invoke wallet creation, import, export, unlock, lock, or deletion. A human provisions and unlocks the dedicated development wallet.

Do not start any process that loads wallet secrets unless the human operator explicitly requests that exact action. Never pass untrusted peer or model output to a shell, wallet tool, file path, or command selector without typed validation and a narrow allowlist.

## Workflow

For every behavior change:

1. Update SPEC.md first if the desired behavior changed.
2. Add or update one PR-sized GitHub issue with acceptance criteria.
3. Extend the threat model when the change crosses a new boundary or protects a new asset.
4. Define domain types and callable contracts.
5. Write a compiling test that fails for the correct reason.
6. Implement the smallest vertical slice that makes it pass.
7. Run focused tests, then the full quality gates.
8. Review malformed, replayed, duplicate, stale, and impossible inputs alongside the valid path.
9. Keep README, SPEC, ROADMAP, issue status, architecture, and threat model true.

Do not write several horizontal foundations and hope they integrate later. Every completed checkpoint must produce a demonstrable improvement to the same transaction loop.

## TypeScript

- Use strict TypeScript.
- Prefer `const`-bound arrow functions. Use declarations only for required overload, generator, or runtime semantics.
- Use Effect for typed expected failures and dependency injection where compatible with Bare. Verify compatibility before adopting it in the Pear runtime boundary.
- Use Effect Schema or another reviewed schema decoder at untrusted boundaries. Never use casts as validation.
- No `any`, unsafe casts, non-null assertions, untyped `try`/`catch` control flow, raw Promise interop inside Effect code, or exceptions for expected failures.
- Make invalid states unrepresentable with discriminated unions, branded/newtype values, and smart constructors.
- Colocate types, errors, logic, and tests by domain feature.
- Forbidden generic module names: `types.ts`, `interfaces.ts`, `utils.ts`, `helpers.ts`, `constants.ts`, `common.ts`, `shared.ts`, `core.ts`, and `errors.ts`.
- Prefer pure transforms, immutable data, and folds over shared mutable state and imperative accumulation.
- No hidden defaults for required protocol, policy, wallet, or network configuration. Missing values fail with a specific typed error.

## Runtime boundaries

- Code executed in Bare must not assume Node.js APIs.
- Keep terminal host lifecycle separate from the worker that owns Pear runtime, networking, and replication.
- Keep wallet authority outside the P2P worker. The protocol emits settlement intent; a narrow local adapter evaluates policy and calls WDK.
- Provider execution runs in a disposable, bounded workspace with no wallet capability and no access to unrelated operator files.
- Command contracts are local reviewed configuration. Never execute a command string received from a peer.

## Testing

Start at the highest useful observable boundary:

- protocol feature: two or more real local peer processes;
- transaction feature: full job state from request through receipt with external systems replaced only at their adapters;
- bug: exact failing path with realistic evidence;
- domain invariant: focused unit/property test.

Tests assert correct behavior, not implementation details or known gaps. Every money or authority test also asserts that no unauthorized WDK call occurred. Every accepted valid fixture has malformed, stale, replayed, duplicate, and boundary-value companions where relevant.

Never relax a test, linter, type checker, formatter, or security gate without explicit permission. Fix the cause or ask.

## Observability

Use semantic levels and bounded structured fields. Log completions and state transitions rather than noisy starts. Messages must be unique and grep-friendly. Never log seeds, keys, passphrases, complete peer payloads, unrestricted artifact contents, or secret-bearing command output.

## Dependencies and environment

All tools enter through the pinned Nix flake and `direnv`. Use Bun for JavaScript dependencies. Add or remove packages with Bun commands; never guess or manually type package versions. Review every new dependency for Bare compatibility, runtime assumptions, maintenance, license, install scripts, and transitive native code.

Standalone scripts are Nushell, never Bash. Bash is allowed only for short inline CI blocks.

## Version control and tracking

After repository creation, all Git write operations use GitButler. Plain Git is read-only. Every PR closes one problem-only GitHub issue and keeps the roadmap in lockstep. PR titles are lowercase, imperative, and describe the outcome. PR descriptions contain `## Motivation` and `## Solution`; no AI attribution or self-promotion.

GitHub Issues is the only task tracker. Every pull request closes one problem-only issue.

## Human decisions

Sponsor track, wallet automation mode, required demo topology, product UX, risk limits, and submission scope require explicit human input. Mentors clarify sponsor eligibility and technology constraints. Contributors record ambiguity, ask a contextual question through the configured communication channel, and continue work that does not depend on the answer.
