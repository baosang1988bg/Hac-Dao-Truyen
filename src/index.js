/**
 * Cloudflare Worker — HacDaoTruyen API
 *
 * Bindings cần có trong wrangler.jsonc:
 *   - ASSETS  : static frontend files
 *   - DB      : Cloudflare D1 (metadata novels + chapters)
 *   - CHAPTERS: Cloudflare R2 (chapter markdown content)
 *   - BACKEND_URL (secret, optional): Python backend cho translate jobs
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // ── API routes ──────────────────────────────────────────────────────
    if (url.pathname.startsWith('/api/')) {
      try {
        const res = await handleApi(request, url, env);
        return corsResponse(res);
      } catch (err) {
        return corsResponse(jsonResponse({ error: err.message }, 500));
      }
    }

    // ── Static assets + SPA fallback ────────────────────────────────────
    const assetRes = await env.ASSETS.fetch(request);
    if (assetRes.status === 404) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url).toString(), { method: 'GET' }));
    }
    return assetRes;
  },
};

// ── Router ────────────────────────────────────────────────────────────────────
async function handleApi(request, url, env) {
  const path = url.pathname;
  const method = request.method;

  // GET /api/novels
  if (path === '/api/novels' && method === 'GET') {
    return getNovels(env);
  }

  // GET /api/server-info
  if (path === '/api/server-info' && method === 'GET') {
    return jsonResponse({ server_start: new Date().toISOString(), mode: 'cloudflare' });
  }

  // GET /api/debug/chapter/:slug/:num — kiểm tra D1 + R2 cho 1 chapter cụ thể
  const debugMatch = path.match(/^\/api\/debug\/chapter\/([^/]+)\/(\d+)$/);
  if (debugMatch && method === 'GET') {
    const [, dSlug, dNum] = debugMatch;
    const row = await env.DB.prepare(
      `SELECT filename, r2_key, chapter_number FROM chapters
       WHERE novel_slug = ? AND chapter_number = ? LIMIT 1`
    ).bind(dSlug, parseInt(dNum)).first();
    if (!row) return jsonResponse({ step: 'D1', error: 'NOT FOUND in D1', slug: dSlug, chapter_number: parseInt(dNum) }, 404);
    const obj = await env.CHAPTERS.get(row.r2_key);
    if (!obj) return jsonResponse({ step: 'R2', error: 'NOT FOUND in R2', r2_key: row.r2_key, filename: row.filename }, 404);
    const preview = (await obj.text()).slice(0, 200);
    return jsonResponse({ step: 'OK', filename: row.filename, r2_key: row.r2_key, preview });
  }

  // GET /api/novels/:slug
  const novelMatch = path.match(/^\/api\/novels\/([^/]+)$/);
  if (novelMatch && method === 'GET') {
    return getNovel(env, novelMatch[1], request);
  }

  // GET /api/novels/:slug/epub — tải EPUB đã build (upload lên R2 bởi migrate)
  const epubMatch = path.match(/^\/api\/novels\/([^/]+)\/epub$/);
  if (epubMatch && method === 'GET') {
    return getEpub(env, epubMatch[1]);
  }

  // GET /api/novels/:slug/chapters
  const chaptersMatch = path.match(/^\/api\/novels\/([^/]+)\/chapters$/);
  if (chaptersMatch && method === 'GET') {
    return getChapters(env, chaptersMatch[1]);
  }

  // GET /api/novels/:slug/chapters/:filename
  const chapterMatch = path.match(/^\/api\/novels\/([^/]+)\/chapters\/(.+)$/);
  if (chapterMatch && method === 'GET') {
    return getChapterContent(env, chapterMatch[1], decodeURIComponent(chapterMatch[2]));
  }

  // POST /api/novels/:slug/glossary
  const glossaryMatch = path.match(/^\/api\/novels\/([^/]+)\/glossary$/);
  if (glossaryMatch && method === 'POST') {
    return updateGlossary(env, glossaryMatch[1], request);
  }

  // GET /api/novels/:slug/health
  const healthMatch = path.match(/^\/api\/novels\/([^/]+)\/health$/);
  if (healthMatch && method === 'GET') {
    return getHealth(env, healthMatch[1]);
  }

  // ── User account routes (roadmap 3.1–3.4) ───────────────────────────
  // Đặt TRƯỚC block proxy. Lưu ý: /api/user/* vốn không match proxy
  // (proxy chỉ bắt /translate, /tools, /api/logs) nhưng để đây cho rõ ràng.

  // POST /api/user/register | login | logout
  if (path === '/api/user/register' && method === 'POST') {
    return userRegister(request, env);
  }
  if (path === '/api/user/login' && method === 'POST') {
    return userLogin(request, env);
  }
  if (path === '/api/user/logout' && method === 'POST') {
    return userLogout(request, env);
  }

  // GET /api/user/me
  if (path === '/api/user/me' && method === 'GET') {
    const user = await getUserFromRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
    return jsonResponse({ id: user.id, email: user.email, name: user.name });
  }

  // GET /api/user/bookmarks
  if (path === '/api/user/bookmarks' && method === 'GET') {
    return userBookmarksList(request, env);
  }

  // PUT/DELETE /api/user/bookmarks/:slug
  const bookmarkMatch = path.match(/^\/api\/user\/bookmarks\/([^/]+)$/);
  if (bookmarkMatch && (method === 'PUT' || method === 'DELETE')) {
    return userBookmarkModify(request, env, bookmarkMatch[1], method);
  }

  // GET /api/user/progress
  if (path === '/api/user/progress' && method === 'GET') {
    return userProgressList(request, env);
  }

  // PUT /api/user/progress/:slug
  const progressMatch = path.match(/^\/api\/user\/progress\/([^/]+)$/);
  if (progressMatch && method === 'PUT') {
    return userProgressUpdate(request, env, progressMatch[1]);
  }

  // GET/POST /api/novels/:slug/comments
  const commentsMatch = path.match(/^\/api\/novels\/([^/]+)\/comments$/);
  if (commentsMatch && method === 'GET') {
    return commentsList(env, commentsMatch[1], url);
  }
  if (commentsMatch && method === 'POST') {
    return commentCreate(request, env, commentsMatch[1]);
  }

  // DELETE /api/comments/:id
  const commentDelMatch = path.match(/^\/api\/comments\/(\d+)$/);
  if (commentDelMatch && method === 'DELETE') {
    return commentDelete(request, env, parseInt(commentDelMatch[1]));
  }

  // ── Proxy translate jobs → Python backend (nếu có BACKEND_URL) ──────
  if (path.includes('/translate') || path.includes('/tools') || path === '/api/logs') {
    return proxyToBackend(request, url, env);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function getNovels(env) {
  // Trang chủ lọc theo chapter_count > 0 và dùng last_translated_at /
  // latest_chapter_title, nên phải tính các field này từ bảng chapters —
  // giống hệt _translated_stats() của backend FastAPI (routers/novels.py).
  // KHÔNG trả source_url/last_translated_url cho guest (lộ nguồn crawl).
  const { results } = await env.DB.prepare(`
    SELECT n.slug, n.title, n.original_title, n.author, n.genre, n.notes,
           n.total_chapters, n.cover_url, n.translation_style, n.status,
           n.updated_at,
           (SELECT COUNT(*) FROM chapters c
             WHERE c.novel_slug = n.slug)                    AS chapter_count,
           (SELECT c.title FROM chapters c
             WHERE c.novel_slug = n.slug
             ORDER BY c.chapter_number DESC LIMIT 1)         AS latest_chapter_title,
           (SELECT MAX(c.created_at) FROM chapters c
             WHERE c.novel_slug = n.slug)                    AS last_created_at,
           n.glossary_count
    FROM novels n
    ORDER BY n.updated_at DESC
  `).all();

  const novels = results.map(({ last_created_at, ...n }) => ({
    ...n,
    // D1 datetime('now') là UTC "YYYY-MM-DD HH:MM:SS" → epoch seconds
    last_translated_at: last_created_at
      ? Math.floor(Date.parse(last_created_at.replace(' ', 'T') + 'Z') / 1000)
      : null,
    glossary_count: n.glossary_count || 0,
  }));
  return jsonResponse(novels);
}

/**
 * Xác thực admin: Worker không giữ session token (token sống trong Python
 * backend), nên khi có Authorization header thì hỏi backend qua BACKEND_URL.
 * Không có BACKEND_URL (chế độ Cloudflare thuần) → mọi request là guest.
 */
