import React from 'react'
import { Link, NavLink } from 'react-router-dom'
import { BookOpen, Home, Library, Shield, LogIn, User } from 'lucide-react'

/**
 * Header trang guest.
 * - Desktop: logo + nav (Trang chủ / Tủ truyện) + góc phải Quản trị (admin) hoặc Đăng nhập.
 * - Mobile (<769px): thanh mỏng chỉ có logo (điều hướng nằm ở BottomTabBar).
 */
export default function SiteHeader() {
  const isAdmin = localStorage.getItem('userRole') === 'admin'

  const navCls = ({ isActive }) => `site-header__navlink${isActive ? ' active' : ''}`

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-header__logo">
          <span style={{
            background: 'var(--accent-gradient)', padding: '6px', borderRadius: '8px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BookOpen size={17} color="white" />
          </span>
          <span>Hắc Đạo<span style={{ color: 'var(--accent)' }}>Truyện</span></span>
        </Link>

        <nav className="site-header__nav">
          <NavLink to="/" end className={navCls}>
            <Home size={16} /> Trang chủ
          </NavLink>
          <NavLink to="/library" className={navCls}>
            <Library size={16} /> Tủ truyện
          </NavLink>
        </nav>

        <div className="site-header__right">
          <NavLink to="/account" className={navCls} title="Tài khoản">
            <User size={16} /> Tài khoản
          </NavLink>
          {isAdmin ? (
            <Link to="/admin" className="site-header__navlink" style={{ color: 'var(--accent)' }}>
              <Shield size={15} /> Quản trị
            </Link>
          ) : (
            <Link to="/login" className="site-header__navlink" style={{ opacity: 0.7, fontSize: '0.82rem' }}>
              <LogIn size={14} /> Admin
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
