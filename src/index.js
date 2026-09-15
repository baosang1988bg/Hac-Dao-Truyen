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
      return corsResponse(new Response(null, { status: 204 }), request, env);
    }

    // ── API routes ──────────────────────────────────────────────────────
    if (url.pathname.startsWith('/api/')) {
      try {
        const res = await handleApi(request, url, env, ctx);
        return corsResponse(res, request, env);
      } catch (err) {
        // A06: không trả err.message thô cho client (có thể lộ đường dẫn nội bộ,
        // stack trace, tên biến/schema). Log đầy đủ ở server (Cloudflare tail
        // logs) kèm mã đối chiếu ngắn để tra cứu, client chỉ nhận lỗi chung.
        const errorCode = crypto.randomUUID().slice(0, 8);
        console.error(`[${errorCode}] ${url.pathname}`, err && err.stack ? err.stack : err);
        return corsResponse(jsonResponse({ error: 'Internal server error', code: errorCode }, 500), request, env);
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
async function handleApi(request, url, env, ctx) {
  const path = url.pathname;
  const method = request.method;

  const isSync = ['/api/admin/sync-novel', '/api/admin/sync-rankings'].includes(path) && method === 'POST';
  // Chỉ phân loại sync sau khi xác minh key; header giả không được bypass.
  const verifiedSync = isSync && env.SYNC_KEY && timingSafeEqualStr(request.headers.get('x-sync-key') || '', env.SYNC_KEY);
  const isLogin = ['/api/auth/login','/api/user/login','/api/user/register'].includes(path);
  const category = verifiedSync ? 'sync' : isLogin ? 'auth' : 'public';
  const binding = env[category === 'sync' ? 'SYNC_RATE_LIMITER' : category === 'auth' ? 'AUTH_RATE_LIMITER' : 'PUBLIC_RATE_LIMITER'];
  const key = category === 'sync' ? 'sync:authorized' : `${category}:${clientIp(request)}`;
  const maximum = category === 'sync' ? 30 : category === 'auth' ? 10 : 120;
  let permitted;
  try {
    permitted = binding ? (await binding.limit({key})).success : checkRateLimit(key,60_000,maximum);
  } catch {
    if (category !== 'public') return jsonResponse({error:'Rate limiter unavailable'},503);
    permitted = checkRateLimit(key,60_000,maximum);
  }
  if (!permitted) return jsonResponse({error:'Quá nhiều yêu cầu. Thử lại sau 1 phút.'},429,{'Retry-After':'60'});

  const authMethods = {
    '/api/auth/login': 'POST',
    '/api/auth/logout': 'POST',
    '/api/auth/verify': 'GET',
  };
  if (Object.hasOwn(authMethods, path)) {
    if (method !== authMethods[path]) return jsonResponse({ error: 'Method not allowed' }, 405);
    return proxyToBackend(request, url, env);
  }

  // POST /api/admin/sync-novel — high-speed batch sync endpoint
  if (path === '/api/admin/sync-novel' && method === 'POST') {
    return syncNovelBatch(env, request);
  }

  if (path === '/api/admin/sync-rankings' && method === 'POST') return syncRankings(env, request);
  if (path === '/api/rankings' && method === 'GET') return getRankings(env);

  // GET /api/proxy-cover?url=...
  if (path === '/api/proxy-cover' && method === 'GET') {
    return proxyCover(url);
  }

  // GET /api/novels?q=&sort=&order=&genre=&status=&has_epub=&page=&limit=
  if (path === '/api/novels' && method === 'GET') {
    return getNovels(env, url.searchParams);
  }

  // GET /api/novels/genres — danh sách thể loại distinct
  if (path === '/api/novels/genres' && method === 'GET') {
    return getGenres(env);
  }

  // GET /api/stats — tổng số truyện/chương/thuật ngữ, tính bằng SQL aggregate
  // ở server thay vì client tự tải toàn bộ catalog rồi cộng dồn (HomePage cũ).
  if (path === '/api/stats' && method === 'GET') {
    return getStats(env);
  }

  // GET /api/server-info
  if (path === '/api/server-info' && method === 'GET') {
    return jsonResponse({ server_start: new Date().toISOString(), mode: 'cloudflare' });
  }

  // GET /api/debug/chapter/:slug/:num — kiểm tra D1 + R2 cho 1 chapter cụ thể
  // Chỉ admin: lộ r2_key + preview nội dung nội bộ, không để khách xem được.
  const debugMatch = path.match(/^\/api\/debug\/chapter\/([^/]+)\/(\d+)$/);
  if (debugMatch && method === 'GET') {
    if (!(await isAdminRequest(request, env))) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
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

  // POST /api/novels/:slug/view — tăng lượt xem
  const viewMatch = path.match(/^\/api\/novels\/([^/]+)\/view$/);
  if (viewMatch && method === 'POST') {
    return trackView(env, viewMatch[1], request);
  }

  // POST /api/novels/:slug/rate — đánh giá truyện (1-5 sao)
  const rateMatch = path.match(/^\/api\/novels\/([^/]+)\/rate$/);
  if (rateMatch && method === 'POST') {
    return rateNovel(env, rateMatch[1], request);
  }

  // GET /api/novels/:slug/synopsis — lazy load full synopsis
  const synopsisMatch = path.match(/^\/api\/novels\/([^/]+)\/synopsis$/);
  if (synopsisMatch && method === 'GET') {
    return getSynopsis(env, synopsisMatch[1]);
  }

  // GET /api/novels/:slug/chapters
  const chaptersMatch = path.match(/^\/api\/novels\/([^/]+)\/chapters$/);
  if (chaptersMatch && method === 'GET') {
    return getChapters(env, chaptersMatch[1], ctx);
  }

  // GET /api/novels/:slug/chapters/:filename
  const chapterMatch = path.match(/^\/api\/novels\/([^/]+)\/chapters\/(.+)$/);
  if (chapterMatch && method === 'GET') {
    return getChapterContent(env, chapterMatch[1], decodeURIComponent(chapterMatch[2]), ctx);
  }

  // POST /api/novels/:slug/glossary
  const glossaryMatch = path.match(/^\/api\/novels\/([^/]+)\/glossary$/);
  if (glossaryMatch && method === 'POST') {
    return updateGlossary(env, glossaryMatch[1], request);
  }



  // GET /api/novels/:slug/health
  const healthMatch = path.match(/^\/api\/novels\/([^/]+)\/health$/);
  if (healthMatch && method === 'GET') return getHealth(env, healthMatch[1]);

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

  // GET /api/comments/recent?limit=5 — bình luận mới nhất toàn site (trang chủ)
  if (path === '/api/comments/recent' && method === 'GET') {
    return recentComments(env, url);
  }

  // DELETE /api/comments/:id
  const commentDelMatch = path.match(/^\/api\/comments\/(\d+)$/);
  if (commentDelMatch && method === 'DELETE') {
    return commentDelete(request, env, parseInt(commentDelMatch[1]));
  }

  // ── Request Novel — độc giả gợi ý truyện muốn dịch, admin duyệt ─────
  // POST /api/novel-requests
  if (path === '/api/novel-requests' && method === 'POST') {
    return novelRequestCreate(request, env);
  }
  // GET /api/novel-requests/mine
  if (path === '/api/novel-requests/mine' && method === 'GET') {
    return novelRequestsMine(request, env);
  }
  // GET /api/admin/novel-requests?status=
  if (path === '/api/admin/novel-requests' && method === 'GET') {
    return adminNovelRequestsList(request, env, url);
  }
  // POST /api/admin/novel-requests/:id/review
  const novelReqReviewMatch = path.match(/^\/api\/admin\/novel-requests\/(\d+)\/review$/);
  if (novelReqReviewMatch && method === 'POST') {
    return adminNovelRequestReview(request, env, parseInt(novelReqReviewMatch[1]));
  }

  // F03: POST /api/admin/novels/:slug/takedown | /restore
  const takedownMatch = path.match(/^\/api\/admin\/novels\/([^/]+)\/(takedown|restore)$/);
  if (takedownMatch && method === 'POST') {
    return adminTakedownRestore(request, env, takedownMatch[1], takedownMatch[2]);
  }

  // GET /api/config — cấu hình public cho frontend (vd kênh liên hệ takedown)
  if (path === '/api/config' && method === 'GET') {
    return jsonResponse({ contact_email: env.CONTACT_EMAIL || '' });
  }

  // ── Proxy translate jobs → Python backend (nếu có BACKEND_URL) ──────
  if (path.includes('/translate') || path.includes('/tools') || path === '/api/logs'
      || path === '/api/admin/sync-usage') {
    return proxyToBackend(request, url, env);
  }

  return jsonResponse({ error: 'Not found', received_path: path, received_method: method }, 404);
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// Chặn scheme không phải http/https và các host trỏ vào mạng nội bộ/loopback/
// link-local (bao gồm 169.254.169.254 — địa chỉ metadata cloud hay bị lợi dụng
// SSRF). Không giải quyết được DNS rebinding (Workers không cho kiểm soát IP
// kết nối thật của fetch), nhưng chặn được phần lớn payload SSRF phổ biến.
function isSafeCoverUrl(targetUrl) {
  let u;
  try {
    u = new URL(targetUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '') return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = parseInt(ipv4[1], 10);
    const b = parseInt(ipv4[2], 10);
    if (a === 127) return false;                     // loopback
    if (a === 10) return false;                       // private
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false;          // private
    if (a === 169 && b === 254) return false;          // link-local / metadata
    if (a === 0) return false;                         // "this network"
  }
  return true;
}

// A01: Chỉ cho phép raster image thật (không SVG/HTML/JSON) và giới hạn kích
// thước để tránh XSS chủ động (SVG có thể chứa <script>, trình duyệt thực thi
// khi mở trực tiếp URL proxy) và DoS bộ nhớ Worker khi ảnh quá lớn.
const COVER_ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);
const COVER_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB

// Magic-byte sniffing: server nguồn có thể khai Content-Type sai (hoặc bị
// tấn công MIME confusion), nên xác thực bằng chữ ký byte thật thay vì chỉ
// tin header. Không nhận diện được => coi là không hợp lệ (fail closed).
function sniffImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'image/avif';
  }
  return null;
}

async function proxyCover(url) {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return new Response('Missing url', { status: 400 });
  if (!isSafeCoverUrl(targetUrl)) return new Response('URL không hợp lệ', { status: 400 });
  try {
    const imgRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://audiotruyenfull.org/',
      },
    });
    if (!imgRes.ok || !imgRes.body) {
      return new Response('Cover fetch failed', { status: 502 });
    }
    const declaredLength = parseInt(imgRes.headers.get('Content-Length') || '0', 10);
    if (declaredLength > COVER_MAX_BYTES) {
      return new Response('Ảnh vượt giới hạn kích thước', { status: 502 });
    }

    // Đọc toàn bộ body có giới hạn byte cứng (không tin Content-Length khai báo).
    const reader = imgRes.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > COVER_MAX_BYTES) {
        reader.cancel().catch(() => {});
        return new Response('Ảnh vượt giới hạn kích thước', { status: 502 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const sniffed = sniffImageMime(bytes);
    if (!sniffed || !COVER_ALLOWED_MIME.has(sniffed)) {
      return new Response('Định dạng ảnh không được hỗ trợ', { status: 415 });
    }

    const headers = new Headers();
    headers.set('Content-Type', sniffed);
    headers.set('Content-Length', String(bytes.byteLength));
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=604800, s-maxage=604800');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Disposition', 'inline');
    return new Response(bytes, { status: 200, headers });
  } catch { /* fallback */ }
  return new Response('Cover fetch failed', { status: 502 });
}