async function isAdminRequest(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || !env.BACKEND_URL) return false;
  try {
    const res = await fetch(`${env.BACKEND_URL}/api/auth/verify`, {
      headers: { Authorization: auth },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Field công khai của novel — đồng bộ với _PUBLIC_FIELDS trong routers/novels.py.
// KHÔNG có source_url/last_translated_url (lộ nguồn crawl) và glossary (nặng, chỉ admin).
const NOVEL_PUBLIC_FIELDS = [
  'slug', 'title', 'original_title', 'author', 'genre', 'notes',
  'total_chapters', 'cover_url', 'translation_style', 'status', 'updated_at',
];

async function getNovel(env, slug, request) {
  const novel = await env.DB.prepare(`
    SELECT * FROM novels WHERE slug = ?
  `).bind(slug).first();

  if (!novel) return jsonResponse({ error: 'Novel not found' }, 404);

  // Thống kê từ bảng chapters — cùng ngữ nghĩa _translated_stats() của FastAPI
  const stats = await env.DB.prepare(`
    SELECT COUNT(*) AS chapter_count,
           MAX(created_at) AS last_created_at,
           (SELECT title FROM chapters WHERE novel_slug = ?1
             ORDER BY chapter_number DESC LIMIT 1) AS latest_chapter_title
    FROM chapters WHERE novel_slug = ?1
  `).bind(slug).first();

  const common = {
    chapter_count: stats?.chapter_count || 0,
    latest_chapter_title: stats?.latest_chapter_title || null,
    last_translated_at: stats?.last_created_at
      ? Math.floor(Date.parse(stats.last_created_at.replace(' ', 'T') + 'Z') / 1000)
      : null,
    glossary_count: novel.glossary_count || 0,
  };

  if (!(request && await isAdminRequest(request, env))) {
    // Guest: chỉ field whitelist + thống kê
    const pub = {};
    for (const k of NOVEL_PUBLIC_FIELDS) if (k in novel) pub[k] = novel[k];
    return jsonResponse({ ...pub, ...common });
  }

  // Admin: full novel.json gồm glossary (đọc từ R2 do giới hạn row D1)
  try {
    const glossaryObj = await env.CHAPTERS.get(`${slug}/glossary.json`);
    if (glossaryObj) {
      novel.glossary = await glossaryObj.json();
    } else {
      novel.glossary = JSON.parse(novel.glossary || '{}');
    }
  } catch (err) {
    console.error('Error fetching glossary from R2:', err);
    try {
      novel.glossary = JSON.parse(novel.glossary || '{}');
    } catch {
      novel.glossary = {};
    }
  }
  return jsonResponse({ ...novel, ...common });
}

async function getEpub(env, slug) {
  // EPUB được build local (tools/build_epub.py) và upload lên R2 key
  // "<slug>/book.epub" bởi migrate_to_cloudflare.py / tools/auto_update.py.
  const obj = await env.CHAPTERS.get(`${slug}/book.epub`);
  if (!obj) {
    return jsonResponse({ error: 'EPUB chưa có cho truyện này — chạy migrate_to_cloudflare.py sau khi build EPUB.' }, 404);
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/epub+zip',
      // slug là ASCII-safe → dùng làm filename tải về
      'Content-Disposition': `attachment; filename="${slug}.epub"`,
    },
  });
}

async function getChapters(env, slug) {
  const { results } = await env.DB.prepare(`
    SELECT filename, title, chapter_number
    FROM chapters
    WHERE novel_slug = ?
    ORDER BY chapter_number ASC
  `).bind(slug).all();

  return jsonResponse(results);
}

async function getChapterContent(env, slug, identifier) {
  // identifier có thể là filename (từ frontend) hoặc số chương
  const isNumber = /^\d+$/.test(identifier);

  let rows = [];
  if (isNumber) {
    const { results } = await env.DB.prepare(
      `SELECT filename, r2_key FROM chapters
       WHERE novel_slug = ? AND chapter_number = ?
       ORDER BY filename ASC`
    ).bind(slug, parseInt(identifier)).all();
    rows = results;
  } else {
    const row = await env.DB.prepare(
      `SELECT filename, r2_key FROM chapters
       WHERE novel_slug = ? AND filename = ?`
    ).bind(slug, identifier).first();
    if (row) rows = [row];
  }

  if (rows.length === 0) {
    return jsonResponse({ error: 'Chapter not found in database', identifier, slug }, 404);
  }

  // Lấy content từ R2 — r2_key đã được lưu đúng từ migration script
  let fullContent = '';
  for (const row of rows) {
    const obj = await env.CHAPTERS.get(row.r2_key);
    if (obj) {
      const text = await obj.text();
      fullContent += (fullContent ? '\n\n' : '') + text;
    } else {
      // Debug: trả về thông tin để trace lỗi
      return jsonResponse({
        error: 'Content not found in R2',
        r2_key: row.r2_key,
        filename: row.filename,
      }, 404);
    }
  }

  if (!fullContent) return jsonResponse({ error: 'Empty content' }, 404);
  return jsonResponse({ content: fullContent });
}

async function updateGlossary(env, slug, request) {
  const body = await request.json();
  const glossary = body.glossary || {};

  // 1. Lưu glossary dạng file JSON lên R2 (để lưu trữ không giới hạn kích thước)
  await env.CHAPTERS.put(`${slug}/glossary.json`, JSON.stringify(glossary, null, 2));

  // 2. Cập nhật D1 (cột glossary để '{}' tránh SQLITE_TOOBIG; lưu glossary_count
  // để danh sách /api/novels có số thuật ngữ thật mà không phải đọc R2)
  await env.DB.prepare(`
    UPDATE novels SET glossary = ?, glossary_count = ?, updated_at = ? WHERE slug = ?
  `).bind('{}', Object.keys(glossary).length, new Date().toISOString(), slug).run();

  return jsonResponse({ status: 'success', message: 'Glossary updated and saved to R2' });
}

async function getHealth(env, slug) {
  const { results: chapters } = await env.DB.prepare(`
    SELECT filename, chapter_number FROM chapters WHERE novel_slug = ?
  `).bind(slug).all();

  const novel = await env.DB.prepare(
    `SELECT total_chapters FROM novels WHERE slug = ?`
  ).bind(slug).first();

  return jsonResponse({
    summary: {
      total_translated: chapters.length,
      total_raw: novel?.total_chapters || 0,
    },
    issues: [],
  });
}

// ── User account system (roadmap 3.1–3.4) ────────────────────────────────────
// Mirror hợp đồng API của backend FastAPI: register/login/logout/me,
// bookmarks, reading progress, comments. Dữ liệu ở D1 (migrations/002_users.sql).

const SLUG_RE = /^[a-z0-9-]{1,100}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

// Parse JSON body an toàn — trả null nếu JSON hỏng (handler trả 400)
async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ── Password hashing (PBKDF2-SHA256, tương thích hashlib.pbkdf2_hmac Python) ──

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2Sha256(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
  );
}

