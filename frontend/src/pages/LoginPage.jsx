import React, { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Key, BookOpen, AlertCircle, ArrowLeft } from 'lucide-react'
import api from '../api'

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
    <div className="login-container" style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(circle at top right, #1e293b, #0f172a)',
      padding: '20px'
    }}>
      <div className="glass-panel animate-fade-in" style={{
        width: '100%', maxWidth: '400px', padding: '2.5rem', textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
      }}>
        <div style={{
          background: 'var(--accent-gradient)', width: '60px', height: '60px',
          borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 1.5rem', boxShadow: '0 0 20px rgba(59,130,246,0.4)'
        }}>
          <BookOpen size={30} color="white" />
        </div>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.5rem', color: 'white' }}>
          Hắc Đạo<span style={{ color: 'var(--accent)' }}>Truyện</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Khu vực dành cho quản trị viên
        </p>

        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ position: 'relative' }}>
            <Key size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="password"
              placeholder="Mật khẩu Admin"
              value={password}
              onChange={e => { setPassword(e.target.value); if (error) setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
              autoFocus
              style={{
                width: '100%', padding: '0.8rem 1rem 0.8rem 2.5rem', borderRadius: '10px',
                background: 'rgba(0,0,0,0.2)',
                border: error ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.1)',
                color: 'white', outline: 'none', fontSize: '1rem'
              }}
            />
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
              color: '#fca5a5', fontSize: '0.82rem', fontWeight: 500,
              padding: '0.6rem 0.8rem', borderRadius: '10px', textAlign: 'left'
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          <button
            onClick={handleAdminLogin}
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.8rem', justifyContent: 'center', minHeight: '44px', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Đang xác thực...' : 'Đăng nhập'}
          </button>

          <Link
            to="/"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              color: 'var(--text-muted)', fontSize: '0.85rem', minHeight: '44px',
            }}
          >
            <ArrowLeft size={15} /> Về trang chủ đọc truyện
          </Link>
        </div>

        <div style={{ marginTop: '2rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.2)' }}>
          Hệ thống dịch thuật Hắc Đạo Truyện v2.0
        </div>
      </div>
    </div>
  )
}
