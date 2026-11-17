import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/motion.css'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { initReveal } from './utils/motion'

// Bật hiệu ứng xuất hiện-khi-cuộn (.hd-reveal) — tự bỏ qua nếu giảm chuyển động.
initReveal()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Đăng ký service worker (PWA + đọc offline) — chỉ ở bản build production
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.error('Đăng ký service worker thất bại:', err))
  })
}
