#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { appendFile, copyFile, lstat, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve } from 'node:path'

import * as Effect from 'effect/Effect'

import {
  isProviderProfile,
  resolveProviderWorkspace,
  type ProviderProfile,
} from './provider-workspace.ts'
import { decodeLatestVerification, deriveSettlementEvents } from './settlement.ts'

type CliFailure = Readonly<{
  readonly _tag: 'invalid-command' | 'provider-failed' | 'runtime-io-failed' | 'verification-failed'
  readonly reason: string
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

const verifyRun = (workspaceCandidate: string): Effect.Effect<boolean, CliFailure> =>
  Effect.gen(function* () {
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
    const exitCode = yield* Effect.tryPromise({
      try: async () => {
        const child = Bun.spawn(['bun', 'test', '--timeout', '10000', 'acceptance.test.ts'], {
          cwd: workspace,
          env: childEnvironment(),
          stderr: 'inherit',
          stdin: 'ignore',
          stdout: 'inherit',
        })
        return waitForExit(child, 15_000)
      },
      catch: () => failure('verification-failed', 'fixed verifier process could not start'),
    })
    const passed = exitCode === 0
    yield* appendEvent({
      artifactHash,
      evidenceSource: 'live-agent-run',
      jobId: 'normalize-market-handle-v1',
      passed,
      type: 'verification.completed',
      workspace: relative(repositoryRoot, workspace),
    })
    return passed
  })

const finalizeRun = (workspaceCandidate: string): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const workspace = yield* resolveProviderWorkspace(repositoryRoot, workspaceCandidate).pipe(
      Effect.mapError(() =>
        failure('invalid-command', 'settlement workspace must be beneath .tmp/agentopoly-runs'),
      ),
    )

    const eventLog = yield* Effect.tryPromise({
      try: () => readFile(eventsPath, 'utf8'),
      catch: () => failure('runtime-io-failed', 'live event log is unavailable'),
    })
    const verification = yield* decodeLatestVerification(
      eventLog,
      relative(repositoryRoot, workspace),
    ).pipe(Effect.mapError((cause) => failure('verification-failed', cause.reason)))
    yield* Effect.forEach(deriveSettlementEvents(verification), appendEvent, {
      concurrency: 1,
      discard: true,
    })
    console.log(
      verification.passed
        ? 'WDK payment safely refused: exact local payment authorization is absent.'
        : 'WDK payment safely refused: provider verification failed.',
    )
  })

const printHelp = (): void => {
  console.log(`Agentopoly — paid work between autonomous Pi agents

Usage:
  agentopoly provider <label> <prompt>  Launch one runtime-configured provider
  agentopoly verify <workspace>        Run the fixed verifier for one submitted workspace
  agentopoly finalize <workspace>      Attempt exact settlement or record a typed refusal

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
      const prompt = remaining.join(' ').trim()
      if (prompt.length === 0 || new TextEncoder().encode(prompt).byteLength > 4_096) {
        return yield* Effect.fail(
          failure('invalid-command', 'provider prompt must contain at most 4096 UTF-8 bytes'),
        )
      }
      const run = yield* runProvider(argument, prompt)
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