// BUG ĐÃ SỬA (2026-08-13): trước đây getNovels() trả `chapter_count` = thẳng
// `n.total_chapters` — cột này là số chương THẤY TRÊN NGUỒN lúc scrape/discover
// (ghi bởi migrate_to_cloudflare.py từ novel.json["total_chapters"]), KHÔNG
// phải số chương ĐÃ THỰC SỰ đồng bộ lên D1/R2. Vì mọi nơi khác (getChapters(),
// getChapterContent(), và toàn bộ frontend — xem AllNovelsSection.jsx,
// NovelTable.jsx...) đều coi `chapter_count` là "số chương đọc được thật" và
// `total_chapters` là "tổng số chương nguồn" (2 khái niệm khác nhau, dùng để
// tính "45/120 chương" hay badge FULL), việc gán chapter_count=total_chapters
// khiến: (1) nút "Đọc truyện" hiện ra dù truyện chưa migrate xong/chưa có
// chương nào trong D1 → bấm vào không tải được gì; (2) mọi truyện có
// total_chapters>0 đều bị tính nhầm là "FULL/hoàn thành" trên trang chủ dù
// chưa dịch xong. Sửa bằng cách đếm THẬT số dòng trong bảng `chapters` (nguồn
// dữ liệu chính mà getChapters() đọc), khớp với getNovel() (trang chi tiết)
// vốn đã tính đúng qua catalog.json. idx_chapters_novel (schema.sql) đảm bảo
// subquery này dùng index, không quét toàn bảng.
async function getNovels(env, params = new URLSearchParams()) {
  const q       = (params.get('q') || '').trim().toLowerCase();
  const sort    = params.get('sort') || 'updated_at';   // updated_at | chapter_count | views | rating | title
  const order   = params.get('order') === 'asc' ? 'ASC' : 'DESC';
  const genre   = (params.get('genre') || '').trim();
  const status  = params.get('status') || '';           // ongoing | completed
  const hasEpub = params.get('has_epub');               // '1' | 'true' | ''
  const page    = Math.max(1, parseInt(params.get('page') || '1'));
  const limit   = Math.min(200, Math.max(1, parseInt(params.get('limit') || '48')));
  const offset  = (page - 1) * limit;

  const SORT_COLS = {
    updated_at:    'n.updated_at',
    chapter_count: 'chapter_count',
    views:         'n.views',
    rating:        'rating',
    title:         'n.title',
  };
  const sortCol = SORT_COLS[sort] || 'n.updated_at';

  // Build WHERE clauses
  // F03: truyện bị gỡ (takedown) không xuất hiện trong danh sách công khai —
  // không xóa dữ liệu, chỉ ẩn. published mặc định 1 (bao gồm cả row cũ trước
  // khi có cột này, xem migrations/007_takedown.sql).
  const where = ['n.published = 1'];
  const binds = [];

  if (genre) {
    where.push("n.genre LIKE ?");
    binds.push(`%${genre}%`);
  }
  if (status === 'ongoing' || status === 'completed') {
    where.push("n.status = ?");
    binds.push(status);
  }
  if (hasEpub === '1' || hasEpub === 'true') {
    where.push("n.has_epub = 1");
  }
  if (q) {
    where.push("(LOWER(n.title) LIKE ? OR LOWER(n.slug) LIKE ? OR LOWER(n.author) LIKE ? OR LOWER(n.original_title) LIKE ?)");
    const qLike = `%${q}%`;
    binds.push(qLike, qLike, qLike, qLike);
  }

  const whereStr = where.join(' AND ');

  // Count total matching records using index
  const countRes = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM novels n WHERE ${whereStr}`).bind(...binds).first();
  const total = countRes ? countRes.cnt : 0;

  // Fetch only requested page (LIMIT & OFFSET in SQL)
  const { results } = await env.DB.prepare(`
    SELECT n.slug, n.title, n.original_title, n.author, n.genre, n.notes,
           n.total_chapters, n.cover_url, n.translation_style, n.status,
           n.updated_at, n.views, n.has_epub, n.drive_file_id,
           CASE WHEN n.rating_count > 0 THEN ROUND(CAST(n.rating_sum AS REAL) / n.rating_count, 1) ELSE 0.0 END AS rating,
           n.rating_count,
           (SELECT COUNT(*) FROM chapters c WHERE c.novel_slug = n.slug) AS chapter_count,
           '' AS latest_chapter_title,
           n.updated_at AS last_created_at,
           n.glossary_count
    FROM novels n
    WHERE ${whereStr}
    ORDER BY ${sortCol} ${order}
    LIMIT ? OFFSET ?
  `).bind(...binds, limit, offset).all();

  const novels = (results || []).map(({ last_created_at, ...n }) => ({
    ...n,
    last_translated_at: last_created_at
      ? Math.floor(Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(last_created_at) ? last_created_at : last_created_at.replace(' ', 'T') + 'Z') / 1000)
      : null,
    glossary_count: n.glossary_count || 0,
  }));

  return jsonResponse({ novels, total, page, limit, pages: Math.ceil(total / limit) }, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=120'
  });
}


async function getGenres(env) {
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT genre FROM novels
    WHERE genre IS NOT NULL AND genre != ''
    ORDER BY genre ASC
  `).all();
  return jsonResponse(results.map(r => r.genre), 200, {
    'Cache-Control': 'public, max-age=600, s-maxage=600'
  });
}

