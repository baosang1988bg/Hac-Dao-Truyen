import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LogIn, LogOut, User } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import UserAvatar from './UserAvatar'

/**
 * Góc phải header (desktop):
 * - Chưa đăng nhập: nút "Đăng nhập" mở LoginDialog (requireLogin).
 * - Đã đăng nhập: nút avatar mở menu nhỏ (Tài khoản, Đăng xuất).
 * Menu dạng disclosure (button aria-expanded + danh sách link/nút) — đóng khi
 * bấm ra ngoài, Escape (trả focus về nút avatar) hoặc đổi trang.
 */
export default function UserMenu() {
  const { user, openLogin, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const btnRef = useRef(null)
  const menuId = useId()
  const { pathname } = useLocation()

  useEffect(() => { setOpen(false) }, [pathname, user?.id])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) {
    return (
      <button type="button" className="site-header__navlink user-menu__login hd-press" onClick={() => openLogin(null)}>
        <LogIn size={16} aria-hidden="true" /> Đăng nhập
      </button>
    )
  }

  const displayName = user.name || user.email || 'Tài khoản'

  const onLogout = async () => {
    setOpen(false)
    // Ở lại trang hiện tại: các khối phụ thuộc đăng nhập tự cập nhật qua AuthContext.
    await logout()
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="user-menu__trigger hd-press"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Tài khoản: ${displayName}`}
        onClick={() => setOpen(v => !v)}
      >
        <UserAvatar user={user} size={32} />
      </button>
      {open && (
        <div id={menuId} className="user-menu__panel glass-panel">
          <div className="user-menu__who">
            <div className="user-menu__name">{user.name || 'Đạo hữu ẩn danh'}</div>
            {user.email && <div className="user-menu__email">{user.email}</div>}
          </div>
          <Link to="/account" className="user-menu__item">
            <User size={16} aria-hidden="true" /> Tài khoản
          </Link>
          <button type="button" className="user-menu__item" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" /> Đăng xuất
          </button>
        </div>
      )}
    </div>
  )
}
