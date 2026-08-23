#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { appendFile, copyFile, lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve } from 'node:path'

import * as Effect from 'effect/Effect'

import {
  isProviderProfile,
  resolveProviderWorkspace,
  type ProviderProfile,
} from './provider-workspace.ts'
import {
  agreementWitnessFileName,
  bindAgreementWitnessToVerification,
  decodeSignedAgreementWitness,
} from './agreement-witness.ts'
import { decodeFinalizePolicy } from './finalize-policy.ts'
import { authorizePayment } from './payment-policy.ts'
import { decodeLatestVerification, selectSettlementEventsToAppend } from './settlement.ts'
import { redactBoundedVerifierEvidence } from './verification-evidence.ts'

type CliFailure = Readonly<{
  readonly _tag:
    | 'invalid-command'
    | 'provider-failed'
    | 'runtime-io-failed'
    | 'settlement-in-progress'
    | 'verification-failed'
  readonly reason: string
}>

type FinalizeLock = Readonly<{
  readonly handle: Awaited<ReturnType<typeof open>>
  readonly path: string
}>

type PreparedRun = Readonly<{
  readonly profile: ProviderProfile
  readonly relativeWorkspace: string
  readonly workspace: string
}>

const failure = (tag: CliFailure['_tag'], reason: string): CliFailure => ({ _tag: tag, reason })

const repositoryRoot = resolve(Bun.env['AGENTOPOLY_REPOSITORY_ROOT'] ?? process.cwd())
const runsRoot = join(repositoryRoot, '.tmp', 'agentopoly-runs')
const eventsPath = join(repositoryRoot, '.tmp', 'agentopoly-events.jsonl')
const fixtureRoot = join(repositoryRoot, 'fixtures', 'provider-job')
const ohMyPiExtension = fileURLToPath(import.meta.resolve('oh-my-pi'))
const verificationTimeoutMs = 10_000
const maximumCapturedBytes = 16_384

const childEnvironment = (): Readonly<Record<string, string>> => {
  const allowed = ['HOME', 'PATH', 'TERM', 'TMPDIR', 'USER', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME']
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = Bun.env[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
}

type BoundedChild = Readonly<{
  readonly exited: Promise<number>
  readonly kill: () => void
}>

const waitForExit = (child: BoundedChild, timeoutMilliseconds: number): Promise<number> =>
  new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      child.kill()
      rejectExit(new Error('child process timed out'))
    }, timeoutMilliseconds)
    void child.exited.then(
      (code) => {
        clearTimeout(timeout)
        resolveExit(code)
      },
      (cause: unknown) => {
        clearTimeout(timeout)
        rejectExit(cause instanceof Error ? cause : new Error('child process failed'))
      },
    )
  })

const collectBoundedOutput = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let retained = 0
  let next = await reader.read()
  while (!next.done) {
    if (retained < maximumCapturedBytes) {
      const chunk = next.value.slice(0, maximumCapturedBytes - retained)
      chunks.push(chunk)
      retained += chunk.length
    }
    next = await reader.read()
  }
  const output = new Uint8Array(retained)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(output)
}

const appendEvent = (event: Readonly<Record<string, unknown>>): Effect.Effect<void, CliFailure> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(join(repositoryRoot, '.tmp'), { recursive: true })
      await appendFile(
        eventsPath,
        `${JSON.stringify({ ...event, recordedAt: new Date().toISOString(), schemaVersion: 1 })}\n`,
        'utf8',
      )
    },
    catch: () => failure('runtime-io-failed', 'could not append the bounded provider event'),
  })

const prepareRun = (profile: ProviderProfile): Effect.Effect<PreparedRun, CliFailure> =>
  Effect.tryPromise({
    try: async () => {
      const runId = `${Date.now().toString()}-${profile}`
      const workspace = join(runsRoot, runId)
      await mkdir(runsRoot, { recursive: true })
      await mkdir(workspace, { recursive: false })
      await Promise.all(
        ['acceptance.test.ts', 'job.json', 'starter.ts'].map((name) =>
          copyFile(join(fixtureRoot, name), join(workspace, name)),
        ),
      )
      return {
        profile,
        relativeWorkspace: relative(repositoryRoot, workspace),
        workspace,
      }
    },
    catch: () => failure('runtime-io-failed', 'could not create the disposable provider workspace'),
  })

