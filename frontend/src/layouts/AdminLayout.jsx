import React, { useEffect, useState } from 'react'
import { NavLink, Link, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  BookOpen, LayoutDashboard, Library, ScrollText,
  ExternalLink, Menu, LogOut,
} from 'lucide-react'

/**
 * Layout khu vực quản trị:
 * - Desktop (≥900px): sidebar trái 240px sticky.
 * - Mobile (<900px): sidebar thành drawer off-canvas + overlay, mở bằng hamburger.
 * - Topbar 56px sticky: hamburger (mobile) + badge ADMIN + nút đăng xuất.
 * - KHÔNG có bottom tab bar trong admin.
 */
export default function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Đóng drawer mỗi khi đổi trang
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  const handleLogout = () => {
    const token = localStorage.getItem('authToken')
    localStorage.removeItem('authToken')
    localStorage.removeItem('userRole')
    // Best-effort: báo backend hủy token, không chờ kết quả
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})
    }
    navigate('/login')
  }

  const linkCls = ({ isActive }) => `admin-sidebar__link${isActive ? ' active' : ''}`

  return (
    <div className="admin-shell">
      {/* Overlay drawer (mobile) */}
      {drawerOpen && (
        <div className="admin-drawer-overlay" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Sidebar / drawer */}
      <aside className={`admin-sidebar${drawerOpen ? ' is-open' : ''}`}>
        <Link to="/admin" className="admin-sidebar__brand">
          <span style={{
            background: 'var(--accent-gradient)', padding: '7px', borderRadius: '9px',
            display: 'inline-flex', alignItems: 'center',
          }}>
            <BookOpen size={18} color="white" />
          </span>
          <span>Hắc Đạo<span style={{ color: 'var(--accent)' }}>Truyện</span></span>
        </Link>

        <NavLink to="/admin" end className={linkCls}>
          <LayoutDashboard size={17} /> Tổng quan
        </NavLink>
        <NavLink to="/admin/novels" className={linkCls}>
          <Library size={17} /> Truyện
        </NavLink>
        <NavLink to="/admin/logs" className={linkCls}>
          <ScrollText size={17} /> Nhật ký
        </NavLink>

        <div className="admin-sidebar__divider" />

        <Link to="/" className="admin-sidebar__link">
          <ExternalLink size={17} /> Xem trang guest
        </Link>
      </aside>

      {/* Nội dung chính */}
      <div className="admin-content">
        <div className="admin-topbar">
          <button
            className="icon-btn admin-topbar__hamburger"
            onClick={() => setDrawerOpen(v => !v)}
            aria-label="Mở menu"
          >
            <Menu size={22} />
          </button>
          <div style={{ flex: 1 }} />
          <span className="admin-topbar__badge">ADMIN</span>
          <button
            className="icon-btn"
            onClick={handleLogout}
            title="Đăng xuất"
            aria-label="Đăng xuất"
          >
            <LogOut size={19} />
          </button>
        </div>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
