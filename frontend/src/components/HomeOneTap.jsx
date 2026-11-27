import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import GoogleLoginButton, { GOOGLE_CLIENT_ID } from './GoogleLoginButton'
import { getAllHistory, getReadChapters } from '../utils/readingHistory'
import { countReadChapters, shouldShowOneTap, ONE_TAP_DISMISSED_KEY } from '../utils/authHelpers'
import { runWhenIdle } from '../utils/idle'

function readEligibility(loggedIn) {
  let dismissed = false
  try { dismissed = localStorage.getItem(ONE_TAP_DISMISSED_KEY) === '1' } catch { /* storage bị chặn */ }
  // Chỉ đếm khi các điều kiện rẻ đã qua (tránh duyệt localStorage vô ích).
  if (!GOOGLE_CLIENT_ID || loggedIn || dismissed) return false
  const chaptersRead = countReadChapters(getAllHistory().map(h => [...getReadChapters(h.slug)]))
  return shouldShowOneTap({ clientId: GOOGLE_CLIENT_ID, loggedIn, chaptersRead, dismissed })
}

/**
 * Google One Tap ở trang chủ — chỉ cho người đọc thật: chưa đăng nhập, đã đọc
 * ≥ 2 chương, chưa tự tắt (localStorage.oneTapDismissed), có CLIENT_ID.
 * Đợi trình duyệt rảnh mới tải script Google để không giành tài nguyên với
 * nội dung trang chủ. Không render gì ra DOM (GIS tự vẽ lời nhắc).
 */
export default function HomeOneTap() {
  const { user, completeLogin } = useAuth()
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (user) return undefined
    return runWhenIdle(() => setArmed(readEligibility(false)), { timeout: 5000, fallbackDelay: 2000 })
  }, [user])

  if (!armed || user) return null
  return <GoogleLoginButton oneTap hideButton onSuccess={completeLogin} />
}
