import PropTypes from 'prop-types'
import { useEffect, useRef, useState } from 'react'
import { fetchGoogleNonce, googleAuth } from '../utils/authApi'
import { googleLoginErrorMessage, ONE_TAP_DISMISSED_KEY } from '../utils/authHelpers'
import '../styles/library-epub.css'

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
// Sau khi bấm nút mà chưa thấy kết quả trong khoảng này → gợi ý kiểm tra popup bị chặn.
const POPUP_HINT_MS = 7000

/** Có cấu hình đăng nhập Google hay không (nơi gọi dùng để ẩn dải "hoặc"). */
export const GOOGLE_LOGIN_ENABLED = Boolean(CLIENT_ID)
export const GOOGLE_CLIENT_ID = CLIENT_ID

let gisLoadPromise = null

/*
 * GIS chỉ giữ MỘT cấu hình initialize (một callback) cho cả trang, nhưng trang
 * Tài khoản có thể có nhiều nút Google cùng lúc (liên kết / xác nhận đặt mật
 * khẩu / xác nhận xoá tài khoản). Mọi instance đăng ký cùng một callback điều
 * phối: credential chuyển cho instance vừa được BẤM (click_listener), nếu không
 * có (One Tap) thì cho instance khởi tạo sau cùng.
 */
const mountedHandlers = []
let clickedHandler = null

function dispatchCredential(response) {
  const handler = clickedHandler || mountedHandlers[mountedHandlers.length - 1]
  clickedHandler = null
  handler?.(response)
}

function registerHandler(handler) {
  const i = mountedHandlers.indexOf(handler)
  if (i >= 0) mountedHandlers.splice(i, 1)
  mountedHandlers.push(handler) // khởi tạo sau cùng → ưu tiên cho One Tap
}

function unregisterHandler(handler) {
  const i = mountedHandlers.indexOf(handler)
  if (i >= 0) mountedHandlers.splice(i, 1)
  if (clickedHandler === handler) clickedHandler = null
}

/** Tải script Google Identity Services đúng 1 lần, dùng lại cho các lần render sau. */
function loadGisScript() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (gisLoadPromise) return gisLoadPromise
  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => (window.google?.accounts?.id ? resolve() : reject(new Error('GIS không khởi tạo')))
    script.onerror = () => {
      gisLoadPromise = null // cho phép thử lại ở lần mở hộp sau
      reject(new Error('Không tải được Google Identity Services'))
    }
    document.head.appendChild(script)
  })
  return gisLoadPromise
}

function markOneTapDismissed() {
  try { localStorage.setItem(ONE_TAP_DISMISSED_KEY, '1') } catch { /* storage bị chặn */ }
}

/**
 * Nút "Đăng nhập bằng Google" (Google Identity Services — không thêm thư viện
 * npm nào, dùng script GSI chính thức của Google).
 * - Ẩn hoàn toàn nếu chưa cấu hình VITE_GOOGLE_CLIENT_ID.
 * - Trước mỗi lần initialize: lấy nonce dùng-một-lần từ GET /user/google-nonce
 *   (lỗi/404 → bỏ nonce, vẫn chạy). Đăng nhập lỗi → lấy nonce mới, khởi tạo lại.
 * - oneTap: hiện thêm lời nhắc One Tap (FedCM — use_fedcm_for_prompt). Người
 *   dùng đóng/bỏ qua → ghi localStorage.oneTapDismissed để không hỏi lại.
 * - hideButton: chỉ chạy One Tap, không vẽ nút (dùng ở trang chủ).
 * - mode="credential": KHÔNG đăng nhập — chỉ lấy id_token Google rồi gọi
 *   onCredential(credential) (liên kết Google, xác nhận lại trước thao tác
 *   nhạy cảm). onCredential tự gọi API + tự hiện lỗi; nút vẫn lấy nonce mới
 *   sau mỗi lần dùng vì nonce chỉ dùng được một lần.
 * Nhiều nút cùng trang: xem dispatchCredential ở trên.
 */
