import { afterEach, describe, expect, test } from 'bun:test'

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
    expect(stderr).toContain('Agentopoly command failed with a typed runtime error.')
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
