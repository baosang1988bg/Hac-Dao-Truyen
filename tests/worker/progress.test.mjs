import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker } from './harness.mjs';

const TOKEN = 'u_test-session';
const USER = { id: 1, email: 'a@b.com', name: 'A' };

function makeDb(progress = []) {
  return {
    prepare(sql) {
      if (sql.includes('FROM user_sessions')) {
        return { bind: (token) => ({ first: async () => (token === TOKEN ? { ...USER, expires_at: '9999-01-01 00:00:00' } : null) }) };
      }
      if (sql.includes('INSERT INTO reading_progress')) {
        return {
          bind: (...args) => ({
            run: async () => {
              const [user_id, slug, chapter, position, type, client_updated_at] = args;
              const idx = progress.findIndex(p => p.user_id === user_id && p.slug === slug);
              const existing = idx >= 0 ? progress[idx] : null;
              // Mô phỏng đúng WHERE của ON CONFLICT DO UPDATE thật trong src/index.js:
              // chỉ ghi khi chưa có bản ghi, hoặc client_updated_at mới hơn/không so sánh được.
              const stale = existing && existing.client_updated_at != null && client_updated_at != null
                && client_updated_at < existing.client_updated_at;
              if (stale) return { meta: { changes: 0 } };
              const row = { user_id, slug, chapter, position, type, updated_at: 'now', client_updated_at: client_updated_at ?? null };
              if (idx >= 0) progress[idx] = row; else progress.push(row);
              return { meta: { changes: 1 } };
            },
          }),
        };
      }
      if (sql.includes('SELECT') && sql.includes('FROM reading_progress')) {
        return { bind: (user_id) => ({ all: async () => ({ results: progress.filter(p => p.user_id === user_id) }) }) };
      }
      throw new Error('Unexpected SQL: ' + sql);
    },
  };
}

const put = (worker, env, slug, body) => worker.fetch(
  new Request(`https://test.invalid/api/user/progress/${slug}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body),
  }), env, {},
);
const get = (worker, env) => worker.fetch(
  new Request('https://test.invalid/api/user/progress', { headers: { Authorization: `Bearer ${TOKEN}` } }), env, {},
);

test('legacy chapter payload (no type field) keeps working and derives position/type', async () => {
  const worker = await loadWorker();
  const progress = [];
  const env = { DB: makeDb(progress) };
  const res = await put(worker, env, 'demo-novel', { chapter: 12 });
  assert.equal(res.status, 200);
  assert.deepEqual(progress, [{ user_id: 1, slug: 'demo-novel', chapter: 12, position: '12', type: 'chapter', updated_at: 'now', client_updated_at: null }]);
});

test('epub payload stores CFI position without an integer chapter', async () => {
  const worker = await loadWorker();
  const progress = [];
  const env = { DB: makeDb(progress) };
  const res = await put(worker, env, 'demo-epub', { type: 'epub', position: 'epubcfi(/6/4[chap01]!/4/2/1:0)' });
  assert.equal(res.status, 200);
  assert.deepEqual(progress, [{ user_id: 1, slug: 'demo-epub', chapter: null, position: 'epubcfi(/6/4[chap01]!/4/2/1:0)', type: 'epub', updated_at: 'now', client_updated_at: null }]);
});

test('epub payload without position is rejected', async () => {
  const worker = await loadWorker();
  const env = { DB: makeDb([]) };
  const res = await put(worker, env, 'demo-epub', { type: 'epub' });
  assert.equal(res.status, 400);
});

test('chapter payload with non-integer chapter is still rejected', async () => {
  const worker = await loadWorker();
  const env = { DB: makeDb([]) };
  const res = await put(worker, env, 'demo-novel', { type: 'chapter', chapter: 'abc' });
  assert.equal(res.status, 400);
});

test('unknown type value is rejected', async () => {
  const worker = await loadWorker();
  const env = { DB: makeDb([]) };
  const res = await put(worker, env, 'demo-novel', { type: 'audio', position: 'x' });
  assert.equal(res.status, 400);
});

test('list returns type and position alongside chapter', async () => {
  const worker = await loadWorker();
  const progress = [{ user_id: 1, slug: 'demo-epub', chapter: null, position: 'epubcfi(...)', type: 'epub', updated_at: 'now', client_updated_at: null }];
  const env = { DB: makeDb(progress) };
  const res = await get(worker, env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), progress);
});

test('C03: request cũ đến muộn (client_updated_at nhỏ hơn) bị từ chối 409, không ghi đè', async () => {
  const worker = await loadWorker();
  const progress = [];
  const env = { DB: makeDb(progress) };
  const newer = await put(worker, env, 'demo-novel', { chapter: 20, client_updated_at: 2000 });
  assert.equal(newer.status, 200);
  const older = await put(worker, env, 'demo-novel', { chapter: 5, client_updated_at: 1000 });
  assert.equal(older.status, 409);
  assert.equal(progress[0].chapter, 20, 'chương 20 (mới hơn) không được ghi đè bởi request chương 5 đến muộn');
});

test('C03: client không gửi client_updated_at vẫn ghi đè vô điều kiện (tương thích ngược)', async () => {
  const worker = await loadWorker();
  const progress = [];
  const env = { DB: makeDb(progress) };
  await put(worker, env, 'demo-novel', { chapter: 20, client_updated_at: 2000 });
  const res = await put(worker, env, 'demo-novel', { chapter: 5 });
  assert.equal(res.status, 200);
  assert.equal(progress[0].chapter, 5);
});
