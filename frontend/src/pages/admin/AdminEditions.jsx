import PropTypes from 'prop-types'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookCopy, Eye, EyeOff, AlertCircle, RefreshCw, Check } from 'lucide-react'
import { fetchAdminEditions, setAdminEditionPublished } from '../../engagementApi'
import { fmtDate } from '../../utils/format'
import { normalizeSlugFilter, serverErrorMessage } from '../../utils/engagement'
import { chapterUrl } from '../../utils/chapters'

const KIND_LABELS = { ai: 'Dịch AI', human: 'Dịch giả', convert: 'Convert' }

/**
 * Quản lý bản dịch phụ (một truyện nhiều bản dịch, migration 016).
 * GET  /api/admin/editions?slug=                    — mọi bản, kể cả bản đang ẩn
 * POST /api/admin/novels/:slug/editions/:code       — { published } ẩn/hiện
 *
 * Nội dung bản dịch chỉ được đẩy lên qua tools/migrate_to_cloudflare.py
 * --edition (SYNC_KEY); trang này chỉ ẩn/hiện + xem giấy phép. Bản AI mặc định
 * 'he-thong' không có dòng ở đây và không ẩn được từ trang này.
 */
export default function AdminEditions() {
  const [slugInput, setSlugInput] = useState('')
  const [slug, setSlug] = useState('')
  const [items, setItems] = useState(null) // null = đang tải
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(() => {
    setItems(null)
    setError(null)
    fetchAdminEditions(slug)
      .then(setItems)
      .catch(err => { setItems([]); setError(serverErrorMessage(err, 'Không tải được danh sách bản dịch.')) })
  }, [slug])

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

  // Ẩn/hiện xong: cập nhật tại chỗ, không tải lại cả danh sách.
  const onToggled = (item, res) => {
    setItems(list => (list || []).map(it => (
      it.slug === item.slug && it.code === item.code
        ? { ...it, published: Boolean(res?.published), updated_at: new Date().toISOString() }
        : it
    )))
    const count = Number.isFinite(res?.edition_count) ? ` Truyện còn ${res.edition_count} bản dịch phụ đang hiện.` : ''
    setNotice(`${res?.published ? 'Đã hiện' : 'Đã ẩn'} “${item.name}” (${item.slug}/${item.code}).${count}`)
  }

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.7rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <BookCopy size={24} /> Bản dịch
        </h1>
        <p className="page-subtitle" style={{ fontSize: '0.92rem', lineHeight: 1.55 }}>
          Các bản dịch phụ (dịch giả, convert, AI khác) bên cạnh bản AI mặc định. <strong>Ẩn</strong> = người đọc
          không thấy bản này nữa (bộ chọn bản dịch, mục lục, nội dung chương); dữ liệu vẫn giữ nguyên, có thể
          <strong> Hiện</strong> lại bất cứ lúc nào. Kiểm tra kỹ ghi chú giấy phép trước khi hiện.
        </p>
      </div>

      <form onSubmit={applySlug} style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
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
        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.82rem', padding: '6px 12px', minHeight: '34px', marginLeft: 'auto' }} onClick={load}>
          <RefreshCw size={14} /> Tải lại
        </button>
      </form>

      {notice && (
        <div className="glass-panel" role="status" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', color: '#6ee7b7', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check size={16} /> {notice}
          <button type="button" className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => setNotice(null)}>Đóng</button>
        </div>
      )}

      {error && (
        <div className="glass-panel" role="alert" style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', gap: '12px', color: '#fca5a5', marginBottom: '1rem' }}>
          <AlertCircle size={18} /> {error}
        </div>
      )}

      {items === null && (
        <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Đang tải...
        </div>
      )}

      {items !== null && items.length === 0 && !error && (
        <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Chưa có bản dịch phụ nào{slug ? ` cho truyện ${slug}` : ''}. Đẩy bản dịch bằng
          {' '}<code>python tools/migrate_to_cloudflare.py --edition &lt;code&gt;</code>.
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="glass-panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="admin-editions-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                <th style={TH}>Truyện</th>
                <th style={TH}>Bản dịch</th>
                <th style={TH}>Loại</th>
                <th style={{ ...TH, textAlign: 'right' }}>Chương</th>
                <th style={TH}>Giấy phép / nguồn gốc</th>
                <th style={TH}>Cập nhật</th>
                <th style={TH}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <EditionRow key={`${item.slug}/${item.code}`} item={item} onToggled={onToggled} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const TH = { padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border-panel)', fontWeight: 600, whiteSpace: 'nowrap' }
const TD = { padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border-panel)', verticalAlign: 'top' }

function EditionRow({ item, onToggled }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const toggle = async () => {
    if (busy) return
    const next = !item.published
    const question = next
      ? `Hiện bản dịch “${item.name}” của truyện ${item.slug}?\nNgười đọc sẽ thấy bản này ngay. Đã kiểm tra giấy phép chưa?`
      : `Ẩn bản dịch “${item.name}” của truyện ${item.slug}?\nNgười đọc sẽ không mở được bản này nữa (dữ liệu vẫn giữ).`
    if (!window.confirm(question)) return
    setBusy(true)
    setError(null)
    try {
      const res = await setAdminEditionPublished(item.slug, item.code, next)
      onToggled(item, res)
    } catch (err) {
      const code = err?.response?.status
      setError(serverErrorMessage(err, code ? `Không đổi được trạng thái (HTTP ${code}).` : 'Không đổi được trạng thái.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr>
      <td style={TD}>
        <Link to={`/novel/${item.slug}`} style={{ fontWeight: 600, color: 'var(--accent)' }}>
          {item.novel_title || item.slug}
        </Link>
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{item.slug}</div>
      </td>
      <td style={TD}>
        <div style={{ fontWeight: 600 }}>{item.name}</div>
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          <code>{item.code}</code>{item.translator ? ` · ${item.translator}` : ''}
        </div>
        {item.published && item.chapter_count > 0 && (
          <Link to={chapterUrl(item.slug, { number: 1 }, item.code)} style={{ fontSize: '0.74rem' }}>Đọc thử ch. 1</Link>
        )}
      </td>
      <td style={TD}>{KIND_LABELS[item.kind] || item.kind}</td>
      <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.chapter_count}</td>
      <td style={{ ...TD, maxWidth: '320px' }}>
        {/* Text thuần do công cụ sync gửi lên — React tự escape, giữ xuống dòng. */}
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.8rem', color: item.license_note ? 'inherit' : '#fbbf24' }}>
          {item.license_note || '(trống — không nên hiện bản này)'}
        </div>
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        {item.updated_at ? fmtDate(item.updated_at) : '—'}
      </td>
      <td style={TD}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 600, color: item.published ? '#6ee7b7' : 'var(--text-muted)' }}>
            {item.published ? 'Đang hiện' : 'Đang ẩn'}
          </span>
          <button
            type="button"
            className={item.published ? 'btn btn-danger' : 'btn btn-primary'}
            style={{ fontSize: '0.78rem', padding: '4px 10px', minHeight: '32px' }}
            disabled={busy}
            onClick={toggle}
            aria-label={`${item.published ? 'Ẩn' : 'Hiện'} bản dịch ${item.name} của ${item.slug}`}
          >
            {item.published ? <EyeOff size={14} /> : <Eye size={14} />} {item.published ? 'Ẩn' : 'Hiện'}
          </button>
          {error && (
            <span role="alert" style={{ color: '#fca5a5', fontSize: '0.76rem' }}>{error}</span>
          )}
        </div>
      </td>
    </tr>
  )
}
EditionRow.propTypes = {
  item: PropTypes.shape({
    slug: PropTypes.string.isRequired,
    novel_title: PropTypes.string,
    code: PropTypes.string.isRequired,
    name: PropTypes.string,
    translator: PropTypes.string,
    kind: PropTypes.string,
    license_note: PropTypes.string,
    published: PropTypes.bool,
    chapter_count: PropTypes.number,
    updated_at: PropTypes.string,
  }).isRequired,
  onToggled: PropTypes.func.isRequired,
}
