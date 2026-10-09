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
    bindings: { BACKEND_URL: 'https://backend.invalid' },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  await db.prepare(`INSERT INTO novels (slug, title, status) VALUES
    ('som-dang-luc-the-gioi-tro-choi-bat-dau-thong-gia-nu-de', 'Sớm Đăng Lục Thế Giới Trò Chơi, Bắt Đầu Thông Gia Nữ Đế', 'ongoing'),
    ('lanh-chua-cau-sinh', 'Lãnh Chúa Cầu Sinh', 'ongoing')`).run();
  return (q) => mf.dispatchFetch(`http://test.invalid/api/novels?q=${encodeURIComponent(q)}`)
    .then(r => r.json()).then(d => d.novels.map(n => n.slug));
}

// SQLite LOWER() chỉ hạ chữ ASCII còn JS toLowerCase() hạ cả "Đ" → trước đây
// mọi tên truyện có chữ hoa có dấu (Đ, Ấ, Ổ…) đều không tìm được.
test('tìm được truyện có chữ hoa có dấu, gõ có dấu hoặc không dấu', async t => {
  const search = await setup(t);
  const slug = 'som-dang-luc-the-gioi-tro-choi-bat-dau-thong-gia-nu-de';
  for (const q of ['Sớm Đăng Lục', 'sớm đăng lục', 'Nữ Đế', 'som dang luc', 'thong gia nu de']) {
    assert.deepEqual(await search(q), [slug], q);
  }
});

test('tìm kiếm cũ vẫn chạy và không khớp bừa', async t => {
  const search = await setup(t);
  assert.deepEqual(await search('Lãnh Chúa'), ['lanh-chua-cau-sinh']);
  assert.deepEqual(await search('không có truyện này'), []);
});