export default function GoogleLoginButton({
  onSuccess, onError, oneTap = false, hideButton = false,
  mode = 'login', onCredential, busyText,
}) {
  const containerRef = useRef(null)
  const cbRef = useRef({ onSuccess, onError, onCredential })
  const credentialMode = mode === 'credential'

  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [popupHint, setPopupHint] = useState(false)

  useEffect(() => { cbRef.current = { onSuccess, onError, onCredential } })

  useEffect(() => {
    if (!CLIENT_ID) return undefined
    let alive = true
    let hintTimer = null

    const handleCredentialResponse = async (response) => {
      clearTimeout(hintTimer)
      if (alive) { setPopupHint(false); setBusy(true); setError(null) }
      if (credentialMode) {
        // Chỉ chuyển credential cho nơi gọi (không lưu phiên). Lỗi do nơi gọi hiển thị.
        try {
          await cbRef.current.onCredential?.(response?.credential || '')
        } catch (err) {
          cbRef.current.onError?.(err)
        } finally {
          if (alive) {
            setBusy(false)
            // Nonce vừa gửi đã bị tiêu → khởi tạo lại với nonce mới để bấm lại được.
            setup().catch(() => {})
          }
        }
        return
      }
      try {
        const user = await googleAuth(response?.credential)
        // Gọi cả khi đã unmount: phiên đã lưu, AuthContext vẫn cần giải phóng
        // các thao tác đang chờ đăng nhập.
        cbRef.current.onSuccess?.(user)
      } catch (err) {
        const msg = googleLoginErrorMessage(err)
        if (alive) setError(msg)
        cbRef.current.onError?.(err, msg)
        // Nonce đã bị tiêu (dùng một lần) → khởi tạo lại với nonce mới để bấm lại được.
        if (alive) setup().catch(() => {})
      } finally {
        if (alive) setBusy(false)
      }
    }

    async function setup() {
      await loadGisScript()
      const nonce = await fetchGoogleNonce()
      if (!alive) return
      const gid = window.google.accounts.id
      registerHandler(handleCredentialResponse)
      const config = {
        client_id: CLIENT_ID,
        callback: dispatchCredential,
        // One Tap qua FedCM (Chrome bỏ cookie bên thứ ba) — bắt buộc theo hướng dẫn GIS mới.
        use_fedcm_for_prompt: true,
        cancel_on_tap_outside: true,
        context: credentialMode ? 'use' : 'signin',
        itp_support: true,
      }
      if (nonce) config.nonce = nonce
      gid.initialize(config)
      if (!hideButton && containerRef.current) {
        // GSI nhận width cố định (px, 200–400): lấy theo bề rộng khung chứa để
        // nút không tràn ngang trên điện thoại hẹp (320–360px).
        const boxWidth = Math.floor(containerRef.current.getBoundingClientRect().width) || 320
        gid.renderButton(containerRef.current, {
          theme: 'outline', size: 'large', width: Math.max(200, Math.min(400, boxWidth)),
          text: 'continue_with', locale: 'vi', shape: 'pill',
          // Không biết popup có bị chặn hay không (GIS không báo) → sau vài giây
          // chưa có kết quả thì hiện gợi ý.
          click_listener: () => {
            if (!alive) return
            // Credential sắp trả về thuộc về nút này (không phải nút khởi tạo sau cùng).
            clickedHandler = handleCredentialResponse
            setError(null)
            setPopupHint(false)
            clearTimeout(hintTimer)
            hintTimer = setTimeout(() => { if (alive) setPopupHint(true) }, POPUP_HINT_MS)
          },
        })
      }
      if (oneTap && !credentialMode) {
        gid.prompt((notification) => {
          try {
            const dismissed = notification?.isDismissedMoment?.()
              && notification?.getDismissedReason?.() !== 'credential_returned'
            if (dismissed || notification?.isSkippedMoment?.()) markOneTapDismissed()
          } catch { /* FedCM bỏ bớt API thông báo — bỏ qua */ }
        })
      }
      setReady(true)
    }

    setup().catch(() => {
      if (alive && !hideButton) {
        setError(credentialMode
          ? 'Không tải được nút Google (mạng chậm hoặc trình chặn quảng cáo). Tải lại trang rồi thử lại.'
          : 'Không tải được nút Google (mạng chậm hoặc trình chặn quảng cáo). Bạn vẫn đăng nhập bằng email được.')
      }
    })

    return () => {
      alive = false
      clearTimeout(hintTimer)
      unregisterHandler(handleCredentialResponse)
      if (oneTap) { try { window.google?.accounts?.id?.cancel() } catch { /* bỏ qua */ } }
    }
    // Khởi tạo đúng 1 lần mỗi lần mount; callback mới nhất đọc qua cbRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!CLIENT_ID || hideButton) return null

  return (
    <div className="google-login">
      <div ref={containerRef} className="google-login__btn" aria-busy={!ready || busy} />
      {busy && (
        <div className="google-login__status" role="status">
          {busyText || (credentialMode ? 'Đang xác nhận với Google...' : 'Đang đăng nhập bằng Google...')}
        </div>
      )}
      {popupHint && !error && !busy && (
        <div className="google-login__status" role="status">
          Không thấy cửa sổ Google? Hãy cho phép cửa sổ bật lên (popup) cho trang này rồi bấm lại.
        </div>
      )}
      {error && <div className="auth-error google-login__error" role="alert">{error}</div>}
    </div>
  )
}
GoogleLoginButton.propTypes = {
  onSuccess: PropTypes.func,
  onError: PropTypes.func,
  oneTap: PropTypes.bool,
  hideButton: PropTypes.bool,
  mode: PropTypes.oneOf(['login', 'credential']),
  onCredential: PropTypes.func,
  busyText: PropTypes.string,
}
