import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { loadWorker } from './harness.mjs';

async function setup(t) {
  const mf = new Miniflare({
    modules: true,
    script: await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-05-07',
    compatibilityFlags: ['nodejs_compat'],
    bindings: { SYNC_KEY: 'test-key' },
    d1Databases: ['DB'],
    outboundService: () => new Response('Network disabled', { status: 503 }),
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migration = await readFile(new URL('../../migrations/008_external_rankings.sql', import.meta.url), 'utf8');
  await db.batch(migration.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  const post = (body, key = 'test-key') => mf.dispatchFetch('http://test.invalid/api/admin/sync-rankings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-key': key }, body: JSON.stringify(body),
  });
  const get = () => mf.dispatchFetch('http://test.invalid/api/rankings');
  return { post, get, db };
}
const entry = (rank = 1, extra = {}) => ({ category: 'views', window: 'weekly', rank, title: `Book ${rank}`, source_url: `https://www.qidian.com/book/${rank}/`, ...extra });
const batch = (entries, extra = {}) => ({ source: 'qidian', snapshot_date: '2026-09-15', entries, ...extra });

test('rankings: unauthorized requests never access D1; verified key uses sync limiter', async () => {
  const worker = await loadWorker();
  const calls = [];
  const env = { SYNC_KEY: 'test-key', PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SYNC_RATE_LIMITER: { limit: async ({ key }) => { calls.push(key); return { success: true }; } } };
  for (const key of ['', 'wrong']) {
    const res = await worker.fetch(new Request('https://test.invalid/api/admin/sync-rankings', { method: 'POST', headers: { 'x-sync-key': key } }), env, {});
    assert.equal(res.status, 401);
  }
  const res = await worker.fetch(new Request('https://test.invalid/api/admin/sync-rankings', { method: 'POST', headers: { 'x-sync-key': 'test-key' }, body: '{}' }), env, {});
  assert.equal(res.status, 400);
  assert.deepEqual(calls, ['sync:authorized']);
});

test('rankings: insert/upsert, skip invalid entries, retain failed combos and group sorted snapshots', async t => {
  const { post, get, db } = await setup(t);
  assert.deepEqual(await (await get()).json(), { groups: [] });
  let res = await post(batch([entry(2), entry(), null, entry(0), entry(1.5), entry(3, { title: ' ' }), entry(4, { source_url: 'javascript:alert(1)' }), entry(5, { category: '' })]));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { upserted: 2, skipped: 6 });
  await post(batch([entry(1, { title: 'Old monthly', window: 'monthly' })]));
  await post(batch([entry(1, { title: 'Faloo' })], { source: 'faloo' }));
  res = await post(batch([entry(1, { title: 'Updated' })], { snapshot_date: '2026-09-16' }));
  assert.deepEqual(await res.json(), { upserted: 1, skipped: 0 });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM external_rankings').first()).n, 4);
  res = await get();
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=10800, s-maxage=10800');
  const { groups } = await res.json();
  assert.equal(groups.length, 3);
  const weekly = groups.find(g => g.source === 'qidian' && g.window === 'weekly');
  assert.equal(weekly.snapshot_date, '2026-09-16');
  assert.deepEqual(weekly.items.map(i => i.title), ['Updated']);
  assert.equal(groups.find(g => g.window === 'monthly').snapshot_date, '2026-09-15');
  await post(batch([entry(2), entry(1)], { source: 'other' }));
  const sorted = (await (await get()).json()).groups.find(g => g.source === 'other');
  assert.deepEqual(sorted.items.map(i => i.rank), [1, 2]);
});

test('rankings: malformed batch is 400, empty/invalid-only batches preserve data', async t => {
  const { post, get } = await setup(t);
  for (const body of [null, {}, batch([], { source: '' }), batch([], { entries: {} })]) {
    assert.equal((await post(body)).status, 400);
  }
  await post(batch([entry()]));
  for (const entries of [[], [null]]) {
    assert.equal((await post(batch(entries))).status, 200);
  }
  assert.equal((await (await get()).json()).groups[0].items.length, 1);
});
