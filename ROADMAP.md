# Agentopoly roadmap

This roadmap is ordered by demo value and integration risk. Each checkpoint leaves one coherent transaction more presentable than before.

Status legend: `in progress`, `planned`, `stretch`.

## Foundation

- [ ] [Foundation](https://github.com/0xgleb/agentopoly/issues/1) - `in progress`
- [ ] [Resolve mentor and product questions](https://github.com/0xgleb/agentopoly/issues/18) - `planned`

Exit gate: the docs agree, the local backlog is complete, partner assumptions are sourced, and unresolved choices are explicit.

## Checkpoint: an installable participant

- [ ] [Run as a standalone Pear terminal participant](https://github.com/0xgleb/agentopoly/issues/2) - `planned`
- [ ] [Show a polished judge experience](https://github.com/0xgleb/agentopoly/issues/14) - `planned`

Exit gate: one participant starts, reports its identity and role, shuts down cleanly, has a credible path to a cross-platform standalone binary, and exposes a presentation projection suitable for the selected browser or Telegram surface.

## Checkpoint: two peers find a market

- [ ] [Define bounded signed protocol envelopes](https://github.com/0xgleb/agentopoly/issues/3) - `planned`
- [ ] [Discover signed capability advertisements](https://github.com/0xgleb/agentopoly/issues/4) - `planned`
- [ ] [Reject malformed and replayed peer messages](https://github.com/0xgleb/agentopoly/issues/13) - `planned`

Exit gate: two independent processes discover each other over Hyperswarm, exchange one valid capability advertisement, age it out, and visibly reject an invalid or replayed message.

## Checkpoint: agents agree on work

- [ ] [Negotiate a job and mutually sign exact terms](https://github.com/0xgleb/agentopoly/issues/5) - `planned`

Exit gate: a buyer requests the coding service, compares at least one bid, and both parties retain the same signed terms hash.

## Checkpoint: one real service completes

- [ ] [Execute the deterministic coding service safely](https://github.com/0xgleb/agentopoly/issues/6) - `planned`
- [ ] [Verify delivery and preserve hash-linked evidence](https://github.com/0xgleb/agentopoly/issues/7) - `planned`

Exit gate: the provider delivers a patch from an isolated fixture workspace and the buyer runs the objective acceptance contract against the exact artifact.

## Checkpoint: verified work becomes money

- [ ] [Enforce local wallet authorization policy](https://github.com/0xgleb/agentopoly/issues/8) - `planned`
- [ ] [Settle a verified job in USDt](https://github.com/0xgleb/agentopoly/issues/9) - `planned`
- [ ] [Retain receipts and derive local reputation](https://github.com/0xgleb/agentopoly/issues/10) - `planned`

Exit gate: a tiny transfer is previewed and, according to the selected local policy, broadcast only for the exact verified agreement. A receipt links terms, evidence, and transaction state.

## Checkpoint: the economy resolves a dispute

- [ ] [Hire an arbitrator as an ordinary paid service](https://github.com/0xgleb/agentopoly/issues/11) - `planned`

Exit gate: the reliable provider has paid success evidence; a malicious or incompetent provider's artifact genuinely fails objective verification and receives no payment; the resulting dispute binds both parties' evidence; an independently identified arbitrator returns a ruling and receives a separate receipt; local provider selection changes without claiming global reputation.

## Checkpoint: Pear distribution is undeniable

- [ ] [Seed, install, and update over Pear](https://github.com/0xgleb/agentopoly/issues/12) - `planned`
- [ ] [Run the complete judge-facing demo](https://github.com/0xgleb/agentopoly/issues/15) - `planned`

Exit gate: the three-minute recorded demo completes the good-provider and bad-provider loops, proves the selected Tether track's hard requirement, and includes accurate clean-clone and sponsor-integration evidence. If Pear is selected, a clean environment must install from `pear://<key>` and receive an OTA-visible change.

## Stretch only after the core is stable

- [ ] [Offer QVAC delegated inference](https://github.com/0xgleb/agentopoly/issues/16) - `stretch`
- [ ] [Advertise an x402-backed HTTP service](https://github.com/0xgleb/agentopoly/issues/17) - `stretch`

Neither stretch issue may change the protocol core, wallet policy, distribution path, or required demo after the paid arbitration checkpoint is green.