const runProvider = (
  profile: ProviderProfile,
  prompt: string,
  print: boolean,
): Effect.Effect<PreparedRun, CliFailure> =>
  Effect.gen(function* () {
    const run = yield* prepareRun(profile)
    yield* appendEvent({
      evidenceSource: 'live-agent-run',
      jobId: 'normalize-market-handle-v1',
      profile,
      type: 'provider.started',
      workspace: run.relativeWorkspace,
    })

    const args = [
      '--no-session',
      '--no-extensions',
      '--no-builtin-tools',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '-e',
      ohMyPiExtension,
      '-e',
      join(repositoryRoot, 'cli', 'extensions', 'agentopoly.ts'),
      '--agentopoly-profile',
      profile,
      '--agentopoly-workspace',
      run.relativeWorkspace,
      '--agentopoly-events',
      relative(repositoryRoot, eventsPath),
    ]
    if (print) args.push('-p')
    args.push(prompt)

    const exitCode = yield* Effect.tryPromise({
      try: async () => {
        const child = Bun.spawn(['pi', ...args], {
          cwd: repositoryRoot,
          env: {
            ...childEnvironment(),
            AGENTOPOLY_REPOSITORY_ROOT: repositoryRoot,
          },
          stderr: 'inherit',
          stdin: 'inherit',
          stdout: 'inherit',
        })
        return waitForExit(child, 5 * 60 * 1_000)
      },
      catch: () => failure('provider-failed', 'could not start the Pi provider process'),
    })

    if (exitCode !== 0) {
      return yield* Effect.fail(
        failure('provider-failed', `${profile} provider exited before submitting work`),
      )
    }

    return run
  })

const requireTermsHash = (): Effect.Effect<string, CliFailure> => {
  const termsHash = Bun.env['AGENTOPOLY_TERMS_HASH']
  return typeof termsHash === 'string' && /^[a-f0-9]{64}$/.test(termsHash)
    ? Effect.succeed(termsHash)
    : Effect.fail(
        failure(
          'invalid-command',
          'verification requires AGENTOPOLY_TERMS_HASH from the exact signed agreement',
        ),
      )
}

const verifyRun = (workspaceCandidate: string): Effect.Effect<boolean, CliFailure> =>
  Effect.gen(function* () {
    const termsHash = yield* requireTermsHash()
    const workspace = yield* resolveProviderWorkspace(repositoryRoot, workspaceCandidate).pipe(
      Effect.mapError(() =>
        failure('invalid-command', 'verification workspace must be beneath .tmp/agentopoly-runs'),
      ),
    )

    const submission = yield* Effect.tryPromise({
      try: async () => {
        const submissionPath = join(workspace, 'submission.ts')
        const submissionStat = await lstat(submissionPath)
        if (submissionStat.isSymbolicLink() || !submissionStat.isFile()) {
          throw new Error('submission is not a regular file')
        }
        return readFile(submissionPath, 'utf8')
      },
      catch: () => failure('verification-failed', 'provider did not submit an artifact'),
    })
    const artifactHash = createHash('sha256').update(submission, 'utf8').digest('hex')
    const eventWorkspace = yield* Effect.tryPromise({
      try: async () => `.tmp/agentopoly-runs/${relative(await realpath(runsRoot), workspace)}`,
      catch: () =>
        failure('verification-failed', 'could not establish the verified workspace identity'),
    })
    const eventLog = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(eventsPath, 'utf8')
        } catch (cause: unknown) {
          if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined
          throw cause
        }
      },
      catch: () => failure('verification-failed', 'could not read durable verification evidence'),
    })
    if (eventLog !== undefined) {
      const existing = yield* Effect.either(decodeLatestVerification(eventLog, eventWorkspace))
      if (existing._tag === 'Right') {
        if (
          existing.right.artifactHash !== artifactHash ||
          existing.right.termsHash !== termsHash
        ) {
          return yield* Effect.fail(
            failure(
              'verification-failed',
              'durable verification conflicts with current artifact or terms',
            ),
          )
        }
        return existing.right.passed
      }
      if (existing.left._tag !== 'verification-not-found') {
        return yield* Effect.fail(
          failure(
            'verification-failed',
            'durable verification evidence is malformed or conflicting',
          ),
        )
      }
    }
    const verifierSource = yield* Effect.tryPromise({
      try: () => readFile(join(workspace, 'acceptance.test.ts'), 'utf8'),
      catch: () => failure('verification-failed', 'fixed verifier contract is unavailable'),
    })
    const verifierHash = createHash('sha256').update(verifierSource, 'utf8').digest('hex')
    const verifierResult = yield* Effect.tryPromise({
      try: async () => {
        const child = Bun.spawn(
          ['bun', 'test', '--timeout', verificationTimeoutMs.toString(), 'acceptance.test.ts'],
          {
            cwd: workspace,
            env: childEnvironment(),
            stderr: 'pipe',
            stdin: 'ignore',
            stdout: 'pipe',
          },
        )
        let timedOut = false
        const timeout = setTimeout(() => {
          timedOut = true
          child.kill()
        }, verificationTimeoutMs)
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          collectBoundedOutput(child.stdout),
          collectBoundedOutput(child.stderr),
        ])
        clearTimeout(timeout)
        return { exitCode, stderr, stdout, timedOut }
      },
      catch: () => failure('verification-failed', 'fixed verifier process could not start'),
    })
    if (verifierResult.timedOut) {
      return yield* Effect.fail(
        failure('verification-failed', 'fixed verifier exceeded its bounded execution time'),
      )
    }
    const verifiedSubmission = yield* Effect.tryPromise({
      try: () => readFile(join(workspace, 'submission.ts'), 'utf8'),
      catch: () =>
        failure('verification-failed', 'provider artifact disappeared during verification'),
    })
    const verifiedArtifactHash = createHash('sha256')
      .update(verifiedSubmission, 'utf8')
      .digest('hex')
    if (verifiedArtifactHash !== artifactHash) {
      return yield* Effect.fail(
        failure('verification-failed', 'provider artifact changed during verification'),
      )
    }
    const passed = verifierResult.exitCode === 0
    const evidence = redactBoundedVerifierEvidence(
      `${verifierResult.stdout}\n${verifierResult.stderr}`,
      workspace,
    )
    const evidenceHash = createHash('sha256')
      .update(
        JSON.stringify({
          artifactHash,
          evidence,
          exitCode: verifierResult.exitCode,
          termsHash,
          verifierHash,
        }),
        'utf8',
      )
      .digest('hex')
    yield* appendEvent({
      artifactHash,
      evidenceHash,
      evidenceSource: 'live-agent-run',
      jobId: 'normalize-market-handle-v1',
      passed,
      termsHash,
      type: 'verification.completed',
      verifierHash,
      workspace: eventWorkspace,
    })
    return passed
  })

