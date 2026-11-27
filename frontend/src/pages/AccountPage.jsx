import PropTypes from 'prop-types'
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom'
import {
  User, LogOut, BookOpen, Heart, HeartOff, Loader2, Languages, ArrowRight,
  KeyRound, MonitorSmartphone, Trash2, CheckCircle2, ShieldCheck,
} from 'lucide-react'
import userApi from '../userApi'
import { useAuth } from '../context/useAuth'
import { fetchNovelsBySlugsBatch } from '../utils/novelsApi'
import { getAllHistory } from '../utils/readingHistory'
import { continueReadingUrl } from '../utils/chapters'
import { novelDisplayTitle, fmtDate } from '../utils/format'
import { fetchMyGlossarySuggestions } from '../engagementApi'
import { suggestionStatusLabel, suggestionChapterHref, serverErrorMessage } from '../utils/engagement'
import AuthPanel from '../components/AuthPanel'
import GoogleLoginButton, { GOOGLE_LOGIN_ENABLED } from '../components/GoogleLoginButton'
import UserAvatar from '../components/UserAvatar'
import { staggerIndex } from '../utils/motion'
import { trackEvent } from '../utils/analytics'
import useDocumentTitle from '../hooks/useDocumentTitle'
import {
  changePassword, fetchSessions, revokeSession, logoutAllSessions, deleteAccount, linkGoogle,
} from '../utils/authApi'
import {
  passwordErrorMessage, describeUserAgent, normalizeSessions, fmtServerDateTime,
  isReauthRequired, linkGoogleErrorMessage, deleteAccountErrorMessage, canSubmitDelete,
} from '../utils/authHelpers'
import '../styles/library-epub.css'

/**
 * Trang tài khoản NGƯỜI DÙNG (guest đã đăng ký — không liên quan admin /login).
 * - Chưa đăng nhập: AuthPanel (Google + email/mật khẩu + đăng ký) — dùng chung
 *   với hộp đăng nhập LoginDialog.
 * - Đã đăng nhập: thẻ thông tin (avatar, phương thức liên kết) + "Đang theo
 *   dõi" (bookmark join /api/novels + /api/user/progress để hiện badge "N
 *   chương mới") + góp ý name + Mật khẩu + Thiết bị đang đăng nhập + Xoá tài
 *   khoản. Các mục phụ là <details> đóng sẵn, chỉ gọi API khi mở.
 * Trạng thái đăng nhập lấy từ AuthContext (useAuth) — đăng xuất/hết phiên ở
 * bất kỳ đâu thì trang tự quay về form.
 */
export default function AccountPage() {
  const { user, completeLogin } = useAuth()
  useDocumentTitle('Tài khoản')

  if (!user) {
    return (
      <div className="container animate-fade-in account-page">
        {/* hd-stagger: các khối trong form hiện so le nhẹ khi mở trang */}
        <div className="glass-panel auth-panel hd-stagger">
          <div className="auth-panel__icon"><User size={22} aria-hidden="true" /></div>
          <h1 className="auth-panel__title">Tài khoản</h1>
          <p className="auth-panel__sub">
            Theo dõi truyện, đồng bộ tiến trình đọc và bình luận cùng mọi người.
          </p>
          <AuthPanel onSuccess={completeLogin} />
        </div>
      </div>
    )
  }
  return <AccountDashboard user={user} />
}


/* ── Dashboard sau đăng nhập ──────────────────────────────────────────────── */