// GET /api/stats — 3 số tổng cho StatsSection trang chủ. Aggregate thẳng
// trong SQL (COUNT/SUM) — không tải cả catalog về client rồi cộng dồn.
// External discovery snapshots are independent of translated novels.
async function syncRankings(env, request) {
  if (!env.SYNC_KEY || !timingSafeEqualStr(request.headers.get('x-sync-key') || '', env.SYNC_KEY)) {
    return jsonResponse({ error: 'Unauthorized sync key' }, 401);
  }
  let data;
  try { data = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  if (!data || !nonempty(data.source) || !nonempty(data.snapshot_date) || !Array.isArray(data.entries)) {
    return jsonResponse({ error: 'Expected source, snapshot_date and entries' }, 400);
  }
  const httpUrl = value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  };
  const optional = value => typeof value === 'string' ? value.trim() : '';
  const statements = [];
  let skipped = 0;
  for (const entry of data.entries) {
    if (!entry || !['category', 'window', 'title', 'source_url'].every(k => nonempty(entry[k])) ||
        !Number.isSafeInteger(entry.rank) || entry.rank <= 0 || !httpUrl(entry.source_url)) {
      skipped++;
      continue;
    }
    statements.push(env.DB.prepare(`
      INSERT INTO external_rankings
        (source, category, window, rank, title, author, cover_url, stat_label, source_url, snapshot_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, category, window, rank) DO UPDATE SET
        title=excluded.title, author=excluded.author, cover_url=excluded.cover_url,
        stat_label=excluded.stat_label, source_url=excluded.source_url,
        snapshot_date=excluded.snapshot_date, updated_at=datetime('now')
    `).bind(data.source.trim(), entry.category.trim(), entry.window.trim(), entry.rank,
      entry.title.trim(), optional(entry.author), httpUrl(entry.cover_url) ? entry.cover_url : '',
      optional(entry.stat_label), entry.source_url.trim(), data.snapshot_date.trim()));
  }
  if (statements.length) await env.DB.batch(statements);
  return jsonResponse({ upserted: statements.length, skipped });
}

async function getRankings(env) {
  // Filter old tail slots if a later snapshot contains fewer items.
  const { results } = await env.DB.prepare(`
    SELECT r.* FROM external_rankings r
    JOIN (SELECT source, category, window, MAX(snapshot_date) AS snapshot_date
          FROM external_rankings GROUP BY source, category, window) latest
      USING (source, category, window, snapshot_date)
    ORDER BY r.source, r.category, r.window, r.rank
  `).all();
  const groups = new Map();
  for (const row of results) {
    const key = JSON.stringify([row.source, row.category, row.window]);
    if (!groups.has(key)) groups.set(key, {
      source: row.source, category: row.category, window: row.window,
      snapshot_date: row.snapshot_date, items: [],
    });
    const { rank, title, author, cover_url, stat_label, source_url } = row;
    groups.get(key).items.push({ rank, title, author, cover_url, stat_label, source_url });
  }
  return jsonResponse({ groups: [...groups.values()] }, 200, {
    'Cache-Control': 'public, max-age=10800, s-maxage=10800',
  });
}

async function getStats(env) {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM novels WHERE published = 1) AS total_novels,
      (SELECT COUNT(*) FROM chapters c
         JOIN novels n ON n.slug = c.novel_slug
         WHERE n.published = 1) AS total_chapters,
      (SELECT COALESCE(SUM(glossary_count), 0) FROM novels WHERE published = 1) AS total_glossary
  `).first();
  return jsonResponse({
    total_novels: row?.total_novels || 0,
    total_chapters: row?.total_chapters || 0,
    total_glossary: row?.total_glossary || 0,
  }, 200, {
    'Cache-Control': 'public, max-age=300, s-maxage=300'
  });
}

// Rate-limit nhẹ theo IP, best-effort trong bộ nhớ của 1 isolate (không cần
// thêm KV/D1 mới). Reset khi Worker khởi động lại isolate — chấp nhận được vì
// mục tiêu chỉ là chặn spam tự động, không phải giới hạn cứng tuyệt đối.
const _rateLimitMap = new Map(); // key -> { count, resetAt }

function checkRateLimit(key, windowMs, maxRequests = 1) {
  const now = Date.now();
  let entry = _rateLimitMap.get(key);
  if (!entry && _rateLimitMap.size >= 5000) {
    for (const [k,v] of _rateLimitMap) if (now > v.resetAt) _rateLimitMap.delete(k);
    if (_rateLimitMap.size >= 5000) return false;
  }
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count++;
  _rateLimitMap.set(key, entry);
  if (_rateLimitMap.size > 5000) {
    for (const [k, v] of _rateLimitMap) if (now > v.resetAt) _rateLimitMap.delete(k);
  }
  return entry.count <= maxRequests;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function trackView(env, slug, request) {
  // 1 lượt xem / IP / truyện / 10 giây — chặn spam nhưng không cản người đọc thật
  if (!checkRateLimit(`view:${clientIp(request)}:${slug}`, 10_000)) {
    return jsonResponse({ ok: true, throttled: true });
  }
  await env.DB.prepare(`
    UPDATE novels SET views = views + 1 WHERE slug = ?
  `).bind(slug).run();
  return jsonResponse({ ok: true });
}

// F02: mỗi định danh (user đăng nhập hoặc guest_id do client tự sinh) chỉ có
// MỘT phiếu đánh giá / truyện — gửi lại thì CẬP NHẬT phiếu cũ, không cộng dồn
// vô hạn. guest_id chỉ để chống double-submit vô ý, KHÔNG phải chống gian lận
// tuyệt đối (client kiểm soát giá trị này). Nếu không có user lẫn guest_id,
// từ chối thay vì âm thầm cộng dồn không định danh (hành vi cũ, đã gây lỗi).
async function rateNovel(env, slug, request) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
  const stars = parseInt(body.stars);
  if (!stars || stars < 1 || stars > 5) return jsonResponse({ error: 'stars must be 1-5' }, 400);

  const user = await getUserFromRequest(request, env);
  const guestId = (request.headers.get('X-Guest-Id') || '').trim();
  if (!user && (!guestId || guestId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(guestId))) {
    return jsonResponse({ error: 'Thiếu định danh người đánh giá (đăng nhập hoặc guest_id hợp lệ)' }, 400);
  }

  // Vẫn giữ rate limit chống double-submit nhanh (double click, script lặp).
  const identityKey = user ? `u:${user.id}` : `g:${guestId}`;
  if (!checkRateLimit(`rate:${identityKey}:${slug}`, 5_000)) {
    return jsonResponse({ error: 'Vui lòng thử lại sau vài giây' }, 429);
  }

  if (user) {
    await env.DB.prepare(`
      INSERT INTO novel_ratings (slug, user_id, stars, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(slug, user_id) WHERE user_id IS NOT NULL
      DO UPDATE SET stars = excluded.stars, updated_at = datetime('now')
    `).bind(slug, user.id, stars).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO novel_ratings (slug, guest_id, stars, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(slug, guest_id) WHERE guest_id IS NOT NULL
      DO UPDATE SET stars = excluded.stars, updated_at = datetime('now')
    `).bind(slug, guestId, stars).run();
  }

  const agg = await env.DB.prepare(`
    SELECT COALESCE(SUM(stars), 0) AS rating_sum, COUNT(*) AS rating_count
    FROM novel_ratings WHERE slug = ?
  `).bind(slug).first();
  await env.DB.prepare(`
    UPDATE novels SET rating_sum = ?, rating_count = ? WHERE slug = ?
  `).bind(agg.rating_sum, agg.rating_count, slug).run();

  const avg = agg.rating_count > 0 ? Math.round((agg.rating_sum / agg.rating_count) * 10) / 10 : 0;
  return jsonResponse({ ok: true, rating: avg, rating_count: agg.rating_count });
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
      signal: AbortSignal.timeout(3000),
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
  'total_chapters', 'cover_url', 'translation_style', 'status', 'updated_at', 'synopsis',
];

