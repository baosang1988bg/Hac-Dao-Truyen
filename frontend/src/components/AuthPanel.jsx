import PropTypes from 'prop-types'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import GoogleLoginButton, { GOOGLE_LOGIN_ENABLED } from './GoogleLoginButton'
import { passwordAuth } from '../utils/authApi'
import { friendlyAuthError } from '../utils/authHelpers'

export const PRIVACY_PATH = '/chinh-sach-bao-mat'

/**
 * Khối đăng nhập dùng chung cho trang Tài khoản (chưa đăng nhập) và LoginDialog:
 * nút Google (nếu có CLIENT_ID) → "hoặc dùng email" → tab Đăng nhập/Đăng ký +
 * form email/mật khẩu → dòng chính sách bảo mật.
 * onSuccess(user) được gọi sau khi phiên đã lưu (userApi.saveUserSession).
 * onNavigate: gọi khi bấm link rời khỏi hộp (vd đóng LoginDialog trước khi đi).
 */
export default function AuthPanel({ onSuccess, onNavigate, initialMode = 'login' }) {
  const uid = useId()
  const [mode, setMode] = useState(initialMode) // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const switchMode = (m) => { setMode(m); setError(null) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Mật khẩu cần tối thiểu 8 ký tự.')
      return
    }
    setBusy(true)
    try {
      const user = await passwordAuth(mode, { email, password, name })
      onSuccess?.(user)
    } catch (err) {
      setError(friendlyAuthError(err, mode))
      setBusy(false)
    }
  }

  // Mũi tên trái/phải chuyển tab (mẫu WAI-ARIA tabs).
  const onTabKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = mode === 'login' ? 'register' : 'login'
    switchMode(next)
    document.getElementById(`${uid}-tab-${next}`)?.focus()
  }

  const formId = `${uid}-form`

  return (
    <div className="auth-box">
      {GOOGLE_LOGIN_ENABLED && (
        <>
          <GoogleLoginButton onSuccess={onSuccess} />
          <div className="auth-divider"><span>hoặc dùng email</span></div>
        </>
      )}

      <div className="auth-tabs" role="tablist" aria-label="Chọn đăng nhập hoặc đăng ký">
        {[['login', 'Đăng nhập'], ['register', 'Đăng ký']].map(([m, label]) => (
          <button
            key={m}
            id={`${uid}-tab-${m}`}
            type="button" role="tab"
            aria-selected={mode === m}
            aria-controls={formId}
            tabIndex={mode === m ? 0 : -1}
            className={`auth-tab${mode === m ? ' active' : ''}`}
            onClick={() => switchMode(m)}
            onKeyDown={onTabKey}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        id={formId}
        onSubmit={handleSubmit}
        className="auth-form"
        role="tabpanel"
        aria-labelledby={`${uid}-tab-${mode}`}
      >
        {mode === 'register' && (
          <input
            type="text" className="input-field auth-form__field" placeholder="Tên hiển thị (không bắt buộc)"
            aria-label="Tên hiển thị (không bắt buộc)"
            value={name} onChange={e => setName(e.target.value)}
            autoComplete="nickname" maxLength={60}
          />
        )}
        <input
          type="email" className="input-field" placeholder="Email" aria-label="Email"
          value={email} onChange={e => setEmail(e.target.value)}
          required inputMode="email" autoComplete="email" autoCapitalize="none" enterKeyHint="next"
        />
        <input
          type="password" className="input-field"
          placeholder={mode === 'register' ? 'Mật khẩu (tối thiểu 8 ký tự)' : 'Mật khẩu'}
          aria-label="Mật khẩu"
          value={password} onChange={e => setPassword(e.target.value)}
          required minLength={8} enterKeyHint="go"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy
            ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Đang xử lý...</>
            : (mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản')}
        </button>
      </form>

      <p className="auth-panel__hint">
        {mode === 'login'
          ? <>Chưa có tài khoản? <button type="button" className="link-btn" onClick={() => switchMode('register')}>Đăng ký miễn phí</button></>
          : <>Đã có tài khoản? <button type="button" className="link-btn" onClick={() => switchMode('login')}>Đăng nhập</button></>}
      </p>

      <p className="auth-privacy">
        Khi tiếp tục, bạn đồng ý với{' '}
        <Link to={PRIVACY_PATH} onClick={onNavigate}>Chính sách bảo mật</Link>.
        {GOOGLE_LOGIN_ENABLED && ' Đăng nhập Google chỉ chia sẻ email, tên và ảnh đại diện của bạn.'}
      </p>
    </div>
  )
}
AuthPanel.propTypes = {
  onSuccess: PropTypes.func,
  onNavigate: PropTypes.func,
  initialMode: PropTypes.oneOf(['login', 'register']),
}
