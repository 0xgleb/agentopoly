import { expect, test } from 'bun:test';

import { packageName } from '../../index.ts';

test('the participant skeleton identifies its package', () => {
  expect(packageName).toBe('agentopoly');
});
