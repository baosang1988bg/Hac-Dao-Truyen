import PropTypes from 'prop-types'
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom'
import { User, LogOut, BookOpen, Heart, HeartOff, Loader2, Languages, ArrowRight } from 'lucide-react'
import userApi, {
  saveUserSession, clearUserSession, getUserInfo, isLoggedIn,
} from '../userApi'
import { fetchNovelsBySlugsBatch } from '../utils/novelsApi'
import { novelDisplayTitle, fmtDate } from '../utils/format'
import { fetchMyGlossarySuggestions } from '../engagementApi'
import { suggestionStatusLabel, suggestionChapterHref, serverErrorMessage } from '../utils/engagement'
import GoogleLoginButton from '../components/GoogleLoginButton'
import { staggerIndex } from '../utils/motion'
import { trackAuth, trackEvent } from '../utils/analytics'
import '../styles/library-epub.css'

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
      trackAuth(mode === 'register' ? 'sign_up' : 'login', 'password', res.data.user)
      onSuccess(res.data.user)
    } catch (err) {
      trackEvent('auth_error', { auth_mode: mode, method: 'password', status: err.response?.status || 0 })
      setError(friendlyAuthError(err, mode))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container animate-fade-in account-page">
      {/* hd-stagger: các khối trong form hiện so le nhẹ khi mở trang */}
      <div className="glass-panel auth-panel hd-stagger">
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
              type="text" className="input-field auth-form__field" placeholder="Tên hiển thị (không bắt buộc)"
              value={name} onChange={e => setName(e.target.value)}
              autoComplete="nickname" maxLength={60}
            />
          )}
          <input
            type="email" className="input-field" placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)}
            required inputMode="email" autoComplete="email" autoCapitalize="none" enterKeyHint="next"
          />
          <input
            type="password" className="input-field"
            placeholder={mode === 'register' ? 'Mật khẩu (tối thiểu 8 ký tự)' : 'Mật khẩu'}
            value={password} onChange={e => setPassword(e.target.value)}
            required minLength={8} enterKeyHint="go"
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

        <GoogleLoginButton
          onSuccess={onSuccess}
          onError={() => setError('Đăng nhập Google thất bại. Vui lòng thử lại.')}
        />
      </div>
    </div>
  )
}
AuthForm.propTypes = {
  onSuccess: PropTypes.func,
};


/* ── Dashboard sau đăng nhập ──────────────────────────────────────────────── */

