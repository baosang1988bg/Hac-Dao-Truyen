import PropTypes from 'prop-types'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import userApi, {
  AUTH_CHANGE_EVENT, clearUserSession, getUserInfo, isLoggedIn,
} from '../userApi'
import { AuthContext } from './useAuth'
import { createLoginGate } from '../utils/loginGate'
import { runAuthMerge } from '../utils/authMerge'
import { fetchMe, logoutServer } from '../utils/authApi'
import { getAllHistory, getReadParagraph } from '../utils/readingHistory'
import { startPrefsSync } from '../utils/prefsSyncClient'
import { trackEvent } from '../utils/analytics'
import { runWhenIdle } from '../utils/idle'
import { lazyWithReload } from '../utils/lazyWithReload'

// Hộp đăng nhập chỉ tải khi cần (đa số khách không mở) — giữ bundle trang chủ nhẹ.
const LoginDialog = lazyWithReload(() => import('../components/LoginDialog'))

function readUser() {
  return isLoggedIn() ? getUserInfo() : null
}

// Chống chạy gộp 2 lần song song cho cùng user (StrictMode gọi effect 2 lần,
// hoặc đăng nhập liên tiếp) — cờ authMerged chỉ được đặt khi chạy xong.
const mergeInFlight = new Set()

function mergeLocalHistory(userId) {
  if (userId == null || mergeInFlight.has(userId)) return
  mergeInFlight.add(userId)
  runAuthMerge(userId, {
    storage: window.localStorage,
    getLocalHistory: () => getAllHistory().slice(0, 50).map(h => ({
      ...h,
      paragraph: getReadParagraph(h.slug, h.chapter),
    })),
    fetchProgress: () => userApi.get('/user/progress').then(res => res.data),
    putProgress: (slug, body) => userApi.put(`/user/progress/${encodeURIComponent(slug)}`, body),
  })
    .catch(() => { /* lỗi mạng khi lấy tiến độ — chưa đặt cờ, lần sau thử lại */ })
    .finally(() => mergeInFlight.delete(userId))
}

/**
 * AuthProvider — trạng thái đăng nhập dùng chung cho toàn app (header, bình
 * luận, theo dõi, góp ý name, yêu cầu truyện, trang Tài khoản).
 * - Nguồn sự thật vẫn là localStorage (userToken/userInfo, xem userApi.js):
 *   nghe AUTH_CHANGE_EVENT (cùng tab) + `storage` (tab khác) để đồng bộ.
 * - requireLogin(reason): đã đăng nhập → resolve ngay; chưa → mở LoginDialog,
 *   đăng nhập xong resolve(user) để nơi gọi chạy tiếp thao tác đang dở; đóng
 *   hộp → reject (code LOGIN_CANCELLED, xem utils/loginGate.js).
 * - Sau khi có user (đăng nhập mới hoặc phiên cũ): kéo prefs đọc + gộp lịch sử
 *   đọc local lên tài khoản đúng 1 lần / máy (utils/authMerge.js).
 */
export default function AuthProvider({ children }) {
  const [user, setUser] = useState(readUser)
  const [dialog, setDialog] = useState({ open: false, reason: null })
  const gateRef = useRef(null)
  if (!gateRef.current) gateRef.current = createLoginGate(setDialog)

  // Đọc lại phiên từ localStorage; giữ nguyên object nếu nội dung không đổi
  // (tránh render lại cả cây khi sự kiện bắn mà dữ liệu y hệt).
  const syncFromStorage = useCallback(() => {
    const next = readUser()
    setUser(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    return next
  }, [])

  useEffect(() => {
    const onStorage = (e) => {
      // e.key === null: tab khác gọi localStorage.clear()
      if (e.key === null || e.key === 'userToken' || e.key === 'userInfo') syncFromStorage()
    }
    window.addEventListener(AUTH_CHANGE_EVENT, syncFromStorage)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, syncFromStorage)
      window.removeEventListener('storage', onStorage)
    }
  }, [syncFromStorage])

  // Đăng nhập ở TAB KHÁC trong lúc hộp đăng nhập tab này đang mở → coi như xong.
  useEffect(() => {
    if (user && gateRef.current.pendingCount() > 0) gateRef.current.resolveAll(user)
  }, [user])

  const refreshMe = useCallback(async () => {
    if (!isLoggedIn()) return null
    try {
      await fetchMe()
    } catch { /* 401 → interceptor đã xoá phiên; lỗi mạng → giữ thông tin cũ */ }
    return syncFromStorage()
  }, [syncFromStorage])

  // Có user (mới đăng nhập hoặc phiên cũ từ lần trước) → việc nền khi rảnh.
  const userId = user?.id ?? null
  const needsMe = Boolean(user) && !Object.prototype.hasOwnProperty.call(user, 'has_password')
  useEffect(() => {
    if (userId == null) return undefined
    return runWhenIdle(() => {
      startPrefsSync()
      mergeLocalHistory(userId)
      // Phiên đăng nhập từ bản cũ chưa có avatar/has_password → hỏi /user/me 1 lần.
      if (needsMe) refreshMe()
    }, { timeout: 4000 })
  }, [userId, needsMe, refreshMe])

  const completeLogin = useCallback((loggedInUser) => {
    const current = syncFromStorage() || loggedInUser || null
    if (current) gateRef.current.resolveAll(current)
  }, [syncFromStorage])

  const requireLogin = useCallback((reason, { feature } = {}) => {
    const current = readUser()
    if (current) return Promise.resolve(current)
    // Phễu "muốn làm X nhưng chưa có tài khoản" → đo tỉ lệ đăng nhập.
    if (feature) trackEvent('login_prompt', { feature })
    return gateRef.current.request(reason || null)
  }, [])

  const openLogin = useCallback((reason) => {
    requireLogin(reason).catch(() => { /* người dùng đóng hộp */ })
  }, [requireLogin])

  const cancelLogin = useCallback(() => { gateRef.current.rejectAll() }, [])

  const endLocalSession = useCallback(() => {
    clearUserSession()
    syncFromStorage()
  }, [syncFromStorage])

  const logout = useCallback(async () => {
    await logoutServer()
    trackEvent('logout') // gửi TRƯỚC khi xoá user_id → event còn gắn đúng người
    endLocalSession()
  }, [endLocalSession])

  const value = useMemo(() => ({
    user, requireLogin, openLogin, completeLogin, refreshMe, logout, endLocalSession,
  }), [user, requireLogin, openLogin, completeLogin, refreshMe, logout, endLocalSession])

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialog.open && (
        <Suspense fallback={null}>
          <LoginDialog reason={dialog.reason} onClose={cancelLogin} onSuccess={completeLogin} />
        </Suspense>
      )}
    </AuthContext.Provider>
  )
}
AuthProvider.propTypes = {
  children: PropTypes.node,
}
