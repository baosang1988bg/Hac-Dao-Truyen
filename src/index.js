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
        return corsResponse(jsonResponse({ error: err.message }, 500), request, env);
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

  // Global Rate Limiting: Chống DDoS/Spam - Tối đa 120 API request / 1 phút / IP
  if (!checkRateLimit(`api:${clientIp(request)}`, 60_000, 120)) {
    return jsonResponse({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.' }, 429);
  }

  // POST /api/admin/sync-novel — high-speed batch sync endpoint
  if (path === '/api/admin/sync-novel' && method === 'POST') {
    return syncNovelBatch(env, request);
  }

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

  // GET /api/proxy-cover?url=...
  if (path === '/api/proxy-cover' && method === 'GET') {
    return proxyCover(url);
  }

  // ── Proxy translate jobs → Python backend (nếu có BACKEND_URL) ──────
  if (path.includes('/translate') || path.includes('/tools') || path === '/api/logs') {
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
    // Một số CDN ảnh trả Content-Type chung chung/thiếu — chỉ chặn khi rõ ràng
    // KHÔNG phải ảnh (html/json/text), để không làm gãy bìa đang chạy tốt.
    const contentType = imgRes.headers.get('Content-Type') || '';
    const looksLikeNonImage = /^(text\/|application\/json|application\/xml)/i.test(contentType);
    if (imgRes.ok && !looksLikeNonImage) {
      const headers = new Headers();
      headers.set('Content-Type', contentType || 'image/jpeg');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'public, max-age=604800, s-maxage=604800');
      return new Response(imgRes.body, { status: 200, headers });
    }
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
  const where = ['1=1'];
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
      ? Math.floor(Date.parse(last_created_at.replace(' ', 'T') + 'Z') / 1000)
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

// Rate-limit nhẹ theo IP, best-effort trong bộ nhớ của 1 isolate (không cần
// thêm KV/D1 mới). Reset khi Worker khởi động lại isolate — chấp nhận được vì
// mục tiêu chỉ là chặn spam tự động, không phải giới hạn cứng tuyệt đối.
const _rateLimitMap = new Map(); // key -> { count, resetAt }

function checkRateLimit(key, windowMs, maxRequests = 1) {
  const now = Date.now();
  let entry = _rateLimitMap.get(key);
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

async function rateNovel(env, slug, request) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
  const stars = parseInt(body.stars);
  if (!stars || stars < 1 || stars > 5) return jsonResponse({ error: 'stars must be 1-5' }, 400);

  // 1 lượt đánh giá / IP / truyện / 5 giây — chỉ chặn double-submit/spam script,
  // không cản người dùng thật đổi ý đánh giá lại sau vài giây.
  if (!checkRateLimit(`rate:${clientIp(request)}:${slug}`, 5_000)) {
    return jsonResponse({ error: 'Vui lòng thử lại sau vài giây' }, 429);
  }

  await env.DB.prepare(`
    UPDATE novels SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE slug = ?
  `).bind(stars, slug).run();

  const row = await env.DB.prepare(`
    SELECT rating_sum, rating_count FROM novels WHERE slug = ?
  `).bind(slug).first();
  const avg = row && row.rating_count > 0 ? Math.round((row.rating_sum / row.rating_count) * 10) / 10 : 0;
  return jsonResponse({ ok: true, rating: avg, rating_count: row?.rating_count || 0 });
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
  'total_chapters', 'cover_url', 'translation_style', 'status', 'updated_at', 'synopsis',
];

async function getNovel(env, slug, request) {
  const novel = await env.DB.prepare(`
    SELECT * FROM novels WHERE slug = ?
  `).bind(slug).first();

  if (!novel) return jsonResponse({ error: 'Novel not found' }, 404);

  let chapter_count = novel.total_chapters || 0;
  let latest_chapter_title = null;
  try {
    const catObj = await env.CHAPTERS.get(`${slug}/catalog.json`);
    if (catObj) {
      const catalog = await catObj.json();
      chapter_count = catalog.length;
      if (catalog.length > 0) {
        latest_chapter_title = catalog[catalog.length - 1].title || null;
      }
    }
  } catch {}

  const common = {
    chapter_count,
    latest_chapter_title,
    last_translated_at: novel.updated_at
      ? Math.floor(Date.parse(novel.updated_at.replace(' ', 'T') + 'Z') / 1000)
      : null,
    glossary_count: novel.glossary_count || 0,
  };

  if (!(request && await isAdminRequest(request, env))) {
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
  const novel = await env.DB.prepare(`SELECT drive_file_id FROM novels WHERE slug = ?`).bind(slug).first();
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

async function getChaptersFromDriveFallback(env, slug, ctx) {
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
    if (!Array.isArray(allChaps)) return null;

    const catalog = sortAndDeduplicateCatalog(allChaps.map(c => ({
      filename: c.filename,
      title: c.title,
      chapter_number: c.number || 0
    })));

    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(env.CHAPTERS.put(`${slug}/catalog.json`, JSON.stringify(catalog)));
    } else {
      await env.CHAPTERS.put(`${slug}/catalog.json`, JSON.stringify(catalog));
    }

    return { catalog, allChaps };
  } catch (e) {
    return null;
  }
}

async function getChapters(env, slug, ctx) {
  // 1. Ưu tiên đọc catalog.json từ R2 (Store không giới hạn dung lượng)
  try {
    const catObj = await env.CHAPTERS.get(`${slug}/catalog.json`);
    if (catObj) {
      let text = await catObj.text();
      text = text.replace(/^\uFEFF/, '').trim();
      const catalog = JSON.parse(text);
      const cleaned = sortAndDeduplicateCatalog(catalog);
      if (cleaned.length > 0) {
        return jsonResponse(cleaned);
      }
    }
  } catch (e) { /* fallback */ }

  // 2. Tra cứu từ D1 database
  try {
    const { results } = await env.DB.prepare(`
      SELECT filename, title, chapter_number
      FROM chapters
      WHERE novel_slug = ?
      ORDER BY chapter_number ASC
    `).bind(slug).all();

    if (results && results.length > 0) {
      return jsonResponse(sortAndDeduplicateCatalog(results));
    }
  } catch { /* fallback */ }

  // 3. Dynamic Fallback: Nạp trực tiếp từ Google Drive 5TB nếu R2 & D1 chưa có
  const driveResult = await getChaptersFromDriveFallback(env, slug, ctx);
  if (driveResult && driveResult.catalog) {
    return jsonResponse(driveResult.catalog);
  }

  return jsonResponse([]);
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
        return jsonResponse({ content: text });
      }
    }

    // [MOI - THU NGHIEM] Khong co object don le (vd da sync bang --batch-upload)
    // -> thu tim trong bundle JSON bang filename tu D1. Voi du lieu cu (khong
    // dung batch-upload), manifest.json khong ton tai nen ham nay tra null
    // ngay, khong anh huong gi toi flow hien co.
    if (row && row.filename) {
      const bundleContent = await getChapterFromBundle(env, slug, row.filename);
      if (bundleContent !== null) {
        return jsonResponse({ content: bundleContent });
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
          return jsonResponse({ content: text });
        }

        // [MOI - THU NGHIEM] Thu bundle JSON bang filename lay tu catalog.
        const bundleContent = await getChapterFromBundle(env, slug, ch.filename);
        if (bundleContent !== null) {
          return jsonResponse({ content: bundleContent });
        }
      }
    }
  } catch { /* fallback */ }

  return jsonResponse({ error: 'Chapter content not found', identifier, slug }, 404);
}

