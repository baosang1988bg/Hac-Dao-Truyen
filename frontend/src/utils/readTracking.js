/**
 * readTracking.js — Máy trạng thái THUẦN cho "lượt đọc thật" (học từ truyentrung):
 * một lượt chỉ được báo khi người đọc đã ở trang đủ lâu (chỉ tính lúc tab HIỂN
 * THỊ) VÀ đã cuộn tới gần hết nội dung chương. Không đụng DOM/mạng/storage —
 * hook useRealReadTracking lo phần đó, file này test được bằng node --test.
 */

export const DEFAULT_MIN_SECONDS = 30
export const DEFAULT_SCROLL_THRESHOLD = 0.8
// Server (Worker) có thể đổi min_seconds — chặn giá trị vô lý.
const MIN_SECONDS_FLOOR = 5
const MIN_SECONDS_CEIL = 600

/** Chuẩn hoá min_seconds từ server: số hữu hạn trong [5, 600], ngược lại mặc định 30. */
export function normalizeMinSeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_MIN_SECONDS
  return Math.min(MIN_SECONDS_CEIL, Math.max(MIN_SECONDS_FLOOR, Math.round(n)))
}

/**
 * Tỉ lệ nội dung chương đã "đi qua" mép dưới màn hình (0..1).
 * rectTop/rectHeight: getBoundingClientRect() của khối nội dung; viewportHeight:
 * window.innerHeight. Chương ngắn (vừa 1 màn hình) → 1 ngay từ đầu.
 */
export function contentScrollRatio(rectTop, rectHeight, viewportHeight) {
  if (!Number.isFinite(rectTop) || !Number.isFinite(rectHeight) || !Number.isFinite(viewportHeight)) return 0
  if (rectHeight <= 0) return 0
  const seen = viewportHeight - rectTop
  return Math.min(1, Math.max(0, seen / rectHeight))
}

/**
 * Tạo bộ đếm cho MỘT lượt mở chương.
 * - Chưa start() thì chưa tính giờ (hook chỉ start khi đã có token từ server,
 *   để token luôn "già" hơn min_seconds lúc báo — Worker từ chối token quá mới).
 * - setVisible(false) tạm dừng đồng hồ; setVisible(true) chạy tiếp.
 * - setScrollRatio giữ GIÁ TRỊ LỚN NHẤT từng thấy (cuộn lên lại không mất).
 * - shouldReport() true đúng khi đủ điều kiện và CHƯA markReported().
 *
 * opts: { minSeconds?, requireScroll? (mặc định true), scrollThreshold?, now? }
 */
export function createReadTracker(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const requireScroll = opts.requireScroll !== false
  const threshold = Number.isFinite(opts.scrollThreshold) ? opts.scrollThreshold : DEFAULT_SCROLL_THRESHOLD
  let minMs = normalizeMinSeconds(opts.minSeconds ?? DEFAULT_MIN_SECONDS) * 1000

  let started = false
  let visible = true
  let accumulated = 0 // ms đã tích luỹ (các đoạn hiển thị đã kết thúc)
  let visibleSince = 0 // mốc bắt đầu đoạn hiển thị hiện tại (khi đang chạy)
  let maxRatio = 0
  let reported = false

  const elapsedMs = (t = now()) => {
    if (!started) return 0
    return accumulated + (visible ? Math.max(0, t - visibleSince) : 0)
  }

  return {
    /** Bắt đầu tính giờ (gọi 1 lần). isVisible: trạng thái tab lúc bắt đầu. */
    start(isVisible = true, t = now()) {
      if (started) return
      started = true
      visible = Boolean(isVisible)
      visibleSince = t
    },
    setMinSeconds(value) {
      minMs = normalizeMinSeconds(value) * 1000
    },
    setVisible(isVisible, t = now()) {
      const next = Boolean(isVisible)
      if (!started) { visible = next; return }
      if (next === visible) return
      if (visible) accumulated += Math.max(0, t - visibleSince) // đang chạy → dừng
      else visibleSince = t // đang dừng → chạy tiếp
      visible = next
    },
    setScrollRatio(ratio) {
      if (Number.isFinite(ratio) && ratio > maxRatio) maxRatio = Math.min(1, ratio)
    },
    elapsedMs,
    get scrolledEnough() { return !requireScroll || maxRatio >= threshold },
    get reported() { return reported },
    get started() { return started },
    shouldReport(t = now()) {
      if (reported || !started) return false
      if (elapsedMs(t) < minMs) return false
      return !requireScroll || maxRatio >= threshold
    },
    markReported() { reported = true },
  }
}

/** Khoá chống trùng trong sessionStorage cho 1 chương ("slug:chapter"). */
export function readViewKey(slug, chapter) {
  return `realread_${slug}:${chapter == null ? '' : String(chapter)}`
}
