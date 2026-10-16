// Test cho đợt sửa lỗi review Worker: LRU Drive theo byte, sitemap cache cố
// định + rate limit, lọc/gộp thể loại, nhận diện token độc giả chính xác,
// regex bỏ dấu dạng escape, SPA fallback khi /index.html bị 307, giới hạn purge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { loadWorker } from './harness.mjs';

// Cache API giả (Map theo URL) — gắn vào globalThis.caches trong 1 test.
function installFakeCache(t) {
  const store = new Map();
  const stats = { match: 0, put: 0, delete: [] };
  const original = globalThis.caches;
  globalThis.caches = { default: {
    async match(r) { stats.match++; const x = store.get(r.url); return x ? x.clone() : undefined; },
    async put(r, res) { stats.put++; store.set(r.url, res.clone()); },
    async delete(r) { stats.delete.push(r.url); return store.delete(r.url); },
  } };
  t.after(() => { if (original === undefined) delete globalThis.caches; else globalThis.caches = original; });
  return { store, stats };
}

async function setupMf(t) {
  const mf = new Miniflare({
    modules: true,
    script: await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-05-07',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['CHAPTERS'],
    bindings: { SYNC_KEY: 'test-secret', ALLOW_SYNC_WRITES: 'true' },
    serviceBindings: { ASSETS: () => new Response('nope', { status: 404 }) },
    outboundService: () => new Response('External requests disabled in tests', { status: 503 }),
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  const bucket = await mf.getR2Bucket('CHAPTERS');
  const call = (path, init) => mf.dispatchFetch(`http://test.invalid/api/${path}`, init);
  return { mf, db, bucket, call };
}

// ── 1. LRU chapters.json của Drive giới hạn theo byte ───────────────────────
test('Drive LRU: file > 4MB không giữ trong RAM; tổng byte LRU ≤ 8MB (đẩy mục cũ nhất)', async t => {
  assert.equal(globalThis.caches, undefined, 'test cần môi trường không có Cache API');
  const worker = await loadWorker();
  const MB = 1024 * 1024;
  const sizes = { big: 5 * MB, a: 3 * MB, b: 3 * MB, c: 3 * MB };
  const driveCalls = {};
  t.mock.method(globalThis, 'fetch', async req => {
    const id = new URL(typeof req === 'string' ? req : req.url).searchParams.get('id');
    driveCalls[id] = (driveCalls[id] || 0) + 1;
    const content = 'x'.repeat(sizes[id]);
    return new Response(JSON.stringify([{ filename: 'Chương 1.md', number: 1, title: 'Chương 1', content }]));
  });
  const uploaded = Object.fromEntries(Object.keys(sizes).map(id => [`s-${id}`, { files: { chapters: { id } } }]));
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }) },
    CHAPTERS: { get: async key => (key === 'upload_state.json' ? { json: async () => ({ uploaded }) } : null) },
  };
  const read = async id => {
    const res = await worker.fetch(new Request(`https://test.invalid/api/novels/s-${id}/chapters/1`), env, {});
    assert.equal(res.status, 200, id);
    await res.arrayBuffer();
  };

  await read('big');
  await read('big');
  assert.equal(driveCalls.big, 2, 'file 5MB không vào LRU → lần 2 phải tải lại');

  await read('a');
  await read('b');
  await read('a');
  await read('b');
  assert.equal(driveCalls.a, 1, 'a (3MB) nằm trong LRU');
  assert.equal(driveCalls.b, 1, 'b (3MB) nằm trong LRU, tổng 6MB');

  await read('c'); // tổng sẽ là 9MB > 8MB → đẩy mục cũ nhất (a) ra
  await read('b');
  await read('c');
  assert.equal(driveCalls.b, 1, 'b vẫn còn');
  assert.equal(driveCalls.c, 1, 'c vừa vào LRU');
  await read('a');
  assert.equal(driveCalls.a, 2, 'a bị đẩy ra vì tổng byte vượt 8MB (dù chỉ 3 mục)');
});

