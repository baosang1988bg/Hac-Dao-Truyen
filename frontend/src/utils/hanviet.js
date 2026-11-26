// ── Gợi ý âm Hán Việt cho hộp sửa name (2026-11) ────────────────────────────
// Bảng âm từng chữ sinh bởi tools/build_hanviet.py → src/data/hanviet.json
// (dạng {"林":"lâm","樂":"lạc|nhạc"}; âm đầu là mặc định). Bảng ~80 KB nên chỉ
// tải lười (dynamic import → chunk riêng) khi hộp sửa name thật sự cần.
// Các hàm tra/ghép là hàm thuần, KHÔNG import React → test bằng `node --test`.

let tablePromise = null

const defaultLoader = () => import('../data/hanviet.json')

/**
 * Tải bảng âm Hán Việt (một lần, cache Promise). Lỗi mạng/chunk → xoá cache để
 * lần sau thử lại.
 * @param {() => Promise<object>} [loader] chỉ dùng cho test
 * @returns {Promise<Record<string, string>>}
 */
export function loadHanViet(loader = defaultLoader) {
  if (!tablePromise) {
    tablePromise = Promise.resolve()
      .then(loader)
      .then(mod => {
        const table = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod
        return table && typeof table === 'object' ? table : {}
      })
      .catch(err => {
        tablePromise = null
        throw err
      })
  }
  return tablePromise
}

/** Chỉ dùng trong test: bỏ cache để thử loader khác. */
export function resetHanVietCache() {
  tablePromise = null
}

const HAN_RE = /\p{Script=Han}/u
// Khoảng trắng và dấu ngăn tên kiểu 阿·莫 / 阿・莫 → bỏ qua khi phiên âm.
const SEPARATOR_RE = /[\s·•・.\-‧]/u

/** true nếu chuỗi (đã trim) khác rỗng và chứa ít nhất một chữ Hán, không có chữ Latin. */
export function isHanText(text) {
  const s = String(text ?? '').trim()
  if (!s || !HAN_RE.test(s)) return false
  return !/[A-Za-zÀ-ɏḀ-ỿ]/.test(s)
}

function readingsOf(ch, table) {
  const raw = table ? table[ch] : undefined
  if (Array.isArray(raw)) return raw.length ? raw.map(String) : ['?']
  if (typeof raw === 'string' && raw) return raw.split('|').filter(Boolean)
  return ['?']
}

/** Các ký tự được phiên âm (bỏ khoảng trắng/dấu ngăn) — cùng thứ tự với hanVietReadings. */
export function hanVietChars(zh) {
  return Array.from(String(zh ?? '')).filter(ch => !SEPARATOR_RE.test(ch))
}

/**
 * Âm Hán Việt từng chữ.
 * @param {string} zh chuỗi chữ Hán (vd "林凡")
 * @param {Record<string, string|string[]>} table bảng từ loadHanViet()
 * @returns {string[][]} mỗi phần tử = danh sách âm của một chữ (âm đầu = mặc
 *   định); chữ Hán không có trong bảng → ['?']; ký tự khác (số, Latin) giữ
 *   nguyên làm âm duy nhất; khoảng trắng/dấu ngăn tên bị bỏ.
 */
export function hanVietReadings(zh, table) {
  return hanVietChars(zh).map(ch => (HAN_RE.test(ch) ? readingsOf(ch, table) : [ch]))
}

/**
 * Ghép âm theo lựa chọn: picks[i] = chỉ số âm đang chọn của chữ thứ i (thiếu
 * hoặc vượt phạm vi → âm đầu). Kết quả chữ thường, cách nhau một dấu cách —
 * nơi gọi tự áp kiểu viết hoa (applyCasing trong utils/nameEditor.js).
 * @param {string} zh
 * @param {Record<string, string|string[]>} table
 * @param {number[]} [picks]
 * @returns {string}
 */
export function hanVietSuggestion(zh, table, picks = []) {
  return hanVietReadings(zh, table)
    .map((list, i) => {
      const p = Array.isArray(picks) ? picks[i] : undefined
      return Number.isInteger(p) && p >= 0 && p < list.length ? list[p] : list[0]
    })
    .join(' ')
}

/**
 * Chỉ số âm kế tiếp (vòng lại đầu) — cho nút đổi âm của chữ nhiều âm.
 * @param {number[]} picks
 * @param {number} index vị trí chữ
 * @param {number} count số âm của chữ đó
 * @returns {number[]} mảng picks mới (không sửa mảng cũ)
 */
export function cycleHanVietPick(picks, index, count) {
  const next = Array.isArray(picks) ? picks.slice() : []
  while (next.length <= index) next.push(0)
  const cur = Number.isInteger(next[index]) ? next[index] : 0
  next[index] = count > 0 ? (cur + 1) % count : 0
  return next
}
