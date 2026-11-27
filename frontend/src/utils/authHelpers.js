/**
 * authHelpers.js — hàm THUẦN cho đăng nhập / tài khoản (không axios, không
 * React → test được bằng node --test). Phần gọi API nằm ở utils/authApi.js.
 */

import { parseServerTime } from './authMerge.js'

export const ONE_TAP_DISMISSED_KEY = 'oneTapDismissed'
export const ONE_TAP_MIN_CHAPTERS = 2

/** Thông báo lỗi thân thiện cho form email/mật khẩu (đăng nhập / đăng ký). */
export function friendlyAuthError(err, mode) {
  const status = err?.response?.status
  if (status === 401) return 'Email hoặc mật khẩu không đúng. Bạn kiểm tra lại nhé.'
  if (status === 409) return 'Email này đã được đăng ký rồi — hãy chuyển sang tab Đăng nhập.'
  if (status === 400) return 'Thông tin chưa hợp lệ. Kiểm tra lại email và mật khẩu (tối thiểu 8 ký tự).'
  if (status === 429) return 'Bạn thử quá nhiều lần. Đợi một lát rồi thử lại nhé.'
  if (!err?.response) return 'Không kết nối được máy chủ. Vui lòng thử lại sau.'
  return mode === 'login' ? 'Đăng nhập thất bại. Vui lòng thử lại.' : 'Đăng ký thất bại. Vui lòng thử lại.'
}

/** Lý do lỗi do Worker trả kèm (body.reason), không có → ''. */
export function errorReason(err) {
  const r = err?.response?.data?.reason
  return typeof r === 'string' ? r : ''
}

export const LINK_REQUIRED_MESSAGE =
  'Email này đã có tài khoản Hắc Đạo Truyện. Hãy đăng nhập bằng mật khẩu, sau đó vào Tài khoản → Liên kết Google.'
export const GOOGLE_CONFLICT_MESSAGE =
  'Email này đã liên kết với một tài khoản Google khác. Hãy đăng nhập bằng tài khoản Google đó hoặc bằng mật khẩu.'
export const GOOGLE_TAKEN_MESSAGE =
  'Tài khoản Google này đã được dùng cho một tài khoản Hắc Đạo Truyện khác. Hãy chọn tài khoản Google khác.'
export const RATE_LIMIT_MESSAGE = 'Bạn thử quá nhiều lần. Đợi một lát rồi thử lại nhé.'

/** 403 { reason: 'reauth_required' }: thao tác nhạy cảm cần xác thực lại. */
export function isReauthRequired(err) {
  return err?.response?.status === 403 && errorReason(err) === 'reauth_required'
}

/** Thông báo lỗi cho đăng nhập Google (POST /user/google-login). */
export function googleLoginErrorMessage(err) {
  const status = err?.response?.status
  // 409: email không phải Gmail/Workspace mà đã có tài khoản email → Google
  // không chứng minh được người này còn sở hữu email → phải đăng nhập mật khẩu
  // rồi tự liên kết; hoặc email đã gắn với tài khoản Google khác.
  if (status === 409 && errorReason(err) === 'link_required') return LINK_REQUIRED_MESSAGE
  if (status === 409 && errorReason(err) === 'google_conflict') return GOOGLE_CONFLICT_MESSAGE
  if (status === 409) return 'Email này đã có tài khoản. Hãy đăng nhập bằng mật khẩu.'
  // Worker trả 503 cho 2 tình huống khác nhau: chưa cấu hình GOOGLE_CLIENT_ID
  // (không có reason) và tạm thời không tải được khoá công khai của Google
  // (reason 'jwks_unavailable') — trường hợp sau thử lại là được.
  if (status === 503 && err?.response?.data?.reason === 'jwks_unavailable') {
    return 'Tạm thời chưa xác minh được với Google. Thử lại sau ít phút, hoặc dùng email/mật khẩu nhé.'
  }
  if (status === 503) return 'Máy chủ chưa bật đăng nhập Google. Bạn dùng email/mật khẩu trong lúc chờ nhé.'
  if (status === 401) return 'Google chưa xác thực được tài khoản (phiên đăng nhập hết hạn). Bấm lại nút Google để thử lần nữa.'
  if (status === 403) return 'Tài khoản Google này không dùng được để đăng nhập (email chưa được Google xác minh).'
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (status === 400) return 'Yêu cầu đăng nhập Google không hợp lệ. Tải lại trang rồi thử lại.'
  if (err && !err.response && err.request) return 'Không kết nối được máy chủ. Vui lòng thử lại sau.'
  return 'Đăng nhập Google thất bại. Vui lòng thử lại.'
}

