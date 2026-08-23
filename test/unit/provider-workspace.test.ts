import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as Effect from 'effect/Effect'

import {
  loadProviderJob,
  queueFileMutation,
  recordProviderSubmission,
  resolveProviderWorkspace,
} from '../../cli/provider-workspace.ts'

const temporaryRoots: string[] = []

const createWorkspace = async (): Promise<Readonly<{ root: string; workspace: string }>> => {
  const root = await mkdtemp(join(tmpdir(), 'agentopoly-provider-'))
  temporaryRoots.push(root)
  const workspace = join(root, '.tmp', 'agentopoly-runs', 'reliable')
  await mkdir(workspace, { recursive: true })
  await writeFile(
    join(workspace, 'job.json'),
    JSON.stringify({
      acceptanceContract: 'Run the fixed local verifier.',
      jobId: 'fixture-job',
      schemaVersion: 1,
      task: 'Implement the fixture contract.',
    }),
    'utf8',
  )
  await writeFile(join(workspace, 'starter.ts'), 'export const value = 1\n', 'utf8')
  return { root, workspace }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

describe('provider workspace boundary', () => {
  test('loads a bounded job and records an idempotent live submission', async () => {
    const { root, workspace } = await createWorkspace()
    const job = await Effect.runPromise(loadProviderJob(root, workspace))
    const source = 'export const value = 2\n'

    const first = await Effect.runPromise(
      recordProviderSubmission(
        root,
        '.tmp/events.jsonl',
        job,
        'reliable',
        source,
        queueFileMutation,
      ),
    )
    const duplicate = await Effect.runPromise(
      recordProviderSubmission(
        root,
        '.tmp/events.jsonl',
        job,
        'reliable',
        source,
        queueFileMutation,
      ),
    )

    expect(first.duplicate).toBeFalse()
    expect(duplicate).toEqual({ ...first, duplicate: true })
    expect(await readFile(join(workspace, 'submission.ts'), 'utf8')).toBe(source)
    const events = (await readFile(join(root, '.tmp', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line): unknown => JSON.parse(line))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      artifactHash: first.artifactHash,
      evidenceSource: 'live-agent-run',
      jobId: 'fixture-job',
      profile: 'reliable',
      schemaVersion: 1,
      type: 'provider.artifact-submitted',
    })
  })

  test('rejects workspaces outside the disposable run root', async () => {
    const { root } = await createWorkspace()
    const exit = await Effect.runPromiseExit(loadProviderJob(root, root))

    expect(exit._tag).toBe('Failure')
  })

  test('rejects a symlinked workspace that escapes the physical run root', async () => {
    const { root } = await createWorkspace()
    const outside = join(root, 'outside')
    const escaped = join(root, '.tmp', 'agentopoly-runs', 'escaped')
    await mkdir(outside)
    await symlink(outside, escaped)

    const exit = await Effect.runPromiseExit(resolveProviderWorkspace(root, escaped))

    expect(exit._tag).toBe('Failure')
  })

  test('rejects a conflicting second submission without replacing evidence', async () => {
    const { root, workspace } = await createWorkspace()
    const job = await Effect.runPromise(loadProviderJob(root, workspace))
    await Effect.runPromise(
      recordProviderSubmission(
        root,
        '.tmp/events.jsonl',
        job,
        'reliable',
        'export const value = 2\n',
        queueFileMutation,
      ),
    )

    const exit = await Effect.runPromiseExit(
      recordProviderSubmission(
        root,
        '.tmp/events.jsonl',
        job,
        'reliable',
        'export const value = 3\n',
        queueFileMutation,
      ),
    )

    expect(exit._tag).toBe('Failure')
    expect(await readFile(join(workspace, 'submission.ts'), 'utf8')).toBe(
      'export const value = 2\n',
    )
  })
})
