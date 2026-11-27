import { useEffect } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, Home, Library, Shield, LogIn, BookMarked, Search, Sparkles } from 'lucide-react'
import useHideOnScroll from '../hooks/useHideOnScroll'
import UserMenu from './UserMenu'

/**
 * Header trang guest.
 * - Desktop: logo + nav (Trang chủ / Mới cập nhật / Tủ truyện / Kho EPUB) + góc phải
 *   UserMenu (avatar + menu Tài khoản/Đăng xuất, hoặc nút "Đăng nhập" mở hộp
 *   đăng nhập dùng chung) + Quản trị (admin) hoặc icon đăng nhập quản trị.
 * - Mobile (<769px): thanh mỏng dính đỉnh (sticky), tự ẩn khi cuộn xuống và
 *   hiện lại khi cuộn lên; có nút Tìm kiếm (+ Quản trị nếu là admin). Điều hướng
 *   chính nằm ở BottomTabBar.
 */
export default function SiteHeader() {
  const isAdmin = localStorage.getItem('userRole') === 'admin'
  const hidden = useHideOnScroll()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Báo cho các khối sticky khác (qua biến --hd-header-h) biết header đang ẩn.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('hd-header-hidden', hidden)
    return () => root.classList.remove('hd-header-hidden')
  }, [hidden])

  const navCls = ({ isActive }) => `site-header__navlink${isActive ? ' active' : ''}`

  // Nút tìm kiếm: về trang chủ và focus ô tìm kiếm (HomePage đọc state.focusSearch).
  // Đang ở trang chủ thì focus ngay, không cần điều hướng.
  const openSearch = () => {
    if (pathname === '/') {
      const input = document.querySelector('.hp-search-input')
      if (input) {
        input.focus()
        input.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      }
    }
    navigate('/', { state: { focusSearch: true } })
  }

  return (
    <header className={`site-header${hidden ? ' is-hidden' : ''}`}>
      <div className="site-header__inner">
        <Link to="/" className="site-header__logo">
          <span className="site-header__logo-mark">
            <BookOpen size={17} color="white" />
          </span>
          {/* Khoảng trắng tách "Hắc Đạo" và "Truyện" (trước đây dính thành "Hắc ĐạoTruyện"). */}
          <span>Hắc Đạo{' '}<span style={{ color: 'var(--accent)' }}>Truyện</span></span>
        </Link>

        <nav className="site-header__nav" aria-label="Điều hướng trang">
          <NavLink to="/" end className={navCls}>
            <Home size={16} /> Trang chủ
          </NavLink>
          <NavLink to="/cap-nhat" className={navCls}>
            <Sparkles size={16} /> Mới cập nhật
          </NavLink>
          <NavLink to="/library" className={navCls}>
            <Library size={16} /> Tủ truyện
          </NavLink>
          <NavLink to="/epub" className={navCls}>
            <BookMarked size={16} /> Kho EPUB
          </NavLink>
        </nav>

        {/* Mobile: nút hành động gọn bên phải */}
        <div className="site-header__mobile-actions">
          <button type="button" className="site-header__icon-btn hd-press" onClick={openSearch} aria-label="Tìm kiếm truyện">
            <Search size={20} aria-hidden="true" />
          </button>
          {isAdmin && (
            <Link to="/admin" className="site-header__icon-btn hd-press" aria-label="Quản trị" style={{ color: 'var(--accent)' }}>
              <Shield size={19} aria-hidden="true" />
            </Link>
          )}
        </div>

        <div className="site-header__right">
          <UserMenu />
          {isAdmin ? (
            <Link to="/admin" className="site-header__navlink" style={{ color: 'var(--accent)' }}>
              <Shield size={15} /> Quản trị
            </Link>
          ) : (
            // Khách không cần lối vào quản trị nổi bật: chỉ còn icon nhỏ, mờ —
            // vẫn truy cập được bằng chuột/bàn phím/trình đọc màn hình.
            <Link
              to="/login"
              className="site-header__navlink site-header__admin-login"
              title="Đăng nhập quản trị"
              aria-label="Đăng nhập quản trị"
            >
              <LogIn size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
