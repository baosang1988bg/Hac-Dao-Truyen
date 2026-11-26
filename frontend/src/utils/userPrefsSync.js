/**
 * userPrefsSync.js — Đồng bộ cài đặt đọc + quy tắc sửa name cá nhân lên server
 * (học từ truyentrung saveReaderPrefs). File này KHÔNG import axios/React:
 *   - phần thuần (build/merge/cắt kích thước) test bằng node --test;
 *   - createPrefsSync(deps) nhận hàm mạng/storage qua tham số — bản dùng thật
 *     được nối ở utils/prefsSyncClient.js.
 *
 * Định dạng prefs (Worker chỉ nhận khoá v/reader/replacements, ≤ 48 KB):
 *   { v: 1, reader: <readerSettings đã sanitize, bỏ ttsVoice>,
 *     replacements: { [slug]: [{ from, to, updatedAt }] } }
 *
 * Tín hiệu xoá: truyện ĐÃ TỪNG đồng bộ quy tắc mà nay local không còn quy tắc
 * nào vẫn được gửi `replacements[slug] = []` (danh sách slug đã đồng bộ lưu ở
 * localStorage `prefsSyncedSlugs:<identity>`). Thiếu mảng rỗng này thì máy khác
 * không biết để xoá theo, và lần đẩy kế tiếp của máy đó làm quy tắc "sống lại".
 */
import { sanitizeSettings } from './readerSettingsSchema.js'

export const PREFS_VERSION = 1
export const PREFS_MAX_BYTES = 40 * 1024
export const PUSH_DEBOUNCE_MS = 3000
// Giới hạn mỗi quy tắc khi gửi lên (khớp giới hạn góp ý name phía server).
const RULE_TEXT_MAX = 100
// Tên giọng đọc phụ thuộc thiết bị (máy khác không có giọng đó) → không đồng bộ.
const DEVICE_ONLY_KEYS = ['ttsVoice']

function ruleTime(r) {
  const t = Number(r?.updatedAt) || Number(r?.createdAt) || 0
  return Number.isFinite(t) && t > 0 ? t : 0
}

function validRule(r) {
  return r && typeof r.from === 'string' && r.from.trim() !== '' && typeof r.to === 'string'
}

/** Cài đặt đọc để gửi lên: sanitize + bỏ khoá chỉ thuộc thiết bị. */
export function syncableReaderSettings(settings) {
  const clean = sanitizeSettings(settings)
  for (const k of DEVICE_ONLY_KEYS) delete clean[k]
  return clean
}

/** Áp cài đặt từ server lên cài đặt local (giữ khoá chỉ thuộc thiết bị). */
export function applyRemoteReaderSettings(localSettings, remoteReader) {
  const merged = sanitizeSettings(localSettings)
  if (!remoteReader || typeof remoteReader !== 'object' || Array.isArray(remoteReader)) return merged
  // Xét TỪNG khoá: giá trị server hỏng (sanitize không chấp nhận) → giữ giá trị local.
  for (const k of Object.keys(merged)) {
    if (DEVICE_ONLY_KEYS.includes(k) || !Object.prototype.hasOwnProperty.call(remoteReader, k)) continue
    const accepted = sanitizeSettings({ [k]: remoteReader[k] })[k]
    if (accepted === remoteReader[k]) merged[k] = accepted
  }
  return merged
}

/** Danh sách quy tắc (dạng localStorage) → dạng gọn gửi server. */
export function compactRules(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter(validRule)
    .map(r => ({ from: r.from.trim().slice(0, RULE_TEXT_MAX), to: r.to.trim().slice(0, RULE_TEXT_MAX), updatedAt: ruleTime(r) }))
}

/**
 * Dựng object prefs từ cài đặt + quy tắc theo slug (slug sắp xếp để JSON ổn
 * định — so sánh được với bản đã đẩy lần trước, tránh ghi D1 thừa).
 * Truyện không còn quy tắc: bỏ qua, TRỪ khi nằm trong `syncedSlugs` (đã từng
 * đồng bộ) → giữ `[]` làm tín hiệu xoá cho thiết bị khác.
 * @param {object} reader
 * @param {Record<string, Array>} replacementsBySlug
 * @param {Iterable<string>} [syncedSlugs]
 */
export function buildPrefs(reader, replacementsBySlug = {}, syncedSlugs = []) {
  const synced = new Set(syncedSlugs || [])
  const slugs = new Set([...Object.keys(replacementsBySlug || {}), ...synced])
  const replacements = {}
  for (const slug of [...slugs].sort()) {
    const rules = compactRules(replacementsBySlug?.[slug])
    if (rules.length || synced.has(slug)) replacements[slug] = rules
  }
  return { v: PREFS_VERSION, reader: syncableReaderSettings(reader), replacements }
}

/** Kích thước JSON theo byte UTF-8 (tiếng Việt có dấu = 2–3 byte/ký tự). */
export function prefsByteSize(prefs) {
  const json = JSON.stringify(prefs)
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length
  return unescape(encodeURIComponent(json)).length
}

