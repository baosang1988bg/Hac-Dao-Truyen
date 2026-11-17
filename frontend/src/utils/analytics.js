// GA4 (Google Analytics 4) — chỉ hoạt động khi VITE_GA4_MEASUREMENT_ID được
// cấu hình lúc build (rỗng ở local dev/preview chưa setup → không tải script,
// không gửi gì cả, không cần tắt bằng tay).
//
// Danh sách event + tham số + custom dimension cần đăng ký trong GA4: xem
// plans/BAO_CAO_GA4_EVENTS_2026-11-17.md (mục "Tracking plan").
//
// Nguyên tắc dữ liệu:
// - KHÔNG gửi PII (email, tên, nội dung bình luận, URL người dùng dán vào).
// - user_id là hash SHA-256 của id nội bộ (không đảo ngược ra id thật).
// - Tôn trọng Do-Not-Track / Global Privacy Control và cờ opt-out cục bộ.
// - Mọi hàm public đều an toàn khi chạy ngoài trình duyệt (node test, SSR).

const GA4_ID = (import.meta.env && import.meta.env.VITE_GA4_MEASUREMENT_ID) || ''
const DEBUG = Boolean(import.meta.env && import.meta.env.DEV)

const OPT_OUT_KEY = 'hd_analytics_optout'
const READ_COUNT_KEY = 'hd_chapters_completed'
// GA4: tên param ≤ 40 ký tự, giá trị chuỗi ≤ 100 ký tự, tối đa 25 param/event.
const MAX_PARAM_VALUE = 100
const MAX_PARAMS = 25
// Mốc "aha moment": số chương đã đọc xong (cộng dồn trên trình duyệt).
export const READING_MILESTONES = [1, 3, 5, 10, 25, 50, 100, 250, 500, 1000]
// Mốc độ sâu cuộn trong 1 chương.
export const PROGRESS_MILESTONES = [25, 50, 75]
// Hoàn thành chương = cuộn tới ≥ 90% VÀ đã đọc thực sự ≥ 15 giây (lọc lướt nhanh).
export const COMPLETE_RATIO = 0.9
export const COMPLETE_MIN_ACTIVE_MS = 15_000

let initialized = false
let disabled = false

const hasWindow = () => typeof window !== 'undefined'

function safeStorage(kind = 'localStorage') {
  try { return hasWindow() ? window[kind] : null } catch { return null }
}

/**
 * Quyết định có được phép đo hay không (thuần — dễ test).
 * Bất kỳ tín hiệu từ chối nào (DNT, GPC, opt-out) → không đo.
 */
export function isTrackingAllowed({ doNotTrack, globalPrivacyControl, optOut } = {}) {
  if (optOut) return false
  if (globalPrivacyControl === true) return false
  if (doNotTrack === '1' || doNotTrack === 'yes') return false
  return true
}

function readPrivacySignals() {
  if (!hasWindow()) return { optOut: true }
  const nav = window.navigator || {}
  let optOut = false
  try { optOut = safeStorage()?.getItem(OPT_OUT_KEY) === '1' } catch { /* bị chặn */ }
  return {
    doNotTrack: nav.doNotTrack || window.doNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl,
    optOut,
  }
}

/** Người đọc tự tắt/bật đo lường (gắn vào trang Tài khoản nếu cần). */
export function setAnalyticsOptOut(optOut) {
  try {
    if (optOut) safeStorage()?.setItem(OPT_OUT_KEY, '1')
    else safeStorage()?.removeItem(OPT_OUT_KEY)
  } catch { /* bỏ qua */ }
  if (hasWindow() && GA4_ID) window[`ga-disable-${GA4_ID}`] = Boolean(optOut)
  disabled = Boolean(optOut)
}

/**
 * Chuẩn hoá tham số trước khi gửi: bỏ undefined/null/NaN, cắt chuỗi quá dài,
 * boolean → 'yes'/'no' (GA4 không có kiểu boolean), giới hạn 25 param.
 */