// Format lưu trữ: pbkdf2$100000$<salt_hex>$<hash_hex>
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2Sha256(password, salt, 100000);
  return `pbkdf2$100000$${toHex(salt)}$${toHex(bits)}`;
}

// So sánh timing-safe đơn giản: XOR từng ký tự, không return sớm
function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password, stored) {
  const parts = (stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt;
  try {
    salt = fromHex(parts[2]);
  } catch {
    return false;
  }
  const bits = await pbkdf2Sha256(password, salt, iterations);
  return timingSafeEqualStr(toHex(bits), parts[3]);
}

// ── Session helpers ───────────────────────────────────────────────────────────

// D1 dùng UTC "YYYY-MM-DD HH:MM:SS" (datetime('now')) → format giống hệt để so sánh
function sqliteDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function createUserSession(env, userId) {
  const token = 'u_' + toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = sqliteDatetime(new Date(Date.now() + SESSION_TTL_MS));
  await env.DB.prepare(
    `INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(token, userId, expiresAt).run();
  return token;
}

function extractUserToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer u_')) return null;
  return auth.slice('Bearer '.length);
}

// Trả về user row {id,email,name} hoặc null; đồng thời dọn session hết hạn của token
async function getUserFromRequest(request, env) {
  const token = extractUserToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, s.expires_at
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).bind(token).first();
  if (!row) return null;
  if (row.expires_at <= sqliteDatetime(new Date())) {
    // Session quá hạn → xóa luôn khỏi DB
    await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

// ── Auth handlers ─────────────────────────────────────────────────────────────

async function userRegister(request, env) {
  const body = await readJsonBody(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();

  if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'Email không hợp lệ' }, 400);
  if (password.length < 8) return jsonResponse({ error: 'Mật khẩu phải có ít nhất 8 ký tự' }, 400);

  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ?`
  ).bind(email).first();
  if (existing) return jsonResponse({ error: 'Email đã được đăng ký' }, 409);

  const passwordHash = await hashPassword(password);
  let userId;
  try {
    const { meta } = await env.DB.prepare(
      `INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)`
    ).bind(email, name, passwordHash).run();
    userId = meta.last_row_id;
  } catch (err) {
    // Race hiếm gặp: UNIQUE constraint khi 2 request đăng ký cùng lúc
    if (String(err.message || '').includes('UNIQUE')) {
      return jsonResponse({ error: 'Email đã được đăng ký' }, 409);
    }
    throw err;
  }

  const token = await createUserSession(env, userId);
  return jsonResponse({ token, user: { id: userId, email, name } }, 201);
}

async function userLogin(request, env) {
  const body = await readJsonBody(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const user = await env.DB.prepare(
    `SELECT id, email, name, password_hash FROM users WHERE email = ?`
  ).bind(email).first();

  // Không phân biệt "email không tồn tại" và "sai mật khẩu" (tránh dò email)
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return jsonResponse({ error: 'Email hoặc mật khẩu không đúng' }, 401);
  }

  const token = await createUserSession(env, user.id);
  return jsonResponse({ token, user: { id: user.id, email: user.email, name: user.name } });
}

async function userLogout(request, env) {
  const token = extractUserToken(request);
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);
  await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
  return jsonResponse({ ok: true });
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────

async function userBookmarksList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const { results } = await env.DB.prepare(`
    SELECT slug, created_at FROM bookmarks
    WHERE user_id = ? ORDER BY created_at DESC
  `).bind(user.id).all();
  return jsonResponse(results);
}

