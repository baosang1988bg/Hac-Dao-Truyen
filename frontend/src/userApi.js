import axios from 'axios';

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
    if (status === 401 && !url.includes('/user/login') && !url.includes('/user/register')) {
      localStorage.removeItem('userToken');
      localStorage.removeItem('userInfo');
    }
    return Promise.reject(err);
  }
);

/** Lưu phiên user sau khi login/register thành công. */
export function saveUserSession(token, user) {
  localStorage.setItem('userToken', token);
  localStorage.setItem('userInfo', JSON.stringify(user || null));
}

/** Xóa phiên user tại chỗ (logout phía client). */
export function clearUserSession() {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userInfo');
}

/** Thông tin user đã đăng nhập ({id,email,name}) hoặc null. */
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

export default userApi;
