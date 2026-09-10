// Tiện ích kiểm tra/tải EPUB để đọc offline — dùng chung ở EpubCard, EpubCatalogPage,
// EpubReader. Việc cache thật sự do service worker (frontend/public/sw.js) đảm nhiệm
// khi thấy query `?offline=1`; các hàm ở đây chỉ gọi đúng request đó và đọc lại
// Cache Storage để biết trạng thái, không tự implement logic cache ở đây.

const EPUB_CACHE = 'hacdao-epub-v1'

function epubRequestFor(slug) {
  return new Request(`${window.location.origin}/api/novels/${slug}/epub`)
}

/** true nếu EPUB của slug này đã có trong cache offline. */
export async function isEpubDownloaded(slug) {
  if (!('caches' in window)) return false
  try {
    const cache = await caches.open(EPUB_CACHE)
    return Boolean(await cache.match(epubRequestFor(slug)))
  } catch {
    return false
  }
}

/** Yêu cầu service worker tải và lưu EPUB vào cache offline. */
export async function downloadEpubOffline(slug) {
  const res = await fetch(`/api/novels/${slug}/epub?offline=1`)
  if (!res.ok) throw new Error(`Không tải được EPUB (${res.status})`)
  return res
}
