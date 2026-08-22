# Open questions

These are unresolved decisions, not implementation tasks. Resolved decisions move into SPEC.md; they are not reopened here.

## Resolved decisions

- **Wallet authorization:** use capped automatic settlement after objective verification. A dedicated tiny-balance wallet, exact witnesses, preview comparison, and per-job/session limits are mandatory.
- **Presentation quality:** terminal-only is not sufficient for a hackathon. The required experience is a polished browser UI or Telegram bot/miniapp; CLI/TUI remains a fallback and operator surface.
- **Initial judging topology:** judging is async from a required three-minute video. Multi-device live-network resilience is a finals contingency, not an initial-demo requirement.
- **Dispute story:** show a reliable provider and a malicious or incompetent provider. Verification, receipts, arbitration, and evidence-backed local reputation should visibly reward good work and penalize bad work.
- **Tether track:** optimize for WDK CLI Track 1 as the best brief fit. Pear P2P architecture and distribution are second priority; QVAC is a cherry-on-top only after the core works. Enter General too if cross-sponsor combination is allowed.

## Pending product decisions

### Polished UI channel

Should the required presentation surface be a local browser dashboard, Telegram miniapp, both, or chosen only after the core works? Current recommendation: local browser dashboard from the buyer participant, with buyer/provider/arbitrator lanes and CLI/TUI fallback.

## Mentor questions

1. May one submission enter both one Tether track and the Crecimiento General Track?
2. Does using the official `hello-pear-bare` boilerplate satisfy the global rule while all Agentopoly application code is written during the event?
3. If WDK is selected, may a standalone Pear Bare participant rely on the Node 22.18+ WDK CLI/MCP as a separately provisioned, operator-local wallet adapter?
4. Which WDK CLI network and USDt token combination is fastest and most reliable for the recorded demo?
5. Does `wdk send` preview output contain every field needed to compare asset, network, destination, amount, fee, and expiry before broadcast?
6. Are signed off-chain agent terms sufficient, or is a specific sponsor signing mechanism expected?
7. Does the Pear integration still require a seeded `pear://` install and OTA proof when the submission enters WDK rather than Pear?
8. Which browser projection pattern is known to work cleanly from a standalone Bare participant without making the projection authoritative?
9. Are sponsor template and generated scaffold files treated as allowed reuse under the global event-time code rule?

## Research blockers

- Verify Effect and schema-library support under Bare without Node assumptions.
- Verify the cleanest WDK integration boundary from a standalone Bare application.
- Verify the TypeScript-to-Bare build path.
- Verify signature primitives available under Bare.
- Verify how the selected browser or Telegram projection connects without becoming authoritative.
- Set an application message-size bound below practical Hyperswarm limits.
- Verify Corestore at-rest protection expectations for evidence bundles.