async function userBookmarkModify(request, env, slug, method) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'Slug không hợp lệ' }, 400);

  if (method === 'PUT') {
    // Idempotent: bookmark đã tồn tại thì bỏ qua
    await env.DB.prepare(
      `INSERT INTO bookmarks (user_id, slug) VALUES (?, ?)
       ON CONFLICT(user_id, slug) DO NOTHING`
    ).bind(user.id, slug).run();
  } else {
    await env.DB.prepare(
      `DELETE FROM bookmarks WHERE user_id = ? AND slug = ?`
    ).bind(user.id, slug).run();
  }
  return jsonResponse({ ok: true });
}

// ── Reading progress ──────────────────────────────────────────────────────────

async function userProgressList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const { results } = await env.DB.prepare(`
    SELECT slug, chapter, updated_at FROM reading_progress
    WHERE user_id = ? ORDER BY updated_at DESC
  `).bind(user.id).all();
  return jsonResponse(results);
}

async function userProgressUpdate(request, env, slug) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'Slug không hợp lệ' }, 400);

  const body = await readJsonBody(request);
  if (!body || !Number.isInteger(body.chapter)) {
    return jsonResponse({ error: 'chapter phải là số nguyên' }, 400);
  }

  // Upsert: mỗi user chỉ giữ 1 record tiến độ cho mỗi truyện
  await env.DB.prepare(`
    INSERT INTO reading_progress (user_id, slug, chapter, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, slug) DO UPDATE SET
      chapter = excluded.chapter, updated_at = excluded.updated_at
  `).bind(user.id, slug, body.chapter).run();
  return jsonResponse({ ok: true });
}

