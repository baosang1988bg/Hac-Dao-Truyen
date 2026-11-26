// Test "một truyện nhiều bản dịch" (migration 016): route /editions, mục lục +
// nội dung bản dịch phụ, POST /api/sync/edition, SEO noindex cho ?ban=.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

const KEY = 'test-sync-secret';
const HTML = '<!doctype html><html><head><title>Hắc Đạo Truyện</title><meta name="description" content="x"></head><body></body></html>';

async function loadSchema({ withMigration = true } = {}) {
  let schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  if (!withMigration) {
    // Production CHƯA chạy migration 016: không có bảng editions/edition_chapters, không có cột edition_count.
    schema = schema.replace(/\s*edition_count\s+INTEGER DEFAULT 0,/, '')
      .split(';').filter(s => !/edition_chapters|TABLE IF NOT EXISTS editions/.test(s)).join(';');
    assert.doesNotMatch(schema, /edition/);
  }
  return schema;
}

async function setup(t, { withMigration = true, bindings = {}, outbound = null } = {}) {
  const mf = new Miniflare({
    modules: true,
    script: await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-05-07',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['CHAPTERS'],
    bindings: { SYNC_KEY: KEY, ALLOW_SYNC_WRITES: 'true', SITE_ORIGIN: 'https://hacdaotruyen.com', ...bindings },
    serviceBindings: {
      ASSETS: req => ['/index.html', '/'].includes(new URL(req.url).pathname)
        ? new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        : new Response('nf', { status: 404 }),
    },
    outboundService: outbound || (() => new Response('External requests disabled in tests', { status: 503 })),
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = await loadSchema({ withMigration });
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  await db.prepare(`INSERT INTO novels (slug, title, published) VALUES ('demo', 'Demo', 1), ('hidden', 'Hidden', 0)`).run();
  const r2 = await mf.getR2Bucket('CHAPTERS');
  // Bản mặc định (AI) có 2 chương ở bảng chapters cũ.
  for (const n of [1, 2]) {
    await r2.put(`demo/content/ai${n}.md`, `# Chương ${n}\n\nBản AI ${n}`);
    await db.prepare(`INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key) VALUES ('demo', ?, ?, ?, ?)`)
      .bind(`Chuong-${n}_VI.md`, `Chương ${n}`, n, `demo/content/ai${n}.md`).run();
  }
  const call = (path, { method = 'GET', body, raw, headers = {} } = {}) => mf.dispatchFetch(`http://test.invalid/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
    body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
  });
  const page = path => mf.dispatchFetch(`http://test.invalid${path}`, { headers: { Accept: 'text/html' } });
  return { mf, db, r2, call, page };
}

const EDITION = { code: 'nhom-a', name: 'Bản dịch nhóm A', translator: 'Nhóm A', kind: 'human', license_note: 'Nhóm A cho phép đăng (email 2026-11-20)', published: true };
const chapter = (n, body = `Nội dung bản A chương ${n}`) => ({ filename: `A-${n}_VI.md`, title: `Chương ${n}: Bản A`, number: n, content: body });

function sync(call, payload, key = KEY) {
  return call('sync/edition', { method: 'POST', body: payload, headers: key === null ? {} : { 'x-sync-key': key } });
}

async function r2Keys(r2, prefix) {
  return (await r2.list({ prefix })).objects.map(o => o.key).sort();
}

test('editions: chưa có bản phụ → chỉ bản mặc định he-thong; truyện ẩn/không tồn tại 404', async t => {
  const { call } = await setup(t);
  const res = await call('novels/demo/editions');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.default, 'he-thong');
  assert.deepEqual(data.editions, [{ code: 'he-thong', name: 'Bản dịch AI (Hắc Đạo)', kind: 'ai', default: true }]);
  assert.equal((await call('novels/hidden/editions')).status, 404);
  assert.equal((await call('novels/khong-co/editions')).status, 404);
  assert.equal((await (await call('novels/demo')).json()).edition_count, 0);
});

test('sync edition: tạo bản dịch, mục lục + nội dung theo số/filename, edition_count, R2 theo hash', async t => {
  const { call, r2, db } = await setup(t);
  const res = await sync(call, { slug: 'demo', edition: EDITION, chapters: [chapter(1), chapter(2), chapter(3)] });
  assert.equal(res.status, 200, await res.clone().text());
  const out = await res.json();
  assert.equal(out.chapters_written, 3);
  assert.equal(out.edition_written, true);
  const keys = await r2Keys(r2, 'demo/ed/nhom-a/content/');
  assert.equal(keys.length, 3);
  for (const k of keys) assert.match(k, /^demo\/ed\/nhom-a\/content\/[0-9a-f]{64}\.md$/);

  const list = await (await call('novels/demo/editions')).json();
  assert.equal(list.editions.length, 2);
  assert.equal(list.editions[0].code, 'he-thong');
  assert.deepEqual({ ...list.editions[1], updated_at: undefined }, {
    code: 'nhom-a', name: 'Bản dịch nhóm A', translator: 'Nhóm A', kind: 'human',
    license_note: EDITION.license_note, chapter_count: 3, updated_at: undefined, default: false,
  });
  const chapters = await (await call('novels/demo/editions/nhom-a/chapters')).json();
  assert.deepEqual(chapters.map(c => c.chapter_number), [1, 2, 3]);
  const byNum = await (await call('novels/demo/editions/nhom-a/chapters/2')).json();
  assert.match(byNum.content, /^# Chương 2: Bản A\n\nNội dung bản A chương 2$/);
  assert.match(byNum.version, /^[0-9a-f]{16}$/);
  const byFile = await call(`novels/demo/editions/nhom-a/chapters/${encodeURIComponent('A-3_VI.md')}`);
  assert.equal(byFile.status, 200);
  assert.match((await byFile.json()).content, /chương 3/);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/99')).status, 404);
  // Không fallback sang bản mặc định / catalog: bản mặc định qua route edition → 404.
  assert.equal((await call('novels/demo/editions/he-thong/chapters')).status, 404);
  assert.equal((await call('novels/demo/editions/he-thong/chapters/1')).status, 404);
  assert.equal((await call('novels/demo/editions/NHOM-A/chapters/1')).status, 404);

  const { edition_count } = await db.prepare(`SELECT edition_count FROM novels WHERE slug='demo'`).first();
  assert.equal(edition_count, 1);
  assert.equal((await (await call('novels/demo')).json()).edition_count, 1);
});

test('route cũ giữ nguyên: mục lục + nội dung chương mặc định không đổi byte sau khi có bản dịch phụ', async t => {
  const { call } = await setup(t);
  const snapshot = async () => {
    const out = {};
    for (const p of ['novels/demo/chapters', 'novels/demo/chapters/1', `novels/demo/chapters/${encodeURIComponent('Chuong-2_VI.md')}`]) {
      const res = await call(p, { headers: { Authorization: 'Bearer x' } }); // bypass edge cache → đọc thật
      out[p] = [res.status, await res.text()];
    }
    return out;
  };
  const before = await snapshot();
  assert.equal(before['novels/demo/chapters/1'][0], 200);
  assert.match(before['novels/demo/chapters/1'][1], /Bản AI 1/);
  assert.equal((await sync(call, { slug: 'demo', edition: EDITION, chapters: [chapter(1), chapter(2)] })).status, 200);
  assert.deepEqual(await snapshot(), before);
  // Route cũ với identifier lạ chứa "editions" vẫn đi đường cũ (không bị route mới nuốt).
  assert.equal((await call('novels/demo/chapters/editions')).status, 404);
});

test('sync idempotent: gửi lại cùng nội dung không ghi R2/D1; sửa 1 chương chỉ ghi chương đó', async t => {
  const { call, r2, db } = await setup(t);
  const payload = { slug: 'demo', edition: EDITION, chapters: [chapter(1), chapter(2)] };
  assert.equal((await sync(call, payload)).status, 200);
  const keys1 = await r2Keys(r2, 'demo/ed/');
  const ed1 = await db.prepare(`SELECT updated_at, chapter_count FROM editions`).first();
  const again = await (await sync(call, payload)).json();
  assert.deepEqual(again, { success: true, slug: 'demo', code: 'nhom-a', chapters_synced: 2, chapters_written: 0, edition_written: false });
  assert.deepEqual(await r2Keys(r2, 'demo/ed/'), keys1);
  assert.deepEqual(await db.prepare(`SELECT updated_at, chapter_count FROM editions`).first(), ed1);

  const edited = await (await sync(call, { ...payload, chapters: [chapter(1), chapter(2, 'Bản sửa')] })).json();
  assert.equal(edited.chapters_written, 1);
  assert.equal(edited.edition_written, false);
  assert.equal((await r2Keys(r2, 'demo/ed/')).length, 3); // object cũ giữ lại (bất biến), thêm object mới
  const c2 = await (await call('novels/demo/editions/nhom-a/chapters/2', { headers: { Authorization: 'x' } })).json();
  assert.match(c2.content, /Bản sửa$/);
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM edition_chapters`).first();
  assert.equal(n, 2);
});

test('bản dịch unpublished → 404 ở mọi route, không vào /editions, edition_count = 0', async t => {
  const { call, db } = await setup(t);
  assert.equal((await sync(call, { slug: 'demo', edition: { ...EDITION, published: false }, chapters: [chapter(1)] })).status, 200);
  assert.equal((await (await call('novels/demo/editions')).json()).editions.length, 1);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters')).status, 404);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/1')).status, 404);
  assert.equal((await db.prepare(`SELECT edition_count FROM novels WHERE slug='demo'`).first()).edition_count, 0);
  // Bật published (không đổi chương) → hiện ra, edition_count = 1.
  const on = await (await sync(call, { slug: 'demo', edition: EDITION, chapters: [] })).json();
  assert.equal(on.edition_written, true);
  assert.equal(on.chapters_written, 0);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/1')).status, 200);
  assert.equal((await db.prepare(`SELECT edition_count FROM novels WHERE slug='demo'`).first()).edition_count, 1);
  // Gửi lô không kèm published → giữ nguyên trạng thái đang có.
  const { published, ...noPublished } = EDITION;
  assert.equal(published, true);
  assert.equal((await (await sync(call, { slug: 'demo', edition: noPublished, chapters: [chapter(1)] })).json()).edition_written, false);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/1')).status, 200);
});

test('takedown truyện chặn cả bản dịch phụ, kể cả nội dung đã nằm trong edge cache', async t => {
  const { call, db } = await setup(t);
  assert.equal((await sync(call, { slug: 'demo', edition: EDITION, chapters: [chapter(1)] })).status, 200);
  const first = await call('novels/demo/editions/nhom-a/chapters/1');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Worker-Cache'), 'MISS');
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/1')).headers.get('X-Worker-Cache'), 'HIT');
  await db.prepare(`UPDATE novels SET published = 0 WHERE slug = 'demo'`).run();
  const blocked = await call('novels/demo/editions/nhom-a/chapters/1');
  assert.equal(blocked.status, 404);
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store');
  await db.prepare(`UPDATE novels SET published = 1 WHERE slug = 'demo'`).run();
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/1')).status, 200);
});

test('takedown qua admin purge /editions + mục lục từng bản dịch phụ', async t => {
  // Admin xác thực qua backend /api/auth/verify → giả lập backend chấp nhận 'admin-token'.
  const outbound = req => new Response(null, {
    status: new URL(req.url).pathname === '/api/auth/verify' && req.headers.get('Authorization') === 'Bearer admin-token' ? 200 : 401,
  });
  const { call } = await setup(t, { bindings: { BACKEND_URL: 'http://backend.test' }, outbound });
  assert.equal((await sync(call, { slug: 'demo', edition: EDITION, chapters: [chapter(1)] })).status, 200);
  for (const p of ['novels/demo/editions', 'novels/demo/editions/nhom-a/chapters']) {
    assert.equal((await call(p)).status, 200);
    assert.equal((await call(p)).headers.get('X-Worker-Cache'), 'HIT', p);
  }
  const res = await call('admin/novels/demo/takedown', { method: 'POST', body: { reason: 'test' }, headers: { Authorization: 'Bearer admin-token' } });
  assert.equal(res.status, 200, await res.clone().text());
  // Cache đã bị purge → đọc lại D1 → truyện đã gỡ → 404 (không còn HIT cũ).
  assert.equal((await call('novels/demo/editions')).status, 404);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters')).status, 404);
});

test('ẩn bản dịch qua sync/edition: chương đã nằm trong edge cache cũng 404 (purge + xoá memo)', async t => {
  const { call } = await setup(t);
  assert.equal((await sync(call, { slug: 'demo', edition: EDITION, chapters: [chapter(1), chapter(2)] })).status, 200);
  // Làm nóng cache: theo số chương và theo filename.
  const paths = ['novels/demo/editions/nhom-a/chapters/1', 'novels/demo/editions/nhom-a/chapters/2',
    `novels/demo/editions/nhom-a/chapters/${encodeURIComponent('A-1_VI.md')}`, 'novels/demo/editions/nhom-a/chapters'];
  for (const p of paths) {
    assert.equal((await call(p)).status, 200, p);
    assert.equal((await call(p)).headers.get('X-Worker-Cache'), 'HIT', p);
  }
  // Ẩn bản dịch, KHÔNG gửi chương nào (chỉ đổi published).
  const off = await (await sync(call, { slug: 'demo', edition: { ...EDITION, published: false }, chapters: [] })).json();
  assert.equal(off.edition_written, true);
  for (const p of paths) {
    const r = await call(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get('Cache-Control'), 'no-store', p);
  }
  // Bật lại → đọc được ngay (memo đã bị xoá, 404 không bao giờ được cache).
  assert.equal((await sync(call, { slug: 'demo', edition: EDITION, chapters: [] })).status, 200);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/1')).status, 200);
});

test('nội dung chương bản phụ: HIT edge cache không truy vấn bảng editions (chỉ novels theo PK)', async t => {
  const { call, db } = await setup(t);
  assert.equal((await sync(call, { slug: 'demo', edition: EDITION, chapters: [chapter(1)] })).status, 200);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/1')).headers.get('X-Worker-Cache'), 'MISS');
  // Đổi tên bảng editions: nếu đường HIT còn chạm editions thì sẽ 404/500.
  await db.prepare('ALTER TABLE editions RENAME TO editions_tmp').run();
  const hit = await call('novels/demo/editions/nhom-a/chapters/1');
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get('X-Worker-Cache'), 'HIT');
  await db.prepare('ALTER TABLE editions_tmp RENAME TO editions').run();
  // Truyện không tồn tại / code sai định dạng → 404 no-store, không chạm cache.
  assert.equal((await call('novels/khong-co/editions/nhom-a/chapters/1')).status, 404);
  assert.equal((await call('novels/demo/editions/he-thong/chapters/1')).status, 404);
  assert.equal((await call('novels/hidden/editions/nhom-a/chapters/1')).status, 404);
});

test('trước migration 016: /editions chỉ bản mặc định, route bản phụ 404, sync 503, chi tiết truyện edition_count 0 — không 500', async t => {
  const { call } = await setup(t, { withMigration: false });
  const data = await (await call('novels/demo/editions')).json();
  assert.deepEqual(data.editions.map(e => e.code), ['he-thong']);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters')).status, 404);
  assert.equal((await call('novels/demo/editions/nhom-a/chapters/1')).status, 404);
  assert.equal((await sync(call, { slug: 'demo', edition: EDITION, chapters: [chapter(1)] })).status, 503);
  const novel = await call('novels/demo');
  assert.equal(novel.status, 200);
  assert.equal((await novel.json()).edition_count, 0);
  assert.equal((await call('novels/demo/chapters/1')).status, 200);
});

test('sync edition: sai/thiếu SYNC_KEY 401, tắt ALLOW_SYNC_WRITES 503, payload > 2 MB 413, dữ liệu sai 400', async t => {
  const { call } = await setup(t);
  const ok = { slug: 'demo', edition: EDITION, chapters: [chapter(1)] };
  assert.equal((await sync(call, ok, 'sai-key')).status, 401);
  assert.equal((await sync(call, ok, null)).status, 401);
  const big = JSON.stringify({ ...ok, chapters: [chapter(1, 'x'.repeat(2 * 1024 * 1024 + 10))] });
  assert.equal((await call('sync/edition', { method: 'POST', raw: big, headers: { 'x-sync-key': KEY } })).status, 413);
  const bad = async (payload, label) => assert.equal((await sync(call, payload)).status, 400, label);
  await bad({ ...ok, edition: { ...EDITION, code: 'he-thong' } }, 'cấm code mặc định');
  await bad({ ...ok, edition: { ...EDITION, code: 'Nhom_A' } }, 'code sai ký tự');
  await bad({ ...ok, edition: { ...EDITION, code: 'a'.repeat(41) } }, 'code quá dài');
  await bad({ ...ok, edition: { ...EDITION, license_note: '  ' } }, 'thiếu license_note');
  await bad({ ...ok, edition: { ...EDITION, kind: 'pirate' } }, 'kind lạ');
  await bad({ ...ok, edition: { ...EDITION, published: 'yes' } }, 'published không phải boolean');
  await bad({ ...ok, slug: 'Bad Slug' }, 'slug sai');
  await bad({ ...ok, chapters: Array.from({ length: 26 }, (_, i) => chapter(i + 1)) }, '> 25 chương');
  await bad({ ...ok, chapters: [chapter(1), chapter(1)] }, 'trùng filename');
  await bad({ ...ok, chapters: [{ ...chapter(1), filename: '../x.md' }] }, 'filename có /');
  await bad({ ...ok, chapters: [{ ...chapter(1), content: '   ' }] }, 'nội dung rỗng');
  assert.equal((await sync(call, { ...ok, slug: 'khong-co' })).status, 404);
});

test('sync edition: ALLOW_SYNC_WRITES khác "true" → 503 kể cả đúng key', async t => {
  const { call } = await setup(t, { bindings: { ALLOW_SYNC_WRITES: 'false' } });
  assert.equal((await sync(call, { slug: 'demo', edition: EDITION, chapters: [chapter(1)] })).status, 503);
});

test('SEO: ?ban=<bản phụ> thêm noindex, canonical vẫn về bản mặc định; không có ban / ban=he-thong thì không', async t => {
  const { page } = await setup(t);
  const alt = await (await page('/novel/demo/read/3?ban=nhom-a')).text();
  assert.match(alt, /<meta name="robots" content="noindex, follow" \/>/);
  assert.match(alt, /rel="canonical" href="https:\/\/hacdaotruyen\.com\/novel\/demo\/read\/3"/);
  const altNovel = await (await page('/novel/demo?ban=nhom-a')).text();
  assert.match(altNovel, /noindex, follow/);
  assert.match(altNovel, /rel="canonical" href="https:\/\/hacdaotruyen\.com\/novel\/demo"/);
  for (const p of ['/novel/demo/read/3', '/novel/demo/read/3?ban=he-thong', '/novel/demo?ban=']) {
    const html = await (await page(p)).text();
    assert.doesNotMatch(html, /name="robots"/, p);
    assert.match(html, /rel="canonical"/, p);
  }
});