/** Thông báo lỗi khi liên kết Google vào tài khoản đang đăng nhập (POST /user/link-google). */
export function linkGoogleErrorMessage(err) {
  const status = err?.response?.status
  const reason = errorReason(err)
  if (status === 409 && reason === 'google_taken') return GOOGLE_TAKEN_MESSAGE
  if (status === 409) return 'Tài khoản của bạn đã liên kết với một tài khoản Google khác.'
  if (status === 401 && reason) return 'Google chưa xác thực được (phiên xác nhận có thể đã hết hạn). Bấm lại nút Google để thử lần nữa.'
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  if (status === 503 && reason === 'jwks_unavailable') return 'Tạm thời chưa xác minh được với Google. Thử lại sau ít phút nhé.'
  if (status === 503) return 'Máy chủ chưa bật đăng nhập Google nên chưa liên kết được.'
  if (status === 403) return 'Tài khoản Google này chưa xác minh email nên không liên kết được.'
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (status === 404) return 'Máy chủ chưa hỗ trợ liên kết Google.'
  if (!err?.response) return 'Không kết nối được máy chủ. Vui lòng thử lại sau.'
  return 'Không liên kết được Google. Vui lòng thử lại.'
}

/**
 * Thông báo khi xác nhận lại bằng Google xong mà server vẫn trả
 * reauth_required (chọn nhầm tài khoản Google, credential hết hạn…).
 */
export const REAUTH_GOOGLE_FAILED_MESSAGE =
  'Không xác nhận được bằng Google — có thể bạn đã chọn tài khoản Google khác với tài khoản đang liên kết. Thử lại nhé.'

/**
 * Thông báo lỗi khi đặt/đổi mật khẩu (POST /user/password).
 * withCredential: lần gửi này đã kèm id_token Google xác nhận lại.
 */
export function passwordErrorMessage(err, hasPassword, { withCredential = false } = {}) {
  const status = err?.response?.status
  const detail = err?.response?.data?.error
  if (isReauthRequired(err)) {
    return withCredential
      ? REAUTH_GOOGLE_FAILED_MESSAGE
      : 'Để bảo vệ tài khoản, hãy xác nhận lại bằng Google trước khi đặt mật khẩu.'
  }
  if (status === 401 || status === 403) {
    return hasPassword ? 'Mật khẩu hiện tại không đúng.' : 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  }
  if (status === 400) return detail || 'Mật khẩu mới chưa hợp lệ (tối thiểu 8 ký tự).'
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (!err?.response) return 'Không kết nối được máy chủ. Vui lòng thử lại sau.'
  return 'Không đổi được mật khẩu. Vui lòng thử lại.'
}

/**
 * Thông báo lỗi khi xoá tài khoản (DELETE /user/account).
 * hasPassword: tài khoản có mật khẩu (403 = mật khẩu hiện tại sai);
 * withCredential: đã kèm id_token Google xác nhận lại.
 */
export function deleteAccountErrorMessage(err, { hasPassword = false, withCredential = false } = {}) {
  const status = err?.response?.status
  if (status === 400) return 'Email xác nhận không khớp với tài khoản.'
  if (status === 403) {
    if (hasPassword) return 'Mật khẩu hiện tại không đúng.'
    return withCredential
      ? REAUTH_GOOGLE_FAILED_MESSAGE
      : 'Để bảo vệ tài khoản, hãy xác nhận lại bằng Google trước khi xoá.'
  }
  if (status === 429) return RATE_LIMIT_MESSAGE
  if (status === 404) return 'Máy chủ chưa hỗ trợ xoá tài khoản.'
  if (status === 401) return null // phiên hết hạn: AuthContext tự đưa về form đăng nhập
  if (!err?.response) return 'Không kết nối được máy chủ. Vui lòng thử lại sau.'
  return 'Không xoá được tài khoản. Vui lòng thử lại.'
}

