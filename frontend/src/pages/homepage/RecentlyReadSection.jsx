import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, Clock, BookOpen, BookMarked } from 'lucide-react'
import api from '../../api'
import { fetchNovelsBySlugsBatch } from '../../utils/novelsApi'
import NovelCover from '../../components/NovelCover'
import SectionHeader from '../../components/ui/SectionHeader'
import { getAllHistory, fmtChapterLabel } from '../../utils/readingHistory'
import { fmtTimeAgo, novelDisplayTitle } from '../../utils/format'

const MAX_ITEMS = 8

// Khoá so trùng: slug đã decode, thường, bỏ khoảng trắng/gạch thừa ở 2 đầu —
// lịch sử cũ có thể lưu cùng 1 truyện dưới slug encode khác nhau.
function slugKey(slug) {
  let s = String(slug || '')
  try { s = decodeURIComponent(s) } catch { /* giữ nguyên nếu decode lỗi */ }
  return s.trim().toLowerCase().replace(/^-+|-+$/g, '')
}

/** Lịch sử (đã sort mới nhất trước) → tối đa MAX_ITEMS mục, bỏ trùng slug. */
function pickHistory(history) {
  const seen = new Set()
  const out = []
  for (const h of history || []) {
    const key = slugKey(h?.slug)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(h)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

// Thông tin hiển thị có sẵn trong mục lịch sử (readingHistory mới lưu title/cover_url).
function novelFromHistory(h) {
  if (!h?.title) return null
  return { slug: h.slug, title: h.title, cover_url: h.cover_url || '' }
}

/** Bỏ mục trùng sau khi đã có dữ liệu truyện (slug chuẩn hoá từ API / cùng tên). */
function dedupeResolved(items) {
  const seenSlug = new Set()
  const seenTitle = new Set()
  return items.filter(item => {
    const slug = slugKey(item.novel?.slug || item.slug)
    const title = novelDisplayTitle(item.novel).toLocaleLowerCase('vi')
    if (seenSlug.has(slug) || (title && seenTitle.has(title))) return false
    seenSlug.add(slug)
    if (title) seenTitle.add(title)
    return true
  })
}

/**
 * RecentlyReadSection – Truyện vừa đọc gần đây từ localStorage (Web + EPUB).
 * - Tối đa 8 mục, bỏ trùng.
 * - Hiện NGAY từ title/cover_url lưu trong lịch sử; chỉ hỏi API cho mục thiếu
 *   thông tin, gom 1 request GET /novels?slugs=... (fetchNovelsBySlugsBatch tự
 *   fallback gọi lẻ /novels/:slug nếu backend cũ chưa hỗ trợ).
 */
export default function RecentlyReadSection() {
  // null = đang tải (chưa có mục nào hiển thị được), [] = rỗng
  const [items, setItems] = useState(() => {
    const picked = pickHistory(getAllHistory())
    if (!picked.length) return []
    const ready = picked.filter(novelFromHistory).map(h => ({ ...h, novel: novelFromHistory(h) }))
    return ready.length ? dedupeResolved(ready) : null
  })

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const picked = pickHistory(getAllHistory())
    const missing = picked.filter(h => !novelFromHistory(h)).map(h => h.slug)
    if (!missing.length) return undefined
    fetchNovelsBySlugsBatch(api, missing, { signal: controller.signal }).then(novelMap => {
      if (!alive) return
      const merged = picked.map(h => {
        const novel = novelMap.get(h.slug) || novelFromHistory(h)
        return novel ? { ...h, novel } : null
      }).filter(Boolean)
      setItems(dedupeResolved(merged))
    }).catch(() => {
      if (alive) setItems(prev => prev || [])
    })
    return () => { alive = false; controller.abort() }
  }, [])

  if (items === null) {
    return (
      <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
        <SectionHeader icon={<History size={16} style={{ color: 'var(--accent)' }} />} title="Vừa Đọc Gần Đây" />
        <div className="glass-panel" style={{ height: '140px', borderRadius: '14px' }} />
      </section>
    )
  }
  if (items.length === 0) return null

  return (
    <section className="home-section animate-fade-in" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <SectionHeader
        icon={<History size={16} style={{ color: 'var(--accent)' }} />}
        title="Vừa Đọc Gần Đây"
        count={items.length}
      />

      <div className="section-row-scroll" style={{ paddingBottom: 'var(--space-2, 8px)' }}>
        {items.map(item => {
          const isEpub = item.chapter === 'EPUB' || !item.chapter || item.chapter === 'null'
          const readUrl = isEpub
            ? `/novel/${item.slug}/epub-reader`
            : `/novel/${item.slug}/read/${item.chapter}`

          const formattedTitle = novelDisplayTitle({ ...item.novel, slug: item.novel.slug || item.slug })

          return (
            <div
              key={item.slug}
              className="rr-card"
            >
              <div style={{ display: 'flex', gap: 'var(--space-2, 8px)', alignItems: 'flex-start' }}>
                <NovelCover novel={item.novel} size="sm" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Link
                    to={`/novel/${item.slug}`}
                    style={{
                      display: 'block',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      color: 'var(--text-main)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.3,
                      minHeight: '24px',
                    }}
                    title={formattedTitle}
                  >
                    {formattedTitle}
                  </Link>
                  <div style={{ fontSize: 'var(--font-xs, 0.75rem)', color: 'var(--accent)', fontWeight: 600, marginTop: 'var(--space-1, 4px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isEpub ? 'File EPUB' : `Đã đọc: ${fmtChapterLabel(item.chapter)}`}
                  </div>
                  {item.timestamp > 0 && (
                    <div style={{ fontSize: 'var(--font-xs, 0.75rem)', color: 'var(--text-muted)', marginTop: 'var(--space-1, 4px)', display: 'flex', alignItems: 'center', gap: 'var(--space-1, 4px)' }}>
                      <Clock size={11} /> {fmtTimeAgo(Math.floor(item.timestamp / 1000))}
                    </div>
                  )}
                </div>
              </div>

              <Link
                to={readUrl}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: 'var(--space-2, 8px) var(--space-3, 12px)',
                  fontSize: '0.8rem',
                  minHeight: 'var(--tap-target-min, 44px)',
                  justifyContent: 'center',
                  borderRadius: '8px',
                }}
              >
                {isEpub ? <BookMarked size={13} /> : <BookOpen size={13} />}
                {isEpub ? ' Đọc EPUB' : ' Đọc tiếp →'}
              </Link>
            </div>
          )
        })}
      </div>
    </section>
  )
}