/**
 * Cắt bớt cho JSON < maxBytes: bỏ dần TRUYỆN có quy tắc cũ nhất (theo
 * updatedAt mới nhất của truyện đó). Cài đặt đọc luôn giữ. Không sửa input.
 * Mảng rỗng (tín hiệu xoá, chỉ vài byte) KHÔNG bao giờ bị cắt — mất nó thì
 * thiết bị khác không xoá theo được.
 */
export function fitPrefsSize(prefs, maxBytes = PREFS_MAX_BYTES) {
  const out = { ...prefs, replacements: { ...(prefs?.replacements || {}) } }
  if (prefsByteSize(out) < maxBytes) return out
  const order = Object.keys(out.replacements)
    .filter(slug => Array.isArray(out.replacements[slug]) && out.replacements[slug].length > 0)
    .map(slug => ({ slug, t: Math.max(0, ...out.replacements[slug].map(ruleTime)) }))
    .sort((a, b) => a.t - b.t || (a.slug < b.slug ? -1 : 1))
  for (const { slug } of order) {
    delete out.replacements[slug]
    if (prefsByteSize(out) < maxBytes) break
  }
  return out
}

/**
 * Gộp quy tắc của 1 truyện: local (dạng localStorage {id,from,to,createdAt,updatedAt?})
 * với remote ({from,to,updatedAt}). Trùng `from` (không phân biệt hoa thường)
 * → bản có updatedAt mới hơn thắng (bằng nhau → giữ local).
 *
 * Xoá: quy tắc local KHÔNG có ở remote mà đã cũ hơn mốc đồng bộ lần trước
 * (syncedAt) nghĩa là đã từng lên server rồi bị xoá ở thiết bị khác → bỏ.
 * Quy tắc local mới hơn syncedAt (chưa kịp đẩy) → giữ.
 */
export function mergeReplacementLists(localList, remoteList, syncedAt = 0, now = Date.now()) {
  const local = Array.isArray(localList) ? localList.filter(validRule) : []
  const remote = Array.isArray(remoteList) ? remoteList.filter(validRule) : []
  const remoteByKey = new Map(remote.map(r => [r.from.trim().toLowerCase(), r]))
  const out = []
  const used = new Set()
  for (const l of local) {
    const key = l.from.trim().toLowerCase()
    const r = remoteByKey.get(key)
    if (!r) {
      if (syncedAt > 0 && ruleTime(l) <= syncedAt) continue // đã bị xoá ở nơi khác
      out.push(l)
      continue
    }
    used.add(key)
    if (ruleTime(r) > ruleTime(l)) out.push({ ...l, from: r.from, to: r.to, updatedAt: ruleTime(r) })
    else out.push(l)
  }
  let i = 0
  for (const r of remote) {
    const key = r.from.trim().toLowerCase()
    if (used.has(key)) continue
    used.add(key)
    const t = ruleTime(r) || now
    out.push({ id: `rep_${t}_sync${i++}`, from: r.from, to: r.to, createdAt: t, updatedAt: t })
  }
  return out
}

/**
 * Bộ đồng bộ (1 instance cho cả app). deps:
 *   fetchUserPrefs, saveUserPrefs(prefs, ts) → false | true | { ok, client_updated_at }
 *     (client_updated_at = mốc server đã kẹp — dùng làm mốc đồng bộ thay đồng hồ máy),
 *   isLoggedIn, getIdentityNamespace,
 *   readLocal() → { reader, replacementsBySlug },
 *   applyReader(reader), applyReplacements(slug, list),
 *   storage (getItem/setItem), now(), setTimeout/clearTimeout (test tiêm vào được)
 */
