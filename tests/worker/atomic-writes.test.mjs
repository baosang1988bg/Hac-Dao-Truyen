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
    outboundService: () => new Response('External requests disabled in tests', { status: 503 }),
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  await db.prepare(`INSERT INTO novels (slug, title) VALUES ('demo', 'Demo')`).run();
  await db.prepare(`INSERT INTO users (id, email, password_hash) VALUES (1, 'a@b.com', 'x')`).run();
  await db.prepare(`INSERT INTO user_sessions (token, user_id, expires_at) VALUES ('u_faketoken', 1, '2999-01-01 00:00:00')`).run();
  const call = (path, init = {}) => mf.dispatchFetch(`http://test.invalid/api/${path}`, {
    ...init,
    headers: { Authorization: 'Bearer u_faketoken', 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return { db, call };
}

test('F01: hai comment gửi đồng thời chỉ 1 cái được ghi trong cửa sổ cooldown 20s', async t => {
  const { db, call } = await setup(t);
  const post = () => call('novels/demo/comments', { method: 'POST', body: JSON.stringify({ content: 'hello', chapter: 1 }) });
  const [a, b] = await Promise.all([post(), post()]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 429]);
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM comments').first();
  assert.equal(n, 1);
});

test('F01: quota pending novel-request không bị vượt khi gửi đồng thời', async t => {
  const { db, call } = await setup(t);
  const post = (url) => call('novel-requests', { method: 'POST', body: JSON.stringify({ url, note: '' }) });
  const results = await Promise.all([
    post('https://a.example/1'),
    post('https://a.example/2'),
    post('https://a.example/3'),
    post('https://a.example/4'),
    post('https://a.example/5'),
    post('https://a.example/6'),
  ]);
  const okCount = results.filter(r => r.status === 201).length;
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM novel_requests WHERE user_id = 1 AND status = 'pending'`).first();
  assert.equal(n, okCount);
  assert.equal(okCount, 3, 'MAX_PENDING_NOVEL_REQUESTS = 3, quota phải chặn đúng dù 6 request đồng thời');
});
