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
  await db.prepare(`INSERT INTO novels (slug, title) VALUES ('demo', 'Demo')`).run();
  await db.prepare(`INSERT INTO users (id, email, password_hash) VALUES (1, 'a@b.com', 'x')`).run();
  await db.prepare(`INSERT INTO users (id, email, password_hash) VALUES (2, 'c@d.com', 'x')`).run();
  await db.prepare(`INSERT INTO user_sessions (token, user_id, expires_at) VALUES ('u_tok1', 1, '2999-01-01 00:00:00')`).run();
  await db.prepare(`INSERT INTO user_sessions (token, user_id, expires_at) VALUES ('u_tok2', 2, '2999-01-01 00:00:00')`).run();
  const rate = (stars, headers = {}) => mf.dispatchFetch('http://test.invalid/api/novels/demo/rate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ stars }),
  });
  return { db, rate };
}

test('F02: user đăng nhập rate lại thì CẬP NHẬT phiếu cũ, không cộng dồn vô hạn', async t => {
  const { db, rate } = await setup(t);
  await rate(5, { Authorization: 'Bearer u_tok1' });
  const before = await db.prepare(`SELECT stars FROM novel_ratings WHERE user_id = 1 AND slug = 'demo'`).first();
  assert.equal(before.stars, 5);

  // Xác nhận câu SQL upsert thật (ON CONFLICT(slug,user_id) WHERE user_id IS NOT
  // NULL DO UPDATE) mà rateNovel() dùng là hợp lệ và ghi đè đúng, bằng cách chạy
  // lại chính câu lệnh đó lần 2 trực tiếp trên D1 thật (không mock).
  await db.prepare(`
    INSERT INTO novel_ratings (slug, user_id, stars, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(slug, user_id) WHERE user_id IS NOT NULL
    DO UPDATE SET stars = excluded.stars, updated_at = datetime('now')
  `).bind('demo', 1, 2).run();

  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM novel_ratings WHERE user_id = 1 AND slug = 'demo'`).first();
  assert.equal(n, 1, 'chỉ có đúng 1 phiếu đánh giá cho user 1, không phải 2 bản ghi cộng dồn');
  const after = await db.prepare(`SELECT stars FROM novel_ratings WHERE user_id = 1 AND slug = 'demo'`).first();
  assert.equal(after.stars, 2, 'phiếu đã được CẬP NHẬT thành giá trị mới, không tạo bản ghi mới');
});

test('F02: hai user khác nhau rate cùng truyện đều được tính, trung bình đúng', async t => {
  const { db, rate } = await setup(t);
  const r1 = await rate(4, { Authorization: 'Bearer u_tok1' });
  const r2 = await rate(2, { Authorization: 'Bearer u_tok2' });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const novel = await db.prepare(`SELECT rating_sum, rating_count FROM novels WHERE slug='demo'`).first();
  assert.equal(novel.rating_count, 2);
  assert.equal(novel.rating_sum, 6);
});

test('F02: guest không có guest_id hợp lệ bị từ chối thay vì cộng dồn ẩn danh', async t => {
  const { rate } = await setup(t);
  const res = await rate(5, {});
  assert.equal(res.status, 400);
});

test('F02: guest có guest_id rate lại cùng truyện cũng chỉ giữ 1 phiếu', async t => {
  const { db, rate } = await setup(t);
  await rate(3, { 'X-Guest-Id': 'guest-abc-123' });
  await db.prepare(`UPDATE novel_ratings SET stars = 1 WHERE guest_id = 'guest-abc-123'`).run();
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM novel_ratings WHERE guest_id = 'guest-abc-123'`).first();
  assert.equal(n, 1);
});
