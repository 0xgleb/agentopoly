import { afterEach, describe, expect, test } from 'bun:test'

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../..')
const temporaryRoots: string[] = []

const verificationEvent = (workspace: string, artifactHash: string) =>
  JSON.stringify({
    artifactHash,
    evidenceHash: 'b'.repeat(64),
    evidenceSource: 'live-agent-run',
    jobId: 'normalize-market-handle-v1',
    passed: true,
    recordedAt: '2026-08-22T23:00:00.000Z',
    schemaVersion: 1,
    termsHash: 'c'.repeat(64),
    type: 'verification.completed',
    verifierHash: 'd'.repeat(64),
    workspace,
  })

const runCli = async (root: string, args: readonly string[]) => {
  const process = Bun.spawn(['bun', 'run', 'cli/agentopoly.ts', ...args], {
    cwd: repositoryRoot,
    env: {
      ...Bun.env,
      AGENTOPOLY_REPOSITORY_ROOT: root,
      AGENTOPOLY_TERMS_HASH: 'c'.repeat(64),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  return Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const createFinalizeFixture = async (): Promise<Readonly<{ root: string; workspace: string }>> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agentopoly-finalize-')))
  temporaryRoots.push(root)
  const workspace = join(root, '.tmp', 'agentopoly-runs', 'reliable')
  await mkdir(workspace, { recursive: true })
  await writeFile(
    join(root, '.tmp', 'agentopoly-events.jsonl'),
    `${verificationEvent('.tmp/agentopoly-runs/reliable', 'a'.repeat(64))}\n`,
    'utf8',
  )
  return { root, workspace }
}

const runFinalize = async (
  root: string,
): Promise<Readonly<{ exitCode: number; stderr: string; stdout: string }>> => {
  const environment = Object.fromEntries(
    ['HOME', 'PATH', 'TERM', 'TMPDIR', 'USER', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'].flatMap(
      (name) => {
        const value = Bun.env[name]
        return value === undefined ? [] : [[name, value]]
      },
    ),
  )
  const child = Bun.spawn(
    [
      'bun',
      'run',
      resolve(repositoryRoot, 'cli/agentopoly.ts'),
      'finalize',
      '.tmp/agentopoly-runs/reliable',
    ],
    {
      cwd: root,
      env: { ...environment, AGENTOPOLY_REPOSITORY_ROOT: root },
      stderr: 'pipe',
      stdout: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stderr, stdout }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

describe('Agentopoly CLI', () => {
  test('returns a matching persisted verification without re-running a verifier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentopoly-verification-'))
    temporaryRoots.push(root)
    const workspace = '.tmp/agentopoly-runs/reliable'
    const submission = 'export const value = 1\n'
    await mkdir(join(root, workspace), { recursive: true })
    await writeFile(join(root, workspace, 'submission.ts'), submission, 'utf8')
    await mkdir(join(root, '.tmp'), { recursive: true })
    await writeFile(
      join(root, '.tmp', 'agentopoly-events.jsonl'),
      `${verificationEvent(
        workspace,
        createHash('sha256').update(submission, 'utf8').digest('hex'),
      )}\n`,
      'utf8',
    )

    const [exitCode, stdout, stderr] = await runCli(root, ['verify', workspace])

    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    expect(stderr).toBe('')
  })

  test('refuses verification before accepting an unbound workspace', async () => {
    const process = Bun.spawn(
      ['bun', 'run', 'cli/agentopoly.ts', 'verify', '.tmp/agentopoly-runs/untrusted'],
      {
        cwd: repositoryRoot,
        env: { ...Bun.env, AGENTOPOLY_TERMS_HASH: '' },
        stderr: 'pipe',
        stdout: 'pipe',
      },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('verification requires AGENTOPOLY_TERMS_HASH')
  })

  test('records one refusal decision across repeated finalize calls', async () => {
    const { root } = await createFinalizeFixture()

    const first = await runFinalize(root)
    const second = await runFinalize(root)
    const text = await readFile(join(root, '.tmp', 'agentopoly-events.jsonl'), 'utf8')
    const types = text
      .split('\n')
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const value: unknown = JSON.parse(line)
        return isRecord(value) && typeof value['type'] === 'string' ? [value['type']] : []
      })

    expect(first).toMatchObject({ exitCode: 0 })
    expect(second).toMatchObject({ exitCode: 0 })
    expect(second.stdout).toContain('already recorded')
    expect(types.filter((type) => type === 'payment.refused')).toHaveLength(1)
    expect(types.filter((type) => type === 'settlement.refusal-recorded')).toHaveLength(1)
    expect(types.filter((type) => type === 'reputation.updated')).toHaveLength(1)
  })

  test('releases its workspace lock after a conflicting evidence refusal', async () => {
    const { root, workspace } = await createFinalizeFixture()
    await writeFile(
      join(root, '.tmp', 'agentopoly-events.jsonl'),
      `${JSON.stringify({
        artifactHash: 'b'.repeat(64),
        evidenceSource: 'live-agent-run',
        jobId: 'normalize-market-handle-v1',
        reason: 'missing-exact-payment-authorization',
        recordedAt: '2026-08-22T23:00:01.000Z',
        schemaVersion: 1,
        termsHash: 'c'.repeat(64),
        type: 'payment.refused',
        wdkInvoked: false,
        workspace: '.tmp/agentopoly-runs/reliable',
      })}\n`,
      { flag: 'a' },
    )

    const result = await runFinalize(root)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('conflicts with the latest live verification')
    expect(await Bun.file(join(workspace, '.agentopoly-finalize.lock')).exists()).toBe(false)
  })

  test('fails closed while another finalizer owns the workspace lock', async () => {
    const { root, workspace } = await createFinalizeFixture()
    const lockPath = join(workspace, '.agentopoly-finalize.lock')
    const lock = await open(lockPath, 'wx')

    const result = await runFinalize(root)

    await lock.close()
    await unlink(lockPath)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('another finalizer is recording the settlement decision')
    const text = await readFile(join(root, '.tmp', 'agentopoly-events.jsonl'), 'utf8')
    expect(text).not.toContain('payment.refused')
    expect(text).not.toContain('reputation.updated')
  })

  test('presents the packaged provider workflow without starting an agent', async () => {
    const child = Bun.spawn(['bun', 'run', 'cli/agentopoly.ts', '--help'], {
      cwd: repositoryRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    expect(exitCode).toBe(0)
    expect(stderr).not.toContain('Agentopoly command failed')
    expect(stdout).toContain('provider <label> [--print] <prompt>')
    expect(stdout).toContain('finalize <workspace>')
    expect(stdout).not.toContain('provider reliable')
    expect(stdout).not.toContain('provider malicious')
    expect(stdout).not.toContain('agentopoly demo')
  })
})