// ── 2. sitemap.xml: cache key cố định, HEAD/Authorization không đọc lại D1 ──
test('sitemap: HEAD + Authorization lần 2 lấy từ cache, không truy vấn D1; MISS mới qua rate limit', async t => {
  const { stats } = installFakeCache(t);
  const worker = await loadWorker();
  let d1Queries = 0;
  let limiterCalls = 0;
  const env = {
    PUBLIC_RATE_LIMITER: { limit: async () => { limiterCalls++; return { success: true }; } },
    DB: { prepare: () => ({ bind: () => ({ all: async () => { d1Queries++; return { results: [{ slug: 'tu-a', updated_at: '2026-10-01 00:00:00' }] }; } }) }) },
  };
  const req = (method, headers = {}, qs = '') => worker.fetch(new Request(`https://test.invalid/sitemap.xml${qs}`, { method, headers }), env, {});

  const first = await req('HEAD', { Authorization: 'Bearer admin-token' });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Worker-Cache'), 'MISS');
  assert.equal(await first.text(), '', 'HEAD không có body');
  assert.equal(d1Queries, 1);
  assert.equal(limiterCalls, 1);

  const second = await req('HEAD', { Authorization: 'Bearer admin-token' });
  assert.equal(second.headers.get('X-Worker-Cache'), 'HIT');
  assert.match(second.headers.get('Content-Type'), /xml/);
  assert.equal(await second.text(), '');
  assert.equal(d1Queries, 1, 'HEAD + Authorization lần 2 không chạm D1');

  // GET có Authorization + query rác vẫn trúng cùng 1 cache key.
  const get = await req('GET', { Authorization: 'Bearer x' }, '?junk=1');
  assert.equal(get.headers.get('X-Worker-Cache'), 'HIT');
  assert.match(get.headers.get('Cache-Control'), /max-age=86400/);
  assert.match(await get.text(), /<loc>https:\/\/test\.invalid\/novel\/tu-a<\/loc>/);
  assert.equal(d1Queries, 1);
  assert.equal(limiterCalls, 1, 'HIT không tốn lượt rate limit');
  assert.equal(stats.put, 1);
});

test('sitemap: cache MISS + rate limit hết lượt → 429, không truy vấn D1', async t => {
  installFakeCache(t);
  const worker = await loadWorker();
  let d1Queries = 0;
  const env = {
    PUBLIC_RATE_LIMITER: { limit: async () => ({ success: false }) },
    DB: { prepare: () => ({ bind: () => ({ all: async () => { d1Queries++; return { results: [] }; } }) }) },
  };
  const res = await worker.fetch(new Request('https://test.invalid/sitemap.xml'), env, {});
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  assert.equal(d1Queries, 0);
});

// ── 3. Thể loại: chip từ slug lọc ra đúng truyện; gộp hoa/thường ───────────
test('genres: chip "Xuyen Nhanh" (từ slug) lọc ra truyện; "Tiên hiệp"/"Tiên Hiệp" gộp về Title Case', async t => {
  const { db, call } = await setupMf(t);
  await db.batch([
    db.prepare(`INSERT INTO novels (slug, title, genre) VALUES ('xn-a', 'XN A', 'xuyen-nhanh')`),
    db.prepare(`INSERT INTO novels (slug, title, genre) VALUES ('xn-b', 'XN B', 'Xuyen Nhanh')`),
    db.prepare(`INSERT INTO novels (slug, title, genre) VALUES ('th-a', 'TH A', 'Tiên hiệp')`),
    db.prepare(`INSERT INTO novels (slug, title, genre) VALUES ('th-b', 'TH B', 'Tiên Hiệp')`),
    db.prepare(`INSERT INTO novels (slug, title, genre) VALUES ('dt-a', 'DT A', 'đô thị')`),
    db.prepare(`INSERT INTO novels (slug, title, genre) VALUES ('dt-b', 'DT B', 'Đô Thị')`),
  ]);
  const genres = await (await call('novels/genres')).json();
  assert.ok(genres.includes('Xuyen Nhanh'));
  assert.ok(genres.includes('Tiên Hiệp'));
  assert.ok(!genres.includes('Tiên hiệp'), 'không có chip trùng khác hoa/thường');
  assert.ok(genres.includes('Đô Thị'));
  assert.ok(!genres.includes('đô thị'));
  assert.equal(new Set(genres.map(g => g.toLocaleLowerCase('vi'))).size, genres.length);

  const filter = async label => (await (await call(`novels?genre=${encodeURIComponent(label)}`)).json()).novels.map(n => n.slug).sort();
  assert.deepEqual(await filter('Xuyen Nhanh'), ['xn-a', 'xn-b'], 'chip từ slug không còn lọc ra 0');
  assert.deepEqual(await filter('Tiên Hiệp'), ['th-a', 'th-b']);
  assert.deepEqual(await filter('Đô Thị'), ['dt-a', 'dt-b'], 'Đ/đ không phải ASCII vẫn khớp cả 2 dạng');
});

// ── 4. isAdminRequest: chỉ chặn token độc giả đúng định dạng ────────────────
test('isAdminRequest: token admin urlsafe bắt đầu "u_" vẫn được hỏi backend; token độc giả thật thì không', async t => {
  const worker = await loadWorker();
  const forwarded = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
    forwarded.push(headers.get('Authorization'));
    return Response.json({ ok: true });
  });
  const env = { BACKEND_URL: 'https://backend.invalid',
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
  const debug = token => worker.fetch(new Request('https://t.invalid/api/debug/chapter/demo/1', {
    headers: { Authorization: `Bearer ${token}` } }), env, {});

  const adminLike = 'u_' + 'Ab9-_xYz'.repeat(6).slice(0, 43); // dạng secrets.token_urlsafe(32)
  assert.equal(adminLike.length, 45);
  const res = await debug(adminLike);
  assert.equal(forwarded.length, 1, 'token u_ + 43 ký tự urlsafe vẫn được forward');
  assert.equal(forwarded[0], `Bearer ${adminLike}`);
  assert.equal(res.status, 404, 'backend xác nhận admin → vào được route debug');

  const reader = 'u_' + '0123456789abcdef'.repeat(4);
  assert.equal((await debug(reader)).status, 401);
  assert.equal(forwarded.length, 1, 'token độc giả đúng định dạng không rời Worker');
});

