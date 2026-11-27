/**
 * authApi.js — gọi API đăng nhập / tài khoản NGƯỜI DÙNG (dùng chung cho
 * AccountPage, LoginDialog, GoogleLoginButton, AuthContext). Hợp đồng API:
 * plans/KE_HOACH_TRIEN_KHAI_DANG_NHAP_2026-11-27.md mục 2.
 * Hàm thuần (thông báo lỗi, mô tả thiết bị…) ở utils/authHelpers.js.
 */
import userApi, { saveUserSession, getUserInfo, updateUserInfo } from '../userApi'
import { trackAuth, trackEvent } from './analytics'

/**
 * Đăng nhập / đăng ký bằng email + mật khẩu. mode: 'login' | 'register'.
 * Thành công → lưu phiên + GA4, trả user. Lỗi → ném (đã ghi auth_error).
 */
export async function passwordAuth(mode, { email, password, name }) {
  const payload = mode === 'register'
    ? { email: String(email || '').trim(), password, ...(name && name.trim() ? { name: name.trim() } : {}) }
    : { email: String(email || '').trim(), password }
  try {
    const res = await userApi.post(`/user/${mode === 'register' ? 'register' : 'login'}`, payload)
    saveUserSession(res.data.token, res.data.user)
    trackAuth(mode === 'register' ? 'sign_up' : 'login', 'password', res.data.user)
    return res.data.user
  } catch (err) {
    trackEvent('auth_error', { auth_mode: mode, method: 'password', status: err.response?.status || 0 })
    throw err
  }
}

/**
 * Nonce một lần cho Google Identity Services (GET /user/google-nonce).
 * Lỗi / 404 (Worker cũ) / không có AUTH_SECRET → null: vẫn đăng nhập được,
 * Worker vẫn kiểm chữ ký JWT đầy đủ.
 */
export async function fetchGoogleNonce() {
  try {
    const res = await userApi.get('/user/google-nonce')
    const nonce = res.data?.nonce
    return typeof nonce === 'string' && nonce ? nonce : null
  } catch {
    return null
  }
}

/** Đổi credential (ID token) của Google lấy phiên HacDaoTruyen. */
export async function googleAuth(credential) {
  try {
    const res = await userApi.post('/user/google-login', { credential })
    saveUserSession(res.data.token, res.data.user)
    // API không báo "tài khoản mới tạo" → ghi chung là login (method google).
    trackAuth('login', 'google', res.data.user)
    return res.data.user
  } catch (err) {
    trackEvent('auth_error', { auth_mode: 'login', method: 'google', status: err.response?.status || 0 })
    throw err
  }
}

/**
 * GET /user/me → gộp vào userInfo local (avatar_url, has_password, has_google,
 * email_verified, created_at, last_login_at). Trả user mới (hoặc null nếu 401 —
 * interceptor của userApi đã xoá phiên).
 */
export async function fetchMe() {
  const res = await userApi.get('/user/me')
  const me = res.data?.user && typeof res.data.user === 'object' ? res.data.user : res.data
  if (!me || typeof me !== 'object' || me.id == null) return getUserInfo()
  const merged = { ...(getUserInfo() || {}), ...me }
  updateUserInfo(merged)
  return merged
}

/** Đăng xuất máy này (server huỷ token; lỗi mạng/hết hạn vẫn coi như xong). */
export async function logoutServer() {
  try { await userApi.post('/user/logout') } catch { /* token có thể đã hết hạn */ }
}

/** Danh sách thiết bị đang đăng nhập (GET /user/sessions). */
export async function fetchSessions() {
  const res = await userApi.get('/user/sessions')
  return res.data
}

/** Đăng xuất một thiết bị (DELETE /user/sessions/:id). */
export async function revokeSession(id) {
  await userApi.delete(`/user/sessions/${encodeURIComponent(id)}`)
}

/** Đăng xuất mọi thiết bị, kể cả máy này (POST /user/logout-all). */
export async function logoutAllSessions() {
  await userApi.post('/user/logout-all')
}

/**
 * Đặt mật khẩu (tài khoản chỉ có Google) hoặc đổi mật khẩu (cần mật khẩu hiện
 * tại). Server huỷ các phiên KHÁC; nếu trả token mới thì lưu lại.
 */
export async function changePassword({ currentPassword, newPassword, credential }) {
  const body = { new_password: newPassword }
  if (currentPassword) body.current_password = currentPassword
  // Đặt mật khẩu LẦN ĐẦU khi phiên đã quá 10 phút: kèm id_token Google mới (xác nhận lại).
  if (credential) body.credential = credential
  const res = await userApi.post('/user/password', body)
  if (res.data?.token) saveUserSession(res.data.token, res.data.user || getUserInfo())
  const info = getUserInfo()
  if (info) updateUserInfo({ ...info, ...(res.data?.user || {}), has_password: true })
  return res.data
}

/**
 * Xoá tài khoản vĩnh viễn (DELETE /user/account): body { confirm: <email> }
 * + current_password (tài khoản có mật khẩu — bắt buộc) hoặc credential
 * (tài khoản chỉ Google, khi phiên đã quá 10 phút).
 */
export async function deleteAccount({ confirm, currentPassword, credential }) {
  const data = { confirm: String(confirm || '').trim() }
  if (currentPassword) data.current_password = currentPassword
  if (credential) data.credential = credential
  const res = await userApi.delete('/user/account', { data })
  return res.data
}

/** Liên kết Google vào tài khoản đang đăng nhập (POST /user/link-google { credential }). */
export async function linkGoogle(credential) {
  try {
    const res = await userApi.post('/user/link-google', { credential })
    trackEvent('google_link', { status: 200 })
    return res.data
  } catch (err) {
    trackEvent('auth_error', { auth_mode: 'link', method: 'google', status: err.response?.status || 0 })
    throw err
  }
}
