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
 * `whole` (khớp nguyên từ): quy tắc MỚI mặc định true; cập nhật quy tắc cũ mà
 * không truyền `whole` → giữ cờ hiện có (quy tắc cũ không cờ = khớp chuỗi con).
 * @param {string} slug
 * @param {{ from: string, to: string, whole?: boolean }} rule
 * @returns {Array<{ id: string, from: string, to: string, whole?: boolean, createdAt: number }>} Danh sách mới nhất
 */
export function saveReplacement(slug, { from, to, whole }) {
  if (!slug || !from || typeof from !== 'string' || typeof to !== 'string') return getReplacements(slug)
  const cleanFrom = from.trim()
  const cleanTo = to.trim()
  if (!cleanFrom) return getReplacements(slug)

  const current = getReplacements(slug)
  const existingIndex = current.findIndex(r => r.from.toLowerCase() === cleanFrom.toLowerCase())

  let updated
  if (existingIndex >= 0) {
    updated = [...current]
    const next = {
      ...updated[existingIndex],
      from: cleanFrom,
      to: cleanTo,
      updatedAt: Date.now(),
    }
    if (typeof whole === 'boolean') next.whole = whole
    updated[existingIndex] = next
  } else {
    updated = [
      ...current,
      {
        id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        from: cleanFrom,
        to: cleanTo,
        whole: whole !== false,
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

// ── Khớp nguyên từ ───────────────────────────────────────────────────────────
// "Chữ" = chữ cái/số Unicode + dấu kết hợp (\p{M}: văn bản tiếng Việt dạng NFD
// tách dấu thành ký tự riêng — thiếu \p{M} thì "Lâm" dạng NFD bị coi là hết từ
// ngay trước dấu mũ).
const WORD_CHAR_RE = /[\p{L}\p{N}\p{M}]/u
// Ký tự cú pháp regex (chế độ `u` CHỈ cho escape đúng nhóm này — escape thêm
// ký tự khác như `-` sẽ ném SyntaxError).
const REGEX_SYNTAX_RE = /[\\^$.*+?()[\]{}|/]/g
// Cache regex theo `from` → mỗi quy tắc chỉ tạo regex 1 lần cho mọi lần áp
// (đổi chương, render lại). Giới hạn kích thước để không phình bộ nhớ.
const WHOLE_RE_CACHE = new Map()
const WHOLE_RE_CACHE_MAX = 3000

/** Escape chuỗi người dùng thành literal regex an toàn (không bao giờ dựng regex từ chuỗi thô). */
export function escapeRegExp(str) {
  return String(str).replace(REGEX_SYNTAX_RE, '\\$&')
}

function wholeWordRegex(from) {
  let re = WHOLE_RE_CACHE.get(from)
  if (!re) {
    if (WHOLE_RE_CACHE.size >= WHOLE_RE_CACHE_MAX) WHOLE_RE_CACHE.clear()
    re = new RegExp(escapeRegExp(from), 'gu')
    WHOLE_RE_CACHE.set(from, re)
  }
  re.lastIndex = 0
  return re
}

/** Code point ngay TRƯỚC vị trí i (xử lý cặp surrogate), '' nếu đầu chuỗi. */
function charBefore(str, i) {
  if (i <= 0) return ''
  const lo = str.charCodeAt(i - 1)
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = str.charCodeAt(i - 2)
    if (hi >= 0xd800 && hi <= 0xdbff) return str.slice(i - 2, i)
  }
  return str[i - 1]
}

/** Code point bắt đầu tại vị trí i, '' nếu hết chuỗi. */
function charAtCp(str, i) {
  if (i >= str.length) return ''
  return String.fromCodePoint(str.codePointAt(i))
}

/**
 * Thay `from` → `to` chỉ ở chỗ hai bên KHÔNG phải chữ/số Unicode.
 * Giống `\b`: chỉ xét biên ở phía mà ký tự mép của `from` là chữ — cụm kết
 * thúc bằng dấu câu ("Lâm,") thì chữ liền sau không làm "cắt đôi" từ nào.
 * Không dùng lookbehind (Safari < 16.4 không hỗ trợ) — kiểm tra biên trong
 * callback. Mỗi quy tắc quét chuỗi đúng 1 lượt → O(độ dài) như split/join.
 */
function replaceWholeWord(text, from, to) {
  const re = wholeWordRegex(from)
  const checkLeft = WORD_CHAR_RE.test(charAtCp(from, 0))
  const checkRight = WORD_CHAR_RE.test(charBefore(from, from.length))
  return text.replace(re, (m, offset, str) => {
    if (checkLeft && WORD_CHAR_RE.test(charBefore(str, offset))) return m
    if (checkRight && WORD_CHAR_RE.test(charAtCp(str, offset + m.length))) return m
    return to
  })
}

/**
 * Áp dụng danh sách quy tắc thay thế lên văn bản, theo thứ tự.
 * - `whole === true`: chỉ thay khi khớp NGUYÊN TỪ (regex dựng từ `from` ĐÃ escape).
 * - Không có cờ / false: khớp chuỗi con bằng split/join như cũ (tương thích
 *   quy tắc đã lưu trước khi có cờ).
 * Phân biệt hoa thường (giữ hành vi cũ).
 * @param {string} text
 * @param {Array<{ from: string, to: string, whole?: boolean }>} replacements
 * @returns {string}
 */
export function applyReplacements(text, replacements) {
  if (!text || typeof text !== 'string' || !Array.isArray(replacements) || replacements.length === 0) {
    return text
  }

  let result = text
  for (const rule of replacements) {
    if (rule && rule.from && typeof rule.from === 'string' && typeof rule.to === 'string') {
      if (!result.includes(rule.from)) continue // lọc nhanh: đa số quy tắc không có trong chương
      result = rule.whole === true
        ? replaceWholeWord(result, rule.from, rule.to)
        : result.split(rule.from).join(rule.to)
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
 * Giữ cờ `whole` (chỉ ghi khi true — vắng cờ = khớp chuỗi con).
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
    pub.push(r.whole === true ? { from: r.from, to: r.to, whole: true } : { from: r.from, to: r.to })
  }
  return [...pub, ...personal]
}

/**
 * Gộp quy tắc NHẬP TỪ FILE vào danh sách hiện có (dạng localStorage).
 * Chính sách: trùng `from` (không phân biệt hoa thường) → BẢN TRONG FILE THẮNG
 * (ghi đè to/whole, giữ id cũ để đồng bộ coi là sửa chứ không phải xoá + thêm).
 * Không đụng localStorage — nơi gọi tự writeReplacements.
 * @param {Array} currentList
 * @param {Array<{from:string,to:string,whole?:boolean}>} imported (đã qua parseNamePack)
 * @returns {{ list: Array, added: number, updated: number, unchanged: number }}
 */
export function mergeImportedRules(currentList, imported, now = Date.now()) {
  const list = Array.isArray(currentList) ? currentList.map(r => ({ ...r })) : []
  const index = new Map()
  list.forEach((r, i) => {
    if (r && typeof r.from === 'string') index.set(r.from.trim().toLowerCase(), i)
  })
  let added = 0
  let updated = 0
  let unchanged = 0
  let seq = 0
  for (const rule of Array.isArray(imported) ? imported : []) {
    if (!rule || typeof rule.from !== 'string' || typeof rule.to !== 'string') continue
    const from = rule.from.trim()
    const to = rule.to.trim()
    if (!from) continue
    const whole = rule.whole !== false
    const key = from.toLowerCase()
    const at = index.get(key)
    if (at !== undefined) {
      const cur = list[at]
      if (cur.from === from && cur.to === to && (cur.whole === true) === whole) { unchanged++; continue }
      list[at] = { ...cur, from, to, whole, updatedAt: now }
      updated++
    } else {
      index.set(key, list.length)
      list.push({ id: `rep_${now}_imp${seq++}`, from, to, whole, createdAt: now })
      added++
    }
  }
  return { list, added, updated, unchanged }
}
