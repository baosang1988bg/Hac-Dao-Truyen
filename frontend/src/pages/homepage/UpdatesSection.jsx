import PropTypes from 'prop-types'
import { novelType } from '../../utils/propTypes'

import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import NovelTable from '../../components/ui/NovelTable'

/**
 * UpdatesSection — Section "Truyện Mới Cập Nhật" dạng BẢNG TABLE (Chuẩn 100% Truyentrung.com)
 * Cột: Thể loại | Tên truyện | Tác giả | Tình trạng | Số Chương
 */
export default function UpdatesSection({ novels }) {
  if (!novels || novels.length === 0) return null

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
UpdatesSection.propTypes = {
  novels: PropTypes.arrayOf(novelType),
};
