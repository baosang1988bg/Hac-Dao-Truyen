import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker } from './harness.mjs';

const request = (path, method='GET', token, body) => new Request(`https://test.invalid/api/${path}`, {
  method, headers: token ? {Authorization: `Bearer ${token}`} : {},
  ...(body ? {body: JSON.stringify(body)} : {}),
});

test('admin session lifecycle preserves backend status, body, query and headers', async t => {
  const worker = await loadWorker();
  let valid = false;
  t.mock.method(globalThis, 'fetch', async req => {
    const path = new URL(req.url).pathname;
    assert.equal(new URL(req.url).origin, 'https://backend.invalid');
    if (path.endsWith('/login')) {
      assert.equal(req.method, 'POST');
      assert.equal(new URL(req.url).search, '?from=admin');
      if ((await req.json()).password !== 'correct') return Response.json({detail: 'Wrong password'}, {status: 401});
      valid = true;
      return Response.json({token: 'session'});
    }
    if (!valid || req.headers.get('Authorization') !== 'Bearer session') return Response.json({detail: 'Unauthorized'}, {status: 401});
    if (path.endsWith('/logout')) { assert.equal(req.method, 'POST'); valid = false; }
    return Response.json({status: 'valid'});
  });
  const env = {BACKEND_URL: 'https://backend.invalid'};
  const call = req => worker.fetch(req, env, {});
  assert.equal((await call(request('auth/login?from=admin','POST',null,{password:'wrong'}))).status,401);
  assert.deepEqual(await (await call(request('auth/login?from=admin','POST',null,{password:'correct'}))).json(),{token:'session'});
  assert.equal((await call(request('auth/verify','GET','wrong'))).status,401);
  assert.equal((await call(request('auth/verify','GET','session'))).status,200);
  assert.equal((await call(request('auth/logout','POST','session'))).status,200);
  assert.equal((await call(request('auth/verify','GET','session'))).status,401);
});

test('unavailable backend and invalid routes do not silently succeed', async t => {
  const worker = await loadWorker();
  assert.equal((await worker.fetch(request('auth/login','POST'), {}, {})).status,503);
  t.mock.method(globalThis, 'fetch', async () => {throw new Error('offline');});
  assert.equal((await worker.fetch(request('auth/login','POST'), {BACKEND_URL:'https://backend.invalid'}, {})).status,502);
  assert.equal((await worker.fetch(request('auth/login'), {}, {})).status,405);
  assert.equal((await worker.fetch(request('auth/login-extra','POST'), {}, {})).status,404);
});

test('admin sync-usage proxies to backend when BACKEND_URL is set', async t => {
  const worker = await loadWorker();
  t.mock.method(globalThis, 'fetch', async req => {
    assert.equal(new URL(req.url).pathname, '/api/admin/sync-usage');
    assert.equal(req.headers.get('Authorization'), 'Bearer session');
    return Response.json({ available: true, r2_ops: 1, note: 'ước lượng cục bộ' });
  });
  const env = { BACKEND_URL: 'https://backend.invalid' };
  const res = await worker.fetch(request('admin/sync-usage', 'GET', 'session'), env, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { available: true, r2_ops: 1, note: 'ước lượng cục bộ' });
});

test('admin sync-usage returns 503 without BACKEND_URL', async () => {
  const worker = await loadWorker();
  const res = await worker.fetch(request('admin/sync-usage', 'GET', 'session'), {}, {});
  assert.equal(res.status, 503);
});

test('health reads catalog and metadata, missing novel is 404', async () => {
  const worker = await loadWorker();
  const env = {
    DB: {prepare: () => ({bind: slug => ({first: async () => slug === 'demo' ? {total_chapters: 7} : null, all: async () => ({results:[{filename:'one'},{filename:'two'}]})})})},
    CHAPTERS: {get: async () => ({json: async () => [{filename:'two'},{filename:'three'}]})},
  };
  const res = await worker.fetch(request('novels/demo/health'),env,{});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{summary:{total_translated:3,total_raw:7},issues:[]});
  assert.equal((await worker.fetch(request('novels/missing/health'),env,{})).status,404);
});
