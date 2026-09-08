import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker } from './harness.mjs';

test('unknown API is 404 and sync fails closed without its secret', async () => {
  const worker = await loadWorker();
  const unknown = await worker.fetch(new Request('https://test.invalid/api/missing'), {}, {});
  assert.equal(unknown.status, 404);
  const sync = await worker.fetch(new Request('https://test.invalid/api/admin/sync-novel', {method: 'POST'}), {}, {});
  assert.equal(sync.status, 401);
});
