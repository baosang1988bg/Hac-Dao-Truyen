// Test cho đợt nâng cấp backend 2026-10: cache asset/chương, chỉ mục Drive,
// thể loại, slugs=, synopsis_short, title_is_slug, translated_chapters, siết
// bảo mật route công khai, robots/sitemap/SEO, index D1 mới.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { loadWorker } from './harness.mjs';

const INDEX_HTML = '<!doctype html><html lang="vi"><head><meta charset="UTF-8" /><title>Hắc Đạo Truyện</title>'
  + '<meta name="description" content="Mặc định site" /><meta property="og:title" content="Hắc Đạo Truyện" />'
  + '<meta property="og:type" content="website" /><link rel="canonical" href="https://hacdaotruyen.com/" />'
  + '</head><body><div id="root"></div></body></html>';

// ASSETS giả: chỉ có vài file, còn lại 404 như binding thật.
function fakeAssets(extra = {}) {
  const files = {
    '/index.html': [INDEX_HTML, 'text/html; charset=utf-8'],
    '/': [INDEX_HTML, 'text/html; charset=utf-8'],
    '/assets/app-abc123.js': ['console.log(1)', 'application/javascript'],
    '/sw.js': ['self.x=1', 'application/javascript'],
    '/manifest.webmanifest': ['{}', 'application/manifest+json'],
    '/icon-192.svg': ['<svg/>', 'image/svg+xml'],
    ...extra,
  };
  return async request => {
    const path = new URL(request.url).pathname;
    const file = files[path];
    if (!file) return new Response('nope', { status: 404 });
    return new Response(file[0], { headers: { 'Content-Type': file[1] } });
  };
}

