import React from 'react'
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
  const isReaderPage = location.pathname.includes('/read/')

  if (isReaderPage) {
    // Reader toàn màn hình: tự quản lý theme nền + nav riêng (có nút Home),
    // không header / tab bar / footer để giữ trải nghiệm đọc immersive.
    return <Outlet />
  }

  return (
    <>
      <SiteHeader />
      <main className="guest-main has-tab-bar">
        <Outlet />
      </main>
      <footer className="app-footer">
        <div style={{ opacity: 0.3, fontSize: '0.8rem' }}>
          Hắc Đạo Truyện &copy; 2026 • Dịch truyện bằng AI
        </div>
      </footer>
      <BottomTabBar />
    </>
  )
}
