import { expect, test } from 'bun:test';

test('the participant entrypoint can be loaded', async () => {
  const entrypoint = await import('../../index.ts');

  expect(entrypoint.packageName).toBe('agentopoly');
});
