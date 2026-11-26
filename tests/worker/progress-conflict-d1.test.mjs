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
  return { db, put, mf };
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

// Đọc bản dịch phụ (?ban=) chỉ gửi số chương + keep_paragraph: true → không
// được xoá vị trí đoạn ("N#pM") của bản mặc định nếu vẫn cùng chương.
test('keep_paragraph (D1 thật): cùng chương giữ "N#pM", khác chương ghi đè, không cờ thì ghi "N" như cũ', async t => {
  const { db, mf } = await setup(t);
  const put = body => mf.dispatchFetch('http://test.invalid/api/user/progress/demo', {
    method: 'PUT',
    headers: { Authorization: 'Bearer u_tok1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const row = () => db.prepare(`SELECT chapter, position, updated_at, client_updated_at FROM reading_progress WHERE user_id=1 AND slug='demo'`).first();

  // Chưa có tiến độ: keep_paragraph vẫn tạo dòng mới với position = "N".
  assert.equal((await put({ chapter: 5, keep_paragraph: true, client_updated_at: 500 })).status, 200);
  assert.equal((await row()).position, '5');

  assert.equal((await put({ chapter: 12, paragraph: 34, client_updated_at: 1000 })).status, 200);
  assert.equal((await row()).position, '12#p34');
  await db.prepare(`UPDATE reading_progress SET updated_at = '2000-01-01 00:00:00' WHERE user_id=1`).run();

  // Bản phụ, cùng chương 12 → giữ đoạn; thời gian + client_updated_at vẫn cập nhật.
  assert.equal((await put({ chapter: 12, keep_paragraph: true, client_updated_at: 2000 })).status, 200);
  let r = await row();
  assert.equal(r.chapter, 12);
  assert.equal(r.position, '12#p34');
  assert.notEqual(r.updated_at, '2000-01-01 00:00:00');
  assert.equal(r.client_updated_at, 2000);

  // Bản phụ sang chương 13 → ghi "13" (đoạn của chương 12 không còn đúng).
  assert.equal((await put({ chapter: 13, keep_paragraph: true, client_updated_at: 3000 })).status, 200);
  r = await row();
  assert.equal(r.chapter, 13);
  assert.equal(r.position, '13');

  // keep_paragraph không phải true (chuỗi/1) → bỏ qua cờ, ghi như cũ.
  await put({ chapter: 13, paragraph: 7, client_updated_at: 4000 });
  assert.equal((await put({ chapter: 13, keep_paragraph: 'true', client_updated_at: 5000 })).status, 200);
  assert.equal((await row()).position, '13');

  // Request cũ đến muộn vẫn bị chặn 409 dù có cờ.
  await put({ chapter: 13, paragraph: 9, client_updated_at: 6000 });
  assert.equal((await put({ chapter: 13, keep_paragraph: true, client_updated_at: 100 })).status, 409);
  assert.equal((await row()).position, '13#p9');
});