/** Nút "Xoá vĩnh viễn" chỉ bật khi gõ đúng email (và có mật khẩu nếu tài khoản có mật khẩu). */
export function canSubmitDelete({ typed, email, hasPassword, password }) {
  if (!emailConfirmMatches(typed, email)) return false
  return !hasPassword || String(password || '').length > 0
}

/** Chữ cái đầu để làm avatar khi không có ảnh. */
export function avatarInitial(user) {
  const s = String(user?.name || user?.email || '?').trim()
  return (Array.from(s)[0] || '?').toUpperCase()
}

/** Chỉ nhận ảnh đại diện https (ảnh Google: lh3.googleusercontent.com…). */
export function safeAvatarUrl(user) {
  const url = typeof user?.avatar_url === 'string' ? user.avatar_url.trim() : ''
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : ''
}

/** So email xác nhận xoá tài khoản (bỏ khoảng trắng 2 đầu, không phân biệt hoa thường). */
export function emailConfirmMatches(input, email) {
  const a = String(input || '').trim().toLowerCase()
  const b = String(email || '').trim().toLowerCase()
  return Boolean(a) && a === b
}

/** Mô tả ngắn thiết bị từ User-Agent: "Chrome · Windows", "Safari · iPhone"… */
export function describeUserAgent(ua) {
  const s = String(ua || '')
  if (!s) return 'Thiết bị không rõ'
  let browser = 'Trình duyệt'
  if (/Edg\//.test(s)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera'
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet'
  else if (/CocCoc|coc_coc/i.test(s)) browser = 'Cốc Cốc'
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox'
  else if (/Chrome\/|CriOS\//.test(s)) browser = 'Chrome'
  else if (/Safari\//.test(s)) browser = 'Safari'
  let os = ''
  if (/iPhone/.test(s)) os = 'iPhone'
  else if (/iPad/.test(s)) os = 'iPad'
  else if (/Android/.test(s)) os = 'Android'
  else if (/Windows/.test(s)) os = 'Windows'
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS'
  else if (/CrOS/.test(s)) os = 'ChromeOS'
  else if (/Linux/.test(s)) os = 'Linux'
  return os ? `${browser} · ${os}` : browser
}

/** Chuẩn hoá danh sách phiên từ GET /user/sessions (mảng hoặc { sessions: [] }). */
export function normalizeSessions(data) {
  const list = Array.isArray(data) ? data : (Array.isArray(data?.sessions) ? data.sessions : [])
  return list
    .filter(s => s && (typeof s.id === 'string' || typeof s.id === 'number'))
    .map(s => ({ ...s, id: String(s.id), current: Boolean(s.current) }))
    // Máy hiện tại lên đầu, còn lại mới nhất trước.
    .sort((a, b) => (Number(b.current) - Number(a.current)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

/** Tổng số chương đã mở từ map { slug: [chương…] } hoặc mảng độ dài. */
export function countReadChapters(lists) {
  let n = 0
  for (const l of lists || []) n += Array.isArray(l) ? l.length : (Number(l) || 0)
  return n
}

/**
 * One Tap ở trang chủ chỉ hiện khi: có CLIENT_ID, chưa đăng nhập, đã đọc ≥ 2
 * chương (người đọc thật, không làm phiền khách mới vào) và chưa tự tắt.
 */
export function shouldShowOneTap({ clientId, loggedIn, chaptersRead, dismissed }) {
  return Boolean(clientId) && !loggedIn && !dismissed && Number(chaptersRead) >= ONE_TAP_MIN_CHAPTERS
}

/**
 * Thời gian server (SQL UTC 'YYYY-MM-DD HH:MM:SS' / ISO / epoch) → giờ máy
 * người dùng dạng "27/11/2026 14:05". Không đọc được → '—'.
 */
export function fmtServerDateTime(value) {
  const ms = parseServerTime(value)
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
