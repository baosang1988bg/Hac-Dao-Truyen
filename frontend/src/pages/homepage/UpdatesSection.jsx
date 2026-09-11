import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'
import api from '../../api'
import { extractNovels } from '../../utils/novelsApi'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelTable from '../../components/ui/NovelTable'

const LIMIT = 15

/**
 * UpdatesSection — Section "Truyện Mới Cập Nhật" dạng BẢNG TABLE (Chuẩn 100% Truyentrung.com)
 * Cột: Thể loại | Tên truyện | Tác giả | Tình trạng | Số Chương.
 * Tự fetch 15 truyện cập nhật gần nhất — không nhận cả catalog từ HomePage.
 */
export default function UpdatesSection() {
  const [novels, setNovels] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    api.get('/novels', { params: { sort: 'updated_at', order: 'desc', limit: LIMIT }, signal: controller.signal })
      .then(res => { if (alive) setNovels(extractNovels(res.data)) })
      .catch(() => { /* im lặng — section tự ẩn nếu không tải được */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; controller.abort() }
  }, [])

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <SectionHeader
          icon={<Sparkles size={16} style={{ color: 'var(--accent)' }} />}
          title="Truyện Mới Cập Nhật"
          count={novels.length}
        />
        <Link
          to="/epub"
          style={{ fontSize: '0.8rem', color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
        >
          Xem thêm truyện nguồn Qidian <ArrowRight size={13} />
        </Link>
      </div>

      <div className="glass-panel" style={{ borderRadius: '14px', overflow: 'hidden' }}>
        <NovelTable
          novels={novels}
          limit={15}
          colWidths={{ genre: '15%', title: '40%', author: '20%', status: '13%', chapters: '12%' }}
          ongoingLabel="Đang ra"
          genreFallback="Tiên Hiệp"
          authorFallback="Đang cập nhật"
        />
      </div>
    </section>
  )
}
