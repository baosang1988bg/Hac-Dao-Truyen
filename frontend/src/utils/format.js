// ── Định dạng chung (thời gian, số) ──────────────────────────────────────────

/**
 * "vừa xong" / "X phút trước" / "X giờ trước" / "X ngày trước".
 * Chấp nhận epoch giây, epoch mili-giây hoặc chuỗi ngày SQL/ISO từ API.
 */
function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  let timestampMs
  if (typeof value === 'number') {
    timestampMs = Math.abs(value) < 1e12 ? value * 1000 : value
  } else if (typeof value === 'string') {
    const input = value.trim()
    if (!input) return null
    if (/^-?\d+(?:\.\d+)?$/.test(input)) {
      const numeric = Number(input)
      timestampMs = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric
    } else {
      let normalized = input.includes('T') ? input : input.replace(' ', 'T')
      if (/^\d{4}-\d{2}-\d{2}T/.test(normalized) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
        normalized += 'Z'
      }
      timestampMs = Date.parse(normalized)
    }
  } else if (value instanceof Date) {
    timestampMs = value.getTime()
  }
  return Number.isFinite(timestampMs) ? timestampMs : null
}

/**
 * "vừa xong" / "X phút trước" / "X giờ trước" / "X ngày trước".
 * Chấp nhận epoch giây, epoch mili-giây hoặc chuỗi ngày SQL/ISO từ API.
 */
export function fmtTimeAgo(value, nowMs = Date.now()) {
  const timestampMs = parseTimestamp(value)
  if (timestampMs === null || !Number.isFinite(nowMs)) return ''
  const diff = Math.max(0, Math.floor((nowMs - timestampMs) / 1000))
  if (diff < 60) return 'vừa xong'
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`
  return `${Math.floor(diff / 86400)} ngày trước`
}

/**
 * Định dạng ngày dịch của chương:
 * - Dưới 7 ngày: hiển thị dạng tương đối (vd "vừa xong", "2 giờ trước", "3 ngày trước")
 * - Từ 7 ngày trở lên: hiển thị ngày chuẩn "DD/MM/YYYY" (hoặc UTC tương đương)
 */
export function fmtChapterDate(value, nowMs = Date.now()) {
  const timestampMs = parseTimestamp(value)
  if (timestampMs === null || !Number.isFinite(nowMs)) return ''
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000))
  if (diffSec < 7 * 86400) {
    return fmtTimeAgo(timestampMs, nowMs)
  }
  const d = new Date(timestampMs)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

/**
 * Kiểm tra chương có phải mới ra gần đây hay không (mặc định trong vòng 72 giờ).
 */
export function isRecentChapter(value, maxHours = 72, nowMs = Date.now()) {
  const timestampMs = parseTimestamp(value)
  if (timestampMs === null || !Number.isFinite(nowMs)) return false
  const diffHours = (nowMs - timestampMs) / (1000 * 3600)
  return diffHours >= 0 && diffHours <= maxHours
}

/** Số có dấu phân cách nghìn (kiểu Việt Nam). */
export function fmtNumber(n) {
  return (n || 0).toLocaleString('vi-VN')
}

/** Thời lượng giây → "45s" / "3m 20s" / "1h 5m" (chuyển từ Logs.jsx). */
export function fmtDuration(sec) {
  if (!sec || sec < 1) return '—'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60), s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60), rm = m % 60
  return `${h}h ${rm}m`
}

/** Chuỗi ISO → "YYYY-MM-DD HH:mm" (chuyển từ Logs.jsx). */
export function fmtDate(str) {
  if (!str) return '—'
  return str.replace('T', ' ').slice(0, 16)
}

/** Số token → "1.2M" / "34.5K" (chuyển từ Logs.jsx). */
export function fmtTokens(n) {
  if (!n || n === 0) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

/** Chuẩn hóa tiêu đề truyện nếu là slug chưa format (ví dụ bat-dau-dung-hop -> Bắt Đầu Dùng Hợp / Bat Dau...). */
export function fmtNovelTitle(title, slug) {
  if (!title && slug) {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
  if (!title) return ''
  const t = str(title).trim()
  if (t.includes('-') && !t.includes(' ')) {
    return t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
  if (slug && t === slug) {
    return t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
  return t
}

function str(val) {
  return val == null ? '' : String(val)
}
