
import { Outlet, useLocation } from 'react-router-dom'
import SiteHeader from '../components/SiteHeader'
import BottomTabBar from '../components/BottomTabBar'

/**
 * Layout cho toàn bộ trang guest (public):
 * SiteHeader + nội dung + BottomTabBar (mobile) + footer.
 * Route đọc truyện (/read/) chỉ render nội dung — không tab bar, không footer.
 */
export default function GuestLayout() {
  const location = useLocation()
  const isReaderPage = /^\/novel\/[^/]+\/(?:read\/[^/]+|epub-reader)\/?$/.test(location.pathname)

  if (isReaderPage) {
    // Reader toàn màn hình: tự quản lý theme nền + nav riêng (có nút Home),
    // không header / tab bar / footer để giữ trải nghiệm đọc immersive.
    return <Outlet />
  }

  // Skip-link: tự focus <main> thay vì đổi hash URL (tránh để lại "#main-content"
  // trên thanh địa chỉ của SPA).
  const skipToContent = (e) => {
    const main = document.getElementById('main-content')
    if (!main) return
    e.preventDefault()
    main.focus()
    main.scrollIntoView({ block: 'start' })
  }

  return (
    <>
      <a href="#main-content" className="skip-link" onClick={skipToContent}>
        Bỏ qua tới nội dung
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="guest-main has-tab-bar">
        <Outlet />
      </main>
      <footer className="app-footer">
        <div className="app-footer__text">
          Hắc Đạo Truyện &copy; 2026 • Dịch truyện bằng AI
        </div>
      </footer>
      <BottomTabBar />
    </>
  )
}
