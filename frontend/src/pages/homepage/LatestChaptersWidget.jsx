import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import NovelCover from '../../components/NovelCover'
import useUpdatesFeed from '../../hooks/useUpdatesFeed'
import { fmtTimeAgo, fmtNumber } from '../../utils/format'
import { chapterRangeLabel } from '../../utils/updatesFeed'
import '../../styles/updates.css'

const LIMIT = 6

/**
 * LatestChaptersWidget — "Chương mới lên" ở sidebar trang chủ.
 * Dữ liệu sống từ GET /api/updates (thay cho AnnouncementsSection cũ đọc
 * announcements.json tĩnh — chỉ đổi sau mỗi lần deploy). Dùng chung request
 * với tab "Mới" và trang /cap-nhat qua apiCache.
 */
export default function LatestChaptersWidget() {
  const { items, loading } = useUpdatesFeed()

  if (loading) {
    return <div className="glass-panel hp-latest hd-skel" style={{ height: 260 }} aria-hidden="true" />
  }
  if (!items.length) return null

  return (
    <section className="glass-panel hp-latest hd-reveal" aria-labelledby="hp-latest-title">
      <div className="hp-latest__head">
        <span className="hd-live-dot" aria-hidden="true" />
        <h3 id="hp-latest-title" className="hp-latest__title">Chương mới lên</h3>
        <Link to="/cap-nhat" className="hp-latest__more">
          Nhật ký <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <ul className="hp-latest__list">
        {items.slice(0, LIMIT).map(it => (
          <li key={`${it.slug}-${it.day}`}>
            <Link to={`/novel/${it.slug}/read/${it.to_chapter}`} className="hp-latest__row">
              <NovelCover novel={it} size="xs" />
              <div className="hp-latest__info">
                <div className="hp-latest__name">{it.title}</div>
                <div className="hp-latest__meta">
                  {chapterRangeLabel(it)} · {fmtTimeAgo(it.last_at)}
                </div>
              </div>
              <span className="hp-latest__badge">+{fmtNumber(it.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
