import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWorker} from './harness.mjs';
const req=(path='missing',headers={})=>new Request(`https://test.invalid/api/${path}`,{method:'POST',headers});

test('rate limit returns retry timing, expires and cannot be bypassed with a fake key', async t=>{
  const worker=await loadWorker();let now=1000;t.mock.method(Date,'now',()=>now);
  for(let i=0;i<10;i++)assert.equal((await worker.fetch(req('auth/login'),{},{})).status,503);
  const limited=await worker.fetch(req('auth/login'),{},{});
  assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
  now+=61000;assert.equal((await worker.fetch(req('auth/login'),{},{})).status,503);
  let publicCalls=0;let syncCalls=0;
  const env={SYNC_KEY:'secret',PUBLIC_RATE_LIMITER:{limit:async()=>{publicCalls++;return {success:true};}},SYNC_RATE_LIMITER:{limit:async()=>{syncCalls++;return {success:true};}}};
  assert.equal((await worker.fetch(req('admin/sync-novel',{'x-sync-key':'wrong'}),env,{})).status,401);
  assert.equal(publicCalls,1);assert.equal(syncCalls,0);
  assert.equal((await worker.fetch(req('admin/sync-novel',{'x-sync-key':'secret'}),env,{})).status,503);
  assert.equal(syncCalls,1);
});

test('binding errors fail closed for login and use local fallback for public reads',async()=>{
  const worker=await loadWorker();const broken={limit:async()=>{throw new Error('offline');}};
  assert.equal((await worker.fetch(req('auth/login'),{AUTH_RATE_LIMITER:broken},{})).status,503);
  assert.equal((await worker.fetch(req(),{PUBLIC_RATE_LIMITER:broken},{})).status,404);
});

test('separate isolates consult the configured shared binding',async()=>{
  let calls=0;const binding={limit:async()=>({success:++calls<=1})};
  const env={PUBLIC_RATE_LIMITER:binding};
  const a=await loadWorker(),b=await loadWorker();
  assert.equal((await a.fetch(req(),env,{})).status,404);
  assert.equal((await b.fetch(req(),env,{})).status,429);
});

test('Drive fallback reads content without creating paid cache writes by default',async t=>{
  const worker=await loadWorker();
  t.mock.method(globalThis,'fetch',async()=>Response.json([{filename:'Chương 1.md',number:1,title:'Chương 1',content:'body'}]));
  const env={
    DB:{prepare:()=>({bind:()=>({first:async()=>null,all:async()=>({results:[]}),run:async()=>assert.fail('D1 write')})})},
    CHAPTERS:{get:async key=>key==='upload_state.json'?{json:async()=>({uploaded:{demo:{files:{chapters:{id:'fixture'}}}}})}:null,
      put:async()=>assert.fail('R2 write')},
  };
  const res=await worker.fetch(new Request('https://test.invalid/api/novels/demo/chapters/1'),env,{});
  assert.equal(res.status,200);assert.match((await res.json()).content,/body/);
});
