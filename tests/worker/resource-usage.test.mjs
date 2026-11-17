// Test cho đợt tối ưu tài nguyên 2026-11-17: giảm request vào Worker, giảm
// rows_read D1 và không để ảnh bìa/bình luận ăn hết rate limit theo IP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadWorker } from './harness.mjs';

// Cache API giả (Node không có globalThis.caches) — đủ cho match/put/delete.
function installFakeCache(t) {
  const store = new Map();
  const original = globalThis.caches;
  globalThis.caches = { default: {
    async match(r) { const x = store.get(r.url); return x ? x.clone() : undefined; },
    async put(r, res) { store.set(r.url, res.clone()); },
    async delete(r) { return store.delete(r.url); },
  } };
  t.after(() => { if (original === undefined) delete globalThis.caches; else globalThis.caches = original; });
  return store;
}

function ctxWithPending() {
  const pending = [];
  return { ctx: { waitUntil(p) { pending.push(p); } }, flush: () => Promise.all(pending.splice(0)) };
}

// D1 giả cho getNovels: đếm số lần chạy COUNT(*) và số lần lấy trang.
function novelsDb(rows = [{ slug: 'a', title: 'A', updated_at: '2026-10-01 00:00:00' }], total = 100) {
  const calls = { count: 0, page: 0, stats: 0 };
  const DB = { prepare: sql => ({ bind: () => ({
    first: async () => { if (/COUNT\(\*\) as cnt/.test(sql)) { calls.count++; return { cnt: total }; } return null; },
    all: async () => {
      if (/AS chapter_count/.test(sql) && /IN \(/.test(sql)) { calls.stats++; return { results: [] }; }
      calls.page++;
      return { results: rows };
    },
  }) }) };
  return { DB, calls };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const coverReq = (extra = '') => new Request(`https://test.invalid/api/proxy-cover?url=${encodeURIComponent('https://cdn.example.com/c.png')}${extra}`);

test('proxy-cover: ghi edge cache, lần sau HIT không tải lại host nguồn; tham số rác không tạo key mới', async t => {
  installFakeCache(t);
  const worker = await loadWorker();
  let upstream = 0;
  t.mock.method(globalThis, 'fetch', async () => { upstream++; return new Response(PNG, { headers: { 'Content-Type': 'image/png' } }); });
  const { ctx, flush } = ctxWithPending();

  const first = await worker.fetch(coverReq(), {}, ctx);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Worker-Cache'), 'MISS');
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=2592000, s-maxage=2592000');
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), PNG);
  await flush();

  const second = await worker.fetch(coverReq(), {}, ctx);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('X-Worker-Cache'), 'HIT');
  assert.equal(second.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), PNG);

  const junk = await worker.fetch(coverReq('&cache-buster=1'), {}, ctx);
  assert.equal(junk.headers.get('X-Worker-Cache'), 'HIT');
  assert.equal(upstream, 1, 'chỉ tải ảnh từ host nguồn đúng 1 lần');
});

test('proxy-cover: HIT không tốn rate limit; MISS vẫn bị chặn khi quá hạn mức; lỗi không được cache', async t => {
  installFakeCache(t);
  const worker = await loadWorker();
  let upstream = 0;
  let upstreamOk = true;
  t.mock.method(globalThis, 'fetch', async () => {
    upstream++;
    return upstreamOk ? new Response(PNG, { headers: { 'Content-Type': 'image/png' } }) : new Response('x', { status: 500 });
  });
  let limiterCalls = 0;
  let allow = true;
  const env = { PUBLIC_RATE_LIMITER: { limit: async () => { limiterCalls++; return { success: allow }; } } };
  const { ctx, flush } = ctxWithPending();

  assert.equal((await worker.fetch(coverReq(), env, ctx)).status, 200);
  await flush();
  assert.equal(limiterCalls, 1, 'MISS đi qua rate limit');

  allow = false; // IP đã hết hạn mức
  const hit = await worker.fetch(coverReq(), env, ctx);
  assert.equal(hit.status, 200, 'bìa đã cache vẫn trả được dù IP hết hạn mức');
  assert.equal(limiterCalls, 1, 'HIT không gọi rate limiter');

  const other = new Request(`https://test.invalid/api/proxy-cover?url=${encodeURIComponent('https://cdn.example.com/other.png')}`);
  const blocked = await worker.fetch(other, env, ctx);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(upstream, 1, 'bị chặn thì không gọi host nguồn');

  allow = true;
  upstreamOk = false;
  assert.equal((await worker.fetch(other, env, ctx)).status, 502);
  await flush();
  upstreamOk = true;
  const retry = await worker.fetch(other, env, ctx);
  assert.equal(retry.status, 200, 'lỗi 502 không bị giữ trong cache');
  assert.equal(retry.headers.get('X-Worker-Cache'), 'MISS');
});