// ── Comments ──────────────────────────────────────────────────────────────────

async function commentsList(env, slug, url) {
  if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'Slug không hợp lệ' }, 400);
  const chapterParam = url.searchParams.get('chapter');

  // Public: JOIN users lấy tên hiển thị, mới nhất trước, tối đa 100
  let stmt;
  if (chapterParam !== null && /^\d+$/.test(chapterParam)) {
    stmt = env.DB.prepare(`
      SELECT c.id, u.name AS user_name, c.chapter, c.content, c.created_at
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.slug = ? AND c.chapter = ?
      ORDER BY c.id DESC LIMIT 100
    `).bind(slug, parseInt(chapterParam));
  } else {
    stmt = env.DB.prepare(`
      SELECT c.id, u.name AS user_name, c.chapter, c.content, c.created_at
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.slug = ?
      ORDER BY c.id DESC LIMIT 100
    `).bind(slug);
  }
  const { results } = await stmt.all();
  return jsonResponse(results);
}

async function commentCreate(request, env, slug) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'Slug không hợp lệ' }, 400);

  const body = await readJsonBody(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);

  const content = String(body.content || '').trim();
  const chapter = Number.isInteger(body.chapter) ? body.chapter : 0;
  if (!content || content.length > 2000) {
    return jsonResponse({ error: 'Nội dung phải từ 1 đến 2000 ký tự' }, 400);
  }

  // Rate limit: 1 comment / 20 giây / user — so sánh created_at bằng SQL datetime
  const recent = await env.DB.prepare(`
    SELECT id FROM comments
    WHERE user_id = ? AND created_at > datetime('now', '-20 seconds')
    LIMIT 1
  `).bind(user.id).first();
  if (recent) return jsonResponse({ error: 'Bình luận quá nhanh, thử lại sau 20 giây' }, 429);

  const { meta } = await env.DB.prepare(
    `INSERT INTO comments (user_id, slug, chapter, content) VALUES (?, ?, ?, ?)`
  ).bind(user.id, slug, chapter, content).run();
  return jsonResponse({ id: meta.last_row_id }, 201);
}

