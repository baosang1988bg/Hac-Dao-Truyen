// Test đợt "học từ đối thủ": lượt đọc thật (token HMAC), BXH theo kỳ, góp ý
// name + quy tắc thay thế công khai, đồng bộ prefs, tiến độ theo đoạn, JSON-LD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

const SECRET = 'test-view-secret-0123456789';
// read-start cũng bị giới hạn 20/phút/IP — test chính nằm trong test 'read-start'.

async function setup(t, { bindings = { VIEW_TOKEN_SECRET: SECRET }, withMigration = true, backend } = {}) {
  const mf = new Miniflare({
    modules: true,
    script: await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-05-07',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['CHAPTERS'],
    bindings: { ...bindings, ...(backend ? { BACKEND_URL: 'http://backend.test' } : {}) },
    outboundService: backend || (() => new Response('External requests disabled in tests', { status: 503 })),
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  let schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  if (!withMigration) {
    // Giả lập production CHƯA chạy migration 015.
    schema = schema.split(';').filter(s => !/novel_views_daily|glossary_suggestions|user_prefs/.test(s)).join(';');
  }
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  await db.prepare(`INSERT INTO novels (slug, title, author, genre, synopsis, published, rating_sum, rating_count) VALUES ('demo', 'Demo </script> Truyện', 'Tác Giả', 'Tiên hiệp, Huyền huyễn', 'Giới thiệu', 1, 9, 2)`).run();
  await db.prepare(`INSERT INTO novels (slug, title, published) VALUES ('hidden', 'Hidden', 0)`).run();
  await db.prepare(`INSERT INTO novels (slug, title, published) VALUES ('other', 'Other', 1)`).run();
  await db.prepare(`INSERT INTO users (id, email, name, password_hash) VALUES (1, 'a@b.com', 'An', 'x')`).run();
  await db.prepare(`INSERT INTO user_sessions (token, user_id, expires_at) VALUES ('u_tok1', 1, '2999-01-01 00:00:00')`).run();
  const r2 = await mf.getR2Bucket('CHAPTERS');
  const call = (path, { method = 'GET', body, headers = {} } = {}) => mf.dispatchFetch(`http://test.invalid/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { mf, db, r2, call };
}

// Ký token y như Worker nhưng với thời điểm tuỳ chọn (để không phải chờ 30 giây thật).
async function signToken(slug, chapter, issuedMs, secret = SECRET) {
  const nonce = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  const payload = `${slug}.${chapter}.${issuedMs}.${nonce}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))]
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return `${payload}.${sig}`;
}

