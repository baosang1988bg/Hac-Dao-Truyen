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
