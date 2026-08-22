import { createHash } from 'node:crypto'
import { appendFile, lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import * as Effect from 'effect/Effect'

export type FileMutationQueue = <A>(path: string, operation: () => Promise<A>) => Promise<A>

const mutationTails = new Map<string, Promise<void>>()

export const queueFileMutation: FileMutationQueue = async (path, operation) => {
  const predecessor = mutationTails.get(path) ?? Promise.resolve()
  const result = predecessor.then(operation)
  mutationTails.set(
    path,
    result.then(
      () => undefined,
      () => undefined,
    ),
  )
  return result
}

export type ProviderProfile = 'malicious' | 'reliable'

export type ProviderJob = Readonly<{
  readonly acceptanceContract: string
  readonly jobId: string
  readonly starterSource: string
  readonly task: string
  readonly workspace: string
}>

export type ProviderSubmission = Readonly<{
  readonly artifactHash: string
  readonly duplicate: boolean
  readonly jobId: string
  readonly profile: ProviderProfile
}>

export type ProviderWorkspaceFailure = Readonly<{
  readonly _tag: 'invalid-job' | 'invalid-path' | 'invalid-submission' | 'workspace-io-failed'
  readonly reason: string
}>

type JobManifest = Readonly<{
  readonly acceptanceContract: string
  readonly jobId: string
  readonly schemaVersion: 1
  readonly task: string
}>

const MAX_FIXTURE_BYTES = 16_384
const MAX_SUBMISSION_BYTES = 32_768

const failure = (
  tag: ProviderWorkspaceFailure['_tag'],
  reason: string,
): ProviderWorkspaceFailure => ({ _tag: tag, reason })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength

const parseManifest = (value: unknown): Effect.Effect<JobManifest, ProviderWorkspaceFailure> => {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        key !== 'acceptanceContract' &&
        key !== 'jobId' &&
        key !== 'schemaVersion' &&
        key !== 'task',
    ) ||
    value['schemaVersion'] !== 1 ||
    typeof value['jobId'] !== 'string' ||
    value['jobId'].trim().length === 0 ||
    value['jobId'].length > 128 ||
    typeof value['task'] !== 'string' ||
    value['task'].trim().length === 0 ||
    utf8Length(value['task']) > MAX_FIXTURE_BYTES ||
    typeof value['acceptanceContract'] !== 'string' ||
    value['acceptanceContract'].trim().length === 0 ||
    utf8Length(value['acceptanceContract']) > MAX_FIXTURE_BYTES
  ) {
    return Effect.fail(failure('invalid-job', 'job manifest violates the fixture contract'))
  }

  return Effect.succeed({
    acceptanceContract: value['acceptanceContract'],
    jobId: value['jobId'],
    schemaVersion: 1,
    task: value['task'],
  })
}

const resolveWorkspace = (
  repositoryRoot: string,
  candidate: string,
): Effect.Effect<string, ProviderWorkspaceFailure> => {
  const runsRoot = resolve(repositoryRoot, '.tmp/agentopoly-runs')
  const workspace = resolve(repositoryRoot, candidate)
  const relation = relative(runsRoot, workspace)

  if (relation.length === 0 || relation.startsWith('..') || isAbsolute(relation)) {
    return Effect.fail(
      failure('invalid-path', 'provider workspace must be a child of .tmp/agentopoly-runs'),
    )
  }

  return Effect.tryPromise({
    try: async () => {
      const [actualRoot, actualWorkspace, workspaceStat] = await Promise.all([
        realpath(runsRoot),
        realpath(workspace),
        lstat(workspace),
      ])
      const actualRelation = relative(actualRoot, actualWorkspace)
      if (
        workspaceStat.isSymbolicLink() ||
        actualRelation.length === 0 ||
        actualRelation.startsWith('..') ||
        isAbsolute(actualRelation)
      ) {
        throw new Error('workspace escaped the run root')
      }
      return actualWorkspace
    },
    catch: () => failure('invalid-path', 'provider workspace is unavailable or escaped'),
  })
}

const readFixtureFile = (
  workspace: string,
  name: 'job.json' | 'starter.ts',
): Effect.Effect<string, ProviderWorkspaceFailure> => {
  const path = resolve(workspace, name)
  return Effect.tryPromise({
    try: async () => {
      const fileStat = await lstat(path)
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new Error('fixture file is not a regular file')
      }
      const content = await readFile(path, 'utf8')
      if (utf8Length(content) > MAX_FIXTURE_BYTES) {
        throw new Error('fixture file is oversized')
      }
      return content
    },
    catch: () => failure('workspace-io-failed', `could not read bounded ${name}`),
  })
}

export const loadProviderJob = (
  repositoryRoot: string,
  workspaceCandidate: string,
): Effect.Effect<ProviderJob, ProviderWorkspaceFailure> =>
  Effect.gen(function* () {
    const workspace = yield* resolveWorkspace(repositoryRoot, workspaceCandidate)
    const manifestText = yield* readFixtureFile(workspace, 'job.json')
    const starterSource = yield* readFixtureFile(workspace, 'starter.ts')
    const manifestValue = yield* Effect.try({
      try: () => JSON.parse(manifestText) as unknown,
      catch: () => failure('invalid-job', 'job manifest is not valid JSON'),
    })
    const manifest = yield* parseManifest(manifestValue)

    return {
      acceptanceContract: manifest.acceptanceContract,
      jobId: manifest.jobId,
      starterSource,
      task: manifest.task,
      workspace,
    }
  })

export const recordProviderSubmission = (
  repositoryRoot: string,
  eventsCandidate: string,
  job: ProviderJob,
  profile: ProviderProfile,
  source: string,
  queueMutation: FileMutationQueue,
): Effect.Effect<ProviderSubmission, ProviderWorkspaceFailure> => {
  if (source.trim().length === 0 || utf8Length(source) > MAX_SUBMISSION_BYTES) {
    return Effect.fail(
      failure('invalid-submission', 'submission must contain at most 32768 UTF-8 bytes'),
    )
  }

  const eventsRoot = resolve(repositoryRoot, '.tmp')
  const eventsPath = resolve(repositoryRoot, eventsCandidate)
  const eventsRelation = relative(eventsRoot, eventsPath)
  if (
    eventsRelation.length === 0 ||
    eventsRelation.startsWith('..') ||
    isAbsolute(eventsRelation)
  ) {
    return Effect.fail(failure('invalid-path', 'event log must be a file beneath .tmp'))
  }

  const submissionPath = resolve(job.workspace, 'submission.ts')
  const artifactHash = createHash('sha256').update(source, 'utf8').digest('hex')

  return Effect.tryPromise({
    try: async () => {
      let duplicate = false
      await queueMutation(submissionPath, async () => {
        try {
          await writeFile(submissionPath, source, { encoding: 'utf8', flag: 'wx' })
        } catch (cause: unknown) {
          const existing = await readFile(submissionPath, 'utf8')
          if (existing !== source) throw cause
          duplicate = true
        }
      })

      const event = {
        artifactHash,
        evidenceSource: 'live-agent-run',
        jobId: job.jobId,
        profile,
        recordedAt: new Date().toISOString(),
        schemaVersion: 1,
        type: 'provider.artifact-submitted',
        workspace: relative(repositoryRoot, job.workspace),
      }
      await queueMutation(eventsPath, async () => {
        await appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf8')
      })

      return { artifactHash, duplicate, jobId: job.jobId, profile }
    },
    catch: () => failure('workspace-io-failed', 'could not persist the provider submission'),
  })
}
