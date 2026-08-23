import { describe, expect, test } from 'bun:test'

import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../..')

describe('Agentopoly CLI', () => {
  test('presents the packaged provider workflow without starting an agent', async () => {
    const process = Bun.spawn(['bun', 'run', 'cli/agentopoly.ts', '--help'], {
      cwd: repositoryRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toContain('Agentopoly — paid work between autonomous Pi agents')
    expect(stdout).toContain('provider reliable')
    expect(stdout).toContain('provider malicious')
    expect(stdout).toContain('finalize <workspace>')
  })
})
