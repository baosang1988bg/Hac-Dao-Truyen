import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { User, LogOut, BookOpen, HeartOff, Loader2 } from 'lucide-react'
import api from '../api'
import userApi, {
  saveUserSession, clearUserSession, getUserInfo, isLoggedIn,
} from '../userApi'

/**
 * Trang tài khoản NGƯỜI DÙNG (guest đã đăng ký — không liên quan admin /login).
 * - Chưa đăng nhập: form gộp Đăng nhập / Đăng ký (chuyển tab).
 * - Đã đăng nhập: thông tin cá nhân + danh sách "Đang theo dõi" (bookmark
 *   join /api/novels + /api/user/progress để hiện badge "N chương mới").
 */
export default function AccountPage() {
  const [user, setUser] = useState(() => (isLoggedIn() ? getUserInfo() : null))

  if (!user) {
    return <AuthForm onSuccess={setUser} />
  }
  return <AccountDashboard user={user} onLogout={() => setUser(null)} />
}

/* ── Form Đăng nhập / Đăng ký ─────────────────────────────────────────────── */

function friendlyAuthError(err, mode) {
  const status = err.response?.status
  if (status === 401) return 'Email hoặc mật khẩu không đúng. Bạn kiểm tra lại nhé.'
  if (status === 409) return 'Email này đã được đăng ký rồi — hãy chuyển sang tab Đăng nhập.'
  if (status === 400) return 'Thông tin chưa hợp lệ. Kiểm tra lại email và mật khẩu (tối thiểu 8 ký tự).'
  if (!err.response) return 'Không kết nối được máy chủ. Vui lòng thử lại sau.'
  return mode === 'login' ? 'Đăng nhập thất bại. Vui lòng thử lại.' : 'Đăng ký thất bại. Vui lòng thử lại.'
}

function AuthForm({ onSuccess }) {
  const [mode, setMode] = useState('login') // 'login' | 'register'
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
      const payload = mode === 'register'
        ? { email: email.trim(), password, ...(name.trim() ? { name: name.trim() } : {}) }
        : { email: email.trim(), password }
      const res = await userApi.post(`/user/${mode}`, payload)
      saveUserSession(res.data.token, res.data.user)
      onSuccess(res.data.user)
    } catch (err) {
      setError(friendlyAuthError(err, mode))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container animate-fade-in account-page">
      <div className="glass-panel auth-panel">
        <div className="auth-panel__icon"><User size={22} /></div>
        <h1 className="auth-panel__title">Tài khoản</h1>
        <p className="auth-panel__sub">
          Theo dõi truyện, đồng bộ tiến trình đọc và bình luận cùng mọi người.
        </p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button" role="tab" aria-selected={mode === 'login'}
            className={`auth-tab${mode === 'login' ? ' active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Đăng nhập
          </button>
          <button
            type="button" role="tab" aria-selected={mode === 'register'}
            className={`auth-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Đăng ký
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'register' && (
            <input
              type="text" className="input-field" placeholder="Tên hiển thị (không bắt buộc)"
              value={name} onChange={e => setName(e.target.value)}
              autoComplete="nickname" maxLength={60}
            />
          )}
          <input
            type="email" className="input-field" placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)}
            required autoComplete="email"
          />
          <input
            type="password" className="input-field"
            placeholder={mode === 'register' ? 'Mật khẩu (tối thiểu 8 ký tự)' : 'Mật khẩu'}
            value={password} onChange={e => setPassword(e.target.value)}
            required minLength={8}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />

          {error && <div className="auth-error" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy
              ? <><Loader2 size={16} className="spin" /> Đang xử lý...</>
              : (mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản')}
          </button>
        </form>

        <p className="auth-panel__hint">
          {mode === 'login'
            ? <>Chưa có tài khoản? <button type="button" className="link-btn" onClick={() => switchMode('register')}>Đăng ký miễn phí</button></>
            : <>Đã có tài khoản? <button type="button" className="link-btn" onClick={() => switchMode('login')}>Đăng nhập</button></>}
        </p>
      </div>
    </div>
  )
}

/* ── Dashboard sau đăng nhập ──────────────────────────────────────────────── */

