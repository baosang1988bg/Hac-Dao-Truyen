import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

// GET /api/updates chạy trên D1 thật (Miniflare): kiểm tra SQL gom nhóm theo
// (truyện, ngày giờ VN), loại truyện đã gỡ, bỏ chương ngoài cửa sổ 7 ngày.
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
  await db.batch([
    db.prepare(`INSERT INTO novels (slug, title, author) VALUES ('alpha', 'Alpha Truyện', 'Tác giả A')`),
    db.prepare(`INSERT INTO novels (slug, title) VALUES ('beta', 'Beta Truyện')`),
    db.prepare(`INSERT INTO novels (slug, title, published) VALUES ('hidden', 'Đã gỡ', 0)`),
  ]);
  const ch = (slug, n, ago) => db.prepare(
    `INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
  ).bind(slug, `${n}_VI.md`, `Chương ${n}: Tiêu đề ${n}`, n, `${slug}/${n}_VI.md`, ago);
  return { mf, db, ch };
}

const get = (mf) => mf.dispatchFetch('http://test.invalid/api/updates');

test('updates: gom chương mới theo truyện, sắp xếp mới nhất trước, kèm tiêu đề chương cuối', async t => {
  const { mf, db, ch } = await setup(t);
  await db.batch([
    ch('alpha', 10, '-3 hours'), ch('alpha', 11, '-2 hours'), ch('alpha', 12, '-1 hours'),
    ch('beta', 1, '-30 minutes'), ch('beta', 2, '-30 minutes'),
    ch('hidden', 5, '-10 minutes'),
    ch('alpha', 3, '-30 days'), // ngoài cửa sổ 7 ngày
  ]);
  const res = await get(mf);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.window_days, 7);
  assert.equal(body.items.length, 2, 'truyện đã gỡ và chương cũ không được xuất hiện');
  const [first, second] = body.items;
  assert.equal(first.slug, 'beta');
  assert.equal(first.count, 2);
  assert.equal(first.is_new_novel, true, 'lô bắt đầu từ chương 1 = truyện mới lên');
  assert.equal(second.slug, 'alpha');
  assert.equal(second.from_chapter, 10);
  assert.equal(second.to_chapter, 12);
  assert.equal(second.count, 3);
  assert.equal(second.latest_title, 'Chương 12: Tiêu đề 12');
  assert.equal(second.author, 'Tác giả A');
  assert.equal(second.is_new_novel, false);
  assert.match(second.last_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(second.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(body.summary, { novels_updated: 2, new_chapters: 5 });
  assert.equal(body.truncated, false);
});

test('updates: không có chương mới → danh sách rỗng, vẫn 200', async t => {
  const { mf } = await setup(t);
  const res = await get(mf);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.items, []);
  assert.deepEqual(body.summary, { novels_updated: 0, new_chapters: 0 });
});

test('updates: cùng truyện khác ngày (giờ VN) tách thành 2 nhóm', async t => {
  const { mf, db, ch } = await setup(t);
  await db.batch([ch('alpha', 20, '-1 hours'), ch('alpha', 19, '-3 days')]);
  const body = await (await get(mf)).json();
  assert.equal(body.items.length, 2);
  assert.notEqual(body.items[0].day, body.items[1].day);
  assert.equal(body.items[0].to_chapter, 20);
  assert.deepEqual(body.summary, { novels_updated: 1, new_chapters: 2 });
});

test('updates: chương số 0 (lời tác giả) không làm truyện cũ bị gắn nhãn "Truyện mới"', async t => {
  const { mf, db, ch } = await setup(t);
  await db.batch([ch('alpha', 0, '-2 hours'), ch('alpha', 41, '-1 hours')]);
  const body = await (await get(mf)).json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].from_chapter, 41);
  assert.equal(body.items[0].is_new_novel, false);
  assert.equal(body.items[0].count, 2);
});

test('updates: route chỉ nhận GET, có header cache công khai', async t => {
  const { mf } = await setup(t);
  const res = await get(mf);
  assert.match(res.headers.get('Cache-Control') || '', /public, max-age=300/);
  const post = await mf.dispatchFetch('http://test.invalid/api/updates', { method: 'POST' });
  assert.notEqual(post.status, 200);
});

test('updates: query plan dùng index idx_chapters_created (không quét toàn bảng)', async t => {
  const { db } = await setup(t);
  const { results } = await db.prepare(
    `EXPLAIN QUERY PLAN SELECT novel_slug FROM chapters WHERE created_at >= datetime('now','-7 days')`
  ).all();
  const plan = results.map(r => r.detail).join(' | ');
  assert.match(plan, /idx_chapters_created/, plan);
});