async function getNovel(env, slug, request) {
  const novel = await env.DB.prepare(`
    SELECT * FROM novels WHERE slug = ?
  `).bind(slug).first();

  if (!novel) return jsonResponse({ error: 'Novel not found' }, 404);

  const isAdmin = request && await isAdminRequest(request, env);
  if (!novel.published && !isAdmin) {
    // F03: guest coi truyện bị gỡ như KHÔNG tồn tại — không phân biệt với 404
    // thật để tránh xác nhận sự tồn tại của nội dung đã bị gỡ. Admin vẫn xem
    // được (để quản lý/restore) — xử lý ở nhánh admin bên dưới như cũ.
    return jsonResponse({ error: 'Novel not found' }, 404);
  }

  // chapter_count phải dùng CÙNG công thức với getNovels() (đếm từ bảng D1
  // `chapters`, nguồn sự thật), KHÔNG dùng độ dài catalog.json (có thể lệch
  // với dữ liệu D1 thật, gây bug tương tự chapter_count sai ở getNovels()).
  const chapCountRow = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM chapters WHERE novel_slug = ?`
  ).bind(slug).first();
  let chapter_count = chapCountRow?.cnt || 0;
  let latest_chapter_title = null;
  try {
    const catObj = await env.CHAPTERS.get(`${slug}/catalog.json`);
    if (catObj) {
      const catalog = await catObj.json();
      if (catalog.length > 0) {
        latest_chapter_title = catalog[catalog.length - 1].title || null;
      }
    }
  } catch {}

  const common = {
    chapter_count,
    latest_chapter_title,
    last_translated_at: novel.updated_at
      ? Math.floor(Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(novel.updated_at) ? novel.updated_at : novel.updated_at.replace(' ', 'T') + 'Z') / 1000)
      : null,
    glossary_count: novel.glossary_count || 0,
  };

  if (!isAdmin) {
    // Guest: chỉ field whitelist + thống kê
    const pub = {};
    for (const k of NOVEL_PUBLIC_FIELDS) if (k in novel) pub[k] = novel[k];
    // synopsis preview: cắt 500 ký tự cho NovelPage, lazy load full qua /synopsis
    if (pub.synopsis && pub.synopsis.length > 500) {
      pub.synopsis_preview = pub.synopsis.slice(0, 500);
      pub.synopsis = pub.synopsis.slice(0, 500);
      pub.has_more_synopsis = true;
    } else {
      pub.synopsis_preview = pub.synopsis || '';
      pub.has_more_synopsis = false;
    }
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
  // 1. Kiểm tra drive_file_id từ Google Drive Library trong D1
  const novel = await env.DB.prepare(`SELECT drive_file_id, published FROM novels WHERE slug = ?`).bind(slug).first();
  // F03: truyện bị gỡ không được tiếp tục trả EPUB qua Drive/R2 fallback nào.
  if (novel && !novel.published) return jsonResponse({ error: 'Novel not found' }, 404);
  if (novel?.drive_file_id) {
    const driveUrl = `https://drive.usercontent.google.com/download?id=${novel.drive_file_id}&export=download&confirm=t`;
    try {
      const driveRes = await fetch(driveUrl, { redirect: 'follow' });
      if (driveRes.ok) {
        return new Response(driveRes.body, {
          status: 200,
          headers: {
            'Content-Type': 'application/epub+zip',
            'Content-Disposition': `inline; filename="${slug}.epub"`,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    } catch { /* fallback to R2 */ }
  }

  // 2. Fallback: EPUB từ R2 key "<slug>/book.epub"
  const obj = await env.CHAPTERS.get(`${slug}/book.epub`);
  if (!obj) {
    return jsonResponse({ error: 'EPUB chưa có cho truyện này.' }, 404);
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `inline; filename="${slug}.epub"`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
function sortAndDeduplicateCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];
  const seen = new Set();
  const unique = [];

  for (const item of catalog) {
    if (!item || !item.filename) continue;
    if (!seen.has(item.filename)) {
      seen.add(item.filename);
      unique.push(item);
    }
  }

  unique.sort((a, b) => {
    const numA = a.chapter_number != null ? a.chapter_number : (a.number != null ? a.number : 0);
    const numB = b.chapter_number != null ? b.chapter_number : (b.number != null ? b.number : 0);
    if (numA !== numB) return numA - numB;
    return (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true });
  });

  return unique;
}

// Tra cuu "upload_state.json" (ghi boi cong cu upload len Google Drive, KHAC
// voi tools/remote_state.json cua cloud_to_cloud_syncer.py) de lay file_id
// cua "chapters.json" tren Drive cho 1 truyen, roi tai va parse file do.
// Duoc dung chung boi ca getChaptersFromDriveFallback() (muc luc) LAN
// getChapterContentFromDrive() (noi dung tung chuong, xem ben duoi) de tranh
// lap code fetch/parse Drive o 2 noi.
async function fetchDriveAllChapters(env, slug) {
  try {
    const stateObj = await env.CHAPTERS.get('upload_state.json');
    if (!stateObj) return null;
    const state = await stateObj.json();
    const novelData = state.uploaded ? state.uploaded[slug] : null;
    if (!novelData) return null;

    const chapsFileId = novelData.files && novelData.files.chapters ? novelData.files.chapters.id : null;
    if (!chapsFileId) return null;

    const driveUrl = `https://drive.usercontent.google.com/download?id=${chapsFileId}&export=download`;
    const res = await fetch(driveUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      redirect: 'follow'
    });
    if (!res.ok) return null;

    const allChaps = await res.json();
    return Array.isArray(allChaps) ? allChaps : null;
  } catch (e) {
    return null;
  }
}

async function getChaptersFromDriveFallback(env, slug, ctx) {
  const allChaps = await fetchDriveAllChapters(env, slug);
  if (!allChaps) return null;

  const catalog = sortAndDeduplicateCatalog(allChaps.map(c => ({
    filename: c.filename,
    title: c.title,
    chapter_number: c.number || 0
  })));

  if (env.ENABLE_DRIVE_CACHE_WRITES !== 'true') return {catalog, allChaps};

  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(env.CHAPTERS.put(`${slug}/catalog.json`, JSON.stringify(catalog)));
  } else {
    await env.CHAPTERS.put(`${slug}/catalog.json`, JSON.stringify(catalog));
  }

  return { catalog, allChaps };
}

// [MOI] Bug da phat hien: getChaptersFromDriveFallback() o tren chi lay
// filename/title/chapter_number tu Drive de hien muc luc (va TU CACHE muc luc
// do vao R2 catalog.json) nhung KHONG luu lai noi dung that cua tung chuong.
// Vi vay, voi truyen chi moi duoc "kham pha" qua duong nay (chua tung chay
// migrate_to_cloudflare.py/cloud_to_cloud_syncer.py that su dong bo noi dung
// vao R2) - muc luc hien binh thuong nhung bam vao chuong cu the se 404, vi
// R2 khong co object noi dung ("slug/b64_<filename>") du catalog.json da co.
//
// Ham nay la du phong CUOI CUNG cho getChapterContent(): khi D1 va R2 (ke ca
// bundle) deu khong tim thay noi dung, thu tai lai "chapters.json" tu Drive
// (nguon du lieu goc ma cloud_to_cloud_syncer.py dung) va lay dung noi dung
// chuong duoc yeu cau. Sau khi lay duoc, TU GHI (self-heal) vao R2 + bang D1
// `chapters` qua ctx.waitUntil() de nhung lan doc sau lay thang tu R2, khong
// can goi lai Drive nua - giong cach getChaptersFromDriveFallback() dang tu
// cache catalog.json. Loi khi ghi cache (neu co) KHONG duoc lam hong response
// tra ve cho nguoi doc (chi la toi uu, khong phai dieu kien bat buoc).
//
// LUU Y CHI PHI: thao tac ghi nay la traffic DOC THAT tu doc gia, KHONG nam
// trong SyncBudget cua tools/cloud_to_cloud_syncer.py (ngan sach do chi dem
// thao tac cua rieng script do). Nhung day chi la 1 lan ghi/chuong duy nhat
// (lan doc dau tien), khong phai backfill hang loat toan bo truyen, nen rui
// ro vuot free tier R2/D1 rat thap.
async function getChapterContentFromDrive(env, slug, num, identifier, ctx) {
  const allChaps = await fetchDriveAllChapters(env, slug);
  if (!allChaps) return null;

  const ch = allChaps.find(c => (c.number === num || c.chapter_number === num || c.filename === identifier));
  if (!ch || typeof ch.content !== 'string' || !ch.filename) return null;

  const body = ch.content.startsWith('#') ? ch.content : `# ${ch.title || ch.filename}\n\n${ch.content}`;

  if (env.ENABLE_DRIVE_CACHE_WRITES !== 'true') return body;

  const encoded = btoa(unescape(encodeURIComponent(ch.filename))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r2Key = `${slug}/b64_${encoded}`;
  const chapterNumber = ch.number || 0;

  const cacheWrite = (async () => {
    await env.CHAPTERS.put(r2Key, body);
    await env.DB.prepare(`
      INSERT INTO chapters (novel_slug, filename, title, chapter_number, r2_key)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(novel_slug, filename) DO NOTHING
    `).bind(slug, ch.filename, ch.title || '', chapterNumber, r2Key).run();
  })().catch(() => {});


  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(cacheWrite);
  } else {
    await cacheWrite;
  }

  return body;
}

