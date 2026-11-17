import PropTypes from 'prop-types'
import { novelType } from '../../utils/propTypes'

import { Link } from 'react-router-dom'
import { fmtNumber, novelDisplayTitle, cleanAuthor } from '../../utils/format'
import { primaryGenre } from '../../utils/genreLabels'
import { isNovelCompleted } from '../../utils/novelStatus'

/**
 * NovelTable – Dạng bảng cho danh sách truyện dài. Quét thông tin nhanh hơn
 * grid card khi danh sách dài, có cột Thể loại/Tên/Tác giả/Tình trạng/Số chương.
 * Màn hình hẹp (≤768px): styles/home.css biến mỗi <tr> thành 1 thẻ danh sách
 * 2 dòng (tên + số chương / thể loại · tác giả · tình trạng), cả dòng bấm được
 * (link tên truyện phủ ::after) — không còn ẩn cột bằng display:none.
 * Mobile đọc `hp-novel-table__unit` (" chương") vì không còn tiêu đề cột.
 * Props:
 *   novels        – mảng đã lọc sẵn (component tự cắt theo `limit` nếu có)
 *   limit         – giới hạn số dòng hiển thị (mặc định: hiện hết)
 *   colWidths     – { genre, title, author, status, chapters } độ rộng cột (%), tuỳ chọn
 *   ongoingLabel  – nhãn trạng thái "chưa hoàn thành" (mặc định 'Đang dịch')
 *   genreFallback / authorFallback – text hiện khi thiếu dữ liệu (mặc định "—";
 *                   KHÔNG điền giá trị giả như "Tiên Hiệp"/"Đang cập nhật")
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
            const isCompleted = isNovelCompleted(n)
            const title = novelDisplayTitle(n)
            return (
              <tr key={n.slug}>
                <td className="hp-novel-table__genre">{primaryGenre(n.genre) || genreFallback}</td>
                <td className="hp-novel-table__title">
                  <Link to={`/novel/${n.slug}`} className="hp-novel-table__title-link" title={title}>
                    {title}
                  </Link>
                </td>
                <td className="hp-novel-table__author">{cleanAuthor(n.author) || authorFallback}</td>
                <td className="hp-novel-table__state">
                  <span className={`hp-novel-table__status${isCompleted ? ' is-done' : ''}`}>
                    {isCompleted ? 'Hoàn thành' : ongoingLabel}
                  </span>
                </td>
                <td className="hp-novel-table__chapters" style={{ textAlign: 'right' }}>
                  {fmtNumber(n.chapter_count || n.total_chapters || 0)}
                  <span className="hp-novel-table__unit"> chương</span>
                </td>
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
