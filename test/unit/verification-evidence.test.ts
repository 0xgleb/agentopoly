import { describe, expect, test } from 'bun:test'

import { redactBoundedVerifierEvidence } from '../../cli/verification-evidence.ts'

describe('bounded verifier evidence', () => {
  test('redacts workspace paths and credential-shaped assignments before hashing', () => {
    expect(
      redactBoundedVerifierEvidence(
        'failure at /tmp/agentopoly-runs/job/submission.ts\nAPI_TOKEN=not-for-evidence',
        '/tmp/agentopoly-runs/job',
      ),
    ).toContain('failure at <workspace>/submission.ts\nAPI_TOKEN=[redacted]')
  })

  test('bounds evidence by UTF-8 bytes without splitting a code point', () => {
    const evidence = redactBoundedVerifierEvidence('😀'.repeat(10_000), '/workspace')

    expect(new TextEncoder().encode(evidence).byteLength).toBeLessThanOrEqual(16_384)
    expect(evidence.endsWith('…[truncated]')).toBe(true)
  })
})