async function getChapters(env, slug, ctx) {
  // F03: truyện bị gỡ không được liệt kê chương qua đường này (bao gồm cả
  // fallback catalog.json/Drive bên dưới).
  const pubRow = await env.DB.prepare(`SELECT published FROM novels WHERE slug = ?`).bind(slug).first();
  if (pubRow && !pubRow.published) return jsonResponse({ error: 'Novel not found' }, 404);

  // Legacy catalog may include chapters not indexed yet (Drive lazy cache).
  // Merge rather than infer completeness from a nonempty D1 result.
  let legacy = [];
  const catObj = await env.CHAPTERS.get(`${slug}/catalog.json`);
  if (catObj) {
    try { legacy = JSON.parse((await catObj.text()).replace(/^\uFEFF/, '').trim()); }
    catch { /* A corrupt cache must not hide the authoritative index. */ }
  }
  if (!Array.isArray(legacy)) legacy = [];
  const {results} = await env.DB.prepare(`SELECT filename,title,chapter_number FROM chapters
    WHERE novel_slug = ? ORDER BY chapter_number ASC`).bind(slug).all();
  const merged = new Map(legacy.map(c => [c.filename,c]));
  for (const row of results || []) merged.set(row.filename,row);
  if (merged.size) return jsonResponse(sortAndDeduplicateCatalog([...merged.values()]));
  const driveResult = await getChaptersFromDriveFallback(env, slug, ctx);
  return jsonResponse(driveResult?.catalog || []);
}

