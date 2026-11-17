// Tối ưu tài nguyên đợt 3 (2026-11-17): cột novels.chapter_count (migration 014)
// và cache EPUB Google Drive ở edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { loadWorker } from './harness.mjs';

// ── chapter_count: chạy Worker thật trên Miniflare + D1 ─────────────────────
async function setup(t, { withColumn = true } = {}) {
  const mf = new Miniflare({modules:true, script:await readFile(new URL('../../src/index.js',import.meta.url),'utf8'),
    compatibilityDate:'2026-05-07',compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'],r2Buckets:['CHAPTERS'],bindings:{SYNC_KEY:'test-secret',ALLOW_SYNC_WRITES:'true'},
    outboundService: () => new Response('External requests disabled in tests',{status:503}),
  });
  t.after(()=>mf.dispose());
  const db = await mf.getD1Database('DB');
  let schema = (await readFile(new URL('../../schema.sql',import.meta.url),'utf8')).replace(/--[^\n]*/g,'');
  if (!withColumn) {
    // Production TRƯỚC migration 014.
    schema = schema.replace(/,\s*chapter_count\s+INTEGER DEFAULT 0/, '')
      .split(';').filter(s => !/idx_novels_published_chapters/.test(s)).join(';');
    assert.doesNotMatch(schema, /chapter_count\s+INTEGER|idx_novels_published_chapters/);
  }
  await db.batch(schema.split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
  const call = (path,init) => mf.dispatchFetch(`http://test.invalid/api/${path}`,init);
  const sync = async (slug, numbers) => {
    const chapters = numbers.map(n => ({filename:`Chương ${n}.md`,title:`Chương ${n}`,number:n,content:`# Chương ${n}\n\nBody`}));
    const res = await call('admin/sync-novel',{method:'POST',headers:{'x-sync-key':'test-secret'},
      body:JSON.stringify({slug,title:slug,chapters,is_first_chunk:true,total_chapter_count:numbers.length})});
    assert.equal(res.status, 200, await res.text());
  };
  return {db,call,sync};
}

test('sync ghi novels.chapter_count trong cùng batch; sort=chapter_count dùng cột', async t => {
  const {db,call,sync} = await setup(t);
  await sync('ngan', [1, 2]);
  await sync('dai', [1, 2, 3]);
  await sync('dai', [3, 4, 0]);          // chương 3 gửi lại + author note số 0 không tính
  await db.prepare(`INSERT INTO novels (slug,title) VALUES ('epub-only','E')`).run();
  const counts = Object.fromEntries((await db.prepare('SELECT slug, chapter_count FROM novels').all()).results.map(r => [r.slug, r.chapter_count]));
  assert.deepEqual(counts, { ngan: 2, dai: 4, 'epub-only': 0 });
  // total_chapters vẫn giữ MAX như trước.
  assert.equal((await db.prepare(`SELECT total_chapters FROM novels WHERE slug='dai'`).first()).total_chapters, 3);

  const list = await (await call('novels?sort=chapter_count&limit=10')).json();
  assert.deepEqual(list.novels.map(n => [n.slug, n.chapter_count]), [['dai', 4], ['ngan', 2], ['epub-only', 0]]);
  assert.equal(list.total, 3);
});

test('chưa chạy migration 014: sync và sort=chapter_count vẫn chạy theo đường cũ', async t => {
  const {db,call,sync} = await setup(t, { withColumn: false });
  await sync('ngan', [1]);
  await sync('dai', [1, 2, 3]);
  await sync('dai', [3]);                 // upsert trên truyện đã có vẫn cập nhật được
  const row = await db.prepare(`SELECT updated_at, total_chapters FROM novels WHERE slug='dai'`).first();
  assert.ok(row.updated_at);
  const list = await (await call('novels?sort=chapter_count&limit=10')).json();
  assert.deepEqual(list.novels.map(n => [n.slug, n.chapter_count]), [['dai', 3], ['ngan', 1]]);
});

// ── EPUB: Worker trong Node với D1/Cache giả ────────────────────────────────
function installFakeCache(t) {
  const store = new Map();
  const original = globalThis.caches;
  globalThis.caches = { default: {
    async match(r) { const x = store.get(r.url); return x ? x.clone() : undefined; },
    async put(r, res) { store.set(r.url, new Response(await res.arrayBuffer(), { headers: res.headers })); },
    async delete(r) { return store.delete(r.url); },
  } };
  t.after(() => { if (original === undefined) delete globalThis.caches; else globalThis.caches = original; });
  return store;
}

function ctxWithPending() {
  const pending = [];
  return { ctx: { waitUntil(p) { pending.push(p); } }, flush: () => Promise.all(pending.splice(0)) };
}

function epubEnv(novel) {
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: async () => env.novel }) }) },
    CHAPTERS: { get: async () => null },
    novel,
  };
  return env;
}

const EPUB = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const epubReq = () => new Request('https://test.invalid/api/novels/demo/epub');

test('EPUB Drive: lần đầu tải Drive + ghi cache, lần sau HIT; đổi drive_file_id → tải lại; truyện bị gỡ → 404', async t => {
  const store = installFakeCache(t);
  const worker = await loadWorker();
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async url => {
    fetched.push(String(url));
    return new Response(EPUB, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(EPUB.length) } });
  });
  const env = epubEnv({ drive_file_id: 'file-a', published: 1 });
  const { ctx, flush } = ctxWithPending();

  const first = await worker.fetch(epubReq(), env, ctx);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Worker-Cache'), 'MISS');
  assert.equal(first.headers.get('Content-Type'), 'application/epub+zip');
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), EPUB);
  await flush();
  assert.equal(store.size, 1);

  const second = await worker.fetch(epubReq(), env, ctx);
  assert.equal(second.headers.get('X-Worker-Cache'), 'HIT');
  assert.equal(second.headers.get('Content-Disposition'), 'inline; filename="demo.epub"');
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), EPUB);
  assert.equal(fetched.length, 1, 'chỉ tải từ Drive đúng 1 lần');

  env.novel = { drive_file_id: 'file-b', published: 1 };
  const third = await worker.fetch(epubReq(), env, ctx);
  assert.equal(third.headers.get('X-Worker-Cache'), 'MISS');
  await third.arrayBuffer(); await flush();
  assert.equal(fetched.length, 2);
  assert.match(fetched[1], /id=file-b/);

  env.novel = { drive_file_id: 'file-b', published: 0 };
  assert.equal((await worker.fetch(epubReq(), env, ctx)).status, 404);
});

test('EPUB Drive: file lớn, không rõ kích thước hoặc trang HTML thì KHÔNG cache', async t => {
  const store = installFakeCache(t);
  const worker = await loadWorker();
  let headers = {};
  t.mock.method(globalThis, 'fetch', async () => new Response(EPUB, { headers }));
  const env = epubEnv({ drive_file_id: 'f', published: 1 });
  const { ctx, flush } = ctxWithPending();
  for (const h of [
    { 'Content-Length': String(21 * 1024 * 1024) },
    {},
    { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(EPUB.length) },
  ]) {
    headers = h;
    const res = await worker.fetch(epubReq(), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Worker-Cache'), null);
    await res.arrayBuffer(); await flush();
  }
  assert.equal(store.size, 0);
});
