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

/**
 * C07: nội dung chương là "bất biến sau khi dịch" NHƯNG có thể được dịch lại
 * để sửa lỗi — cache-first thuần theo URL sẽ không bao giờ thấy bản sửa vì
 * URL (số chương) không đổi. Trả cache ngay (không chặn UI), đồng thời âm
 * thầm fetch mạng ở nền: nếu `version` (hash nội dung, xem chapterResponse()
 * trong src/index.js) khác bản cache, ghi đè cache bằng bản mới — LẦN ĐỌC SAU
 * sẽ thấy bản đã sửa. Không throw khi cache.put lỗi (vd quota) — best-effort,
 * không được làm hỏng response đã trả cho request hiện tại.
 */
async function cacheFirstVersioned(event, cacheName) {
  const { request } = event
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const revalidate = async () => {
    try {
      const fresh = await fetch(request)
      if (!fresh || !fresh.ok) return
      if (cached) {
        const [cachedJson, freshJson] = await Promise.all([cached.clone().json(), fresh.clone().json()])
        if (cachedJson.version && freshJson.version && cachedJson.version === freshJson.version) return
      }
      await cache.put(request, fresh.clone())
    } catch { /* best-effort, không ảnh hưởng response đã trả về */ }
  }

  if (cached) {
    // event.waitUntil giữ service worker sống đủ để hoàn tất revalidate nền,
    // không chặn phản hồi cache đã trả về ngay cho request hiện tại.
    event.waitUntil(revalidate())
    return cached
  }
  const response = await fetch(request)
  if (response && response.ok) {
    try { await cache.put(request, response.clone()) } catch { /* quota đầy... — vẫn trả response cho user */ }
  }
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

// C07: readEpubIndex → sửa → writeEpubIndex là read-modify-write; 2 lượt tải
// EPUB đồng thời (2 tab, hoặc double-tap nút tải) có thể xen kẽ giữa các
// bước, làm 1 bên ghi đè mất entry của bên kia trong index (blob EPUB vẫn còn
// trong cache nhưng index không biết → không tính vào quota, không xóa được
// khi cần enforceEpubQuota). Chuỗi promise nội bộ này serialize MỌI lượt
// cập nhật index (bất kể slug nào) thành hàng đợi tuần tự trong 1 instance
// service worker — đủ để chặn race trong cùng 1 tab/worker instance.
let _epubIndexQueue = Promise.resolve()
function withEpubIndexLock(fn) {
  const result = _epubIndexQueue.then(fn, fn)
  // Nuốt lỗi ở đây để 1 lần thất bại không làm hỏng toàn bộ hàng đợi sau đó;
  // lỗi thật vẫn được ném lại cho caller qua `result`.
  _epubIndexQueue = result.catch(() => {})
  return result
}

/** Tải (nếu cần) và lưu EPUB vào cache, cập nhật chỉ mục + giới hạn dung lượng. */
async function downloadEpub(request, slug) {
  const cache = await caches.open(EPUB_CACHE)
  const response = await fetch(request)
  if (!response || !response.ok) return response
  const clone = response.clone()
  const size = Number(clone.headers.get('content-length')) || (await clone.blob()).size

  // Cache thất bại (vd quota đầy) ném lỗi thẳng ra ngoài — KHÔNG cập nhật
  // index (sẽ trỏ tới blob không tồn tại), không được coi là "đã tải xong".
  await cache.put(epubRequestFor(slug), response.clone())

  try {
    await withEpubIndexLock(async () => {
      const index = await readEpubIndex(cache)
      index[slug] = { size, updatedAt: Date.now() }
      await writeEpubIndex(cache, await enforceEpubQuota(cache, index))
    })
  } catch {
    // Index ghi thất bại sau khi blob đã cache — rollback để không để lại
    // blob "mồ côi" (chiếm dung lượng nhưng không được index/quota theo dõi).
    await cache.delete(epubRequestFor(slug)).catch(() => {})
    throw new Error('Không thể cập nhật chỉ mục EPUB offline, đã hủy bản tải')
  }

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

  // Nội dung chương: cache-first để đọc offline, NHƯNG chương có thể được
  // dịch lại để sửa lỗi sau đó (URL/số chương không đổi) — dùng bản có
  // revalidate nền theo version (hash nội dung) thay vì cache-first thuần.
  if (/^\/api\/novels\/[^/]+\/chapters\/.+/.test(url.pathname)) {
    event.respondWith(cacheFirstVersioned(event, CHAPTER_CACHE))
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
