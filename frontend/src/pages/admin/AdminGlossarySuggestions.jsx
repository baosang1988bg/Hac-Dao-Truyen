import PropTypes from 'prop-types'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Languages, Check, X, AlertCircle, ArrowRight, RefreshCw } from 'lucide-react'
import { fetchAdminGlossarySuggestions, reviewGlossarySuggestion } from '../../engagementApi'
import { fmtDate } from '../../utils/format'
import {
  SUGGESTION_FILTERS, suggestionStatusLabel, defaultApplyGlossary, normalizeSlugFilter,
  buildReviewBody, suggestionChapterHref, serverErrorMessage,
  isShortSuggestionFrom, suggestionPreview, SUGGESTION_UNSAFE_RE, SUGGESTION_UNSAFE_CHARS,
} from '../../utils/engagement'

/**
 * Duyệt góp ý name/cụm từ của người đọc (học từ sangtacviet "name chung").
 * GET /api/admin/glossary-suggestions?status=&slug=
 * POST /api/admin/glossary-suggestions/:id/review
 *
 * Duyệt = Worker thêm quy tắc thay thế công khai vào R2 <slug>/replacements.json
 * (mọi người đọc thấy ngay, KHÔNG cần dịch lại chương) + tuỳ chọn ghi glossary
 * (chữ Hán gốc → tên mới) để các chương dịch SAU dùng đúng tên.
 */
export default function AdminGlossarySuggestions() {
  const [status, setStatus] = useState('pending')
  const [slugInput, setSlugInput] = useState('')
  const [slug, setSlug] = useState('')
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(() => {
    setItems(null)
    setError(null)
    const params = {}
    if (status) params.status = status
    if (slug) params.slug = slug
    fetchAdminGlossarySuggestions(params)
      .then(setItems)
      .catch(err => { setItems([]); setError(serverErrorMessage(err, 'Không tải được danh sách góp ý.')) })
  }, [status, slug])

  useEffect(() => { load() }, [load])

  const applySlug = (e) => {
    e.preventDefault()
    const raw = slugInput.trim()
    const s = normalizeSlugFilter(raw)
    if (raw && !s) {
      setError('Slug không hợp lệ (chỉ chữ thường, số và dấu gạch nối).')
      return
    }
    setSlug(s)
  }

  // Duyệt/từ chối xong: bỏ khỏi danh sách nếu đang lọc "Chờ duyệt", còn lại
  // cập nhật tại chỗ — không tải lại cả danh sách.
  const onReviewed = (id, result, patch) => {
    setNotice(result)
    setItems(list => {
      if (!list) return list
      if (status === 'pending') return list.filter(it => it.id !== id)
      return list.map(it => (it.id === id ? { ...it, ...patch } : it))
    })
  }

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.7rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Languages size={24} /> Góp ý name
        </h1>
        <p className="page-subtitle" style={{ fontSize: '0.92rem', lineHeight: 1.55 }}>
          Người đọc đề xuất sửa tên/cụm từ dịch sai. <strong>Duyệt</strong> = thêm quy tắc thay thế công khai
          cho truyện — mọi người đọc thấy ngay, không cần dịch lại chương. Nếu có chữ Hán gốc, có thể tick
          <strong> “Ghi luôn vào glossary”</strong> để các chương dịch sau dùng đúng tên.
        </p>
      </div>

      {/* Lọc trạng thái + slug */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {SUGGESTION_FILTERS.map(f => (
          <button
            key={f.key || 'all'}
            type="button"
            aria-pressed={f.key === status}
            className={f.key === status ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: '0.82rem', padding: '6px 14px', minHeight: '34px' }}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
        <form onSubmit={applySlug} style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Lọc theo slug truyện"
            aria-label="Lọc theo slug truyện"
            value={slugInput}
            onChange={e => setSlugInput(e.target.value)}
            style={{ minWidth: '200px', fontSize: '0.85rem', minHeight: '34px' }}
          />
          <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.82rem', padding: '6px 12px', minHeight: '34px' }}>
            Lọc
          </button>
          {slug && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '6px 12px', minHeight: '34px' }}
              onClick={() => { setSlug(''); setSlugInput('') }}
            >
              Bỏ lọc
            </button>
          )}
        </form>
      </div>

      {notice && (
        <div className="glass-panel" role="status" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', color: '#6ee7b7', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check size={16} /> {notice}
          <button type="button" className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => setNotice(null)}>Đóng</button>
        </div>
      )}

      {error && (
        <div className="glass-panel" role="alert" style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', gap: '12px', color: '#fca5a5', marginBottom: '1rem' }}>
          <AlertCircle size={18} /> {error}
          <button type="button" className="btn btn-secondary" style={{ marginLeft: 'auto', fontSize: '0.8rem', minHeight: '32px' }} onClick={load}>
            <RefreshCw size={14} /> Tải lại
          </button>
        </div>
      )}

      {items === null && (
        <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Đang tải...
        </div>
      )}

      {items !== null && items.length === 0 && !error && (
        <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Không có góp ý nào{status ? ` ở trạng thái “${suggestionStatusLabel(status)}”` : ''}{slug ? ` cho truyện ${slug}` : ''}.
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {items.map(item => (
            <SuggestionCard key={item.id} item={item} onReviewed={onReviewed} />
          ))}
        </div>
      )}
    </div>
  )
}

