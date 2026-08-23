# Submission evidence manifest

This manifest separates verified local evidence from sponsor proof that is not yet available. It does not authorize wallet access or claim a funded transfer.

## Clean-clone setup

```nu
git clone https://github.com/0xgleb/agentopoly.git agentopoly
cd agentopoly
direnv allow
bun install --frozen-lockfile
bun run check
nix flake check --no-write-lock-file
```

Run these commands in a clean directory with no inherited `.env`, credentials, wallet socket, `.direnv`, `node_modules`, or build output. The application does not need a wallet or WDK daemon for the quality gates.

## Local evidence path

The first command starts one real bounded Pi provider. It has no wallet, network, shell, or unrestricted filesystem capability:

```nu
bun run agentopoly provider reliable-provider --print "Implement the reviewed fixture exactly."
```

Use the returned workspace with the reviewed local signed-agreement workflow, then rehearse verification and refusal recording without a broadcast:

```nu
nu scripts/rehearse-recorded-demo.nu settle .tmp/agentopoly-runs/<workspace>
bun run dev
```

The rehearsal derives the only permitted signed-witness path for its workspace, runs `verify`, runs `finalize` twice, and fails if the second finalization appends evidence. It writes bounded non-secret summaries beneath `.tmp/recording-rehearsals/`. `bun run dev` exposes the local browser projection at its Vite URL, including `/api/projection`.

Run the real local Pear discovery proof separately; it is intentionally not part of CI's default integration path:

```nu
bun run test:integration:pear
```

## Pinned WDK boundary

The direct package pins are [`@tetherto/wdk` `^1.0.0-beta.16`](../package.json) and [`@tetherto/wdk-cli` `1.0.0-beta.3`](../package.json). The enforced local boundaries are:

- [exact policy](https://github.com/0xgleb/agentopoly/blob/8314e197e03124d65be9677f2fda44bd00ebf4e6/cli/payment-policy.ts);
- [preview request contract](https://github.com/0xgleb/agentopoly/blob/8314e197e03124d65be9677f2fda44bd00ebf4e6/cli/wdk-sidecar-contract.ts);
- [durable reservation state](https://github.com/0xgleb/agentopoly/blob/8314e197e03124d65be9677f2fda44bd00ebf4e6/cli/payment-reservation.ts); and
- [preview-to-broadcast binding](https://github.com/0xgleb/agentopoly/blob/8314e197e03124d65be9677f2fda44bd00ebf4e6/cli/wdk-preview-registry.ts).

The current `finalize` path verifies the signed agreement witness and local policy, then records a typed refusal because broadcast integration is disabled. It must not start WDK without every exact witness.

## Limitations

- No funded WDK broadcast, transaction observation, or receipt-finality proof has been recorded.
- Reputation is local evidence, not a global score.
- There is no escrow.
- Arbitration is not part of the current browser or rehearsal scope.
- The manifest and rehearsal are preparation evidence, not a recorded submission or a claim that the full issue #15 demo is complete.
