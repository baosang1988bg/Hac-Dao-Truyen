import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'
import { extractNovels, LATEST_UPDATED_PARAMS } from '../../utils/novelsApi'
import { useCachedGet } from '../../utils/apiCache'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelTable from '../../components/ui/NovelTable'

const LIMIT = 15

/**
 * UpdatesSection — Section "Truyện Mới Cập Nhật" dạng BẢNG.
 * Cột: Thể loại | Tên truyện | Tác giả | Tình trạng | Số Chương.
 * Dùng CHUNG request với AllNovelsSection (tab "Tất cả", trang 1) qua apiCache
 * + LATEST_UPDATED_PARAMS (limit 30) rồi lấy 15 truyện đầu — trước đây 2
 * section bắn 2 request sort=updated_at gần như trùng nhau.
 */
export default function UpdatesSection() {
  const { data, loading: fetching } = useCachedGet('/novels', { params: LATEST_UPDATED_PARAMS })
  const novels = extractNovels(data).slice(0, LIMIT)
  const loading = fetching && novels.length === 0

  if (loading) {
    return (
      <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
        <SectionHeader icon={<Sparkles size={16} style={{ color: 'var(--accent)' }} />} title="Truyện Mới Cập Nhật" />
        <div className="glass-panel" style={{ height: '260px', borderRadius: '14px' }} />
      </section>
    )
  }
  if (novels.length === 0) return null

  return (
    <section className="home-section" style={{ marginBottom: 'var(--section-gap, 2.25rem)' }}>
      <div className="hp-updates-heading">
        <SectionHeader
          icon={<Sparkles size={16} style={{ color: 'var(--accent)' }} />}
          title="Truyện Mới Cập Nhật"
          count={novels.length}
        />
        <Link
          to="/epub"
          className="hp-secondary-link hp-updates-more"
        >
          Xem tất cả truyện <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>

      <div className="glass-panel" style={{ borderRadius: '14px', overflow: 'hidden' }}>
        <NovelTable
          novels={novels}
          limit={LIMIT}
          colWidths={{ genre: '15%', title: '40%', author: '20%', status: '13%', chapters: '12%' }}
          ongoingLabel="Đang ra"
          genreFallback="—"
          authorFallback="Chưa rõ"
        />
      </div>
    </section>
  )
}
