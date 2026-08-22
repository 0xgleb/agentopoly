# Contributing

Agentopoly uses small vertical stories, types-first test-driven development, and frequent cross-review. The written issue is the collaboration contract for humans and agents that may have no shared conversational context.

## Unit of work

One issue normally becomes one pull request. Issues describe a problem and observable success, not a file-by-file implementation recipe.

A checkpoint may contain several issues, but it is not complete until the application is presentable at that boundary.

## Delivery loop

1. **Lock intent.** Read the active issue, SPEC section, and threat model. Resolve ambiguity that changes the product.
2. **Specify behavior.** Update SPEC.md before implementation when the desired behavior is new or changed.
3. **Model types.** Define the domain states and boundaries so invalid combinations cannot be represented.
4. **Prove absence.** Write a compiling test that asserts the correct behavior and observe it fail for the intended reason.
5. **Implement narrowly.** Add the smallest end-to-end behavior that passes the test.
6. **Challenge boundaries.** Add malformed, stale, duplicate, replayed, oversized, wrong-identity, wrong-amount, and timeout cases that apply.
7. **Run gates.** Focused tests first, then format, lint, typecheck, full tests, Nix checks, and package checks.
8. **Cross-review.** Review protocol, defensive programming, security, financial units, external contracts, test quality, and architecture fit.
9. **Synchronize docs.** README, SPEC, ROADMAP, architecture, threat model, and issue status must remain true.
10. **Publish after evidence.** Commit and push only when the gates pass.

## Done means

A reviewer can verify from the PR that:

- every acceptance criterion is satisfied;
- the behavior has a named test at the appropriate boundary;
- required abuse tests failed before the implementation and pass afterward;
- the transaction remains demoable at the checkpoint;
- no unauthorized execution, signing, or payment call occurred;
- external assumptions are linked to official documentation or encoded by a realistic fixture;
- the diff contains only issue-related work;
- all relevant checks pass;
- docs and roadmap are current.

## Pull requests

- one issue, one PR;
- every PR closes its issue;
- title: lowercase, imperative, concise;
- body sections: `## Motivation` and `## Solution`;
- include test and demo evidence;
- use GitButler for all version-control writes;
- do not merge without human review;
- do not add tool attribution or generated-by footers.

## Architecture changes

Record an architecture decision only when the choice is expensive to reverse and implementation is ready to depend on it. Do not use ADRs as a substitute for a complete backlog, product questions, or mentor research. Proposed decisions remain visibly proposed until reviewed.

## Dependency intake

Dependencies are added through Bun after the event starts. Before acceptance, verify:

- current official package and version;
- Bare versus Node runtime requirements;
- install or build scripts;
- native binary requirements and supported platforms;
- license and maintenance state;
- whether the capability belongs in the critical path.

## Reporting blockers

State the exact blocked decision, evidence already known, best current recommendation, and work that can continue independently. Never hide uncertainty behind a guessed implementation.
