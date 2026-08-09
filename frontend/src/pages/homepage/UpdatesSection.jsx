import React from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'
import SectionHeader from '../../components/ui/SectionHeader'
import { fmtNovelTitle, fmtNumber } from '../../utils/format'

/**
 * UpdatesSection — Section "Truyện Mới Cập Nhật" dạng BẢNG TABLE (Chuẩn 100% Truyentrung.com)
 * Cột: Thể loại | Tên truyện | Tác giả | Tình trạng | Số Chương
 */
export default function UpdatesSection({ novels }) {
  if (!novels || novels.length === 0) return null

  const displayList = novels.slice(0, 15)

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

      <div className="hp-novel-table-wrap glass-panel" style={{ borderRadius: '14px', overflow: 'hidden' }}>
        <table className="hp-novel-table">
          <thead>
            <tr>
              <th style={{ width: '15%' }}>Thể loại</th>
              <th style={{ width: '40%' }}>Tên truyện</th>
              <th style={{ width: '20%' }}>Tác giả</th>
              <th style={{ width: '13%' }}>Tình trạng</th>
              <th style={{ width: '12%', textAlign: 'right' }}>Số Chương</th>
            </tr>
          </thead>
          <tbody>
            {displayList.map(novel => {
              const formattedTitle = fmtNovelTitle(novel.title, novel.slug)
              const isCompleted = novel.total_chapters > 0 && novel.chapter_count >= novel.total_chapters
              const chapCount = novel.chapter_count || novel.total_chapters || 0

              return (
                <tr key={novel.slug}>
                  <td style={{ color: 'var(--accent)', fontWeight: 500 }}>
                    {novel.genre ? novel.genre.split(',')[0].trim() : 'Tiên Hiệp'}
                  </td>
                  <td>
                    <Link to={`/novel/${novel.slug}`} className="hp-novel-table__title-link" title={formattedTitle}>
                      {formattedTitle}
                    </Link>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {novel.author || 'Đang cập nhật'}
                  </td>
                  <td>
                    <span className={`hp-novel-table__status ${isCompleted ? 'is-done' : ''}`}>
                      {isCompleted ? 'Hoàn thành' : 'Đang ra'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-main)' }}>
                    {fmtNumber(chapCount)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
