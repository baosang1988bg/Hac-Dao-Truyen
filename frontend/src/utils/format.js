// ── Định dạng chung (thời gian, số) ──────────────────────────────────────────

/** "vừa xong" / "X phút trước" / "X giờ trước" / "X ngày trước" từ epoch giây. */
export function fmtTimeAgo(epoch) {
  if (!epoch) return ''
  const diff = Math.floor(Date.now() / 1000) - epoch
  if (diff < 60) return 'vừa xong'
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`
  return `${Math.floor(diff / 86400)} ngày trước`
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