function AccountDashboard({ user }) {
  const { logout, refreshMe } = useAuth()
  const [items, setItems] = useState(null) // null = đang tải
  const [error, setError] = useState(null)

  // Mỗi lần mở trang: lấy thông tin mới nhất (avatar, has_password…) — 1 lượt đọc.
  useEffect(() => { refreshMe() }, [refreshMe])

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
        // Tiến độ server không biết bản dịch → lấy `ban` từ lịch sử đọc local
        // của máy này, CHỈ khi lịch sử cùng chương với server (đọc trên máy
        // khác/chương khác thì mở bản mặc định cho chắc).
        const localBySlug = new Map(getAllHistory().map(h => [h.slug, h]))
        const list = bookmarks.map(bm => {
          const novel = novelsBySlug.get(bm.slug)
          const prog = progress.find(p => p.slug === bm.slug)
          const chapterCount = novel?.chapter_count ?? 0
          const readChapter = Number(prog?.chapter)
          const newCount = Number.isFinite(readChapter) && chapterCount > readChapter
            ? chapterCount - readChapter
            : (prog ? 0 : null) // null = chưa đọc chương nào (không hiện badge âm)
          const local = prog ? localBySlug.get(bm.slug) : null
          const ban = local && String(local.chapter) === String(prog.chapter) ? local.ban : null
          return { ...bm, novel, prog, ban, chapterCount, newCount }
        }).filter(it => it.novel)
        setItems(list)
      })
      .catch(err => {
        if (!alive) return
        // 401: phiên hết hạn — interceptor đã xoá token, AuthContext tự đưa
        // trang về form đăng nhập; ở đây chỉ cần báo lỗi các trường hợp khác.
        if (err.response?.status !== 401) {
          setError('Không tải được danh sách theo dõi. Vui lòng thử lại sau.')
          setItems([])
        }
      })
    return () => { alive = false }
  }, [user.id])

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

  return (
    <div className="container animate-fade-in account-page">
      <ProfileCard user={user} onLogout={logout} />

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
          {items.map(({ slug, novel, prog, ban, chapterCount, newCount }, i) => (
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
                  to={continueReadingUrl(slug, prog.chapter, ban)}
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

      <h2 className="account-section-title account-section-title--spaced">Bảo mật &amp; quyền riêng tư</h2>
      <PasswordSection user={user} />
      <SessionsSection />
      <DeleteAccountSection user={user} />
      <p className="account-privacy-link">
        <ShieldCheck size={14} aria-hidden="true" /> Xem <Link to="/chinh-sach-bao-mat">Chính sách bảo mật</Link> để biết chúng tôi lưu gì và vì sao.
      </p>
    </div>
  )
}
AccountDashboard.propTypes = {
  user: PropTypes.shape({ id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]), name: PropTypes.string, email: PropTypes.string }).isRequired,
};


/* ── Thẻ thông tin ────────────────────────────────────────────────────────── */

