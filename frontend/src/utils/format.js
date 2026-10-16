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

/** "bat-dau-dung-hop" → "Bat Dau Dung Hop" (chỉ dùng khi không còn gì tốt hơn). */
function titleCaseSlug(s) {
  return str(s).trim().replace(/-+/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Tiêu đề "trông như slug": không có khoảng trắng, có gạch nối, chỉ a-z/0-9.
function looksLikeSlug(t) {
  return /^[a-z0-9]+(?:-+[a-z0-9]+)+$/i.test(t)
}

/**
 * Tên truyện để hiển thị.
 * - Tiêu đề hợp lệ → giữ nguyên (chỉ trim).
 * - Tiêu đề trống / trùng slug / trông như slug ("bat-dau-dung-hop") →
 *   ưu tiên `originalTitle` (tên gốc, thường là tiếng Trung) nếu có chữ cái,
 *   nếu không thì title-case từ slug ("Bat Dau Dung Hop").
 */
export function fmtNovelTitle(title, slug, originalTitle) {
  const t = str(title).trim()
  const s = str(slug).trim()
  const isSlugLike = !t || (s && t === s) || looksLikeSlug(t)
  if (!isSlugLike) return t
  const orig = str(originalTitle).trim()
  if (orig && /\p{L}/u.test(orig) && !looksLikeSlug(orig)) return orig
  return titleCaseSlug(t || s)
}

/** Tiện ích: tên hiển thị của 1 object truyện (title/slug/original_title). */
export function novelDisplayTitle(novel) {
  return fmtNovelTitle(novel?.title, novel?.slug, novel?.original_title)
}

// Giá trị tác giả "giả" do crawler/nguồn điền khi không biết tác giả thật.
const PLACEHOLDER_AUTHORS = new Set(['', 'unknown', 'n/a', 'na', 'none', 'null', '-', '—', 'tác giả', 'đang cập nhật', 'chưa rõ', 'không rõ', '未知', '佚名'])

/** Tên tác giả thật, hoặc '' nếu trống/placeholder (nơi gọi tự ẩn hoặc ghi "Chưa rõ"). */
export function cleanAuthor(author) {
  const a = str(author).replace(/\s+/g, ' ').trim()
  if (PLACEHOLDER_AUTHORS.has(a.toLowerCase())) return ''
  return a
}

// ── Nhãn chỉ số của BXH nguồn Trung Quốc (/api/rankings → item.stat_label) ──
// Ví dụ dữ liệu thô: "月点击：462859", "月票 1234", "总字数：356.2万字".
// Khoá dài đứng trước để "总推荐" không bị khớp nhầm thành "推荐".
const STAT_LABELS_ZH = [
  ['月点击', 'Lượt click tháng'],
  ['周点击', 'Lượt click tuần'],
  ['日点击', 'Lượt click ngày'],
  ['总点击', 'Tổng click'],
  ['点击', 'Lượt click'],
  ['月推荐票', 'Phiếu đề cử tháng'],
  ['周推荐票', 'Phiếu đề cử tuần'],
  ['推荐票', 'Phiếu đề cử'],
  ['月推荐', 'Đề cử tháng'],
  ['周推荐', 'Đề cử tuần'],
  ['总推荐', 'Tổng đề cử'],
  ['推荐', 'Đề cử'],
  ['月票', 'Phiếu tháng'],
  ['总收藏', 'Tổng lượt lưu'],
  ['收藏', 'Lượt lưu'],
  ['总字数', 'Tổng số chữ'],
  ['字数', 'Số chữ'],
  ['畅销', 'Bán chạy'],
  ['人气', 'Độ nổi tiếng'],
  ['热度', 'Độ hot'],
  ['在读', 'Đang đọc'],
  ['阅读', 'Lượt đọc'],
  ['订阅', 'Lượt đặt mua'],
  ['打赏', 'Lượt thưởng'],
  ['粉丝', 'Người hâm mộ'],
  ['评分', 'Điểm đánh giá'],
  ['评论', 'Bình luận'],
].sort((a, b) => b[0].length - a[0].length)

const ZH_UNITS = { '万': 1e4, '萬': 1e4, '亿': 1e8, '億': 1e8 }

/**
 * "462859" / "46.2万" / "1,234" → số nguyên (hoặc null nếu không phải số).
 * Trả kèm phần chữ còn thừa phía sau để nơi gọi quyết định giữ hay bỏ.
 */
export function parseZhNumber(text) {
  const m = /^\s*([\d][\d,.]*)\s*([万萬亿億])?/.exec(str(text))
  if (!m) return null
  const digits = m[1].replace(/,/g, '')
  const base = Number(digits)
  if (!Number.isFinite(base)) return null
  const value = Math.round(base * (m[2] ? ZH_UNITS[m[2]] : 1))
  return { value, rest: str(text).slice(m[0].length).trim() }
}

/**
 * Dịch nhãn chỉ số BXH tiếng Trung sang tiếng Việt + định dạng số vi-VN.
 *   "月点击：462859"   → "Lượt click tháng: 462.859"
 *   "总字数：356.2万字" → "Tổng số chữ: 3.562.000"
 * Nhãn không nhận ra → trả nguyên văn (không đoán bừa).
 */
export function fmtStatLabel(label) {
  const raw = str(label).trim()
  if (!raw) return ''
  const hit = STAT_LABELS_ZH.find(([zh]) => raw.startsWith(zh))
  if (!hit) {
    // Chỉ có số trơn → vẫn định dạng cho dễ đọc.
    const onlyNum = parseZhNumber(raw)
    if (onlyNum && !onlyNum.rest) return fmtNumber(onlyNum.value)
    return raw
  }
  const [zh, vi] = hit
  const rest = raw.slice(zh.length).replace(/^[\s:：=]+/, '')
  if (!rest) return vi
  const num = parseZhNumber(rest)
  if (!num) return `${vi}: ${rest}`
  // Bỏ đơn vị đếm tiếng Trung đứng sau số (字/票/人/次/本) — nhãn Việt đã đủ nghĩa.
  const tail = /^[字票人次本个個]*$/.test(num.rest) ? '' : ` ${num.rest}`
  return `${vi}: ${fmtNumber(num.value)}${tail}`
}

function str(val) {
  return val == null ? '' : String(val)
}