async function setupMf(t, { bindings = {}, outbound } = {}) {
  const mf = new Miniflare({
    modules: true,
    script: await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-05-07',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['CHAPTERS'],
    bindings: { SYNC_KEY: 'test-secret', ALLOW_SYNC_WRITES: 'true', ...bindings },
    serviceBindings: { ASSETS: fakeAssets() },
    outboundService: outbound || (() => new Response('External requests disabled in tests', { status: 503 })),
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  const bucket = await mf.getR2Bucket('CHAPTERS');
  const raw = (path, init) => mf.dispatchFetch(`http://test.invalid${path}`, init);
  const call = (path, init) => raw(`/api/${path}`, init);
  return { mf, db, bucket, raw, call };
}

// ── 1. Asset tĩnh ────────────────────────────────────────────────────────────
test('asset tĩnh: /assets/* bất biến, asset thiếu 404 thật, SPA/sw.js no-cache, manifest/icon 1 ngày', async () => {
  const worker = await loadWorker();
  const env = { ASSETS: { fetch: fakeAssets() } };
  const get = path => worker.fetch(new Request(`https://test.invalid${path}`), env, {});

  const asset = await get('/assets/app-abc123.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');

  const missing = await get('/assets/old-hash.js');
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /<html/i, '/assets/* thiếu KHÔNG được fallback index.html');
  assert.notEqual(missing.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');

  const spa = await get('/library');
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /<div id="root">/);
  assert.equal(spa.headers.get('Cache-Control'), 'no-cache');

  assert.equal((await get('/')).headers.get('Cache-Control'), 'no-cache');
  assert.equal((await get('/sw.js')).headers.get('Cache-Control'), 'no-cache');
  assert.equal((await get('/manifest.webmanifest')).headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal((await get('/icon-192.svg')).headers.get('Cache-Control'), 'public, max-age=86400');
});

// ── 2. Cache nội dung chương ─────────────────────────────────────────────────
test('chương: Cache-Control công khai + edge cache, sync sửa chương purge cache, takedown không cache', async t => {
  const { db, call } = await setupMf(t);
  const sync = chapters => call('admin/sync-novel', { method: 'POST', headers: { 'x-sync-key': 'test-secret' },
    body: JSON.stringify({ slug: 'demo', title: 'Demo', chapters, is_first_chunk: true }) });
  assert.equal((await sync([{ filename: 'c1.md', title: 'Chương 1', number: 1, content: '# Chương 1\n\nbản đầu' }])).status, 200);

  const first = await call('novels/demo/chapters/1');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=3600');
  assert.match((await first.json()).content, /bản đầu/);
  const second = await call('novels/demo/chapters/1');
  assert.equal(second.headers.get('X-Worker-Cache'), 'HIT');
  await second.arrayBuffer();

  // Chương chưa có → 404 không cache (chương mới đăng phải hiện ngay).
  const notYet = await call('novels/demo/chapters/2');
  assert.equal(notYet.status, 404);
  assert.equal(notYet.headers.get('Cache-Control'), 'no-store');
  await notYet.arrayBuffer();

  // Sửa chương 1 → purge → đọc lại ra bản mới (không kẹt bản cache cũ).
  const { r2_key } = await db.prepare(`SELECT r2_key FROM chapters WHERE filename='c1.md'`).first();
  assert.equal((await sync([{ filename: 'c1.md', title: 'Chương 1', number: 1, content: '# Chương 1\n\nbản sửa', expected_r2_key: r2_key }])).status, 200);
  const fixed = await call('novels/demo/chapters/1');
  assert.match((await fixed.json()).content, /bản sửa/);

  // Takedown: kể cả khi edge còn bản cache, request mới phải 404 + no-store.
  await db.prepare(`UPDATE novels SET published = 0 WHERE slug='demo'`).run();
  const gone = await call('novels/demo/chapters/1');
  assert.equal(gone.status, 404);
  assert.equal(gone.headers.get('Cache-Control'), 'no-store');
  await gone.arrayBuffer();

  assert.equal((await call('novels/BAD_SLUG/chapters/1')).status, 404);
});

// ── 3. Chỉ mục Drive (upload_state.json) ─────────────────────────────────────
test('Drive fallback: upload_state.json chỉ đọc 1 lần/isolate, slug lạ không gọi Drive, slug hỏng không chạm R2', async t => {
  const worker = await loadWorker();
  let stateReads = 0;
  let driveCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    driveCalls++;
    return Response.json([{ filename: 'Chương 1.md', number: 1, title: 'Chương 1', content: 'body' }]);
  });
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }) },
    CHAPTERS: {
      get: async key => {
        if (key === 'upload_state.json') {
          stateReads++;
          return { json: async () => ({ uploaded: { demo: { files: { chapters: { id: 'drive-file-1' } } }, other: { files: {} } } }) };
        }
        return null;
      },
    },
  };
  const get = path => worker.fetch(new Request(`https://test.invalid/api/novels/${path}`), env, {});
  for (let i = 0; i < 3; i++) {
    const res = await get('demo/chapters/1');
    assert.equal(res.status, 200);
    assert.match((await res.json()).content, /body/);
  }
  assert.equal(stateReads, 1, 'chỉ mục slug→id được giữ trong isolate');
  assert.equal(driveCalls, 1, 'chapters.json đã parse được giữ trong LRU');

  assert.equal((await get('khong-co-trong-map/chapters/1')).status, 404);
  assert.equal(driveCalls, 1, 'slug không có trong chỉ mục → không gọi Drive');

  assert.equal((await get('Bad..Slug/chapters/1')).status, 404);
  assert.equal(stateReads, 1);

  // Mục lục fallback Drive dùng chung chỉ mục.
  const list = await get('demo/chapters');
  assert.deepEqual((await list.json()).map(c => c.chapter_number), [1]);
  assert.equal(stateReads, 1);
});

