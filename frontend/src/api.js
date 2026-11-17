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

// Instance KHÔNG gắn Authorization, dành cho dữ liệu công khai của phía khách
// (danh sách truyện, mục lục, nội dung chương, thống kê...). Worker bỏ qua
// edge cache với MỌI request có header Authorization (đọc thẳng D1/R2), nên
// trước đây admin đã đăng nhập lướt trang khách là mỗi request đều tốn D1.
// Dữ liệu các route này không phụ thuộc người gọi → không cần gửi token.
// Trang quản trị vẫn dùng `api` (có token) để luôn thấy dữ liệu mới nhất.
export const publicApi = axios.create({
  baseURL: '/api',
});

// CẢNH BÁO CHI PHÍ: hàm này tải HẾT catalog (mỗi trang 200 truyện, có token
// admin nên Worker bỏ qua edge cache). Với hàng chục nghìn truyện là hàng trăm
// request liên tiếp, mỗi request đọc D1 trực tiếp → dễ chạm rate limit và hạn
// mức đọc D1. KHÔNG gọi khi mở trang; trang tổng quan đã chuyển sang
// GET /api/stats. Chỉ giữ lại cho công cụ xuất dữ liệu chạy theo yêu cầu.
export async function fetchAdminNovels() {
  const novels = new Map();
  let page = 1;
  let pages = 1;
  do {
    const { data } = await api.get('/novels', { params: { page, limit: 200 } });
    if (Array.isArray(data)) return data;
    if (!Array.isArray(data?.novels) || !Number.isInteger(data.pages) || data.pages < 0) {
      throw new Error('Phản hồi danh sách truyện không hợp lệ');
    }
    pages = data.pages;
    for (const novel of data.novels) novels.set(novel.slug, novel);
    page += 1;
  } while (page <= pages);
  return [...novels.values()];
}