test('novels: COUNT(*) chỉ chạy 1 lần cho cùng bộ lọc dù đổi trang/kiểu sắp xếp; slugs= không COUNT', async () => {
  const worker = await loadWorker();
  const { DB, calls } = novelsDb();
  const get = qs => worker.fetch(new Request(`https://test.invalid/api/novels?${qs}`), { DB }, {});

  const p1 = await (await get('page=1&limit=12')).json();
  const p2 = await (await get('page=2&limit=12')).json();
  const byViews = await (await get('sort=views&limit=30')).json();
  assert.equal(p1.total, 100);
  assert.equal(p2.total, 100);
  assert.equal(byViews.total, 100);
  assert.equal(p1.pages, 9);
  assert.equal(calls.count, 1, 'cùng WHERE published=1 → đếm 1 lần');

  await get('status=completed&limit=12');
  assert.equal(calls.count, 2, 'bộ lọc khác → đếm riêng');
  await get('status=completed&limit=12&page=3');
  assert.equal(calls.count, 2);

  const bySlug = await (await get('slugs=a&limit=1')).json();
  assert.equal(bySlug.total, 1);
  assert.equal(calls.count, 2, 'tra theo slugs lấy tổng từ số dòng trả về');
});

test('novels: tổng số được nhớ qua Cache API giữa các isolate', async t => {
  const store = installFakeCache(t);
  const { DB, calls } = novelsDb();
  const { ctx, flush } = ctxWithPending();
  const a = await loadWorker();
  await (await a.fetch(new Request('https://test.invalid/api/novels?page=1'), { DB }, ctx)).arrayBuffer();
  await flush();
  assert.equal(calls.count, 1);
  assert.ok([...store.keys()].some(k => k.startsWith('https://stats-cache.hacdao.internal/novels_count/')));

  // Isolate mới (biến module trống) + trang khác (response chưa có trong cache)
  // → vẫn không COUNT lại nhờ key nội bộ trong Cache API.
  const b = await loadWorker();
  const res = await b.fetch(new Request('https://test.invalid/api/novels?page=2'), { DB }, ctx);
  assert.equal((await res.json()).total, 100);
  assert.equal(calls.count, 1);
});

