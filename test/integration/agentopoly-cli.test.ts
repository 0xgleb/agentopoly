import { describe, expect, test } from 'bun:test'

import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../..')

describe('Agentopoly CLI', () => {
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
    expect(stdout).toContain('provider <label> <prompt>')
    expect(stdout).toContain('finalize <workspace>')
    expect(stdout).not.toContain('provider reliable')
    expect(stdout).not.toContain('provider malicious')
    expect(stdout).not.toContain('agentopoly demo')
  })
})