async function updateGlossary(env, slug, request) {
  // Ghi glossary là hành động quản trị — phải qua isAdminRequest như các route
  // ghi khác (vd commentDelete), tránh khách ghi đè glossary của bất kỳ truyện nào.
  if (!(await isAdminRequest(request, env))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
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
  let totalTranslated = 0;
  try {
    const catObj = await env.CHAPTERS.get(`${slug}/catalog.json`);
    if (catObj) {
      const catalog = await catObj.json();
      totalTranslated = catalog.length;
    }
  } catch {}

  const novel = await env.DB.prepare(
    `SELECT total_chapters FROM novels WHERE slug = ?`
  ).bind(slug).first();

  return jsonResponse({
    summary: {
      total_translated: totalTranslated,
      total_raw: novel?.total_chapters || 0,
    },
    issues: [],
  });
}

async function syncNovelBatch(env, request) {
  try {
    const authHeader = request.headers.get('x-sync-key') || '';
    // SYNC_KEY phải set qua `wrangler secret put SYNC_KEY` — KHÔNG có giá trị
    // mặc định/fallback về 'hacdao-secret-2026' vì secret đó đã lộ công khai
    // trong lịch sử git (repo public). Nếu env.SYNC_KEY chưa được set, từ chối
    // toàn bộ (fail-closed) thay vì âm thầm chấp nhận secret cũ đã bị lộ.
    if (!env.SYNC_KEY || !timingSafeEqualStr(authHeader, env.SYNC_KEY)) {
      return jsonResponse({ error: 'Unauthorized sync key' }, 401);
    }

    const data = await request.json();
    const { slug, title, original_title, author, genre, synopsis, chapters, is_first_chunk = true, total_chapter_count } = data;

    if (!slug || !chapters) {
      return jsonResponse({ error: 'Missing slug or chapters' }, 400);
    }

    const totalCount = total_chapter_count || chapters.length;

    // 1. Lưu/Cập nhật thông tin truyện duy nhất 1 dòng vào D1 `novels` table
    if (is_first_chunk) {
      const preview = (synopsis || '').slice(0, 2000).replace(/'/g, "''");
      await env.DB.prepare(`
        INSERT INTO novels (slug, title, original_title, author, genre, source_url, last_translated_url, last_chapter_number, total_chapters, glossary, glossary_count, translation_style, notes, updated_at, synopsis, has_epub)
        VALUES (?, ?, ?, ?, ?, '', '', ?, ?, '{}', 0, 'văn học', '', ?, ?, 1)
        ON CONFLICT(slug) DO UPDATE SET
          title=excluded.title, last_chapter_number=excluded.total_chapters, total_chapters=excluded.total_chapters, updated_at=excluded.updated_at, synopsis=excluded.synopsis, has_epub=1
      `).bind(
        slug, title || slug, original_title || '', author || 'Unknown', genre || 'Khác',
        totalCount, totalCount, new Date().toISOString(), preview
      ).run();

      if (synopsis) {
        await env.CHAPTERS.put(`${slug}/synopsis.md`, synopsis);
      }
    }

    // 2. Upload các file chương lên Cloudflare R2 (lưu trữ vô hạn)
    const r2Puts = chapters.map(c => {
      const encoded = btoa(unescape(encodeURIComponent(c.filename))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const r2_key = `${slug}/b64_${encoded}`;
      const body = c.content.startsWith('#') ? c.content : `# ${c.title}\n\n${c.content}`;
      return env.CHAPTERS.put(r2_key, body);
    });

    await Promise.all(r2Puts);

    // 3. Cập nhật catalog.json lên R2
    let catalog = [];
    if (!is_first_chunk) {
      try {
        const existingCat = await env.CHAPTERS.get(`${slug}/catalog.json`);
        if (existingCat) {
          catalog = await existingCat.json();
        }
      } catch {}
    }

    const newEntries = chapters.map(c => ({
      filename: c.filename,
      title: c.title,
      chapter_number: c.number || 0
    }));

    catalog.push(...newEntries);
    const cleanCatalog = sortAndDeduplicateCatalog(catalog);

    await env.CHAPTERS.put(`${slug}/catalog.json`, JSON.stringify(cleanCatalog));

    return jsonResponse({ success: true, slug, chapters_synced: chapters.length });
  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
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

  const body = await readJsonBody(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);

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

  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM novel_requests WHERE user_id = ? AND status = 'pending'`
  ).bind(user.id).first();
  if ((pending?.n || 0) >= MAX_PENDING_NOVEL_REQUESTS) {
    return jsonResponse({
      error: `Bạn đang có ${MAX_PENDING_NOVEL_REQUESTS} yêu cầu chờ duyệt. `
        + 'Vui lòng đợi admin xử lý trước khi gửi thêm.',
    }, 429);
  }

  const { meta } = await env.DB.prepare(
    `INSERT INTO novel_requests (user_id, url, note) VALUES (?, ?, ?)`
  ).bind(user.id, requestUrl, note).run();
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
  const body = await readJsonBody(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);

  const status = String(body.status || '');
  const adminNote = String(body.admin_note || '').trim();
  if (!NOVEL_REQUEST_STATUSES.has(status)) {
    return jsonResponse({ error: "status chỉ nhận 'approved' hoặc 'rejected'" }, 400);
  }
  if (adminNote.length > MAX_REQUEST_NOTE_LENGTH) {
    return jsonResponse({ error: `Ghi chú admin tối đa ${MAX_REQUEST_NOTE_LENGTH} ký tự` }, 400);
  }

  const { meta } = await env.DB.prepare(
    `UPDATE novel_requests SET status = ?, admin_note = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(status, adminNote, id).run();
  if (!meta.changes) return jsonResponse({ error: 'Không tìm thấy yêu cầu' }, 404);
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
