import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

async function setup(t) {
  const mf = new Miniflare({
    modules: true,
    script: await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-05-07',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['CHAPTERS'],
    outboundService: () => new Response('External requests disabled in tests', { status: 503 }),
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  const bucket = await mf.getR2Bucket('CHAPTERS');
  const call = (path) => mf.dispatchFetch(`http://test.invalid/api/${path}`);
  return { db, bucket, call };
}

test('B03: synopsis 404 khi truyện không tồn tại (trước đây ném ReferenceError → 500)', async t => {
  const { call } = await setup(t);
  const res = await call('novels/missing/synopsis');
  assert.equal(res.status, 404);
});

test('B03: synopsis ưu tiên R2 (nguồn mới nhất) khi D1 đã cũ', async t => {
  const { db, bucket, call } = await setup(t);
  await db.prepare(`INSERT INTO novels (slug, title, synopsis) VALUES ('demo', 'Demo', 'D1 cũ')`).run();
  await bucket.put('demo/synopsis.md', 'R2 mới nhất, dài hơn preview 500 ký tự nhiều lần lặp lại '.repeat(20));
  const res = await call('novels/demo/synopsis');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.source, 'r2');
  assert.match(data.synopsis, /R2 mới nhất/);
});

test('B03: synopsis fallback D1 khi R2 chưa có file', async t => {
  const { db, call } = await setup(t);
  await db.prepare(`INSERT INTO novels (slug, title, synopsis) VALUES ('demo', 'Demo', 'Chỉ có ở D1')`).run();
  const res = await call('novels/demo/synopsis');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.source, 'd1');
  assert.equal(data.synopsis, 'Chỉ có ở D1');
});

test('B03: "Xem thêm" — full synopsis dài hơn preview 500 ký tự trả đủ, không bị cắt như getNovel', async t => {
  const { db, call } = await setup(t);
  const full = 'a'.repeat(1200);
  await db.prepare(`INSERT INTO novels (slug, title, synopsis) VALUES ('demo', 'Demo', ?)`).bind(full).run();
  const detail = await (await call('novels/demo')).json();
  assert.equal(detail.has_more_synopsis, true);
  assert.equal(detail.synopsis.length, 500);
  const full_res = await (await call('novels/demo/synopsis')).json();
  assert.equal(full_res.synopsis.length, 1200);
});