// ── 4/5/6/7. Thể loại, slugs=, synopsis_short, title_is_slug, stats ─────────
async function seedNovels(db) {
  const credit = 'Epub tạo bởi audiotruyenfull.org\nNguồn: audiotruyenfull.org\n';
  await db.batch([
    db.prepare(`INSERT INTO novels (slug, title, genre, synopsis, updated_at) VALUES ('tu-a', 'Tu A', 'cultivation', ?, '2026-10-01 00:00:00')`)
      .bind(credit + 'Thiếu niên bước lên con đường tu luyện. ' + 'Rất dài. '.repeat(80)),
    db.prepare(`INSERT INTO novels (slug, title, genre, updated_at) VALUES ('tien-b', 'Tiên B', 'Tiên Hiệp, Hệ Thống', '2026-10-02 00:00:00')`),
    db.prepare(`INSERT INTO novels (slug, title, genre, updated_at) VALUES ('tu-c', 'tu-c', 'Tu Tiên', '2026-10-03 00:00:00')`),
    db.prepare(`INSERT INTO novels (slug, title, genre) VALUES ('khac-d', 'Khác D', 'other')`),
    db.prepare(`INSERT INTO novels (slug, title, genre) VALUES ('unk-e', 'Unk E', 'Unknown')`),
    db.prepare(`INSERT INTO novels (slug, title, genre, published) VALUES ('an-f', 'Ẩn F', 'Đô Thị', 0)`),
    db.prepare(`INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key) VALUES ('tu-a','1.md','Chương 1',1,'k1')`),
    db.prepare(`INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key) VALUES ('tu-a','2.md','Chương 2',2,'k2')`),
    db.prepare(`INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key) VALUES ('tien-b','1.md','Chương 1',1,'k3')`),
    db.prepare(`INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key) VALUES ('tien-b','note.md','Lời tác giả',0,'k4')`),
  ]);
}

test('genres: tách dấu phẩy, bỏ trùng, ánh xạ tiếng Việt, bỏ Unknown + truyện ẩn; lọc genre khớp cả giá trị thô', async t => {
  const { db, call } = await setupMf(t);
  await seedNovels(db);
  const genres = await (await call('novels/genres')).json();
  assert.deepEqual(genres, ['Hệ Thống', 'Tiên Hiệp', 'Tu Tiên', 'Khác']);

  const tu = await (await call(`novels?genre=${encodeURIComponent('Tu Tiên')}`)).json();
  assert.deepEqual(tu.novels.map(n => n.slug).sort(), ['tu-a', 'tu-c']);
  const other = await (await call(`novels?genre=${encodeURIComponent('Khác')}`)).json();
  assert.deepEqual(other.novels.map(n => n.slug), ['khac-d']);
  // Giá trị cũ (chuỗi thô) vẫn lọc được như trước.
  const legacy = await (await call('novels?genre=Hệ%20Thống')).json();
  assert.deepEqual(legacy.novels.map(n => n.slug), ['tien-b']);
});

test('novels: slugs= giữ thứ tự, bỏ slug hỏng/ẩn; synopsis_short sạch ≤280; chapter_count đúng mọi kiểu sort', async t => {
  const { db, call } = await setupMf(t);
  await seedNovels(db);
  const res = await (await call('novels?slugs=tien-b,BAD!,an-f,tu-a,tien-b')).json();
  assert.deepEqual(res.novels.map(n => n.slug), ['tien-b', 'tu-a']);
  assert.equal(res.total, 2);
  assert.deepEqual(Object.keys(res).sort(), ['limit', 'novels', 'page', 'pages', 'total']);
  const tuA = res.novels.find(n => n.slug === 'tu-a');
  assert.ok(tuA.synopsis_short.length <= 280);
  assert.doesNotMatch(tuA.synopsis_short, /audiotruyenfull|Epub tạo bởi|Nguồn:/);
  assert.match(tuA.synopsis_short, /^Thiếu niên bước lên/);
  assert.equal(tuA.chapter_count, 2);
  assert.equal(tuA.latest_chapter_title, 'Chương 2');
  assert.equal(res.novels.find(n => n.slug === 'tien-b').chapter_count, 1);
  assert.equal(res.novels[0].synopsis_short, '');

  const empty = await (await call('novels?slugs=BAD!')).json();
  assert.deepEqual(empty, { novels: [], total: 0, page: 1, limit: 48, pages: 0 });

  const many = Array.from({ length: 30 }, (_, i) => `s${i}`).join(',');
  assert.equal((await call(`novels?slugs=${many}`)).status, 200);

  for (const sort of ['updated_at', 'chapter_count', 'views', 'title', 'rating']) {
    const list = await (await call(`novels?sort=${sort}`)).json();
    const a = list.novels.find(n => n.slug === 'tu-a');
    assert.equal(a.chapter_count, 2, `sort=${sort}`);
    assert.equal(a.latest_chapter_title, 'Chương 2', `sort=${sort}`);
  }
  const byCount = await (await call('novels?sort=chapter_count')).json();
  assert.equal(byCount.novels[0].slug, 'tu-a');
});

