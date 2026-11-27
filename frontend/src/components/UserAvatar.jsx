import PropTypes from 'prop-types'
import { useState } from 'react'
import { avatarInitial, safeAvatarUrl } from '../utils/authHelpers'

/**
 * Avatar người dùng: ảnh Google (avatar_url https) hoặc chữ cái đầu của tên/email.
 * Ảnh lỗi (hết hạn, bị chặn) → tự quay về chữ cái. referrerPolicy no-referrer:
 * ảnh lh3.googleusercontent.com đôi khi trả 403 khi có Referer.
 * Trang trí thuần (aria-hidden) — nơi dùng tự đặt nhãn cho nút/link bao ngoài.
 */
export default function UserAvatar({ user, size = 32, className = '' }) {
  const url = safeAvatarUrl(user)
  const [failedUrl, setFailedUrl] = useState(null)
  const showImg = url && failedUrl !== url
  return (
    <span
      className={`user-avatar ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-hidden="true"
    >
      {showImg
        ? <img src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailedUrl(url)} />
        : avatarInitial(user)}
    </span>
  )
}
UserAvatar.propTypes = {
  user: PropTypes.object,
  size: PropTypes.number,
  className: PropTypes.string,
}
