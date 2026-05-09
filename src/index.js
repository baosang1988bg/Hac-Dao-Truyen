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
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url).toString(), request));
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
    return getNovel(env, novelMatch[1]);
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
  const { results } = await env.DB.prepare(`
    SELECT slug, title, author, genre, source_url,
           last_chapter_number, total_chapters, notes,
           cover_url, status, updated_at
    FROM novels
    ORDER BY updated_at DESC
  `).all();
  // Parse glossary JSON nếu cần
  return jsonResponse(results);
}

async function getNovel(env, slug) {
  const novel = await env.DB.prepare(`
    SELECT * FROM novels WHERE slug = ?
  `).bind(slug).first();

  if (!novel) return jsonResponse({ error: 'Novel not found' }, 404);

  // Parse glossary từ JSON string
  try { novel.glossary = JSON.parse(novel.glossary || '{}'); } catch { novel.glossary = {}; }

  return jsonResponse(novel);
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

  await env.DB.prepare(`
    UPDATE novels SET glossary = ?, updated_at = ? WHERE slug = ?
  `).bind(JSON.stringify(glossary), new Date().toISOString(), slug).run();

  return jsonResponse({ status: 'success', message: 'Glossary updated' });
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