function AccountDashboard({ user, onLogout }) {
  const [items, setItems] = useState(null) // null = đang tải
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      userApi.get('/user/bookmarks'),
      userApi.get('/user/progress').catch(() => ({ data: [] })),
    ])
      .then(async ([bmRes, pgRes]) => {
        if (!alive) return
        const bookmarks = bmRes.data || []
        const progress = pgRes.data || []
        // B01: KHÔNG tải page=1 của /api/novels rồi .find() — bookmark có thể
        // trỏ tới truyện nằm ở bất kỳ trang nào của danh sách chung (contract
        // mới luôn trả {novels,total,page,limit,pages}, không phải mảng). Gọi
        // theo đúng các slug đã bookmark — gom 1 request GET /novels?slugs=...
        // (≤24 slug/lô), tự fallback gọi lẻ /novels/:slug nếu backend cũ.
        const novelsBySlug = await fetchNovelsBySlugsBatch(userApi, bookmarks.map(bm => bm.slug))
        if (!alive) return
        const list = bookmarks.map(bm => {
          const novel = novelsBySlug.get(bm.slug)
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
      trackEvent('novel_unfollow', { novel_slug: slug, source: 'account' })
    } catch {
      setItems(prev) // hoàn tác nếu lỗi
    }
  }

  const logout = async () => {
    try { await userApi.post('/user/logout') } catch { /* token có thể đã hết hạn */ }
    trackEvent('logout') // gửi TRƯỚC khi xoá user_id → event còn gắn đúng người
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
        <div role="status" aria-label="Đang tải danh sách theo dõi">
          {[0, 1, 2].map(i => <span key={i} className="hd-skel account-skel__row" />)}
        </div>
      )}

      {error && <div className="glass-panel p-6 auth-error">{error}</div>}

      {items !== null && !error && items.length === 0 && (
        <div className="glass-panel hd-empty">
          <div className="hd-empty__icon"><Heart size={28} aria-hidden="true" /></div>
          <div className="hd-empty__title">Chưa theo dõi truyện nào</div>
          <p className="hd-empty__text">
            Bấm “Theo dõi” trong trang truyện để nhận thông báo chương mới tại đây.
          </p>
          <div className="hd-empty__actions">
            <Link to="/" className="btn btn-primary">
              <BookOpen size={16} aria-hidden="true" /> Khám phá truyện
            </Link>
          </div>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="bookmark-list" data-track-section="account_following">
          {items.map(({ slug, novel, prog, chapterCount, newCount }, i) => (
            <div key={slug} className="glass-panel bookmark-row hd-reveal" style={{ '--i': staggerIndex(i) }}>
              <div className="bookmark-row__body">
                <Link to={`/novel/${slug}`} className="bookmark-row__title">
                  {novelDisplayTitle(novel)}
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
                  data-track-action="continue_reading"
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
                aria-label={`Bỏ theo dõi ${novelDisplayTitle(novel)}`}
                onClick={() => unfollow(slug)}
              >
                <HeartOff size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Góp ý name của tôi — tải lười khi mở */}
      <MySuggestions />
    </div>
  )
}
AccountDashboard.propTypes = {
  user: PropTypes.shape({id: PropTypes.number, name: PropTypes.string, email: PropTypes.string}),
  onLogout: PropTypes.func,
};


/* ── Góp ý name của tôi ───────────────────────────────────────────────────── */

const SUGGESTION_STATUS_COLORS = { pending: '#fbbf24', approved: '#6ee7b7', rejected: '#fca5a5' }

/**
 * Danh sách góp ý name người dùng đã gửi (từ Reader) + kết quả duyệt.
 * <details> đóng sẵn: CHỈ gọi GET /api/user/glossary-suggestions khi người
 * dùng mở lần đầu → vào trang tài khoản không tốn thêm request.
 */
function MySuggestions() {
  const [items, setItems] = useState(null) // null = chưa tải / đang tải
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetchMyGlossarySuggestions()
      .then(setItems)
      .catch(err => setError(serverErrorMessage(err, 'Không tải được danh sách góp ý.')))
      .finally(() => setLoading(false))
  }

  const onToggle = (e) => {
    if (e.currentTarget.open && items === null && !loading) load()
  }

  return (
    <details className="glass-panel" onToggle={onToggle} style={{ marginTop: '1.5rem', padding: '0.9rem 1.1rem' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', minHeight: '32px' }}>
        <Languages size={17} aria-hidden="true" /> Góp ý name của tôi
        {items !== null && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' }}>({items.length})</span>}
      </summary>

      <div style={{ marginTop: '0.75rem' }} aria-busy={loading}>
        {loading && (
          <div role="status" style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Đang tải...</div>
        )}
        {error && (
          <div role="alert" className="auth-error" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {error}
            <button type="button" className="link-btn" onClick={load}>Thử lại</button>
          </div>
        )}
        {!loading && !error && items !== null && items.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Bạn chưa gửi góp ý nào. Khi đọc truyện, bôi đen cụm dịch sai để đề xuất tên đúng.
          </p>
        )}
        {!loading && items !== null && items.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            {items.map(it => {
              const chapterHref = suggestionChapterHref(it.slug, it.chapter)
              return (
                <li key={it.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.55rem', fontSize: '0.88rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{it.from_text}</span>
                    <ArrowRight size={13} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                    <strong>{it.to_text}</strong>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 600, marginLeft: 'auto',
                      color: SUGGESTION_STATUS_COLORS[it.status] || 'var(--text-muted)',
                    }}>
                      {suggestionStatusLabel(it.status)}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    <Link to={`/novel/${it.slug}`}>{it.slug}</Link>
                    {chapterHref && <> · <Link to={chapterHref}>Chương {it.chapter}</Link></>}
                    {' · '}{fmtDate(it.created_at)}
                  </div>
                  {it.admin_note && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Phản hồi admin: {it.admin_note}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </details>
  )
}
