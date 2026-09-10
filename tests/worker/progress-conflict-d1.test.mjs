import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

// C03 xác minh trên D1 thật (Miniflare), không chỉ mock: cú pháp
// "ON CONFLICT ... DO UPDATE ... WHERE" phải hoạt động đúng như SQLite thật,
// bao gồm meta.changes = 0 khi write bị từ chối vì đến muộn.
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
  await db.prepare(`INSERT INTO novels (slug, title) VALUES ('demo', 'Demo')`).run();
  await db.prepare(`INSERT INTO users (id, email, password_hash) VALUES (1, 'a@b.com', 'x')`).run();
  await db.prepare(`INSERT INTO user_sessions (token, user_id, expires_at) VALUES ('u_tok1', 1, '2999-01-01 00:00:00')`).run();
  const put = (chapter, client_updated_at) => mf.dispatchFetch('http://test.invalid/api/user/progress/demo', {
    method: 'PUT',
    headers: { Authorization: 'Bearer u_tok1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapter, client_updated_at }),
  });
  return { db, put };
}

test('C03 (D1 thật): request cũ đến muộn bị từ chối 409, không ghi đè bản mới hơn', async t => {
  const { db, put } = await setup(t);
  assert.equal((await put(20, 2000)).status, 200);
  const stale = await put(5, 1000);
  assert.equal(stale.status, 409);
  const row = await db.prepare(`SELECT chapter, client_updated_at FROM reading_progress WHERE user_id=1 AND slug='demo'`).first();
  assert.equal(row.chapter, 20);
  assert.equal(row.client_updated_at, 2000);
});

test('C03 (D1 thật): request mới hơn ghi đè bình thường', async t => {
  const { db, put } = await setup(t);
  await put(5, 1000);
  const res = await put(20, 2000);
  assert.equal(res.status, 200);
  const row = await db.prepare(`SELECT chapter FROM reading_progress WHERE user_id=1 AND slug='demo'`).first();
  assert.equal(row.chapter, 20);
});

test('C03 (D1 thật): đọc lại chương trước (số nhỏ hơn) vẫn được lưu nếu timestamp mới hơn — KHÔNG lấy max(chapter)', async t => {
  const { db, put } = await setup(t);
  await put(20, 1000);
  const res = await put(3, 2000); // user chủ động đọc lại chương 3, timestamp mới hơn
  assert.equal(res.status, 200);
  const row = await db.prepare(`SELECT chapter FROM reading_progress WHERE user_id=1 AND slug='demo'`).first();
  assert.equal(row.chapter, 3, 'chapter phải là 3 (giá trị mới nhất theo thời gian thật), không phải max(20,3)');
});
