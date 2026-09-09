import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

async function setup(t) {
  const mf = new Miniflare({modules:true, script:await readFile(new URL('../../src/index.js',import.meta.url),'utf8'),
    compatibilityDate:'2026-05-07',compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'],r2Buckets:['CHAPTERS'],bindings:{SYNC_KEY:'test-secret',ALLOW_SYNC_WRITES:'true'},
    outboundService: () => new Response('External requests disabled in tests',{status:503}),
  });
  t.after(()=>mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = (await readFile(new URL('../../schema.sql',import.meta.url),'utf8')).replace(/--[^\n]*/g,'');
  await db.batch(schema.split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
  const bucket = await mf.getR2Bucket('CHAPTERS');
  const call = (path,init) => mf.dispatchFetch(`http://test.invalid/api/${path}`,init);
  const sync = chapters => call('admin/sync-novel',{method:'POST',headers:{'x-sync-key':'test-secret'},
    body:JSON.stringify({slug:'demo',title:'Demo',chapters,is_first_chunk:true,total_chapter_count:10})});
  return {db,bucket,call,sync};
}
const chapter = number => ({filename:`Chương ${number}.md`,title:`Chương ${number}`,number,content:`# Chương ${number}\n\nContent`});

test('D1 bootstrap supports public list and EPUB, sync is concurrent and repeatable', async t => {
  const {db,bucket,call,sync} = await setup(t);
  const replies = await Promise.all([sync([chapter(1)]),sync([chapter(2)])]);
  for (const reply of replies) assert.equal(reply.status,200,await reply.text());
  assert.equal((await sync([chapter(1)])).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chapters').first()).n,2);
  await bucket.put('demo/catalog.json',JSON.stringify([chapter(3)].map(c=>({...c,chapter_number:c.number}))));
  const catalog = await (await call('novels/demo/chapters')).json();
  assert.deepEqual(catalog.map(c=>c.chapter_number),[1,2,3]);
  const list = await call('novels');
  assert.equal(list.status,200,await list.clone().text());
  assert.equal((await list.json()).novels[0].chapter_count,2);
  assert.equal((await call('novels/demo/epub')).status,404);
  await bucket.put('demo/book.epub','epub fixture');
  assert.equal((await call('novels/demo/epub')).status,200);
  assert.equal((await (await call('novels/demo/chapters/1')).json()).content,chapter(1).content);
});

test('conflicting writes never overwrite the winner without its current key', async t => {
  const {db,call,sync} = await setup(t);
  const replies = await Promise.all([sync([chapter(1)]),sync([{...chapter(1),content:'changed'}])]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  const winner = await db.prepare('SELECT r2_key FROM chapters').first();
  assert.equal((await sync([{...chapter(1),content:'replacement'}])).status,409);
  assert.equal((await sync([{...chapter(1),content:'replacement',expected_r2_key:winner.r2_key}])).status,200);
  assert.match((await (await call('novels/demo/chapters/1')).json()).content,/replacement/);
});

test('invalid and oversized chunks do not write metadata or objects', async t => {
  const {db,bucket,sync} = await setup(t);
  for (const chapters of [[{...chapter(1),filename:'../evil'}],[chapter(1),chapter(1)],[],[...Array(26)].map((_,i)=>chapter(i+1))]) {
    assert.equal((await sync(chapters)).status,400);
  }
  assert.equal((await sync([{...chapter(1),content:'x'.repeat(2*1024*1024)}])).status,413);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM novels').first()).n,0);
  assert.equal((await bucket.list()).objects.length,0);
});

test('R2/D1 failures are retryable without publishing broken pointers', async t => {
  const {db,bucket} = await setup(t);
  const {loadWorker} = await import('./harness.mjs');
  const worker = await loadWorker();
  const req = () => new Request('http://test.invalid/api/admin/sync-novel', {method:'POST',headers:{'x-sync-key':'test-secret'},
    body:JSON.stringify({slug:'demo',chapters:[chapter(1)]})});
  const env = {SYNC_KEY:'test-secret',ALLOW_SYNC_WRITES:'true',DB:db,CHAPTERS:{put:async()=>{throw new Error('R2 unavailable');}}};
  assert.equal((await worker.fetch(req(),env,{})).status,500);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chapters').first()).n,0);
  env.CHAPTERS=bucket;
  env.DB={prepare:sql=>db.prepare(sql),batch:async()=>{throw new Error('D1 unavailable');}};
  assert.equal((await worker.fetch(req(),env,{})).status,500);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chapters').first()).n,0);
  assert.equal((await bucket.list()).objects.length,1);
  env.DB=db;
  assert.equal((await worker.fetch(req(),env,{})).status,200);
  assert.equal((await worker.fetch(req(),env,{})).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chapters').first()).n,1);
  assert.equal((await bucket.list()).objects.length,1);
});