export function sanitizeParams(params = {}) {
  const out = {}
  let n = 0
  for (const [key, raw] of Object.entries(params)) {
    if (n >= MAX_PARAMS) break
    if (raw === undefined || raw === null) continue
    let value = raw
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    if (typeof value === 'boolean') value = value ? 'yes' : 'no'
    if (typeof value === 'string') value = value.slice(0, MAX_PARAM_VALUE)
    if (typeof value === 'object') continue // không gửi object lồng nhau
    out[key.slice(0, 40)] = value
    n += 1
  }
  return out
}

// Bỏ qua traffic của chính admin khi quản trị trang (/admin/* và /login) —
// đây là hoạt động vận hành nội bộ, không phải hành vi đọc giả thật.
export function isAdminPath(path) {
  return path === '/login' || String(path || '').startsWith('/admin')
}

/**
 * Admin (có authToken) đọc thử trang guest: VẪN gửi để test được DebugView,
 * nhưng gắn traffic_type=internal → bật Data filter "Internal Traffic" trong
 * GA4 Admin là loại khỏi báo cáo.
 */
function isInternalUser() {
  try { return Boolean(safeStorage()?.getItem('authToken')) } catch { return false }
}

function detectDisplayMode() {
  if (!hasWindow() || !window.matchMedia) return 'browser'
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator?.standalone) return 'standalone'
  return 'browser'
}