test('novels: thống kê chương nhớ theo (slug, updated_at) — chỉ tính lại truyện vừa sync', async t => {
  const store = installFakeCache(t);
  const { ctx, flush } = ctxWithPending();
  const recent = new Date(Date.now() - 10_000).toISOString().slice(0, 19).replace('T', ' ');
  let rows = [
    { slug: 'old-a', title: 'A', updated_at: '2026-10-01 00:00:00' },
    { slug: 'old-b', title: 'B', updated_at: '2026-10-02 00:00:00' },
    { slug: 'hot-c', title: 'C', updated_at: recent },
  ];
  let counts = { 'old-a': 10, 'old-b': 20, 'hot-c': 30 };
  const statQueries = [];
  const DB = { prepare: sql => ({ bind: (...b) => ({
    first: async () => ({ cnt: rows.length }),
    all: async () => {
      if (/AS chapter_count/.test(sql) && /IN \(/.test(sql)) {
        statQueries.push(b);
        return { results: b.map(slug => ({ slug, chapter_count: counts[slug], latest_chapter_title: `Chương ${counts[slug]}` })) };
      }
      return { results: rows };
    },
  }) }) };
  const list = async (worker, qs) => (await (await worker.fetch(new Request(`https://test.invalid/api/novels?${qs}`), { DB }, ctx)).json()).novels;

  const a = await loadWorker();
  const first = await list(a, 'limit=30');
  await flush();
  assert.deepEqual(first.map(n => [n.slug, n.chapter_count, n.latest_chapter_title]),
    [['old-a', 10, 'Chương 10'], ['old-b', 20, 'Chương 20'], ['hot-c', 30, 'Chương 30']]);
  assert.deepEqual(statQueries, [['old-a', 'old-b', 'hot-c']]);
  assert.ok(store.has('https://stats-cache.hacdao.internal/chapter_stats_v1'));

  // URL khác (response chưa cache) nhưng cùng truyện: chỉ truyện vừa sync
  // (updated_at trong 2 phút gần đây) bị tính lại, 2 truyện cũ dùng số đã nhớ.
  const second = await list(a, 'limit=30&sort=views');
  await flush();
  assert.deepEqual(statQueries[1], ['hot-c']);
  assert.equal(second.find(n => n.slug === 'old-a').chapter_count, 10);

  // Isolate mới đọc blob từ Cache API → vẫn không tính lại truyện cũ.
  const b = await loadWorker();
  await list(b, 'limit=30&status=ongoing');
  await flush();
  assert.deepEqual(statQueries[2], ['hot-c']);

  // old-a được sync thêm chương → updated_at đổi → tính lại ĐÚNG truyện đó, thấy số mới.
  rows = rows.map(r => (r.slug === 'old-a' ? { ...r, updated_at: '2026-10-05 00:00:00' } : r));
  counts = { ...counts, 'old-a': 11 };
  const third = await list(b, 'limit=30&has_epub=1');
  await flush();
  assert.deepEqual(statQueries[3], ['old-a', 'hot-c']);
  assert.equal(third.find(n => n.slug === 'old-a').chapter_count, 11);
  assert.equal(third.find(n => n.slug === 'old-a').latest_chapter_title, 'Chương 11');
  assert.equal(third.find(n => n.slug === 'old-b').chapter_count, 20);
});

test('novels: TTL edge theo chi phí truy vấn', async t => {
  installFakeCache(t);
  const worker = await loadWorker();
  const { DB } = novelsDb();
  const { ctx } = ctxWithPending();
  const cc = async qs => (await worker.fetch(new Request(`https://test.invalid/api/novels?${qs}`), { DB }, ctx)).headers.get('Cache-Control');
  assert.equal(await cc('sort=updated_at&limit=30'), 'public, max-age=120, s-maxage=300');
  assert.equal(await cc('sort=views&order=desc&limit=30'), 'public, max-age=120, s-maxage=300');
  assert.equal(await cc('sort=chapter_count'), 'public, max-age=300, s-maxage=3600');
  assert.equal(await cc('sort=rating'), 'public, max-age=300, s-maxage=1800');
  assert.equal(await cc('sort=title&order=asc'), 'public, max-age=300, s-maxage=1800');
  assert.equal(await cc('genre=Tu%20Ti%C3%AAn'), 'public, max-age=120, s-maxage=600');
  assert.equal(await cc('q=kiem'), 'public, max-age=120, s-maxage=600');
  assert.equal(await cc('has_epub=1'), 'public, max-age=120, s-maxage=600');
  assert.equal(await cc('slugs=a'), 'public, max-age=120, s-maxage=120');
});

test('bình luận: khách dùng chung cache theo ?chapter=, người đăng nhập luôn BYPASS', async t => {
  installFakeCache(t);
  const worker = await loadWorker();
  let listReads = 0;
  const DB = { prepare: sql => ({ bind: (...b) => ({
    first: async () => (/FROM novels/.test(sql) ? { published: 1 } : null),
    all: async () => { listReads++; return { results: [{ id: listReads, chapter: b[1] ?? null, content: 'hay' }] }; },
  }) }) };
  const { ctx, flush } = ctxWithPending();
  const get = (qs, headers = {}) => worker.fetch(new Request(`https://test.invalid/api/novels/demo/comments${qs}`, { headers }), { DB }, ctx);

  const first = await get('?chapter=1');
  assert.equal(first.headers.get('X-Worker-Cache'), 'MISS');
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
  await first.arrayBuffer();
  await flush();
  assert.equal((await get('?chapter=1&x=rác')).headers.get('X-Worker-Cache'), 'HIT');
  assert.equal(listReads, 1);

  // Chương khác là key khác (không trả nhầm bình luận của chương 1).
  const ch2 = await get('?chapter=2');
  assert.equal(ch2.headers.get('X-Worker-Cache'), 'MISS');
  assert.equal((await ch2.json())[0].chapter, 2);
  await flush();

  // Người vừa gửi bình luận (có token) phải thấy ngay → không dùng cache.
  const user = await get('?chapter=1', { Authorization: 'Bearer u_token' });
  assert.equal(user.headers.get('X-Worker-Cache'), 'BYPASS');
  assert.equal(user.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(listReads, 3);
});

test('bình luận mới nhất + thể loại: có edge cache, limit khác là key khác', async t => {
  installFakeCache(t);
  const worker = await loadWorker();
  let reads = 0;
  const DB = { prepare: () => {
    const stmt = { bind: () => stmt, first: async () => ({ published: 1 }), all: async () => { reads++; return { results: [] }; } };
    return stmt;
  } };
  const env = { DB, CHAPTERS: { get: async () => null } };
  const { ctx, flush } = ctxWithPending();
  const get = path => worker.fetch(new Request(`https://test.invalid/api/${path}`), env, ctx);

  const recent = await get('comments/recent?limit=5');
  assert.equal(recent.headers.get('Cache-Control'), 'public, max-age=120, s-maxage=300');
  await recent.arrayBuffer(); await flush();
  const before = reads;
  assert.equal((await get('comments/recent?limit=5')).headers.get('X-Worker-Cache'), 'HIT');
  assert.equal(reads, before);
  // limit khác → key khác (không trả 5 mục cho yêu cầu 10 mục).
  assert.equal((await get('comments/recent?limit=10')).headers.get('X-Worker-Cache'), 'MISS');

  assert.equal((await get('novels/genres')).headers.get('Cache-Control'), 'public, max-age=3600, s-maxage=21600');
});

test('cấu hình deploy: file tĩnh không đi qua Worker và có Cache-Control riêng', async () => {
  const raw = await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  // Bỏ comment // (không nằm trong chuỗi URL) để JSON.parse được.
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/([^:"])\/\/[^\n]*$/gm, '$1'));
  const rules = config.assets.run_worker_first;
  assert.ok(Array.isArray(rules), 'run_worker_first phải là danh sách pattern, không phải true');
  // Đường dẫn động phải luôn chạy Worker trước.
  for (const p of ['/api/*', '/sitemap.xml', '/robots.txt']) assert.ok(rules.includes(p), `thiếu pattern ${p}`);
  // Không phủ toàn bộ (mất tác dụng) và không dùng pattern phủ định (asset
  // thiếu sẽ trả 404 kèm header immutable của _headers, bỏ qua Worker).
  assert.ok(!rules.includes('/*'));
  assert.ok(!rules.some(p => p.startsWith('!')));

  const headers = await readFile(new URL('../../frontend/public/_headers', import.meta.url), 'utf8');
  assert.match(headers, /\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/sw\.js\n\s+Cache-Control: no-cache/);
});
