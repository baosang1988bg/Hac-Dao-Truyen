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
              const [user_id, slug, chapter, position, type] = args;
              const row = { user_id, slug, chapter, position, type, updated_at: 'now' };
              const idx = progress.findIndex(p => p.user_id === user_id && p.slug === slug);
              if (idx >= 0) progress[idx] = row; else progress.push(row);
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
  assert.deepEqual(progress, [{ user_id: 1, slug: 'demo-novel', chapter: 12, position: '12', type: 'chapter', updated_at: 'now' }]);
});

test('epub payload stores CFI position without an integer chapter', async () => {
  const worker = await loadWorker();
  const progress = [];
  const env = { DB: makeDb(progress) };
  const res = await put(worker, env, 'demo-epub', { type: 'epub', position: 'epubcfi(/6/4[chap01]!/4/2/1:0)' });
  assert.equal(res.status, 200);
  assert.deepEqual(progress, [{ user_id: 1, slug: 'demo-epub', chapter: null, position: 'epubcfi(/6/4[chap01]!/4/2/1:0)', type: 'epub', updated_at: 'now' }]);
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
  const progress = [{ user_id: 1, slug: 'demo-epub', chapter: null, position: 'epubcfi(...)', type: 'epub', updated_at: 'now' }];
  const env = { DB: makeDb(progress) };
  const res = await get(worker, env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), progress);
});
