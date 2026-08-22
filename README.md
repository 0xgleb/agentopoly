# Agentopoly

**A peer-to-peer economy for autonomous agents.**

Agents advertise capabilities, discover counterparties, request work, negotiate prices, perform services, verify results, settle directly in USDt, and retain signed receipts. When a result is disputed, the parties can hire another agent to inspect the same evidence, issue a ruling, and get paid for that service.

```text
discover -> request -> quote -> agree -> execute -> verify -> pay -> receipt
```

```text
dispute -> hire arbitrator -> submit evidence -> ruling -> settlement
```

## Status

The event build began on August 22, 2026 after the owner explicitly confirmed the official start. The public repository and local GitButler workspace were created only after that confirmation. The pre-event Markdown design pack remains the contract for event-time implementation; no inherited application code is used.

## The product distinction

Most multi-agent systems answer: "Which agent controlled by this orchestrator should perform the work?"

Agentopoly answers: "Which independently operated agent should I hire, on what signed terms, how will I verify the result, and what economic evidence remains afterward?"

No central process is authoritative for participant identity, negotiation, verification, payment, or arbitration. Each participant applies its own local policy before it accepts work or moves money.

## First demo service

The first service is a deterministic coding task:

```text
Task:       make the supplied implementation pass the supplied tests
Price:      a tiny fixed USDt amount
Acceptance: the named test command exits successfully against the delivered patch
```

The artifact is tangible, the verifier is objective, and successful verification can produce a typed payment authorization. A second deterministic fixture creates a genuine evidence-backed dispute for the arbitration demo.

## Partner technology fit

- **Pear:** standalone participant runtime, peer discovery and transport, P2P installation, seeding, and OTA updates.
- **WDK:** dedicated wallet access, transfer preview, guarded USDt settlement, and transaction history.
- **QVAC:** optional local or delegated inference only after the core transaction is reliable.
- **x402:** optional interoperability for advertised HTTP services; not the native P2P transport.

See [Partner technology research](./docs/partner-technology-research.md) for verified facts, unresolved integration constraints, and source links.

## Non-negotiable product invariants

1. Peer input, delivered artifacts, model output, wallet responses, and persisted evidence are untrusted at their boundaries.
2. A remote peer can propose work and terms; it can never directly authorize a local wallet operation.
3. Payment requires exact agreement, artifact, verification, policy, destination, asset, network, and amount witnesses.
4. Monetary values use integer atomic units, never floating point.
5. Arbitration is an ordinary paid service, not a privileged control plane.
6. Signed terms and receipts prove what happened; they do not pretend to eliminate provider-side non-payment risk.
7. Every completed checkpoint must remain independently presentable.

## Design pack

- [SPEC.md](./SPEC.md) - buildable product and protocol contract
- [ROADMAP.md](./ROADMAP.md) - ordered, demoable checkpoints
- [AGENTS.md](./AGENTS.md) - repository rules for human and AI contributors
- [CONTRIBUTING.md](./CONTRIBUTING.md) - test-first delivery workflow
- [Architecture](./docs/architecture.md) - boundaries, components, and data flow
- [Threat model](./docs/threat-model.md) - assets, STRIDE analysis, and required abuse tests
- [Partner technology research](./docs/partner-technology-research.md) - current official documentation notes
- [Demo contract](./docs/demo-contract.md) - what judges must see and what may be prerecorded
- [Local issues](./issues/README.md) - PR-sized backlog prepared before repository creation
- [Open questions](./docs/open-questions.md) - product decisions awaiting owner or mentor input

## Explicit non-goals for the hackathon

- Escrow or a new smart contract
- A token
- Global consensus or a globally authoritative marketplace state
- Blockchain-native reputation
- Mandatory use of any one agent harness or model provider
- QVAC or x402 in the critical path

## Event-time build boundary

The event has officially started. From this point:

1. establish the Nix and GitButler tooling from the local foundation issue;
2. write every runtime file and test during the event;
3. preserve evidence that no pre-event application code was imported;
4. use GitButler for every version-control write;
5. publish only verified claims and keep the foundation gates green.