export function createPrefsSync(deps) {
  const now = deps.now || (() => Date.now())
  const setT = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms))
  const clearT = deps.clearTimeout || ((id) => clearTimeout(id))
  const listeners = new Set()
  let pulledFor = null // namespace đã kéo prefs trong phiên này
  let pullPromise = null
  let lastPushedJson = null
  let timer = null

  const markKey = () => `prefsSyncedAt:${deps.getIdentityNamespace()}`
  const readMark = () => {
    try { return Number(deps.storage.getItem(markKey())) || 0 } catch { return 0 }
  }
  const writeMark = (t) => {
    try { deps.storage.setItem(markKey(), String(t)) } catch { /* storage bị chặn */ }
  }
  // Slug đã từng đồng bộ quy tắc (đẩy lên hoặc kéo về) — để buildPrefs giữ `[]`.
  const slugsKey = () => `prefsSyncedSlugs:${deps.getIdentityNamespace()}`
  const readSyncedSlugs = () => {
    try {
      const arr = JSON.parse(deps.storage.getItem(slugsKey()) || '[]')
      return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s) : []
    } catch { return [] }
  }
  const addSyncedSlugs = (slugs) => {
    const cur = readSyncedSlugs()
    const next = [...new Set([...cur, ...slugs])].sort()
    if (next.length === cur.length) return
    try { deps.storage.setItem(slugsKey(), JSON.stringify(next)) } catch { /* storage bị chặn */ }
  }
  const emit = (evt) => { for (const fn of listeners) { try { fn(evt) } catch { /* listener lỗi — bỏ qua */ } } }

  async function doPull() {
    const res = await deps.fetchUserPrefs()
    if (!res || typeof res !== 'object') return
    const remote = res.prefs && typeof res.prefs === 'object' ? res.prefs : null
    const remoteAt = Number(res.client_updated_at) || 0
    const mark = readMark()
    if (remote) lastPushedJson = JSON.stringify(remote)
    if (!remote) return
    const remoteReps = remote.replacements && typeof remote.replacements === 'object' ? remote.replacements : {}
    const remoteSlugs = Object.keys(remoteReps).filter(slug => Array.isArray(remoteReps[slug]))
    if (remoteAt <= mark) {
      // Bản server không mới hơn lần đồng bộ cuối của máy này (chính máy này đẩy
      // hoặc đã kéo) → slug trên đó đều đã đồng bộ; ghi nhận để bản cài trước
      // khi có danh sách slug vẫn gửi được tín hiệu xoá.
      addSyncedSlugs(remoteSlugs)
      return
    }
    const { reader, replacementsBySlug } = deps.readLocal()
    if (remote.reader && typeof remote.reader === 'object') {
      const merged = applyRemoteReaderSettings(reader, remote.reader)
      deps.applyReader(merged)
      emit({ type: 'reader', reader: merged })
    }
    const changed = []
    // Chỉ duyệt slug CÓ trên remote: slug vắng mặt có thể do máy kia cắt bớt
    // (fitPrefsSize) chứ không phải xoá. Xoá thật được báo bằng mảng rỗng — khi
    // đó mergeReplacementLists bỏ các quy tắc local cũ hơn mốc đồng bộ (đã từng
    // lên server), giữ quy tắc mới thêm sau mốc (chưa kịp đẩy).
    for (const slug of remoteSlugs) {
      const localList = replacementsBySlug[slug] || []
      const merged = mergeReplacementLists(localList, remoteReps[slug], mark, now())
      if (JSON.stringify(merged) !== JSON.stringify(localList)) {
        deps.applyReplacements(slug, merged)
        changed.push(slug)
      }
    }
    if (changed.length) emit({ type: 'replacements', slugs: changed })
    addSyncedSlugs(remoteSlugs)
    writeMark(remoteAt)
    // Local có thể có thêm phần mới hơn (quy tắc chưa đẩy) → đẩy bản đã gộp.
    schedulePush()
  }

  /** Kéo prefs 1 lần cho mỗi danh tính (đăng nhập tài khoản khác → kéo lại). Không ném lỗi. */
  function start() {
    if (!deps.isLoggedIn()) return Promise.resolve()
    const ns = deps.getIdentityNamespace()
    if (pulledFor === ns && pullPromise) return pullPromise
    pulledFor = ns
    lastPushedJson = null
    pullPromise = doPull().catch(() => { /* lỗi mạng — dùng cài đặt local */ })
    return pullPromise
  }

  async function pushNow() {
    timer = null
    if (!deps.isLoggedIn()) return false
    await start() // không bao giờ đẩy trước khi kéo xong (tránh đè bản mới hơn trên server)
    if (!deps.isLoggedIn()) return false
    const { reader, replacementsBySlug } = deps.readLocal()
    const prefs = fitPrefsSize(buildPrefs(reader, replacementsBySlug, readSyncedSlugs()))
    const json = JSON.stringify(prefs)
    if (json === lastPushedJson) return false // không đổi gì so với server
    const t = now()
    const res = await deps.saveUserPrefs(prefs, t)
    const ok = res === true || (!!res && typeof res === 'object' && res.ok === true)
    if (ok) {
      lastPushedJson = json
      // Ưu tiên mốc server trả về (đã kẹp ≤ giờ server + 5 phút) — tránh lệch
      // đồng hồ máy làm lần kéo sau so sai. Server cũ không trả → dùng mốc local.
      const serverAt = Number(res?.client_updated_at)
      writeMark(Number.isFinite(serverAt) && serverAt > 0 ? serverAt : t)
      addSyncedSlugs(Object.keys(prefs.replacements).filter(slug => prefs.replacements[slug].length > 0))
    }
    return ok
  }

  /** Gọi mỗi khi người đọc đổi cài đặt/quy tắc — gom 3 giây rồi đẩy 1 lần. */
  function schedulePush() {
    if (!deps.isLoggedIn()) return
    if (timer) clearT(timer)
    timer = setT(() => { pushNow().catch(() => { /* bỏ qua */ }) }, PUSH_DEBOUNCE_MS)
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return { start, schedulePush, pushNow, subscribe }
}
