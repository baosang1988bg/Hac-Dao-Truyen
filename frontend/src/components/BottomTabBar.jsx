import React from 'react'
import { NavLink, Link } from 'react-router-dom'
import { Home, Library, User, Shield } from 'lucide-react'

/**
 * Tab bar dưới cùng — chỉ hiện trên mobile (<769px, ẩn bằng CSS).
 * Tab: Trang chủ / Tủ truyện / Tôi (/account — tài khoản người dùng).
 * Admin có thêm tab Quản trị. GuestLayout không render component này
 * trên route đọc truyện.
 */
export default function BottomTabBar() {
  const isAdmin = localStorage.getItem('userRole') === 'admin'

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
      <NavLink to="/account" className={cls}>
        <User size={21} />
        <span>Tôi</span>
      </NavLink>
      {isAdmin && (
        <Link to="/admin" className="tab-item">
          <Shield size={21} />
          <span>Quản trị</span>
        </Link>
      )}
    </nav>
  )
}
