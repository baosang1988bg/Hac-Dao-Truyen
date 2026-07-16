/* ═══════════════════════════════════════════════════════════════════════════
   Service worker thủ công cho HacDaoTruyen (không dùng Workbox).

   Chiến lược:
   - App shell (/, /index.html, điều hướng SPA) : network-first, fallback cache
   - /assets/*  (bundle có hash, bất biến)      : cache-first
   - GET /api/novels/:slug/chapters/:id (nội dung chương, bất biến sau dịch)
                                                : cache-first  → 'hacdao-chapters-v1'
   - GET /api/novels, /api/novels/:slug, /api/novels/:slug/chapters (cần tươi)
                                                : network-first, fallback cache
   - Các /api khác (auth, admin, POST...)       : KHÔNG can thiệp
   ═══════════════════════════════════════════════════════════════════════════ */

const STATIC_CACHE = 'hacdao-static-v1'
const CHAPTER_CACHE = 'hacdao-chapters-v1'
const API_CACHE = 'hacdao-api-v1'
const KNOWN_CACHES = [STATIC_CACHE, CHAPTER_CACHE, API_CACHE]

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