function AccountDashboard({ user, onLogout }) {
  const [items, setItems] = useState(null) // null = đang tải
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      userApi.get('/user/bookmarks'),
      api.get('/novels'),
      userApi.get('/user/progress').catch(() => ({ data: [] })),
    ])
      .then(([bmRes, nvRes, pgRes]) => {
        if (!alive) return
        const novels = nvRes.data || []
        const progress = pgRes.data || []
        const list = (bmRes.data || []).map(bm => {
          const novel = novels.find(n => n.slug === bm.slug)
          const prog = progress.find(p => p.slug === bm.slug)
          const chapterCount = novel?.chapter_count ?? 0
          const readChapter = Number(prog?.chapter)
          const newCount = Number.isFinite(readChapter) && chapterCount > readChapter
            ? chapterCount - readChapter
            : (prog ? 0 : null) // null = chưa đọc chương nào (không hiện badge âm)
          return { ...bm, novel, prog, chapterCount, newCount }
        }).filter(it => it.novel)
        setItems(list)
      })
      .catch(err => {
        if (!alive) return
        if (err.response?.status === 401) {
          // Phiên hết hạn — interceptor đã xóa token, quay về form đăng nhập
          onLogout()
        } else {
          setError('Không tải được danh sách theo dõi. Vui lòng thử lại sau.')
          setItems([])
        }
      })
    return () => { alive = false }
  }, [onLogout])

  const unfollow = async (slug) => {
    const prev = items
    setItems(list => list.filter(it => it.slug !== slug)) // optimistic
    try {
      await userApi.delete(`/user/bookmarks/${slug}`)
    } catch {
      setItems(prev) // hoàn tác nếu lỗi
    }
  }

  const logout = async () => {
    try { await userApi.post('/user/logout') } catch { /* token có thể đã hết hạn */ }
    clearUserSession()
    onLogout()
  }

  return (
    <div className="container animate-fade-in account-page">
      {/* Thông tin cá nhân */}
      <div className="glass-panel account-profile">
        <div className="account-profile__avatar">
          {(user.name || user.email || '?').charAt(0).toUpperCase()}
        </div>
        <div className="account-profile__info">
          <div className="account-profile__name">{user.name || 'Đạo hữu ẩn danh'}</div>
          <div className="account-profile__email">{user.email}</div>
        </div>
        <button className="btn btn-secondary account-logout" onClick={logout}>
          <LogOut size={15} /> Đăng xuất
        </button>
      </div>

      {/* Đang theo dõi */}
      <h2 className="account-section-title">Đang theo dõi</h2>

      {items === null && (
        <div className="glass-panel p-6 text-muted">Đang tải danh sách theo dõi...</div>
      )}

      {error && <div className="glass-panel p-6 auth-error">{error}</div>}

      {items !== null && !error && items.length === 0 && (
        <div className="glass-panel p-6 text-center">
          <div style={{ fontSize: '2rem', marginBottom: '0.6rem' }}>♥</div>
          <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Chưa theo dõi truyện nào</div>
          <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1.1rem' }}>
            Bấm “Theo dõi” trong trang truyện để nhận thông báo chương mới tại đây.
          </p>
          <Link to="/" className="btn btn-primary" style={{ minHeight: '48px' }}>
            <BookOpen size={16} /> Khám phá truyện
          </Link>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="bookmark-list">
          {items.map(({ slug, novel, prog, chapterCount, newCount }) => (
            <div key={slug} className="glass-panel bookmark-row">
              <div className="bookmark-row__body">
                <Link to={`/novel/${slug}`} className="bookmark-row__title">
                  {novel.title}
                </Link>
                <div className="bookmark-row__meta">
                  <span>{chapterCount} chương</span>
                  {prog && <span>· Đã đọc đến ch. {prog.chapter}</span>}
                  {newCount > 0 && (
                    <span className="badge-new">{newCount} chương mới</span>
                  )}
                </div>
              </div>
              {prog ? (
                <Link
                  to={`/novel/${slug}/read/${prog.chapter}`}
                  className="btn btn-primary bookmark-row__action"
                >
                  <BookOpen size={14} /> Đọc tiếp
                </Link>
              ) : (
                <Link to={`/novel/${slug}`} className="btn btn-secondary bookmark-row__action">
                  <BookOpen size={14} /> Mở truyện
                </Link>
              )}
              <button
                className="bookmark-row__remove"
                title="Bỏ theo dõi"
                aria-label={`Bỏ theo dõi ${novel.title}`}
                onClick={() => unfollow(slug)}
              >
                <HeartOff size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
