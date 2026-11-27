import { NavLink } from 'react-router-dom'
import { Home, Library, User, BookMarked, Sparkles } from 'lucide-react'
import { useUnseenUpdates } from '../hooks/useUpdatesFeed'
import { useAuth } from '../context/useAuth'
import UserAvatar from './UserAvatar'

/**
 * Tab bar dưới cùng — chỉ hiện trên mobile (<769px, ẩn bằng CSS).
 * Tab: Trang chủ / Mới (nhật ký cập nhật, có chấm đỏ khi có chương mới chưa xem)
 * / Tủ truyện / EPUB / Tôi. Lối vào Quản trị cho admin nằm ở SiteHeader (icon
 * khiên) để tab bar không bị chật 6 mục trên màn hình 360px.
 * GuestLayout không render component này trên route đọc truyện.
 * Tab "Tôi": đã đăng nhập → hiện avatar (ảnh Google hoặc chữ cái đầu) thay icon.
 */
const TABS = [
  { to: '/', end: true, icon: Home, label: 'Trang chủ' },
  { to: '/cap-nhat', icon: Sparkles, label: 'Mới', badgeKey: 'updates' },
  { to: '/library', icon: Library, label: 'Tủ truyện' },
  { to: '/epub', icon: BookMarked, label: 'EPUB' },
  { to: '/account', icon: User, label: 'Tôi' },
]

export default function BottomTabBar() {
  const { hasUnseen } = useUnseenUpdates()
  const { user } = useAuth()

  const cls = ({ isActive }) => `tab-item${isActive ? ' active' : ''}`

  return (
    <nav className="bottom-tab-bar" aria-label="Điều hướng chính">
      {TABS.map(({ to, end, icon: Icon, label, badgeKey }) => {
        const showBadge = badgeKey === 'updates' && hasUnseen
        const showAvatar = to === '/account' && user
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={cls}
            aria-label={showBadge ? `${label} (có chương mới)` : undefined}
          >
            <span className="tab-item__icon">
              {showAvatar ? <UserAvatar user={user} size={24} className="tab-item__avatar" /> : <Icon size={21} aria-hidden="true" />}
              {showBadge && <span className="tab-item__badge" aria-hidden="true" />}
            </span>
            <span>{label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
