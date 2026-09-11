import PropTypes from 'prop-types'
import { novelType } from '../../utils/propTypes'

import { Link } from 'react-router-dom'
import { fmtNumber, fmtNovelTitle } from '../../utils/format'

/**
 * NovelTable – Dạng bảng cho danh sách truyện dài, chỉ hiện trên desktop
 * (ẩn qua CSS ở màn hình hẹp vì bảng khó dùng trên mobile). Quét thông tin
 * nhanh hơn grid card khi danh sách dài, có cột Thể loại/Tên/Tác giả/Tình
 * trạng/Số chương.
 * Props:
 *   novels        – mảng đã lọc sẵn (component tự cắt theo `limit` nếu có)
 *   limit         – giới hạn số dòng hiển thị (mặc định: hiện hết)
 *   colWidths     – { genre, title, author, status, chapters } độ rộng cột (%), tuỳ chọn
 *   ongoingLabel  – nhãn trạng thái "chưa hoàn thành" (mặc định 'Đang dịch')
 *   genreFallback / authorFallback – text hiện khi thiếu dữ liệu
 */
export default function NovelTable({ novels, limit, colWidths, ongoingLabel = 'Đang dịch', genreFallback = '—', authorFallback = '—' }) {
  const rows = limit ? novels.slice(0, limit) : novels
  const w = colWidths || {}
  return (
    <div className="hp-novel-table-wrap">
      <table className="hp-novel-table">
        <thead>
          <tr>
            <th style={w.genre ? { width: w.genre } : undefined}>Thể loại</th>
            <th style={w.title ? { width: w.title } : undefined}>Tên truyện</th>
            <th style={w.author ? { width: w.author } : undefined}>Tác giả</th>
            <th style={w.status ? { width: w.status } : undefined}>Tình trạng</th>
            <th style={{ textAlign: 'right', ...(w.chapters ? { width: w.chapters } : {}) }}>Số chương</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(n => {
            const isCompleted = n.total_chapters > 0 && (n.chapter_count || 0) >= n.total_chapters
            const title = fmtNovelTitle(n.title, n.slug)
            return (
              <tr key={n.slug}>
                <td>{n.genre ? n.genre.split(',')[0].trim() : genreFallback}</td>
                <td>
                  <Link to={`/novel/${n.slug}`} className="hp-novel-table__title-link" title={title}>
                    {title}
                  </Link>
                </td>
                <td>{n.author || authorFallback}</td>
                <td>
                  <span className={`hp-novel-table__status${isCompleted ? ' is-done' : ''}`}>
                    {isCompleted ? 'Hoàn thành' : ongoingLabel}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>{fmtNumber(n.chapter_count || n.total_chapters || 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
NovelTable.propTypes = {
  novels: PropTypes.arrayOf(novelType),
  limit: PropTypes.number,
  colWidths: PropTypes.shape({
    genre: PropTypes.string,
    title: PropTypes.string,
    author: PropTypes.string,
    status: PropTypes.string,
    chapters: PropTypes.string,
  }),
  ongoingLabel: PropTypes.string,
  genreFallback: PropTypes.string,
  authorFallback: PropTypes.string,
};
