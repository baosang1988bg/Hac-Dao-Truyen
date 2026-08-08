import React from 'react'
import { Link } from 'react-router-dom'
import { fmtNumber, fmtNovelTitle } from '../../utils/format'

/**
 * NovelTable – Dạng bảng cho danh sách truyện dài, chỉ hiện trên desktop
 * (ẩn qua CSS ở màn hình hẹp vì bảng khó dùng trên mobile). Quét thông tin
 * nhanh hơn grid card khi danh sách dài, có cột Thể loại/Tên/Tác giả/Tình
 * trạng/Số chương.
 * Props:
 *   novels – mảng đã lọc sẵn
 */
export default function NovelTable({ novels }) {
  return (
    <div className="hp-novel-table-wrap">
      <table className="hp-novel-table">
        <thead>
          <tr>
            <th>Thể loại</th>
            <th>Tên truyện</th>
            <th>Tác giả</th>
            <th>Tình trạng</th>
            <th style={{ textAlign: 'right' }}>Số chương</th>
          </tr>
        </thead>
        <tbody>
          {novels.map(n => {
            const isCompleted = n.total_chapters > 0 && (n.chapter_count || 0) >= n.total_chapters
            const title = fmtNovelTitle(n.title, n.slug)
            return (
              <tr key={n.slug}>
                <td>{n.genre || '—'}</td>
                <td>
                  <Link to={`/novel/${n.slug}`} className="hp-novel-table__title-link">
                    {title}
                  </Link>
                </td>
                <td>{n.author || '—'}</td>
                <td>
                  <span className={`hp-novel-table__status${isCompleted ? ' is-done' : ''}`}>
                    {isCompleted ? 'Hoàn thành' : 'Đang dịch'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>{fmtNumber(n.chapter_count || 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
