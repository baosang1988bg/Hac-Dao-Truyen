import axios from 'axios';

// Dùng relative URL để hoạt động ở cả local (Vite proxy) lẫn production (Cloudflare Worker)
const api = axios.create({
  baseURL: '/api',
});

// Gắn Bearer token (nếu có) vào mọi request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Token hết hạn / không hợp lệ → xóa phiên admin và quay về trang đăng nhập.
// Bỏ qua 401 của chính /auth/login (nhập sai mật khẩu) để LoginPage tự hiển thị lỗi.
api.interceptors.response.use(
  res => res,
  err => {
    const status = err.response?.status;
    const url = err.config?.url || '';
    if (status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem('authToken');
      localStorage.removeItem('userRole');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
