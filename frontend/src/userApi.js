import axios from 'axios';
import { syncAnalyticsUser } from './utils/analytics';

/**
 * Axios instance dành riêng cho NGƯỜI DÙNG (guest đã đăng ký).
 * Tách biệt hoàn toàn với `api.js` (phiên ADMIN — authToken):
 * - Token lưu ở localStorage.userToken, info ở localStorage.userInfo (JSON).
 * - Khi 401: CHỈ xóa phiên user tại chỗ, KHÔNG redirect — guest vẫn đọc truyện
 *   bình thường, chỗ nào cần đăng nhập sẽ tự hiện lời mời.
 */
const userApi = axios.create({
  baseURL: '/api',
});

userApi.interceptors.request.use(config => {
  const token = localStorage.getItem('userToken');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

userApi.interceptors.response.use(
  res => res,
  err => {
    const status = err.response?.status;
    const url = err.config?.url || '';
    // 401 của chính login/register = sai thông tin đăng nhập → để form tự xử lý,
    // không được xóa phiên đang có.
    // Tương tự: 401 của đổi mật khẩu (sai mật khẩu hiện tại) / google-login
    // (credential bị Google từ chối) KHÔNG có nghĩa phiên đang có đã hết hạn.
    // link-google: 401 KÈM reason (bad_nonce, chữ ký JWT…) là lỗi credential
    // Google, không phải phiên hết hạn; 401 không reason mới là mất phiên.
    const keepSession = ['/user/login', '/user/register', '/user/password', '/user/google-login']
      .some(p => url.includes(p))
      || (url.includes('/user/link-google') && Boolean(err.response?.data?.reason));
    if (status === 401 && !keepSession && localStorage.getItem('userToken')) {
      localStorage.removeItem('userToken');
      localStorage.removeItem('userInfo');
      notifyAuthChange();
    }
    return Promise.reject(err);
  }
);

/**
 * Sự kiện nội bộ báo phiên user vừa đổi TRONG CÙNG TAB (sự kiện `storage` của
 * trình duyệt chỉ bắn sang các tab khác) — AuthContext nghe để cập nhật header,
 * bình luận... ngay khi đăng nhập/đăng xuất/phiên hết hạn.
 */
export const AUTH_CHANGE_EVENT = 'hd:auth-change';

function notifyAuthChange() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  } catch { /* môi trường không có Event (node test) — bỏ qua */ }
}

/** Lưu phiên user sau khi login/register thành công. */
export function saveUserSession(token, user) {
  localStorage.setItem('userToken', token);
  localStorage.setItem('userInfo', JSON.stringify(user || null));
  notifyAuthChange();
}

/**
 * Cập nhật thông tin user (vd sau GET /user/me có thêm avatar_url, has_password…)
 * mà KHÔNG đổi token. Không có phiên → bỏ qua (tránh "hồi sinh" phiên đã xoá).
 */
export function updateUserInfo(user) {
  if (!localStorage.getItem('userToken') || !user) return;
  localStorage.setItem('userInfo', JSON.stringify(user));
  notifyAuthChange();
}

/** Xóa phiên user tại chỗ (logout phía client). */
export function clearUserSession() {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userInfo');
  // GA4: bỏ user_id để các event sau đăng xuất không gắn vào tài khoản cũ.
  syncAnalyticsUser(null);
  notifyAuthChange();
}

/**
 * Thông tin user đã đăng nhập hoặc null: {id,email,name} + (sau GET /user/me)
 * avatar_url, has_password, has_google, email_verified, created_at, last_login_at.
 */
export function getUserInfo() {
  try {
    return JSON.parse(localStorage.getItem('userInfo') || 'null');
  } catch {
    return null;
  }
}

/** Có phiên user hay không (chỉ kiểm tra local, không gọi API). */
export function isLoggedIn() {
  return Boolean(localStorage.getItem('userToken'));
}

/**
 * C04: định danh namespace cho dữ liệu local KHÔNG thuộc tài khoản server
 * (hàng đợi progress offline, v.v.) — 2 user dùng chung 1 trình duyệt (đăng
 * xuất rồi đăng nhập tài khoản khác) không được đọc/ghi đè dữ liệu của nhau.
 * 'guest' khi chưa đăng nhập, 'user:<id>' khi đã đăng nhập — DÙNG id thật
 * (không phải email, tránh lệch khi user đổi email).
 */
export function getIdentityNamespace() {
  const info = getUserInfo();
  return info && info.id != null ? `user:${info.id}` : 'guest';
}

export default userApi;
