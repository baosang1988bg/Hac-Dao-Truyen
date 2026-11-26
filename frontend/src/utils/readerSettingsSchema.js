/**
 * readerSettingsSchema.js — Giá trị mặc định + kiểm tra hợp lệ cài đặt đọc.
 * Tách khỏi hooks/useReaderSettings.js (không import React) để dùng chung với
 * utils/userPrefsSync.js và test bằng node --test.
 */

export const DEFAULT_SETTINGS = {
  fontSize: 21,
  fontFamily: 'Times New Roman, serif',
  theme: 'sepia',
  contentWidth: 800,
  lineHeight: 1.7,
  ttsVoice: '',
  ttsRate: 1,
}

// Font đọc web (Google Fonts, có dấu tiếng Việt) — [giá trị CSS, nhãn hiển thị].
// Settings cũ lưu font hệ thống (vd 'Times New Roman, serif') vẫn giữ nguyên.
export const READER_FONTS = [
  ["'Literata', 'Noto Serif', Georgia, serif", 'Literata (đọc sách)'],
  ["'Noto Serif', Georgia, serif", 'Noto Serif'],
]

// Danh sách duy nhất; màu lấy từ .reader--<id> trong index.css.
export const THEMES = {
  white: 'Trắng',
  sepia: 'Giấy',
  green: 'Xanh lá',
  dark: 'Tối',
  blue: 'Xanh lam',
}

// C06: dữ liệu localStorage có thể hỏng/lạ (field không mong đợi, kiểu sai,
// giá trị từ phiên bản cũ/mới hơn) — validate từng field, KHÔNG spread thẳng
// object đọc được (tránh crash hoặc field rác lọt vào state khi giá trị lưu
// không phải object thuần, ví dụ chuỗi/số/null/array).
export function sanitizeSettings(saved) {
  const out = { ...DEFAULT_SETTINGS }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out
  if (Number.isFinite(saved.fontSize) && saved.fontSize >= 10 && saved.fontSize <= 60) {
    out.fontSize = saved.fontSize
  }
  if (typeof saved.fontFamily === 'string' && saved.fontFamily.trim()) {
    out.fontFamily = saved.fontFamily
  }
  if (typeof saved.theme === 'string' && Object.prototype.hasOwnProperty.call(THEMES, saved.theme)) {
    out.theme = saved.theme
  }
  if (Number.isFinite(saved.contentWidth) && saved.contentWidth >= 300 && saved.contentWidth <= 2000) {
    out.contentWidth = saved.contentWidth
  }
  if (Number.isFinite(saved.lineHeight) && saved.lineHeight >= 1 && saved.lineHeight <= 3) {
    out.lineHeight = saved.lineHeight
  }
  if (typeof saved.ttsVoice === 'string') out.ttsVoice = saved.ttsVoice
  if (Number.isFinite(saved.ttsRate) && saved.ttsRate >= 0.5 && saved.ttsRate <= 3) {
    out.ttsRate = saved.ttsRate
  }
  return out
}
