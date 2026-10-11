import PropTypes from 'prop-types'
import { useEffect, useRef, useState } from 'react'
import userApi, { saveUserSession } from '../userApi'

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

let gisLoadPromise = null

/** Tải script Google Identity Services đúng 1 lần, dùng lại cho các lần render sau. */
function loadGisScript() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (gisLoadPromise) return gisLoadPromise
  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Không tải được Google Identity Services'))
    document.head.appendChild(script)
  })
  return gisLoadPromise
}

/**
 * Nút "Đăng nhập bằng Google" (Google Identity Services — không thêm thư viện
 * npm nào, dùng script GSI chính thức của Google).
 * Ẩn hoàn toàn nếu chưa cấu hình VITE_GOOGLE_CLIENT_ID (chưa tạo OAuth Client
 * ID ở Google Cloud Console) — tránh render nút hỏng ở môi trường chưa setup.
 */
export default function GoogleLoginButton({ onSuccess, onError }) {
  const containerRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!CLIENT_ID) return
    let alive = true

    const handleCredentialResponse = async (response) => {
      try {
        const res = await userApi.post('/user/google-login', { credential: response.credential })
        saveUserSession(res.data.token, res.data.user)
        onSuccess(res.data.user)
      } catch (err) {
        onError?.(err)
      }
    }

    loadGisScript()
      .then(() => {
        if (!alive || !containerRef.current) return
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: handleCredentialResponse,
        })
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: 'outline', size: 'large', width: 320, text: 'continue_with', locale: 'vi',
        })
        setReady(true)
      })
      .catch(() => { /* im lặng bỏ qua — nút Google chỉ là lựa chọn thêm, không chặn đăng nhập bằng email */ })

    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!CLIENT_ID) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem', width: '100%' }}>
      <div className="auth-divider"><span>hoặc</span></div>
      <div ref={containerRef} style={{ minHeight: ready ? 'auto' : '40px' }} />
    </div>
  )
}
GoogleLoginButton.propTypes = {
  onSuccess: PropTypes.func.isRequired,
  onError: PropTypes.func,
}
