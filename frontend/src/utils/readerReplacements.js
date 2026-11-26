/**
 * readerReplacements.js — Quản lý quy tắc sửa text/glossary trực tiếp khi đọc truyện.
 * Lưu trữ theo novel slug trong localStorage (hoạt động offline, tức thì).
 */

const STORAGE_KEY_PREFIX = 'reader_replacements_'

/**
 * Lấy danh sách quy tắc thay thế cho truyện theo slug.
 * @param {string} slug
 * @returns {Array<{ id: string, from: string, to: string, createdAt: number }>}
 */
export function getReplacements(slug) {
  if (!slug) return []
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${slug}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Thêm hoặc cập nhật một quy tắc thay thế cho truyện.
 * @param {string} slug
 * @param {{ from: string, to: string }} rule
 * @returns {Array<{ id: string, from: string, to: string, createdAt: number }>} Danh sách mới nhất
 */
export function saveReplacement(slug, { from, to }) {
  if (!slug || !from || typeof from !== 'string' || typeof to !== 'string') return getReplacements(slug)
  const cleanFrom = from.trim()
  const cleanTo = to.trim()
  if (!cleanFrom) return getReplacements(slug)

  const current = getReplacements(slug)
  const existingIndex = current.findIndex(r => r.from.toLowerCase() === cleanFrom.toLowerCase())

  let updated
  if (existingIndex >= 0) {
    updated = [...current]
    updated[existingIndex] = {
      ...updated[existingIndex],
      from: cleanFrom,
      to: cleanTo,
      updatedAt: Date.now(),
    }
  } else {
    updated = [
      ...current,
      {
        id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        from: cleanFrom,
        to: cleanTo,
        createdAt: Date.now(),
      },
    ]
  }

  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${slug}`, JSON.stringify(updated))
  } catch {
    /* quota storage đầy hoặc bị chặn */
  }

  return updated
}

/**
 * Xóa một quy tắc thay thế theo ID.
 * @param {string} slug
 * @param {string} id
 * @returns {Array<{ id: string, from: string, to: string, createdAt: number }>}
 */
export function removeReplacement(slug, id) {
  if (!slug || !id) return getReplacements(slug)
  const current = getReplacements(slug)
  const updated = current.filter(r => r.id !== id)
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${slug}`, JSON.stringify(updated))
  } catch {
    /* storage bị chặn */
  }
  return updated
}

/**
 * Áp dụng danh sách quy tắc thay thế lên văn bản.
 * An toàn không bị regex injection (dùng split/join).
 * @param {string} text
 * @param {Array<{ from: string, to: string }>} replacements
 * @returns {string}
 */
export function applyReplacements(text, replacements) {
  if (!text || typeof text !== 'string' || !Array.isArray(replacements) || replacements.length === 0) {
    return text
  }

  let result = text
  for (const rule of replacements) {
    if (rule && rule.from && typeof rule.to === 'string') {
      result = result.split(rule.from).join(rule.to)
    }
  }
  return result
}

/** Khoá localStorage của quy tắc cá nhân — dùng chung cho đồng bộ cài đặt. */
export const REPLACEMENTS_STORAGE_PREFIX = STORAGE_KEY_PREFIX

/**
 * Ghi đè toàn bộ danh sách quy tắc của 1 truyện (đồng bộ từ server gọi).
 * Danh sách rỗng → xoá khoá cho gọn storage.
 */
export function writeReplacements(slug, list) {
  if (!slug || !Array.isArray(list)) return
  try {
    if (list.length === 0) localStorage.removeItem(`${STORAGE_KEY_PREFIX}${slug}`)
    else localStorage.setItem(`${STORAGE_KEY_PREFIX}${slug}`, JSON.stringify(list))
  } catch {
    /* storage đầy/bị chặn */
  }
}

/** Các slug đang có quy tắc cá nhân trong localStorage. */
export function listReplacementSlugs() {
  const out = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(STORAGE_KEY_PREFIX)) out.push(k.slice(STORAGE_KEY_PREFIX.length))
    }
  } catch {
    /* storage bị chặn */
  }
  return out
}

/**
 * Gộp quy tắc công khai (admin đã duyệt) với quy tắc cá nhân thành 1 danh sách
 * để applyReplacements áp theo thứ tự: CÔNG KHAI TRƯỚC, CÁ NHÂN SAU. Trùng
 * `from` (không phân biệt hoa thường, giống saveReplacement) → bỏ bản công khai,
 * cá nhân thắng. Quy tắc hỏng (from rỗng / to không phải chuỗi) bị loại.
 * @param {Array<{from:string,to:string}>} publicRules
 * @param {Array<{from:string,to:string}>} personalRules
 * @returns {Array<{from:string,to:string}>}
 */
export function mergeReplacementRules(publicRules, personalRules) {
  const valid = (r) => r && typeof r.from === 'string' && r.from.trim() !== '' && typeof r.to === 'string'
  const personal = Array.isArray(personalRules) ? personalRules.filter(valid) : []
  const personalKeys = new Set(personal.map(r => r.from.trim().toLowerCase()))
  const seenPublic = new Set()
  const pub = []
  for (const r of Array.isArray(publicRules) ? publicRules : []) {
    if (!valid(r)) continue
    const key = r.from.trim().toLowerCase()
    if (personalKeys.has(key) || seenPublic.has(key)) continue
    seenPublic.add(key)
    pub.push({ from: r.from, to: r.to })
  }
  return [...pub, ...personal]
}