// ── [MOI - THU NGHIEM] Doc chuong tu bundle JSON (che do --batch-upload) ────
// tools/migrate_to_cloudflare.py --batch-upload (opt-in, mac dinh KHONG bat)
// gop nhieu chuong lien tiep thanh 1 object JSON duy nhat
// "<slug>/bundles/bundle-NNNN.json" (dang { "<b64_key>": "<noi dung>", ... })
// thay vi PUT tung chuong rieng le, cung voi "<slug>/bundles/manifest.json"
// anh xa filename -> bundle R2 key.
//
// CANH BAO: TINH NANG NAY CHUA TUNG DUOC TEST VOI R2 THAT. Chi co du lieu de
// doc neu ai do da chu dong chay migrate voi --batch-upload. Voi toan bo du
// lieu hien co (upload theo tung-chuong nhu cu), ham nay luon tra ve null o
// buoc doc manifest (vi manifest.json chua ton tai) - KHONG anh huong gi toi
// hang nghin chuong da upload theo cach cu.
async function getChapterFromBundle(env, slug, filename) {
  if (!filename) return null;
  try {
    const manifestObj = await env.CHAPTERS.get(`${slug}/bundles/manifest.json`);
    if (!manifestObj) return null;
    const manifest = await manifestObj.json();
    const bundleKey = manifest[filename];
    if (!bundleKey) return null;

    const bundleObj = await env.CHAPTERS.get(bundleKey);
    if (!bundleObj) return null;
    const bundleData = await bundleObj.json();

    // Key ben trong bundle = base64url(filename) KHONG kem tien to "b64_" va
    // KHONG kem padding "=" - PHAI trung khop voi filename_to_bundle_key()
    // trong tools/migrate_to_cloudflare.py (sua 1 ben thi phai sua dong bo ben kia).
    const encoded = btoa(unescape(encodeURIComponent(filename)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const content = bundleData[encoded];
    return typeof content === 'string' ? content : null;
  } catch (e) {
    // Bundle hong/khong dung dinh dang - coi nhu khong co, de cac fallback khac xu ly
    return null;
  }
}

async function getChapterContent(env, slug, identifier, ctx) {
  // F03: truyện bị gỡ không được trả nội dung chương qua bất kỳ fallback nào
  // (D1/catalog/bundle/Drive) bên dưới.
  const pubRow = await env.DB.prepare(`SELECT published FROM novels WHERE slug = ?`).bind(slug).first();
  if (pubRow && !pubRow.published) {
    return jsonResponse({ error: 'Chapter content not found', identifier, slug }, 404);
  }

  let num = /^\d+$/.test(identifier) ? parseInt(identifier) : 0;
  if (!num) {
    const m = identifier.match(/(?:Chương|第)\s*(\d+)/i) || identifier.match(/(\d+)/);
    if (m) num = parseInt(m[1]);
  }

  // 1. Ưu tiên tra cứu r2_key trực tiếp từ D1 Database (nhanh & 100% chuẩn xác)
  try {
    const row = await env.DB.prepare(`
      SELECT r2_key, filename FROM chapters
      WHERE novel_slug = ? AND (chapter_number = ? OR filename = ?)
      LIMIT 1
    `).bind(slug, num, identifier).first();

    if (row && row.r2_key) {
      const obj = await env.CHAPTERS.get(row.r2_key);
      if (obj) {
        const text = await obj.text();
        return await chapterResponse(text);
      }
    }

    // [MOI - THU NGHIEM] Khong co object don le (vd da sync bang --batch-upload)
    // -> thu tim trong bundle JSON bang filename tu D1. Voi du lieu cu (khong
    // dung batch-upload), manifest.json khong ton tai nen ham nay tra null
    // ngay, khong anh huong gi toi flow hien co.
    if (row && row.filename) {
      const bundleContent = await getChapterFromBundle(env, slug, row.filename);
      if (bundleContent !== null) {
        return await chapterResponse(bundleContent);
      }
    }
  } catch { /* fallback */ }

  // 2. Fallback: tra cứu từ catalog.json R2
  try {
    const catObj = await env.CHAPTERS.get(`${slug}/catalog.json`);
    if (catObj) {
      let rawText = await catObj.text();
      rawText = rawText.replace(/^\uFEFF/, '').trim();
      const catalog = JSON.parse(rawText);
      const ch = catalog.find(c => (c.chapter_number === num || c.number === num || c.filename === identifier));
      if (ch && ch.filename) {
        const encoded = btoa(unescape(encodeURIComponent(ch.filename))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const r2Key = `${slug}/b64_${encoded}`;
        const obj = await env.CHAPTERS.get(r2Key);
        if (obj) {
          const text = await obj.text();
          return await chapterResponse(text);
        }

        // [MOI - THU NGHIEM] Thu bundle JSON bang filename lay tu catalog.
        const bundleContent = await getChapterFromBundle(env, slug, ch.filename);
        if (bundleContent !== null) {
          return await chapterResponse(bundleContent);
        }
      }
    }
  } catch { /* fallback */ }

  // 3. Du phong cuoi cung: lay truc tiep noi dung chuong tu Google Drive - xu
  // ly dung truong hop truyen chi moi duoc "kham pha" qua muc luc
  // (getChaptersFromDriveFallback o tren, dong 1) nhung noi dung chuong that
  // CHUA TUNG duoc dong bo vao R2 (xem giai thich chi tiet o
  // getChapterContentFromDrive()). Tu ghi cache khi lay duoc de lan sau nhanh
  // hon, khong can goi lai Drive.
  try {
    const driveContent = await getChapterContentFromDrive(env, slug, num, identifier, ctx);
    if (driveContent !== null) {
      return await chapterResponse(driveContent);
    }
  } catch { /* het du phong, tra 404 ben duoi */ }

  return jsonResponse({ error: 'Chapter content not found', identifier, slug }, 404);
}

async function updateGlossary(env, slug, request) {
  // Ghi glossary là hành động quản trị — phải qua isAdminRequest như các route
  // ghi khác (vd commentDelete), tránh khách ghi đè glossary của bất kỳ truyện nào.
  if (!(await isAdminRequest(request, env))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const GLOSSARY_MAX_BYTES = 2 * 1024 * 1024; // đủ cho vài nghìn thuật ngữ, chặn payload bất thường
  const parsed = await readLimitedJson(request, GLOSSARY_MAX_BYTES);
  if (!parsed.ok) return jsonResponse({ error: 'Payload không hợp lệ hoặc quá lớn' }, parsed.status);
  const body = parsed.body;
  const glossary = (body && typeof body === 'object' && body.glossary && typeof body.glossary === 'object') ? body.glossary : {};

  // 1. Lưu glossary dạng file JSON lên R2 (để lưu trữ không giới hạn kích thước)
  await env.CHAPTERS.put(`${slug}/glossary.json`, JSON.stringify(glossary, null, 2));

  // 2. Cập nhật D1 (cột glossary để '{}' tránh SQLITE_TOOBIG; lưu glossary_count
  // để danh sách /api/novels có số thuật ngữ thật mà không phải đọc R2)
  await env.DB.prepare(`
    UPDATE novels SET glossary = ?, glossary_count = ?, updated_at = ? WHERE slug = ?
  `).bind('{}', Object.keys(glossary).length, new Date().toISOString(), slug).run();

  return jsonResponse({ status: 'success', message: 'Glossary updated and saved to R2' });
}

// B03: `getSynopsis` được gọi ở route /api/novels/:slug/synopsis nhưng CHƯA
// TỪNG được định nghĩa — mọi request thật sự đến đây ném ReferenceError, bị
// try/catch tầng trên nuốt thành 500 (đã tái hiện). R2 `${slug}/synopsis.md`
// là nguồn MỚI NHẤT (được ghi đè ở mỗi lần sync is_first_chunk có synopsis),
// còn cột D1 `novels.synopsis` KHÔNG được cập nhật khi novel đã tồn tại (xem
// ON CONFLICT DO UPDATE trong syncNovelBatch — chỉ update total_chapters),
// nên D1 có thể cũ hơn R2. Ưu tiên đọc R2, fallback D1 khi R2 thiếu/lỗi.
async function getSynopsis(env, slug) {
  const novel = await env.DB.prepare(`SELECT synopsis, published FROM novels WHERE slug = ?`).bind(slug).first();
  if (!novel || !novel.published) return jsonResponse({ error: 'Novel not found' }, 404);

  try {
    const obj = await env.CHAPTERS.get(`${slug}/synopsis.md`);
    if (obj) {
      const text = await obj.text();
      return jsonResponse({ slug, synopsis: text, source: 'r2' });
    }
  } catch { /* R2 lỗi tạm thời → fallback D1 bên dưới, không 500 */ }

  return jsonResponse({ slug, synopsis: novel.synopsis || '', source: 'd1' });
}

async function getHealth(env, slug) {
  const novel = await env.DB.prepare(
    `SELECT total_chapters FROM novels WHERE slug = ?`
  ).bind(slug).first();

  if (!novel) return jsonResponse({ error: 'Novel not found' }, 404);

  const {results} = await env.DB.prepare(
    'SELECT filename FROM chapters WHERE novel_slug = ?'
  ).bind(slug).all();
  const filenames = new Set((results || []).map(row => row.filename));
  try {
    const object = await env.CHAPTERS.get(`${slug}/catalog.json`);
    const catalog = object ? await object.json() : [];
    if (Array.isArray(catalog)) {
      for (const chapter of catalog) if (chapter.filename) filenames.add(chapter.filename);
    }
  } catch { /* D1 remains available when the legacy catalog is corrupt. */ }
  const totalTranslated = filenames.size;

  return jsonResponse({
    summary: {
      total_translated: totalTranslated,
      total_raw: novel?.total_chapters || 0,
    },
    issues: [],
  });
}

async function syncNovelBatch(env, request) {
  const authHeader = request.headers.get('x-sync-key') || '';
  if (!env.SYNC_KEY || !timingSafeEqualStr(authHeader, env.SYNC_KEY)) {
    return jsonResponse({ error: 'Unauthorized sync key' }, 401);
  }
  if (env.ALLOW_SYNC_WRITES !== 'true') return jsonResponse({error:'Cloud sync writes are disabled'},503);
  const maxBytes = 2 * 1024 * 1024;
  const reader = request.body?.getReader();
  if (!reader) return jsonResponse({ error: 'Missing body' }, 400);
  let size = 0;
  const parts = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); return jsonResponse({error: 'Payload too large'}, 413); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return jsonResponse({error: 'Invalid JSON'}, 400); }
  const {slug, chapters} = data || {};
  if (typeof slug !== 'string' || !SLUG_RE.test(slug) || !Array.isArray(chapters) || chapters.length < 1 || chapters.length > 25) {
    return jsonResponse({error: 'Expected safe slug and 1–25 chapters'}, 400);
  }
  const filenames = new Set();
  for (const c of chapters) {
    if (!c || typeof c.filename !== 'string' || !c.filename || c.filename.length > 240 || /[\\/\x00-\x1f]/.test(c.filename)
        || c.filename === '.' || c.filename === '..' || filenames.has(c.filename)
        || typeof c.title !== 'string' || c.title.length > 500
        || typeof c.content !== 'string' || !c.content.trim()
        || !Number.isSafeInteger(c.number) || c.number < 0
        || (c.expected_r2_key !== undefined && c.expected_r2_key !== null && typeof c.expected_r2_key !== 'string')) {
      return jsonResponse({error: 'Invalid or duplicate chapter'}, 400);
    }
    filenames.add(c.filename);
  }
  for (const field of ['title','original_title','author','genre','synopsis','drive_file_id']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') return jsonResponse({error: `Invalid ${field}`},400);
  }
  if (data.total_chapter_count !== undefined && (!Number.isSafeInteger(data.total_chapter_count) || data.total_chapter_count < chapters.length)) {
    return jsonResponse({error: 'Invalid total_chapter_count'},400);
  }
  const placeholders = chapters.map(() => '?').join(',');
  const readRows = () => env.DB.prepare(`SELECT filename, r2_key FROM chapters WHERE novel_slug = ? AND filename IN (${placeholders})`)
    .bind(slug, ...chapters.map(c => c.filename)).all();
  const {results: previous} = await readRows();
  const oldKeys = new Map(previous.map(c => [c.filename, c.r2_key]));
  const prepared = [];
  for (const c of chapters) {
    const body = c.content.startsWith('#') ? c.content : `# ${c.title}\n\n${c.content}`;
    const hash = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
    const key = `${slug}/content/${hash}.md`;
    const old = oldKeys.get(c.filename) || null;
    // Idempotent retry accepts the same hash. Replacing existing content needs
    // the explicit previous key; stale clients cannot silently overwrite it.
    if (old && old !== key && c.expected_r2_key !== old) {
      return jsonResponse({error: 'Chapter changed; reconcile before replacing', filename: c.filename},409);
    }
    prepared.push({...c, body, key, old});
  }
  // Immutable objects first. Failed commits may leave unreferenced objects;
  // they are safe to retry and are never deleted automatically here.
  for (const c of prepared) await env.CHAPTERS.put(c.key, c.body);
  if (data.is_first_chunk !== false && data.synopsis) {
    await env.CHAPTERS.put(`${slug}/synopsis.md`, data.synopsis);
  }
  const operations = [env.DB.prepare(`
    INSERT INTO novels (slug,title,original_title,author,genre,total_chapters,drive_file_id,synopsis)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET
      total_chapters=MAX(novels.total_chapters,excluded.total_chapters), updated_at=datetime('now')
  `).bind(slug, data.title || slug, data.original_title || '', data.author || '', data.genre || '',
    data.total_chapter_count || chapters.length, data.drive_file_id || '', (data.synopsis || '').slice(0,2000))];
  for (const c of prepared) {
    operations.push(env.DB.prepare(`
      INSERT INTO chapters (novel_slug,filename,title,chapter_number,r2_key) VALUES (?,?,?,?,?)
      ON CONFLICT(novel_slug,filename) DO UPDATE SET
        title=excluded.title,chapter_number=excluded.chapter_number,r2_key=excluded.r2_key
      WHERE chapters.r2_key = ? OR chapters.r2_key = excluded.r2_key
    `).bind(slug,c.filename,c.title,c.number,c.key,c.old));
  }
  await env.DB.batch(operations);
  const {results: committed} = await readRows();
  const keys = new Map(committed.map(c => [c.filename,c.r2_key]));
  if (prepared.some(c => keys.get(c.filename) !== c.key)) return jsonResponse({error:'Concurrent chapter change; reconcile and retry'},409);
  // Catalog remains a legacy read source. Never overwrite it from a chunk.
  // getChapters merges D1 entries over legacy entries by filename.
  return jsonResponse({success:true,slug,chapters_synced:chapters.length});
}

// ── User account system (roadmap 3.1–3.4) ────────────────────────────────────
// Mirror hợp đồng API của backend FastAPI: register/login/logout/me,
// bookmarks, reading progress, comments. Dữ liệu ở D1 (migrations/002_users.sql).

const SLUG_RE = /^[a-z0-9-]{1,100}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

// A05: đọc body JSON với giới hạn byte cứng — chặn trước khi materialize
// body quá lớn bằng cách kiểm tra Content-Length khai báo, đồng thời đếm byte
// thật khi đọc stream (không tin tưởng tuyệt đối header, có thể thiếu/sai).
// Trả { ok:false, status } khi vượt giới hạn hoặc JSON hỏng, { ok:true, body }
// khi thành công.
async function readLimitedJson(request, maxBytes) {
  const declared = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (declared > maxBytes) return { ok: false, status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  let size = 0;
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413 };
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

// Giới hạn mặc định cho body auth/bookmark/progress/comment/novel-request —
// các payload này chỉ chứa vài trường text ngắn, không cần lớn.
const DEFAULT_JSON_MAX_BYTES = 64 * 1024; // 64 KiB

// ── Password hashing (PBKDF2-SHA256, tương thích hashlib.pbkdf2_hmac Python) ──

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// C07: sw.js cache-first nội dung chương theo URL, không tự phát hiện khi
// chương được dịch lại/sửa (URL không đổi). `version` = hash nội dung, cho
// phép service worker so sánh bản cache với bản mới nhất (stale-while-
// revalidate) mà không cần đổi contract URL hiện có.
async function chapterResponse(content) {
  const version = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))).slice(0, 16);
  return jsonResponse({ content, version });
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
  const __parsed = await readLimitedJson(request, DEFAULT_JSON_MAX_BYTES);
  if (!__parsed.ok) return jsonResponse({ error: 'Invalid JSON body or payload too large' }, __parsed.status);
  const body = __parsed.body;

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();

  if (!EMAIL_RE.test(email) || email.length > 254) return jsonResponse({ error: 'Email không hợp lệ' }, 400);
  if (password.length < 8 || password.length > 256) return jsonResponse({ error: 'Mật khẩu phải từ 8 đến 256 ký tự' }, 400);
  if (name.length > 100) return jsonResponse({ error: 'Tên quá dài' }, 400);

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
  const __parsed = await readLimitedJson(request, DEFAULT_JSON_MAX_BYTES);
  if (!__parsed.ok) return jsonResponse({ error: 'Invalid JSON body or payload too large' }, __parsed.status);
  const body = __parsed.body;

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (email.length > 254 || password.length > 256) {
    return jsonResponse({ error: 'Email hoặc mật khẩu không hợp lệ' }, 400);
  }

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
    SELECT slug, chapter, position, type, updated_at FROM reading_progress
    WHERE user_id = ? ORDER BY updated_at DESC
  `).bind(user.id).all();
  return jsonResponse(results);
}

async function userProgressUpdate(request, env, slug) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'Slug không hợp lệ' }, 400);

  const __parsed = await readLimitedJson(request, DEFAULT_JSON_MAX_BYTES);
  if (!__parsed.ok) return jsonResponse({ error: 'Invalid JSON body or payload too large' }, __parsed.status);
  const body = __parsed.body;
  const type = body && body.type !== undefined ? body.type : 'chapter';
  if (type !== 'chapter' && type !== 'epub') {
    return jsonResponse({ error: "type phải là 'chapter' hoặc 'epub'" }, 400);
  }

  let chapter = null;
  let position;
  if (type === 'chapter') {
    if (!body || !Number.isInteger(body.chapter)) {
      return jsonResponse({ error: 'chapter phải là số nguyên' }, 400);
    }
    chapter = body.chapter;
    position = String(body.chapter);
  } else {
    if (!body || typeof body.position !== 'string' || !body.position || body.position.length > 2000) {
      return jsonResponse({ error: 'position phải là chuỗi CFI không rỗng và không quá 2000 ký tự' }, 400);
    }
    position = body.position;
  }

  // C03: client_updated_at (epoch ms, optional — tương thích client cũ) chặn
  // request cũ đến muộn (network delay/retry) ghi đè bản mới hơn đã lưu.
  // Điều kiện đặt NGAY TRONG WHERE của DO UPDATE để toàn bộ so sánh + ghi là
  // MỘT statement nguyên tử (không tách SELECT rồi UPDATE — sẽ có race).
  // KHÔNG lấy max(chapter): đọc lại chương trước là tiến độ mới hợp lệ.
  const clientUpdatedAt = Number.isSafeInteger(body?.client_updated_at) ? body.client_updated_at : null;
  const { meta } = await env.DB.prepare(`
    INSERT INTO reading_progress (user_id, slug, chapter, position, type, updated_at, client_updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(user_id, slug) DO UPDATE SET
      chapter = excluded.chapter, position = excluded.position,
      type = excluded.type, updated_at = excluded.updated_at,
      client_updated_at = excluded.client_updated_at
    WHERE excluded.client_updated_at IS NULL
       OR reading_progress.client_updated_at IS NULL
       OR excluded.client_updated_at >= reading_progress.client_updated_at
  `).bind(user.id, slug, chapter, position, type, clientUpdatedAt).run();

  if (!meta.changes) {
    return jsonResponse({ ok: false, error: 'Đã có tiến độ mới hơn được lưu, bỏ qua request cũ này' }, 409);
  }
  return jsonResponse({ ok: true });
}

// ── Comments ──────────────────────────────────────────────────────────────────

async function commentsList(env, slug, url) {
  if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'Slug không hợp lệ' }, 400);
  const chapterParam = url.searchParams.get('chapter');

  let chapNum = null;
  if (chapterParam !== null) {
    if (/^\d+$/.test(chapterParam)) {
      chapNum = parseInt(chapterParam);
    } else {
      const m = chapterParam.match(/(?:Chương|第)\s*(\d+)/i) || chapterParam.match(/(\d+)/);
      if (m) chapNum = parseInt(m[1]);
    }
  }

  try {
    let stmt;
    if (chapNum !== null) {
      stmt = env.DB.prepare(`
        SELECT c.id, u.name AS user_name, c.chapter, c.content, c.created_at
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.slug = ? AND c.chapter = ?
        ORDER BY c.id DESC LIMIT 100
      `).bind(slug, chapNum);
    } else {
      stmt = env.DB.prepare(`
        SELECT c.id, u.name AS user_name, c.chapter, c.content, c.created_at
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.slug = ?
        ORDER BY c.id DESC LIMIT 100
      `).bind(slug);
    }
    const { results } = await stmt.all();
    return jsonResponse(results || []);
  } catch (err) {
    return jsonResponse([]);
  }
}

// Bình luận mới nhất TOÀN SITE cho trang chủ — dữ liệu vốn đã công khai qua
// GET /api/novels/:slug/comments (không auth), chỉ gộp lại theo thời gian nên
// không phát sinh rò rỉ thông tin mới.
async function recentComments(env, url) {
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '5', 10) || 5));
  try {
    const { results } = await env.DB.prepare(`
      SELECT c.id, c.slug, n.title AS novel_title, u.name AS user_name, c.chapter, c.content, c.created_at
      FROM comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN novels n ON n.slug = c.slug
      ORDER BY c.id DESC LIMIT ?
    `).bind(limit).all();
    return jsonResponse(results || []);
  } catch (err) {
    return jsonResponse([]);
  }
}

async function commentCreate(request, env, slug) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'Slug không hợp lệ' }, 400);

  const __parsed = await readLimitedJson(request, DEFAULT_JSON_MAX_BYTES);
  if (!__parsed.ok) return jsonResponse({ error: 'Invalid JSON body or payload too large' }, __parsed.status);
  const body = __parsed.body;

  const content = String(body.content || '').trim();
  const chapter = Number.isInteger(body.chapter) ? body.chapter : 0;
  if (!content || content.length > 2000) {
    return jsonResponse({ error: 'Nội dung phải từ 1 đến 2000 ký tự' }, 400);
  }

  // F01: cooldown 1 comment / 20 giây / user PHẢI nguyên tử — kiểm tra rồi
  // insert bằng 2 statement riêng (bản cũ) có race: 2 request đồng thời có thể
  // cùng đọc "chưa có comment gần đây" trước khi bên nào insert xong. Gộp
  // thành 1 câu INSERT...SELECT...WHERE NOT EXISTS để toàn bộ kiểm tra + ghi
  // xảy ra trong một statement duy nhất.
  const { meta } = await env.DB.prepare(`
    INSERT INTO comments (user_id, slug, chapter, content)
    SELECT ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM comments WHERE user_id = ? AND created_at > datetime('now', '-20 seconds')
    )
  `).bind(user.id, slug, chapter, content, user.id).run();
  if (!meta.changes) return jsonResponse({ error: 'Bình luận quá nhanh, thử lại sau 20 giây' }, 429);
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

// ── Request Novel ──────────────────────────────────────────────────────────────
// Độc giả đã đăng nhập gửi URL truyện muốn dịch; admin xem danh sách và duyệt/
// từ chối. Duyệt CHỈ đổi status trong D1 — KHÔNG tự động gọi scraper/import
// (tránh SSRF/rủi ro tự động hóa); admin vẫn phải tự chạy `python main.py import
// --url ...` thủ công. Hợp đồng API này phải khớp với routers/users.py.
const MAX_REQUEST_URL_LENGTH = 500;
const MAX_REQUEST_NOTE_LENGTH = 500;
const MAX_PENDING_NOVEL_REQUESTS = 3;
const NOVEL_REQUEST_STATUSES = new Set(['approved', 'rejected']);

async function novelRequestCreate(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const __parsed = await readLimitedJson(request, DEFAULT_JSON_MAX_BYTES);
  if (!__parsed.ok) return jsonResponse({ error: 'Invalid JSON body or payload too large' }, __parsed.status);
  const body = __parsed.body;

  const requestUrl = String(body.url || '').trim();
  const note = String(body.note || '').trim();

  if (!(requestUrl.startsWith('http://') || requestUrl.startsWith('https://'))) {
    return jsonResponse({ error: 'URL phải bắt đầu bằng http:// hoặc https://' }, 400);
  }
  if (requestUrl.length < 1 || requestUrl.length > MAX_REQUEST_URL_LENGTH) {
    return jsonResponse({ error: `URL phải từ 1 đến ${MAX_REQUEST_URL_LENGTH} ký tự` }, 400);
  }
  if (note.length > MAX_REQUEST_NOTE_LENGTH) {
    return jsonResponse({ error: `Ghi chú tối đa ${MAX_REQUEST_NOTE_LENGTH} ký tự` }, 400);
  }

  // F01: quota "tối đa N pending / user" PHẢI nguyên tử — bản cũ dùng
  // SELECT COUNT rồi INSERT rồi SELECT COUNT lại để "tự sửa sai" là 3
  // statement rời rạc, vẫn còn khe hở giữa các bước. Gộp kiểm tra + ghi vào
  // MỘT câu INSERT...SELECT...WHERE (subquery đếm pending) < MAX, chạy như
  // một statement duy nhất nên không có 2 request nào cùng "lọt qua" check.
  const { meta } = await env.DB.prepare(`
    INSERT INTO novel_requests (user_id, url, note)
    SELECT ?, ?, ?
    WHERE (SELECT COUNT(*) FROM novel_requests WHERE user_id = ? AND status = 'pending') < ?
  `).bind(user.id, requestUrl, note, user.id, MAX_PENDING_NOVEL_REQUESTS).run();

  if (!meta.changes) {
    return jsonResponse({
      error: `Bạn đang có ${MAX_PENDING_NOVEL_REQUESTS} yêu cầu chờ duyệt. `
        + 'Vui lòng đợi admin xử lý trước khi gửi thêm.',
    }, 429);
  }

  return jsonResponse({ id: meta.last_row_id }, 201);
}

async function novelRequestsMine(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const { results } = await env.DB.prepare(`
    SELECT id, url, note, status, admin_note, created_at, reviewed_at
    FROM novel_requests WHERE user_id = ? ORDER BY id DESC
  `).bind(user.id).all();
  return jsonResponse(results || []);
}

async function adminNovelRequestsList(request, env, url) {
  if (!(await isAdminRequest(request, env))) {
    return jsonResponse({ error: 'Unauthorized' }, 403);
  }
  const status = url.searchParams.get('status');
  let stmt;
  if (status) {
    stmt = env.DB.prepare(`
      SELECT r.id, r.user_id, COALESCE(u.email, '') AS email, r.url, r.note,
             r.status, r.admin_note, r.created_at, r.reviewed_at
      FROM novel_requests r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.status = ? ORDER BY r.id DESC
    `).bind(status);
  } else {
    stmt = env.DB.prepare(`
      SELECT r.id, r.user_id, COALESCE(u.email, '') AS email, r.url, r.note,
             r.status, r.admin_note, r.created_at, r.reviewed_at
      FROM novel_requests r LEFT JOIN users u ON u.id = r.user_id
      ORDER BY r.id DESC
    `);
  }
  const { results } = await stmt.all();
  return jsonResponse(results || []);
}

async function adminNovelRequestReview(request, env, id) {
  if (!(await isAdminRequest(request, env))) {
    return jsonResponse({ error: 'Unauthorized' }, 403);
  }
  const __parsed = await readLimitedJson(request, DEFAULT_JSON_MAX_BYTES);
  if (!__parsed.ok) return jsonResponse({ error: 'Invalid JSON body or payload too large' }, __parsed.status);
  const body = __parsed.body;

  const status = String(body.status || '');
  const adminNote = String(body.admin_note || '').trim();
  if (!NOVEL_REQUEST_STATUSES.has(status)) {
    return jsonResponse({ error: "status chỉ nhận 'approved' hoặc 'rejected'" }, 400);
  }
  if (adminNote.length > MAX_REQUEST_NOTE_LENGTH) {
    return jsonResponse({ error: `Ghi chú admin tối đa ${MAX_REQUEST_NOTE_LENGTH} ký tự` }, 400);
  }

  const { meta } = await env.DB.prepare(
    `UPDATE novel_requests SET status = ?, admin_note = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'`
  ).bind(status, adminNote, id).run();
  if (!meta.changes) {
    // UPDATE không đổi dòng nào — có thể do id không tồn tại, hoặc id tồn tại
    // nhưng đã được duyệt/từ chối trước đó (double-review). Phân biệt 2 case
    // bằng cách query lại status hiện tại.
    const existing = await env.DB.prepare(
      `SELECT status FROM novel_requests WHERE id = ?`
    ).bind(id).first();
    if (!existing) return jsonResponse({ error: 'Không tìm thấy yêu cầu' }, 404);
    return jsonResponse({ error: 'Yêu cầu này đã được xử lý trước đó' }, 409);
  }
  return jsonResponse({ ok: true });
}

// F03: gỡ/khôi phục xuất bản — TÁCH BIỆT hoàn toàn khỏi status ongoing/
// completed. published=0 ẩn khỏi mọi đường đọc công khai (getNovels/getNovel/
// getChapters/getChapterContent/getEpub/getSynopsis) nhưng KHÔNG xóa dữ liệu.
// Mọi thao tác ghi vào admin_actions để có audit trail.
async function adminTakedownRestore(request, env, slug, action) {
  if (!(await isAdminRequest(request, env))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'Slug không hợp lệ' }, 400);

  let reason = '';
  if (action === 'takedown') {
    const __parsed = await readLimitedJson(request, DEFAULT_JSON_MAX_BYTES);
    // Body rỗng vẫn hợp lệ (lý do tùy chọn) — chỉ từ chối khi JSON thật sự hỏng/quá lớn.
    if (!__parsed.ok && __parsed.status === 413) return jsonResponse({ error: 'Payload quá lớn' }, 413);
    reason = String((__parsed.ok && __parsed.body && __parsed.body.reason) || '').slice(0, 2000);
  }

  const published = action === 'restore' ? 1 : 0;
  const { meta } = await env.DB.prepare(`
    UPDATE novels SET published = ?, takedown_reason = ?, takedown_at = ?
    WHERE slug = ?
  `).bind(
    published,
    action === 'restore' ? '' : reason,
    action === 'restore' ? null : new Date().toISOString(),
    slug,
  ).run();
  if (!meta.changes) return jsonResponse({ error: 'Novel not found' }, 404);

  await env.DB.prepare(`
    INSERT INTO admin_actions (action, slug, note) VALUES (?, ?, ?)
  `).bind(action, slug, reason).run();

  return jsonResponse({ status: 'success', published: Boolean(published) });
}

