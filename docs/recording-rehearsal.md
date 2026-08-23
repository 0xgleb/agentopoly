# Recording rehearsal

This runbook exercises the real provider-to-browser path without recording video, loading wallet secrets, producing fake events, or invoking `agentopoly demo`.

## Preconditions

- Run from the repository root with the pinned development environment.
- Configure only the reviewed public agreement key and local payment policy required by `agentopoly finalize`; do not expose a private signing key, wallet seed, or passphrase to the script.
- After the provider phase returns a workspace, an operator must place its strict signed agreement witness at the fixed `.tmp/agentopoly-agreements/<workspace-sha256>.json` location. The witness must bind that exact workspace.

## Phase 1: real provider

Run the real bounded provider. The script captures its output but prints only the workspace identifier and a bounded evidence-file path:

```nu
nu scripts/rehearse-recorded-demo.nu provider reliable-provider "Implement the fixture exactly as specified."
```

Use the returned workspace to create the operator-attested agreement witness through the reviewed local signing workflow. This runbook never creates or reads the private signing material.

## Phase 2: verification, refusal, and projection

Run the second phase with the returned workspace:

```nu
nu scripts/rehearse-recorded-demo.nu settle .tmp/agentopoly-runs/<workspace>
```

The script derives the only permitted witness path from that workspace, obtains its canonical terms hash for verification, then invokes `verify` and `finalize` twice. It fails if the second finalization appends any new event-log record. It records only bounded command summaries, event counts, workspace identity, and the browser command in `.tmp/recording-rehearsals/`.

`finalize` independently verifies the agreement signature and exact local policy before it can reach any WDK boundary. This implementation remains broadcast-disabled, so a valid rehearsal ends in a typed refusal rather than payment. Start the projection separately with `bun run dev` and view the bounded local browser API; never treat the evidence file as wallet or settlement proof.