test('read-start trả token ký HMAC và KHÔNG ghi D1', async t => {
  const { db, call } = await setup(t);
  const res = await call('novels/demo/read-start', { method: 'POST', body: { chapter: 12 } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.token, /^demo\.12\.\d+\.[0-9a-f]{16}\.[0-9a-f]{32}$/);
  assert.equal(data.min_seconds, 30);
  const { views } = await db.prepare(`SELECT views FROM novels WHERE slug='demo'`).first();
  assert.equal(views, 0);
  assert.equal((await call('novels/hidden/read-start', { method: 'POST', body: {} })).status, 404);
});

test('view: token mới phát (chưa đủ 30 giây) bị từ chối, token giả bị từ chối', async t => {
  const { db, call } = await setup(t);
  const { token } = await (await call('novels/demo/read-start', { method: 'POST', body: { chapter: 1 } })).json();
  const early = await call('novels/demo/view', { method: 'POST', body: { token } });
  assert.equal(early.status, 400);
  assert.equal((await early.json()).reason, 'too_early');
  const forged = await signToken('demo', 1, Date.now() - 60_000, 'wrong-secret-xxxxxxxxxxxx');
  assert.equal((await (await call('novels/demo/view', { method: 'POST', body: { token: forged } })).json()).reason, 'bad_token');
  const otherSlug = await signToken('other', 1, Date.now() - 60_000);
  assert.equal((await (await call('novels/demo/view', { method: 'POST', body: { token: otherSlug } })).json()).reason, 'bad_token');
  const expired = await signToken('demo', 1, Date.now() - 7 * 3600_000);
  assert.equal((await (await call('novels/demo/view', { method: 'POST', body: { token: expired } })).json()).reason, 'expired');
  const noToken = await (await call('novels/demo/view', { method: 'POST' })).json();
  assert.equal(noToken.counted, false);
  const { views } = await db.prepare(`SELECT views FROM novels WHERE slug='demo'`).first();
  assert.equal(views, 0);
});

test('view: token hợp lệ cộng tổng + dòng ngày; dùng lại token / cùng chương trong 10 phút không cộng', async t => {
  const { db, call } = await setup(t);
  const token = await signToken('demo', 3, Date.now() - 31_000);
  const first = await (await call('novels/demo/view', { method: 'POST', body: { token } })).json();
  assert.equal(first.counted, true);
  const again = await (await call('novels/demo/view', { method: 'POST', body: { token } })).json();
  assert.equal(again.counted, false);
  const sameChapter = await signToken('demo', 3, Date.now() - 40_000);
  assert.equal((await (await call('novels/demo/view', { method: 'POST', body: { token: sameChapter } })).json()).counted, false);
  // Chương khác nhưng cùng IP trong 1 phút → không cộng (chặn xin token hàng loạt chương).
  const nextChapter = await signToken('demo', 4, Date.now() - 40_000);
  assert.equal((await (await call('novels/demo/view', { method: 'POST', body: { token: nextChapter } })).json()).counted, false);
  const otherIp = await signToken('demo', 4, Date.now() - 40_000);
  assert.equal((await (await call('novels/demo/view', { method: 'POST', body: { token: otherIp }, headers: { 'CF-Connecting-IP': '5.6.7.8' } })).json()).counted, true);
  const { views } = await db.prepare(`SELECT views FROM novels WHERE slug='demo'`).first();
  assert.equal(views, 2);
  const daily = await db.prepare(`SELECT day, views FROM novel_views_daily WHERE slug='demo'`).all();
  assert.equal(daily.results.length, 1);
  assert.equal(daily.results[0].views, 2);
  assert.match(daily.results[0].day, /^\d{4}-\d{2}-\d{2}$/);
});

test('view: không cấu hình secret → giữ hành vi cũ (không cần token)', async t => {
  const { db, call } = await setup(t, { bindings: {} });
  const start = await (await call('novels/demo/read-start', { method: 'POST', body: {} })).json();
  assert.equal(start.token, null);
  const res = await (await call('novels/demo/view', { method: 'POST' })).json();
  assert.equal(res.counted, true);
  const { views } = await db.prepare(`SELECT views FROM novels WHERE slug='demo'`).first();
  assert.equal(views, 1);
});

test('view: migration 015 chưa chạy vẫn cộng tổng, BXH trả unavailable', async t => {
  const { db, call } = await setup(t, { withMigration: false });
  const token = await signToken('demo', 1, Date.now() - 31_000);
  assert.equal((await (await call('novels/demo/view', { method: 'POST', body: { token } })).json()).counted, true);
  const { views } = await db.prepare(`SELECT views FROM novels WHERE slug='demo'`).first();
  assert.equal(views, 1);
  const rank = await (await call('rankings/views?period=week')).json();
  assert.equal(rank.unavailable, true);
  assert.deepEqual(rank.items, []);
  assert.equal((await call('user/prefs', { headers: { Authorization: 'Bearer u_tok1' } })).status, 200);
  assert.equal((await call('novels/demo/glossary-suggestions', {
    method: 'POST', headers: { Authorization: 'Bearer u_tok1' }, body: { from: 'ab', to: 'cd' },
  })).status, 503);
});

test('BXH theo kỳ: cộng đúng cửa sổ ngày, bỏ truyện bị gỡ, kiểm tra period', async t => {
  const { db, call } = await setup(t);
  const vn = ms => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO novel_views_daily VALUES ('demo', ?, 5)`).bind(vn(now)),
    db.prepare(`INSERT INTO novel_views_daily VALUES ('demo', ?, 100)`).bind(vn(now - 20 * 86400_000)),
    db.prepare(`INSERT INTO novel_views_daily VALUES ('other', ?, 8)`).bind(vn(now - 2 * 86400_000)),
    db.prepare(`INSERT INTO novel_views_daily VALUES ('hidden', ?, 999)`).bind(vn(now)),
  ]);
  const day = await (await call('rankings/views?period=day')).json();
  assert.deepEqual(day.items.map(i => [i.slug, i.period_views]), [['demo', 5]]);
  const week = await (await call('rankings/views?period=week')).json();
  assert.deepEqual(week.items.map(i => [i.slug, i.period_views]), [['other', 8], ['demo', 5]]);
  const month = await (await call('rankings/views?period=month&limit=1')).json();
  assert.deepEqual(month.items.map(i => [i.slug, i.period_views]), [['demo', 105]]);
  assert.equal(month.items[0].rating, 4.5);
  assert.equal((await call('rankings/views?period=year')).status, 400);
});

test('góp ý name: cần đăng nhập, kiểm tra độ dài, hạn mức pending', async t => {
  const { db, call } = await setup(t);
  const auth = { Authorization: 'Bearer u_tok1' };
  assert.equal((await call('novels/demo/glossary-suggestions', { method: 'POST', body: { from: 'a', to: 'b' } })).status, 401);
  assert.equal((await call('novels/demo/glossary-suggestions', { method: 'POST', headers: auth, body: { from: 'a', to: 'a' } })).status, 400);
  assert.equal((await call('novels/demo/glossary-suggestions', { method: 'POST', headers: auth, body: { from: 'x'.repeat(101), to: 'b' } })).status, 400);
  assert.equal((await call('novels/demo/glossary-suggestions', { method: 'POST', headers: auth, body: { from: 'a', to: 'bc' } })).status, 400, 'cụm gốc 1 ký tự');
  assert.equal((await call('novels/demo/glossary-suggestions', { method: 'POST', headers: auth, body: { from: 'Hạ Thìn', to: '![](http://x/t.png)' } })).status, 400, 'chặn markdown');
  assert.equal((await call('novels/demo/glossary-suggestions', { method: 'POST', headers: auth, body: { from: 'Hạ Thìn', to: '<b>x</b>' } })).status, 400, 'chặn HTML');
  assert.equal((await call('novels/hidden/glossary-suggestions', { method: 'POST', headers: auth, body: { from: 'a', to: 'b' } })).status, 404);
  const ok = await call('novels/demo/glossary-suggestions', {
    method: 'POST', headers: auth, body: { from: '  Hạ  Thìn ', to: 'Hạ Thần', original: '夏辰', chapter: 7, note: 'đúng âm' },
  });
  assert.equal(ok.status, 201);
  const row = await db.prepare(`SELECT * FROM glossary_suggestions WHERE id = ?`).bind((await ok.json()).id).first();
  assert.equal(row.from_text, 'Hạ Thìn');
  assert.equal(row.original, '夏辰');
  assert.equal(row.chapter, 7);
  for (let i = 0; i < 19; i++) {
    await db.prepare(`INSERT INTO glossary_suggestions (slug, user_id, from_text, to_text) VALUES ('demo', 1, ?, 'y')`).bind(`f${i}`).run();
  }
  assert.equal((await call('novels/demo/glossary-suggestions', { method: 'POST', headers: auth, body: { from: 'pp', to: 'qq' } })).status, 429);
  const mine = await (await call('user/glossary-suggestions', { headers: auth })).json();
  assert.equal(mine.length, 20);
});

test('duyệt góp ý: chỉ admin; duyệt ghi replacements + glossary R2; không duyệt hai lần', async t => {
  const backend = req => new Response(null, { status: new URL(req.url).pathname === '/api/auth/verify'
    && req.headers.get('Authorization') === 'Bearer admin-token' ? 200 : 401 });
  const { db, r2, call } = await setup(t, { backend });
  await r2.put('demo/glossary.json', JSON.stringify({ '张修': 'Trương Tu' }));
  await db.prepare(`INSERT INTO glossary_suggestions (id, slug, user_id, from_text, to_text, original) VALUES (1, 'demo', 1, 'Hạ Thìn', 'Hạ Thần', '夏辰')`).run();
  await db.prepare(`INSERT INTO glossary_suggestions (id, slug, user_id, from_text, to_text) VALUES (2, 'demo', 1, 'linh khi', 'linh khí')`).run();
  const admin = { Authorization: 'Bearer admin-token' };
  assert.equal((await call('admin/glossary-suggestions')).status, 403);
  assert.equal((await call('admin/glossary-suggestions/1/review', { method: 'POST', headers: { Authorization: 'Bearer u_tok1' }, body: { status: 'approved' } })).status, 403);
  const list = await (await call('admin/glossary-suggestions?status=pending', { headers: admin })).json();
  assert.equal(list.length, 2);
  assert.equal(list[0].user_name, 'An');

  const res = await call('admin/glossary-suggestions/1/review', { method: 'POST', headers: admin, body: { status: 'approved', to: 'Hạ Thần Tử' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).applied_glossary, true);
  const glossary = await (await r2.get('demo/glossary.json')).json();
  assert.deepEqual(glossary, { '张修': 'Trương Tu', '夏辰': 'Hạ Thần Tử' });
  assert.equal((await db.prepare(`SELECT glossary_count FROM novels WHERE slug='demo'`).first()).glossary_count, 2);
  // Không có chữ gốc → chỉ thêm quy tắc thay thế, không đụng glossary.
  const res2 = await (await call('admin/glossary-suggestions/2/review', { method: 'POST', headers: admin, body: { status: 'approved' } })).json();
  assert.equal(res2.applied_glossary, false);
  const pub = await (await call('novels/demo/replacements')).json();
  assert.deepEqual(pub.rules, [{ from: 'Hạ Thìn', to: 'Hạ Thần Tử' }, { from: 'linh khi', to: 'linh khí' }]);
  assert.equal((await call('admin/glossary-suggestions/1/review', { method: 'POST', headers: admin, body: { status: 'rejected' } })).status, 409);
  const actions = await db.prepare(`SELECT action FROM admin_actions ORDER BY id`).all();
  assert.deepEqual(actions.results.map(r => r.action), ['glossary_suggestion_approved', 'glossary_suggestion_approved']);
  assert.equal((await call('novels/hidden/replacements')).status, 404);
});

test('prefs: lưu/đọc, chặn khoá lạ, chặn request cũ ghi đè bản mới', async t => {
  const { call } = await setup(t);
  const auth = { Authorization: 'Bearer u_tok1' };
  assert.equal((await call('user/prefs')).status, 401);
  assert.deepEqual((await (await call('user/prefs', { headers: auth })).json()).prefs, null);
  const prefs = { v: 1, reader: { fontSize: 22, theme: 'dark' }, replacements: { demo: [{ from: 'a', to: 'b', updatedAt: 1 }] } };
  assert.equal((await call('user/prefs', { method: 'PUT', headers: auth, body: { prefs, client_updated_at: 2000 } })).status, 200);
  const got = await (await call('user/prefs', { headers: auth })).json();
  assert.deepEqual(got.prefs, prefs);
  assert.equal(got.client_updated_at, 2000);
  assert.equal((await call('user/prefs', { method: 'PUT', headers: auth, body: { prefs: { v: 1 }, client_updated_at: 1000 } })).status, 409);
  // Mốc ở tương lai xa bị kẹp về ≤ giờ server + 5 phút.
  const future = await (await call('user/prefs', { method: 'PUT', headers: auth, body: { prefs: { v: 1 }, client_updated_at: Date.now() + 10 * 86400_000 } })).json();
  assert.ok(future.client_updated_at <= Date.now() + 5 * 60_000 + 1000);
  assert.equal((await call('user/prefs', { method: 'PUT', headers: auth, body: { prefs: { evil: 1 } } })).status, 400);
  assert.equal((await call('user/prefs', { method: 'PUT', headers: auth, body: { prefs: [1] } })).status, 400);
  const huge = { v: 1, reader: { pad: 'x'.repeat(60 * 1024) } };
  assert.equal((await call('user/prefs', { method: 'PUT', headers: auth, body: { prefs: huge } })).status, 413);
});

test('tiến độ đọc: paragraph lưu thành "chương#pđoạn", client cũ giữ định dạng cũ', async t => {
  const { db, call } = await setup(t);
  const auth = { Authorization: 'Bearer u_tok1' };
  assert.equal((await call('user/progress/demo', { method: 'PUT', headers: auth, body: { chapter: 12, paragraph: 34 } })).status, 200);
  assert.equal((await db.prepare(`SELECT position FROM reading_progress WHERE slug='demo'`).first()).position, '12#p34');
  assert.equal((await call('user/progress/demo', { method: 'PUT', headers: auth, body: { chapter: 13 } })).status, 200);
  assert.equal((await db.prepare(`SELECT position FROM reading_progress WHERE slug='demo'`).first()).position, '13');
  await call('user/progress/demo', { method: 'PUT', headers: auth, body: { chapter: 14, paragraph: -1 } });
  assert.equal((await db.prepare(`SELECT position FROM reading_progress WHERE slug='demo'`).first()).position, '14');
});

test('chi tiết truyện công khai có rating/rating_count thật', async t => {
  const { call } = await setup(t);
  const data = await (await call('novels/demo')).json();
  assert.equal(data.rating, 4.5);
  assert.equal(data.rating_count, 2);
});

test('SEO: trang truyện có JSON-LD Book + Breadcrumb (escape </script>), trang chương có title riêng', async t => {
  // SPA fallback + HTMLRewriter cần binding ASSETS → dựng Worker riêng có ASSETS giả.
  const html = '<!doctype html><html><head><title>Hắc Đạo Truyện</title><meta name="description" content="x"></head><body></body></html>';
  const mf2 = new Miniflare({
    modules: true,
    script: await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-05-07',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['CHAPTERS'],
    bindings: { SITE_ORIGIN: 'https://hacdaotruyen.com' },
    serviceBindings: {
      ASSETS: req => new URL(req.url).pathname === '/index.html' || new URL(req.url).pathname === '/'
        ? new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        : new Response('nf', { status: 404 }),
    },
  });
  t.after(() => mf2.dispose());
  const db = await mf2.getD1Database('DB');
  const schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  await db.prepare(`INSERT INTO novels (slug, title, author, genre, synopsis, published, rating_sum, rating_count) VALUES ('demo', 'Demo </script> Truyện', 'Tác Giả', 'Tiên hiệp', 'Giới thiệu', 1, 9, 2)`).run();

  const novelHtml = await (await mf2.dispatchFetch('http://test.invalid/novel/demo')).text();
  const blocks = [...novelHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const book = blocks.find(b => b['@type'] === 'Book');
  assert.ok(book, 'có JSON-LD Book');
  assert.equal(book.name, 'Demo </script> Truyện');
  assert.equal(book.aggregateRating.ratingValue, 4.5);
  assert.equal(book.author.name, 'Tác Giả');
  assert.ok(blocks.find(b => b['@type'] === 'BreadcrumbList'));
  assert.ok(!/Demo <\/script> Truyện","url/.test(novelHtml), '"</script>" trong dữ liệu phải được escape');

  const chapterHtml = await (await mf2.dispatchFetch('http://test.invalid/novel/demo/read/12')).text();
  assert.match(chapterHtml, /<title>Chương 12 – Demo &lt;\/script&gt; Truyện – Hắc Đạo Truyện<\/title>/);
  assert.match(chapterHtml, /rel="canonical" href="https:\/\/hacdaotruyen\.com\/novel\/demo\/read\/12"/);
  assert.match(chapterHtml, /og:type" content="article"/);
  const chBlocks = [...chapterHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  assert.equal(chBlocks.find(b => b['@type'] === 'BreadcrumbList').itemListElement.length, 3);
  assert.ok(!chBlocks.find(b => b['@type'] === 'Book'));
  // Tham số chương không phải số → giữ index gốc (không sinh canonical tự do).
  assert.equal(await (await mf2.dispatchFetch('http://test.invalid/novel/demo/read/abc%C3%A1')).text(), html);
});
