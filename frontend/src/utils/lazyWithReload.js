/**
 * Bọc `import()` của trang lazy để sống sót qua lần deploy mới.
 *
 * Sau mỗi deploy, tên chunk đổi hash → tab đang mở (index.html cũ) gọi
 * `import('./pages/NovelPage-<hash cũ>.js')` sẽ 404 → React.lazy reject →
 * trang trắng. Khi nhận diện đúng lỗi tải chunk, tải lại trang ĐÚNG 1 lần
 * (đánh dấu trong sessionStorage) để lấy index.html + chunk mới. Nếu sau khi
 * reload vẫn lỗi (mạng hỏng thật) thì ném tiếp cho AppErrorBoundary hiển thị.
 */
import { lazy } from 'react'

export const CHUNK_RELOAD_KEY = 'hd:chunk-reload'

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chrome / Edge
  /Importing a module script failed/i, // Safari
  /error loading dynamically imported module/i, // Firefox
  /Loading (CSS )?chunk [\w-]+ failed/i, // webpack-style ChunkLoadError
  /Unable to preload CSS/i, // Vite preload CSS
]

/** Hàm thuần: lỗi có phải do không tải được chunk JS/CSS động không? */
export function isChunkLoadError(error) {
  if (!error) return false
  const name = typeof error === 'object' ? String(error.name || '') : ''
  if (name === 'ChunkLoadError') return true
  const message = typeof error === 'string' ? error : String(error.message || '')
  return CHUNK_ERROR_PATTERNS.some(re => re.test(message))
}

function storage() {
  try {
    return globalThis.sessionStorage || null
  } catch {
    return null
  }
}

function hasReloaded() {
  try {
    return storage()?.getItem(CHUNK_RELOAD_KEY) === '1'
  } catch {
    return false
  }
}

function markReloaded() {
  try {
    storage()?.setItem(CHUNK_RELOAD_KEY, '1')
    return true
  } catch {
    // Không ghi được dấu (private mode chặn storage) → KHÔNG reload, tránh vòng lặp vô hạn.
    return false
  }
}

function clearReloadMark() {
  try {
    storage()?.removeItem(CHUNK_RELOAD_KEY)
  } catch { /* bỏ qua */ }
}

/**
 * Trả về factory mới: thành công → xoá dấu reload; lỗi chunk lần đầu → reload
 * trang và trả promise không bao giờ resolve (tránh nháy ErrorBoundary trước
 * khi trang tải lại); lỗi khác hoặc đã reload rồi → ném tiếp.
 */
export function withChunkReload(factory, { reload = () => globalThis.location?.reload() } = {}) {
  return () =>
    factory().then(
      mod => {
        clearReloadMark()
        return mod
      },
      error => {
        if (isChunkLoadError(error) && !hasReloaded() && markReloaded()) {
          reload()
          return new Promise(() => {})
        }
        throw error
      },
    )
}

/**
 * React.lazy + tự reload 1 lần khi chunk cũ 404. Trả kèm `.preload()` để
 * prefetch dùng chung factory: prefetch nền KHÔNG tự reload (người dùng đang
 * xem trang khác, offline cũng ra lỗi tương tự) — lỗi bị nuốt, lần render
 * thật sẽ đi qua nhánh reload ở trên.
 */
export function lazyWithReload(factory) {
  const Component = lazy(withChunkReload(factory))
  // Không xoá dấu reload ở đây: prefetch NovelPage thành công không chứng minh
  // chunk của trang đang lỗi đã tải được → tránh vòng lặp reload vô hạn.
  Component.preload = () => factory().catch(() => undefined)
  return Component
}
