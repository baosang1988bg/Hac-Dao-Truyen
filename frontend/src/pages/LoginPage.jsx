import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Key, BookOpen, AlertCircle, ArrowLeft } from 'lucide-react'
import api from '../api'
import '../styles/library-epub.css'

/**
 * Trang đăng nhập quản trị (standalone).
 * Guest KHÔNG cần đăng nhập — toàn bộ trang đọc truyện đều public.
 * Đăng nhập thành công → quay lại trang đích (state.from) hoặc /admin.
 */
export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const handleAdminLogin = async () => {
    if (loading) return
    if (!password.trim()) {
      setError('Vui lòng nhập mật khẩu quản trị')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await api.post('/auth/login', { password })
      localStorage.setItem('authToken', res.data.token)
      localStorage.setItem('userRole', 'admin')
      navigate(location.state?.from?.pathname || '/admin', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Sai mật khẩu quản trị')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container admin-login">
      <div className="glass-panel admin-login__panel">
        <div className="admin-login__logo">
          <BookOpen size={30} color="white" />
        </div>

        <h1 className="admin-login__title">
          Hắc Đạo<span>Truyện</span>
        </h1>
        <p className="admin-login__sub">
          Khu vực dành cho quản trị viên
        </p>

        <div className="admin-login__form">
          <div className="admin-login__field">
            <Key size={18} aria-hidden="true" />
            <input
              type="password"
              placeholder="Mật khẩu Admin"
              aria-label="Mật khẩu quản trị"
              aria-invalid={Boolean(error)}
              className={`admin-login__input${error ? ' has-error' : ''}`}
              value={password}
              onChange={e => { setPassword(e.target.value); if (error) setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
              autoComplete="current-password"
              enterKeyHint="go"
              autoFocus
            />
          </div>

          {error && (
            <div className="admin-login__error" role="alert">
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleAdminLogin}
            disabled={loading}
            className="btn btn-primary admin-login__submit"
          >
            {loading ? 'Đang xác thực...' : 'Đăng nhập'}
          </button>

          <Link to="/" className="admin-login__back">
            <ArrowLeft size={15} /> Về trang chủ đọc truyện
          </Link>
        </div>

        <div className="admin-login__foot">
          Hệ thống dịch thuật Hắc Đạo Truyện v2.0
        </div>
      </div>
    </div>
  )
}