test('edge cache key /api/novels phân biệt slugs=', async t => {
  const store = new Map();
  const original = globalThis.caches;
  globalThis.caches = { default: {
    async match(r) { const x = store.get(r.url); return x ? x.clone() : undefined; },
    async put(r, res) { store.set(r.url, res.clone()); },
    async delete(r) { return store.delete(r.url); },
  } };
  t.after(() => { if (original === undefined) delete globalThis.caches; else globalThis.caches = original; });
  const worker = await loadWorker();
  const seen = [];
  const env = { DB: { prepare: sql => ({ bind: (...b) => ({
    first: async () => ({ cnt: 0 }),
    all: async () => { seen.push(b); return { results: [] }; },
  }) }) } };
  const a = await worker.fetch(new Request('https://t.invalid/api/novels?slugs=aa,bb'), env, {});
  const b = await worker.fetch(new Request('https://t.invalid/api/novels?slugs=cc'), env, {});
  assert.equal(a.headers.get('X-Worker-Cache'), 'MISS');
  assert.equal(b.headers.get('X-Worker-Cache'), 'MISS');
  assert.ok([...store.keys()].some(k => k.includes('slugs=aa%2Cbb')));
});

test('novel detail: title_is_slug + synopsis bỏ dòng ghi công; /synopsis cũng lọc', async t => {
  const { db, bucket, call } = await setupMf(t);
  await seedNovels(db);
  const c = await (await call('novels/tu-c')).json();
  assert.equal(c.title, 'tu-c');
  assert.equal(c.title_is_slug, true);
  const a = await (await call('novels/tu-a')).json();
  assert.equal(a.title_is_slug, false);
  assert.doesNotMatch(a.synopsis, /audiotruyenfull|Nguồn:/);
  assert.match(a.synopsis, /^Thiếu niên/);
  assert.ok(a.synopsis_short.length <= 280);
  await bucket.put('tu-a/synopsis.md', 'Epub tạo bởi AudioTruyenFull\nNội dung thật');
  assert.equal((await (await call('novels/tu-a/synopsis')).json()).synopsis, 'Nội dung thật');
  // Khối thông tin đầu sách (nhãn đứng riêng / nhãn: giá trị ngắn) bị bỏ, câu văn thường giữ nguyên.
  await bucket.put('tu-a/synopsis.md', 'Tác giả\nTác giả: Kỳ Khai\nThể loại: Huyền Huyễn\nTác giả của bộ truyện này viết rất hay.\nNội dung thật');
  assert.equal((await (await call('novels/tu-a/synopsis')).json()).synopsis, 'Tác giả của bộ truyện này viết rất hay.\nNội dung thật');
});

test('stats: giữ khoá cũ + translated_chapters đếm chương thật (chapter_number > 0)', async t => {
  const { db, call } = await setupMf(t);
  await seedNovels(db);
  const stats = await (await call('stats')).json();
  assert.equal(stats.total_novels, 5);
  assert.equal(stats.translated_chapters, 3);
  for (const k of ['total_chapters', 'total_glossary']) assert.ok(k in stats);
});