// ── 5. Regex bỏ dấu viết dạng escape, không còn ký tự kết hợp thô ────────────
test('src/index.js không chứa ký tự kết hợp (U+0300–U+036F) viết thẳng; tìm không dấu vẫn chạy', async t => {
  const source = await readFile(new URL('../../src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /[̀-ͯ]/);
  assert.match(source, /\[\\u0300-\\u036f\]/);
  const { db, call } = await setupMf(t);
  await db.prepare(`INSERT INTO novels (slug, title) VALUES ('dau-pha-thuong-khung', 'Đấu Phá Thương Khung')`).run();
  const res = await (await call(`novels?q=${encodeURIComponent('Đấu Phá')}`)).json();
  assert.deepEqual(res.novels.map(n => n.slug), ['dau-pha-thuong-khung']);
});

// ── 6. SPA fallback khi ASSETS trả 307 cho /index.html ───────────────────────
test('SPA fallback: /index.html bị 307 → lấy lại "/"; không chạy SEO với redirect', async () => {
  const worker = await loadWorker();
  const html = '<!doctype html><html><head><title>Hắc Đạo Truyện</title></head><body><div id="root"></div></body></html>';
  const seen = [];
  const env = { ASSETS: { fetch: async request => {
    const path = new URL(request.url).pathname;
    seen.push(path);
    if (path === '/index.html') return new Response(null, { status: 307, headers: { Location: '/' } });
    if (path === '/') return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response('nope', { status: 404 });
  } } };
  const res = await worker.fetch(new Request('https://t.invalid/library'), env, {});
  assert.equal(res.status, 200);
  assert.equal(await res.text(), html);
  assert.equal(res.headers.get('Cache-Control'), 'no-cache');
  assert.deepEqual(seen, ['/library', '/index.html', '/']);

  // Cả "/" cũng redirect → trả nguyên response, không đụng D1/HTMLRewriter.
  let dbTouched = false;
  const env2 = { DB: { prepare: () => { dbTouched = true; throw new Error('x'); } },
    ASSETS: { fetch: async request => (new URL(request.url).pathname === '/novel/demo'
      ? new Response('nope', { status: 404 })
      : new Response(null, { status: 307, headers: { Location: '/' } })) } };
  const res2 = await worker.fetch(new Request('https://t.invalid/novel/demo'), env2, {});
  assert.equal(res2.status, 307);
  assert.equal(dbTouched, false);
});

// ── 7. Purge edge cache trong syncNovelBatch có giới hạn ─────────────────────
test('sync-novel: purge ≤ 40 key, ưu tiên chi tiết + mục lục + chương mới nhất', async t => {
  const { mf, db, bucket } = await setupMf(t);
  void mf;
  const { stats } = installFakeCache(t);
  const worker = await loadWorker();
  const env = { DB: db, CHAPTERS: bucket, SYNC_KEY: 'test-secret', ALLOW_SYNC_WRITES: 'true' };
  const chapters = Array.from({ length: 25 }, (_, i) => ({
    filename: `c${i + 1}.md`, title: `Chương ${i + 1}`, number: i + 1, content: `# Chương ${i + 1}\n\nnội dung`,
  }));
  const res = await worker.fetch(new Request('https://t.invalid/api/admin/sync-novel', {
    method: 'POST', headers: { 'x-sync-key': 'test-secret' },
    body: JSON.stringify({ slug: 'demo', title: 'Demo', chapters, is_first_chunk: true }),
  }), env, {});
  assert.equal(res.status, 200, await res.clone().text());
  const base = 'https://t.invalid/api/novels/demo';
  assert.ok(stats.delete.length <= 40, `purge ${stats.delete.length} key`);
  assert.ok(stats.delete.length >= 30, 'vẫn purge phần lớn');
  assert.ok(stats.delete.includes(base));
  assert.ok(stats.delete.includes(`${base}/chapters`));
  assert.ok(stats.delete.includes(`${base}/chapters/25`), 'chương mới nhất được purge');
  assert.ok(stats.delete.includes(`${base}/chapters/c25.md`));
  assert.ok(!stats.delete.includes(`${base}/chapters/1`), 'chương cũ nhất nhường chỗ (hết hạn theo TTL)');
});
