import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker } from './harness.mjs';

class MemoryCache {
  constructor() {
    this.entries = new Map();
  }

  async match(request) {
    const response = this.entries.get(request.url);
    return response ? response.clone() : undefined;
  }

  async put(request, response) {
    this.entries.set(request.url, response.clone());
  }
}

test('stats edge cache avoids repeat D1 reads and Authorization bypasses cache', async t => {
  const originalCaches = globalThis.caches;
  globalThis.caches = { default: new MemoryCache() };
  t.after(() => {
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  });

  const worker = await loadWorker();
  let reads = 0;
  let translatedReads = 0;
  let stats = { total_novels: 3, total_chapters: 120, total_glossary: 17 };
  let sql = '';
  // Cập nhật 2026-10: /api/stats có thêm khoá translated_chapters (COUNT bảng
  // chapters) — truy vấn đó tách riêng, cache 6 giờ, nên mock phân biệt 2 câu
  // SQL: truy vấn tổng của novels vẫn KHÔNG được đụng bảng chapters.
  const env = {
    DB: {
      prepare(statement) {
        if (/FROM chapters/.test(statement)) {
          return { async first() { translatedReads++; return { n: 99 }; } };
        }
        sql = statement;
        return {
          async first() {
            reads++;
            return { ...stats };
          },
        };
      },
    },
  };
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };

  const first = await worker.fetch(new Request('https://test.invalid/api/stats'), env, ctx);
  assert.equal(first.headers.get('X-Worker-Cache'), 'MISS');
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=300');
  assert.deepEqual(await first.json(), { ...stats, translated_chapters: 99 });
  assert.match(sql, /SUM\(total_chapters\)/);
  assert.doesNotMatch(sql, /\bchapters\b/i);
  await Promise.all(pending.splice(0));

  stats = { total_novels: 4, total_chapters: 150, total_glossary: 20 };
  const second = await worker.fetch(new Request('https://test.invalid/api/stats'), env, ctx);
  assert.equal(second.headers.get('X-Worker-Cache'), 'HIT');
  assert.match(second.headers.get('Vary'), /Authorization/i);
  assert.deepEqual(await second.json(), { total_novels: 3, total_chapters: 120, total_glossary: 17, translated_chapters: 99 });
  assert.equal(reads, 1);

  const crawlerQuery = await worker.fetch(new Request('https://test.invalid/api/stats?random-cache-buster=1'), env, ctx);
  assert.equal(crawlerQuery.headers.get('X-Worker-Cache'), 'HIT');
  assert.equal(reads, 1);

  const admin = await worker.fetch(new Request('https://test.invalid/api/stats', {
    headers: { Authorization: 'Bearer admin-token' },
  }), env, ctx);
  assert.equal(admin.headers.get('X-Worker-Cache'), 'BYPASS');
  assert.equal(admin.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await admin.json(), { ...stats, translated_chapters: 99 });
  assert.equal(reads, 2);
  // translated_chapters nhớ trong isolate → không COUNT lại bảng chapters.
  assert.equal(translatedReads, 1);
});