// ── 8. Bảo mật / validate ───────────────────────────────────────────────────
test('view/rate/comments: 404 khi slug hỏng, không tồn tại hoặc truyện bị gỡ', async t => {
  const { db, call } = await setupMf(t);
  await seedNovels(db);
  await db.prepare(`INSERT INTO users (id, email, password_hash) VALUES (1, 'a@b.com', 'x')`).run();
  await db.prepare(`INSERT INTO user_sessions (token, user_id, expires_at) VALUES ('u_tok', 1, '2999-01-01 00:00:00')`).run();
  const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

  assert.equal((await post('novels/tu-a/view')).status, 200);
  for (const slug of ['missing', 'an-f', 'BAD_SLUG']) {
    assert.equal((await post(`novels/${slug}/view`)).status, 404, `view ${slug}`);
    assert.equal((await post(`novels/${slug}/rate`, { stars: 5 }, { 'X-Guest-Id': 'g1' })).status, 404, `rate ${slug}`);
  }
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM novel_ratings`).first();
  assert.equal(n, 0);

  assert.equal((await call('novels/an-f/comments')).status, 404);
  assert.equal((await call('novels/tu-a/comments')).status, 200);
  assert.equal((await post('novels/an-f/comments', { content: 'hi' }, { Authorization: 'Bearer u_tok' })).status, 404);
  assert.equal((await post('novels/tu-a/comments', { content: 'hi' }, { Authorization: 'Bearer u_tok' })).status, 201);
});

test('CORS cho phép X-Guest-Id; 404 không echo path', async () => {
  const worker = await loadWorker();
  const pre = await worker.fetch(new Request('https://t.invalid/api/novels/x/rate', { method: 'OPTIONS' }), {}, {});
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Guest-Id/);
  const nf = await worker.fetch(new Request('https://t.invalid/api/khong-co/<script>'), {}, {});
  assert.equal(nf.status, 404);
  const body = await nf.json();
  assert.deepEqual(body, { error: 'Not found' });
});

test('isAdminRequest không forward token độc giả u_; proxy backend chỉ match đúng route', async t => {
  const worker = await loadWorker();
  const forwarded = [];
  t.mock.method(globalThis, 'fetch', async req => {
    forwarded.push({ url: new URL(req.url).pathname, auth: req.headers.get('Authorization') });
    return Response.json({ ok: true });
  });
  const env = { BACKEND_URL: 'https://backend.invalid',
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
  const res = await worker.fetch(new Request('https://t.invalid/api/debug/chapter/demo/1', {
    headers: { Authorization: `Bearer u_${'ab12'.repeat(16)}` } }), env, {});
  assert.equal(res.status, 401);
  assert.equal(forwarded.length, 0, 'token u_ không được gửi sang backend');

  for (const p of ['/api/translate/active', '/api/novels/demo/translate', '/api/novels/demo/translate/status', '/api/novels/demo/tools/merge_split_parts', '/api/logs']) {
    assert.equal((await worker.fetch(new Request(`https://t.invalid${p}`), env, {})).status, 200, p);
  }
  const before = forwarded.length;
  for (const p of ['/api/evil/translate', '/api/novels/demo/translate-everything', '/api/x/tools/y', '/api/user/tools']) {
    assert.equal((await worker.fetch(new Request(`https://t.invalid${p}`), env, {})).status, 404, p);
  }
  assert.equal(forwarded.length, before, 'path chỉ CHỨA /translate|/tools không được proxy');
});