function SuggestionCard({ item, onReviewed }) {
  const pending = item.status === 'pending'
  const [to, setTo] = useState(item.to_text || '')
  const [original, setOriginal] = useState(item.original || '')
  const [applyGlossary, setApplyGlossary] = useState(() => defaultApplyGlossary(item.original))
  const [adminNote, setAdminNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const chapterHref = suggestionChapterHref(item.slug, item.chapter)
  const sender = item.user_name || item.email || `User #${item.user_id}`
  const hasOriginal = original.trim().length > 0
  // Quy tắc công khai thay theo CHUỖI CON trên toàn chương → cụm gốc ngắn dễ
  // thay nhầm vào giữa từ khác; cho admin thấy trước kết quả.
  const shortFrom = isShortSuggestionFrom(item.from_text)
  const preview = suggestionPreview(item.from_text, to.trim() || item.to_text)

  const review = async (nextStatus) => {
    if (busy) return
    if (nextStatus === 'approved' && !to.trim()) {
      setError('Cụm đề xuất không được để trống.')
      return
    }
    if (nextStatus === 'approved' && SUGGESTION_UNSAFE_RE.test(to)) {
      setError(`Cụm thay thế không được chứa các ký tự ${SUGGESTION_UNSAFE_CHARS}.`)
      return
    }
    setBusy(true)
    setError(null)
    const body = buildReviewBody(nextStatus, { adminNote, to, original, applyGlossary })
    try {
      const res = await reviewGlossarySuggestion(item.id, body)
      let msg = nextStatus === 'approved'
        ? `Đã duyệt #${item.id}: “${item.from_text}” → “${body.to}”.`
        : `Đã từ chối #${item.id}.`
      if (res?.applied_glossary) {
        msg += ` Đã ghi glossary${Number.isFinite(res.glossary_count) ? ` (${res.glossary_count} mục)` : ''}.`
      }
      onReviewed(item.id, msg, {
        status: nextStatus,
        admin_note: body.admin_note || null,
        ...(nextStatus === 'approved' ? { to_text: body.to, original: body.original || null } : {}),
        reviewed_at: new Date().toISOString(),
      })
    } catch (err) {
      const code = err?.response?.status
      // 409: admin khác đã xử lý; 502: ghi R2 lỗi (góp ý vẫn chờ); 503: chưa chạy migration.
      setError(serverErrorMessage(err, code
        ? `Không xử lý được góp ý (HTTP ${code}).`
        : 'Không xử lý được góp ý. Vui lòng thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass-panel" style={{ padding: '0.9rem 1.1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
        <Link to={`/novel/${item.slug}`} style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--accent)' }}>
          {item.novel_title || item.slug}
        </Link>
        {chapterHref && (
          <Link to={chapterHref} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Chương {item.chapter}
          </Link>
        )}
        <StatusPill status={item.status} />
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          #{item.id} · {sender} · {fmtDate(item.created_at)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.95rem', marginBottom: '0.35rem' }}>
        <span style={{ textDecoration: pending ? 'none' : 'line-through', color: 'var(--text-muted)' }}>{item.from_text}</span>
        <ArrowRight size={15} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
        <strong>{item.to_text}</strong>
        {item.original && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>(gốc: <span lang="zh">{item.original}</span>)</span>
        )}
      </div>

      {item.note && (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
          Ghi chú người gửi: {item.note}
        </div>
      )}
      {item.admin_note && (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
          Ghi chú admin: {item.admin_note}
          {item.reviewed_at && <> · {fmtDate(item.reviewed_at)}</>}
        </div>
      )}

      {pending && (
        <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <label style={{ display: 'grid', gap: '4px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Cụm thay thế (to)
            <input className="input-field" value={to} maxLength={100} onChange={e => setTo(e.target.value)} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: '4px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Chữ Hán gốc (tuỳ chọn)
            <input
              className="input-field"
              lang="zh"
              value={original}
              maxLength={50}
              onChange={e => {
                const v = e.target.value
                // Vừa thêm chữ gốc vào ô đang trống → bật sẵn ghi glossary.
                if (!original.trim() && v.trim()) setApplyGlossary(true)
                setOriginal(v)
              }}
              disabled={busy}
            />
          </label>
          <label style={{ display: 'grid', gap: '4px', fontSize: '0.78rem', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
            Ghi chú admin (người gửi sẽ thấy)
            <input className="input-field" value={adminNote} maxLength={500} onChange={e => setAdminNote(e.target.value)} disabled={busy} />
          </label>
          {preview && (
            <div style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Xem trước: <span>{preview.before}</span> → <strong style={{ color: 'var(--text-primary, inherit)' }}>{preview.after}</strong>
            </div>
          )}
          {shortFrom && (
            <div role="note" style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={14} aria-hidden="true" />
              Cụm gốc “{item.from_text}” rất ngắn (≤ 3 ký tự) — sẽ bị thay ở MỌI chỗ xuất hiện trong chương, kể cả giữa từ khác.
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', gridColumn: '1 / -1', opacity: hasOriginal ? 1 : 0.55 }}>
            <input
              type="checkbox"
              checked={hasOriginal && applyGlossary}
              disabled={busy || !hasOriginal}
              onChange={e => setApplyGlossary(e.target.checked)}
            />
            Ghi luôn vào glossary (cho các chương dịch sau)
            {!hasOriginal && <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>— cần chữ Hán gốc</span>}
          </label>

          {error && (
            <div role="alert" style={{ gridColumn: '1 / -1', color: '#fca5a5', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={15} /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', gridColumn: '1 / -1' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '5px 12px', minHeight: '34px' }}
              disabled={busy}
              onClick={() => review('approved')}
            >
              <Check size={14} /> Duyệt
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ fontSize: '0.8rem', padding: '5px 12px', minHeight: '34px' }}
              disabled={busy}
              onClick={() => review('rejected')}
            >
              <X size={14} /> Từ chối
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
SuggestionCard.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.number.isRequired,
    slug: PropTypes.string,
    novel_title: PropTypes.string,
    chapter: PropTypes.number,
    from_text: PropTypes.string,
    to_text: PropTypes.string,
    original: PropTypes.string,
    note: PropTypes.string,
    status: PropTypes.string,
    admin_note: PropTypes.string,
    created_at: PropTypes.string,
    reviewed_at: PropTypes.string,
    user_id: PropTypes.number,
    user_name: PropTypes.string,
    email: PropTypes.string,
  }).isRequired,
  onReviewed: PropTypes.func.isRequired,
}

function StatusPill({ status }) {
  const cfg = {
    pending:  { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)' },
    approved: { color: '#6ee7b7', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.25)' },
    rejected: { color: '#fca5a5', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)' },
  }[status] || { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border-panel)' }

  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: '99px',
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, flexShrink: 0,
    }}>
      {suggestionStatusLabel(status)}
    </span>
  )
}
StatusPill.propTypes = {
  status: PropTypes.string,
}