function ProfileCard({ user, onLogout }) {
  const [busy, setBusy] = useState(false)
  const handleLogout = async () => {
    setBusy(true)
    await onLogout()
  }
  // Server cũ chưa trả has_google/has_password → không hiện nhãn (không đoán).
  const badges = []
  if (user.has_google === true) badges.push({ key: 'google', text: 'Đã liên kết Google' })
  if (user.has_password === true) badges.push({ key: 'pw', text: 'Mật khẩu' })
  if (user.has_password === false) badges.push({ key: 'nopw', text: 'Chưa đặt mật khẩu', muted: true })
  if (user.email_verified === true) badges.push({ key: 'verified', text: 'Email đã xác minh' })

  return (
    <div className="glass-panel account-profile">
      <UserAvatar user={user} size={52} className="account-profile__avatar" />
      <div className="account-profile__info">
        <div className="account-profile__name">{user.name || 'Đạo hữu ẩn danh'}</div>
        <div className="account-profile__email">{user.email}</div>
        {badges.length > 0 && (
          <ul className="account-badges" aria-label="Phương thức đăng nhập">
            {badges.map(b => (
              <li key={b.key} className={`account-badge${b.muted ? ' is-muted' : ''}`}>
                {!b.muted && <CheckCircle2 size={12} aria-hidden="true" />} {b.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="btn btn-secondary account-logout" onClick={handleLogout} disabled={busy}>
        {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <LogOut size={15} aria-hidden="true" />} Đăng xuất
      </button>
      {/* Chỉ khi server báo rõ chưa liên kết (has_google === false) và site có cấu hình Google. */}
      {user.has_google === false && GOOGLE_LOGIN_ENABLED && <LinkGoogleBlock />}
    </div>
  )
}
ProfileCard.propTypes = {
  user: PropTypes.object.isRequired,
  onLogout: PropTypes.func.isRequired,
}


/**
 * Liên kết Google vào tài khoản đang đăng nhập (thường là tài khoản email/mật
 * khẩu). Google-login với email không phải Gmail/Workspace trả 409
 * link_required → người dùng phải đăng nhập mật khẩu rồi liên kết ở đây.
 */
function LinkGoogleBlock() {
  const { refreshMe } = useAuth()
  const [error, setError] = useState(null)

  const onCredential = async (credential) => {
    setError(null)
    try {
      await linkGoogle(credential)
      // has_google → true: khối này tự ẩn, nhãn "Đã liên kết Google" hiện ra.
      await refreshMe()
    } catch (err) {
      setError(linkGoogleErrorMessage(err))
    }
  }

  return (
    <div className="account-link-google">
      <div className="account-link-google__title">Liên kết Google</div>
      <p className="account-details__note">
        Liên kết để lần sau đăng nhập nhanh bằng Google. Email tài khoản không thay đổi.
      </p>
      <GoogleLoginButton mode="credential" onCredential={onCredential} busyText="Đang liên kết Google..." />
      {error && <div className="auth-error" role="alert">{error}</div>}
    </div>
  )
}


/**
 * Khối "Xác nhận lại bằng Google" cho thao tác nhạy cảm (đặt mật khẩu lần
 * đầu, xoá tài khoản chỉ có Google) khi Worker trả 403 reauth_required.
 */
function ReauthGoogle({ title, note, onCredential }) {
  if (!GOOGLE_LOGIN_ENABLED) {
    return (
      <div className="account-reauth">
        <div className="account-reauth__title">{title}</div>
        <p className="account-details__note">
          Trang chưa bật đăng nhập Google. Hãy đăng xuất rồi đăng nhập lại, sau đó thực hiện ngay trong 10 phút.
        </p>
      </div>
    )
  }
  return (
    <div className="account-reauth">
      <div className="account-reauth__title">{title}</div>
      <p className="account-details__note">{note}</p>
      <GoogleLoginButton mode="credential" onCredential={onCredential} />
    </div>
  )
}
ReauthGoogle.propTypes = {
  title: PropTypes.string.isRequired,
  note: PropTypes.string.isRequired,
  onCredential: PropTypes.func.isRequired,
}


/* ── Mật khẩu: đặt (tài khoản chỉ có Google) hoặc đổi ─────────────────────── */

function PasswordSection({ user }) {
  const { refreshMe } = useAuth()
  const uid = useId()
  // has_password === false → tài khoản tạo bằng Google, chưa có mật khẩu: ĐẶT
  // (không cần mật khẩu hiện tại). Còn lại (true / server cũ) → ĐỔI.
  const setting = user.has_password === false
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  // Đặt mật khẩu lần đầu khi phiên > 10 phút → Worker trả 403 reauth_required:
  // hiện nút Google, nhận credential rồi gửi lại cùng mật khẩu mới đã nhập.
  const [needReauth, setNeedReauth] = useState(false)

  const send = async (credential) => {
    setError(null)
    setDone(null)
    if (next.length < 8) { setError('Mật khẩu mới cần tối thiểu 8 ký tự.'); return }
    if (next !== confirm) { setError('Hai lần nhập mật khẩu mới chưa khớp.'); return }
    if (!setting && !current) { setError('Nhập mật khẩu hiện tại.'); return }
    setBusy(true)
    try {
      await changePassword({
        currentPassword: setting ? undefined : current,
        newPassword: next,
        credential: setting ? credential : undefined,
      })
      trackEvent(setting ? 'password_set' : 'password_change')
      setCurrent(''); setNext(''); setConfirm('')
      setNeedReauth(false)
      setDone(setting
        ? 'Đã đặt mật khẩu. Từ giờ bạn đăng nhập được bằng email + mật khẩu.'
        : 'Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.')
      refreshMe()
    } catch (err) {
      if (setting && isReauthRequired(err)) setNeedReauth(true)
      setError(passwordErrorMessage(err, !setting, { withCredential: Boolean(credential) }))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    send()
  }

  return (
    <details className="glass-panel account-details">
      <summary className="account-details__summary">
        <KeyRound size={17} aria-hidden="true" /> {setting ? 'Đặt mật khẩu' : 'Đổi mật khẩu'}
      </summary>
      <form className="auth-form account-details__body" onSubmit={submit}>
        {setting && (
          <p className="account-details__note">
            Tài khoản của bạn đang đăng nhập bằng Google. Đặt thêm mật khẩu để đăng nhập được bằng email khi cần.
          </p>
        )}
        {/* Trường email ẩn giúp trình quản lý mật khẩu lưu đúng tài khoản. */}
        <input type="email" value={user.email || ''} autoComplete="username" readOnly hidden />
        {!setting && (
          <div>
            <label className="account-label" htmlFor={`${uid}-cur`}>Mật khẩu hiện tại</label>
            <input
              id={`${uid}-cur`} type="password" className="input-field" value={current}
              onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required
            />
          </div>
        )}
        <div>
          <label className="account-label" htmlFor={`${uid}-new`}>Mật khẩu mới (tối thiểu 8 ký tự)</label>
          <input
            id={`${uid}-new`} type="password" className="input-field" value={next}
            onChange={e => setNext(e.target.value)} autoComplete="new-password" minLength={8} required
          />
        </div>
        <div>
          <label className="account-label" htmlFor={`${uid}-confirm`}>Nhập lại mật khẩu mới</label>
          <input
            id={`${uid}-confirm`} type="password" className="input-field" value={confirm}
            onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required
          />
        </div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {done && <div className="account-success" role="status">{done}</div>}
        {setting && needReauth && (
          <ReauthGoogle
            title="Xác nhận lại bằng Google"
            note="Chọn đúng tài khoản Google đang liên kết. Mật khẩu mới bạn vừa nhập sẽ được lưu ngay sau khi xác nhận."
            onCredential={send}
          />
        )}
        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Đang lưu...</> : (setting ? 'Đặt mật khẩu' : 'Đổi mật khẩu')}
        </button>
      </form>
    </details>
  )
}
PasswordSection.propTypes = {
  user: PropTypes.object.isRequired,
}


/* ── Thiết bị đang đăng nhập ──────────────────────────────────────────────── */

function SessionsSection() {
  const { endLocalSession } = useAuth()
  const [sessions, setSessions] = useState(null) // null = chưa tải
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetchSessions()
      .then(data => setSessions(normalizeSessions(data)))
      .catch(err => {
        if (err.response?.status === 404) setError('Máy chủ chưa hỗ trợ xem thiết bị đăng nhập.')
        else if (err.response?.status !== 401) setError('Không tải được danh sách thiết bị.')
      })
      .finally(() => setLoading(false))
  }

  // Tải lười: chỉ gọi GET /user/sessions khi người dùng mở mục lần đầu.
  const onToggle = (e) => {
    if (e.currentTarget.open && sessions === null && !loading) load()
  }

  const revoke = async (s) => {
    if (busyId) return
    setBusyId(s.id)
    setError(null)
    try {
      await revokeSession(s.id)
      trackEvent('session_revoke', { current: s.current })
      if (s.current) { endLocalSession(); return }
      setSessions(list => list.filter(x => x.id !== s.id))
    } catch (err) {
      if (err.response?.status !== 401) setError('Không đăng xuất được thiết bị này. Vui lòng thử lại.')
    } finally {
      setBusyId(null)
    }
  }

  const revokeAll = async () => {
    if (busyId) return
    if (!window.confirm('Đăng xuất khỏi TẤT CẢ thiết bị, kể cả máy này?')) return
    setBusyId('*')
    setError(null)
    try {
      await logoutAllSessions()
      trackEvent('logout_all')
      endLocalSession()
    } catch (err) {
      if (err.response?.status !== 401) setError('Không đăng xuất được. Vui lòng thử lại.')
      setBusyId(null)
    }
  }

  return (
    <details className="glass-panel account-details" onToggle={onToggle}>
      <summary className="account-details__summary">
        <MonitorSmartphone size={17} aria-hidden="true" /> Thiết bị đang đăng nhập
        {sessions !== null && <span className="account-details__count">({sessions.length})</span>}
      </summary>
      <div className="account-details__body" aria-busy={loading}>
        {loading && <div role="status" className="account-details__note">Đang tải...</div>}
        {error && (
          <div role="alert" className="auth-error account-inline-error">
            {error}
            <button type="button" className="link-btn" onClick={load}>Thử lại</button>
          </div>
        )}
        {sessions !== null && sessions.length > 0 && (
          <ul className="session-list">
            {sessions.map(s => (
              <li key={s.id} className="session-row">
                <div className="session-row__body">
                  <div className="session-row__device">
                    {describeUserAgent(s.user_agent)}
                    {s.current && <span className="account-badge">Máy này</span>}
                  </div>
                  <div className="session-row__meta">
                    {s.created_at ? `Đăng nhập ${fmtServerDateTime(s.created_at)}` : 'Không rõ thời điểm đăng nhập'}
                    {s.expires_at && ` · Hết hạn ${fmtServerDateTime(s.expires_at)}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary session-row__btn"
                  onClick={() => revoke(s)}
                  disabled={Boolean(busyId)}
                  aria-label={`Đăng xuất ${describeUserAgent(s.user_agent)}${s.current ? ' (máy này)' : ''}`}
                >
                  {busyId === s.id ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <LogOut size={14} aria-hidden="true" />}
                  Đăng xuất
                </button>
              </li>
            ))}
          </ul>
        )}
        {sessions !== null && (
          <button type="button" className="btn btn-danger account-wide-btn" onClick={revokeAll} disabled={Boolean(busyId)}>
            {busyId === '*' ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <LogOut size={15} aria-hidden="true" />}
            Đăng xuất tất cả thiết bị
          </button>
        )}
      </div>
    </details>
  )
}


/* ── Xoá tài khoản ────────────────────────────────────────────────────────── */

function DeleteAccountSection({ user }) {
  const { endLocalSession } = useAuth()
  const navigate = useNavigate()
  const uid = useId()
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Tài khoản chỉ có Google: thử xoá ngay (phiên ≤ 10 phút là đủ); 403
  // reauth_required → hiện nút Google, gửi lại kèm credential.
  const [needReauth, setNeedReauth] = useState(false)
  // Có mật khẩu → bắt buộc nhập mật khẩu hiện tại (Worker trả 403 nếu thiếu/sai).
  const hasPassword = user.has_password === true
  const canSubmit = canSubmitDelete({ typed, email: user.email, hasPassword, password })

  const send = async (credential) => {
    if (!canSubmit || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteAccount({
        confirm: typed,
        currentPassword: hasPassword ? password : undefined,
        credential: hasPassword ? undefined : credential,
      })
      trackEvent('account_delete')
      endLocalSession()
      navigate('/', { replace: true })
    } catch (err) {
      if (!hasPassword && isReauthRequired(err)) setNeedReauth(true)
      setError(deleteAccountErrorMessage(err, { hasPassword, withCredential: Boolean(credential) }))
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    send()
  }

  return (
    <details className="glass-panel account-details account-details--danger">
      <summary className="account-details__summary">
        <Trash2 size={17} aria-hidden="true" /> Xoá tài khoản
      </summary>
      <form className="auth-form account-details__body" onSubmit={submit}>
        <div className="account-danger-note">
          <strong>Thao tác này không hoàn tác được.</strong> Khi xoá:
          <ul>
            <li>Danh sách theo dõi, tiến độ đọc, cài đặt đọc đồng bộ và đánh giá sao của bạn bị xoá.</li>
            <li>Email, tên, ảnh đại diện, mật khẩu và liên kết Google bị gỡ khỏi tài khoản; mọi thiết bị bị đăng xuất.</li>
            <li>Yêu cầu truyện và góp ý name đang chờ duyệt bị xoá; ghi chú kèm các yêu cầu/góp ý cũ bị xoá trắng.</li>
            <li>Bình luận, góp ý name đã duyệt và địa chỉ của yêu cầu truyện đã xử lý vẫn giữ lại, dưới tên “Người dùng đã xoá”.</li>
          </ul>
        </div>
        <div>
          <label className="account-label" htmlFor={`${uid}-confirm`}>
            Gõ <strong>{user.email}</strong> để xác nhận
          </label>
          <input
            id={`${uid}-confirm`} type="email" className="input-field" value={typed}
            onChange={e => setTyped(e.target.value)}
            autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="email"
          />
        </div>
        {hasPassword && (
          <div>
            <label className="account-label" htmlFor={`${uid}-pw`}>Mật khẩu hiện tại</label>
            <input
              id={`${uid}-pw`} type="password" className="input-field" value={password}
              onChange={e => setPassword(e.target.value)} autoComplete="current-password" required
            />
          </div>
        )}
        {error && <div className="auth-error" role="alert">{error}</div>}
        {!hasPassword && needReauth && (
          <ReauthGoogle
            title="Xác nhận lại bằng Google"
            note="Chọn đúng tài khoản Google đang liên kết. Tài khoản sẽ bị xoá ngay sau khi xác nhận."
            onCredential={send}
          />
        )}
        <button type="submit" className="btn btn-danger auth-submit" disabled={!canSubmit || busy}>
          {busy ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Đang xoá...</> : <><Trash2 size={16} aria-hidden="true" /> Xoá vĩnh viễn tài khoản</>}
        </button>
      </form>
    </details>
  )
}
DeleteAccountSection.propTypes = {
  user: PropTypes.object.isRequired,
}


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
