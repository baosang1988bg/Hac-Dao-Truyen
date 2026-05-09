import axios from 'axios';

// Dùng relative URL để hoạt động ở cả local (Vite proxy) lẫn production (Cloudflare Worker)
const api = axios.create({
  baseURL: '/api',
});

export default api;