const acquireFinalizeLock = (workspace: string): Effect.Effect<FinalizeLock, CliFailure> =>
  Effect.tryPromise({
    try: async () => {
      const path = join(workspace, '.agentopoly-finalize.lock')
      const handle = await open(path, 'wx')
      return { handle, path }
    },
    catch: (cause) =>
      typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EEXIST'
        ? failure(
            'settlement-in-progress',
            'another finalizer is recording the settlement decision',
          )
        : failure('runtime-io-failed', 'could not reserve the settlement decision lock'),
  })

const releaseFinalizeLock = (lock: FinalizeLock): Effect.Effect<void, CliFailure> =>
  Effect.tryPromise({
    try: async () => {
      await lock.handle.close()
      await rm(lock.path)
    },
    catch: () => failure('runtime-io-failed', 'could not release the settlement decision lock'),
  })

const releaseFinalizeLockBestEffort = (lock: FinalizeLock): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => lock.handle.close(),
    catch: () => failure('runtime-io-failed', 'could not close the settlement decision lock'),
  }).pipe(
    Effect.catchAll(() => Effect.void),
    Effect.andThen(
      Effect.tryPromise({
        try: () => rm(lock.path, { force: true }),
        catch: () => failure('runtime-io-failed', 'could not remove the settlement decision lock'),
      }),
    ),
    Effect.catchAll((cause) =>
      Effect.sync(() => {
        console.error(`Agentopoly lock cleanup failed: ${cause.reason}`)
      }),
    ),
  )

