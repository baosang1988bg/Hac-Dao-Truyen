// Đăng nhập Google an toàn + quản lý tài khoản (migration 017).
// Khoá RSA sinh trong test, JWKS giả qua outboundService — không gọi Google thật.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const AUTH_SECRET = 'auth-secret-for-tests-0123456789abcdef';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const b64url = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function makeKey(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}

async function signJwt(key, claims, header = {}) {
  const h = enc({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const p = enc(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

function claims(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'g-sub-1', email: 'reader@gmail.com',
    email_verified: true, name: 'Độc Giả', picture: 'https://lh3.googleusercontent.com/a/x', iat: now, exp: now + 3600,
    ...over,
  };
}

async function setup(t, { withMigration = true, bindings = {} } = {}) {
  const key = await makeKey('k1');
  const other = await makeKey('k-other');
  let jwksCalls = 0;
  const mf = new Miniflare({
    modules: true,
    script: await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
    compatibilityDate: '2026-05-07',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['CHAPTERS'],
    bindings: { GOOGLE_CLIENT_ID: CLIENT_ID, AUTH_SECRET, ...bindings },
    outboundService: req => {
      if (req.url === JWKS_URL) {
        jwksCalls++;
        return new Response(JSON.stringify({ keys: [key.jwk] }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }
      return new Response('blocked', { status: 503 });
    },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  let schema = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
  if (!withMigration) {
    // Bỏ các cột của migration 017 để giả lập production chưa chạy migration.
    schema = schema
      .replace(/,\s*email_verified_at TEXT,\s*last_login_at\s+TEXT,\s*deleted_at\s+TEXT/, '')
      .replace(/created_at TEXT,\s*user_agent TEXT,\s*/, '');
  }
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  await db.prepare(`INSERT INTO novels (slug, title, published) VALUES ('demo', 'Demo', 1)`).run();
  const call = (path, { method = 'GET', body, token, headers = {} } = {}) => mf.dispatchFetch(`http://test.invalid/api/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${Math.floor(Math.random() * 250)}`,
      'User-Agent': 'TestBrowser/1.0', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const nonce = async () => (await (await call('user/google-nonce')).json()).nonce;
  const googleLogin = async (over = {}, { useNonce = true, signer = key, header } = {}) => {
    const n = useNonce ? await nonce() : undefined;
    const credential = await signJwt(signer, claims({ ...(n ? { nonce: n } : {}), ...over }), header);
    return call('user/google-login', { method: 'POST', body: { credential } });
  };
  return { mf, db, call, key, other, nonce, googleLogin, jwksCalls: () => jwksCalls };
}

test('Google: token hợp lệ tạo tài khoản mới, email đã xác minh, session có user_agent', async t => {
  const { db, call, googleLogin } = await setup(t);
  const res = await googleLogin();
  assert.equal(res.status, 200);
  const { token, user } = await res.json();
  assert.match(token, /^u_[0-9a-f]{64}$/);
  assert.equal(user.email, 'reader@gmail.com');
  const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(user.id).first();
  assert.equal(row.google_id, 'g-sub-1');
  assert.equal(row.password_hash, '');
  assert.ok(row.email_verified_at);
  assert.ok(row.last_login_at);
  const sess = await db.prepare(`SELECT user_agent, created_at FROM user_sessions WHERE token = ?`).bind(token).first();
  assert.equal(sess.user_agent, 'TestBrowser/1.0');
  assert.ok(sess.created_at);
  const me = await (await call('user/me', { token })).json();
  assert.equal(me.has_google, true);
  assert.equal(me.has_password, false);
  assert.equal(me.email_verified, true);
  assert.equal(me.avatar_url, 'https://lh3.googleusercontent.com/a/x');
  // Đăng nhập lại cùng sub → cùng tài khoản.
  const again = await (await googleLogin()).json();
  assert.equal(again.user.id, user.id);
});

test('Google: từ chối token sai aud/iss/hết hạn/sai chữ ký/kid lạ/alg lạ/email chưa xác minh', async t => {
  const { googleLogin, other } = await setup(t);
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await googleLogin({ aud: 'other-client' })).status, 401);
  assert.equal((await googleLogin({ iss: 'https://evil.example' })).status, 401);
  assert.equal((await googleLogin({ exp: now - 600, iat: now - 4000 })).status, 401);
  assert.equal((await googleLogin({ iat: now + 3600 })).status, 401);
  // Ký bằng khoá khác nhưng mạo danh kid hợp lệ → sai chữ ký.
  assert.equal((await googleLogin({}, { signer: { ...other, kid: 'k1' } })).status, 401);
  assert.equal((await googleLogin({}, { signer: other })).status, 401, 'kid không có trong JWKS');
  assert.equal((await googleLogin({}, { header: { alg: 'none' } })).status, 401);
  const unverified = await googleLogin({ email_verified: false });
  assert.equal(unverified.status, 403);
});

test('Google: nonce bắt buộc khi có AUTH_SECRET — thiếu, giả, dùng lại đều bị từ chối', async t => {
  const { call, key, googleLogin } = await setup(t);
  assert.equal((await googleLogin({}, { useNonce: false })).status, 401);
  assert.equal((await googleLogin({ nonce: `${Date.now()}.${'a'.repeat(24)}.${'b'.repeat(32)}` }, { useNonce: false })).status, 401);
  const n = (await (await call('user/google-nonce')).json()).nonce;
  const cred = await signJwt(key, claims({ nonce: n }));
  assert.equal((await call('user/google-login', { method: 'POST', body: { credential: cred } })).status, 200);
  assert.equal((await call('user/google-login', { method: 'POST', body: { credential: cred } })).status, 401, 'phát lại cùng token/nonce');
});

test('Google: không có AUTH_SECRET → nonce null, vẫn verify chữ ký đầy đủ', async t => {
  const { call, googleLogin } = await setup(t, { bindings: { AUTH_SECRET: '' } });
  assert.equal((await (await call('user/google-nonce')).json()).nonce, null);
  assert.equal((await googleLogin({}, { useNonce: false })).status, 200);
  assert.equal((await googleLogin({ aud: 'x' }, { useNonce: false })).status, 401);
});

test('Google: chưa cấu hình GOOGLE_CLIENT_ID → 503', async t => {
  const { call } = await setup(t, { bindings: { GOOGLE_CLIENT_ID: '' } });
  assert.equal((await call('user/google-login', { method: 'POST', body: { credential: 'a.b.c' } })).status, 503);
});

test('Liên kết: tài khoản email có mật khẩu CHƯA xác minh → xoá mật khẩu + mọi session cũ (chống chiếm tài khoản trước)', async t => {
  const { db, call, googleLogin } = await setup(t);
  // Kẻ xấu đăng ký trước bằng email của nạn nhân.
  const reg = await (await call('user/register', { method: 'POST', body: { email: 'reader@gmail.com', password: 'attacker-pass-1', name: 'X' } })).json();
  assert.ok(reg.token);
  const res = await googleLogin();
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.id, reg.user.id);
  const row = await db.prepare(`SELECT password_hash, google_id, email_verified_at FROM users WHERE id = ?`).bind(user.id).first();
  assert.equal(row.password_hash, '', 'mật khẩu của kẻ xấu bị xoá');
  assert.equal(row.google_id, 'g-sub-1');
  assert.ok(row.email_verified_at);
  assert.equal((await call('user/me', { token: reg.token })).status, 401, 'session cũ của kẻ xấu bị thu hồi');
  const login = await call('user/login', { method: 'POST', body: { email: 'reader@gmail.com', password: 'attacker-pass-1' } });
  assert.equal(login.status, 401, 'không đăng nhập lại bằng mật khẩu cũ được');
});

test('Liên kết: tài khoản đã xác minh (từng đăng nhập Google) đặt mật khẩu → đăng nhập Google lại KHÔNG xoá mật khẩu', async t => {
  const { db, call, googleLogin } = await setup(t);
  const { token } = await (await googleLogin()).json();
  assert.equal((await call('user/password', { method: 'POST', token, body: { new_password: 'my-new-pass-1' } })).status, 200);
  // Bỏ liên kết google_id để buộc đi nhánh "cùng email".
  await db.prepare(`UPDATE users SET google_id = NULL`).run();
  assert.equal((await googleLogin()).status, 200);
  assert.ok((await db.prepare(`SELECT password_hash FROM users`).first()).password_hash);
  assert.equal((await call('user/login', { method: 'POST', body: { email: 'reader@gmail.com', password: 'my-new-pass-1' } })).status, 200);
});

test('Mật khẩu: đặt khi chỉ có Google; đổi cần mật khẩu hiện tại (sai → 403); đổi xong đăng xuất máy khác', async t => {
  const { call, googleLogin } = await setup(t);
  const { token } = await (await googleLogin()).json();
  const second = (await (await googleLogin()).json()).token;
  assert.equal((await call('user/password', { method: 'POST', token, body: { new_password: 'short' } })).status, 400);
  assert.equal((await call('user/password', { method: 'POST', token, body: { new_password: 'first-pass-123' } })).status, 200);
  assert.equal((await call('user/me', { token: second })).status, 401, 'máy khác bị đăng xuất');
  assert.equal((await call('user/me', { token })).status, 200, 'máy hiện tại giữ phiên');
  assert.equal((await call('user/password', { method: 'POST', token, body: { new_password: 'second-pass-123' } })).status, 403, 'thiếu mật khẩu hiện tại');
  assert.equal((await call('user/password', { method: 'POST', token, body: { current_password: 'wrong-pass', new_password: 'second-pass-123' } })).status, 403);
  assert.equal((await call('user/password', { method: 'POST', token, body: { current_password: 'first-pass-123', new_password: 'second-pass-123' } })).status, 200);
  assert.equal((await call('user/password', { method: 'POST', body: { new_password: 'x'.repeat(10) } })).status, 401);
});

test('Thiết bị: liệt kê (không lộ token), thu hồi một máy, đăng xuất tất cả', async t => {
  const { call, googleLogin } = await setup(t);
  const a = (await (await googleLogin()).json()).token;
  const b = (await (await googleLogin()).json()).token;
  const list = await (await call('user/sessions', { token: a })).json();
  assert.equal(list.length, 2);
  assert.ok(list.every(s => /^[0-9a-f]{12}$/.test(s.id) && !JSON.stringify(s).includes(a) && !JSON.stringify(s).includes(b)));
  assert.equal(list.filter(s => s.current).length, 1);
  assert.equal(list[0].user_agent, 'TestBrowser/1.0');
  const other = list.find(s => !s.current);
  assert.equal((await call(`user/sessions/${other.id}`, { method: 'DELETE', token: a })).status, 200);
  assert.equal((await call('user/me', { token: b })).status, 401);
  assert.equal((await call('user/sessions/000000000000', { method: 'DELETE', token: a })).status, 404);
  const c = (await (await googleLogin()).json()).token;
  const out = await (await call('user/logout-all', { method: 'POST', token: a })).json();
  assert.equal(out.revoked, 2);
  assert.equal((await call('user/me', { token: a })).status, 401);
  assert.equal((await call('user/me', { token: c })).status, 401);
});

test('Xoá tài khoản: cần gõ đúng email; xoá dữ liệu cá nhân, ẩn danh dòng users, giữ bình luận, tính lại điểm truyện', async t => {
  const { db, call, googleLogin } = await setup(t);
  const { token, user } = await (await googleLogin()).json();
  await call('novels/demo/rate', { method: 'POST', token, body: { stars: 5 } });
  await call('user/bookmarks/demo', { method: 'PUT', token });
  await call('user/progress/demo', { method: 'PUT', token, body: { chapter: 3 } });
  await db.prepare(`INSERT INTO comments (user_id, slug, chapter, content) VALUES (?, 'demo', 1, 'hay')`).bind(user.id).run();
  assert.equal((await db.prepare(`SELECT rating_count FROM novels WHERE slug='demo'`).first()).rating_count, 1);

  assert.equal((await call('user/account', { method: 'DELETE', token, body: { confirm: 'sai@gmail.com' } })).status, 400);
  assert.equal((await call('user/account', { method: 'DELETE', token, body: { confirm: 'READER@gmail.com' } })).status, 200);
  const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(user.id).first();
  assert.equal(row.email, `deleted-${user.id}@invalid`);
  assert.equal(row.name, 'Người dùng đã xoá');
  assert.equal(row.password_hash, '');
  assert.equal(row.google_id, null);
  assert.equal(row.avatar_url, null);
  assert.ok(row.deleted_at);
  for (const tbl of ['user_sessions', 'bookmarks', 'reading_progress', 'novel_ratings', 'user_prefs']) {
    const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM ${tbl} WHERE user_id = ?`).bind(user.id).first();
    assert.equal(n, 0, tbl);
  }
  const novel = await db.prepare(`SELECT rating_sum, rating_count FROM novels WHERE slug='demo'`).first();
  assert.deepEqual([novel.rating_sum, novel.rating_count], [0, 0]);
  const comments = await (await call('novels/demo/comments')).json();
  assert.equal(comments[0].user_name, 'Người dùng đã xoá');
  assert.equal((await call('user/me', { token })).status, 401);
  // Đăng nhập Google lại → tài khoản MỚI (dữ liệu cũ không quay lại).
  const fresh = await (await googleLogin()).json();
  assert.notEqual(fresh.user.id, user.id);
});

test('Chưa chạy migration 017: đăng nhập Google, liên kết an toàn, thiết bị, xoá tài khoản vẫn chạy', async t => {
  const { db, call, googleLogin, nonce, key } = await setup(t, { withMigration: false });
  const reg = await (await call('user/register', { method: 'POST', body: { email: 'reader@gmail.com', password: 'attacker-pass-1' } })).json();
  const res = await googleLogin();
  assert.equal(res.status, 200);
  const { token } = await res.json();
  assert.equal((await db.prepare(`SELECT password_hash FROM users`).first()).password_hash, '');
  assert.equal((await call('user/me', { token: reg.token })).status, 401);
  const me = await (await call('user/me', { token })).json();
  assert.equal(me.email_verified, false, 'không có cột → không khẳng định');
  const list = await (await call('user/sessions', { token })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].created_at, null);
  // Không có cột created_at → không dựa được "phiên mới đăng nhập" → cần id_token Google mới.
  assert.equal((await call('user/account', { method: 'DELETE', token, body: { confirm: 'reader@gmail.com' } })).status, 403);
  const n = await nonce();
  const credential = await signJwt(key, claims({ nonce: n }));
  assert.equal((await call('user/account', { method: 'DELETE', token, body: { confirm: 'reader@gmail.com', credential } })).status, 200);
});

test('Sitemap có trang chính sách bảo mật', async t => {
  const { mf } = await setup(t);
  const xml = await (await mf.dispatchFetch('http://test.invalid/sitemap.xml')).text();
  assert.match(xml, /\/chinh-sach-bao-mat<\/loc>/);
});

test('Review TB-1: email đã gắn Google KHÁC → 409, không ghi đè liên kết', async t => {
  const { db, googleLogin } = await setup(t);
  await googleLogin();
  const res = await googleLogin({ sub: 'g-sub-2' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).reason, 'google_conflict');
  assert.equal((await db.prepare(`SELECT google_id FROM users`).first()).google_id, 'g-sub-1');
});

test('Review TB-2: email không phải Gmail/Workspace trùng tài khoản có sẵn → 409 link_required, KHÔNG xoá mật khẩu', async t => {
  const { db, call, googleLogin } = await setup(t);
  const reg = await (await call('user/register', { method: 'POST', body: { email: 'x@congty.vn', password: 'owner-pass-123' } })).json();
  const res = await googleLogin({ email: 'x@congty.vn' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).reason, 'link_required');
  assert.ok((await db.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(reg.user.id).first()).password_hash);
  assert.equal((await call('user/me', { token: reg.token })).status, 200, 'phiên chủ thật còn nguyên');
  // Workspace (có hd) → được liên kết như Gmail.
  const ws = await googleLogin({ email: 'x@congty.vn', hd: 'congty.vn' });
  assert.equal(ws.status, 200);
  // Email mới không trùng ai → tạo tài khoản bình thường dù không phải Gmail.
  assert.equal((await googleLogin({ sub: 'g-sub-9', email: 'new@congty.vn' })).status, 200);
});

test('Review TB-2: chiếm lại tài khoản Gmail → reset tên + xoá user_prefs của người đăng ký trước', async t => {
  const { db, call, googleLogin } = await setup(t);
  const reg = await (await call('user/register', { method: 'POST', body: { email: 'reader@gmail.com', password: 'attacker-pass-1', name: 'Kẻ Xấu' } })).json();
  await call('user/prefs', { method: 'PUT', token: reg.token, body: { prefs: { v: 1, reader: { theme: 'dark' } } } });
  const { user } = await (await googleLogin()).json();
  assert.equal(user.name, 'Độc Giả');
  assert.equal((await db.prepare(`SELECT name FROM users`).first()).name, 'Độc Giả');
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM user_prefs`).first()).n, 0);
});

test('Review TB-3: đặt mật khẩu lần đầu / xoá tài khoản cần xác thực lại khi phiên > 10 phút', async t => {
  const { db, call, googleLogin, nonce, key } = await setup(t);
  const { token } = await (await googleLogin()).json();
  await db.prepare(`UPDATE user_sessions SET created_at = datetime('now', '-2 hours')`).run();
  const r1 = await call('user/password', { method: 'POST', token, body: { new_password: 'stolen-token-pass' } });
  assert.equal(r1.status, 403);
  assert.equal((await r1.json()).reason, 'reauth_required');
  // id_token Google của tài khoản KHÁC (sub khác) không được chấp nhận.
  const wrong = await signJwt(key, claims({ sub: 'g-other', nonce: await nonce() }));
  assert.equal((await call('user/password', { method: 'POST', token, body: { new_password: 'xxxxxxxxxx', credential: wrong } })).status, 403);
  const good = await signJwt(key, claims({ nonce: await nonce() }));
  assert.equal((await call('user/password', { method: 'POST', token, body: { new_password: 'real-owner-pass', credential: good } })).status, 200);
  // Đã có mật khẩu → xoá tài khoản cần đúng mật khẩu.
  assert.equal((await call('user/account', { method: 'DELETE', token, body: { confirm: 'reader@gmail.com' } })).status, 403);
  assert.equal((await call('user/account', { method: 'DELETE', token, body: { confirm: 'reader@gmail.com', current_password: 'sai-mat-khau' } })).status, 403);
  assert.equal((await call('user/account', { method: 'DELETE', token, body: { confirm: 'reader@gmail.com', current_password: 'real-owner-pass' } })).status, 200);
});

test('Liên kết Google từ tài khoản email (link-google): thành công, từ chối Google đã dùng cho người khác', async t => {
  const { db, call, nonce, key, googleLogin } = await setup(t);
  const reg = await (await call('user/register', { method: 'POST', body: { email: 'x@congty.vn', password: 'owner-pass-123' } })).json();
  const cred = await signJwt(key, claims({ sub: 'g-x', email: 'x@congty.vn', nonce: await nonce() }));
  assert.equal((await call('user/link-google', { method: 'POST', token: reg.token, body: { credential: cred } })).status, 200);
  const row = await db.prepare(`SELECT google_id, password_hash, email_verified_at FROM users WHERE id = ?`).bind(reg.user.id).first();
  assert.equal(row.google_id, 'g-x');
  assert.ok(row.password_hash, 'liên kết chủ động không xoá mật khẩu');
  assert.equal(row.email_verified_at, null, 'email không phải Gmail/Workspace → không đánh dấu đã xác minh');
  // Sau khi liên kết, đăng nhập Google bằng sub đó vào đúng tài khoản.
  assert.equal((await (await googleLogin({ sub: 'g-x', email: 'x@congty.vn' })).json()).user.id, reg.user.id);
  // Google g-sub-1 thuộc tài khoản khác → không liên kết được.
  await googleLogin();
  const reg2 = await (await call('user/register', { method: 'POST', body: { email: 'y@congty.vn', password: 'owner-pass-123' } })).json();
  const taken = await signJwt(key, claims({ nonce: await nonce() }));
  const res = await call('user/link-google', { method: 'POST', token: reg2.token, body: { credential: taken } });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).reason, 'google_taken');
});

test('Review T-3: aud dạng mảng chỉ hợp lệ khi azp = client của mình', async t => {
  const { googleLogin } = await setup(t);
  assert.equal((await googleLogin({ aud: [CLIENT_ID, 'other'] })).status, 401);
  assert.equal((await googleLogin({ aud: [CLIENT_ID, 'other'], azp: CLIENT_ID })).status, 200);
});