// ── 9. SEO ───────────────────────────────────────────────────────────────────
test('robots.txt + sitemap.xml', async t => {
  const { db, raw } = await setupMf(t, { bindings: { SITE_ORIGIN: 'https://hacdaotruyen.com' } });
  await seedNovels(db);
  const robots = await raw('/robots.txt');
  const txt = await robots.text();
  assert.match(txt, /Disallow: \/admin/);
  assert.match(txt, /Disallow: \/login/);
  assert.match(txt, /Disallow: \/api\//);
  assert.match(txt, /Sitemap: https:\/\/hacdaotruyen\.com\/sitemap\.xml/);

  const sm = await raw('/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get('Content-Type'), /xml/);
  assert.match(sm.headers.get('Cache-Control'), /max-age=86400/);
  const xml = await sm.text();
  assert.match(xml, /<loc>https:\/\/hacdaotruyen\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/hacdaotruyen\.com\/epub<\/loc>/);
  assert.match(xml, /<loc>https:\/\/hacdaotruyen\.com\/library<\/loc>/);
  assert.match(xml, /<loc>https:\/\/hacdaotruyen\.com\/novel\/tu-c<\/loc><lastmod>2026-10-03<\/lastmod>/);
  assert.doesNotMatch(xml, /an-f/, 'truyện bị gỡ không vào sitemap');
  // updated_at DESC: tu-c (10-03) trước tien-b (10-02) trước tu-a (10-01)
  assert.ok(xml.indexOf('/novel/tu-c') < xml.indexOf('/novel/tien-b'));
  assert.ok(xml.indexOf('/novel/tien-b') < xml.indexOf('/novel/tu-a'));
});

test('SEO /novel/:slug: chèn title/meta/og/canonical đã escape; /read/ và truyện ẩn giữ index gốc', async t => {
  const { db, raw } = await setupMf(t);
  await db.prepare(`INSERT INTO novels (slug, title, synopsis, cover_url) VALUES (?, ?, ?, ?)`)
    .bind('xss', 'Tên "<script>alert(1)</script>"', 'Epub tạo bởi audiotruyenfull\nGiới thiệu & "trích dẫn" <b>', 'https://audiotruyenfull.org/c.jpg').run();
  await db.prepare(`INSERT INTO novels (slug, title, published) VALUES ('an', 'Ẩn', 0)`).run();

  const res = await raw('/novel/xss', { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-cache');
  const html = await res.text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<title>Tên &quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot; – Hắc Đạo Truyện<\/title>|<title>Tên "&lt;script&gt;alert\(1\)&lt;\/script&gt;" – Hắc Đạo Truyện<\/title>/);
  assert.match(html, /<meta name="description" content="Giới thiệu &amp; &quot;trích dẫn&quot; &lt;b&gt;" \/>/);
  assert.match(html, /<link rel="canonical" href="http:\/\/test\.invalid\/novel\/xss" \/>/);
  assert.match(html, /property="og:title"/);
  // Thẻ mặc định của index.html bị thay, không trùng lặp.
  assert.equal(html.match(/name="description"/g).length, 1);
  assert.equal(html.match(/property="og:title"/g).length, 1);
  assert.equal(html.match(/property="og:type"/g).length, 1);
  assert.equal(html.match(/rel="canonical"/g).length, 1);
  assert.doesNotMatch(html, /Mặc định site/);
  assert.match(html, /property="og:image" content="http:\/\/test\.invalid\/api\/proxy-cover\?url=https%3A%2F%2Faudiotruyenfull\.org%2Fc\.jpg"/);

  const reader = await (await raw('/novel/xss/read/1')).text();
  assert.equal(reader, INDEX_HTML);
  assert.match(reader, /<title>Hắc Đạo Truyện<\/title>/);

  const hidden = await (await raw('/novel/an')).text();
  assert.equal(hidden, INDEX_HTML);
});

test('SEO: lỗi D1 → trả index.html gốc', async t => {
  const { db, raw } = await setupMf(t);
  await db.prepare('DROP TABLE novels').run();
  const res = await raw('/novel/demo');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), INDEX_HTML);
});

// ── 10. Index D1 ─────────────────────────────────────────────────────────────
test('schema có idx_novels_published_updated và truy vấn danh sách dùng index', async t => {
  const { db } = await setupMf(t);
  const idx = await db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_novels_published_updated'`).first();
  assert.match(idx.sql, /novels\s*\(\s*published\s*,\s*updated_at DESC\s*\)/);
  const migration = await readFile(new URL('../../migrations/012_idx_novels_published_updated.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_novels_published_updated ON novels\(published, updated_at DESC\);/);
});