const finalizeRun = (workspaceCandidate: string): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const workspace = yield* resolveProviderWorkspace(repositoryRoot, workspaceCandidate).pipe(
      Effect.mapError(() =>
        failure('invalid-command', 'settlement workspace must be beneath .tmp/agentopoly-runs'),
      ),
    )

    const eventWorkspace = yield* Effect.tryPromise({
      try: async () => `.tmp/agentopoly-runs/${relative(await realpath(runsRoot), workspace)}`,
      catch: () =>
        failure('runtime-io-failed', 'could not establish the verified workspace identity'),
    })
    yield* Effect.acquireUseRelease(
      acquireFinalizeLock(workspace),
      (ownedLock) =>
        Effect.gen(function* () {
          const eventLog = yield* Effect.tryPromise({
            try: () => readFile(eventsPath, 'utf8'),
            catch: () => failure('runtime-io-failed', 'live event log is unavailable'),
          })
          const verification = yield* decodeLatestVerification(eventLog, eventWorkspace).pipe(
            Effect.mapError((cause) => failure('verification-failed', cause.reason)),
          )
          const events = yield* selectSettlementEventsToAppend(eventLog, verification).pipe(
            Effect.mapError((cause) => failure('verification-failed', cause.reason)),
          )
          if (events.length === 0) {
            yield* releaseFinalizeLock(ownedLock)
            console.log('Settlement refusal was already recorded; no events were appended.')
            return
          }
          const authorization = yield* Effect.either(
            Effect.gen(function* () {
              const operatorPublicKey = Bun.env['AGENTOPOLY_AGREEMENT_OPERATOR_PUBLIC_KEY']
              if (operatorPublicKey === undefined) {
                return yield* Effect.fail(
                  failure('verification-failed', 'local agreement witness public key is absent'),
                )
              }
              const witnessText = yield* Effect.tryPromise({
                try: () =>
                  readFile(
                    join(
                      repositoryRoot,
                      '.tmp',
                      'agentopoly-agreements',
                      agreementWitnessFileName(eventWorkspace),
                    ),
                    'utf8',
                  ),
                catch: () =>
                  failure('verification-failed', 'durable signed agreement witness is absent'),
              })
              const witness = yield* decodeSignedAgreementWitness(witnessText, {
                expectedWorkspace: eventWorkspace,
                operatorPublicKey,
              }).pipe(Effect.mapError((cause) => failure('verification-failed', cause.reason)))
              const payment = yield* bindAgreementWitnessToVerification(witness, {
                artifactHash: verification.artifactHash,
                passed: verification.passed,
                termsHash: verification.termsHash,
                verificationHash: verification.evidenceHash,
              }).pipe(Effect.mapError((cause) => failure('verification-failed', cause.reason)))
              const policy = yield* decodeFinalizePolicy(
                Bun.env['AGENTOPOLY_FINALIZE_POLICY'],
              ).pipe(Effect.mapError((cause) => failure('verification-failed', cause.reason)))
              const decision = authorizePayment({
                agreement: {
                  ...payment,
                  sourceAccountIndex: policy.sourceAccountIndex,
                  sourceAddress: policy.sourceAddress,
                  sourceWallet: policy.sourceWallet,
                },
                artifactHash: verification.artifactHash,
                policy,
                termsHash: witness.termsHash,
                verification: {
                  artifactHash: verification.artifactHash,
                  passed: verification.passed,
                  termsHash: verification.termsHash,
                  verificationHash: verification.evidenceHash,
                },
                verificationHash: verification.evidenceHash,
              })
              if (!decision.ok) {
                return yield* Effect.fail(
                  failure(
                    'verification-failed',
                    `local WDK policy refused payment: ${decision.reason}`,
                  ),
                )
              }
              return decision.value
            }),
          )
          yield* Effect.forEach(events, appendEvent, {
            concurrency: 1,
            discard: true,
          })
          yield* releaseFinalizeLock(ownedLock)
          console.log(
            authorization._tag === 'Right'
              ? 'WDK payment safely refused: broadcast integration is not enabled.'
              : `WDK payment safely refused: ${authorization.left.reason}`,
          )
        }),
      releaseFinalizeLockBestEffort,
    )
  })

const printHelp = (): void => {
  console.log(`Agentopoly — paid work between autonomous Pi agents

Usage:
  agentopoly provider <label> [--print] <prompt>  Launch one runtime-configured provider
  agentopoly verify <workspace>                  Run the fixed verifier for one workspace
  agentopoly finalize <workspace>                Attempt settlement or record a typed refusal

Provider sessions load the exact Oh My Pi package plus Agentopoly's project extension. They receive only fixture-scoped inspect and submit tools; no wallet, network, shell, or unrestricted filesystem capability.`)
}

const main = (args: readonly string[]): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const [command, argument, ...remaining] = args

    if (command === undefined || command === 'help' || command === '--help') {
      printHelp()
      return
    }

    if (command === 'provider' && isProviderProfile(argument)) {
      const print = remaining[0] === '--print'
      const prompt = remaining
        .slice(print ? 1 : 0)
        .join(' ')
        .trim()
      if (prompt.length === 0 || new TextEncoder().encode(prompt).byteLength > 4_096) {
        return yield* Effect.fail(
          failure('invalid-command', 'provider prompt must contain at most 4096 UTF-8 bytes'),
        )
      }
      const run = yield* runProvider(argument, prompt, print)
      console.log(`Workspace: ${run.relativeWorkspace}`)
      return
    }

    if (command === 'verify' && argument !== undefined) {
      const passed = yield* verifyRun(argument)
      if (!passed) {
        return yield* Effect.fail(
          failure('verification-failed', 'artifact failed the fixed acceptance contract'),
        )
      }
      return
    }

    if (command === 'finalize' && argument !== undefined) {
      yield* finalizeRun(argument)
      return
    }

    return yield* Effect.fail(failure('invalid-command', 'use agentopoly --help'))
  })

const exit = await Effect.runPromiseExit(main(Bun.argv.slice(2)))
if (exit._tag === 'Failure') {
  const cause = exit.cause
  console.error(`Agentopoly command failed: ${cause.toString()}`)
  process.exitCode = 1
}
