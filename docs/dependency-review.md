# Dependency review

- Checked: 2026-08-22
- Scope: reproducible Bun quality gates and pinned CI for [issue #20](https://github.com/0xgleb/agentopoly/issues/20)
- Lockfile policy: `bun.lock` records the exact resolved package versions; CI installs with
  `bun install --frozen-lockfile`.

## Runtime candidates

| Package         | Locked version  | Review                                                                                                                                               |
| --------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tetherto/wdk` | `1.0.0-beta.16` | The WDK integration is a future narrow local wallet adapter. It is not imported by the Pear worker, and it never receives a remote wallet authority. |
| `hyperswarm`    | `4.17.0`        | Candidate P2P transport for the future Pear worker. It is not yet imported.                                                                          |
| `pear-runtime`  | `1.3.1`         | Candidate Pear runtime dependency for the Bare worker. It is not yet imported.                                                                       |

The [partner technology research](./partner-technology-research.md) records the official-source
compatibility constraints. Runtime implementation must still validate the relevant adapter at its
Bare boundary before importing any of these packages.

## Development tooling

| Package             | Locked version | License    | Review                                                                                       |
| ------------------- | -------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `typescript`        | `5.9.3`        | Apache-2.0 | Compiler only. Version 5 is required by `typescript-eslint`'s published peer range.          |
| `eslint`            | `10.9.0`       | MIT        | Linter only; its Node requirement is confined to development and CI.                         |
| `@eslint/js`        | `10.0.1`       | MIT        | ESLint's maintained JavaScript ruleset.                                                      |
| `typescript-eslint` | `8.67.0`       | MIT        | Typed TypeScript lint rules. Its peer range accepts TypeScript `>=4.8.4 <6.1.0`.             |
| `prettier`          | `3.9.6`        | MIT        | Formatter only.                                                                              |
| `@types/bun`        | `1.4.0`        | MIT        | Test-only Bun declarations; production typechecking deliberately excludes Bun ambient types. |

The reviewed direct development packages have no lifecycle install hooks. Their Node-oriented
execution is reachable only through package scripts and CI, never from the Pear/Bare runtime
module. `bun audit` reported no vulnerabilities after resolution.
