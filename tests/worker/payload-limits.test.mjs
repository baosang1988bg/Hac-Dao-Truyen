import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker } from './harness.mjs';

const bigString = (n) => 'a'.repeat(n);

function jsonRequest(path, method, obj) {
  const body = JSON.stringify(obj);
  return new Request(`https://test.invalid${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

test('register từ chối payload vượt giới hạn 64 KiB (body thật, không chỉ Content-Length)', async () => {
  const worker = await loadWorker();
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { last_row_id: 1 } }) }) }) } };
  const req = jsonRequest('/api/user/register', 'POST', {
    email: 'a@b.com',
    password: 'password123',
    name: bigString(70 * 1024),
  });
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 413);
});

test('register từ chối email/mật khẩu/tên quá dài dù body nhỏ', async () => {
  const worker = await loadWorker();
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { last_row_id: 1 } }) }) }) } };
  const res = await worker.fetch(jsonRequest('/api/user/register', 'POST', {
    email: 'a@b.com', password: 'x'.repeat(300), name: 'ok',
  }), env, {});
  assert.equal(res.status, 400);
});

test('login từ chối payload khai báo Content-Length vượt giới hạn trước khi đọc body', async () => {
  const worker = await loadWorker();
  const req = new Request('https://test.invalid/api/user/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(10 * 1024 * 1024) },
    body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
  });
  const res = await worker.fetch(req, {}, {});
  assert.equal(res.status, 413);
});

test('progress CFI position quá dài bị từ chối', async () => {
  const worker = await loadWorker();
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ id: 1, email: 'a@b.com', name: 'A', expires_at: '2999-01-01T00:00:00.000Z' }),
          run: async () => ({}),
        }),
      }),
    },
  };
  const req = jsonRequest('/api/user/progress/demo-slug', 'PUT', { type: 'epub', position: bigString(2001) });
  req.headers.set('Authorization', 'Bearer u_faketoken');
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 400);
});

test('glossary update từ chối payload vượt giới hạn 2 MiB', async (t) => {
  const worker = await loadWorker();
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200 }));
  const bigGlossary = {};
  for (let i = 0; i < 50000; i++) bigGlossary[`term_${i}`] = 'x'.repeat(50);
  const env = {
    BACKEND_URL: 'https://backend.invalid',
    CHAPTERS: { put: async () => {} },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
  };
  const req = jsonRequest('/api/novels/demo/glossary', 'POST', { glossary: bigGlossary });
  req.headers.set('Authorization', 'Bearer admintoken');
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 413);
});
