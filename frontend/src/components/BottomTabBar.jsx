import React from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { Home, Library, User } from 'lucide-react'

/**
 * Tab bar dưới cùng — chỉ hiện trên mobile (<769px, ẩn bằng CSS).
 * 3 tab: Trang chủ / Tủ truyện / Tài khoản (admin → /admin, guest → /login).
 * GuestLayout không render component này trên route đọc truyện.
 */
export default function BottomTabBar() {
  const location = useLocation()
  const isAdmin = localStorage.getItem('userRole') === 'admin'
  const accountTo = isAdmin ? '/admin' : '/login'

  const cls = ({ isActive }) => `tab-item${isActive ? ' active' : ''}`

  return (
    <nav className="bottom-tab-bar" aria-label="Điều hướng chính">
      <NavLink to="/" end className={cls}>
        <Home size={21} />
        <span>Trang chủ</span>
      </NavLink>
      <NavLink to="/library" className={cls}>
        <Library size={21} />
        <span>Tủ truyện</span>
      </NavLink>
      <Link
        to={accountTo}
        className={`tab-item${location.pathname.startsWith('/login') ? ' active' : ''}`}
      >
        <User size={21} />
        <span>Tài khoản</span>
      </Link>
    </nav>
  )
}
