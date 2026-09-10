import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker } from './harness.mjs';

const request = (qs) => new Request(`https://test.invalid/api/proxy-cover?${qs}`);

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SVG_WITH_SCRIPT = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML_BODY = new TextEncoder().encode('<html><body>not an image</body></html>');

function mockUpstream(t, { body, contentType, contentLength }) {
  t.mock.method(globalThis, 'fetch', async () => new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      ...(contentLength !== undefined ? { 'Content-Length': String(contentLength) } : {}),
    },
  }));
}

test('proxy-cover chặn SVG chủ động dù server nguồn khai Content-Type image/svg+xml', async t => {
  const worker = await loadWorker();
  mockUpstream(t, { body: SVG_WITH_SCRIPT, contentType: 'image/svg+xml' });
  const res = await worker.fetch(request('url=https://cdn.example.com/cover.svg'), {}, {});
  assert.equal(res.status, 415);
});

test('proxy-cover chặn HTML giả dạng ảnh (Content-Type sai)', async t => {
  const worker = await loadWorker();
  mockUpstream(t, { body: HTML_BODY, contentType: 'image/jpeg' });
  const res = await worker.fetch(request('url=https://cdn.example.com/cover.jpg'), {}, {});
  assert.equal(res.status, 415);
});

test('proxy-cover trả về ảnh raster hợp lệ với Content-Type đã sniff, không tin header gốc', async t => {
  const worker = await loadWorker();
  mockUpstream(t, { body: PNG_BYTES, contentType: 'application/octet-stream' });
  const res = await worker.fetch(request('url=https://cdn.example.com/cover.png'), {}, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...buf], [...PNG_BYTES]);
});

test('proxy-cover từ chối ảnh vượt giới hạn kích thước khai báo qua Content-Length', async t => {
  const worker = await loadWorker();
  mockUpstream(t, { body: PNG_BYTES, contentType: 'image/png', contentLength: 9 * 1024 * 1024 });
  const res = await worker.fetch(request('url=https://cdn.example.com/big.png'), {}, {});
  assert.equal(res.status, 502);
});

test('proxy-cover từ chối ảnh vượt giới hạn byte thật dù Content-Length khai báo thấp hơn', async t => {
  const worker = await loadWorker();
  const bigButLyingLength = new Uint8Array(9 * 1024 * 1024);
  bigButLyingLength.set(PNG_BYTES);
  mockUpstream(t, { body: bigButLyingLength, contentType: 'image/png', contentLength: 100 });
  const res = await worker.fetch(request('url=https://cdn.example.com/lied.png'), {}, {});
  assert.equal(res.status, 502);
});

test('proxy-cover từ chối MIME thiếu/không nhận diện được (fail closed)', async t => {
  const worker = await loadWorker();
  mockUpstream(t, { body: new Uint8Array([1, 2, 3, 4]), contentType: '' });
  const res = await worker.fetch(request('url=https://cdn.example.com/unknown'), {}, {});
  assert.equal(res.status, 415);
});

test('proxy-cover vẫn chặn URL nội bộ/không hợp lệ trước khi fetch (SSRF cơ bản)', async () => {
  const worker = await loadWorker();
  const res = await worker.fetch(request('url=http://127.0.0.1/secret.png'), {}, {});
  assert.equal(res.status, 400);
});
