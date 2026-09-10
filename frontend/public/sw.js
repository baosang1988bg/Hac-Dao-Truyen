/* ═══════════════════════════════════════════════════════════════════════════
   Service worker thủ công cho HacDaoTruyen (không dùng Workbox).

   Chiến lược:
   - App shell (/, /index.html, điều hướng SPA) : network-first, fallback cache
   - /assets/*  (bundle có hash, bất biến)      : cache-first
   - GET /api/novels/:slug/chapters/:id (nội dung chương, bất biến sau dịch)
                                                : cache-first  → 'hacdao-chapters-v1'
   - GET /api/novels/:slug/epub (file EPUB)     : chỉ cache khi người dùng bấm
                                                  "Tải để đọc offline" (query
                                                  ?offline=1) hoặc đã tải trước
                                                  đó → 'hacdao-epub-v1', có giới
                                                  hạn dung lượng (EPUB_QUOTA_BYTES),
                                                  không tự động cache khi đọc
                                                  online bình thường.
   - GET /api/novels, /api/novels/:slug, /api/novels/:slug/chapters (cần tươi)
                                                : network-first, fallback cache
   - Các /api khác (auth, admin, POST...)       : KHÔNG can thiệp
   ═══════════════════════════════════════════════════════════════════════════ */

const STATIC_CACHE = 'hacdao-static-v1'
const CHAPTER_CACHE = 'hacdao-chapters-v1'
const API_CACHE = 'hacdao-api-v1'
const EPUB_CACHE = 'hacdao-epub-v1'
const KNOWN_CACHES = [STATIC_CACHE, CHAPTER_CACHE, API_CACHE, EPUB_CACHE]
const EPUB_QUOTA_BYTES = 200 * 1024 * 1024 // 200MB tổng cho toàn bộ EPUB đã tải offline
const EPUB_INDEX_KEY = '/__sw_epub_index__' // key nội bộ, không phải route thật

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !KNOWN_CACHES.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

/** Cache-first: trả cache nếu có, không thì fetch rồi cache lại. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) cache.put(request, response.clone())
  return response
}

/** Network-first: ưu tiên mạng (và cache lại), offline thì trả cache/fallback. */
async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl)
      if (fallback) return fallback
    }
    throw err
  }
}

/** Đọc bảng chỉ mục các EPUB đã tải offline: { [slug]: { size, updatedAt } }. */
async function readEpubIndex(cache) {
  const res = await cache.match(EPUB_INDEX_KEY)
  if (!res) return {}
  try {
    return await res.json()
  } catch {
    return {}
  }
}

async function writeEpubIndex(cache, index) {
  await cache.put(EPUB_INDEX_KEY, new Response(JSON.stringify(index)))
}

/** Xoá EPUB cũ nhất cho tới khi tổng dung lượng nằm dưới hạn mức. */
async function enforceEpubQuota(cache, index) {
  let total = Object.values(index).reduce((sum, e) => sum + (e.size || 0), 0)
  const bySlugOldest = Object.entries(index).sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  for (const [slug, entry] of bySlugOldest) {
    if (total <= EPUB_QUOTA_BYTES) break
    await cache.delete(epubRequestFor(slug))
    delete index[slug]
    total -= entry.size || 0
  }
  return index
}

function epubRequestFor(slug) {
  return new Request(`${self.location.origin}/api/novels/${slug}/epub`)
}

/** Tải (nếu cần) và lưu EPUB vào cache, cập nhật chỉ mục + giới hạn dung lượng. */
async function downloadEpub(request, slug) {
  const cache = await caches.open(EPUB_CACHE)
  const response = await fetch(request)
  if (!response || !response.ok) return response
  const clone = response.clone()
  const size = Number(clone.headers.get('content-length')) || (await clone.blob()).size
  await cache.put(epubRequestFor(slug), response.clone())
  const index = await readEpubIndex(cache)
  index[slug] = { size, updatedAt: Date.now() }
  await writeEpubIndex(cache, await enforceEpubQuota(cache, index))
  return response
}

/** Đọc EPUB đã tải offline; chỉ tải mới nếu người dùng chủ động bấm tải. */
async function handleEpub(request, slug, isExplicitDownload) {
  const cache = await caches.open(EPUB_CACHE)
  const cached = await cache.match(epubRequestFor(slug))
  if (cached && !isExplicitDownload) return cached
  if (isExplicitDownload) return downloadEpub(request, slug)
  // Không có trong cache và không phải yêu cầu tải offline → để mạng xử lý bình thường.
  return fetch(request)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Nội dung chương: cache-first (đã dịch xong thì không đổi) → đọc offline
  if (/^\/api\/novels\/[^/]+\/chapters\/.+/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, CHAPTER_CACHE))
    return
  }

  // EPUB: chỉ cache khi đã tải offline trước đó hoặc đang được tải chủ động
  // (?offline=1 do nút "Tải để đọc offline" gắn vào) — đọc bình thường không cache.
  const epubMatch = url.pathname.match(/^\/api\/novels\/([^/]+)\/epub$/)
  if (epubMatch) {
    event.respondWith(handleEpub(request, epubMatch[1], url.searchParams.get('offline') === '1'))
    return
  }

  // Danh sách truyện / chi tiết truyện / mục lục chương: cần dữ liệu tươi
  if (
    url.pathname === '/api/novels' ||
    /^\/api\/novels\/[^/]+(\/chapters)?$/.test(url.pathname)
  ) {
    event.respondWith(networkFirst(request, API_CACHE))
    return
  }

  // Các API khác (auth, admin, stats...): để trình duyệt tự xử lý
  if (url.pathname.startsWith('/api/')) return

  // Bundle build có hash trong tên file: an toàn để cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Điều hướng SPA + index.html: network-first, offline rơi về shell đã cache
  if (request.mode === 'navigate' || url.pathname === '/index.html') {
    event.respondWith(networkFirst(request, STATIC_CACHE, '/index.html'))
    return
  }

  // Còn lại (icon, manifest, favicon...): cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE))
})