async function commentDelete(request, env, id) {
  const comment = await env.DB.prepare(
    `SELECT id, user_id FROM comments WHERE id = ?`
  ).bind(id).first();
  if (!comment) return jsonResponse({ error: 'Comment not found' }, 404);

  // Chính chủ (token u_...) xóa được comment của mình; token admin hỏi backend
  const user = await getUserFromRequest(request, env);
  const allowed = (user && user.id === comment.user_id) || (await isAdminRequest(request, env));
  if (!allowed) return jsonResponse({ error: 'Forbidden' }, 403);

  await env.DB.prepare(`DELETE FROM comments WHERE id = ?`).bind(id).run();
  return jsonResponse({ ok: true });
}

// ── Proxy to Python backend ───────────────────────────────────────────────────
async function proxyToBackend(request, url, env) {
  const backendUrl = env.BACKEND_URL;
  if (!backendUrl) {
    return jsonResponse({ error: 'Backend không khả dụng trong Cloudflare mode. Cần chạy Python server local.' }, 503);
  }

  const targetUrl = `${backendUrl}${url.pathname}${url.search}`;
  const proxied = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'follow',
  });

  try {
    return await fetch(proxied);
  } catch (err) {
    return jsonResponse({ error: 'Không thể kết nối backend.', detail: err.message }, 502);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function corsResponse(response) {
  const res = new Response(response.body, response);
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}