/** Tải gtag.js và khởi tạo đúng 1 lần. Idempotent — gọi ở đâu cũng được. */
export function initAnalytics() {
  if (initialized || disabled || !GA4_ID || !hasWindow()) return initialized
  if (!isTrackingAllowed(readPrivacySignals())) {
    disabled = true
    return false
  }
  initialized = true

  window.dataLayer = window.dataLayer || []
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`
  document.head.appendChild(script)

  gtag('js', new Date())
  const debugMode = DEBUG || /[?&]ga_debug=1\b/.test(window.location?.search || '')
  // send_page_view: false — app là SPA, tự bắn page_view theo route qua
  // trackPageView() (xem App.jsx).
  // KHÔNG qua sanitizeParams: config cần boolean thật (sanitize đổi thành 'yes'/'no').
  const config = {
    send_page_view: false,
    // Tối giản dữ liệu: không dùng Google Signals / cá nhân hoá quảng cáo.
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  }
  if (isInternalUser()) config.traffic_type = 'internal'
  if (debugMode) config.debug_mode = true
  gtag('config', GA4_ID, config)
  gtag('set', 'user_properties', sanitizeParams({
    display_mode: detectDisplayMode(),
  }))

  // PWA: đo lượt cài app (kênh giữ chân mạnh nhất cho web đọc truyện).
  window.addEventListener('appinstalled', () => trackEvent('pwa_install'), { once: true })
  return true
}

/**
 * Gửi 1 event GA4. Tự khởi tạo nếu chưa (tránh mất event phát ra TRƯỚC
 * effect của App — effect của component con chạy trước effect của cha).
 */
export function trackEvent(name, params = {}) {
  if (!name || !hasWindow()) return false
  if (!initialized && !initAnalytics()) return false
  if (typeof window.gtag !== 'function') return false
  if (isAdminPath(window.location?.pathname)) return false
  const clean = sanitizeParams(params)
  if (isInternalUser()) clean.traffic_type = 'internal'
  if (DEBUG || /[?&]ga_debug=1\b/.test(window.location?.search || '')) clean.debug_mode = true
  window.gtag('event', name, clean)
  if (DEBUG) console.debug('[ga4]', name, clean)
  return true
}

/** Gửi 1 sự kiện page_view — gọi mỗi khi route (SPA) đổi. */
export function trackPageView(path) {
  if (isAdminPath(path)) return
  trackEvent('page_view', {
    page_path: path,
    page_location: hasWindow() ? window.location.href : undefined,
    page_title: hasWindow() ? document.title : undefined,
    page_type: pageTypeOf(path),
  })
}

/** Phân loại trang (custom dimension page_type) — gộp hàng nghìn URL truyện/chương. */
export function pageTypeOf(path = '') {
  const p = String(path).split('?')[0]
  if (p === '/' || p === '') return 'home'
  if (/^\/novel\/[^/]+\/read\//.test(p)) return 'reader'
  if (/^\/novel\/[^/]+\/epub-reader/.test(p)) return 'epub_reader'
  if (/^\/novel\/[^/]+\/?$/.test(p)) return 'novel'
  if (p.startsWith('/library')) return 'library'
  if (p.startsWith('/epub')) return 'epub_catalog'
  if (p.startsWith('/cap-nhat')) return 'updates'
  if (p.startsWith('/account')) return 'account'
  return 'other'
}

// ── Debounce theo khoá: input liên tục (slider, gõ tìm kiếm) chỉ gửi giá trị cuối
const debounceTimers = new Map()
export function trackEventDebounced(key, name, params, wait = 1500) {
  if (!hasWindow()) return
  clearTimeout(debounceTimers.get(key))
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    trackEvent(name, params)
  }, wait))
}

/** GA4 recommended event `search` — debounce để không đếm từng phím. */
export function trackSearch(term, { location, resultsCount } = {}) {
  const t = String(term || '').trim()
  if (t.length < 2) return
  trackEventDebounced(`search:${location}`, 'search', {
    search_term: t.toLowerCase(),
    search_location: location,
    results_count: resultsCount,
    has_results: typeof resultsCount === 'number' ? resultsCount > 0 : undefined,
  })
}

// ── Định danh người dùng ───────────────────────────────────────────────────

async function hashId(raw) {
  try {
    const data = new TextEncoder().encode(`hacdao:${raw}`)
    const buf = await window.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf)).slice(0, 16)
      .map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null // không có crypto.subtle (http không bảo mật) → bỏ user_id
  }
}

/**
 * Đồng bộ user_id + user property logged_in theo phiên user hiện tại.
 * Gọi khi khởi động, sau đăng nhập/đăng ký và sau đăng xuất.
 */
export async function syncAnalyticsUser(user) {
  if (!hasWindow() || !initAnalytics() || typeof window.gtag !== 'function') return
  const id = user && user.id != null ? await hashId(String(user.id)) : null
  // 'set' (không 'config' lại) → áp cho mọi event sau, không khởi tạo lại tag.
  window.gtag('set', { user_id: id })
  window.gtag('set', 'user_properties', { logged_in: id ? 'yes' : 'no' })
}

/** Ghi nhận phương thức đăng nhập/đăng ký (GA4 recommended: login / sign_up). */
export function trackAuth(kind, method, user) {
  trackEvent(kind === 'sign_up' ? 'sign_up' : 'login', { method })
  syncAnalyticsUser(user)
}

// ── Đo đọc chương ──────────────────────────────────────────────────────────

/** Số chương đã đọc xong (cộng dồn cục bộ) → trả mốc vừa đạt (nếu có). */
export function bumpCompletedCount(storage = safeStorage()) {
  let count = 0
  try { count = Number(storage?.getItem(READ_COUNT_KEY)) || 0 } catch { /* bị chặn */ }
  count += 1
  try { storage?.setItem(READ_COUNT_KEY, String(count)) } catch { /* đầy/bị chặn */ }
  return { count, milestone: READING_MILESTONES.includes(count) ? count : null }
}

/**
 * Bộ đo cho MỘT lượt mở chương. Thuần logic (thời gian + emit tiêm vào) để
 * unit-test được:
 * - start(): chapter_start
 * - progress(ratio): chapter_progress 25/50/75 (mỗi mốc 1 lần) và
 *   chapter_complete khi ratio ≥ 90% và thời gian đọc thực ≥ 15s
 * - setVisible(bool): chỉ cộng thời gian khi tab đang hiển thị
 * - end(): trả tóm tắt (đã hoàn thành chưa, % sâu nhất, giây đọc)
 */
export function createChapterTracker({ base = {}, emit = trackEvent, now = () => Date.now(), onComplete } = {}) {
  let activeMs = 0
  let visibleSince = null
  let maxRatio = 0
  let started = false
  let completed = false
  const sent = new Set()

  const activeNow = () => activeMs + (visibleSince != null ? now() - visibleSince : 0)

  const tryComplete = () => {
    if (completed || maxRatio < COMPLETE_RATIO || activeNow() < COMPLETE_MIN_ACTIVE_MS) return
    completed = true
    emit('chapter_complete', { ...base, read_time_sec: Math.round(activeNow() / 1000) })
    onComplete?.()
  }

  return {
    start() {
      if (started) return
      started = true
      visibleSince = now()
      emit('chapter_start', base)
    },
    setVisible(visible) {
      if (!started) return
      if (visible && visibleSince == null) visibleSince = now()
      if (!visible && visibleSince != null) {
        activeMs += now() - visibleSince
        visibleSince = null
      }
    },
    progress(ratio) {
      if (!started || !Number.isFinite(ratio)) return
      maxRatio = Math.max(maxRatio, Math.min(1, ratio))
      for (const m of PROGRESS_MILESTONES) {
        if (maxRatio * 100 >= m && !sent.has(m)) {
          sent.add(m)
          emit('chapter_progress', { ...base, percent: m })
        }
      }
      tryComplete()
    },
    /** Gọi định kỳ (vd mỗi 5s): chương ngắn đã cuộn hết sẵn vẫn được tính hoàn thành khi đủ thời gian. */
    tick() { if (started) tryComplete() },
    end() {
      if (!started) return null
      tryComplete()
      return { completed, maxPercent: Math.round(maxRatio * 100), readTimeSec: Math.round(activeNow() / 1000) }
    },
  }
}

// ── Click tracking khai báo bằng data-attribute ────────────────────────────

/**
 * Lắng nghe click toàn trang: link tới truyện/chương nằm trong vùng có
 * `data-track-section="<tên>"` → GA4 `select_content` kèm tên vùng. Nhờ đó đo
 * được khối nào trên trang chủ/trang truyện thực sự kéo người đọc vào đọc,
 * không phải sửa từng component.
 */
export function parseNovelHref(href = '') {
  const m = String(href).match(/^\/novel\/([^/?#]+)(?:\/(read|epub-reader)(?:\/([^/?#]+))?)?/)
  if (!m) return null
  const [, slug, kind, chapter] = m
  return {
    content_type: kind === 'read' ? 'chapter' : kind === 'epub-reader' ? 'epub' : 'novel',
    novel_slug: decodeURIComponent(slug),
    chapter_number: chapter && /^\d+$/.test(chapter) ? Number(chapter) : undefined,
  }
}

let clickListenerInstalled = false
export function installClickTracking() {
  if (clickListenerInstalled || !hasWindow()) return
  clickListenerInstalled = true
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[href]')
    if (!a) return
    const zone = a.closest('[data-track-section]')
    if (!zone) return
    const url = new URL(a.href, window.location.origin)
    if (url.origin !== window.location.origin) {
      trackEvent('outbound_click', { section: zone.dataset.trackSection, link_domain: url.hostname })
      return
    }
    const info = parseNovelHref(url.pathname)
    if (!info) return
    trackEvent('select_content', {
      ...info,
      item_id: info.novel_slug,
      section: zone.dataset.trackSection,
      action: a.dataset.trackAction,
      page_type: pageTypeOf(window.location.pathname),
    })
  }, { capture: true, passive: true })
}