// ── Proxy to Python backend ───────────────────────────────────────────────────
async function proxyToBackend(request, url, env) {
  const backendUrl = env.BACKEND_URL;
  if (!backendUrl) {
    return jsonResponse({ error: 'Backend không khả dụng trong Cloudflare mode. Cần chạy Python server local.' }, 503);
  }

  const targetUrl = `${backendUrl}${url.pathname}${url.search}`;
  const proxied = new Request(targetUrl, request);

  try {
    return await fetch(proxied);
  } catch (err) {
    const errorCode = crypto.randomUUID().slice(0, 8);
    console.error(`[${errorCode}] proxyToBackend ${url.pathname}`, err && err.stack ? err.stack : err);
    return jsonResponse({ error: 'Không thể kết nối backend.', code: errorCode }, 502);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonResponse(data, status = 200, customHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...customHeaders },
  });
}

// Domain thật của site — có thể override qua secret ALLOWED_ORIGINS (danh sách
// cách nhau bởi dấu phẩy) mà không cần sửa code, giống ALLOWED_ORIGINS bên
// FastAPI. Frontend gọi API bằng URL tương đối (baseURL: '/api') nên đây là
// same-origin với đa số request thật — allowlist chỉ ảnh hưởng request
// cross-origin (vd gọi thẳng từ domain khác), không làm gãy site chính.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hacdaotruyen.com',
  'https://www.hacdaotruyen.com',
  'https://nguyenbaosang1998.workers.dev',
];

function getAllowedOrigins(env) {
  if (env && typeof env.ALLOWED_ORIGINS === 'string' && env.ALLOWED_ORIGINS.trim()) {
    return env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function corsResponse(response, request, env) {
  const res = new Response(response.body, response);
  const origin = request && request.headers.get('Origin');
  if (origin && getAllowedOrigins(env).includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.append('Vary', 'Origin');
  }
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}
