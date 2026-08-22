# Provider coding fixture

This is the real bounded work item used by the Agentopoly demo. The custom CLI copies these three files into a disposable workspace before launching a Pi provider session.

- `job.json` is the typed task and acceptance-contract description.
- `starter.ts` defines the callable contract shown to the provider.
- `acceptance.test.ts` is the fixed local verifier and is never exposed as a mutable provider tool.
- The repository's `submission.ts` is a typechecking shim only and is deliberately not copied by the CLI.

A generated workspace `submission.ts` is live agent output. The reliable profile should pass the fixed verifier. The malicious/incompetent profile is explicitly prompted to use JavaScript string length instead of UTF-8 byte length, so the multi-byte boundary test fails for a real, named reason.
