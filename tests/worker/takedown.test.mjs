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
    bindings: { BACKEND_URL: 'https://backend.invalid' },
    outboundService: (req) => {
      // isAdminRequest gọi BACKEND_URL/api/auth/verify — mock luôn ok để test admin path.
      if (req.url.includes('/api/auth/verify')) return new Response(null, { status: 200 });
      return new Response('External requests disabled in tests', { status: 503 });
    },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  await db.prepare(`INSERT INTO novels (slug, title, status) VALUES ('demo', 'Demo', 'completed')`).run();
  await db.prepare(`INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key) VALUES ('demo','one.md','One',1,'demo/content/x.md')`).run();
  const bucket = await mf.getR2Bucket('CHAPTERS');
  await bucket.put('demo/content/x.md', '# One\n\ncontent');
  await bucket.put('demo/synopsis.md', 'tóm tắt');
  const call = (path, init) => mf.dispatchFetch(`http://test.invalid/api/${path}`, init);
  const adminCall = (path, init = {}) => call(path, { ...init, headers: { Authorization: 'Bearer admintoken', 'Content-Type': 'application/json', ...(init.headers || {}) } });
  return { db, call, adminCall };
}

test('F03: guest bị 401 khi gọi takedown (không có quyền admin)', async t => {
  const { call } = await setup(t);
  const res = await call('admin/novels/demo/takedown', { method: 'POST', body: JSON.stringify({ reason: 'x' }) });
  assert.equal(res.status, 401);
});

test('F03: takedown ẩn truyện khỏi mọi đường đọc công khai nhưng KHÔNG xóa dữ liệu; restore phục hồi', async t => {
  const { db, call, adminCall } = await setup(t);

  const tk = await adminCall('admin/novels/demo/takedown', { method: 'POST', body: JSON.stringify({ reason: 'bản quyền' }) });
  assert.equal(tk.status, 200);
  assert.equal((await tk.json()).published, false);

  assert.equal((await call('novels/demo')).status, 404);
  assert.equal((await call('novels/demo/chapters')).status, 404);
  assert.equal((await call('novels/demo/chapters/1')).status, 404);
  assert.equal((await call('novels/demo/synopsis')).status, 404);
  assert.equal((await call('novels/demo/epub')).status, 404);
  const list = await (await call('novels')).json();
  assert.ok(!list.novels.some(n => n.slug === 'demo'));

  // Admin vẫn xem được để quản lý/restore
  const adminDetail = await adminCall('novels/demo');
  assert.equal(adminDetail.status, 200);
  assert.equal((await adminDetail.json()).published, 0);

  // Dữ liệu vẫn còn nguyên trong D1/R2 (không xóa)
  const row = await db.prepare(`SELECT title, takedown_reason FROM novels WHERE slug='demo'`).first();
  assert.equal(row.title, 'Demo');
  assert.equal(row.takedown_reason, 'bản quyền');
  const chapRow = await db.prepare(`SELECT COUNT(*) AS n FROM chapters WHERE novel_slug='demo'`).first();
  assert.equal(chapRow.n, 1);

  // Nhật ký admin action được ghi
  const action = await db.prepare(`SELECT action, slug, note FROM admin_actions WHERE slug='demo' ORDER BY id DESC LIMIT 1`).first();
  assert.equal(action.action, 'takedown');
  assert.equal(action.note, 'bản quyền');

  const restore = await adminCall('admin/novels/demo/restore', { method: 'POST' });
  assert.equal(restore.status, 200);
  assert.equal((await restore.json()).published, true);
  assert.equal((await call('novels/demo')).status, 200);
  assert.equal((await call('novels/demo/chapters')).status, 200);
});

test('F03: takedown truyện không tồn tại trả 404', async t => {
  const { adminCall } = await setup(t);
  const res = await adminCall('admin/novels/khong-ton-tai/takedown', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 404);
});

test('F03: GET /api/config trả contact_email theo env, không bịa khi chưa cấu hình', async t => {
  const { call } = await setup(t);
  const res = await call('config');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { contact_email: '' });
});
